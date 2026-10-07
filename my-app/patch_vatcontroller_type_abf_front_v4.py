# -*- coding: utf-8 -*-
"""patch_vatcontroller_type_abf_front_v4  (FRONTEND  src\\pages\\VatController.js)  -- ต่อจาก v1, v2, v3
Popvat A / F: หน้าต่าง Remark ขึ้น "เหตุผลค่าเริ่มต้นของ Type" มาให้เลย (A = "ดำเนินการใช้สิทธิ์ไปก่อน", B = "ใช้สิทธิ์บางส่วน ...", F = "ยอดคงเหลือหมดอายุ")
 -> ไม่แก้ก็กด Popvat ได้เลย / แก้ข้อความได้ถ้าต้องการ  (B ยังกรอกวันที่ใช้ไป/เดือน/จำนวนเงินเหมือนเดิม)
รันที่โฟลเดอร์ my-app แล้ว npm run build (หรือ dev server โหลดเอง)
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_TYPE_ABF_V4"
def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if "VATWATCHLISTOPS_TYPE_ABF_V2" not in s: print("ERROR: ต้องรัน v1, v2, v3 ก่อน"); sys.exit(1)
    a1 = "setQaPopCondText(''); setQaPopCondMode('A');"
    a3 = "กรอก Remark อธิบายรายละเอียด (จำเป็นต้องกรอก) -- จะบันทึกเป็น Remark ของรายการ"
    if s.count(a1) != 1 or s.count(a3) != 1: print("ERROR: anchor A/คำอธิบาย ไม่พบตามที่คาด (%d/%d) - ไม่เขียนไฟล์" % (s.count(a1), s.count(a3))); sys.exit(1)
    pat = re.compile(r"onClick=\{async \(\) => \{ setQaPopMenuOpen\(false\); const remarkF = .*?if \(okF\) handleAddQuickActionData\('F', remarkF\); \}\} /\* MARKER_VATWATCHLISTOPS_TYPE_ABF_V2 -- F ไม่ต้องกรอก Remark \*/", re.S)
    if len(pat.findall(s)) != 1: print("ERROR: ไม่พบปุ่ม F ตามที่คาด - ไม่เขียนไฟล์"); sys.exit(1)
    bB = "[B - Part Used] ส่วนที่เหลือเคยใช้ไปแล้วเมื่อ ${qaPopBDate}"
    if s.count(bB) != 2: print("ERROR: anchor B พบ %d ครั้ง (ต้อง 2) - ไม่เขียนไฟล์" % s.count(bB)); sys.exit(1)
    s = s.replace(bB, "ใช้สิทธิ์บางส่วน ใช้ไปแล้วเมื่อ ${qaPopBDate}")
    s = s.replace(a1, "setQaPopCondText('ดำเนินการใช้สิทธิ์ไปก่อน'); setQaPopCondMode('A');")
    s = s.replace(a3, "Remark ค่าเริ่มต้นของ Type นี้ (แก้ไขได้ หรือกด Popvat ได้เลยถ้าไม่เปลี่ยน)")
    s = pat.sub("onClick={() => { setQaPopMenuOpen(false); setQaPopCondText('ยอดคงเหลือหมดอายุ'); setQaPopCondMode('F'); setQaPopCondOpen(true); }} /* MARKER_VATWATCHLISTOPS_TYPE_ABF_V4 -- A/F: Remark ค่าเริ่มต้นตาม Type */", s)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
