"""
ocr_worker_v2.py
================================================================
Worker เวอร์ชันใหม่ — แบ่ง "ชุด" ระหว่างทำงาน ไม่ต้องรอ OCR ครบทั้ง batch
Concept: เจอหน้าที่เป็น "หัวเอกสารใหม่" เมื่อไหร่ = ปิดชุดเดิมทันที (ready_for_review)
         แล้วเปิดชุดใหม่ต่อ

หลักการเดียวกับ ocr_worker.py เดิม (1 Core, Priority ต่ำ, 150 DPI)
แค่เพิ่ม Logic ตรวจจับจุดแบ่งเอกสาร
================================================================
"""
import os
import sys
import re
import time
import json
import difflib
import traceback
import ctypes
import ctypes.wintypes
import threading
import select  # MARKER_OCR_WORKER_LISTEN_NOTIFY -- ใช้รอสัญญาณ LISTEN/NOTIFY แทน Poll ถี่ๆ
import urllib.request  # ใช้ stdlib ล้วนๆ ไม่ต้องเพิ่ม pip dependency ใหม่ (เครื่องไม่มี internet)

# บังคับ stdout/stderr เป็น UTF-8 เสมอ (สำคัญมากเมื่อรันเป็น Windows Service)
if sys.stdout.encoding != "utf-8":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
if sys.stderr.encoding != "utf-8":
    sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", buffering=1)

import psutil
import psycopg2
import psycopg2.extras

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "fastapn-link3ase",
    "user": "postgres",
    "password": "postgres",
}

POLL_INTERVAL_SECONDS = 3
OCR_LANG = "th"

# Restart ตัวเองหลังประมวลผลครบ N หน้า เพื่อคืน RAM ที่ PaddlePaddle สะสมไว้
# (NSSM ต้องตั้ง AppExit Default Restart ไว้ ถึงจะ auto-restart กลับมาทันที)
PAGES_BEFORE_RESTART = 50

# Idle Timeout: ถ้าไม่มีงานเข้าเกิน X วินาที → exit คืน RAM
# NSSM จะ restart ตัวเองให้อัตโนมัติตอนมีงานใหม่เข้า
def _get_idle_timeout() -> int:
    """Dynamic timeout ตามช่วงเวลา"""
    hour = time.localtime().tm_hour
    if 0 <= hour < 7:
        return 5 * 60     # ดึก: 5 นาที (ไม่ให้สั้นเกินไป)
    if 8 <= hour < 18:
        return 15 * 60    # เช้า-เย็น: 15 นาที (ใช้บ่อย ถือไว้นาน)
    return 5 * 60         # เย็น-ค่ำ: 5 นาที


# ================================================================
# Real-time broadcast — แจ้ง Node.js backend ให้ push WebSocket ไปหา
# frontend ทันทีที่มีหน้าใหม่เสร็จ (แทนที่ frontend จะต้อง poll เอง)
# ยิงผ่าน /api/internal/broadcast (จำกัดเฉพาะ localhost เรียกได้)
# มี Debounce กันยิงถี่เกินไปตอนมีหลายหน้าเสร็จพร้อมกันรัวๆ
# ================================================================
BROADCAST_URL = "http://localhost:4000/api/internal/broadcast"
BROADCAST_DEBOUNCE_SEC = 1.5
_last_broadcast_at = {"_default": 0.0}


def broadcast_progress(event: str, data: dict, debounce_key: str = None):
    """ยิง event ไปหา Node.js backend เพื่อ broadcast ผ่าน WebSocket
    ไม่ throw exception เด็ดขาด (best-effort เท่านั้น) — ถ้า backend
    ไม่ตอบ/error ก็แค่ log ไว้ ไม่ทำให้ OCR job หลักพังตาม
    debounce_key แยก throttle ต่อ batch/set ได้ (default รวมทุกตัว)"""
    key = debounce_key or event
    now = time.time()
    last = _last_broadcast_at.get(key, 0.0)
    if now - last < BROADCAST_DEBOUNCE_SEC:
        return  # ยังไม่ถึงรอบ ข้ามไปเลย กันยิงถี่เกินไป
    _last_broadcast_at[key] = now
    try:
        payload = json.dumps({"event": event, **data}).encode("utf-8")
        req = urllib.request.Request(
            BROADCAST_URL, data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception as e:
        # best-effort เท่านั้น — ไม่ให้กระทบ OCR job หลักไม่ว่ากรณีใด
        print(f"[worker] [broadcast] ส่งไม่สำเร็จ (ไม่กระทบงาน OCR): {e}")


# keyword ที่บ่งบอกว่าเป็น "หัวเอกสารใหม่" — ปรับ/เพิ่มได้ตาม vendor ที่เจอจริง
NEW_DOCUMENT_KEYWORDS = [
    "ใบกำกับภาษี", "Tax Invoice", "Original Tax Invoice",
    "ใบเสร็จรับเงิน", "Receipt",
]

# เอกสารที่ไม่ใช่ Tax Invoice — เจอแล้ว Mark สถานะชุดเป็น 'rejected'
# แทนที่จะพยายามอ่านเป็นใบกำกับภาษี (เช็คโซนเดียวกับ NEW_DOCUMENT_KEYWORDS)
# เกณฑ์ความคล้ายของ Invoice No. ที่ถือว่า "น่าจะเป็นใบเดียวกัน" (0.0-1.0)
# ยิ่งต่ำ ยิ่ง Merge ง่าย แต่เสี่ยง Merge ผิดใบมากขึ้น — ปรับได้ตามผลทดสอบจริง
INVOICE_NO_FUZZY_THRESHOLD = 0.85


def invoice_no_similarity(a, b):
    """คืนค่าความคล้ายกัน 0.0-1.0 ระหว่าง Invoice No. 2 ตัว (SequenceMatcher
    จาก difflib — เทียบ Character-by-Character ไม่สนตัวพิมพ์เล็ก-ใหญ่)"""
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, str(a).lower(), str(b).lower()).ratio()


REJECT_KEYWORDS = [
    ("ใบเสนอราคา", "quotation"), ("Quotation", "quotation"),
    ("ใบสั่งซื้อ", "purchase_order"), ("Purchase Order", "purchase_order"),
]

# Patch 102: ประเภทเอกสารที่ "ยอมรับได้" (ไม่ Reject) แต่ต้องแยกให้ออก
# จากกันชัดเจน — ใช้กันไม่ให้ Fuzzy Invoice No. Match ผิดพลาดไป Merge
# เอกสารคนละประเภทที่เลขที่บังเอิญคล้ายกัน (เช่น ใบวางบิล vs ใบกำกับภาษี
# vs ใบเสร็จรับเงิน ที่บาง Vendor ใช้เลขฐานเดียวกันแค่ Prefix ต่างกัน —
# พิสูจน์แล้วด้วยเลขจริง: sim("BUPW-2569-0739","UPW-2569-0736")=0.889
# สูงกว่า INVOICE_NO_FUZZY_THRESHOLD ทั้งที่เป็นเอกสารคนละใบ)
# ทำงานได้เสมอไม่ว่า Gemini เปิดหรือปิด (Keyword ล้วนๆ ไม่พึ่ง Gemini เลย)
DOC_TYPE_KEYWORDS = [
    ("ใบกำกับภาษี", "tax_invoice"), ("Tax Invoice", "tax_invoice"),
    ("ใบเสร็จรับเงิน", "receipt"), ("Receipt", "receipt"),
    ("ใบวางบิล", "billing_note"), ("ใบแจ้งหนี้", "billing_note"),
]

# เช็คเฉพาะข้อความที่อยู่ใน 20% บนสุดของหน้า (หัวกระดาษ)
TOP_REGION_PCT = 0.20


JobObjectCpuRateControlInformation = 15
JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x1
JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x4


class JOBOBJECT_CPU_RATE_CONTROL_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("ControlFlags", ctypes.wintypes.DWORD),
        ("CpuRate", ctypes.wintypes.DWORD),
    ]


def _get_kernel32():
    """คืน kernel32 พร้อมประกาศ argtypes/restype ให้ครบทุกฟังก์ชันที่ใช้ —
    จำเป็นมากบน Windows 64-bit เพราะถ้าไม่ประกาศไว้ ctypes จะสมมติว่า
    ทุกฟังก์ชันคืนค่า/รับค่าเป็น c_int (32-bit) โดย Default ซึ่งจะตัด
    HANDLE (ที่จริงเป็น 64-bit) ให้เหลือแค่ 32-bit โดยไม่ได้ตั้งใจ พอเอา
    Handle ที่ถูกตัดทอนไปใช้ต่อในฟังก์ชันอื่น จะได้ Error "The handle is
    invalid" ทันที (เจอจริงตอนทดสอบ) — ต้องประกาศให้ถูกต้องทุกจุด"""
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateJobObjectW.argtypes = [ctypes.wintypes.LPVOID, ctypes.wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = ctypes.wintypes.HANDLE

    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = ctypes.wintypes.HANDLE

    kernel32.AssignProcessToJobObject.argtypes = [ctypes.wintypes.HANDLE, ctypes.wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = ctypes.wintypes.BOOL

    kernel32.SetInformationJobObject.argtypes = [
        ctypes.wintypes.HANDLE, ctypes.c_int, ctypes.wintypes.LPVOID, ctypes.wintypes.DWORD
    ]
    kernel32.SetInformationJobObject.restype = ctypes.wintypes.BOOL

    kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
    kernel32.CloseHandle.restype = ctypes.wintypes.BOOL
    return kernel32


def create_cpu_rate_job(percent):
    """สร้าง Windows Job Object ผูกกับ Process ปัจจุบัน + ตั้งเพดาน CPU
    เริ่มต้น คืนค่า Job Handle ไว้ให้ update_cpu_rate_limit() เรียกซ้ำได้
    ทีหลัง โดยไม่ต้องสร้าง Job Object ใหม่ทุกครั้งที่จะปรับเปอร์เซ็นต์
    (จำเป็นสำหรับ Auto-scale ที่ต้องปรับค่าไปเรื่อยๆ ตาม Load จริง)
    คืน None ถ้าไม่ได้ตั้งค่าอะไรเลย (percent=None) หรือถ้าล้มเหลว
    """
    if percent is None:
        return None
    try:
        kernel32 = _get_kernel32()
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())

        current_process = kernel32.GetCurrentProcess()
        if not kernel32.AssignProcessToJobObject(job, current_process):
            raise ctypes.WinError(ctypes.get_last_error())

        if not update_cpu_rate_limit(job, percent):
            return None

        return job
    except Exception as e:
        print(f"[worker] WARNING: สร้าง CPU rate job ไม่สำเร็จ ({e}) — ยังใช้แค่ Priority/Affinity ต่อไป")
        return None


def update_cpu_rate_limit(job_handle, percent):
    """ปรับเพดาน % ของ Job Object ที่มีอยู่แล้ว (ไม่ต้องสร้างใหม่) — ใช้ทั้ง
    ตอนตั้งค่าเริ่มต้นและตอน Auto-scale ปรับตาม Load จริงระหว่างรัน"""
    if job_handle is None or percent is None:
        return False
    try:
        kernel32 = _get_kernel32()
        info = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION()
        info.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP
        info.CpuRate = int(percent * 100)  # หน่วย: เปอร์เซ็นต์ x 100 (เช่น 25% = 2500)
        ok = kernel32.SetInformationJobObject(
            job_handle, JobObjectCpuRateControlInformation,
            ctypes.byref(info), ctypes.sizeof(info)
        )
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
        return True
    except Exception as e:
        print(f"[worker] WARNING: ปรับ CPU rate ไม่สำเร็จ ({e})")
        return False


def set_low_priority(cpu_core=None, cpu_percent=None):
    """จำกัดการใช้ CPU ของ Worker 3 ชั้น (ใช้ร่วมกันได้ทั้งหมด):
    1. IDLE_PRIORITY_CLASS — ลำดับความสำคัญต่ำสุด ยอมให้ Process อื่น
       (SQL Server, IIS) แย่ง CPU ไปก่อนเสมอเวลาแข่งกัน
    2. CPU Affinity (ถ้าระบุ cpu_core) — ล็อกให้ใช้ได้แค่ core เดียวจริงๆ
       เป็นเพดานตายตัว ไม่ว่า core อื่นจะว่างพร้อมกันกี่ตัวก็ตาม
    3. CPU Rate Hard Cap (ถ้าระบุ cpu_percent) — จำกัดเปอร์เซ็นต์การใช้งาน
       ตรงๆ อีกชั้น เผื่อไม่อยากให้ใช้เต็ม Core ที่ล็อกไว้ 100%
    คืนค่า Job Handle (ถ้าตั้ง cpu_percent ไว้) ให้ Auto-scale Governor
    เอาไปปรับต่อได้ทีหลัง — None ถ้าไม่ได้ตั้ง cpu_percent เลย
    """
    try:
        p = psutil.Process(os.getpid())
        p.nice(psutil.IDLE_PRIORITY_CLASS)
        print(f"[worker] priority ตั้งเป็น IDLE (ต่ำสุด) — PID {os.getpid()}")
        if cpu_core is not None:
            p.cpu_affinity([cpu_core])
            print(f"[worker] CPU affinity ล็อกไว้ที่ core {cpu_core} เท่านั้น")
    except Exception as e:
        print(f"[worker] WARNING: ตั้ง priority/affinity ไม่สำเร็จ ({e})")

    job_handle = create_cpu_rate_job(cpu_percent)
    if job_handle is not None:
        print(f"[worker] จำกัด CPU (Hard Cap) เริ่มต้นไว้ที่ {cpu_percent}% ผ่าน Windows Job Object")
    return job_handle


# ==================================================================
# CPU Auto-scale Governor
# ------------------------------------------------------------------
# วัด Load ของเครื่องทุกๆ CHECK_INTERVAL วินาที (ไม่นับ CPU ที่ Worker
# ตัวเองใช้อยู่) แล้วปรับเพดาน % ของตัวเองขึ้น/ลงตามตาราง Tier ด้านล่าง
# — คนใช้เยอะ (Load สูง) ต้องยอมช้าลง (Cap ต่ำ) / คนใช้น้อย (Load ต่ำ)
# ได้เพิ่มความเร็ว (Cap สูงขึ้นได้ถึงเพดานบนที่ตั้งไว้)
#
# ทำงานเป็น Background Thread แยกจาก Loop หลักที่ดึงงาน OCR ไปทำ ไม่ต้อง
# รอกัน — แต่ละ Worker วัด "Load ของเครื่องที่ไม่ใช่ตัวเอง" แยกกันเอง ไม่
# ต้องคุยกันระหว่าง Worker เลย (ต่างคนต่างปรับตาม Load รวมที่เห็นเหมือนกัน)
# ==================================================================

CPU_GOVERNOR_CHECK_INTERVAL_SEC = 15
CPU_GOVERNOR_MIN_CHANGE_PCT = 10  # เปลี่ยนเมื่อต่างจากค่าปัจจุบันเกินเท่านี้เท่านั้น กันปรับถี่เกินไป (Thrashing)

# Tier: (เพดานบนของ "Load เครื่องที่ไม่ใช่ตัวเอง" -> Cap ที่จะตั้งให้ตัวเอง)
# เรียงจาก Load ต่ำสุด (ตัวเลข Threshold น้อยสุด) ไปหา Load สูงสุด
CPU_GOVERNOR_TIERS = [
    (30, 90),   # เครื่องว่างมาก (อื่นๆ ใช้ไม่ถึง 30%) -> ให้ตัวเองสูงสุด 90%
    (50, 75),   # อื่นๆ ใช้ 30-50% -> ปานกลาง 75%
    (70, 50),   # อื่นๆ ใช้ 50-70% -> ระมัดระวัง 50%
    (100, 25),  # อื่นๆ ใช้เกิน 70% (เครื่องเริ่มหนัก) -> ลดฮวบเหลือ 25%
]


def _pick_cpu_tier(other_load_pct, min_cap, max_cap):
    for threshold, cap in CPU_GOVERNOR_TIERS:
        if other_load_pct <= threshold:
            return max(min_cap, min(max_cap, cap))
    return min_cap


def cpu_governor_loop(job_handle, min_cap, max_cap, alert_threshold_pct):
    """รันเป็น Background Thread ตลอดอายุของ Worker ปรับเพดาน CPU ของ
    ตัวเองอัตโนมัติตาม Load ของเครื่อง (ไม่นับ CPU ที่ตัวเองใช้อยู่)"""
    current_cap = None
    own_process = psutil.Process(os.getpid())
    # เรียก cpu_percent() ครั้งแรกทิ้งไป (ค่าแรกที่ได้ไม่มีความหมาย ต้องมี
    # baseline ให้เทียบก่อน)
    psutil.cpu_percent(interval=None)
    own_process.cpu_percent(interval=None)

    while True:
        time.sleep(CPU_GOVERNOR_CHECK_INTERVAL_SEC)
        try:
            total_cpu_pct = psutil.cpu_percent(interval=None)
            own_cpu_pct = own_process.cpu_percent(interval=None) / psutil.cpu_count()
            other_load_pct = max(0.0, total_cpu_pct - own_cpu_pct)

            new_cap = _pick_cpu_tier(other_load_pct, min_cap, max_cap)

            if current_cap is None or abs(new_cap - current_cap) >= CPU_GOVERNOR_MIN_CHANGE_PCT:
                if update_cpu_rate_limit(job_handle, new_cap):
                    direction = "ลด" if (current_cap is not None and new_cap < current_cap) else "เพิ่ม"
                    print(f"[worker] [cpu-governor] เครื่องอื่นใช้ {other_load_pct:.0f}% -> {direction} CPU cap เป็น {new_cap}%")
                    current_cap = new_cap

            # Alert: เครื่อง (ไม่นับตัวเอง) หนักเกิน threshold -> เตือนเสมอ
            # ไม่ว่าจะเพิ่งปรับ cap ไปหรือไม่ก็ตาม (กันเงียบไปถ้า cap เดิม
            # ก็ต่ำสุดอยู่แล้วแต่เครื่องยังหนักต่อเนื่อง)
            if other_load_pct >= alert_threshold_pct:
                print(f"[worker] [cpu-governor] [ALERT] เครื่องอื่น (ไม่รวม Worker นี้) ใช้ CPU {other_load_pct:.0f}% "
                      f"(เกิน threshold {alert_threshold_pct}%) — cap ปัจจุบัน {current_cap}%")
        except Exception as e:
            print(f"[worker] [cpu-governor] WARNING: {type(e).__name__}: {e}")


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def fetch_next_page(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM fetch_next_ocr_page_v2();")
        row = cur.fetchone()
        conn.commit()
        return row


# ── Central OCR Lock (system_ocr_queue) ─────────────────────────────────────
# ป้องกัน AP OCR และ DocCenter OCR รัน PaddleOCR พร้อมกัน บน CPU core เดียวกัน
# ใช้ DB row เป็น distributed lock — ทั้ง 2 process เห็น lock เดียวกัน

OCR_LOCK_SOURCE = 'ap_ocr'
OCR_LOCK_TIMEOUT_SEC = 300  # ถ้าค้างเกิน 5 นาที ถือว่า stale → แย่ง lock ได้

def acquire_ocr_lock(conn, source_id: str) -> bool:
    """พยายาม insert lock row — return True ถ้าได้ lock"""
    try:
        with conn.cursor() as cur:
            # เคลียร์ stale lock ก่อน (process ตายกลางคัน)
            cur.execute("""
                DELETE FROM system_ocr_queue
                WHERE status = 'running'
                  AND updated_at < NOW() - INTERVAL '%s seconds'
            """, (OCR_LOCK_TIMEOUT_SEC,))
            # ลอง insert lock — ถ้ามีอยู่แล้วจะ conflict
            cur.execute("""
                INSERT INTO system_ocr_queue
                  (source, source_id, file_name, status, priority_class, created_at, updated_at)
                VALUES (%s, %s, %s, 'running', 1, NOW(), NOW())
                ON CONFLICT DO NOTHING
                RETURNING id
            """, (OCR_LOCK_SOURCE, str(source_id), f'ap_ocr_page_{source_id}'))
            row = cur.fetchone()
            conn.commit()
            return row is not None  # True = ได้ lock, False = มีคนอื่น running อยู่
    except Exception as e:
        print(f"[lock] acquire_ocr_lock error: {e}")
        try: conn.rollback()
        except: pass
        return True  # fallback: ถ้า lock table ไม่มี → รันเลย ไม่บล็อก

def release_ocr_lock(conn, source_id: str):
    """ปล่อย lock หลัง OCR เสร็จ
    Patch 93: DELETE แทน UPDATE status='done' — Lock นี้เป็น Mutex ชั่วคราว
    ล้วนๆ (ไม่มี Detail ที่ควรเก็บต่อ) พอปล่อย Lock แล้วควรหายจาก
    system_ocr_queue ทันที ไม่ใช่ค้างสะสมไม่มีที่สิ้นสุดเหมือนเดิม"""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM system_ocr_queue
                WHERE source = %s AND source_id = %s AND status = 'running'
            """, (OCR_LOCK_SOURCE, str(source_id)))
            conn.commit()
    except Exception as e:
        print(f"[lock] release_ocr_lock error: {e}")
        try: conn.rollback()
        except: pass

def wait_for_ocr_lock(conn, source_id: str, max_wait_sec: int = 300) -> bool:
    """รอจนได้ lock หรือ timeout — return True ถ้าได้ lock"""
    waited = 0
    while waited < max_wait_sec:
        if acquire_ocr_lock(conn, source_id):
            return True
        print(f"[lock] DocCenter OCR กำลังทำงาน → รอ... ({waited}s/{max_wait_sec}s)")
        time.sleep(10)
        waited += 10
    print(f"[lock] รอนานเกิน {max_wait_sec}s → บังคับรันต่อ")
    return True  # บังคับรันหลัง timeout
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM fetch_next_ocr_page_v2();")
        row = cur.fetchone()
        conn.commit()
        return row


def fetch_batch_needing_local_grouping(conn):
    """หา batch ที่มีหน้าค้างรอ Local Grouping อยู่ (สถานะ
    'local_grouping' — มาจาก skip-grouping ตอน Gemini ใช้ไม่ได้)
    คืน batch_id เดียว (หยิบทีละ batch พอ กันไม่ให้ 1 รอบ loop ใช้เวลานาน
    เกินไปถ้ามีหลาย batch ค้างพร้อมกัน) หรือ None ถ้าไม่มี

    Patch 90: รวม select + claim เป็น atomic query เดียวด้วย
    FOR UPDATE SKIP LOCKED -- กัน ocr-worker/ocr-worker-2 หยิบ
    batch เดียวกันไปทำ local_group_and_release_batch() ซ้อนกัน
    (root cause ของบั๊ก ocr_sets ซ้อน 2 ชุดจาก batch เดียวกัน)
    มี stale-reclaim 5 นาที เผื่อ worker ตายกลางคันตอนถือ claim"""
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH claimed AS (
                SELECT b.id
                FROM ocr_upload_batches b
                WHERE (b.local_grouping_claimed_at IS NULL
                       OR b.local_grouping_claimed_at < NOW() - INTERVAL '5 minutes')
                  AND EXISTS (
                      SELECT 1 FROM ocr_queue_pages p
                      WHERE p.batch_id = b.id AND p.status = 'local_grouping'
                  )
                ORDER BY b.id
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE ocr_upload_batches
            SET local_grouping_claimed_at = NOW()
            WHERE id IN (SELECT id FROM claimed)
            RETURNING id
            """
        )
        row = cur.fetchone()
        conn.commit()
        return row[0] if row else None


# Patch 104: แก้ Thai Unicode Normalization ที่จุดกำเนิด — พิสูจน์จาก
# Real Data จริง (313 หน้า) ว่าสระ "ำ" ที่ OCR ให้มามักเป็นรูปแบบ
# นิคหิต+สระอา (U+0E4D+U+0E32) ไม่ใช่สระอำตัวเดียว (U+0E33) ทำให้
# Keyword Matching ทุกจุดในระบบ (NEW_DOCUMENT_KEYWORDS, REJECT_KEYWORDS,
# DOC_TYPE_KEYWORDS, INVOICE_NO_KEYWORDS, LINE_ITEM_END_KEYWORDS) พลาด
# ทั้งที่ OCR อ่านตัวอักษรถูกต้องแล้วจริงๆ (unicodedata.normalize NFC
# มาตรฐานไม่ช่วย เพราะ Unicode ไม่ได้กำหนดให้ 2 รูปแบบนี้เทียบเท่ากัน
# อย่างเป็นทางการ เป็น Quirk เฉพาะภาษาไทย)
def normalize_thai_text(text):
    if not text:
        return text
    text = text.replace('\u0e4d\u0e32', '\u0e33')  # นิคหิต+สระอา -> สระอำ
    text = text.replace('\u0e4d', '\u0e33')            # นิคหิตเดี่ยวๆ (เผื่อ OCR ตัดสระอาหาย)
    return text


def run_ocr(ocr_engine, image_path):
    t0 = time.time()
    result = ocr_engine.predict(image_path)
    elapsed = time.time() - t0

    output = []
    all_scores = []
    for res in result:
        texts = res.get("rec_texts", [])
        scores = res.get("rec_scores", [])
        polys = res.get("rec_polys", res.get("dt_polys", []))
        for text, score, poly in zip(texts, scores, polys):
            all_scores.append(float(score))
            ys = [p[1] for p in poly]
            output.append({
                "text": normalize_thai_text(text),  # Patch 104
                "confidence": round(float(score), 4),
                "bbox": [[round(float(x), 1), round(float(y), 1)] for x, y in poly],
                "y_center": sum(ys) / len(ys) if ys else 0,
            })

    avg_conf = round(sum(all_scores) / len(all_scores), 4) if all_scores else None
    return output, avg_conf, round(elapsed, 2)


def crop_header_band(image_path, pct=TOP_REGION_PCT):
    """Crop เฉพาะแถบหัวกระดาษบนสุด (pct ของความสูงภาพ) เป็นไฟล์ชั่วคราว
    ใช้สำหรับ Local Grouping ก่อนเข้าคิว — เร็วกว่า OCR เต็มหน้ามาก เพราะ
    ภาพที่ส่งเข้า PaddleOCR เล็กลงมาก (แถบเดียว ไม่ใช่ทั้งหน้า)
    ถ้าไม่มี cv2 (ไม่ควรเกิดในเครื่อง Server แต่กันไว้) คืน image_path เดิม
    ไปเลย — OCR เต็มหน้าแทน ช้ากว่าแต่ยังถูกต้องอยู่"""
    if not CV2_AVAILABLE:
        return image_path
    img = cv2.imread(image_path)
    if img is None:
        return image_path
    h = img.shape[0]
    band = img[0:max(1, int(h * pct)), :]
    crop_path = f"{image_path}.header.png"
    cv2.imwrite(crop_path, band)
    return crop_path


def run_header_ocr(ocr_engine, image_path):
    """OCR เฉพาะแถบหัวกระดาษ คืนผลลัพธ์รูปแบบเดียวกับ run_ocr() (list ของ
    dict มี text/confidence/bbox/y_center) เพื่อให้ extract_tax_ids()
    และ extract_invoice_no() เรียกใช้ต่อได้ทันทีไม่ต้องแก้อะไรเพิ่ม"""
    crop_path = crop_header_band(image_path)
    try:
        ocr_result, _avg_conf, _elapsed = run_ocr(ocr_engine, crop_path)
        return ocr_result
    finally:
        if crop_path != image_path and os.path.exists(crop_path):
            os.remove(crop_path)


# ป้ายชื่อ Column ที่อ้างอิงถึงเลขที่เอกสารอื่น (เช่น "PO Number",
# "เลขที่ใบสั่งซื้อ", "เลขที่ใบกำกับภาษี") ไม่ใช่ชื่อเอกสารตัวเอง — ถ้าเจอคำ
# เหล่านี้ปนอยู่กับ Keyword ให้ถือว่าเป็น Label อ้างอิง ไม่ใช่หัวเรื่องจริง
# ป้องกัน False Positive (เช่น Tax Invoice ที่มีช่อง "PO Number / เลขที่
# ใบสั่งซื้อ" ในตาราง แต่ไม่ได้แปลว่าเอกสารนี้เป็นใบสั่งซื้อ)
REFERENCE_LABEL_MARKERS = ["เลขที่", "no.", "number", "ref", "อ้างอิง"]


def _is_reference_label(text):
    """เช็คว่า Text นี้เป็น Label อ้างอิงเลขที่เอกสารอื่น (ไม่ใช่ชื่อเอกสารตัวเอง)"""
    text_lower = text.lower()
    return any(marker in text_lower for marker in REFERENCE_LABEL_MARKERS)


def is_new_document_page(ocr_output, image_height_estimate=1200):
    """เช็คว่าหน้านี้มีหัวเอกสารใหม่ไหม (keyword อยู่ใน top region)
    ข้าม Label อ้างอิง (เช่น "เลขที่ใบกำกับภาษี" ในใบวางบิล) ไม่ให้นับเป็น
    หัวเอกสารใหม่โดยไม่ตั้งใจ"""
    top_threshold = image_height_estimate * TOP_REGION_PCT
    for item in ocr_output:
        if item["y_center"] > top_threshold:
            continue
        if _is_reference_label(item["text"]):
            continue
        for kw in NEW_DOCUMENT_KEYWORDS:
            if kw.lower() in item["text"].lower():
                return True
    return False


def has_reject_keyword(ocr_output, image_height_estimate=1200):
    """เช็คว่าหน้านี้เป็นเอกสารที่ต้อง Reject ไหม (ใบเสนอราคา/ใบสั่งซื้อ ฯลฯ)
    ใช้โซนเดียวกับ is_new_document_page (20% บนสุดของหน้า)

    คืนค่า "ประเภทที่ Match" (quotation/purchase_order) หรือ None ถ้าไม่ Reject
    (ยังใช้แบบ Boolean ได้เหมือนเดิมทุกจุดที่มีอยู่แล้ว เพราะ String ที่ไม่ว่าง
    เปล่า = Truthy ใน Python) — ใช้แทนการเดาประเภทใหม่ทีหลังด้วย
    extract_document_type() ที่มี Priority Ladder จับ tax_invoice ผิดได้ง่าย
    ถ้าหน้า Purchase Order มีคำว่า "เลขที่ใบกำกับภาษี" ปนอยู่ในตาราง"""
    top_threshold = image_height_estimate * TOP_REGION_PCT
    for item in ocr_output:
        if item["y_center"] > top_threshold:
            continue
        if _is_reference_label(item["text"]):
            continue
        for kw, doc_type in REJECT_KEYWORDS:
            if kw.lower() in item["text"].lower():
                return doc_type
    return None


def detect_doc_type(ocr_output, image_height_estimate=1200):
    """Patch 102: หาประเภทเอกสาร (tax_invoice/receipt/billing_note) จาก
    Keyword ในหัวกระดาษ (โซนเดียวกับ is_new_document_page/has_reject_keyword)
    ทำงานได้เสมอไม่ว่า Gemini เปิดหรือปิด — ใช้กัน Fuzzy Invoice No. Match
    ผิดพลาดข้ามประเภทเอกสาร คืนค่า None ถ้าหาไม่เจอ (ไม่ Force ให้เดา)"""
    top_threshold = image_height_estimate * TOP_REGION_PCT
    for item in ocr_output:
        if item["y_center"] > top_threshold:
            continue
        if _is_reference_label(item["text"]):
            continue
        for kw, doc_type in DOC_TYPE_KEYWORDS:
            if kw.lower() in item["text"].lower():
                return doc_type
    return None


def extract_page_of_total(raw_ocr_result):
    """หา Pattern 'Page X of Y' หรือ 'หน้า X จาก Y' — เป็น Signal ที่แม่นยำที่สุด
    เพราะเอกสารเขียนกำกับไว้เองตรงๆ ไม่ต้องเดา
    คืนค่า (page_num, total_pages) หรือ None ถ้าไม่เจอ"""
    for item in raw_ocr_result:
        text = item.get("text", "")
        m = re.search(r'page\s*(\d+)\s*of\s*(\d+)', text, re.IGNORECASE)
        if m:
            return int(m.group(1)), int(m.group(2))
        m = re.search(r'หน้า(?:ที่)?\s*(\d+)\s*(?:จาก|/)\s*(\d+)', text)
        if m:
            return int(m.group(1)), int(m.group(2))
    return None


# Pattern เลข Tax ID 13 หลัก (โครงสร้าง 1-4-5-2-1 ตามมาตรฐานกรมสรรพากร)
# รองรับตัวคั่นระหว่างกลุ่มได้หลายแบบ (ขีด/เว้นวรรค/จุด/underscore) หรือไม่มีเลยก็ได้
# (?<!\d) / (?!\d) กันไม่ให้จับทับเลขชุดที่ยาวกว่า 13 หลักโดยไม่ตั้งใจ
TAX_ID_PATTERN = re.compile(r'(?<!\d)\d[-\s._]?\d{4}[-\s._]?\d{5}[-\s._]?\d{2}[-\s._]?\d(?!\d)')


def _digits_only(text):
    """ตัดทุกอย่างที่ไม่ใช่ตัวเลขออก — ใช้ Normalize ก่อนเทียบ Tax ID เสมอ
    (กันปัญหาขีด/เว้นวรรค/จุด ที่พิมพ์มาไม่ตรงกันระหว่างจุดที่ Extract
    กับจุดที่เอาไปเทียบหา Text ใกล้เคียง)"""
    return re.sub(r'\D', '', text or '')


def extract_tax_ids(raw_ocr_result):
    """หา Tax ID (เลข 13 หลัก) จากผล OCR ทุกบรรทัดของหน้านั้น
    รองรับทั้งเลขล้วนติดกัน, มีขีดคั่น, เว้นวรรคคั่น, ผสมขีด+เว้นวรรค,
    และกรณี OCR แยกเป็นคนละ Text Block (ขึ้นบรรทัดใหม่ในเซลล์แคบ)"""
    found = []

    # 1) หาในแต่ละ Text Item เดี่ยวๆ ก่อน (ครอบคลุมรูปแบบคั่นทั่วไปแทบทั้งหมด)
    for item in raw_ocr_result:
        text = item.get("text", "")
        for m in TAX_ID_PATTERN.finditer(text):
            found.append(_digits_only(m.group()))

    # 2) เผื่อกรณี Tax ID ถูกฉีกเป็นคนละ Text Block ที่อยู่แถวเดียวกันในภาพ
    #    (เช่น ช่องตารางแคบทำให้ตัดขึ้นบรรทัดใหม่กลางเลข) — รวม Text ของ
    #    Item ที่ y ใกล้กันมากๆ (แถวเดียวกันจริง) มาเทียบซ้ำอีกรอบ
    try:
        rows = group_rows_by_y(raw_ocr_result, y_tolerance=10)
        for row in rows:
            combined = "".join(i.get("text", "") for i in row)
            for m in TAX_ID_PATTERN.finditer(combined):
                candidate = _digits_only(m.group())
                if candidate not in found:
                    found.append(candidate)
    except NameError:
        pass  # group_rows_by_y ยังไม่ถูก define มาก่อน (ไม่ควรเกิด แต่กันไว้)

    return found


# Keyword ที่บ่งบอกว่าบรรทัดนี้/บรรทัดถัดไปน่าจะเป็นยอดรวม
TOTAL_AMOUNT_KEYWORDS = [
    "payment due", "grand total", "total amount", "net amount", "amount due",
    "total", "ยอดรวม", "จำนวนเงินรวม", "ยอดรวมสุทธิ", "รวมเป็นเงิน", "รวมทั้งสิ้น",
]

SUBTOTAL_KEYWORDS = [
    "subtotal", "sub total", "amount before vat",
    "ยอดก่อนภาษี", "รวมเงิน", "มูลค่าสินค้า",
]

VAT_KEYWORDS = [
    "vat amount", "vat amt", "ภาษีมูลค่าเพิ่ม", "จำนวนภาษี",
    "value added tax",
    "vat",  # Fallback ทั่วไปสุดท้าย — เสี่ยงจับ "VAT %" (เปอร์เซ็นต์) ผิดตัวได้
            # ถ้า Keyword เฉพาะเจาะจงด้านบนหาไม่เจอเลย
]

INVOICE_NO_KEYWORDS = [
    "invoice no", "invoice number", "tax invoice no",
    "เลขที่ใบกำกับภาษี", "เลขที่ใบเสร็จ", "เลขที่เอกสาร", "เลขที่ใบแจ้งหนี้",
]

DOCUMENT_TYPE_KEYWORDS = {
    "tax_invoice": ["tax invoice", "ใบกำกับภาษี"],
    "receipt": ["receipt", "ใบเสร็จรับเงิน"],
    # Patch 105: เพิ่ม billing_note (Sync กับ DOC_TYPE_KEYWORDS ของ Patch 102
    # ที่ใช้ใน Boundary Detection) — เดิมไม่มี "ใบวางบิล" อยู่เลยสักคำ ทำให้
    # extract_document_type() (ฟังก์ชันหลักที่บันทึกลง DB) ไม่รู้จักเอกสาร
    # ประเภทนี้เลย
    "billing_note": ["ใบวางบิล", "ใบแจ้งหนี้"],
    "invoice": ["invoice"],
    "quotation": ["quotation", "ใบเสนอราคา"],
    "purchase_order": ["purchase order", "ใบสั่งซื้อ"],
}

INVOICE_DATE_KEYWORDS = [
    "document date", "invoice date", "date",
    "วันที่เอกสาร", "วันที่ใบกำกับภาษี", "วันที่",
]

BRANCH_KEYWORDS = [
    "tax branch", "สาขาภาษี", "branch name", "สาขา",
]


def _find_number_in_text(text):
    """ดึงตัวเลขแบบมีทศนิยม 2 ตำแหน่ง (รูปแบบเงินไทย เช่น '1,735.69' หรือ '700.50')
    เท่านั้น — ไม่ Fallback ไปจับเลขจำนวนเต็มทั่วไป เพราะเสี่ยงหยิบเลขผิด
    (เช่น PO Number, Invoice No., Tax ID) มาเป็นยอดเงินโดยไม่ตั้งใจ
    กันไม่ให้จับ "เศษวันที่" เช่น '05.06' จาก '05.06.2026' (DD.MM.YYYY) —
    เช็คว่าตัวที่ Match ไม่ได้ตามด้วย .ตัวเลขอีก (ซึ่งจะแปลว่าเป็นส่วนหนึ่งของวันที่)"""
    for m in re.finditer(r'\d[\d,]*\.\d{2}\b', text):
        end = m.end()
        # ถ้าตามด้วย .ตัวเลข อีก (เช่น ".2026") แปลว่าเป็นวันที่ ไม่ใช่ยอดเงิน -> ข้ามไป
        if text[end:end + 1] == '.' and text[end + 1:end + 2].isdigit():
            continue
        return m.group().replace(",", "")
    return None


def extract_field_by_keyword(raw_ocr_result, keywords, extractor_fn, y_tolerance=20, exclude_if_contains=None):
    """หา Field โดยเช็ค Keyword ในแต่ละบรรทัดก่อน แล้วดึงค่าจาก:
    1. บรรทัดเดียวกัน (ถ้ามีทั้ง keyword และค่าปนกัน เช่น "Total: 1,735.69")
    2. บรรทัดถัดไปที่อยู่ y ใกล้เคียงกัน (ถ้า OCR แยก label กับค่าคนละกล่อง)
       -- ในกรณีนี้ ถ้ามีตัวเลขหลายตัวอยู่ y ใกล้เคียงกัน (เช่น Layout แบบ
       3 คอลัมน์ Subtotal | VAT | Total เรียงกันเป็นแถวเดียว) ให้เลือกตัวที่
       อยู่ตำแหน่ง X ใกล้กับ Label มากที่สุด ไม่ใช่ตัวแรกที่เจอตามลำดับสแกน
       ของ OCR (ซ้าย->ขวา) เพราะไม่งั้นจะได้ค่าจากคอลัมน์ข้างเคียงผิดคอลัมน์
       (พบจริง: keyword "total" เจอ Layout แบบนี้แล้วดึงเลข VAT มาแทน Total
       ซ้ำๆ ทุกใบ เพราะ VAT อยู่คอลัมน์ก่อนหน้าตามลำดับสแกน)
    ใช้ Word Boundary ในการหา Keyword เสมอ กัน "total" match ผิดเข้าไปใน "subtotal"
    (แต่ "Sub Total" ที่มีช่องว่างคั่น ยังคง Match "total" ได้ตามหลัก Word Boundary ปกติ
    จึงต้องใช้ exclude_if_contains กันไว้อีกชั้นสำหรับกรณีนี้โดยเฉพาะ)
    คืนค่าที่เจอตัวแรก (ตาม keyword ที่มีความสำคัญมากสุดก่อน)"""
    candidates = []
    for item in raw_ocr_result:
        text_lower = item.get("text", "").lower()
        if exclude_if_contains and any(ex in text_lower for ex in exclude_if_contains):
            continue
        for idx, kw in enumerate(keywords):
            if not re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                continue
            # ลองดึงค่าจากบรรทัดเดียวกันก่อน
            value = extractor_fn(item.get("text", ""))
            if value:
                candidates.append((idx, value))
                continue
            # ถ้าไม่เจอในบรรทัดเดียวกัน ลองหาบรรทัดอื่นที่ y ใกล้เคียง —
            # ถ้าเจอหลายตัวเลือก ให้เอาตัวที่ X ใกล้กับ Label ที่สุด (ไม่ใช่
            # ตัวแรกที่เจอ) กัน Layout หลายคอลัมน์ดึงผิดคอลัมน์
            kw_y = item.get("y_center", 0)
            kw_x = _item_x(item)
            best_value = None
            best_dx = None
            for other in raw_ocr_result:
                if other is item:
                    continue
                other_text_lower = other.get("text", "").lower()
                if exclude_if_contains and any(ex in other_text_lower for ex in exclude_if_contains):
                    continue
                if abs(other.get("y_center", 0) - kw_y) <= y_tolerance:
                    value2 = extractor_fn(other.get("text", ""))
                    if value2:
                        dx = abs(_item_x(other) - kw_x)
                        if best_value is None or dx < best_dx:
                            best_value = value2
                            best_dx = dx
            if best_value:
                candidates.append((idx, best_value))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])  # keyword ที่สำคัญกว่า (idx น้อยกว่า) มาก่อน
    return candidates[0][1]


def extract_total_amount(raw_ocr_result, pattern=None):
    keywords = (pattern or {}).get("total_amount", {}).get("keywords") or TOTAL_AMOUNT_KEYWORDS
    return extract_field_by_keyword(
        raw_ocr_result, keywords, _find_number_in_text,
        exclude_if_contains=["sub total", "subtotal"],
    )


def extract_subtotal(raw_ocr_result, pattern=None):
    keywords = (pattern or {}).get("subtotal", {}).get("keywords") or SUBTOTAL_KEYWORDS
    return extract_field_by_keyword(raw_ocr_result, keywords, _find_number_in_text)


def extract_vat(raw_ocr_result, pattern=None):
    keywords = (pattern or {}).get("vat", {}).get("keywords") or VAT_KEYWORDS
    return extract_field_by_keyword(raw_ocr_result, keywords, _find_number_in_text)


def cross_validate_amounts(subtotal, vat, total, tolerance=1.0):
    """เช็คว่า Subtotal + VAT = Total ไหม (คลาดเคลื่อนได้ไม่เกิน tolerance บาท
    เผื่อการปัดเศษ) คืนค่า (is_valid, detail_dict) เพื่อเก็บเป็น validation flag"""
    if subtotal is None or vat is None or total is None:
        return None, {"reason": "missing_field", "subtotal": subtotal, "vat": vat, "total": total}
    try:
        sub_f = float(subtotal)
        vat_f = float(vat)
        total_f = float(total)
    except ValueError:
        return None, {"reason": "parse_error", "subtotal": subtotal, "vat": vat, "total": total}

    calculated = round(sub_f + vat_f, 2)
    diff = round(abs(calculated - total_f), 2)
    is_valid = diff <= tolerance
    return is_valid, {
        "subtotal": sub_f, "vat": vat_f, "total": total_f,
        "calculated": calculated, "diff": diff,
    }


def invoice_no_similar(a, b, max_diff_chars=1):
    """เช็คว่าเลข Invoice สองตัวต่างกันแค่ 1 ตัวอักษรหรือไม่ (เผื่อ OCR อ่านผิดบางตำแหน่ง)
    ยืนยันจากเอกสารจริงแล้วว่า Vendor นี้ 1 Invoice = 2 หน้าเสมอ และ OCR
    บางครั้งอ่านเลขหน้าที่ 2 ผิดไป 1 ตัว จึงต้องมี Tolerance นี้"""
    if a is None or b is None or len(a) != len(b):
        return False
    diff_count = sum(1 for c1, c2 in zip(a, b) if c1 != c2)
    return diff_count <= max_diff_chars


def extract_invoice_no(raw_ocr_result, pattern=None):
    field_pattern = (pattern or {}).get("invoice_no", {})
    keywords = field_pattern.get("keywords") or INVOICE_NO_KEYWORDS

    def _extract_code(text):
        # เลขที่ Invoice ต้องมีตัวเลขปนอยู่อย่างน้อย 1 ตัว (กันจับคำว่า "INVOICE" เอง)
        matches = re.findall(r'\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,15}\b', text.upper())
        return matches[0] if matches else None

    result = extract_field_by_keyword(raw_ocr_result, keywords, _extract_code)
    if result:
        return result

    # ถ้า Pattern บอกว่า Vendor นี้ไม่ใช้ Keyword (fallback: "under_title") หรือยังไม่มี Pattern เลย
    # ลองหาเลขใต้หัวเรื่องเอกสารแทน (บาง Vendor เช่น ECOLAB ไม่มี Label "Invoice No." กำกับ)
    fallback_mode = field_pattern.get("fallback", "under_title")
    if fallback_mode != "under_title":
        return None

    title_keywords = ["tax invoice", "receipt", "ใบกำกับภาษี", "ใบเสร็จรับเงิน"]
    for item in raw_ocr_result:
        text_lower = item.get("text", "").lower()
        if any(kw in text_lower for kw in title_keywords):
            title_y = item.get("y_center", 0)
            candidates = []
            for other in raw_ocr_result:
                if other is item:
                    continue
                dy = other.get("y_center", 0) - title_y
                if 0 <= dy <= 60:  # อยู่ใต้หัวเรื่องไม่ไกลนัก
                    m = re.fullmatch(r'\d{6,15}', other.get("text", "").strip())
                    if m:
                        candidates.append((dy, m.group()))
            if candidates:
                candidates.sort(key=lambda c: c[0])
                return candidates[0][1]
    return None


def get_vendor_pattern(conn, supplier_id):
    """โหลด Pattern เฉพาะของ Vendor นี้จาก vendor_patterns (ถ้ามี)
    คืนค่า field_mapping (dict) หรือ None ถ้ายังไม่เคยมี Pattern มาก่อน"""
    if not supplier_id:
        return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT field_mapping FROM vendor_patterns WHERE supplier_id = %s AND is_active = true",
                (supplier_id,),
            )
            row = cur.fetchone()
            if row and row["field_mapping"]:
                fm = row["field_mapping"]
                return json.loads(fm) if isinstance(fm, str) else fm
    except Exception as e:
        print(f"[worker] WARNING: get_vendor_pattern ล้มเหลว (supplier={supplier_id}): {e}")
    return None


def extract_document_type(raw_ocr_result):
    """หาประเภทเอกสาร (Tax Invoice / Receipt / Invoice) จาก Keyword ที่เจอในหน้าเอกสาร
    ถ้าเจอหลายประเภทพร้อมกัน (เช่น 'Tax Invoice / Receipt' ในใบเดียว) ให้ Priority
    Tax Invoice ก่อนเสมอ เพราะสำคัญที่สุดทางบัญชี"""
    found_types = set()
    for item in raw_ocr_result:
        text_raw = item.get("text", "")
        if _is_reference_label(text_raw):
            continue
        text_lower = text_raw.lower()
        for doc_type, keywords in DOCUMENT_TYPE_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                found_types.add(doc_type)
    if "tax_invoice" in found_types:
        return "tax_invoice"
    if "receipt" in found_types:
        return "receipt"
    if "billing_note" in found_types:  # Patch 105
        return "billing_note"
    if "invoice" in found_types:
        return "invoice"
    if "quotation" in found_types:
        return "quotation"
    if "purchase_order" in found_types:
        return "purchase_order"
    return None


def extract_invoice_date(raw_ocr_result, pattern=None):
    """หาวันที่ของเอกสาร รองรับหลายรูปแบบ: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY"""
    keywords = (pattern or {}).get("invoice_date", {}).get("keywords") or INVOICE_DATE_KEYWORDS

    def _extract_date(text):
        m = re.search(r'\b\d{1,2}[./\-]\d{1,2}[./\-]\d{4}\b', text)
        return m.group() if m else None

    return extract_field_by_keyword(raw_ocr_result, keywords, _extract_date)


def find_text_near_tax_id(raw_ocr_result, target_tax_id, matcher_fn, y_tolerance=30,
                           y_tolerance_above=None, y_tolerance_below=None):
    """หาข้อความที่อยู่ใกล้ตำแหน่ง Tax ID ที่ระบุ (แยกได้ว่าเป็นของ Vendor หรือ Buyer
    เพราะแต่ละฝั่งมี Tax ID ของตัวเองอยู่คนละตำแหน่งในเอกสาร)
    matcher_fn(text) -> ค่าที่ต้องการ หรือ None ถ้าไม่ตรง

    y_tolerance_above / y_tolerance_below (Patch 84): ถ้าระบุมา จะ Override
    y_tolerance แบบไม่สมมาตร (Asymmetric) — ใช้กับกรณีที่ค่าที่ต้องการมักอยู่
    "ก่อน" (Above) บรรทัด Tax ID เสมอ (ต้องการระยะกว้าง) ส่วน "หลัง" (Below)
    Tax ID มักเป็นข้อมูลอื่นที่ไม่เกี่ยวข้อง (ต้องการระยะแคบ กัน False
    Positive) ถ้าไม่ระบุ จะใช้ y_tolerance เดิมแบบสมมาตรทั้งสองทิศทาง
    (Backward-compatible กับจุดที่เรียกใช้แบบเดิมทั้งหมด)

    หมายเหตุ: target_tax_id ที่ส่งเข้ามาเป็นเลขล้วน (Normalize แล้วจาก
    extract_tax_ids) แต่ Text ต้นฉบับใน raw_ocr_result อาจยังมีขีด/เว้นวรรค
    คั่นอยู่ (เช่น "0-1055-49125-63-8") — ต้อง Normalize ฝั่ง Text ต้นฉบับ
    ก่อนเทียบด้วยเสมอ ไม่งั้น Substring Match จะไม่ตรงกันเลย"""
    if not target_tax_id:
        return None
    target_digits = _digits_only(str(target_tax_id))
    if not target_digits:
        return None

    tax_id_item = next(
        (item for item in raw_ocr_result if target_digits in _digits_only(item.get("text", ""))),
        None,
    )

    if not tax_id_item:
        # เผื่อกรณี Tax ID ถูกฉีกเป็นคนละ Text Block (Line-wrap ในเซลล์แคบ)
        # ลองรวม Text ของ Item ที่ y ใกล้กันมากๆ (แถวเดียวกันจริง) มาเทียบซ้ำ
        try:
            rows = group_rows_by_y(raw_ocr_result, y_tolerance=10)
        except NameError:
            rows = []
        for row in rows:
            combined_digits = _digits_only("".join(i.get("text", "") for i in row))
            if target_digits in combined_digits:
                tax_id_item = row[0]
                break

    if not tax_id_item:
        return None

    target_y = tax_id_item.get("y_center", 0)
    tol_above = y_tolerance_above if y_tolerance_above is not None else y_tolerance
    tol_below = y_tolerance_below if y_tolerance_below is not None else y_tolerance
    candidates = []
    for item in raw_ocr_result:
        dy_signed = item.get("y_center", 0) - target_y
        tol = tol_above if dy_signed < 0 else tol_below
        if abs(dy_signed) <= tol:
            value = matcher_fn(item.get("text", ""))
            if value:
                candidates.append((abs(dy_signed), value))
    if candidates:
        candidates.sort(key=lambda c: c[0])
        return candidates[0][1]
    return None


def extract_branch_code_for(raw_ocr_result, target_tax_id):
    """หารหัสสาขา (Tax Branch) ของฝั่งที่ระบุ (Vendor หรือ Buyer) โดยดูจาก
    ข้อความที่มี Keyword 'tax branch'/'สาขาภาษี' อยู่ใกล้ตำแหน่ง Tax ID ของฝั่งนั้น"""
    def _matcher(text):
        text_lower = text.lower()
        if not any(kw in text_lower for kw in BRANCH_KEYWORDS):
            return None
        m = re.search(r'\b\d{5}\b', text)
        return m.group() if m else None
    return find_text_near_tax_id(raw_ocr_result, target_tax_id, _matcher)


# ระยะ y (พิกเซล) ที่ยอมให้ชื่อ Vendor ห่างจากบรรทัด Tax ID ได้ — ตั้งกว้างกว่า
# Default (30px) เพราะบาง Vendor (เช่น ECOLAB) มีที่อยู่คั่นกลางหลายบรรทัด
# ระหว่างชื่อบริษัทกับบรรทัด Tax ID จริง ทำให้ระยะห่างเกิน 30px ไปมาก
#
# Patch 84: แยกเป็น Asymmetric — ชื่อ Vendor มักอยู่ "ก่อน" (Above) บรรทัด
# Tax ID เสมอ จึงต้องการระยะกว้าง (140px) ส่วน "หลัง" (Below) Tax ID มักเป็น
# ข้อมูลอื่น เช่น Bank Information / Account Name ที่ไม่ใช่ชื่อ Vendor —
# ใช้ระยะแคบ (20px) กันดึงข้อความผิดโซนมาเป็น False Positive
# (พบจริง: "Account Name: Ecolab Limited" หลุดมาเป็น Supplier Name เพราะ
# ตอนนั้นยังใช้ 140px สมมาตรทั้งสองทิศทาง)
VENDOR_NAME_Y_TOLERANCE = 140       # ค่าเดิม เก็บไว้เผื่อมี Reference อื่นในอนาคต
VENDOR_NAME_Y_TOLERANCE_ABOVE = 140
VENDOR_NAME_Y_TOLERANCE_BELOW = 20


def extract_vendor_name_from_ocr(raw_ocr_result, vendor_tax_id):
    """หาชื่อ Vendor จาก OCR โดยตรง (ไม่ต้องพึ่งการ Match กับ supplier_list สำเร็จ)
    เพราะ supplier_name (จาก Master Data) จะว่างเปล่าถ้า Vendor ยังไม่มีในระบบ —
    Field นี้ช่วยให้พนักงานยังเห็น "ชื่อที่ OCR อ่านได้" เสมอ แม้ Match ไม่เจอ"""
    # กันไม่ให้จับข้อความจากช่อง "บัญชีธนาคารสำหรับโอนเงิน" มาเข้าใจผิดว่าเป็น
    # ชื่อบริษัท — ข้อความแบบ "Account Name: Ecolab Limited" ก็มีคำว่า
    # "Limited" ปนอยู่ด้วย ผ่าน keyword check เดิมได้ทั้งที่ไม่ใช่ชื่อบริษัท
    # (พบจริงกับ ECOLAB.pdf บางหน้าที่ดึงชื่อผิดเป็น "Account Name: ...")
    BANK_DETAIL_EXCLUDE_KEYWORDS = (
        "account name", "account no", "account number", "bank name",
        "ชื่อบัญชี", "เลขที่บัญชี", "ธนาคาร", "swift", "iban",
    )

    def _matcher(text):
        t = text.strip()
        t_lower = t.lower()
        if any(kw in t_lower for kw in BANK_DETAIL_EXCLUDE_KEYWORDS):
            return None
        if len(t) > 5 and re.search(
            r'(ltd|limited|co\.|จำกัด|บริษัท|ห้างหุ้นส่วน|หจก|บจก)', t_lower
        ):
            return t
        return None
    return find_text_near_tax_id(
        raw_ocr_result, vendor_tax_id, _matcher,
        y_tolerance_above=VENDOR_NAME_Y_TOLERANCE_ABOVE,
        y_tolerance_below=VENDOR_NAME_Y_TOLERANCE_BELOW,
    )


# ==================================================================
# Line Item Extraction (Phase 3b)
# หลักการ: หา Column Header ของตารางก่อน (Item No, Description, Amount, ...)
# แล้ว Group ข้อความที่เหลือตามตำแหน่ง Y ใกล้เคียงกัน = 1 แถว
# จากนั้นจับคู่แต่ละค่าในแถว เข้ากับ Column ตามตำแหน่ง X ที่ใกล้ที่สุด
# ==================================================================

LINE_ITEM_COLUMN_KEYWORDS = {
    "item_no": ["item no", "ลำดับที่"],
    "material_no": ["material no", "รหัสสินค้า"],
    "description": ["material description", "description", "รายละเอียดสินค้า"],
    "quantity": ["quantity", "จำนวน"],
    "uom": ["uom", "หน่วยนับ"],
    "unit_price": ["unit price", "ราคาต่อหน่วย"],
    "amount": ["amount", "จำนวนเงิน"],
}

# Keyword ที่บ่งบอกว่าตารางจบแล้ว (เจอแล้วให้หยุดเก็บแถว)
LINE_ITEM_END_KEYWORDS = [
    "sub total", "subtotal", "invoice notes", "customer notes", "vat", "net weight", "gross weight",
]


def _item_x(item):
    """หาตำแหน่ง X ซ้ายสุดของกล่องข้อความ จาก bbox"""
    bbox = item.get("bbox")
    if bbox and len(bbox) > 0:
        return bbox[0][0]
    return item.get("x", 0)


def find_line_item_header(raw_ocr_result, y_bucket=15):
    """หาแถว Column Header ของตาราง Line Item โดยหาว่า y ตำแหน่งไหน
    มี Keyword ของ Column ต่างๆ มากระจุกกันอย่างน้อย 3 Column ขึ้นไป
    คืนค่า (columns_x_map, header_y) หรือ None ถ้าหาไม่เจอ"""
    candidates = []
    for item in raw_ocr_result:
        text_lower = item.get("text", "").lower()
        for col, kws in LINE_ITEM_COLUMN_KEYWORDS.items():
            if any(re.search(r'\b' + re.escape(kw) + r'\b', text_lower) for kw in kws):
                candidates.append((item, col))
                break

    if len(candidates) < 3:
        return None

    buckets = {}
    for item, col in candidates:
        key = round(item.get("y_center", 0) / y_bucket)
        buckets.setdefault(key, []).append((item, col))

    best = max(buckets.values(), key=len)
    if len(best) < 3:
        return None

    columns = {col: _item_x(item) for item, col in best}
    header_y = sum(item.get("y_center", 0) for item, _ in best) / len(best)
    return columns, header_y


def group_rows_by_y(items, y_tolerance=10):
    """จัดกลุ่มข้อความที่ y ใกล้เคียงกัน (ในระยะ y_tolerance) ให้เป็นแถวเดียวกัน
    คืนค่า List ของแถว แต่ละแถวคือ List ของ Item ที่เรียงจากซ้ายไปขวา"""
    sorted_items = sorted(items, key=lambda i: i.get("y_center", 0))
    rows = []
    current_row = []
    last_y = None
    for item in sorted_items:
        y = item.get("y_center", 0)
        if last_y is None or abs(y - last_y) <= y_tolerance:
            current_row.append(item)
        else:
            rows.append(sorted(current_row, key=_item_x))
            current_row = [item]
        last_y = y
    if current_row:
        rows.append(sorted(current_row, key=_item_x))
    return rows


def detect_table_row_bands(image_path, header_y, table_end_y):
    """ใช้ OpenCV หาเส้นตารางแนวนอนในภาพ (ระหว่าง header_y ถึง table_end_y)
    คืนค่า List ของ (y_start, y_end) แต่ละคู่คือขอบเขตแนวตั้งของ 1 แถวจริง
    (ตามเส้นที่มองเห็นในภาพ ไม่ใช่การเดาจาก Y ใกล้เคียงแบบ Group-by-Y)
    คืนค่า None ถ้าหาเส้นไม่เจอเลย (เอกสารไม่มีเส้นตารางชัดเจน) — ให้ผู้เรียก Fallback
    ไปใช้ Group-by-Y แทน"""
    if not CV2_AVAILABLE:
        return None
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, -2
        )
        # หาเส้นแนวนอนโดยใช้ Morphology (เส้นที่ยาวในแนวนอน)
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
        detected = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)

        # หา y ของแต่ละเส้นแนวนอน (แถวที่มีจำนวนพิกเซลขาวเยอะ = เส้นตาราง)
        row_sums = detected.sum(axis=1)
        threshold = row_sums.max() * 0.3 if row_sums.max() > 0 else 0
        line_ys = [y for y, val in enumerate(row_sums) if val > threshold and header_y - 20 <= y <= table_end_y + 20]

        if len(line_ys) < 2:
            return None  # เจอเส้นไม่พอ (น้อยกว่า 2 เส้น = แบ่งแถวไม่ได้) -> Fallback

        # รวมเส้นที่อยู่ติดกัน (ภายใน 3px) ให้เป็นเส้นเดียว
        merged = [line_ys[0]]
        for y in line_ys[1:]:
            if y - merged[-1] > 3:
                merged.append(y)

        bands = [(merged[i], merged[i + 1]) for i in range(len(merged) - 1)]
        return bands if bands else None
    except Exception as e:
        print(f"[worker] WARNING: detect_table_row_bands ล้มเหลว: {e}")
        return None


def extract_line_items(raw_ocr_result, image_path=None):
    """ดึงรายการสินค้าทั้งหมดจากตาราง Line Item ของเอกสาร
    ถ้ามี image_path และเจอเส้นตารางจริง (OpenCV) จะใช้เส้นจริงแบ่งแถว (แม่นกว่า)
    ถ้าไม่มีเส้นตาราง Fallback ไปใช้ Group-by-Y (เดาจากตำแหน่ง Y ใกล้เคียงกัน)
    คืนค่า List ของ dict เช่น [{"item_no": "700003", "description": "...", "amount": "700.50", ...}, ...]
    หรือ List ว่างถ้าหาตาราง/Column Header ไม่เจอเลย (ไม่ Fail ทั้งระบบ แค่ไม่มี Line Item ให้)"""
    header = find_line_item_header(raw_ocr_result)
    if not header:
        return []
    columns, header_y = header
    sorted_columns = sorted(columns.items(), key=lambda c: c[1])  # เรียง Column ซ้ายไปขวา

    # เก็บเฉพาะข้อความที่อยู่ใต้ Header (แถวข้อมูลจริง) จนกว่าจะเจอ Keyword จบตาราง
    data_items = []
    table_end_y = None
    for item in sorted(raw_ocr_result, key=lambda i: i.get("y_center", 0)):
        y = item.get("y_center", 0)
        if y <= header_y + 5:
            continue
        text_lower = item.get("text", "").lower()
        if any(kw in text_lower for kw in LINE_ITEM_END_KEYWORDS):
            table_end_y = y
            break
        data_items.append(item)
    if table_end_y is None and data_items:
        table_end_y = max(i.get("y_center", 0) for i in data_items) + 20

    row_bands = None
    if image_path and table_end_y:
        row_bands = detect_table_row_bands(image_path, header_y, table_end_y)

    if row_bands:
        # ---------------- ใช้เส้นตารางจริง (OpenCV) แบ่งแถว — แม่นกว่า ----------------
        print(f"[worker] [debug] extract_line_items: ใช้ OpenCV Table Detection ({len(row_bands)} แถว)")
        rows = []
        for y_start, y_end in row_bands:
            row_items = [i for i in data_items if y_start <= i.get("y_center", 0) <= y_end]
            if row_items:
                rows.append(sorted(row_items, key=_item_x))
    else:
        # ---------------- Fallback: Group-by-Y (เดาจากตำแหน่ง Y ใกล้เคียงกัน) ----------------
        print(f"[worker] [debug] extract_line_items: ไม่เจอเส้นตาราง -> Fallback ไปใช้ Group-by-Y")
        rows = group_rows_by_y(data_items)

    line_items = []
    for row in rows:
        if not row:
            continue
        record = {}
        for item in row:
            item_x = _item_x(item)
            nearest_col = min(sorted_columns, key=lambda c: abs(c[1] - item_x))[0]
            existing = record.get(nearest_col, "")
            record[nearest_col] = (existing + " " + item.get("text", "")).strip()
        if record:
            line_items.append(record)

    # กรอง "แถวปลอม" ออก — Line Item จริงต้องมี Amount เสมอ
    # (แถวที่ไม่มี Amount มักเป็นแค่ข้อความเสริมใน Description เช่น Contract Number, Period)
    # กรอง "แถวปลอม" ออก — Line Item จริงต้องมี Amount ที่เป็น "ตัวเลขเงินจริง" เท่านั้น
    # (ไม่ใช่แค่มีข้อความอะไรก็ได้ใน field "amount" — OCR Confidence ต่ำบางจุด
    # อาจให้ข้อความมั่ว เช่น "RCIMCRLO" ซึ่งเป็น Truthy แต่ไม่ใช่ตัวเลขเงินเลย)
    def _looks_like_amount(value):
        return bool(re.fullmatch(r'[\d,]+\.\d{2}', value.strip())) if value else False

    line_items = [li for li in line_items if _looks_like_amount(li.get("amount", ""))]
    return line_items


def auto_match_supplier(conn, set_id):
    """เมื่อปิดชุดแล้ว: ดึง Tax ID ทั้งหมดในชุดนั้น -> กรอง Tax ID ของบริษัทเราออก
    (company_list) -> Match ตัวที่เหลือกับ supplier_list -> อัพเดต ocr_sets.supplier_id
    ถ้า Match ได้ (Auto-fill เบื้องต้น พนักงานยังต้องตรวจสอบก่อน Approve เสมอ)"""
    print(f"[worker] [debug] auto_match_supplier เริ่มทำงาน set={set_id}")
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT raw_ocr_result, image_path FROM ocr_queue_pages WHERE set_id = %s AND raw_ocr_result IS NOT NULL ORDER BY page_number",
                (set_id,),
            )
            rows = cur.fetchall()
        print(f"[worker] [debug] เจอ {len(rows)} หน้าที่มี raw_ocr_result")

        all_tax_ids = set()
        all_raw_items = []
        first_page_image_path = rows[0]["image_path"] if rows else None
        for row in rows:
            raw = row["raw_ocr_result"]
            if isinstance(raw, str):
                raw = json.loads(raw)
            all_raw_items.extend(raw)
            all_tax_ids.update(extract_tax_ids(raw))
        print(f"[worker] [debug] Tax ID ที่เจอทั้งหมด: {all_tax_ids}")

        # ---------------- ขั้นที่ 1: Match Supplier ก่อน (ต้องรู้ supplier_id ก่อนถึงจะโหลด Pattern ได้) ----------------
        matched_supplier_id = None
        buyer_company_name = None
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                'SELECT "TAX ID", "ENGLISH COMPANY NAME" FROM company_list WHERE "TAX ID" = ANY(%s) AND deleted = false',
                (list(all_tax_ids) or [''],),
            )
            own_company_rows = cur.fetchall()
            own_tax_ids = {r["TAX ID"] for r in own_company_rows}
            if own_company_rows:
                buyer_company_name = own_company_rows[0]["ENGLISH COMPANY NAME"]
            print(f"[worker] [debug] Tax ID ของบริษัทเรา (กรองออก): {own_tax_ids} ชื่อ: {buyer_company_name}")
            vendor_tax_ids = list(all_tax_ids - own_tax_ids)
            print(f"[worker] [debug] Tax ID ผู้ขายที่เหลือ: {vendor_tax_ids}")

            vendor_tax_id_value = vendor_tax_ids[0] if vendor_tax_ids else None
            buyer_tax_id_value = next(iter(own_tax_ids), None)

            if vendor_tax_ids:
                cur.execute(
                    'SELECT id, "Supplier Name" FROM supplier_list '
                    'WHERE "Tax ID" = ANY(%s) AND "Tax ID" != \'\' AND deleted = false LIMIT 1',
                    (vendor_tax_ids,),
                )
                match = cur.fetchone()
                print(f"[worker] [debug] ผล Match กับ supplier_list: {match}")
                if match:
                    matched_supplier_id = match["id"]
                    with conn.cursor() as cur2:
                        cur2.execute(
                            "UPDATE ocr_sets SET supplier_id = %s WHERE id = %s",
                            (matched_supplier_id, set_id),
                        )
                    print(f"[worker] Auto-match supplier: set={set_id} -> {match['Supplier Name']}")

                # เก็บ Tax ID ทั้งสองฝั่งไว้ใน ocr_extracted_fields — ผู้ขาย (Vendor) และผู้ซื้อ (เรา)
                # เพื่อให้พนักงานเห็นค่าที่ OCR อ่านได้ ตรวจสอบ/แก้ไขได้ในหน้า Approve
                with conn.cursor() as cur3:
                    cur3.execute(
                        """
                        INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                        VALUES (%s, 'tax_id', %s, %s)
                        ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                        """,
                        (set_id, vendor_tax_id_value, 0.99),
                    )
                    if buyer_tax_id_value:
                        # Patch 90: เปลี่ยนจาก DO NOTHING เป็น Confidence-based เพราะเคยเจอ Bug
                        # จริง — local_group_and_release_batch() Insert buyer_tax_id ผิดค่า
                        # (Tax ID ผู้ขาย ไม่ใช่ผู้ซื้อ) ไว้ก่อนด้วย Confidence แค่ 0.6 แล้วค่าที่
                        # ถูกต้องตรงนี้ (0.99) โดน DO NOTHING บล็อกไว้ ทำให้ BU ขึ้น "-" เสมอ
                        cur3.execute(
                            """
                            INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                            VALUES (%s, 'buyer_tax_id', %s, %s)
                            ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                            """,
                            (set_id, buyer_tax_id_value, 0.99),
                        )
                    if buyer_company_name:
                        cur3.execute(
                            """
                            INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                            VALUES (%s, 'buyer_name', %s, %s)
                            ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                            """,
                            (set_id, buyer_company_name, 0.99),
                        )
                    if matched_supplier_id and match:
                        # Patch 90: Confidence-based แทน DO NOTHING (มาตรฐานเดียวกันทั้งไฟล์)
                        cur3.execute(
                            """
                            INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                            VALUES (%s, 'supplier_name', %s, %s)
                            ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                            """,
                            (set_id, match["Supplier Name"], 0.95),
                        )
                conn.commit()

        # ---------------- ขั้นที่ 2: โหลด Pattern เฉพาะของ Vendor นี้ (ถ้ามี) ----------------
        pattern = get_vendor_pattern(conn, matched_supplier_id)
        print(f"[worker] [debug] vendor_pattern โหลดได้: {'มี Pattern' if pattern else 'ไม่มี ใช้ Default Keyword'}")

        # ---------------- ขั้นที่ 3: ดึง Field อื่นๆ โดยใช้ Pattern ถ้ามี ไม่มีก็ใช้ Default ----------------
        total_amount = extract_total_amount(all_raw_items, pattern)
        subtotal = extract_subtotal(all_raw_items, pattern)
        vat = extract_vat(all_raw_items, pattern)
        invoice_no = extract_invoice_no(all_raw_items, pattern)
        document_type = extract_document_type(all_raw_items)
        invoice_date = extract_invoice_date(all_raw_items, pattern)
        vendor_branch_code = extract_branch_code_for(all_raw_items, vendor_tax_id_value)
        buyer_branch_code = extract_branch_code_for(all_raw_items, buyer_tax_id_value) or "00000"
        # หาไม่เจอในเอกสาร -> Default เป็น "00000" (สำนักงานใหญ่) เพราะเราแทบทุกกรณีเป็นสำนักงานใหญ่
        # พนักงานยังแก้ไขได้เองถ้าไม่ตรงจริง (ค่านี้แค่ Pre-fill ไว้ให้)
        vendor_name_ocr = extract_vendor_name_from_ocr(all_raw_items, vendor_tax_id_value)
        line_items = extract_line_items(all_raw_items, image_path=first_page_image_path)
        print(f"[worker] [debug] total={total_amount} subtotal={subtotal} vat={vat} invoice_no={invoice_no} "
              f"document_type={document_type} invoice_date={invoice_date} "
              f"vendor_branch={vendor_branch_code} buyer_branch={buyer_branch_code} vendor_name_ocr={vendor_name_ocr} "
              f"line_items={len(line_items)} รายการ")
        for li in line_items:
            print(f"[worker] [debug]   line_item: {li}")

        is_valid, validation_detail = cross_validate_amounts(subtotal, vat, total_amount)
        print(f"[worker] [debug] cross-validate (subtotal+vat=total): valid={is_valid} detail={validation_detail}")

        # Auto-correct: ถ้า Total ที่ Extract มาได้ "ผิดชัดเจน" (น้อยกว่า Subtotal อย่างไม่สมเหตุสมผล
        # เช่น Total=7.00 แต่ Subtotal=13,500.00) และเรามี Subtotal+VAT ที่เป็นตัวเลขเงินถูก Format
        # ให้ใช้ผลคำนวณ (Subtotal+VAT) แทนค่า Total ที่ผิด — ปลอดภัยกว่าปล่อยค่าผิดชัดเจนไปให้พนักงานเห็น
        if subtotal and vat:
            try:
                calculated_total = round(float(subtotal) + float(vat), 2)
                if total_amount is None or float(total_amount) < float(subtotal):
                    print(f"[worker] [debug] Total ที่ Extract ({total_amount}) ผิดปกติ (< Subtotal) "
                          f"-> ใช้ค่าคำนวณแทน: {calculated_total}")
                    total_amount = f"{calculated_total:.2f}"
                    is_valid, validation_detail = cross_validate_amounts(subtotal, vat, total_amount)
            except (ValueError, TypeError):
                pass

        with conn.cursor() as cur_fields:
            for field_name, field_value in [
                ("total_amount", total_amount),
                ("subtotal", subtotal),
                ("vat_amount", vat),
            ]:
                if field_value:
                    cur_fields.execute(
                        """
                        INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                        """,
                        (set_id, field_name, field_value, 0.8),
                    )

            # ถ้าตรวจสอบได้และไม่สอดคล้องกัน -> บันทึก Flag เตือนพนักงานก่อน Approve
            if is_valid is False:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_validation_flags (set_id, flag_type, flag_detail, severity)
                    VALUES (%s, 'amount_mismatch', %s, 'warning')
                    """,
                    (set_id, json.dumps(validation_detail, ensure_ascii=False)),
                )
                print(f"[worker] WARNING: ยอดเงินไม่สอดคล้องกัน set={set_id} -> {validation_detail}")

            if invoice_no:
                # Patch 90: Confidence-based แทน DO NOTHING — เคยเสี่ยงโดน local_group_and_release_batch()
                # Insert invoice_no คร่าวๆ (0.6) บล็อกค่าที่แม่นกว่าตรงนี้ (0.8) ไว้เหมือน buyer_tax_id
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'invoice_no', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, invoice_no, 0.8),
                )
                cur_fields.execute(
                    "UPDATE ocr_sets SET invoice_no = %s WHERE id = %s AND invoice_no IS NULL",
                    (invoice_no, set_id),
                )

            if document_type:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'document_type', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, document_type, 0.9),
                )

            if invoice_date:
                # Patch 90: Confidence-based แทน DO NOTHING (มาตรฐานเดียวกันทั้งไฟล์)
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'invoice_date', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, invoice_date, 0.8),
                )

            if vendor_branch_code:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'vendor_branch_code', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, vendor_branch_code, 0.8),
                )

            if buyer_branch_code:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'buyer_branch_code', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, buyer_branch_code, 0.8),
                )

            if vendor_name_ocr:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'vendor_name_ocr', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, vendor_name_ocr, 0.7),
                    # Confidence ต่ำกว่า supplier_name (Master Data) เพราะดึงจาก OCR ตรงๆ
                    # อาจไม่แม่นเท่าชื่อที่ยืนยันจาก Master Data
                )

            if line_items:
                line_items_json = json.dumps(line_items, ensure_ascii=False)
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'line_items', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, line_items_json, 0.6),
                    # Confidence ต่ำกว่า Field อื่นตั้งใจ — Group-by-Y ยังไม่เคยทดสอบจริง
                    # ต้องให้พนักงานตรวจสอบละเอียดกว่า Field อื่นเสมอ
                )
        conn.commit()
        print(f"[worker] [debug] auto_match_supplier เสร็จสิ้น set={set_id}")
    except Exception as e:
        print(f"[worker] WARNING: auto_match_supplier ล้มเหลว (set={set_id}): {e}")
        conn.rollback()


def update_set_progress(conn, set_id):
    """คำนวณ % Progress ของ Set จาก Line Items ที่อ่านสะสมได้ เทียบกับ
    expected_line_count ที่ Gemini นับไว้ล่วงหน้า — เรียกทุกครั้งที่มี
    หน้าใหม่เสร็จ (ไม่ต้องรอปิด Set ครบ) ให้ Frontend เห็น % แบบสดๆ"""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT expected_line_count FROM ocr_sets WHERE id = %s", (set_id,))
            row = cur.fetchone()
            expected = row["expected_line_count"] if row else None
            if not expected:
                return  # Gemini ไม่ได้นับไว้ (หรือเป็น Flow Fallback) -> คำนวณ % ไม่ได้ ข้าม

            cur.execute(
                "SELECT raw_ocr_result FROM ocr_queue_pages WHERE assigned_set_id = %s "
                "AND status = 'done' AND raw_ocr_result IS NOT NULL ORDER BY page_number",
                (set_id,),
            )
            rows = cur.fetchall()

        all_raw_items = []
        for r in rows:
            raw = r["raw_ocr_result"]
            if isinstance(raw, str):
                raw = json.loads(raw)
            all_raw_items.extend(raw)

        line_items = extract_line_items(all_raw_items)
        actual_count = len(line_items)
        pct = min(100.0, round((actual_count / expected) * 100, 2)) if expected else 0.0

        with conn.cursor() as cur2:
            cur2.execute("UPDATE ocr_sets SET progress_pct = %s WHERE id = %s", (pct, set_id))
        conn.commit()
        print(f"[worker] [debug] update_set_progress set={set_id} {actual_count}/{expected} = {pct}%")
    except Exception as e:
        print(f"[worker] WARNING: update_set_progress ล้มเหลว (set={set_id}): {e}")
        conn.rollback()


def extract_document_type_only(conn, set_id, reject_type=None):
    """สำหรับชุดที่ถูก Reject — ดึงแค่ document_type ให้รู้สาเหตุที่ Reject
    ไม่ทำ Field อื่น (total/subtotal/vat/invoice_no/line_items) และไม่ Match
    Supplier เพราะไม่มีประโยชน์กับเอกสารที่ไม่ใช่ Tax Invoice

    ถ้ามี reject_type ส่งมา (จาก has_reject_keyword ตอนตรวจจับ Reject) ใช้ตรงๆ
    เลย ไม่ต้องเดาใหม่ด้วย extract_document_type() (ตัวเต็มที่มี Priority
    Ladder จับ tax_invoice ผิดได้ ถ้าหน้ามีคำว่า "เลขที่ใบกำกับภาษี" ปนอยู่)"""
    try:
        if reject_type:
            document_type = reject_type
            print(f"[worker] [debug] extract_document_type_only (rejected) set={set_id} ใช้ reject_type ที่ Match ไว้แล้ว: {document_type}")
        else:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT raw_ocr_result FROM ocr_queue_pages WHERE set_id = %s AND raw_ocr_result IS NOT NULL ORDER BY page_number",
                    (set_id,),
                )
                rows = cur.fetchall()
            all_raw_items = []
            for row in rows:
                raw = row["raw_ocr_result"]
                if isinstance(raw, str):
                    raw = json.loads(raw)
                all_raw_items.extend(raw)

            document_type = extract_document_type(all_raw_items)
            print(f"[worker] [debug] extract_document_type_only (rejected) set={set_id} document_type={document_type} (Fallback เดาเอง ไม่มี reject_type ส่งมา)")
        if document_type:
            with conn.cursor() as cur_fields:
                cur_fields.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, 'document_type', %s, %s)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, document_type, 0.9),
                )
            conn.commit()
    except Exception as e:
        print(f"[worker] WARNING: extract_document_type_only ล้มเหลว (set={set_id}): {e}")
        conn.rollback()


def close_current_set(conn, set_id, rejected=False):
    """ปิดชุดปัจจุบัน -> ready_for_review (หรือ rejected ถ้าตรวจพบว่าไม่ใช่ Tax Invoice)
    concept เดิม: เสร็จชุดไหน ปล่อยชุดนั้นออกมาเลย"""
    if set_id is None:
        return
    final_status = "rejected" if rejected else "ready_for_review"
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ocr_sets
            SET status = %s, completed_at = NOW(),
                total_pages = (SELECT COUNT(*) FROM ocr_queue_pages WHERE set_id = %s)
            WHERE id = %s AND status NOT IN ('ready_for_review', 'rejected')
            """,
            (final_status, set_id, set_id),
        )
        conn.commit()
        print(f"[worker] ปิดชุด {set_id} -> {final_status}")
        if rejected:
            # rejected ตอนนี้เป็น Type String ('quotation'/'purchase_order') อยู่แล้ว
            # (มาจาก has_reject_keyword ที่ Track ผ่าน State) ส่งต่อตรงๆ ไม่ต้องเดาใหม่
            reject_type = rejected if isinstance(rejected, str) else None
            extract_document_type_only(conn, set_id, reject_type=reject_type)
        else:
            auto_match_supplier(conn, set_id)


def open_new_set(conn, batch_id, uploaded_by):
    """เปิดชุดใหม่ สำหรับหน้าที่ตรวจพบว่าเป็นหัวเอกสารใหม่"""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            INSERT INTO ocr_sets (uploaded_by, batch_id, status, ocr_engine, ocr_dpi)
            VALUES (%s, %s, 'processing', 'paddleocr', 150)
            RETURNING id
            """,
            (uploaded_by, batch_id),
        )
        new_set_id = cur.fetchone()["id"]
        cur.execute(
            "UPDATE ocr_upload_batches SET current_open_set_id = %s WHERE id = %s",
            (new_set_id, batch_id),
        )
        conn.commit()
        print(f"[worker] เปิดชุดใหม่ {new_set_id} (batch {batch_id})")
        return new_set_id


def get_batch_info(conn, batch_id):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT uploaded_by, current_open_set_id, total_pages FROM ocr_upload_batches WHERE id = %s",
            (batch_id,),
        )
        return cur.fetchone()


def is_last_page_of_batch(conn, batch_id, page_number):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT total_pages FROM ocr_upload_batches WHERE id = %s", (batch_id,)
        )
        total = cur.fetchone()[0]
        return page_number >= total


def save_page_result(conn, page_id, set_id, ocr_result, avg_confidence, elapsed_seconds):
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ocr_queue_pages
            SET status = 'done', set_id = %s, raw_ocr_result = %s,
                avg_confidence = %s, elapsed_seconds = %s, completed_at = NOW()
            WHERE id = %s
            """,
            (set_id, json.dumps(ocr_result, ensure_ascii=False), avg_confidence, elapsed_seconds, page_id),
        )
        conn.commit()


def mark_page_failed(conn, page_id, error_message):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ocr_queue_pages SET status = 'failed', error_message = %s, completed_at = NOW() WHERE id = %s",
            (error_message[:2000], page_id),
        )
        conn.commit()


def local_group_and_release_batch(conn, ocr, batch_id):
    """Fallback Grouping เมื่อ Gemini ใช้ไม่ได้ — หาจุดตัดเอกสารให้เสร็จ
    "ก่อน" ปล่อยหน้าเข้าคิว OCR เต็มรูปแบบเสมอ (แทนที่จะปล่อยให้จุดตัดถูก
    เดาแบบ Real-time ระหว่าง Full OCR อย่างที่เคยเป็น) ทำแบบเดียวกับที่
    Gemini ทำใน apply-groups/:batchId — แค่ใช้ PaddleOCR อ่านเฉพาะแถบ
    หัวกระดาษของแต่ละหน้า (run_header_ocr) แทนการยิง Gemini อ่านทั้งภาพ

    กฎจับกลุ่ม (3 ข้อ ตามที่ตกลงกันไว้ — must_pair ชนะเสมอ):
      1. tax_id + invoice_no ตรงกับหน้าก่อนหน้า -> เอกสารเดียวกัน
      2. tax_id หรือ invoice_no ต่างจากหน้าก่อนหน้า -> เอกสารใหม่
      3. หน้านี้ไม่มี tax_id/invoice_no เลย (ตารางต่อ ไม่มีหัวกระดาษ)
         -> ถือเป็นเอกสารเดียวกับหน้าก่อนหน้า (เอกสารใหม่ต้องมีหัวกระดาษเสมอ)
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, page_number, image_path FROM ocr_queue_pages "
            "WHERE batch_id = %s AND status = 'local_grouping' "
            "ORDER BY page_number",
            (batch_id,),
        )
        pages = cur.fetchall()

    if not pages:
        return

    batch_info = get_batch_info(conn, batch_id)
    if batch_info is None:
        # Batch ถูกลบไปแล้ว (เช่น คนกดลบทิ้งจากหน้า Job Queue) แต่หน้าที่
        # ค้างอยู่ใน ocr_queue_pages ไม่ได้ถูกลบตามไปด้วย -- ข้อมูลกำพร้า
        # ถ้าปล่อยให้พยายาม insert ocr_sets ต่อจะ error (FK violation) ซ้ำ
        # ไม่มีวันจบ เพราะ fetch_batch_needing_local_grouping() จะหยิบ
        # batch เดิมซ้ำทุกรอบ บล็อกไม่ให้ batch อื่นที่รอ OCR ปกติได้คิวเลย
        # -> ต้อง mark เป็น failed แล้วปล่อยผ่านทันที ไม่ retry
        page_ids = [p["id"] for p in pages]
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ocr_queue_pages SET status = 'failed', "
                "error_message = 'batch_id not found in ocr_upload_batches (orphaned page, batch was likely deleted)', "
                "completed_at = NOW() WHERE id = ANY(%s::int[])",
                (page_ids,),
            )
            conn.commit()
        print(f"[worker] [local-grouping] batch={batch_id} ไม่พบใน ocr_upload_batches (กำพร้า) -> mark {len(page_ids)} หน้าเป็น failed แล้วข้าม")
        return

    uploaded_by = batch_info["uploaded_by"]

    print(f"[worker] [local-grouping] เริ่ม batch={batch_id} ({len(pages)} หน้า) — OCR เฉพาะแถบหัวกระดาษ")

    # ---- Pass 1: OCR แถบหัวกระดาษทุกหน้า เก็บ tax_id/invoice_no ----
    page_signals = []
    for p in pages:
        try:
            header_result = run_header_ocr(ocr, p["image_path"])
            tax_ids = extract_tax_ids(header_result)
            invoice_no = extract_invoice_no(header_result)
            # Patch 103: หา Doc Type จาก header_result เดิม (ไม่เพิ่ม OCR รอบใหม่
            # เลย) — ใช้เสริมกฎที่ 3 กันเผลอ Merge ข้ามประเภทเอกสารตอนแถบ
            # หัวกระดาษอ่าน Tax ID/Invoice No ไม่เจอ (เช่น สแกนเอียง)
            doc_type = detect_doc_type(header_result)
        except Exception as e:
            print(f"[worker] [local-grouping] WARNING: header OCR พัง page={p['page_number']}: {e}")
            tax_ids, invoice_no, doc_type = [], None, None
        page_signals.append({
            "page_id": p["id"],
            "page_number": p["page_number"],
            "tax_id": tax_ids[0] if tax_ids else None,
            "invoice_no": invoice_no,
            "doc_type": doc_type,
        })

    # ---- Pass 2: จัดกลุ่มตาม 3 กฎ ----
    groups = [[page_signals[0]]]
    for curr in page_signals[1:]:
        anchor = groups[-1][-1]
        has_header = bool(curr["tax_id"] or curr["invoice_no"])
        if not has_header:
            # Patch 103: กฎ 3 เดิม Merge แบบไม่มีเงื่อนไขเลย (เสี่ยงถ้าแถบ
            # หัวกระดาษอ่าน Tax ID/Invoice No ไม่เจอ แต่จริงๆ เป็นคนละ
            # ประเภทเอกสาร) — เสริมเช็ค doc_type ก่อน ถ้าตรวจพบและต่างจาก
            # Anchor ชัดเจน ห้าม Merge แม้ไม่มี Tax ID/Invoice No ก็ตาม
            if curr["doc_type"] and anchor["doc_type"] and curr["doc_type"] != anchor["doc_type"]:
                groups.append([curr])  # กฎ 3b (ใหม่): doc_type ต่างกันชัดเจน แม้ไม่มี Header
            else:
                groups[-1].append(curr)  # กฎ 3: ไม่มีหัวเอกสาร = ต่อจากก้อนเดิม
            continue
        same_doc = (curr["tax_id"] == anchor["tax_id"] and curr["invoice_no"] == anchor["invoice_no"])
        if same_doc:
            groups[-1].append(curr)  # กฎ 1
        else:
            groups.append([curr])  # กฎ 2

    # ---- Pass 3: สร้าง ocr_sets ล่วงหน้า + ปลดล็อกเข้าคิว OCR เต็มรูปแบบ ----
    with conn.cursor() as cur:
        for group in groups:
            page_ids = [g["page_id"] for g in group]
            tax_id = group[0]["tax_id"]
            invoice_no = group[0]["invoice_no"]

            cur.execute(
                """
                INSERT INTO ocr_sets (batch_id, uploaded_by, status, ocr_engine, ocr_dpi, total_pages)
                VALUES (%s, %s, 'processing', 'paddleocr', 150, %s)
                RETURNING id
                """,
                (batch_id, uploaded_by, len(page_ids)),
            )
            set_id = cur.fetchone()[0]

            # Confidence 0.6 (ต่ำกว่า Gemini ที่ให้ 0.98 ไว้) เพราะอ่านจากแค่
            # แถบหัวกระดาษด้วย PaddleOCR ธรรมดา ไม่ใช่ Multimodal เต็มภาพแบบ
            # Gemini — ค่า field พวกนี้ยังไงก็จะถูกอ่านซ้ำอีกทีตอน Full OCR
            # ของแต่ละหน้าอยู่ดี ใช้แค่เป็นตัวช่วยจัดกลุ่มล่วงหน้าเท่านั้น
            #
            # Patch 90: เปลี่ยนจาก DO NOTHING เป็น Confidence-based — นี่คือ
            # ตัวการจริงของ Bug "BU ขึ้น -" เพราะ tax_id ตัวแรกที่เจอในแถบ
            # หัวกระดาษ มักเป็น Tax ID ผู้ขาย (ไม่ใช่ผู้ซื้อ) แต่ถูกยัดใส่ field
            # ชื่อ buyer_tax_id ไปแบบผิดๆ ด้วย Confidence แค่ 0.6 แล้วค่าที่
            # auto_match_supplier() หามาได้ถูกต้องทีหลัง (0.99) โดน DO NOTHING
            # บล็อกไว้ไม่ให้บันทึกทับเลย
            # Patch 103: บันทึก document_type ไปด้วย (ใช้ค่าจากหน้าแรกของกลุ่ม
            # เหมือน invoice_no/tax_id) — ให้ suggest_related_sets()/UI ใช้ต่อได้
            group_doc_type = group[0]["doc_type"]
            for field_name, value in (("invoice_no", invoice_no), ("buyer_tax_id", tax_id), ("document_type", group_doc_type)):
                if not value:
                    continue
                cur.execute(
                    """
                    INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                    VALUES (%s, %s, %s, 0.6)
                    ON CONFLICT (set_id, field_name) DO UPDATE SET ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence
                    """,
                    (set_id, field_name, value),
                )

            cur.execute(
                "UPDATE ocr_queue_pages SET assigned_set_id = %s, status = 'pending' WHERE id = ANY(%s::int[])",
                (set_id, page_ids),
            )

            # Commit ทีละชุดทันที (ไม่รอจนครบทุกชุดในลูปนี้ก่อน) — ให้ชุดที่
            # เพิ่ง split เสร็จ โผล่ในหน้า Job Queue ได้ทันที ไม่ต้องรอให้
            # batch ทั้งก้อน (อาจมีหลายสิบชุด) split ครบก่อนถึงจะเห็นอะไรเลย
            conn.commit()

            page_range = f"{group[0]['page_number']}-{group[-1]['page_number']}" if len(group) > 1 else str(group[0]['page_number'])
            print(f"[worker] [local-grouping] set={set_id} หน้า {page_range} invoice_no={invoice_no} tax_id={tax_id}")

    print(f"[worker] [local-grouping] เสร็จ batch={batch_id} -> แบ่งได้ {len(groups)} ชุด")


def main():
    # อ่าน Core และ % CPU ที่จะจำกัดจาก Environment Variable — ตั้งค่าต่าง
    # กันได้ต่อ Service (เช่น ocr-worker ตัวแรกใช้ core 0, ocr-worker-2 ใช้
    # core 1 + จำกัดแค่ 50%) ผ่าน NSSM โดยไม่ต้องแก้ไฟล์นี้เลย ถ้าไม่ตั้ง
    # ค่าไว้ (None) จะไม่จำกัดอะไรเพิ่ม ใช้แค่ IDLE priority เหมือนเดิม
    #
    # OCR_WORKER_CPU_PERCENT ตอนนี้หมายถึง "เพดานบนสุด" (Max) ที่ Governor
    # จะไม่ปรับเกิน (เช่น Worker 1 = 90, Worker 2 = 75) ส่วน
    # OCR_WORKER_CPU_MIN คือ "เพดานล่างสุด" (Min) ตอนเครื่องหนักมากๆ
    # (Default 25%) — Governor จะขยับอยู่ระหว่าง Min-Max นี้เองอัตโนมัติ
    # ตาม Load จริงที่วัดได้ทุก 15 วินาที
    cpu_core_env = os.environ.get("OCR_WORKER_CPU_CORE")
    cpu_core = int(cpu_core_env) if cpu_core_env is not None and cpu_core_env.strip() != "" else None

    cpu_percent_env = os.environ.get("OCR_WORKER_CPU_PERCENT")
    cpu_percent_max = float(cpu_percent_env) if cpu_percent_env is not None and cpu_percent_env.strip() != "" else None

    cpu_min_env = os.environ.get("OCR_WORKER_CPU_MIN")
    cpu_percent_min = float(cpu_min_env) if cpu_min_env is not None and cpu_min_env.strip() != "" else 25.0

    alert_env = os.environ.get("OCR_WORKER_CPU_ALERT_THRESHOLD")
    alert_threshold_pct = float(alert_env) if alert_env is not None and alert_env.strip() != "" else 70.0

    job_handle = set_low_priority(cpu_core=cpu_core, cpu_percent=cpu_percent_max)

    # เริ่ม CPU Auto-scale Governor เป็น Background Thread — ทำงานแค่ตอนที่
    # ตั้ง cpu_percent (Max) ไว้จริง (job_handle ไม่ None) ถ้าไม่ได้ตั้งไว้
    # เลย (Worker ไม่ผ่าน Rate Cap) ก็ไม่ต้อง Governor อะไร
    if job_handle is not None:
        governor_thread = threading.Thread(
            target=cpu_governor_loop,
            args=(job_handle, cpu_percent_min, cpu_percent_max, alert_threshold_pct),
            daemon=True,
        )
        governor_thread.start()
        print(f"[worker] [cpu-governor] เริ่มทำงาน — ปรับ Cap อัตโนมัติระหว่าง {cpu_percent_min}%-{cpu_percent_max}% "
              f"ทุก {CPU_GOVERNOR_CHECK_INTERVAL_SEC} วิ, Alert ที่ Load อื่น >= {alert_threshold_pct}%")

    # Lazy load: ไม่โหลด PaddleOCR ตอน start — รอจนมีงานเข้าค่อยโหลด
    ocr = None
    print("[worker] พร้อมรับงาน (PaddleOCR จะโหลดตอนมีงานเข้า) — Ctrl+C เพื่อหยุด")

    conn = get_connection()

    # ---------------- LISTEN/NOTIFY: ตื่นทันทีเมื่อมีงานใหม่เข้า ----------------
    # ต้อง Insert NOTIFY ocr_new_job ที่จุด Insert งานเข้า ocr_queue_pages
    # (ดู patch_ocr_routes_notify.py) ถึงจะได้ประโยชน์เต็มที่ ถ้าไม่มีใคร
    # NOTIFY เลย Worker จะยัง Fallback ไป Poll ทุก OCR_NOTIFY_TIMEOUT_SEC วิ
    # เป็น Safety Net อยู่ดี (ปลอดภัยกว่า Poll ทุก 3 วิเดิมมาก)
    OCR_NOTIFY_TIMEOUT_SEC = 30
    try:
        with conn.cursor() as cur:
            cur.execute("LISTEN ocr_new_job;")
            conn.commit()
        print(f"[worker] [listen-notify] LISTEN ocr_new_job พร้อมแล้ว (Fallback Poll ทุก {OCR_NOTIFY_TIMEOUT_SEC} วิ)")
    except Exception as e:
        print(f"[worker] [listen-notify] WARNING: LISTEN ไม่สำเร็จ ({e}) — จะใช้ Poll ทุก {OCR_NOTIFY_TIMEOUT_SEC} วิแทน")

    # ---------------- Self-healing: กู้หน้าที่ค้าง 'processing' จากรอบก่อน ----------------
    # ถ้า worker ถูก restart/crash กลางคันตอนกำลังทำหน้าใดหน้าหนึ่งอยู่พอดี
    # (เช่น กด nssm restart / restart-all.ps1 ระหว่างที่ยังไม่ทัน commit ผล)
    # หน้านั้นจะค้างที่ status='processing' ตลอดไป เพราะ
    # fetch_next_ocr_page_v2() มองหาแค่ status='pending' เท่านั้น -- ไม่มีวัน
    # ถูกหยิบไปทำต่ออีกเลยถ้าไม่มีใครรีเซ็ตให้ (พบเจอจริงกับ ECOLAB.pdf
    # page 19 ที่ค้างตอน service restart กลางคัน)
    #
    # ปลอดภัยที่จะรีเซ็ตทุกแถวที่เป็น 'processing' ตอน worker เพิ่ง start
    # เพราะ worker นี้มีอินสแตนซ์เดียว (1 Core ตามที่ตั้งใจไว้) เพิ่ง start
    # ใหม่ตรงนี้เอง จึงไม่มีทางมีหน้าไหนกำลังทำงานจริงอยู่แล้วในขณะนี้
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ocr_queue_pages SET status = 'pending' WHERE status = 'processing' RETURNING id"
            )
            recovered = cur.fetchall()
            conn.commit()
        if recovered:
            print(f"[worker] [startup-recovery] กู้หน้าที่ค้าง 'processing' จาก restart/crash รอบก่อน: {len(recovered)} หน้า -> pending")
    except Exception as e:
        print(f"[worker] [startup-recovery] ERROR: {type(e).__name__}: {e}")

    try:
        pages_processed = 0
        idle_since = None  # เริ่มจับเวลา idle ตอนไม่มีงาน
        # เก็บสถานะต่อ batch สำหรับเปรียบเทียบ Invoice No. ระหว่างหน้า (Signal 2)
        batch_state = {}
        while True:
            # ---------------- Local Grouping ก่อนเสมอ (ถ้ามี batch ค้างรออยู่) ----------------
            # ต้องเช็คก่อน fetch_next_page ทุกรอบ เพื่อให้จุดตัดเอกสารถูกกำหนด
            # "ก่อน" หน้าเข้าคิว OCR เต็มรูปแบบเสมอ — ไม่ปล่อยให้ Full OCR
            # เริ่มไปก่อนโดยไม่รู้ Boundary (นั่นคือของเดิมที่ผิด Concept)
            try:
                batch_needing_grouping = fetch_batch_needing_local_grouping(conn)
            except psycopg2.OperationalError:
                print("[worker] DB หลุด กำลังเชื่อมใหม่...")
                conn = get_connection()
                continue

            if batch_needing_grouping:
                idle_since = None
                if ocr is None:
                    print("[worker] กำลังโหลด PaddleOCR model...")
                    from paddleocr import PaddleOCR
                    # เคยลองปิด use_textline_orientation เพื่อความเร็ว (ตัด
                    # โมเดลเช็คว่าแต่ละกล่องข้อความกลับหัวไหมทิ้ง) แต่ตัดสินใจ
                    # เปิดไว้เหมือนเดิม เพราะถ้าปิดแล้วมีเอกสารกลับหัวมาจริง
                    # จะไม่มีอะไรเตือนเลย จะอ่านมั่วออกมาเงียบๆ เสี่ยงเกินไป
                    # เทียบกับเวลาที่ประหยัดได้ (ความถูกต้องสำคัญกว่าความเร็ว
                    # ตรงนี้)
                    ocr = PaddleOCR(use_textline_orientation=True, lang=OCR_LANG)
                    print("[worker] โหลด model เสร็จ — เริ่มประมวลผล")
                try:
                    local_group_and_release_batch(conn, ocr, batch_needing_grouping)
                except Exception as e:
                    print(f"[worker] [local-grouping] ERROR batch={batch_needing_grouping}: {type(e).__name__}: {e}")
                    traceback.print_exc()
                continue  # วนกลับไปใหม่ ให้ fetch_next_page หยิบหน้าที่เพิ่ง pending ได้ทันที

            try:
                job = fetch_next_page(conn)
            except psycopg2.OperationalError:
                print("[worker] DB หลุด กำลังเชื่อมใหม่...")
                conn = get_connection()
                continue

            if job is None:
                # เริ่มนับ idle ถ้ายังไม่ได้นับ
                if idle_since is None:
                    idle_since = time.time()

                idle_seconds = time.time() - idle_since
                timeout = _get_idle_timeout()

                # MARKER_OCR_WORKER_SKIP_IDLE_EXIT_IF_NO_MODEL
                # Exit คืน RAM มีประโยชน์ก็ต่อเมื่อเคยโหลด PaddleOCR Model จริง
                # แล้วเท่านั้น (ocr is not None = เคยมีงานจริง มี RAM สะสมให้คืน)
                # ถ้ายังไม่เคยโหลดเลย (ไม่มีงานมาตั้งแต่ Start/Restart ครั้งก่อน)
                # ไม่มี RAM สะสมให้คืน -> ไม่ต้อง Exit-Restart วนเปล่าๆ ทุก 5 นาที
                if idle_seconds >= timeout and ocr is not None:
                    print(f"[worker] ไม่มีงาน {int(idle_seconds // 60)} นาที (timeout={timeout // 60} นาที) มี Model โหลดค้างอยู่ → exit คืน RAM")
                    sys.exit(0)  # NSSM จะ restart ตัวเองให้อัตโนมัติ

                # MARKER_OCR_WORKER_LISTEN_NOTIFY -- รอสัญญาณ NOTIFY แทน Poll ถี่ๆ
                # ตื่นทันทีถ้ามี NOTIFY เข้ามา / Fallback Poll เองถ้าเกิน Timeout
                try:
                    select.select([conn], [], [], OCR_NOTIFY_TIMEOUT_SEC)
                    conn.poll()
                    while conn.notifies:
                        conn.notifies.pop()
                except Exception:
                    time.sleep(POLL_INTERVAL_SECONDS)  # เผื่อ select ใช้ไม่ได้ (เช่น conn หลุด) -- Fallback เดิม
                continue

            # มีงานเข้า → reset idle timer
            idle_since = None

            # Lazy load PaddleOCR ตอนมีงานเข้าครั้งแรก (หรือหลัง restart)
            if ocr is None:
                print("[worker] กำลังโหลด PaddleOCR model...")
                from paddleocr import PaddleOCR
                # เก็บ use_textline_orientation=True ไว้เหมือนเดิมทั้ง 2 จุด
                # ที่โหลด model (ดูเหตุผลที่จุดโหลดแรกด้านบน — ความถูกต้อง
                # สำคัญกว่าความเร็วตรงนี้ กันเอกสารกลับหัวอ่านมั่วแบบเงียบๆ)
                ocr = PaddleOCR(use_textline_orientation=True, lang=OCR_LANG)
                print("[worker] โหลด model เสร็จ — เริ่มประมวลผล")

            page_id = job["page_id"]
            batch_id = job["batch_id"]
            page_number = job["page_number"]
            image_path = job["image_path"]
            assigned_set_id = job.get("assigned_set_id")  # มาจาก Gemini Split&Merge (ถ้ามี)

            print(f"[worker] ประมวลผล batch={batch_id} page={page_number} ({image_path})")

            try:
                # รอ lock ก่อน — ป้องกัน DocCenter OCR รันพร้อมกัน
                wait_for_ocr_lock(conn, str(page_id))
                try:
                    ocr_result, avg_conf, elapsed = run_ocr(ocr, image_path)
                finally:
                    release_ocr_lock(conn, str(page_id))
            except Exception as e:
                error_detail = f"{type(e).__name__}: {e}"
                print(f"[worker] ERROR page={page_number}: {error_detail}")
                traceback.print_exc()
                mark_page_failed(conn, page_id, error_detail)
                continue

            # อ่านความสูงภาพจริง (แก้ Bug: เดิม Hardcode 1200 ทำให้เช็คโซน
            # หัวเอกสารผิดตำแหน่ง จนแยกชุด/Reject ผิดพลาด) — ใช้ทั้ง 2 Flow
            try:
                _img_for_height = cv2.imread(image_path)
                real_image_height = _img_for_height.shape[0] if _img_for_height is not None else 1200
            except Exception:
                real_image_height = 1200

            is_rejected_page = has_reject_keyword(ocr_result, image_height_estimate=real_image_height)

            # ================================================================
            # Flow ใหม่: Gemini กำหนด Set มาให้แล้ว -> ข้าม Boundary Detection
            # ทั้งหมด (3 Signal เดิม) ใช้ Set ที่กำหนดมาตรงๆ เลย
            # ================================================================
            if assigned_set_id:
                print(f"[worker] [debug] page={page_number} ใช้ assigned_set_id จาก Gemini -> set={assigned_set_id}")
                save_page_result(conn, page_id, assigned_set_id, ocr_result, avg_conf, elapsed)
                print(f"[worker] เสร็จ page={page_number} -> set={assigned_set_id} (Gemini-assigned) confidence={avg_conf} เวลา={elapsed}s")

                # คำนวณ % Progress สะสมทุกครั้งที่มีหน้าใหม่เสร็จ (ไม่ต้องรอปิด Set)
                update_set_progress(conn, assigned_set_id)
                broadcast_progress("ap_ocr_progress", {"batch_id": batch_id, "set_id": assigned_set_id})

                with conn.cursor() as cur:
                    cur.execute("SELECT total_pages FROM ocr_sets WHERE id = %s", (assigned_set_id,))
                    row = cur.fetchone()
                    expected_total = row[0] if row else None
                    cur.execute(
                        "SELECT COUNT(*) FROM ocr_queue_pages WHERE assigned_set_id = %s AND status = 'done'",
                        (assigned_set_id,),
                    )
                    done_count = cur.fetchone()[0]

                # สะสม Reject State แบบ OR ต่อ Set (หน้าไหน Reject ก็ทำให้ทั้ง Set Reject)
                gemini_set_rejected = batch_state.setdefault("_gemini_set_rejected", {})
                gemini_set_rejected[assigned_set_id] = gemini_set_rejected.get(assigned_set_id, False) or is_rejected_page

                if expected_total is not None and done_count >= expected_total:
                    close_current_set(conn, assigned_set_id, rejected=gemini_set_rejected.get(assigned_set_id, False))
                    gemini_set_rejected.pop(assigned_set_id, None)

                pages_processed += 1
                if pages_processed >= PAGES_BEFORE_RESTART:
                    print(f"[worker] ประมวลผลครบ {PAGES_BEFORE_RESTART} หน้าแล้ว restart ตัวเองเพื่อคืน RAM")
                    sys.exit(0)
                continue

            # ================================================================
            # Flow เดิม (Fallback): ไม่มี assigned_set_id -> เดา Boundary เอง
            # ================================================================
            batch_info = get_batch_info(conn, batch_id)
            current_set_id = batch_info["current_open_set_id"]

            state = batch_state.setdefault(batch_id, {
                "anchor_invoice_no": None,   # invoice_no ของ "หน้าแรก" ของชุดที่เปิดอยู่ตอนนี้ (ไม่เปลี่ยนไปเรื่อยๆ)
                "anchor_doc_type": None,     # Patch 102: ประเภทเอกสารของ "หน้าแรก" ของชุดที่เปิดอยู่ (tax_invoice/receipt/billing_note)
                "pages_in_current_set": 0,   # นับจำนวนหน้าที่อยู่ในชุดปัจจุบัน (กันการไล่ Merge ไม่จำกัด)
                "current_set_rejected": False,  # ชุดที่เปิดอยู่ตอนนี้ เป็นเอกสารที่ต้อง Reject ไหม
            })

            page_of_total = extract_page_of_total(ocr_result)
            page_invoice_no = extract_invoice_no(ocr_result)
            has_header_keyword = is_new_document_page(ocr_result, image_height_estimate=real_image_height)
            # Patch 102: หา Doc Type จาก Keyword ล้วนๆ (ไม่พึ่ง Gemini) — ใช้
            # ป้องกัน Fuzzy Match ผิดพลาดข้ามประเภทเอกสาร (ดู Signal 2 ด้านล่าง)
            page_doc_type = detect_doc_type(ocr_result, image_height_estimate=real_image_height)

            # จำกัดไม่ให้ Fuzzy Merge ต่อกันเกิน 2 หน้า (ข้อมูลจริงยืนยันแล้วว่า
            # Vendor นี้ 1 Invoice = อย่างมาก 2 หน้า) ป้องกันปัญหา "ไล่ Merge เป็นลูกโซ่"
            # กรณี Invoice คนละใบที่ออกเลขต่อเนื่องกัน (เช่น 213, 214, 215, 216 ติดกัน)
            MAX_PAGES_PER_FUZZY_MERGE = 2

            # ---------------- ตัดสินใจว่าเป็นหน้าแรกของเอกสารใหม่ไหม (3 Signal) ----------------
            if page_number == 1:
                # หน้าแรกสุดของ batch เสมอเป็นเอกสารใหม่
                new_doc = True
                signal_used = "first_page_of_batch"
            elif page_of_total is not None:
                # Signal 1 (แม่นที่สุด): "Page X of Y" เขียนกำกับไว้เองในเอกสาร
                p_num, p_total = page_of_total
                new_doc = (p_num == 1)
                signal_used = f"page_of_total({p_num}/{p_total})"
            elif page_invoice_no and state["anchor_invoice_no"]:
                # Patch 102: เช็ค Doc Type ก่อนเชื่อ Fuzzy Match เสมอ — ป้องกัน
                # เอกสารคนละประเภท (เช่น ใบวางบิล vs ใบกำกับภาษี) ที่เลขที่
                # บังเอิญคล้ายกัน (Prefix ต่างกันนิดเดียว) ถูก Merge ผิดเป็น
                # เอกสารเดียวกัน — ทำงานได้เสมอไม่ว่า Gemini เปิดหรือปิด
                if page_doc_type and state["anchor_doc_type"] and page_doc_type != state["anchor_doc_type"]:
                    new_doc = True
                    signal_used = f"doc_type_mismatch({state['anchor_doc_type']}->{page_doc_type})"
                # Signal 2 (Fuzzy Match): เดิมใช้ Exact Match เท่านั้น (ถ้า OCR อ่านเลข
                # ผิด 1 ตัว จะไม่ Merge อัตโนมัติเลย) — เปลี่ยนเป็น Fuzzy ยอมให้ต่างกันได้
                # เล็กน้อยตาม INVOICE_NO_FUZZY_THRESHOLD ใกล้เคียงความแม่นของ Gemini มากขึ้น
                elif state["pages_in_current_set"] >= MAX_PAGES_PER_FUZZY_MERGE:
                    # ถึง Limit แล้ว (เช่น Merge ไปแล้ว 2 หน้า) บังคับแยกเอกสารใหม่ทันที
                    # ไม่ว่า Fuzzy Match จะคล้ายแค่ไหนก็ตาม กัน "ไล่ Merge เป็นลูกโซ่"
                    new_doc = True
                    signal_used = f"max_fuzzy_merge_reached({state['pages_in_current_set']}/{MAX_PAGES_PER_FUZZY_MERGE})"
                else:
                    similarity = invoice_no_similarity(page_invoice_no, state["anchor_invoice_no"])
                    if similarity >= INVOICE_NO_FUZZY_THRESHOLD:
                        new_doc = False
                        signal_used = f"invoice_no_fuzzy_match({state['anchor_invoice_no']}~{page_invoice_no}, sim={similarity:.2f})"
                    else:
                        new_doc = True
                        signal_used = f"invoice_no_changed({state['anchor_invoice_no']}->{page_invoice_no}, sim={similarity:.2f})"
            else:
                # Signal 3 (Fallback แม่นน้อยสุด): ไม่มีข้อมูล Invoice No./Page X of Y เลย
                # ใช้ Keyword หัวกระดาษเป็นตัวตัดสินใจสุดท้าย
                new_doc = has_header_keyword
                signal_used = f"keyword_fallback({has_header_keyword})"

            print(f"[worker] [debug] page={page_number} boundary_signal={signal_used} -> new_doc={new_doc}")

            if new_doc:
                # เปิดชุดใหม่ -> ตั้ง Anchor ใหม่เป็นหน้านี้ แล้วรีเซ็ตตัวนับหน้า
                state["anchor_invoice_no"] = page_invoice_no
                state["anchor_doc_type"] = page_doc_type  # Patch 102
                state["pages_in_current_set"] = 1
                # หน้าแรกของชุดเป็นตัวตัดสินว่าชุดนี้ Reject หรือไม่ (เหมือนกับที่ตัดสิน Anchor)
                state["current_set_rejected"] = is_rejected_page
            else:
                state["pages_in_current_set"] += 1

            if new_doc:
                # ปิดชุดเดิมก่อน (ถ้ามี) แล้วเปิดชุดใหม่
                if current_set_id:
                    close_current_set(conn, current_set_id, rejected=state.get("_prev_set_rejected", False))
                current_set_id = open_new_set(conn, batch_id, batch_info["uploaded_by"])

            save_page_result(conn, page_id, current_set_id, ocr_result, avg_conf, elapsed)
            print(f"[worker] เสร็จ page={page_number} -> set={current_set_id} confidence={avg_conf} เวลา={elapsed}s")
            broadcast_progress("ap_ocr_progress", {"batch_id": batch_id, "set_id": current_set_id})

            # เก็บสถานะ Reject ของชุดปัจจุบันไว้ใช้ตอนปิดชุด (ทั้งตอนเปิดชุดถัดไป และตอนจบ batch)
            state["_prev_set_rejected"] = state["current_set_rejected"]

            # ถ้าเป็นหน้าสุดท้ายของ batch -> ปิดชุดที่เปิดค้างอยู่ทันที
            if is_last_page_of_batch(conn, batch_id, page_number):
                close_current_set(conn, current_set_id, rejected=state["current_set_rejected"])

            pages_processed += 1
            if pages_processed >= PAGES_BEFORE_RESTART:
                print(f"[worker] ประมวลผลครบ {PAGES_BEFORE_RESTART} หน้าแล้ว restart ตัวเองเพื่อคืน RAM")
                sys.exit(0)  # NSSM (AppExit Default Restart) จะ auto-restart ให้ทันที (finally จะปิด conn ให้)

    except KeyboardInterrupt:
        print("\n[worker] หยุดทำงาน (Ctrl+C)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()