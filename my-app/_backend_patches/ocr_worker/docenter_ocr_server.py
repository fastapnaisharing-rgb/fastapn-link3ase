"""
docenter_ocr_server.py v3
================================================================
FastAPI OCR Server สำหรับ Document Center
- Load PaddleOCR model ครั้งเดียวตอน startup
- รับ PDF → detect grid (H+V lines) → crop cells → OCR per cell
- ถ้า detect grid ไม่ได้ fallback ไปใช้ OCR + header detection

Port: 5050
================================================================
"""

import asyncio
import logging
import os
import re
import sys
import tempfile
import traceback
import time
from contextlib import asynccontextmanager
from pathlib import Path

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["PATH"] += r";C:\apps\poppler\Library\bin"

import psutil
import numpy as np
import cv2
import psycopg2
import uvicorn
# MARKER_DOCENTER_FIX_FORM_IMPORT_V1 -- เพิ่ม Form ที่ขาดไป (ทำให้ Service Start ไม่ขึ้น)
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
# MARKER_DOCENTER_LIGHTWEIGHT_STREAMING_V1 -- เพิ่ม json + StreamingResponse สำหรับ /ocr-lightweight แบบ Stream ทีละหน้า
import json
from fastapi.responses import StreamingResponse

# แก้ StreamHandler ให้ใช้ utf-8 เพื่อรองรับ Thai log บน Windows Service
_stdout_handler = logging.StreamHandler(sys.stdout)
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
_stdout_handler.stream = open(sys.stdout.fileno(), mode='w', encoding='utf-8', errors='replace', closefd=False) if hasattr(sys.stdout, 'fileno') else sys.stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        _stdout_handler,
        logging.FileHandler(
            r"C:\apps\fastapn-backend\ocr_worker\logs\docenter_ocr.log",
            encoding="utf-8",
            errors="replace"
        ),
    ],
)
log = logging.getLogger("docenter_ocr")

# ── DB Config สำหรับ OCR Lock ─────────────────────────────────────────────────
_DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "fastapn-link3ase",
    "user":     "postgres",
    "password": os.environ.get("DB_PASSWORD", "postgres"),
    "connect_timeout": 5,
}

OCR_LOCK_SOURCE    = 'docenter'
OCR_LOCK_TIMEOUT_SEC = 300

def _get_db_conn():
    try:
        return psycopg2.connect(**_DB_CONFIG)
    except Exception:
        return None

def _acquire_ocr_lock(lock_id: str) -> bool:
    """return True ถ้าได้ lock หรือ table ไม่มี (fallback)"""
    conn = _get_db_conn()
    if not conn:
        return True  # ถ้า connect ไม่ได้ → รันเลย ไม่บล็อก
    try:
        with conn.cursor() as cur:
            # เคลียร์ stale lock
            cur.execute("""
                DELETE FROM system_ocr_queue
                WHERE status = 'running'
                  AND updated_at < NOW() - INTERVAL '%s seconds'
            """ % OCR_LOCK_TIMEOUT_SEC)
            # ลอง insert lock
            cur.execute("""
                INSERT INTO system_ocr_queue
                  (source, source_id, file_name, status, priority_class, created_at, updated_at)
                VALUES (%s, %s, %s, 'running', 2, NOW(), NOW())
                ON CONFLICT DO NOTHING
                RETURNING id
            """, (OCR_LOCK_SOURCE, lock_id, lock_id))
            row = cur.fetchone()
            conn.commit()
            return row is not None
    except Exception as e:
        log.warning(f"[lock] acquire error: {e}")
        try: conn.rollback()
        except: pass
        return True  # fallback
    finally:
        conn.close()

def _release_ocr_lock(lock_id: str):
    # Patch 93: DELETE แทน UPDATE status='done' — Lock นี้เป็น Mutex ชั่วคราว
    # ล้วนๆ (Detail={} เสมอ ไม่มีค่าที่ควรเก็บต่อ) พอปล่อย Lock แล้วควรหาย
    # จาก system_ocr_queue ทันที ไม่ใช่ค้างสะสมไม่มีที่สิ้นสุดเหมือนเดิม
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM system_ocr_queue
                WHERE source = %s AND source_id = %s AND status = 'running'
            """, (OCR_LOCK_SOURCE, lock_id))
            conn.commit()
    except Exception as e:
        log.warning(f"[lock] release error: {e}")
    finally:
        conn.close()

def _wait_for_ocr_lock(lock_id: str, max_wait_sec: int = 300) -> bool:
    """รอ lock จาก AP OCR — บล็อก thread จนกว่าจะได้หรือ timeout"""
    waited = 0
    while waited < max_wait_sec:
        if _acquire_ocr_lock(lock_id):
            return True
        log.info(f"[lock] AP OCR กำลังทำงาน → รอ... ({waited}s)")
        time.sleep(10)
        waited += 10
    log.warning(f"[lock] รอนานเกิน {max_wait_sec}s → บังคับรันต่อ")
    return True

ocr_engine = None
ocr_semaphore = None
_last_request_time = 0

def _get_idle_timeout_sec() -> int:
    hour = time.localtime().tm_hour
    if 0 <= hour < 7:   return  5 * 60
    if 8 <= hour < 18:  return 15 * 60
    return 5 * 60

# MARKER_DOCENTER_OCR_WATCHDOG_FIX
async def _idle_watchdog():
    """Shutdown when no request for idle_timeout seconds
    -- เฉพาะตอนที่เคยโหลด PaddleOCR Model จริงแล้วเท่านั้น (ocr_engine is not
    None = เคยมี Request จริง มี RAM สะสมให้คืน) ถ้ายังไม่เคยโหลดเลย (ไม่มี
    Request มาตั้งแต่ Start/Restart ครั้งก่อน) ไม่มี RAM สะสมให้คืน -- ไม่ต้อง
    Shutdown วนเปล่าๆ (Logic เดียวกับที่แก้ให้ ocr_worker_v2.py)"""
    global _last_request_time
    _last_request_time = time.time()
    log.info("[idle] Watchdog started")
    while True:
        await asyncio.sleep(60)
        idle_sec = time.time() - _last_request_time
        timeout_sec = _get_idle_timeout_sec()
        # MARKER_DOCENTER_WATCHDOG_INFLIGHT_FIX_V1
        # ── FIX: เดิมเช็คแค่เวลาผ่านไปนานแค่ไหน ไม่เช็คว่ากำลังมี ──
        # ── Request ทำงานอยู่จริงไหม -- PDF หลายหน้าที่ใช้เวลานาน ──
        # ── กว่า Timeout โดน Kill กลางทาง (ECONNRESET) -- ห้าม ────
        # ── Shutdown ถ้า Semaphore ยัง Locked อยู่เด็ดขาด ─────────
        if ocr_semaphore is not None and ocr_semaphore.locked():
            continue
        if idle_sec >= timeout_sec and ocr_engine is not None:
            log.info(f"[idle] No request for {int(idle_sec)}s (มี Model โหลดค้างอยู่) -- shutting down")
            import signal, os as _os
            _os.kill(_os.getpid(), signal.SIGTERM)


# MARKER_DOCENTER_CPU_GOVERNOR_V2 -- ปรับ Priority/Core ตามภาระ CPU ของงานอื่นระหว่าง OCR
# ว่าง (งานอื่นใช้ CPU < 40%) -> BELOW_NORMAL + สูงสุด 4 Core ; ไม่ว่าง -> IDLE + Core 0+1 (เหมือนเดิม)
# ตรวจซ้ำทุก 3 วินาทีระหว่างทำงาน และคืนเป็น IDLE + Core 0+1 เมื่อจบ
import threading as _gov_threading
from contextlib import contextmanager as _gov_contextmanager

def _gov_apply():
    try:
        p = psutil.Process(os.getpid())
        ncpu = psutil.cpu_count(logical=True) or 2
        p.cpu_percent(None)
        sysp = psutil.cpu_percent(interval=0.5)
        mine = p.cpu_percent(None) / ncpu
        other = max(0.0, sysp - mine)
        if other < 40 and ncpu > 2:
            cores = list(range(min(ncpu, 4)))
            p.cpu_affinity(cores)
            p.nice(getattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS", 0))
            log.info(f"[governor] other CPU {other:.0f}% -> BELOW_NORMAL, cores {cores}")
        else:
            p.cpu_affinity([0, 1])
            p.nice(getattr(psutil, "IDLE_PRIORITY_CLASS", 19))
            log.info(f"[governor] other CPU {other:.0f}% -> IDLE, cores [0, 1]")
    except Exception as e:
        log.warning(f"[governor] apply failed: {e}")

def _gov_reset():
    try:
        p = psutil.Process(os.getpid())
        p.cpu_affinity([0, 1])
        p.nice(getattr(psutil, "IDLE_PRIORITY_CLASS", 19))
    except Exception:
        pass

@_gov_contextmanager
def cpu_governor():
    stop = _gov_threading.Event()
    _gov_apply()
    def _loop():
        while not stop.wait(3.0):
            _gov_apply()
    t = _gov_threading.Thread(target=_loop, daemon=True)
    t.start()
    try:
        yield
    finally:
        stop.set()
        t.join(timeout=2)
        _gov_reset()


@asynccontextmanager
async def lifespan(app):
    global ocr_engine, ocr_semaphore

    # IDLE priority: OS gives AP OCR CPU first, DocCenter gets leftovers
    # No CPU affinity: let OS schedule across all cores freely
    try:
        p = psutil.Process(os.getpid())
        p.cpu_affinity([0, 1])  # Core 0+1 same as AP OCR
        p.nice(psutil.IDLE_PRIORITY_CLASS)  # IDLE: AP OCR gets CPU first
        log.info(f"CPU affinity: Core 0+1, priority: IDLE (PID {os.getpid()})")
    except Exception as e:
        log.warning(f"Priority set failed: {e}")

    # MARKER_DOCENTER_OCR_LAZYLOAD
    # เดิมโหลด PaddleOCR ทันทีตอน Start ค้างไว้ตลอดอายุ Service (กิน RAM
    # แม้ไม่มีงาน) -> เปลี่ยนเป็น Lazy Load ที่ _ensure_ocr_engine() แทน
    # (เรียกจากต้น run_ocr_sync ตอนมี Request แรกเข้ามาจริงเท่านั้น)
    log.info("OCR Server พร้อมรับงาน (PaddleOCR จะโหลดตอนมี Request แรกเข้า)")
    ocr_semaphore = asyncio.Semaphore(1)  # 1 request at a time
    asyncio.create_task(_idle_watchdog())  # auto-shutdown when idle
    yield
    log.info("Server shutting down")


app = FastAPI(title="Document Center OCR", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://10.101.87.126:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

COL_NAMES = [
    "Branch", "Vendor Name", "GR Transaction No.", "Invoice Number",
    "Receive Date", "รายการ", "มูลค่าก่อนภาษี", "มูลค่าภาษี", "มูลค่ารวม",
    "Batch Name", "Payment Doc"
]

HEADER_KEYWORDS = {
    "Branch":             ["branch"],
    "Vendor Name":        ["vendor name", "vendor"],
    "GR Transaction No.": ["gr transaction", "gr trans", "transaction no"],
    "Invoice Number":     ["invoice number", "invoice num", "invoice no"],
    "Receive Date":       ["receive date"],
    "รายการ":             ["รายการ"],
    "มูลค่าก่อนภาษี":    ["มูลค่าก่อน", "ก่อนภาษี"],
    "มูลค่าภาษี":        ["มูลค่าภาษี"],
    "มูลค่ารวม":         ["มูลค่ารวม"],
    "Batch Name":         ["batch name", "batch"],
    "Payment Doc":        ["payment doc", "payment"],
}

META_KEYS = {
    "doc type":         "doc_type",
    "bu code":          "bu_code",
    "ชื่อผู้ประกอบการ": "bu_name",
    "receive date":     "receive_date",
}

SUPPORTED_DOC_TYPES = {"APN01", "AP07", "AP09", "TRANS", "IMP"}
SKIP_KEYWORDS = [
    "branch", "vendor name", "gr transaction", "invoice number",
    "receive date", "รายการ", "มูลค่า", "batch name", "payment doc",
    "ยอดรวม", "doc type", "bu code", "ชื่อผู้ประกอบการ", "serial code",
]
NUM_COLS = {"มูลค่าก่อนภาษี", "มูลค่าภาษี", "มูลค่ารวม"}


def get_pdf_rotation(pdf_path: str) -> int:
    import subprocess
    try:
        result = subprocess.run(
            [r"C:\apps\poppler\Library\bin\pdfinfo.exe", pdf_path],
            capture_output=True, timeout=10
        )
        output = (result.stdout + result.stderr).decode("utf-8", errors="ignore")
        m = re.search(r"Page rot:\s*(\d+)", output)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


def pdf_to_images(pdf_bytes: bytes, dpi: int = 200):
    from pdf2image import convert_from_bytes
    return convert_from_bytes(pdf_bytes, dpi=dpi, poppler_path=r"C:\apps\poppler\Library\bin")


def rotate_image(image, rot: int):
    from PIL import Image as PILImage
    if rot == 90:   return image.transpose(PILImage.ROTATE_270)
    if rot == 180:  return image.transpose(PILImage.ROTATE_180)
    if rot == 270:  return image.transpose(PILImage.ROTATE_90)
    return image


# MARKER_DOCENTER_AUTO_ORIENT_V1
# ── Auto-Orient: เครื่องสแกน (RICOH) เขียน /Rotate 270 ลง PDF แต่ภาพจริงตั้งตรงอยู่แล้ว ──
# ── poppler หมุนตาม /Rotate -> ภาพตะแคง -> OCR อ่านไม่ออก. ลอง "ภาพต้นฉบับ" ก่อน ──
import hashlib as _hashlib
_ORIENT_CACHE = {}
_ORIENT_KEYS = ["doc type", "bu code", "branch", "vendor", "receive date", "invoice", "grt",
                "batch", "ผู้ประกอบการ", "รายการ", "ยอด", "มูลค่า", "serial code"]
_ORIENT_MIN_SCORE = 4


def pdf_to_images_orig(pdf_bytes: bytes, dpi: int = 200):
    """Render โดยไม่ใช้ /Rotate ของหน้า (ภาพต้นฉบับ) -> (images, had_rotate)"""
    import fitz  # pymupdf (ใช้อยู่แล้วใน /extract-pages)
    from PIL import Image as PILImage
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out, had_rot = [], False
    try:
        for page in doc:
            if page.rotation:
                had_rot = True
                page.set_rotation(0)
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            out.append(PILImage.frombytes("RGB", [pix.width, pix.height], pix.samples))
    finally:
        doc.close()
    return out, had_rot


def _orient_score(img) -> int:
    """OCR หน้าแรกแบบย่อ แล้วนับคำหัวกระดาษที่อ่านเจอ (ยิ่งมากยิ่งตั้งถูก)"""
    try:
        # MARKER_DOCENTER_ORIENT_FAST_V1 -- ตรวจทิศจาก "แถบบน" เท่านั้น (หัวกระดาษมีคำ key ครบ) เร็วกว่า OCR ทั้งหน้า ~3 เท่า
        small = img.copy()
        try:
            _frac = float(os.environ.get("DOCENTER_ORIENT_CROP", "0.38"))
        except Exception:
            _frac = 0.38
        if 0.1 <= _frac < 1.0:
            small = small.crop((0, 0, small.width, int(small.height * _frac)))
        small.thumbnail((1800, 1800))
        items = ocr_image_full(small)
    except Exception as e:
        log.warning(f"[orient] score failed: {e}")
        return 0
    txt = " ".join(i["text"] for i in items).lower()
    return sum(1 for k in _ORIENT_KEYS if k in txt)


def _decide_orientation(pdf_bytes: bytes, rendered):
    """คืน (source, extra_rot): source = 'orig' (ไม่ใช้ /Rotate) | 'rendered' (ใช้ /Rotate ปกติ)"""
    _ensure_ocr_engine()
    cands = []
    try:
        orig, had_rot = pdf_to_images_orig(pdf_bytes, dpi=200)
        if had_rot and orig:
            cands.append(("orig", orig[0]))
    except Exception as e:
        log.warning(f"[orient] render original failed: {e}")
    if rendered:
        cands.append(("rendered", rendered[0]))
    best = ("rendered", 0, -1, None)
    for src, img in cands:
        sc = _orient_score(img)
        log.info(f"[orient] {src}: score={sc}")
        if sc >= _ORIENT_MIN_SCORE:
            return (src, 0)
        if sc > best[2]:
            best = (src, 0, sc, img)
    # ยังอ่านไม่ได้ -> ลองหมุนเพิ่มจากตัวที่ดีที่สุด (ทางเลือกสุดท้าย)
    base_img = best[3]
    if base_img is not None:
        for rot in (90, 270, 180):
            sc = _orient_score(rotate_image(base_img, rot))
            log.info(f"[orient] {best[0]}+{rot}: score={sc}")
            if sc >= _ORIENT_MIN_SCORE:
                return (best[0], rot)
    return (best[0], 0)


def get_oriented_images(pdf_bytes: bytes, extra_rotation: int = 0):
    """แทน pdf_to_images + rotate_image เดิม -> (images, auto_rotation_info)"""
    rendered = pdf_to_images(pdf_bytes, dpi=200)
    if extra_rotation:  # ผู้ใช้สั่งหมุนเอง -> เคารพตามนั้น
        return [rotate_image(i, extra_rotation) for i in rendered], "user"
    key = _hashlib.md5(pdf_bytes).hexdigest()
    mode = _ORIENT_CACHE.get(key)
    if mode is None:
        mode = _decide_orientation(pdf_bytes, rendered)
        if len(_ORIENT_CACHE) > 100:
            _ORIENT_CACHE.clear()
        _ORIENT_CACHE[key] = mode
    src, rot = mode
    imgs = rendered
    if src == "orig":
        try:
            imgs, _ = pdf_to_images_orig(pdf_bytes, dpi=200)
        except Exception as e:
            log.warning(f"[orient] re-render original failed: {e}")
            imgs = rendered
    if rot:
        imgs = [rotate_image(i, rot) for i in imgs]
    log.info(f"[orient] use {src}" + (f" +{rot}°" if rot else ""))
    return imgs, f"{src}+{rot}"


# ── Profile AP09 (Input Tax Invoice): คอลัมน์ต่างจาก APN01 ──────────────────────
AP09_COL_NAMES = ["Branch", "Vendor Name", "Receive Date", "GRT No.", "Tax Invoice Date",
                  "Tax Invoice No.", "Description", "ยอดก่อนภาษี", "ยอดภาษี", "ยอดรวม"]
AP09_HEADER_KEYWORDS = {
    "Branch":           ["branch"],
    "Vendor Name":      ["vendor name", "vendor"],
    "Receive Date":     ["receive date"],
    "GRT No.":          ["grt no", "grt"],
    "Tax Invoice Date": ["tax invoice date"],
    "Tax Invoice No.":  ["tax invoice no"],
    "Description":      ["description", "desctiption", "descr"],
    "ยอดก่อนภาษี":      ["ยอดก่อน", "ก่อนภาษี"],
    "ยอดภาษี":          ["ยอดภาษี"],
    "ยอดรวม":           ["ยอดรวม"],
}
AP09_NUM_COLS = {"ยอดก่อนภาษี", "ยอดภาษี", "ยอดรวม"}
AP09_DATE_COLS = {"Receive Date", "Tax Invoice Date"}
# ตำแหน่งสำรอง (สัดส่วนความกว้างภาพ) วัดจากแผ่นจริง -- ใช้เมื่อหาหัวคอลัมน์ไม่ครบ >=3 คอลัมน์
AP09_DEFAULT_DEFS = [
    {"name": "Branch",           "x_start": 0.00,  "x_end": 0.12},
    {"name": "Vendor Name",      "x_start": 0.12,  "x_end": 0.307},
    {"name": "Receive Date",     "x_start": 0.307, "x_end": 0.369},
    {"name": "GRT No.",          "x_start": 0.369, "x_end": 0.42},
    {"name": "Tax Invoice Date", "x_start": 0.42,  "x_end": 0.49},
    {"name": "Tax Invoice No.",  "x_start": 0.49,  "x_end": 0.583},
    {"name": "Description",      "x_start": 0.583, "x_end": 0.75},
    {"name": "ยอดก่อนภาษี",      "x_start": 0.75,  "x_end": 0.81},
    {"name": "ยอดภาษี",          "x_start": 0.81,  "x_end": 0.866},
    {"name": "ยอดรวม",           "x_start": 0.866, "x_end": 1.00},
]


def detect_profile(items: list, meta: dict, prev: str = "APN") -> str:
    """เลือก Profile คอลัมน์: 'AP09' หรือ 'APN' (APN01/AP07/TRANS/IMP เดิม) -- หน้าต่อ (ไม่มีหัว) สืบทอดจากหน้าก่อน"""
    dt = str((meta or {}).get("doc_type", "")).strip().upper()
    if dt == "AP09":
        return "AP09"
    if dt in SUPPORTED_DOC_TYPES:
        return "APN"
    txt = " ".join(i["text"] for i in items).lower()
    if "grt no" in txt and "tax invoice no" in txt:
        return "AP09"
    if "gr transaction" in txt and "invoice number" in txt:
        return "APN"
    return prev


def profile_kwargs(profile: str) -> dict:
    if profile == "AP09":
        return dict(col_names=AP09_COL_NAMES, header_keywords=AP09_HEADER_KEYWORDS,
                    num_cols=AP09_NUM_COLS, date_cols=AP09_DATE_COLS, default_defs=AP09_DEFAULT_DEFS)
    return dict(col_names=COL_NAMES, header_keywords=HEADER_KEYWORDS,
                num_cols=NUM_COLS, date_cols={"Receive Date"}, default_defs=None)


# MARKER_DOCENTER_SINGLE_PASS_V1
# ── อ่านแบบ "หยุดที่ 35% ก่อน ถ้าไม่เจอค่อยอ่านต่อเฉพาะส่วนที่เหลือ" ────────────────────────────────
# Lightweight อ่านแถบบน 35% -> (Node) จับคู่ Serial/Invoice/GRT/ยอด -> เจอ = แนบเลย ไม่ต้องอ่านต่อ
# ไม่เจอ -> Full OCR (/ocr) ใช้ผลแถบบนที่เก็บไว้ + อ่านเฉพาะแถบล่างที่เหลือ (ไม่อ่านส่วนบนซ้ำ)
# ข้อความที่ถูกเส้น 35% ตัดกลางบรรทัดจะไม่ถูกเก็บจากแถบบน แต่ให้แถบล่างเริ่มอ่านจากบรรทัดนั้นแทน
_STRIP_CACHE = {}   # page_key -> {"top_items": [...], "split_y": int, "size": (w, h)}


def _page_key(img):
    return (img.size, _hashlib.md5(img.tobytes()).hexdigest())


def _split_top_items(items: list, cut_y: float):
    """แยกผลอ่านแถบบน: (kept, split_y) -- kept = บรรทัดที่อยู่ในแถบทั้งบรรทัด, split_y = จุดเริ่มอ่านแถบล่าง"""
    kept, cut = [], []
    for it in items:
        (cut if it["y2"] >= cut_y - 3 else kept).append(it)
    split_y = min([it["y1"] for it in cut], default=cut_y)
    split_y = int(max(0, min(split_y, cut_y)))
    return kept, split_y


def remember_top_strip(img, items: list, cut_y: float):
    try:
        kept, split_y = _split_top_items(items, cut_y)
        if len(_STRIP_CACHE) >= 60:
            _STRIP_CACHE.pop(next(iter(_STRIP_CACHE)))
        _STRIP_CACHE[_page_key(img)] = {"top_items": kept, "split_y": split_y, "size": img.size}
    except Exception as e:
        log.warning(f"[strip] remember failed: {e}")


def merge_bottom_items(top_items: list, bottom_items: list, offset_y: int, split_y: int) -> list:
    """เอาผลแถบล่าง (พิกัดสัมพัทธ์ตามแถบ) ย้ายเป็นพิกัดทั้งหน้า + ตัดรายการที่ซ้ำกับแถบบน"""
    out = list(top_items)
    for it in bottom_items:
        y1 = it["y1"] + offset_y
        if y1 < split_y - 1:   # อยู่ในส่วนที่แถบบนอ่านไปแล้ว
            continue
        n = dict(it)
        n["y1"] = y1
        n["y2"] = it["y2"] + offset_y
        n["cy"] = it["cy"] + offset_y
        out.append(n)
    return out


def ocr_page_items_progressive(img) -> list:
    """OCR หน้านี้: ถ้า Lightweight เคยอ่านแถบบนไว้ -> อ่านเฉพาะแถบล่างที่เหลือ; ไม่เคย -> อ่านทั้งหน้า (เหมือนเดิม)"""
    c = _STRIP_CACHE.get(_page_key(img))
    if not c:
        return ocr_image_full(img)
    w, h = img.size
    off = max(0, c["split_y"] - 4)
    bottom_img = img.crop((0, off, w, h))
    bottom = ocr_image_full(bottom_img)
    log.info(f"[strip] reuse top strip ({len(c['top_items'])} items) + OCR bottom from y={off}")
    return merge_bottom_items(c["top_items"], bottom, off, c["split_y"])


def parse_grid_from_items(items: list, h_lines, v_lines, img_w: int, img_h: int, col_names: list,
                          header_keywords=None, num_cols=None, date_cols=None):
    """จัดข้อความที่ OCR ทั้งหน้าไว้แล้วเข้าเซลล์ตามตำแหน่ง (ไม่ OCR ทีละเซลล์ซ้ำ) -- ไม่สำเร็จคืน None ให้ใช้วิธีเดิม"""
    import bisect
    header_keywords = header_keywords or HEADER_KEYWORDS
    num_cols = num_cols if num_cols is not None else NUM_COLS
    date_cols = date_cols if date_cols is not None else {"Receive Date"}
    ys = sorted(set([0] + list(h_lines) + [img_h]))
    xs = sorted(set([0] + list(v_lines) + [img_w]))
    if len(ys) < 3 or len(xs) < 3 or not items:
        return None
    nR, nC = len(ys) - 1, len(xs) - 1
    cells = {}
    for it in items:
        ri = bisect.bisect_right(ys, it["cy"]) - 1
        ci = bisect.bisect_right(xs, it["cx"]) - 1
        if 0 <= ri < nR and 0 <= ci < nC:
            cells.setdefault((ri, ci), []).append(it)

    def cell_text(ri, ci):
        lst = sorted(cells.get((ri, ci), []), key=lambda i: (round(i["cy"] / 8), i["cx"]))
        return " ".join(i["text"] for i in lst).strip()

    header_row_idx, col_map = None, {}
    for ri in range(nR):
        if ys[ri + 1] - ys[ri] < 5:
            continue
        texts = [cell_text(ri, ci) for ci in range(nC)]
        combined = " " + " ".join(t.lower() for t in texts)
        matched = sum(1 for kws in header_keywords.values() if any(kw in combined for kw in kws))
        if matched >= 3:
            header_row_idx = ri
            for ci, t in enumerate(texts):
                tl = t.lower()
                for col_name, keywords in header_keywords.items():
                    if any(kw in tl for kw in keywords):
                        col_map[ci] = col_name
                        break
                else:
                    col_map[ci] = col_names[ci] if ci < len(col_names) else f"col_{ci}"
            break
    if header_row_idx is None:
        return None   # หาแถวหัวตารางไม่เจอ -> ให้วิธีเดิม (OCR ทีละเซลล์/Map ตามลำดับ) จัดการ

    rows = []
    for ri in range(header_row_idx + 1, nR):
        if ys[ri + 1] - ys[ri] < 8:
            continue
        record, has_data = {}, False
        for ci in range(nC):
            col_name = col_map.get(ci, f"col_{ci}")
            text = cell_text(ri, ci)
            if text and text not in ["-", "—", ""]:
                has_data = True
                if col_name in num_cols:
                    text = clean_number(text) if is_number(text.replace(",", "")) else text
                elif col_name in date_cols:
                    text = parse_date(text) if text else ""
            record[col_name] = text
        if has_data:
            rows.append(record)
    return rows or None


def parse_rows_by_profile(cv_img, items, img_width, h_lines, v_lines, profile: str, header_cy: float = 0):
    kw = profile_kwargs(profile)
    if len(h_lines) >= 3 and len(v_lines) >= 3:
        # MARKER_DOCENTER_SINGLE_PASS_V1 -- ใช้ผล OCR ทั้งหน้าที่มีอยู่แล้ว จัดเข้าเซลล์ตามตำแหน่งก่อน (เร็วกว่าหลายเท่า)
        # ถ้าไม่สำเร็จ (หาหัวตารางไม่เจอ/ไม่ได้แถว) ค่อยถอยไป OCR ทีละเซลล์แบบเดิม
        _fast = parse_grid_from_items(items, h_lines, v_lines, cv_img.shape[1], cv_img.shape[0], kw["col_names"],
                                      header_keywords=kw["header_keywords"], num_cols=kw["num_cols"],
                                      date_cols=kw["date_cols"])
        if _fast:
            return _fast
        return parse_with_grid(cv_img, h_lines, v_lines, kw["col_names"],
                               header_keywords=kw["header_keywords"], num_cols=kw["num_cols"],
                               date_cols=kw["date_cols"])
    return parse_with_ocr_fallback(items, img_width, header_cy,
                                   header_keywords=kw["header_keywords"], num_cols=kw["num_cols"],
                                   date_cols=kw["date_cols"], default_defs=kw["default_defs"])


def is_number(text: str) -> bool:
    return bool(re.match(r"^[\d,]+(\.\d+)?$", text.strip()))


def clean_number(text: str) -> str:
    text = text.strip().replace(",", "")
    try:
        val = float(text)
        return f"{val:,.2f}" if val != int(val) else f"{int(val):,}"
    except Exception:
        return text


def parse_date(text: str) -> str:
    months = {"jan":"Jan","feb":"Feb","mar":"Mar","apr":"Apr","may":"May","jun":"Jun",
              "jul":"Jul","aug":"Aug","sep":"Sep","oct":"Oct","nov":"Nov","dec":"Dec"}
    m = re.match(r"(\d{1,2})[-/]([A-Za-z]+)[-/](\d{2,4})", text.strip())
    if m:
        d, mon, y = m.group(1), m.group(2), m.group(3)
        return f"{d.zfill(2)}-{months.get(mon.lower()[:3], mon[:3].capitalize())}-{y[-2:]}"
    return text.strip()


def detect_lines(gray, axis: str):
    """detect H หรือ V lines
    V lines: ต้องยาวครอบคลุมตาราง (threshold สูง) เพื่อกรองเส้นสั้นเช่น กรอบลายเซ็น
    """
    h, w = gray.shape
    _, thresh = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
    best = []

    if axis == 'h':
        min_lens = [5, 8, 10, 15, 20]
        pcts = [0.05, 0.1, 0.15, 0.2]
    else:
        # V lines: min_len ใหญ่กว่า + threshold สูงกว่า = กรองเส้นสั้นออก
        min_lens = [2, 3, 4]   # เส้นต้องยาวอย่างน้อย h/2, h/3, h/4
        pcts = [0.3, 0.4, 0.5] # threshold สูง กรองเส้นสั้นออก

    for min_len in min_lens:
        for pct in pcts:
            if axis == 'h':
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (w // min_len, 1))
                lines_img = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
                sums = np.sum(lines_img, axis=1)
                threshold = w * pct * 255
                positions = [i for i in range(h) if sums[i] > threshold]
                gap = 5
            else:
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, h // min_len))
                lines_img = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
                sums = np.sum(lines_img, axis=0)
                threshold = h * pct * 255
                positions = [i for i in range(w) if sums[i] > threshold]
                gap = 10
            if not positions:
                continue
            groups = []
            g = [positions[0]]
            for p in positions[1:]:
                if p - g[-1] < gap: g.append(p)
                else:
                    groups.append(int(np.mean(g))); g = [p]
            groups.append(int(np.mean(g)))
            if len(groups) > len(best):
                best = groups
    return best


def ocr_cell(cell_img):
    """OCR cell เดี่ยว → text"""
    if cell_img is None or cell_img.size == 0:
        return ""
    h, w = cell_img.shape[:2]
    if h < 5 or w < 5:
        return ""
    padded = cv2.copyMakeBorder(cell_img, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
    # PaddleOCR ต้องการ RGB 3 channels
    if len(padded.shape) == 2:
        padded = cv2.cvtColor(padded, cv2.COLOR_GRAY2RGB)
    result = ocr_engine.ocr(padded)
    if not result or not result[0]:
        return ""
    ocr_res = result[0]
    if hasattr(ocr_res, "__getitem__") and "rec_texts" in ocr_res:
        return " ".join(str(t) for t in ocr_res["rec_texts"]).strip()
    if isinstance(ocr_res, list):
        texts = []
        for line in ocr_res:
            try:
                rest = line[1]
                texts.append(str(rest[0]) if isinstance(rest, (list, tuple)) else str(rest))
            except Exception:
                pass
        return " ".join(texts).strip()
    return ""


def ocr_image_full(image):
    """OCR ทั้งภาพ → list of items"""
    img_array = np.array(image)
    result = ocr_engine.ocr(img_array)
    items = []
    if not result:
        return items
    ocr_res = result[0]
    if hasattr(ocr_res, "__getitem__") and "rec_texts" in ocr_res:
        scores = ocr_res.get("rec_scores", [1.0] * len(ocr_res["rec_texts"]))
        for text, poly, conf in zip(ocr_res["rec_texts"], ocr_res["rec_polys"], scores):
            try:
                xs = [float(p[0]) for p in poly]
                ys = [float(p[1]) for p in poly]
                x1, x2 = min(xs), max(xs)
                y1, y2 = min(ys), max(ys)
                items.append({
                    "text": str(text).strip(),
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "cx": (x1+x2)/2, "cy": (y1+y2)/2,
                    "conf": round(float(conf), 3),
                })
            except Exception:
                continue
    return items


def group_rows(items: list, y_tolerance: int = 8) -> list:
    if not items:
        return []
    sorted_items = sorted(items, key=lambda x: x["cy"])
    rows, current = [], [sorted_items[0]]
    for item in sorted_items[1:]:
        if abs(item["cy"] - current[-1]["cy"]) <= y_tolerance:
            current.append(item)
        else:
            rows.append(sorted(current, key=lambda x: x["cx"]))
            current = [item]
    rows.append(sorted(current, key=lambda x: x["cx"]))
    return rows


def parse_metadata(items: list) -> dict:
    meta = {}
    rows = group_rows(items)
    for row in rows[:20]:
        text = " ".join(i["text"] for i in row).strip()
        text_lower = text.lower()
        for key, field in META_KEYS.items():
            if key in text_lower and field not in meta:
                parts = re.split(r"[:：]", text, maxsplit=1)
                if len(parts) > 1:
                    value = parts[1].strip()
                    if field == "bu_code":
                        # "0568 - MP Synergy Co.,Ltd." → bu_code = "0568 - MP Synergy Co.,Ltd." เก็บเต็ม
                        # แต่แยก bu_short ออกด้วย
                        meta["bu_code"] = value  # เก็บเต็ม เช่น "0568 - MP Synergy Co.,Ltd."
                        m = re.match(r"^(\S+)\s*[-–]\s*(.+)$", value)
                        if m:
                            meta["bu_short"] = m.group(1).strip()   # "0568"
                            meta["bu_name_ocr"] = m.group(2).strip() # "MP Synergy Co.,Ltd."
                    elif field == "bu_name":
                        meta["bu_name"] = value  # ชื่อผู้ประกอบการ ภาษาไทย
                    else:
                        if field == "receive_date":
                            # ดึงเฉพาะ date แรกที่เจอ กัน duplicate
                            dm = re.search(r"(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})", value)
                            meta[field] = parse_date(dm.group(1)) if dm else value
                        else:
                            meta[field] = value

    # MARKER_DOCENTER_SERIALCODE_METADATA_V1 -- Serial Code (E4/F4 จาก excelReport.js) ไม่มี ':' คั่น
    # ระหว่าง Label กับ Value เพราะเป็นคนละ Cell -- ต้องจับตำแหน่ง (Label ซ้าย -> Value ที่อยู่ติดกัน
    # ทางขวาในแถวเดียวกัน) แทนการ split ด้วย colon เหมือน META_KEYS ด้านบน
    # รองรับ 2 กรณี: (1) Label/Value แยก OCR Box กัน -- เอา Box ถัดไปในแถวเดียวกัน
    #                (2) PaddleOCR อ่านรวม Label+Value เป็น Box เดียว -- ตัด Label ออกแล้วเอาสว่ นที่เหลือ
    for row in rows[:20]:
        for idx, it in enumerate(row):
            t = it["text"].strip()
            if "serial code" in t.lower() and "serial_code" not in meta:
                after = re.split(r"serial\s*code", t, maxsplit=1, flags=re.IGNORECASE)[-1].strip()
                if after:
                    meta["serial_code"] = after
                elif idx + 1 < len(row):
                    meta["serial_code"] = row[idx + 1]["text"].strip()
                break
    return meta


def parse_with_grid(cv_img, h_lines, v_lines, col_names: list,
                    header_keywords=None, num_cols=None, date_cols=None) -> list:
    """crop + OCR ทีละ cell"""
    header_keywords = header_keywords or HEADER_KEYWORDS  # MARKER_DOCENTER_AUTO_ORIENT_V1
    num_cols = num_cols if num_cols is not None else NUM_COLS
    date_cols = date_cols if date_cols is not None else {"Receive Date"}
    h, w = cv_img.shape[:2]
    gray = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
    ys = sorted(set([0] + h_lines + [h]))
    xs = sorted(set([0] + v_lines + [w]))
    if len(ys) < 3 or len(xs) < 3:
        return []

    header_row_idx = None
    col_map = {}

    for ri in range(len(ys) - 1):
        y1, y2 = ys[ri], ys[ri+1]
        if y2 - y1 < 5:
            continue
        row_text_combined = ""
        cell_texts = []
        for ci in range(len(xs) - 1):
            x1, x2 = xs[ci], xs[ci+1]
            cell = gray[y1:y2, x1:x2]
            t = ocr_cell(cell)
            cell_texts.append(t)
            row_text_combined += " " + t.lower()
        matched = sum(1 for kws in header_keywords.values() if any(kw in row_text_combined for kw in kws))
        if matched >= 3:
            header_row_idx = ri
            for ci, t in enumerate(cell_texts):
                t_lower = t.lower()
                for col_name, keywords in header_keywords.items():
                    if any(kw in t_lower for kw in keywords):
                        col_map[ci] = col_name
                        break
                else:
                    col_map[ci] = col_names[ci] if ci < len(col_names) else f"col_{ci}"
            break

    if header_row_idx is None:
        log.warning("Header row not found in grid — mapping by index")
        for ci in range(min(len(xs)-1, len(col_names))):
            col_map[ci] = col_names[ci]
        header_row_idx = 0

    rows = []
    for ri in range(header_row_idx + 1, len(ys) - 1):
        y1, y2 = ys[ri], ys[ri+1]
        if y2 - y1 < 8:
            continue
        record = {}
        has_data = False
        for ci in range(len(xs) - 1):
            col_name = col_map.get(ci, f"col_{ci}")
            x1, x2 = xs[ci], xs[ci+1]
            cell = gray[y1:y2, x1:x2]
            text = ocr_cell(cell).strip()
            if text and text not in ["-", "—", ""]:
                has_data = True
                if col_name in num_cols:
                    text = clean_number(text) if is_number(text.replace(",", "")) else text
                elif col_name in date_cols:
                    text = parse_date(text) if text else ""
            record[col_name] = text
        if has_data:
            rows.append(record)
    return rows


def parse_with_ocr_fallback(items: list, img_width: int, header_cy: float,
                            header_keywords=None, num_cols=None, date_cols=None, default_defs=None) -> list:
    """Fallback OCR mode"""
    header_keywords = header_keywords or HEADER_KEYWORDS  # MARKER_DOCENTER_AUTO_ORIENT_V1
    num_cols = num_cols if num_cols is not None else NUM_COLS
    date_cols = date_cols if date_cols is not None else {"Receive Date"}
    col_cx = {}
    for item in items:
        t = item["text"].lower().strip()
        for col_name, keywords in header_keywords.items():
            if any(kw in t for kw in keywords) and col_name not in col_cx:
                col_cx[col_name] = item["cx"] / img_width

    if len(col_cx) >= 3:
        found_cols = sorted(col_cx.items(), key=lambda x: x[1])
        col_defs = []
        for i, (name, cx) in enumerate(found_cols):
            x_start = max(0.0, cx - 0.04) if i == 0 else (found_cols[i-1][1] + cx) / 2
            x_end = 1.0 if i == len(found_cols)-1 else (cx + found_cols[i+1][1]) / 2
            col_defs.append({"name": name, "x_start": round(x_start, 3), "x_end": round(min(1.0, x_end), 3)})
    elif default_defs:
        col_defs = default_defs
    else:
        col_defs = [
            {"name": "Branch",             "x_start": 0.00, "x_end": 0.06},
            {"name": "Vendor Name",        "x_start": 0.06, "x_end": 0.23},
            {"name": "GR Transaction No.", "x_start": 0.23, "x_end": 0.30},
            {"name": "Invoice Number",     "x_start": 0.30, "x_end": 0.41},
            {"name": "Receive Date",       "x_start": 0.41, "x_end": 0.46},
            {"name": "รายการ",             "x_start": 0.46, "x_end": 0.63},
            {"name": "มูลค่าก่อนภาษี",    "x_start": 0.63, "x_end": 0.71},
            {"name": "มูลค่าภาษี",        "x_start": 0.71, "x_end": 0.77},
            {"name": "มูลค่ารวม",         "x_start": 0.77, "x_end": 0.82},
            {"name": "Batch Name",         "x_start": 0.82, "x_end": 0.95},
            {"name": "Payment Doc",        "x_start": 0.95, "x_end": 1.00},
        ]

    ocr_rows = group_rows(items)
    rows = []
    for row in ocr_rows:
        if not row or row[0]["cy"] <= header_cy:
            continue
        full_text = " ".join(i["text"] for i in row).lower()
        if any(kw in full_text for kw in SKIP_KEYWORDS):
            continue
        if not any(is_number(i["text"].replace(",", "")) for i in row):
            continue
        record = {col["name"]: "" for col in col_defs}
        for item in row:
            cx_norm = item["cx"] / img_width
            for col in col_defs:
                if col["x_start"] <= cx_norm < col["x_end"]:
                    text = item["text"].strip()
                    if col["name"] in num_cols:
                        text = clean_number(text) if is_number(text.replace(",", "")) else text
                    elif col["name"] in date_cols:
                        text = parse_date(text) if text else ""
                    record[col["name"]] = (record[col["name"]] + " " + text).strip() if record[col["name"]] else text
                    break
        if sum(1 for v in record.values() if v.strip()) >= 2:
            rows.append(record)
    return rows



def image_to_base64(image, dpi_scale: float = 0.5, quality: int = 60) -> str:
    """แปลง PIL image → base64 JPEG ขนาดเล็ก สำหรับ preview"""
    import base64, io
    # resize ลง
    w, h = image.size
    new_w = int(w * dpi_scale)
    new_h = int(h * dpi_scale)
    img_small = image.resize((new_w, new_h))
    # compress
    buf = io.BytesIO()
    img_small.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("utf-8")

def try_ocr_with_rotation(images_hires, images_ocr, extra_rot: int) -> dict:
    """OCR ด้วย rotation เพิ่มเติม → return metadata + rows"""
    all_metadata = {}
    all_rows = []
    all_items_per_page = []

    for page_idx in range(len(images_hires)):
        img_hires = rotate_image(images_hires[page_idx], extra_rot)
        img_ocr   = rotate_image(images_ocr[page_idx],   extra_rot)
        cv_hires  = np.array(img_hires)
        img_width, _ = img_ocr.size

        items = ocr_image_full(img_ocr)
        all_items_per_page.append(items)
        if page_idx == 0:
            all_metadata = parse_metadata(items)

        gray_hires = cv2.cvtColor(cv_hires, cv2.COLOR_RGB2GRAY)
        h_lines = detect_lines(gray_hires, 'h')
        v_lines = detect_lines(gray_hires, 'v')

        if len(h_lines) >= 3 and len(v_lines) >= 3:
            data_rows = parse_with_grid(cv_hires, h_lines, v_lines, COL_NAMES)
        else:
            header_cy = 0
            for item in items:
                if any(kw in item["text"].lower() for kw in ["branch", "vendor name"]):
                    header_cy = max(header_cy, item["cy"])
            data_rows = parse_with_ocr_fallback(items, img_width, header_cy)

        all_rows.extend(data_rows)

    return {
        "metadata": all_metadata,
        "rows": all_rows,
        "items_per_page": all_items_per_page,
    }


def metadata_is_valid(metadata: dict) -> bool:
    """เช็คว่า metadata มีข้อมูลพอ — ต้องมีทั้ง doc_type และ bu_code"""
    doc_type = metadata.get("doc_type", "").strip().upper()
    has_doc_type = doc_type in SUPPORTED_DOC_TYPES
    has_bu = bool(metadata.get("bu_code", "").strip())
    return has_doc_type and has_bu



def parse_metadata_from_text(ocr_text: str, existing: dict) -> dict:
    """Fallback: parse metadata จาก raw ocr_text string เมื่อ parse จาก items ไม่ได้"""
    meta = dict(existing)
    text = ocr_text

    # doc_type
    if "doc_type" not in meta or meta["doc_type"] not in SUPPORTED_DOC_TYPES:
        for dt in SUPPORTED_DOC_TYPES:
            if dt in text.upper():
                meta["doc_type"] = dt
                break

    # bu_code — หา pattern "0568" หรือ "0568 - MP Synergy"
    if not meta.get("bu_code"):
        m = re.search(r"bu\s*code[\s:：]+([\w\s\-]+?)(?:\s{2,}|\n|$)", text, re.IGNORECASE)
        if m:
            value = m.group(1).strip()
            meta["bu_code"] = value
            mm = re.match(r"^(\S+)\s*[-–]\s*(.+)$", value)
            if mm:
                meta["bu_short"]    = mm.group(1).strip()
                meta["bu_name_ocr"] = mm.group(2).strip()
        else:
            # ลอง match ตัวเลข 4 หลักที่น่าจะเป็น bu code
            m2 = re.search(r"\b(\d{4})\s*[-–]\s*([A-Za-z][^\n]{3,40})", text)
            if m2:
                meta["bu_short"]    = m2.group(1).strip()
                meta["bu_name_ocr"] = m2.group(2).strip()
                meta["bu_code"]     = m2.group(1) + " - " + m2.group(2)

    # receive_date
    if not meta.get("receive_date"):
        m = re.search(r"receive\s*date[\s:：]+(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})", text, re.IGNORECASE)
        if m:
            meta["receive_date"] = parse_date(m.group(1))
        else:
            # หา date pattern ทั่วไป
            m2 = re.search(r"\b(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})\b", text)
            if m2:
                meta["receive_date"] = parse_date(m2.group(1))

    # bu_name (ชื่อไทย)
    if not meta.get("bu_name"):
        m = re.search(r"ชื่อผู้ประกอบการ[\s:：]+([^\n]+)", text)
        if m:
            meta["bu_name"] = m.group(1).strip()

    log.info(f"Fallback metadata: doc_type={meta.get('doc_type')} bu_short={meta.get('bu_short')} receive_date={meta.get('receive_date')}")
    return meta

# MARKER_DOCENTER_WARMUP_V1 -- Lock กัน /warmup กับ Request จริงโหลดโมเดลซ้อนกัน (ไม่ Thread-safe)
import threading as _threading
_ocr_load_lock = _threading.Lock()


def _ensure_ocr_engine():
    """Lazy Load PaddleOCR -- โหลดเฉพาะตอนมีงานจริง (ไม่โหลดตอน Server Start)"""
    global ocr_engine
    if ocr_engine is None:
        with _ocr_load_lock:
            if ocr_engine is None:
                log.info("Loading PaddleOCR model (Lazy Load -- Request แรกหลัง Start/Idle)...")
                from paddleocr import PaddleOCR
                ocr_engine = PaddleOCR(use_textline_orientation=True, lang="th")
                log.info("PaddleOCR model loaded ✓")


def run_ocr_sync(pdf_bytes: bytes, filename: str, extra_rotation: int = 0) -> dict:
    _ensure_ocr_engine()
    # ── Convert PDF ครั้งเดียว DPI 200 ────────────────────────────────────
    # MARKER_DOCENTER_AUTO_ORIENT_V1 -- ใช้ภาพต้นฉบับ/Auto-Orient แทนการ Render ตาม /Rotate ตรงๆ
    images, _auto_rot = get_oriented_images(pdf_bytes, extra_rotation)
    log.info(f"PDF converted: {len(images)} page(s) orient={_auto_rot}" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
    _profile = "APN"

    all_metadata = {}
    all_rows = []
    all_items_per_page = []

    for page_idx, img in enumerate(images):
        cv_img    = np.array(img)
        img_width = img.size[0]

        items = ocr_page_items_progressive(img)  # MARKER_DOCENTER_SINGLE_PASS_V1
        all_items_per_page.append(items)

        if page_idx == 0:
            all_metadata = parse_metadata(items)
        _profile = detect_profile(items, all_metadata if page_idx == 0 else parse_metadata(items), _profile)

        gray    = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
        h_lines = detect_lines(gray, 'h')
        v_lines = detect_lines(gray, 'v')
        log.info(f"Page {page_idx+1}: {len(h_lines)} H-lines, {len(v_lines)} V-lines profile={_profile}")

        header_cy = 0
        for item in items:
            if any(kw in item["text"].lower() for kw in ["branch", "vendor name"]):
                header_cy = max(header_cy, item["cy"])
        if not (len(h_lines) >= 3 and len(v_lines) >= 3):
            log.info("Fallback OCR mode")
        data_rows = parse_rows_by_profile(cv_img, items, img_width, h_lines, v_lines, _profile, header_cy)

        all_rows.extend(data_rows)

    raw_type = str(all_metadata.get("doc_type", "")).strip().upper()
    doc_type = raw_type if raw_type in SUPPORTED_DOC_TYPES else "APN01"
    all_metadata["doc_type"] = doc_type

    all_ocr_text = " ".join(
        item["text"]
        for items_page in all_items_per_page
        for item in items_page
    )

    # ── Fallback: parse metadata จาก raw ocr_text ถ้ายังขาด field ──────────
    if not metadata_is_valid(all_metadata):
        all_metadata = parse_metadata_from_text(all_ocr_text, all_metadata)
        raw_type = str(all_metadata.get("doc_type", "")).strip().upper()
        doc_type = raw_type if raw_type in SUPPORTED_DOC_TYPES else "APN01"
        all_metadata["doc_type"] = doc_type

    import base64, io
    pdf_image_b64 = ""
    if images:
        first = images[0]
        w, h  = first.size
        img_small = first.resize((w // 2, h // 2))
        buf = io.BytesIO()
        img_small.convert("RGB").save(buf, format="JPEG", quality=55, optimize=True)
        pdf_image_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        log.info(f"PDF preview image: {len(buf.getvalue())//1024} KB")

    return {
        "success":     True,
        "serial_code": Path(filename).stem,
        "file_name":   filename,
        "doc_type":    doc_type,
        "metadata":    all_metadata,
        "rows":        all_rows,
        "total_rows":  len(all_rows),
        "pages":       len(images),
        "auto_orient": _auto_rot,
        "ocr_text":    all_ocr_text,
        "pdf_image":   pdf_image_b64,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": ocr_engine is not None}


# MARKER_DOCENTER_WARMUP_V1 -- Browser เรียกทันทีที่มีไฟล์เข้ามา: โหลดโมเดลล่วงหน้า (ตอบกลับทันที โหลดทำเบื้องหลัง)
@app.post("/warmup")
async def warmup():
    global _last_request_time
    _last_request_time = time.time()  # กัน Idle Watchdog ปิดกลางทาง
    if ocr_engine is not None:
        return {"status": "ready"}
    loop = asyncio.get_event_loop()

    def _load():
        global _last_request_time
        try:
            _ensure_ocr_engine()
        except Exception as e:
            log.error(f"[warmup] failed: {e}")
        finally:
            _last_request_time = time.time()

    loop.run_in_executor(None, _load)
    return {"status": "loading"}


@app.post("/ocr")
async def ocr_pdf(file: UploadFile = File(...), rotation: int = 0):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="รับเฉพาะไฟล์ PDF เท่านั้น")
    global _last_request_time
    _last_request_time = time.time()  # reset idle timer
    log.info(f"OCR request: {file.filename} (rotation={rotation}°)")
    pdf_bytes = await file.read()
    if len(pdf_bytes) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="ไฟล์ใหญ่เกิน 30MB")

    try:
        # CPU Governor: ขยาย affinity ถ้า CPU ว่าง กันไม่ให้ service อื่นดับ
        def _set_ocr_affinity():
            try:
                p = psutil.Process(os.getpid())
                cpu_total = psutil.cpu_percent(interval=0.5)
                if cpu_total < 70:
                    p.cpu_affinity([0, 1, 2])  # CPU ว่าง → ใช้ 3 Core
                    log.info(f"[governor] CPU {cpu_total:.0f}% → affinity Core 0+1+2")
                else:
                    p.cpu_affinity([0, 1])  # CPU ไม่ว่าง → ใช้ 2 Core เดิม
                    log.info(f"[governor] CPU {cpu_total:.0f}% → affinity Core 0+1 (conservative)")
            except Exception as e:
                log.warning(f"[governor] set affinity failed: {e}")
        def _reset_ocr_affinity():
            try:
                psutil.Process(os.getpid()).cpu_affinity([0, 1])
            except Exception:
                pass
        # MARKER_DOCENTER_OCR_LOCK_WIRE_UP_V1
        # -- ต่อสาย Lock ที่มีอยู่แล้ว (system_ocr_queue) เข้ากับ Endpoint จริง --
        # -- ก่อนหน้านี้ AP OCR (ocr_worker_v2.py) รอ Lock ตัวนี้อยู่แล้ว แต่ --
        # -- Document Center ไม่เคยขอ Lock เลย เลยไม่มีใครให้ AP OCR รอจริง --
        loop = asyncio.get_event_loop()
        lock_id = f"{file.filename}_{int(time.time())}"
        await loop.run_in_executor(None, _wait_for_ocr_lock, lock_id)
        try:
            # Semaphore: PaddleOCR not thread-safe -- 1 request at a time
            async with ocr_semaphore:
                def _run_full():
                    with cpu_governor():  # MARKER_DOCENTER_CPU_GOVERNOR_V2
                        return run_ocr_sync(pdf_bytes, file.filename, rotation)
                result = await loop.run_in_executor(None, _run_full)
        finally:
            await loop.run_in_executor(None, _release_ocr_lock, lock_id)
        log.info(f"OCR done: {file.filename} -> {result['total_rows']} rows, {result['pages']} pages")
        return result
    except Exception as e:
        log.error(f"OCR error: {file.filename} -> {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))



# MARKER_DOCENTER_OCR_LIGHTWEIGHT_V1
# ── Phase 2: Header-Crop OCR แบบเบา -- Crop ก่อน OCR (ไม่ใช่ OCR เต็มแล้ว ──
# ── มา Filter ทีหลังแบบ parse_metadata เดิม) เร็วกว่าเพราะ PaddleOCR ──────
# ── ประมวลผลแค่บางส่วนของภาพ ใช้เช็คว่าเอกสารนี้มีอยู่ใน doc_collection ──
# ── แล้วหรือยัง ก่อนตัดสินใจว่าจะยิง Full OCR (/ocr) หรือไม่ ──────────────
DOCENTER_LIGHTWEIGHT_TOP_PCT = 0.35  # Confirm แล้ว (30-35%)


def run_ocr_lightweight_sync(pdf_bytes: bytes, filename: str, extra_rotation: int = 0,
                              on_start=None, on_page=None, full: bool = False) -> dict:
    # MARKER_DOCENTER_LIGHTWEIGHT_STREAMING_V1 -- เพิ่ม on_start/on_page callback ให้ฝั่ง async endpoint
    # เรียกกลับได้ทีละหน้า (ผ่าน Queue) เพื่อ Stream ผลออกไปแบบ Real-time
    # โดยไม่กระทบ Logic การ OCR เดิมแม้แต่น้อย (ยังรันแบบ Sync ในเธรดเดียวเหมือนเดิม)
    _ensure_ocr_engine()
    # MARKER_DOCENTER_AUTO_ORIENT_V1
    images, _auto_rot = get_oriented_images(pdf_bytes, extra_rotation)
    log.info(f"[lightweight] PDF converted: {len(images)} page(s) orient={_auto_rot}" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
    _profile = "APN"

    if on_start:
        on_start(len(images))

    page_signals = []

    for page_idx, img in enumerate(images):
        w, h = img.size
        # MARKER_DOCENTER_ONEPASS_V1 -- full=True: อ่านเต็มหน้ารอบเดียว (หัว+ตาราง) ส่ง rows/meta/ocr_text ออกไปพร้อม Signal
        # Node ใช้ผลชุดเดียวกันทั้ง Match และบันทึก ไม่ต้องยิง /ocr ซ้ำ  (full=False = พฤติกรรมเดิมทุกประการ)
        if full:
            top_crop = img
            cv_top = np.array(img)
            crop_width = w
            items = ocr_page_items_progressive(img)
        else:
            top_crop = img.crop((0, 0, w, int(h * DOCENTER_LIGHTWEIGHT_TOP_PCT)))
            cv_top = np.array(top_crop)
            crop_width = top_crop.size[0]

            items = ocr_image_full(top_crop)
            remember_top_strip(img, items, top_crop.size[1])  # MARKER_DOCENTER_SINGLE_PASS_V1 -- เก็บผลแถบบนไว้ให้ Full OCR ใช้ต่อ

        # MARKER_DOCENTER_LIGHTWEIGHT_PERPAGE_DOCTYPE_V1
        # ── ตรวจ doc_type "ทุกหน้า" ไม่ใช่แค่หน้าแรก -- 1 PDF อาจมีหลาย ──
        # ── Doc Type ปนกันได้ (Confirm แล้ว) -- หน้าที่ไม่มี Header ชัดเจน ──
        # ── (Table ต่อ) จะได้ '' ว่างไป ให้ Backend สืบทอดจากหน้าก่อนเอง ──
        meta = parse_metadata(items)
        raw_type = str(meta.get("doc_type", "")).strip().upper()
        page_doc_type = raw_type if raw_type in SUPPORTED_DOC_TYPES else ""

        gray_top = cv2.cvtColor(cv_top, cv2.COLOR_RGB2GRAY)
        h_lines = detect_lines(gray_top, 'h')
        v_lines = detect_lines(gray_top, 'v')

        _profile = detect_profile(items, meta, _profile)
        _hdr_cy = 0
        if full:
            for _it in items:
                if any(kw in _it["text"].lower() for kw in ["branch", "vendor name"]):
                    _hdr_cy = max(_hdr_cy, _it["cy"])
        rows = parse_rows_by_profile(cv_top, items, crop_width, h_lines, v_lines, _profile, _hdr_cy)

        # MARKER_DOCENTER_SERIALCODE_TEXT_FALLBACK_V1 -- Serial Code ที่ parse_metadata จับตำแหน่งไม่ได้ -> หาจากข้อความทั้งหน้า
        if not meta.get("serial_code"):
            _all_txt = " ".join(i["text"] for i in items)
            _m = re.search(r"serial\s*code\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_.\-]{5,})", _all_txt, re.IGNORECASE)
            if _m:
                meta["serial_code"] = _m.group(1).strip()

        first_row = rows[0] if rows else {}
        # MARKER_DOCENTER_LIGHTWEIGHT_MATCHFIELDS_V1 -- เพิ่ม branch + amount เข้า page_signal ให้ครบ 4 Field
        # ที่ใช้ Match กับ doc_collection (Invoice Number + Branch + Amount +
        # Vendor Name เหมือน checkAllDuplicates() ฝั่ง Frontend ทุกประการ)
        page_signal = {
            "page":              page_idx + 1,
            "doc_type":          page_doc_type,  # '' = ไม่เจอ Header ในหน้านี้ ให้สืบทอดจากหน้าก่อน
            # MARKER_DOCENTER_SERIALCODE_PAGESIGNAL_V1 -- ถ้าเอกสารมี Serial Code Print ไว้แล้ว
            # (รุ่นใหม่จาก excelReport.js) ส่งออกไปให้ Node.js ลอง Match แบบเร็วก่อน 4-field
            "serial_code":       meta.get("serial_code", ""),
            "vendor_name":       first_row.get("Vendor Name", ""),
            "invoice_number":    first_row.get("Invoice Number", "") or first_row.get("Tax Invoice No.", ""),
            "gr_transaction_no": first_row.get("GR Transaction No.", "") or first_row.get("GRT No.", ""),
            "branch":            first_row.get("Branch", ""),
            "amount":            first_row.get("มูลค่ารวม", "") or first_row.get("ยอดรวม", ""),
            "has_data":          bool(first_row),
        }
        if full:
            _txt = " ".join(i["text"] for i in items)
            _meta_full = dict(meta)
            try:
                if not metadata_is_valid(_meta_full):
                    _meta_full = parse_metadata_from_text(_txt, _meta_full)
            except Exception as _e:
                log.warning(f"[onepass] metadata fallback failed: {_e}")
            page_signal["rows"] = rows
            page_signal["meta"] = _meta_full
            page_signal["ocr_text"] = _txt
        page_signals.append(page_signal)
        if on_page:
            on_page(page_signal)

    log.info(f"[lightweight] {len(page_signals)} page signal(s) extracted, "
              f"doc_types found: {[p['doc_type'] for p in page_signals if p['doc_type']]}")

    return {
        "success":      True,
        "pages":        len(images),
        "page_signals": page_signals,
    }


# MARKER_DOCENTER_LIGHTWEIGHT_STREAMING_V1
# ── Stream ทีละหน้า (NDJSON) แทนรอครบแล้วส่งทีเดียว -- ให้ Node.js เริ่ม ──
# ── Group/Match/Auto-Attach และ Broadcast Progress ได้ทันทีที่แต่ละหน้า ──
# ── พร้อม (ไม่ต้องรอ PDF ทั้งไฟล์ OCR เสร็จก่อน) ─────────────────────────
@app.post("/ocr-lightweight")
async def ocr_pdf_lightweight(file: UploadFile = File(...), rotation: int = 0, full: int = 0):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="รับเฉพาะไฟล์ PDF เท่านั้น")
    global _last_request_time
    _last_request_time = time.time()
    log.info(f"Lightweight OCR request (streaming): {file.filename} (rotation={rotation}°{', one-pass FULL' if full else ''})")
    pdf_bytes = await file.read()
    if len(pdf_bytes) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="ไฟล์ใหญ่เกิน 30MB")

    async def stream():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        page_count = 0

        def on_start(total_pages):
            loop.call_soon_threadsafe(queue.put_nowait, ("start", total_pages))

        def on_page(signal):
            loop.call_soon_threadsafe(queue.put_nowait, ("page", signal))

        def _run():
            try:
                with cpu_governor():  # MARKER_DOCENTER_CPU_GOVERNOR_V2
                    result = run_ocr_lightweight_sync(
                        pdf_bytes, file.filename, rotation,
                        on_start=on_start, on_page=on_page, full=bool(full),
                    )
                loop.call_soon_threadsafe(queue.put_nowait, ("done", result))
            except Exception as e:
                log.error(f"Lightweight OCR error: {file.filename} -> {e}\n{traceback.format_exc()}")
                loop.call_soon_threadsafe(queue.put_nowait, ("error", str(e)))

        async with ocr_semaphore:
            executor_future = loop.run_in_executor(None, _run)
            while True:
                kind, payload = await queue.get()
                if kind == "start":
                    yield json.dumps({"type": "start", "pages": payload}, ensure_ascii=False) + "\n"
                elif kind == "page":
                    page_count += 1
                    yield json.dumps({"type": "page", **payload}, ensure_ascii=False) + "\n"
                elif kind == "done":
                    log.info(f"Lightweight OCR done: {file.filename} -> {page_count} page(s) streamed")
                    yield json.dumps({"type": "done", "success": True, "pages": payload["pages"]}, ensure_ascii=False) + "\n"
                    break
                else:  # "error"
                    yield json.dumps({"type": "error", "message": payload}, ensure_ascii=False) + "\n"
                    break
            await executor_future  # กัน Exception ค้าง + รอให้ Thread จบสนิทก่อนปล่อย Semaphore

    return StreamingResponse(stream(), media_type="application/x-ndjson")



# MARKER_DOCENTER_OCR_EXTRACTPAGES_V1
# ── Phase 4 Helper: ตัดเฉพาะหน้าที่เลือกออกมา -- ใช้ 2 กรณี ──────────────
# ── (1) output=image: หน้าที่ Match เจอใน DB แล้ว -> Attach เข้า Record ──
# ──     เดิมเป็นรูปภาพ (Compress แล้ว ผ่าน image_to_base64 เดิม) ─────────
# ── (2) output=pdf: หน้าที่ไม่ Match เลย -> Sub-PDF ส่งต่อเข้า Full OCR ──
@app.post("/extract-pages")
async def extract_pdf_pages(file: UploadFile = File(...), pages: str = Form(...), output: str = Form("image"), rotation: int = 0):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="รับเฉพาะไฟล์ PDF เท่านั้น")
    global _last_request_time
    _last_request_time = time.time()

    try:
        page_list = [int(p.strip()) for p in pages.split(",") if p.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="pages ต้องเป็นตัวเลขคั่นด้วย , เช่น 1,3,5")
    if not page_list:
        raise HTTPException(status_code=400, detail="ต้องระบุ pages อย่างน้อย 1 หน้า")

    pdf_bytes = await file.read()
    log.info(f"[extract-pages] {file.filename} -> pages={page_list}, output={output}")

    # MARKER_DOCENTER_WATCHDOG_INFLIGHT_FIX_V1
    # ── เพิ่ม Semaphore ครอบ -- เดิมไม่มีเลย ทำให้ Watchdog Fix ── 
    # ── ข้างบนไม่ครอบคลุมช่วงที่กำลัง Extract Pages อยู่ ───────── 
    async with ocr_semaphore:
        try:
            if output == "pdf":
                import fitz
                import base64
                src_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                new_doc = fitz.open()
                for p in page_list:
                    if 1 <= p <= src_doc.page_count:
                        new_doc.insert_pdf(src_doc, from_page=p - 1, to_page=p - 1)
                result_bytes = new_doc.tobytes()
                new_doc.close()
                src_doc.close()
                # MARKER_DOCENTER_SUBPDF_ORIENT_CARRY_V1 -- Sub-PDF มี md5 ใหม่ ถ้าไม่ส่งต่อผลตัดสินทิศ
                # Full OCR จะต้องเสียเวลา OCR ตรวจทิศซ้ำอีกรอบ (Cache เดิมใช้ md5 ของไฟล์เป็น Key)
                try:
                    _om = _ORIENT_CACHE.get(_hashlib.md5(pdf_bytes).hexdigest())
                    if _om is not None and not rotation:
                        _ORIENT_CACHE[_hashlib.md5(result_bytes).hexdigest()] = _om
                except Exception as _e:
                    log.warning(f"[extract-pages] carry orient failed: {_e}")
                log.info(f"[extract-pages] Sub-PDF สร้างสำเร็จ: {len(page_list)} หน้า -> {len(result_bytes)} bytes")
                return {"success": True, "pdf_base64": base64.b64encode(result_bytes).decode("utf-8")}

            # output == "image" (Default) -- สำหรับ Attach เข้า Record เดิม
            # MARKER_DOCENTER_AUTO_ORIENT_V1 -- รูป Preview/Attach ต้องตั้งตรงเหมือนที่ OCR ใช้
            images, _ = get_oriented_images(pdf_bytes, rotation)
            extracted = []
            for p in page_list:
                if 1 <= p <= len(images):
                    img = images[p - 1]
                    b64 = image_to_base64(img, dpi_scale=1.0, quality=85)
                    extracted.append({"page": p, "data": b64})
            log.info(f"[extract-pages] แปลงเป็นรูปสำเร็จ: {len(extracted)} หน้า")
            return {"success": True, "pages": extracted}
        except Exception as e:
            log.error(f"[extract-pages] error: {e}\n{traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import socket, subprocess, time
    _PORT = 5050
    def _port_in_use(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("127.0.0.1", port)) == 0
    # ถ้า port ยังใช้อยู่ → รอให้ว่างเองก่อน (TIME_WAIT จะหมดเองใน ~30s)
    # ไม่ kill เพราะ process ที่ listen อาจกำลัง OCR อยู่
    if _port_in_use(_PORT):
        waited = 0
        while _port_in_use(_PORT) and waited < 30:
            time.sleep(2)
            waited += 2
        if _port_in_use(_PORT):
            # port ยังใช้อยู่หลังรอ 30 วิ → kill แบบ safe
            try:
                import psutil
                for conn in psutil.net_connections(kind="inet"):
                    if conn.laddr.port == _PORT and conn.pid and conn.pid != os.getpid():
                        psutil.Process(conn.pid).kill()
                        time.sleep(2)
                        break
            except Exception:
                try:
                    out = subprocess.check_output(
                        f'netstat -ano | findstr :{_PORT}',
                        shell=True, text=True, errors="ignore"
                    )
                    for line in out.strip().splitlines():
                        parts = line.strip().split()
                        if parts and parts[-1].isdigit():
                            pid = int(parts[-1])
                            if pid != os.getpid():
                                subprocess.call(f"taskkill /PID {pid} /F /T", shell=True)
                                time.sleep(2)
                                break
                except Exception:
                    pass
    uvicorn.run(app, host="0.0.0.0", port=5050, workers=1)