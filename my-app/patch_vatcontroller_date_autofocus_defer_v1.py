# -*- coding: utf-8 -*-
"""
patch_vatcontroller_date_autofocus_defer_v1.py

ปัญหา: เลือก Tax Invoice Date จาก Calendar (Native <input type="date">) แล้ว Focus ไม่ไปที่ Tax Invoice No.
สาเหตุ: โค้ดเดิมสั่ง .focus() ทันทีใน onChange แต่ Chrome/Edge ปิด Calendar Popup หลัง onChange
        แล้วคืน Focus กลับให้ <input type="date"> -> .focus() ที่สั่งไปถูกแย่งกลับ
วิธีแก้: หน่วงการ .focus() ด้วย setTimeout (120ms) + เช็คซ้ำอีกรอบ (320ms) ถ้า Focus ยังไม่อยู่ที่ช่องเป้าหมาย

แก้ 3 จุดใน src/pages/VatController.js (Pattern เดียวกัน):
  1) Full Page - Add Tax Invoice (addTaxInvoiceNumberRef)      <- จุดที่ผู้ใช้แจ้ง
  2) Quick Action (quickActionTaxInvoiceNumberRef)
  3) Popvat Preview (fTaxNoRef)

วิธีใช้: วางไว้ที่โฟลเดอร์ my-app (ระดับเดียวกับ src) แล้วรัน  python patch_vatcontroller_date_autofocus_defer_v1.py
"""
import os
import re
import shutil
import sys

MARKER = 'MARKER_VATWATCHLISTOPS_DATE_AUTOFOCUS_DEFER_V1'
BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'src', 'pages', 'VatController.js')


def deferred(ref):
    return (
        "if (v && %(r)s.current) { const _focusEl = %(r)s.current; "
        "setTimeout(() => { _focusEl.focus(); }, 120); "
        "setTimeout(() => { if (document.activeElement !== _focusEl) _focusEl.focus(); }, 320); } "
        "/* " + MARKER + " -- หน่วง Focus: Calendar Popup ปิดแล้วคืน Focus ให้ Date Input จึงต้องรอก่อน */"
    ) % {'r': ref}


REPLACEMENTS = [
    ('Full Page Add Tax',
     "if (v && addTaxInvoiceNumberRef.current) addTaxInvoiceNumberRef.current.focus();",
     deferred('addTaxInvoiceNumberRef')),
    ('Quick Action',
     "if (v && quickActionTaxInvoiceNumberRef.current) quickActionTaxInvoiceNumberRef.current.focus();",
     deferred('quickActionTaxInvoiceNumberRef')),
    ('Popvat Preview',
     "if (v && fTaxNoRef.current) fTaxNoRef.current.focus();",
     deferred('fTaxNoRef')),
]


def balance(s):
    # นับ Bracket (ข้ามข้อความใน String/Comment แบบหยาบ ๆ พอสำหรับเทียบก่อน-หลังด้วยส่วนที่เพิ่ม)
    return {c: s.count(c) for c in '(){}[]'}


def main():
    if not os.path.isfile(TARGET):
        print('ไม่พบไฟล์:', TARGET)
        sys.exit(1)
    with open(TARGET, 'r', encoding='utf-8', newline='') as f:
        src = f.read()

    if MARKER in src:
        print('ข้าม: ไฟล์นี้ Patch ไปแล้ว (%s)' % MARKER)
        return

    out = src
    for name, old, new in REPLACEMENTS:
        n = out.count(old)
        if n != 1:
            print('หยุด: จุด "%s" พบ Anchor %d ที่ (ต้องเจอ 1 ที่เท่านั้น) -> ไม่เขียนไฟล์' % (name, n))
            sys.exit(2)
        out = out.replace(old, new, 1)
        print('OK  :', name)

    # เช็ค Bracket Balance: ส่วนที่เพิ่มต้องสมดุลในตัวเอง -> ผลต่างรวมต้องเป็น 0 ทุกชนิด
    b0, b1 = balance(src), balance(out)
    for c in '(){}[]':
        # ส่วนที่เพิ่มมี ( ) { } เท่ากันคู่ -> เทียบ Delta ของคู่เปิด/ปิด
        pass
    for o, c in ('()', '{}', '[]'):
        d_open = b1[o] - b0[o]
        d_close = b1[c] - b0[c]
        if d_open != d_close:
            print('หยุด: Bracket %s%s ไม่สมดุลหลังแก้ (เปิด +%d / ปิด +%d) -> ไม่เขียนไฟล์' % (o, c, d_open, d_close))
            sys.exit(3)

    bak = TARGET + '.bak_dateautofocus_v1'
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak)
        print('สำรองไว้ที่:', bak)

    with open(TARGET, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('เสร็จ: แก้ %d จุด' % len(REPLACEMENTS))


if __name__ == '__main__':
    main()
