# -*- coding: utf-8 -*-
# patch: หน้า "VAT Resource from Operation" (Popvat Report / Simple Input Report / ADI Upload) ดึงทั้ง draft และ fu-draft
#        แถว fu-draft แสดงสีจางแบบ Disable (opacity 0.5 + พื้นเทาอ่อน) (Generate file ฝั่ง Backend ยัง Export เฉพาะ status='draft' เหมือนเดิม -- ไม่แตะ)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:80])
    s = s.replace(a, b)
rep("return apiFetch(`/vat_upload_popvatdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)", "return apiFetch(`/vat_upload_popvatdraft?eq_bu=${encodeURIComponent(bu)}&in_status=draft,fu-draft`) // MARKER_UPLOADREPORT_INCLUDE_FU_V1\n     ")
rep("return apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)", "return apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu)}&in_status=draft,fu-draft`) // MARKER_UPLOADREPORT_INCLUDE_FU_V1\n     ")
rep("return apiFetch(`/vat_adi_transferdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)", "return apiFetch(`/vat_adi_transferdraft?eq_bu=${encodeURIComponent(bu)}&in_status=draft,fu-draft`) // MARKER_UPLOADREPORT_INCLUDE_FU_V1\n     ")
rep("<tr key={rowIdOf(row) || r} style={{ background: r % 2 === 0 ? 'white' : '#f7f9fb' }}>",
    "<tr key={rowIdOf(row) || r} title={row.status === 'fu-draft' ? 'FU-Draft (Over Period) -- ยังไม่ถูกรวมในไฟล์ที่ Generate' : undefined} style={{ background: row.status === 'fu-draft' ? '#f4f5f7' : (r % 2 === 0 ? 'white' : '#f7f9fb'), opacity: row.status === 'fu-draft' ? 0.5 : 1, boxShadow: row.status === 'fu-draft' ? 'inset 3px 0 0 #c7ccd3' : undefined }}>")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
