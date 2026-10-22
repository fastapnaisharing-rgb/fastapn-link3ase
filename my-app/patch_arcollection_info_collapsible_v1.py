# -*- coding: utf-8 -*-
# MARKER_ARCOLLECTION_INFO_COLLAPSIBLE_V1
# modal "AR_Collection Matching": เปลี่ยนกล่องสีฟ้าที่ยาวเป็นแถบสรุป "ใบกำกับภาษีที่ Match ได้ N รายการ"
# และกดปุ่ม "ดูรายละเอียด" จึงจะแสดงรายละเอียดเดิม (Gross Filter / Backup / diag). กล่อง error แสดงเสมอ
# วิธีใช้: วางไฟล์ที่ my-app\ แล้วรัน  python patch_arcollection_info_collapsible_v1.py
import os, sys, shutil
BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(BASE, 'src', 'pages', 'VatController.js')
MARK = 'MARKER_ARCOLLECTION_INFO_COLLAPSIBLE_V1'

A1 = "  const [sourceTab, setSourceTab] = React.useState('all'); // MARKER_VATWATCHLISTOPS_ARCOLLECTION_FILTER_SOURCE_V1\n"
N1 = A1 + "  const [showArInfo, setShowArInfo] = React.useState(false); // " + MARK + "\n"

A2 = "{result.grossFilteredBeforePrefilterCount > 0 && <>แถวหลัง Gross Filter"
N2 = ("<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>"
      "<span>ใบกำกับภาษีที่ Match ได้ <b>{rows.length.toLocaleString()}</b> รายการ (พร้อม Pop VAT {readyRows.length.toLocaleString()} · ต้องตรวจสอบ {reviewRows.length.toLocaleString()})</span>"
      "<button type=\"button\" onClick={() => setShowArInfo((v) => !v)} style={{ padding: '2px 10px', fontSize: '11px', borderRadius: '10px', border: '0.5px solid #B7CBE3', background: 'white', color: '#1a3a5c', cursor: 'pointer', flexShrink: 0 }}>{showArInfo ? 'ซ่อนรายละเอียด ▴' : 'ดูรายละเอียด ▾'}</button>"
      "</div>\n            {showArInfo && <div style={{ marginTop: '6px' }}>" + A2)
A3 = "{result.diagLines.join(' | ')}</div>}{/* MARKER_ARCOLLECTION_REVIEW_REASON_DIAG_V1 */}"
N3 = A3 + "</div>}"

def main():
    if not os.path.exists(TARGET):
        print('ไม่พบไฟล์', TARGET); sys.exit(1)
    s = open(TARGET, 'r', encoding='utf-8', newline='').read()
    if MARK in s:
        print('ติดตั้งแล้ว -- ข้าม'); return
    crlf = '\r\n' in s
    a1 = A1.replace('\n', '\r\n') if crlf else A1
    n1 = N1.replace('\n', '\r\n') if crlf else N1
    for n, a in (('state', a1), ('start', A2), ('end', A3)):
        if s.count(a) != 1:
            print('anchor %s พบ %d (ต้อง=1) -- ยกเลิก' % (n, s.count(a))); sys.exit(1)
    shutil.copy2(TARGET, TARGET + '.bak_ar_info_collapsible_v1')
    s = s.replace(a1, n1).replace(A2, N2).replace(A3, N3)
    open(TARGET, 'w', encoding='utf-8', newline='').write(s)
    print('OK (backup: VatController.js.bak_ar_info_collapsible_v1)')
main()
