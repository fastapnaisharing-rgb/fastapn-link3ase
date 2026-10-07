# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_IS_MACRO_CONT_V2
# แก้ Parser Input Summary ให้ "บรรทัดต่อ" ทำงานเหมือน Macro (Option_Cutting_Input) :
#   Macro ตัดบรรทัดตาม Fixed-Width แล้วเอาจาก "บรรทัดต่อ" แค่ 2 Column คือ tax_invoice_no (43-59) กับ vendor_name (59-93)
#   Column อื่น (เช่น เลขหน้า "หน้า: 2 / 3", เลขรายงาน 10004411) ถูกทิ้ง   -- เดิม Parser เอาทั้งบรรทัดไปต่อท้าย vendor_name จึงผิด
# สั่งรันครั้งเดียวพอ (ใช้แทน patch_vatreconcile_is_pagejunk_v1.py ได้เลย ไม่ต้องรัน v1 ก่อน; ถ้า v1 เคยรันแล้วก็รัน v2 ต่อได้)
# วิธีใช้:  python patch_vatreconcile_is_pagejunk_v2.py src\routes\vatReconcile.js   แล้ว Restart-Service fastapn-backend
#          จากนั้น Upload ไฟล์ Input Summary เดิมซ้ำ (ระบบ Replace ทั้งก้อนของ BU/Period อยู่แล้ว)
# Idempotent | .bak ไฟล์เดียว | node --check | ไม่ผ่าน -> คืนไฟล์เดิม
import sys, io, shutil, subprocess
if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_is_pagejunk_v2.py <path to vatReconcile.js>"); sys.exit(2)
path = sys.argv[1]
src = io.open(path, encoding="utf-8", newline="").read()
N = "MARKER_VATRECONCILE_IS_MACRO_CONT_V2"
V1 = "MARKER_VATRECONCILE_IS_PAGEJUNK_V1"
if N in src:
    print("already patched"); sys.exit(0)
crlf = "\r\n" in src
s = src.replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, "anchor x%d: %s" % (s.count(a), a[:70])
    s = s.replace(a, b)

# 1) helper (ถ้า v1 ยังไม่เคยลง)
if V1 not in s:
    rep("""function isParseAmount(raw) {""", """// """ + V1 + """ -- ตัดเลขหน้า/เลขล้วนยาวที่หลุดเข้ามาใน Column vendor_name
const IS_PAGE_NO_PATTERN = /(?:หน้า|page)\\s*[:：]?\\s*\\d+\\s*(?:\\/|of)\\s*\\d+/gi; // เช่น "หน้า: 2 / 3"
function isStripPageNoJunk(strippedLine) {
  if (/^\\d{6,}$/.test(strippedLine)) return ""; // เลขล้วนยาว (เช่น 10004411) ไม่ใช่ชื่อผู้ค้า
  return strippedLine.replace(IS_PAGE_NO_PATTERN, " ").replace(/\\s+/g, " ").trim();
}

function isParseAmount(raw) {""")
    old_cont = """      currentRecord.vendor_name = (currentRecord.vendor_name + " " + stripped).trim();"""
else:
    old_cont = """      const contText = isStripPageNoJunk(stripped); // """ + V1 + """
      if (!contText) continue;
      currentRecord.vendor_name = (currentRecord.vendor_name + " " + contText).trim();"""

new_cont = """      // """ + N + """ -- เหมือน Macro: บรรทัดต่อเอาเฉพาะ Column tax_invoice_no (43-59) และ vendor_name (59-93) ตาม Fixed-Width
      const cf = isParseRowFields(line);
      const addInv = (cf.tax_invoice_no || "").replace(/^\\*/, "").trim();
      const addVen = isStripPageNoJunk((cf.vendor_name || "").trim());
      if (!addInv && !addVen) continue; // ไม่มีข้อมูลใน 2 Column นี้ = Macro ให้เป็น Z (ทิ้ง)
      if (addInv) currentRecord.tax_invoice_no = (currentRecord.tax_invoice_no + addInv).trim();
      if (addVen) currentRecord.vendor_name = (currentRecord.vendor_name + " " + addVen).trim();"""
rep(old_cont, new_cont)

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
