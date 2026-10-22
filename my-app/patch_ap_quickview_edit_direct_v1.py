# -*- coding: utf-8 -*-
"""
patch_ap_quickview_edit_direct_v1.py (src/pages/APController.js)
Quick View (ปุ่ม Detail ใน Invoice Detail) = เปิดแบบแก้ไขได้ทันที ไม่ต้องกด Edit ก่อน + มีกลไกกันพลาด
 1) เปิดมาเป็นโหมด edit (หัวข้อ Edit supplier, ซ่อนปุ่ม Edit, Save = UPDATE แถวเดิม)
 2) Auto Update (Sync สด) เฉพาะตอนผู้ใช้ยังไม่ได้แก้อะไร (ไม่ทับสิ่งที่กำลังพิมพ์)
 3) กด Back/Esc ตอนมีการแก้ที่ยังไม่ Save -> ถามยืนยันก่อนทิ้ง
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_QUICKVIEW_EDIT_DIRECT_V1"
R = [
("""        setEditTarget(viewItem); setFormState(f); setView('view');""",
 """        setEditTarget(viewItem); setFormState(f); setView('edit'); // MARKER_QUICKVIEW_EDIT_DIRECT_V1 -- Quick View เปิดแบบแก้ไขได้ทันที"""),
("""    if (!show || !initialViewCode || view !== 'view') return;
    const latest = supplierItems.find(i => String(i['Code'] ?? '').trim().toUpperCase() === String(initialViewCode).trim().toUpperCase());
    if (!latest || latest === editTarget) return;""",
 """    if (!show || !initialViewCode || view !== 'edit' || quickViewDirty()) return; // MARKER_QUICKVIEW_EDIT_DIRECT_V1 -- Sync เฉพาะตอนยังไม่ได้แก้
    const latest = supplierItems.find(i => String(i['Code'] ?? '').trim().toUpperCase() === String(initialViewCode).trim().toUpperCase());
    if (!latest || latest === editTarget) return;"""),
("""  // MARKER_QUICKVIEW_LIVE_SYNC_V1 -- Quick View (view mode) Sync""",
 """  // MARKER_QUICKVIEW_EDIT_DIRECT_V1 -- มีการแก้ที่ยังไม่ Save ใน Quick View ไหม
  const quickViewDirty = () => !!(initialViewCode && editTarget && (
    SUPPLIER_FIELDS.some(([k]) => k !== 'BU Code' && String(form[k] || '') !== String(editTarget[k] || '')) ||
    JSON.stringify(form['disabled_fields'] || []) !== JSON.stringify(Array.isArray(editTarget['disabled_fields']) ? editTarget['disabled_fields'] : [])
  ));

  // MARKER_QUICKVIEW_LIVE_SYNC_V1 -- Quick View (view mode) Sync"""),
("""  const handleBack = () => {
    if (initialViewCode) { onClose(); return; }""",
 """  const handleBack = async (force) => {
    if (initialViewCode) {
      if (force !== true && quickViewDirty() && !(await confirmDialog.confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการปิดโดยไม่บันทึกใช่หรือไม่?', { confirmText: 'ปิดโดยไม่บันทึก' }))) return; // MARKER_QUICKVIEW_EDIT_DIRECT_V1
      onClose(); return;
    }"""),
("""      broadcastWs('supplier_list_updated', { code: payload['Code'] || '' });
      handleBack();""",
 """      broadcastWs('supplier_list_updated', { code: payload['Code'] || '' });
      handleBack(true); // MARKER_QUICKVIEW_EDIT_DIRECT_V1 -- Save แล้วปิดเลย ไม่ถามซ้ำ"""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for o, n in R:
        if src.count(o) != 1: print("[ABORT] anchor %d ครั้ง: %s" % (src.count(o), o[:60])); sys.exit(1)
    for o, n in R: src = src.replace(o, n, 1)
    bk = path + ".bak_quickview_direct_v1"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_quickview_direct_v1_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(R), bk))
if __name__ == "__main__": main()
