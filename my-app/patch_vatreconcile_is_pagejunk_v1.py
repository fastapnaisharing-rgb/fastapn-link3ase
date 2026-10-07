# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_IS_PAGEJUNK_V1
# แก้ Parser Input Summary: ตัด "เลขหน้า" (เช่น "หน้า: 2 / 3") และ "เลขล้วนยาว" (เช่น 10004411 / 00070818)
# ที่ถูกพิมพ์ซ้ำตอนขึ้นหน้าใหม่ แล้วถูกต่อเข้า vendor_name ผิดๆ
# วิธีใช้:  python patch_vatreconcile_is_pagejunk_v1.py src\routes\vatReconcile.js   แล้ว Restart-Service fastapn-backend
#          จากนั้น Upload ไฟล์ Input Summary เดิมซ้ำ (ระบบ Replace ทั้งก้อนของ BU/Period อยู่แล้ว) ข้อมูลเก่าที่ผิดจะถูกแทนที่
# Idempotent | .bak ไฟล์เดียว | node --check | ไม่ผ่าน -> คืนไฟล์เดิม
import sys, io, shutil, subprocess
if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_is_pagejunk_v1.py <path to vatReconcile.js>"); sys.exit(2)
path = sys.argv[1]
src = io.open(path, encoding="utf-8", newline="").read()
N = "MARKER_VATRECONCILE_IS_PAGEJUNK_V1"
if N in src:
    print("already patched"); sys.exit(0)
crlf = "\r\n" in src
s = src.replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, "anchor x%d: %s" % (s.count(a), a[:60])
    s = s.replace(a, b)

rep("""function isParseAmount(raw) {""", """// """ + N + """ -- เลขหน้า/เลขล้วนยาวที่พิมพ์ซ้ำตอนขึ้นหน้าใหม่ ห้ามต่อเข้า vendor_name
const IS_PAGE_NO_PATTERN = /(?:หน้า|page)\\s*[:：]?\\s*\\d+\\s*(?:\\/|of)\\s*\\d+/gi; // เช่น "หน้า: 2 / 3"
function isStripPageNoJunk(strippedLine) {
  if (/^\\d{6,}$/.test(strippedLine)) return ""; // บรรทัดเป็นเลขล้วนยาว (เช่น 10004411) ไม่ใช่ชื่อผู้ค้า
  return strippedLine.replace(IS_PAGE_NO_PATTERN, " ").replace(/\\s+/g, " ").trim();
}

function isParseAmount(raw) {""")

rep("""      currentRecord.vendor_name = (currentRecord.vendor_name + " " + stripped).trim();""",
    """      const contText = isStripPageNoJunk(stripped); // """ + N + """
      if (!contText) continue;
      currentRecord.vendor_name = (currentRecord.vendor_name + " " + contText).trim();""")

if crlf: s = s.replace("\n", "\r\n")
shutil.copyfile(path, path + ".bak")
io.open(path, "w", encoding="utf-8", newline="").write(s)
try:
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.copyfile(path + ".bak", path); print("node --check FAILED, restored:\n" + r.stderr); sys.exit(1)
except FileNotFoundError:
    print("(node not found, skip syntax check)")
print("patched OK")
