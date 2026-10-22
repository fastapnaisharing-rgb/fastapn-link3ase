# -*- coding: utf-8 -*-
"""
patch_sp_handler_assets_v17.py
MARKER: MARKER_SP_HANDLER_VERSION_FROM_FILE_V1

ทำอะไร (spHandlerAssets.js บน Server):
  1) แทนที่ fastapn-sp.ps1 (Base64) ที่ฝังอยู่ด้วยไฟล์ fastapn-sp.ps1 จริง (ที่วางข้างสคริปต์นี้)
  2) เลิกใช้ SP_HANDLER_VERSION ที่พิมพ์เลขเอง -> ให้ Backend อ่านเลขจาก $HandlerVersion ใน .ps1 ที่ฝังอยู่จริงตอนโหลดโมดูล
     (/sp-handler/version, /my-status, outdated check ใช้ค่านี้หมด => เลขที่หน้าเว็บเทียบ = เลขในไฟล์จริงเสมอ ไม่มีทางเพี้ยน)
  3) ตั้ง SP_HANDLER_RELEASED_AT = เวลาปัจจุบัน (UTC) เมื่อ .ps1 เปลี่ยน

วิธีใช้:
  - วาง patch_sp_handler_assets_v17.py + fastapn-sp.ps1 (v17) ไว้โฟลเดอร์เดียวกับ spHandlerAssets.js (src\\routes)
  - python patch_sp_handler_assets_v17.py
  - Restart-Service fastapn-backend

Convention: Idempotent | .bak ไฟล์เดียว (ทับของเดิม) | newline="" | All-or-nothing | Bracket check | node --check
"""
import base64, datetime, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "spHandlerAssets.js")
PS1 = os.path.join(HERE, "fastapn-sp.ps1")
MARKER = "MARKER_SP_HANDLER_VERSION_FROM_FILE_V1"

DERIVED = (
    "\n// " + MARKER + " -- เลขเวอร์ชันอ่านจาก $HandlerVersion ใน fastapn-sp.ps1 ที่ฝังอยู่จริง (ไม่พิมพ์เลขเอง)\n"
    "export const SP_HANDLER_VERSION = (() => { try { const m = Buffer.from(SP_HANDLER_FILES[\"fastapn-sp.ps1\"], \"base64\").toString(\"utf8\").match(/\\$HandlerVersion\\s*=\\s*(\\d+)/); return m ? Number(m[1]) : 0; } catch (e) { return 0; } })();\n"
)


def die(msg):
    print("[ABORT] " + msg)
    sys.exit(1)


if not os.path.isfile(TARGET):
    die("ไม่พบ spHandlerAssets.js ข้างสคริปต์: " + TARGET)
if not os.path.isfile(PS1):
    die("ไม่พบ fastapn-sp.ps1 ข้างสคริปต์ (ต้อง Copy ไฟล์ v17 มาวางด้วย): " + PS1)

with open(PS1, "rb") as f:
    ps1_bytes = f.read()
mv = re.search(rb"\$HandlerVersion\s*=\s*(\d+)", ps1_bytes)
if not mv:
    die("อ่าน $HandlerVersion จาก fastapn-sp.ps1 ไม่ได้")
ver = int(mv.group(1))
new_b64 = base64.b64encode(ps1_bytes).decode("ascii")

with open(TARGET, "r", encoding="utf-8", newline="") as f:
    src = f.read()
nl = "\r\n" if "\r\n" in src else "\n"

pat_ps1 = re.compile(r'("fastapn-sp\.ps1":\s*")([A-Za-z0-9+/=]*)(")')
pat_rel = re.compile(r'(export const SP_HANDLER_RELEASED_AT = ")([^"]*)(")')
pat_ver_line = re.compile(r"^export const SP_HANDLER_VERSION = \d+;[^\r\n]*(\r?\n)", re.M)
for nm, p in (("fastapn-sp.ps1", pat_ps1), ("SP_HANDLER_RELEASED_AT", pat_rel)):
    if len(p.findall(src)) != 1:
        die("Anchor ไม่พบ/ซ้ำ: " + nm + " (ไม่เขียนไฟล์)")

cur_b64 = pat_ps1.search(src).group(2)
has_marker = MARKER in src
if cur_b64 == new_b64 and has_marker:
    print("[SKIP] ตรงกับไฟล์จริง v%d และอ่านเวอร์ชันจากไฟล์อยู่แล้ว (Idempotent) ไม่เขียนไฟล์" % ver)
    sys.exit(0)

out = src
if cur_b64 != new_b64:
    out = pat_ps1.sub(lambda mm: mm.group(1) + new_b64 + mm.group(3), out, count=1)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")
    out = pat_rel.sub(lambda mm: mm.group(1) + now + mm.group(3), out, count=1)
else:
    now = pat_rel.search(out).group(2)
if not has_marker:
    if len(pat_ver_line.findall(out)) != 1:
        die("Anchor บรรทัด SP_HANDLER_VERSION ไม่พบ/ซ้ำ (ไม่เขียนไฟล์)")
    out = pat_ver_line.sub("", out, count=1)  # ลบบรรทัดเลขที่พิมพ์เอง
    out = out.rstrip("\r\n") + nl + DERIVED.replace("\n", nl)

if out.count("{") != out.count("}") or out.count("(") != out.count(")"):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")

tmp = os.path.join(HERE, "spHandlerAssets.new.mjs")
with open(tmp, "w", encoding="utf-8", newline="") as f:
    f.write(out)
try:
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode != 0:
        os.remove(tmp)
        die("node --check ไม่ผ่าน: " + (r.stderr or r.stdout))
except FileNotFoundError:
    print("[WARN] ไม่พบ node ใน PATH — ข้าม node --check")

shutil.copyfile(TARGET, TARGET + ".bak")  # .bak ไฟล์เดียว ทับของเดิมทุกครั้ง
os.replace(tmp, TARGET)
print("[OK] spHandlerAssets.js -> ps1 v%d ฝังแล้ว | RELEASED_AT = %s | เลขเวอร์ชันอ่านจากไฟล์จริง" % (ver, now))
print("     ต่อไป: Restart-Service fastapn-backend")
