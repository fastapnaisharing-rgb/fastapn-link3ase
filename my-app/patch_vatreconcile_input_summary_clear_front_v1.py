# -*- coding: utf-8 -*-
"""patch_vatreconcile_input_summary_clear_front_v1
หน้า Input Summary Report (Popup Double-click): เพิ่มปุ่ม "ล้างข้อมูล" ลบทุกแถวของ BU + Account + Period นั้น
(ต้องใช้คู่กับ Backend patch_vatreconcile_input_summary_clear_back_v1.py)
รันที่โฟลเดอร์ my-app:  python patch_vatreconcile_input_summary_clear_front_v1.py
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatReconcileDashboard.js")
MARKER = "VATRECONCILE_INPUT_SUMMARY_CLEAR_V1"

A1 = "async function deleteReportFile(file) { // MARKER_VATRECONCILE_REPORT_FILES_DELETE_V1\n"
N1 = (
"async function clearInputSummary({ bu, account, period }) { // MARKER_VATRECONCILE_INPUT_SUMMARY_CLEAR_V1 -- ลบ Input Summary ทั้งก้อนของ BU+Account+Period\n"
"  const token = sessionStorage.getItem('fastapn_token');\n"
"  const params = new URLSearchParams({ bu, account, period });\n"
"  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/input-summary?${params}`, {\n"
"    method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {},\n"
"  });\n"
"  const d = await res.json().catch(() => ({}));\n"
"  if (!res.ok) throw new Error(d?.error || `ล้างข้อมูลไม่สำเร็จ (HTTP ${res.status})`);\n"
"  return d;\n"
"}\n\n"
)

A2 = "  // โหลดรายการ Period ที่มีข้อมูลจริง (จาก TB/Input Summary) ครั้งเดียวตอนเปิดหน้า\n"
N2 = (
"  // MARKER_VATRECONCILE_INPUT_SUMMARY_CLEAR_V1 -- ปุ่ม \"ล้างข้อมูล\" ใน Popup Input Summary Report\n"
"  const handleClearInputSummary = async () => {\n"
"    const m = quickPreviewModal;\n"
"    if (!m || m.type !== 'input_summary') return;\n"
"    const n = m.data?.rows?.length || 0;\n"
"    const ok = await confirmDialog.confirm(\n"
"      `ล้างข้อมูล Input Summary\\n${m.bu} · ${m.account} · ${formatPeriodLabel(period)}\\nจะลบ ${n.toLocaleString()} แถว กู้คืนไม่ได้ (นำเข้าไฟล์ใหม่ได้ที่หน้า Upload)`,\n"
"      { title: 'ล้างข้อมูล Input Summary', confirmText: 'ล้างข้อมูล', cancelText: 'ยกเลิก', variant: 'danger' }\n"
"    );\n"
"    if (!ok) return;\n"
"    try {\n"
"      await clearInputSummary({ bu: m.bu, account: m.account, period });\n"
"      setQuickPreviewModal((prev) => (prev ? { ...prev, data: { ...prev.data, rows: [] } } : prev));\n"
"      loadStatus(period);\n"
"    } catch (err) {\n"
"      setQuickPreviewModal((prev) => (prev ? { ...prev, error: err?.message || 'ล้างข้อมูลไม่สำเร็จ' } : prev));\n"
"    }\n"
"  };\n\n"
)

A3 = (
"              <button\n"
"                type=\"button\"\n"
"                aria-label=\"ปิด\"\n"
"                onClick={() => setQuickPreviewModal(null)}\n"
"                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}\n"
"              >\n"
"                ✕\n"
"              </button>\n"
)
N3 = (
"              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>\n"
"                {quickPreviewModal.type === 'input_summary' && !quickPreviewModal.loading && !quickPreviewModal.error && (quickPreviewModal.data?.rows?.length || 0) > 0 && (\n"
"                  <button type=\"button\" title=\"ลบข้อมูล Input Summary ทั้งหมดของ BU / Account / Period นี้\" onClick={handleClearInputSummary} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid #cf222e', background: '#fff', color: '#cf222e', cursor: 'pointer' }}>ล้างข้อมูล</button>\n"
"                )}\n"
+ A3.replace("              <button", "                <button").replace("\n                ", "\n                  ").replace("\n              >\n", "\n                >\n").replace("              </button>", "                </button>")
+ "              </div>\n"
)

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a in (A1, A2, A3):
        if s.count(a) != 1:
            print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์\n%s" % (s.count(a), a[:80])); sys.exit(1)
    s = s.replace(A1, N1 + A1).replace(A2, N2 + A2).replace(A3, N3)
    for a, b in ("{}", "()", "[]"):
        if s.count(a) != s.count(b):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
