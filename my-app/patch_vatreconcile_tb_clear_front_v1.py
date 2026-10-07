# -*- coding: utf-8 -*-
"""patch_vatreconcile_tb_clear_front_v1
ขยายปุ่ม "ล้างข้อมูล" ให้ใช้ได้กับ Popup Trial Balance Report ด้วย (ต้องรัน patch_vatreconcile_input_summary_clear_front_v1.py ก่อน)
รันที่โฟลเดอร์ my-app:  python patch_vatreconcile_tb_clear_front_v1.py
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatReconcileDashboard.js")
BASE_MARKER = "VATRECONCILE_INPUT_SUMMARY_CLEAR_V1"
MARKER = "VATRECONCILE_TB_CLEAR_V1"

EDITS = [
 ("async function clearInputSummary({ bu, account, period }) {",
  "async function clearInputSummary({ type, bu, account, period }) { // MARKER_VATRECONCILE_TB_CLEAR_V1 -- type = 'tb' | 'input_summary'"),
 ("/vat-reconcile/input-summary?${params}`, {\n    method: 'DELETE'",
  "/vat-reconcile/${type === 'tb' ? 'tb' : 'input-summary'}?${params}`, {\n    method: 'DELETE'"),
 ("if (!m || m.type !== 'input_summary') return;",
  "if (!m || (m.type !== 'input_summary' && m.type !== 'tb')) return;\n    const rpName = QUICK_PREVIEW_LABEL[m.type] || 'Report';"),
 ("`ล้างข้อมูล Input Summary\\n${m.bu}", "`ล้างข้อมูล ${rpName}\\n${m.bu}"),
 ("{ title: 'ล้างข้อมูล Input Summary', confirmText", "{ title: `ล้างข้อมูล ${rpName}`, confirmText"),
 ("await clearInputSummary({ bu: m.bu,", "await clearInputSummary({ type: m.type, bu: m.bu,"),
 ("setQuickPreviewModal((prev) => (prev ? { ...prev, error: err?.message || 'ล้างข้อมูลไม่สำเร็จ' } : prev));",
  "confirmDialog.alert(err?.message || 'ล้างข้อมูลไม่สำเร็จ', { title: 'ล้างข้อมูลไม่สำเร็จ', variant: 'danger' }); // แจ้งเตือนแทนการซ่อนตาราง (เช่น TB ถูก Freeze)"),
 ("{quickPreviewModal.type === 'input_summary' && !quickPreviewModal.loading",
  "{(quickPreviewModal.type === 'input_summary' || quickPreviewModal.type === 'tb') && !quickPreviewModal.loading"),
 ('title="ลบข้อมูล Input Summary ทั้งหมดของ BU / Account / Period นี้"',
  'title="ลบข้อมูลของ Report นี้ทั้งหมดของ BU / Account / Period นี้"'),
]

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("\ufeff")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    if BASE_MARKER not in src:
        print("ERROR: ยังไม่ได้รัน patch_vatreconcile_input_summary_clear_front_v1.py - ไม่เขียนไฟล์"); sys.exit(1)
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _ in EDITS:
        if s.count(a) != 1:
            print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์\n%s" % (s.count(a), a[:80])); sys.exit(1)
    for a, b in EDITS:
        s = s.replace(a, b)
    for a, b in ("{}", "()", "[]"):
        if s.count(a) != s.count(b):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
