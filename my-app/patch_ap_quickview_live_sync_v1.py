# -*- coding: utf-8 -*-
"""
patch_ap_quickview_live_sync_v1.py (src/pages/APController.js)
แก้: Supplier Detail (Quick View จากปุ่ม Detail) ที่เปิดค้างอยู่ ไม่ Auto Update เมื่อมีคนแก้ Supplier (supplier_list_updated)
     -> เพิ่ม useEffect: เมื่อ supplierItems เปลี่ยน และ popup อยู่โหมด view (อ่านอย่างเดียว) ให้ Sync form/editTarget จาก Supplier ล่าสุด
     โหมด edit ไม่แตะ (กันทับสิ่งที่กำลังพิมพ์)
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_QUICKVIEW_LIVE_SYNC_V1"
OLD = """  }, [show, initialViewCode]);

  useEffect(() => {
    if (!show) return;"""
NEW = """  }, [show, initialViewCode]);

  // MARKER_QUICKVIEW_LIVE_SYNC_V1 -- Quick View (view mode) Sync ข้อมูลสดเมื่อ supplierItems เปลี่ยน (Auto Update)
  useEffect(() => {
    if (!show || !initialViewCode || view !== 'view') return;
    const latest = supplierItems.find(i => String(i['Code'] ?? '').trim().toUpperCase() === String(initialViewCode).trim().toUpperCase());
    if (!latest || latest === editTarget) return;
    const f = emptyForm();
    SUPPLIER_FIELDS.forEach(([key]) => { f[key] = latest[key] || ''; });
    f['BU Code'] = latest['BU Code'] || String(latest['Code'] ?? '').split('-')[0] || bu || '';
    f['disabled_fields'] = Array.isArray(latest['disabled_fields']) ? latest['disabled_fields'] : [];
    setEditTarget(latest); setFormState(f);
  }, [supplierItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show) return;"""
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    c = src.count(OLD)
    if c != 1: print("[ABORT] anchor %d ครั้ง (ต้อง 1)" % c); sys.exit(1)
    out = src.replace(OLD, NEW, 1)
    bk = path + ".bak_quickview_sync_v1"; n = 1
    while os.path.exists(bk): n += 1; bk = path + ".bak_quickview_sync_v1_" + str(n)
    shutil.copy2(path, bk)
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("[OK] แก้ 1 จุด | backup:", bk)
if __name__ == "__main__": main()
