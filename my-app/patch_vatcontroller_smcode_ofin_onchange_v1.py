# -*- coding: utf-8 -*-
"""
patch_vatcontroller_smcode_ofin_onchange_v1.py
MARKER: MARKER_VATCONTROLLER_SMCODE_OFIN_ONCHANGE_MATCH_V1

หน้าที่: Modal "+ New Simple Code" (VatSmCodeSearchModal) ช่อง OFIN CODE
  เดิม: Match Branch (BU Company Simple / Tax ID BU / BU Branch / Com% / Group-P / Branch Code / Status) ตอน Blur (ต้อง Tab ก่อน)
  ใหม่: Match ทันทีตอนพิมพ์ (onChange) -- ไม่แก้ค่าที่พิมพ์ (ไม่ Pad ศูนย์ระหว่างพิมพ์), Pad 6 หลักยังทำตอน Blur เหมือนเดิม

ใช้: python patch_vatcontroller_smcode_ofin_onchange_v1.py [path ของ VatController.js]
 (ไม่ระบุ path = src\\pages\\VatController.js เทียบกับโฟลเดอร์ my-app)
"""
import sys, os, shutil

MARKER = "MARKER_VATCONTROLLER_SMCODE_OFIN_ONCHANGE_MATCH_V1"
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join("src", "pages", "VatController.js")

ANCHOR = "  const handleSmOfinCodeChange = (val) => setSmForm((prev) => ({ ...prev, 'Ofin Code': val }));"

NEW = """  // MARKER_VATCONTROLLER_SMCODE_OFIN_ONCHANGE_MATCH_V1 -- Match Branch ทันทีตอนพิมพ์ (ไม่ต้อง Tab/Blur ก่อน) -- Match ตรงตามที่พิมพ์เท่านั้น ไม่แก้ค่าในช่อง (Pad 6 หลักยังทำตอน Blur ใน lookupSmOfinCode) / พิมพ์ไม่ตรง Branch ไหน -> ล้างค่า Derive (แถบ Check Data เป็นแดง)
  const handleSmOfinCodeChange = (val) => {
    const raw = String(val || '').trim();
    const found = raw ? (branches || []).find((b) => String(b['Branch Code'] || '').trim() === raw) : null;
    setSmForm((prev) => ({
      ...prev,
      'Ofin Code': val,
      '_ofinSimpleName': found ? (found['Simple Brand Code'] || '') : '',
      'Short Branch': found ? (found['BU-Branch'] || '') : '',
      'BU': found ? (found['bu'] || '') : '',
      '_buCompanySimple': found ? (found['Simple Company'] || '') : '',
      '_taxIdBu': found ? (found['BU-TaxID'] || '') : '',
      '_comPct': found ? (found['%'] || '') : '',
      '_specPct': found ? (found['DB(%)'] || '') : '',
      '_buBranch': found ? (found['BU-Branch'] || '') : '',
      '_branchCode': found ? (found['Branch Code'] || '') : '',
      '_groupP': found ? (found['Group-P'] || '') : '',
      '_branchStatus': found ? (found['status'] || '') : '',
    }));
  };"""

def main():
    if not os.path.isfile(TARGET):
        print("ERROR: ไม่พบไฟล์", TARGET); sys.exit(1)
    with open(TARGET, "r", encoding="utf-8-sig", newline="") as f:
        src = f.read()
    if MARKER in src:
        print("SKIP: มี marker แล้ว (patch นี้ถูกใช้ไปแล้ว)"); return
    crlf = "\r\n" in src
    anchor, new = ANCHOR, NEW
    if crlf:
        new = new.replace("\n", "\r\n")
    n = src.count(anchor)
    if n != 1:
        print("ERROR: Anchor พบ %d ครั้ง (ต้อง 1) -- ไม่เขียนไฟล์ ให้ส่งไฟล์ปัจจุบันมาปรับ Anchor" % n); sys.exit(1)
    out = src.replace(anchor, new)
    if out.count("{") - out.count("}") != src.count("{") - src.count("}") or out.count("(") - out.count(")") != src.count("(") - src.count(")"):
        print("ERROR: Bracket ไม่สมดุลหลัง Patch -- ไม่เขียนไฟล์"); sys.exit(1)
    shutil.copyfile(TARGET, TARGET + ".bak")   # .bak เดียว เขียนทับทุกครั้ง
    with open(TARGET, "w", encoding="utf-8-sig", newline="") as f:
        f.write(out)
    print("OK: patch สำเร็จ ->", TARGET, "(สำรองที่ .bak)")

main()
