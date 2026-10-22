# -*- coding: utf-8 -*-
"""
patch_ap_quickview_disabled_fields_v1.py (src/pages/APController.js)
แก้: เปิด Supplier Detail จากปุ่ม "Detail" (Quick View) แล้ว Toggle Config ปิด Field แสดง On หมด
     ทั้งที่ Invoice Detail โดนปิด Field ไปแล้ว -- เพราะ useEffect ของ Quick View ไม่ Copy disabled_fields เข้า form
     (ปุ่ม Edit ปกติ handleOpenEdit Copy อยู่แล้ว)  | Save ตอนนั้นจะทับ disabled_fields เป็น [] ด้วย -- อันตราย
วิธีรัน: python patch_ap_quickview_disabled_fields_v1.py [path]
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_QUICKVIEW_DISABLED_FIELDS_COPY_V1"
OLD = """        f['BU Code'] = viewItem['BU Code'] || String(viewItem['Code'] ?? '').split('-')[0] || bu || '';
        setEditTarget(viewItem); setFormState(f); setView('view');"""
NEW = """        f['BU Code'] = viewItem['BU Code'] || String(viewItem['Code'] ?? '').split('-')[0] || bu || '';
        f['disabled_fields'] = Array.isArray(viewItem['disabled_fields']) ? viewItem['disabled_fields'] : []; // MARKER_QUICKVIEW_DISABLED_FIELDS_COPY_V1
        setEditTarget(viewItem); setFormState(f); setView('view');"""
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    c = src.count(OLD)
    if c != 1: print("[ABORT] anchor %d ครั้ง (ต้อง 1)" % c); sys.exit(1)
    out = src.replace(OLD, NEW, 1)
    bk = path + ".bak_quickview_df_v1"; n = 1
    while os.path.exists(bk): n += 1; bk = path + ".bak_quickview_df_v1_" + str(n)
    shutil.copy2(path, bk)
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("[OK] แก้ 1 จุด | backup:", bk)
if __name__ == "__main__": main()
