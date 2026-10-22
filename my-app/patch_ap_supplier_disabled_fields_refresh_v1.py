# -*- coding: utf-8 -*-
"""
patch_ap_supplier_disabled_fields_refresh_v1.py  (src/pages/APController.js)
แก้: ปิด/เปิด Config "ปิดการใช้งาน Field ใน Invoice Detail" (Method/Paygroup/Par/Invoice num/Real Tax Invoice/Duplicate Notice)
     ที่ Supplier Detail แล้วกด Save -> Invoice Detail ที่เปิดอยู่ไม่ Refresh ทันที (ต้องรอ Poll 60 วิ)
สาเหตุ: Listener 'supplier_list_updated' ของ InvoiceEntry เรียก fetchCollection แล้ว lookupVendor() ต่อทันที
        แต่ lookupVendor ใช้ supplierItems ของ Render เก่า (Closure) -> ได้ vendorInfo เดิม
แก้เฉพาะจุดเดียว: หลัง fetch เสร็จให้ bump ตัวนับ แล้ว useEffect เรียก lookupVendor ใน Render ใหม่ที่มีข้อมูลสด
วิธีรัน:  python patch_ap_supplier_disabled_fields_refresh_v1.py [path/to/APController.js]
"""
import sys, os, shutil

DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_INVOICEENTRY_SUPPLIER_REFRESH_TICK_V1"

OLD = """  useRealtimeRefresh(['supplier_list_updated'], async () => {
    if (!form.supplierCode?.trim()) return;
    if (fetchCollection) await fetchCollection('SupplierList', true);
    lookupVendor(form.supplierCode);
  });
"""
NEW = """  const [supplierRefreshTick, setSupplierRefreshTick] = useState(0); // MARKER_INVOICEENTRY_SUPPLIER_REFRESH_TICK_V1
  useRealtimeRefresh(['supplier_list_updated'], async () => {
    if (!form.supplierCode?.trim()) return;
    if (fetchCollection) await fetchCollection('SupplierList', true);
    // MARKER_INVOICEENTRY_SUPPLIER_REFRESH_TICK_V1 -- เดิมเรียก lookupVendor(form.supplierCode) ตรงนี้ แต่ใช้ supplierItems ของ Render เก่า (Closure)
    // -> vendorInfo/disabled_fields ไม่เปลี่ยนจนกว่า Poll 60 วิ | เปลี่ยนเป็น bump ตัวนับ แล้วให้ useEffect ด้านล่างค้นใน Render ใหม่ที่มีข้อมูลสด
    setSupplierRefreshTick(t => t + 1);
  });
  useEffect(() => { // MARKER_INVOICEENTRY_SUPPLIER_REFRESH_TICK_V1
    if (supplierRefreshTick > 0 && form.supplierCode?.trim()) lookupVendor(form.supplierCode);
  }, [supplierRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
"""

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src:
        print("[SKIP] มีแล้ว (", MARKER, ")"); return
    c = src.count(OLD)
    if c != 1:
        print("[ABORT] anchor match %d ครั้ง (ต้อง 1) -- ยังไม่แก้ไฟล์" % c); sys.exit(1)
    out = src.replace(OLD, NEW, 1)
    bk = path + ".bak_supplier_refresh_v1"
    n = 1
    while os.path.exists(bk):
        n += 1; bk = path + ".bak_supplier_refresh_v1_" + str(n)
    shutil.copy2(path, bk)
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("[OK] แก้ 1 จุด | DONE -> backup:", bk)

if __name__ == "__main__":
    main()
