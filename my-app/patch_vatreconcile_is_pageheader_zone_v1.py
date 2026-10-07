# -*- coding: utf-8 -*-
"""patch_vatreconcile_is_pageheader_zone_v1  (BACKEND)
Input Summary Parser: ตัด "Zone Page Header" ที่พิมพ์ซ้ำทุกครั้งที่ขึ้นหน้าใหม่ทิ้งทั้งก้อนก่อน
(เริ่มที่บรรทัด "<BU> BOOK ... รายงานภาษีซื้อ" จบที่เส้นประคั่นหัว Column "---------- ----------") แทนการไล่กรองทีละบรรทัด
ผล: เลขหน้า / เลขรายงาน / ที่อยู่ / ชื่อ Column ที่เคยหลุดไปต่อท้าย vendor_name ไม่ถูกอ่านเลย
ปลอดภัย: Zone ปิดทันทีเมื่อเจอแถวข้อมูล (วันที่ dd-MON-yy) หรือครบ 40 บรรทัด และบรรทัด Header สาขา (สาขา : 056101) ยังอ่านตามเดิมแม้อยู่ใน Zone
รันบน Server ที่โฟลเดอร์ backend แล้ว Restart-Service fastapn-backend  (หลังจากนั้นต้องล้างข้อมูลแล้วนำเข้าไฟล์ใหม่)
"""
import os, shutil, sys

TARGET = os.path.join("src", "routes", "vatReconcile.js")
MARKER = "VATRECONCILE_IS_PAGEHEADER_ZONE_V1"

E1_OLD = "function isParseRowFields(line) {\n"
E1_NEW = '''// MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1 -- Zone Page Header: เริ่มที่ "<BU> BOOK ..." จบที่เส้นประคั่นหัว Column
const IS_PAGE_HEADER_START = /^[A-Za-z0-9]{2,8}\\s+BOOK\\b/;
const IS_PAGE_HEADER_END = /^-{5,}(?:\\s+-{5,}){2,}\\s*$/;
const IS_PAGE_HEADER_MAX_LINES = 40;

'''

E2_OLD = "  let currentRecord = null;\n\n  for (let rawLine of lines) {\n"
E2_NEW = "  let currentRecord = null;\n  let inPageHeader = false; // MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1\n  let pageHeaderCount = 0;\n\n  for (let rawLine of lines) {\n"

E3_OLD = "    if (IS_DATE_ROW_PATTERN.test(line)) {\n      if (!currentBranch) {\n"
E3_NEW = '''    // MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1 -- ข้าม Page Header ทั้งก้อน (ไม่ต่อเข้า vendor_name / tax_invoice_no)
    if (IS_DATE_ROW_PATTERN.test(line)) {
      inPageHeader = false; // แถวข้อมูลจริง -> ปิด Zone เสมอ
    } else if (!inPageHeader && IS_PAGE_HEADER_START.test(stripped)) {
      inPageHeader = true;
      pageHeaderCount = 0;
    }
    if (inPageHeader) {
      pageHeaderCount++;
      if (IS_PAGE_HEADER_END.test(stripped)) {
        inPageHeader = false;
        continue;
      }
      if (pageHeaderCount > IS_PAGE_HEADER_MAX_LINES) {
        inPageHeader = false; // ไม่เจอเส้นประปิด Zone -> เลิก Zone แล้วประมวลผลบรรทัดนี้ตามปกติ
      } else {
        continue;
      }
    }

''' + E3_OLD

EDITS = [(E1_OLD, E1_NEW + E1_OLD), (E2_OLD, E2_NEW), (E3_OLD, E3_NEW)]

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _ in EDITS:
        if s.count(a) != 1:
            print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์\n%s" % (s.count(a), a[:70])); sys.exit(1)
    for a, b in EDITS:
        s = s.replace(a, b)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
