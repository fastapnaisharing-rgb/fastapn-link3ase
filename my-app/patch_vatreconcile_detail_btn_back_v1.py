# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_INPUTSUMMARY_DETAIL_BRANCH_FILTER_V1
# GET /vat-reconcile/dashboard/report?type=input_summary&view=detail รองรับ ?branch= (กรองเฉพาะสาขาเดียว)
# ไม่ส่ง branch = เหมือนเดิม (ทุกสาขา)
# ใช้: python patch_vatreconcile_detail_btn_back_v1.py <path ของ routes\vatReconcile.js>
import sys, shutil, os

MARKER = "MARKER_VATRECONCILE_INPUTSUMMARY_DETAIL_BRANCH_FILTER_V1"

def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์")
        sys.exit(1)
    return src.replace(old, new)

path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
with open(path, "rb") as f:
    raw = f.read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")

if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว")
    sys.exit(0)

old = """           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
           ORDER BY branch, tax_invoice_date`,
          [bu, account, period]
        );"""
new = """           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
             AND ($4::text IS NULL OR branch::text = $4::text) -- """ + MARKER + """
           ORDER BY branch, tax_invoice_date`,
          [bu, account, period, req.query.branch ? String(req.query.branch) : null]
        );"""
src = safe_replace(src, old, new, "input_summary detail query")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
