# -*- coding: utf-8 -*-
"""
patch_vatcontroller_dupguard_ignore_self_bucket_v1.py
Full Page > Add Data: ใบกำกับภาษีที่ Load มาจาก Bucket "คือแถวใน vat_backup_tax_invoice อยู่แล้ว"
ตัวเช็คซ้ำ (vatDupFindExisting) เลยเจอแถวต้นทางของตัวเองแล้วเด้ง "ตรวจพบรายการซ้ำ ... มีแล้วใน Tax Invoice Backup" ทั้งที่ไม่ซ้ำ
แก้: ส่ง id แถว Backup ต้นทาง (bucketTaxId) เข้าไป แล้วให้ตัวเช็คซ้ำข้ามแถวนั้น
     (ถ้ามีแถว Backup "อื่น" ที่ซ้ำกันจริง ยังเตือนเหมือนเดิม)
"""
import sys, shutil, os

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_VAT_DUP_GUARD_IGNORE_SELF_BUCKET_V1"

OLD1 = "addTaxInvoiceList.map((t) => ({ bu: bu?.bu, inv: t.taxInvoiceNo, vat: t.vat }))"
NEW1 = "addTaxInvoiceList.map((t) => ({ bu: bu?.bu, inv: t.taxInvoiceNo, vat: t.vat, bkId: t.bucketTaxId || null /* " + MARKER + " */ }))"
OLD2 = "if (bk.some((y) => String(y.status || '') !== 'deleted' && "
NEW2 = "if (bk.some((y) => String(y.status || '') !== 'deleted' && !(x.bkId != null && String(y.id) === String(x.bkId)) /* " + MARKER + " -- ข้ามแถว Backup ต้นทางที่ Load มาจาก Bucket */ && "

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    for name, old in (("OLD1", OLD1), ("OLD2", OLD2)):
        c = txt.count(old)
        if c != 1:
            print(f"ABORT: {name} found {c} times (need 1)"); sys.exit(1)
    shutil.copy2(path, path + ".bak_dupguard_self_v1")
    txt = txt.replace(OLD1, NEW1).replace(OLD2, NEW2)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
