# -*- coding: utf-8 -*-
"""
patch_ap_quickview_save_update_v1.py (src/pages/APController.js)
แก้: Supplier Detail (Quick View โหมด view) กด Toggle แล้ว Save ได้เลย โดยไม่ต้องกด Edit
     เดิม handleSave: UPDATE เฉพาะ view==='edit' -> โหมด view ตกไป INSERT (สร้าง Supplier ซ้ำ!)
     ใหม่: view==='view' + มี editTarget.id = UPDATE Supplier เดิม (Validate แบบ edit)
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_QUICKVIEW_SAVE_UPDATE_V1"
R = [
("""    const err = validate(form, view); if (err) { setFormError(err); return; } // MARKER_SUPPLIER_EDIT_VALIDATE_RELAX_V1""",
 """    const err = validate(form, view === 'view' ? 'edit' : view); if (err) { setFormError(err); return; } // MARKER_SUPPLIER_EDIT_VALIDATE_RELAX_V1 // MARKER_QUICKVIEW_SAVE_UPDATE_V1"""),
("""      if (view === 'edit' && editTarget?.id) {
        console.log('[DEBUG SupplierSave] -> UPDATE', editTarget.id);""",
 """      if ((view === 'edit' || view === 'view') && editTarget?.id) { // MARKER_QUICKVIEW_SAVE_UPDATE_V1 -- view mode (Quick View) = Update ตัวเดิม ไม่ใช่ INSERT
        console.log('[DEBUG SupplierSave] -> UPDATE', editTarget.id);"""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for o, n in R:
        if src.count(o) != 1: print("[ABORT] anchor %d ครั้ง" % src.count(o)); sys.exit(1)
    for o, n in R: src = src.replace(o, n, 1)
    bk = path + ".bak_quickview_save_v1"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_quickview_save_v1_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ 2 จุด | backup:", bk)
if __name__ == "__main__": main()
