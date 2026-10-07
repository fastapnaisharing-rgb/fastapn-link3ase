# -*- coding: utf-8 -*-
"""patch_vatcontroller_vendor_greeting_name_v1
Modal "รายละเอียดผู้ค้า": เพิ่มช่อง "ชื่อผู้รับ" (Greeting Name) ต่อผู้ค้า+BU เก็บใน vendor_category."GREETING_NAME"
ใช้แทน {ชื่อผู้รับ} ในคำขึ้นต้นเมล To Supplier (ต้องรัน add_greeting_name_to_vendor_category.sql และ Backend patch คู่กัน)
รันที่โฟลเดอร์ my-app:  python patch_vatcontroller_vendor_greeting_name_v1.py  แล้ว npm run build
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1"

EDITS = [
 # 1) ฟอร์มแก้ไข: ค่าเริ่มต้นจาก Record เดิม
 ("          'EMAIL': d['EMAIL'] || '', // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1\n",
  "          'EMAIL': d['EMAIL'] || '', // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1\n"
  "          'GREETING_NAME': d['GREETING_NAME'] || '', // MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1\n"),
 # 2) ฟอร์มเพิ่มผู้ค้าใหม่
 ("'TAX ID': '', 'No.': '', 'BU': bu?.bu || '', 'TYPE': '', 'SUB TYPE': '', 'REMARK': '', 'EMAIL': '',",
  "'TAX ID': '', 'No.': '', 'BU': bu?.bu || '', 'TYPE': '', 'SUB TYPE': '', 'REMARK': '', 'EMAIL': '', 'GREETING_NAME': '', // MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1"),
 # 3) ช่องกรอกใต้ช่องอีเมล (โหมดแก้ไข)
 ("ใช้เป็นช่อง To ของเมล By Vendor (ผู้ค้า + BU นี้) -- ใส่ได้หลายอีเมล คั่นด้วย ;</div>\n                    </div>\n",
  "ใช้เป็นช่อง To ของเมล By Vendor (ผู้ค้า + BU นี้) -- ใส่ได้หลายอีเมล คั่นด้วย ;</div>\n                    </div>\n"
  "                    <div style={{ color: '#8a8f98' }}>ชื่อผู้รับ</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 */}\n"
  "                    <div>\n"
  "                      <input value={vendorDetailModal.form['GREETING_NAME'] || ''} onChange={(e) => setVendorDetailFormField('GREETING_NAME', e.target.value)} placeholder=\"เช่น คุณนท, พี่ตู่\" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px' }} />\n"
  "                      <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>ใช้แทน {'{ชื่อผู้รับ}'} ในคำขึ้นต้นเมล By Vendor (Greeting Name) -- เว้นว่าง = ใช้ชื่อผู้รับของ Config</div>\n"
  "                    </div>\n"),
 # 4) แสดงในโหมดดูข้อมูล
 ("{vd['EMAIL'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1 */}\n",
  "{vd['EMAIL'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1 */}\n"
  "                    <div style={{ color: '#8a8f98' }}>ชื่อผู้รับ</div><div style={{ color: vd['GREETING_NAME'] ? '#333' : '#ccc', fontSize: '12px' }}>{vd['GREETING_NAME'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 */}\n"),
]

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
            print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์\n%s" % (s.count(a), a[:80])); sys.exit(1)
    for a, b in EDITS:
        s = s.replace(a, b)
    for a, b in ("{}", "()", "[]"):  # เช็คส่วนต่างเฉพาะโค้ดที่แก้
        da = sum(x.count(a) - x.count(b) for x, _ in EDITS); dn = sum(y.count(a) - y.count(b) for _, y in EDITS)
        if da != dn:
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
