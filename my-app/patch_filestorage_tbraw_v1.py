# -*- coding: utf-8 -*-
"""
patch_filestorage_tbraw_v1.py   (วางข้าง fileStorage.js ใน src\\routes แล้วรัน: python patch_filestorage_tbraw_v1.py)
MARKER: MARKER_GL_DOA_TB_RAW_BACKEND_V1

POST /api/file-storage/doa-backup รับ kind = "TBRAW" (ไฟล์ TB ทั้งไฟล์ ทุกแถว/ทุกสาขา เก็บก่อนผูก Config)
  - ไม่หมดอายุ (expires_at = +1200 เดือน จึงไม่ถูก purge) ไม่ลบ
  - ส่งซ้ำ (bu, period, owner เดิม) = เขียนทับฉบับเดิม (UPDATE) ตาม UNIQUE (bu, period, kind, owner) ที่มีอยู่
  - ไม่แก้ตาราง / ไม่แตะ Route อื่น | ใช้ doaGlOnly + owner เหมือน Backup เดิม
"""
import os
import shutil, sys


def die(msg):
    print("[ABORT] " + msg)
    sys.exit(1)


def load(path):
    if not os.path.isfile(path):
        die("ไม่พบไฟล์: " + path)
    with open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    nl = "\r\n" if "\r\n" in s else "\n"
    return s, nl


def apply(src, nl, marker, edits):
    """edits = [(label, old, new)] ; old ต้องพบ 1 ครั้งพอดี ; \\n ใน old/new ถูกแปลงเป็นรูปแบบขึ้นบรรทัดของไฟล์"""
    if marker in src:
        print("[SKIP] พบ " + marker + " แล้ว (Idempotent) ไม่เขียนไฟล์")
        sys.exit(0)
    out = src
    for label, old, new in edits:
        o = old.replace("\n", nl)
        n = new.replace("\n", nl)
        c = out.count(o)
        if c != 1:
            die("Anchor '%s' พบ %d ครั้ง (ต้อง 1) -- ไม่เขียนไฟล์ ไฟล์อาจไม่ตรงเวอร์ชัน ให้ส่งไฟล์ปัจจุบันมาตรวจ" % (label, c))
        out = out.replace(o, n, 1)
    return out


def save(path, out):
    shutil.copyfile(path, path + ".bak")  # .bak ไฟล์เดียว ทับของเดิมทุกครั้ง
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)


def same_balance(src, out):
    """เทียบความสมดุลวงเล็บ 'เฉพาะส่วนที่เพิ่ม' (นับดิบในไฟล์ต้นฉบับอาจไม่สมดุลเพราะอยู่ใน String/Regex)"""
    return all((out.count(a) - out.count(b)) == (src.count(a) - src.count(b)) for a, b in (("{", "}"), ("(", ")"), ("[", "]")))


HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "fileStorage.js")
MARKER = "MARKER_GL_DOA_TB_RAW_BACKEND_V1"

src, nl = load(TARGET)
E = [("kind-months",
 'const kind = b.kind === "Simple" ? "Simple" : (b.kind === "Detail" ? "Detail" : "TB"); const months = kind === "TB" ? DOA_BACKUP_MONTHS : DOA_SIMPLE_MONTHS;',
 'const kind = b.kind === "TBRAW" ? "TBRAW" : (b.kind === "Simple" ? "Simple" : (b.kind === "Detail" ? "Detail" : "TB")); const months = kind === "TBRAW" ? 1200 : (kind === "TB" ? DOA_BACKUP_MONTHS : DOA_SIMPLE_MONTHS); /* MARKER_GL_DOA_TB_RAW_BACKEND_V1 -- TBRAW = TB ทั้งไฟล์ ไม่หมดอายุ (1200 เดือน) ส่งซ้ำ = เขียนทับ */')]

out = apply(src, nl, MARKER, E)
if not same_balance(src, out):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")
import subprocess
tmp = os.path.join(HERE, "fileStorage.new.mjs")
with open(tmp, "w", encoding="utf-8", newline="") as f:
    f.write(out)
try:
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode != 0:
        os.remove(tmp); die("node --check ไม่ผ่าน: " + (r.stderr or r.stdout))
except FileNotFoundError:
    print("[WARN] ไม่พบ node ใน PATH — ข้าม node --check")
if os.path.exists(tmp): os.remove(tmp)
save(TARGET, out)
print("[OK] fileStorage.js: doa-backup รับ kind=TBRAW (ไม่หมดอายุ / ส่งซ้ำ=ทับ) | สำรอง .bak แล้ว")
print("     ต่อไป: Restart-Service fastapn-backend")
