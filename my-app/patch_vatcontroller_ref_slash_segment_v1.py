# -*- coding: utf-8 -*-
"""
patch_vatcontroller_ref_slash_segment_v1.py

ปัญหา: Invoice Ref. ใน Incomplete บางแถวเป็นรูปแบบ  <รหัสสาขา>/<Invoice Ref จริง>/<เลข Running>
        เช่น  A50R6/S01D9IN26070137/34812
        ฝั่งไฟล์ (AR TRX_NUMBER / Inbox) เป็น  S01D9IN26070137
        โค้ดเดิมตัดได้แค่ รหัส BU นำหน้า / ปี นำหน้า / _ท้าย / "/1-3 หลัก" ท้าย -> ไม่มีรูปแบบไหนตรง -> Match ด้วย Ref ไม่ได้
วิธีแก้: แตก Original Invoice Ref. (invoice_ref ดิบ) ที่มีตัวคั่น / _ ช่องว่าง , ; เป็นท่อนๆ แล้วเพิ่มท่อนที่หน้าตาเป็น Invoice Ref (ยาว >= 10, มีตัวอักษร, มีเลข >= 6 หลักติดกัน)
        เป็น Key เพิ่มอีกชุด (Key เดิมยังอยู่ครบ -> ไม่กระทบรูปแบบอื่น)
แก้ 2 จุดใน src/pages/VatController.js:
  1) refVariantsOfStr  (Inbox / PDF Matching)
  2) getArMatchIndex   (AR_Collection Matching: refMap / refGroups)
วิธีใช้: วางไว้ที่ my-app (ระดับเดียวกับ src) แล้วรัน  python patch_vatcontroller_ref_slash_segment_v1.py
"""
import os
import shutil
import sys

MARKER = 'MARKER_REF_SLASH_SEGMENT_V1'
BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'src', 'pages', 'VatController.js')

OLD1 = "  const forms = [base, stripBuPrefix(base, bu)];\n"
NEW1 = (
    "  const forms = [base, stripBuPrefix(base, bu)];\n"
    "  if (/[\\/_\\s,;]/.test(base)) { base.split(/[\\/_\\s,;]+/).map((s) => s.trim()).filter((s) => s.length >= 10 && /[A-Za-z]/.test(s) && /\\d{6,}/.test(s)).forEach((seg) => { forms.push(seg); forms.push(stripBuPrefix(seg, bu)); }); } // " + MARKER + " -- Ref แบบ <สาขา>/<Ref จริง>/<Running> (เช่น A50R6/S01D9IN26070137/34812) -> เพิ่มท่อน Ref จริงเป็น Key\n"
)

OLD2 = "    const sc = norm(row.supplier_code);\n    let arr = bySupplier.get(sc);\n"
NEW2 = (
    "    if (/[\\/_\\s,;]/.test(rf)) { rf.split(/[\\/_\\s,;]+/).map((s) => s.trim()).filter((s) => s.length >= 10 && /[A-Za-z]/.test(s) && /\\d{6,}/.test(s)).forEach((seg) => { [seg, norm(stripBuPrefix(seg, row.bu))].forEach((k2) => { if (!k2 || k2 === rf) return; if (!refMap.has(k2)) refMap.set(k2, row); const rg = refGroups.get(k2); if (!rg) refGroups.set(k2, [row]); else if (!rg.includes(row)) rg.push(row); }); }); } // " + MARKER + " -- เหมือนด้านบน สำหรับ AR_Collection (Key เดิมยังอยู่)\n"
    + OLD2
)

PAIRS = [('refVariantsOfStr', OLD1, NEW1), ('getArMatchIndex', OLD2, NEW2)]


def main():
    if not os.path.isfile(TARGET):
        print('ไม่พบไฟล์:', TARGET); sys.exit(1)
    with open(TARGET, 'r', encoding='utf-8', newline='') as f:
        src = f.read()
    if MARKER in src:
        print('ข้าม: Patch ไปแล้ว (%s)' % MARKER); return
    crlf = '\r\n' in src
    out = src
    for name, old, new in PAIRS:
        if crlf:
            old = old.replace('\n', '\r\n'); new = new.replace('\n', '\r\n')
        n = out.count(old)
        if n != 1:
            print('หยุด: จุด "%s" พบ Anchor %d ที่ (ต้องเจอ 1 ที่) -> ไม่เขียนไฟล์' % (name, n)); sys.exit(2)
        out = out.replace(old, new, 1)
        print('OK  :', name)
    for o, c in ('()', '{}', '[]'):
        if (out.count(o) - src.count(o)) != (out.count(c) - src.count(c)):
            print('หยุด: Bracket %s%s ไม่สมดุลหลังแก้ -> ไม่เขียนไฟล์' % (o, c)); sys.exit(3)
    bak = TARGET + '.bak_refslash_v1'
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak); print('สำรองไว้ที่:', bak)
    with open(TARGET, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('เสร็จ: แก้ %d จุด' % len(PAIRS))


if __name__ == '__main__':
    main()
