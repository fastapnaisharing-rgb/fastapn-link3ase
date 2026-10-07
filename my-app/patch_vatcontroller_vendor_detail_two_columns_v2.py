# -*- coding: utf-8 -*-
"""patch_vatcontroller_vendor_detail_two_columns_v2  (FRONTEND)
Modal รายละเอียดผู้ค้า (Vendor Category): จัด Layout เป็น 2 คอลัมน์ ซ้าย = ข้อมูลผู้ค้า (Information) / ขวา = ติดต่อ (Contact)
 - เว้นพื้นที่คอลัมน์ขวาไว้สำหรับ ที่อยู่ / เบอร์โทร / BU Contact (เจ้าของงาน) ที่จะเพิ่มภายหลัง
 - จอแคบ (< ~600px) ซ้อนเป็นแถวเดียวอัตโนมัติ
ต้องรันหลัง patch_vatcontroller_vendor_detail_zones_dropdown_v1.py  |  รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_VENDOR_DETAIL_TWO_COLUMNS_V2"

WIDTH_OLD = "width: '400px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 48px rgba(10,20,35,0.25)'"
WIDTH_NEW = "width: (vd || vendorDetailModal.editing) ? '780px' : '400px', maxWidth: '94vw', overflow: 'hidden', boxShadow: '0 20px 48px rgba(10,20,35,0.25)'"  # MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_TWO_COLUMNS_V2

HELPER_ANCHOR = "        const vdLbl = { color: '#8a8f98' };\n"
HELPER_NEW = HELPER_ANCHOR + "        const vdTwoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: '28px', rowGap: '18px', alignItems: 'start' }; // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_TWO_COLUMNS_V2\n"

BLOCK = re.compile(r"<div>\s*\{vdZoneHd\('ข้อมูลผู้ค้า', 'INFORMATION'\)\}.*?</div>(?=\s*</>)", re.S)


def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    if "VATWATCHLISTOPS_VENDOR_DETAIL_ZONES_DROPDOWN_V1" not in src:
        print("ERROR: ต้องรัน patch_vatcontroller_vendor_detail_zones_dropdown_v1.py ก่อน - ไม่เขียนไฟล์"); sys.exit(1)
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")

    for name, a in (("width", WIDTH_OLD), ("helper", HELPER_ANCHOR)):
        if s.count(a) != 1:
            print("ERROR: anchor %s พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์" % (name, s.count(a))); sys.exit(1)
    blocks = list(BLOCK.finditer(s))
    if len(blocks) != 2 or any(m.end() - m.start() > 9000 for m in blocks):
        print("ERROR: พบบล็อก Zone %d จุด (ต้อง 2: แก้ไข + ดู) - ไม่เขียนไฟล์" % len(blocks)); sys.exit(1)

    for m in sorted(blocks, key=lambda x: x.start(), reverse=True):
        blk = m.group(0)
        if blk.count("<div style={{ marginTop: '18px' }}>") != 1:
            print("ERROR: โครงบล็อก Zone ไม่ตรงที่คาด - ไม่เขียนไฟล์"); sys.exit(1)
        blk = blk.replace("<div style={{ marginTop: '18px' }}>", "<div>", 1)
        s = s[:m.start()] + "<div style={vdTwoCol}>" + blk + "</div>" + s[m.end():]

    s = s.replace(WIDTH_OLD, WIDTH_NEW, 1).replace(HELPER_ANCHOR, HELPER_NEW, 1)

    for o, c in ("{}", "()", "[]"):
        if (s.count(o) - s.count(c)) != (src.replace("\r\n", "\n").count(o) - src.replace("\r\n", "\n").count(c)):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (o, c)); sys.exit(1)

    if crlf:
        s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)


main()
