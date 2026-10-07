# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_STATUS_NOT_BALANCE_V5
# หน้า Cover (Reconcile): ช่อง NOTE/STATUS ไม่แสดงคำว่า "ตรงกัน"/"ไม่ตรง" อีก
#   - สาขาที่ Balance = ไม่แสดงป้ายสถานะ
#   - สาขาที่ไม่ Balance = ป้ายแดง "Not Balance" (เอา Mouse ชี้เห็นสถานะเดิมจาก Backend)
#   - ป้าย Over Period / Future Date ไม่เปลี่ยน
# ต้องรันหลัง patch_vatreconcile_remove_tabs_back_front_v4.py (ใช้ได้กับไฟล์ที่ผ่าน v3 แล้วเช่นกัน)
# ใช้: python patch_vatreconcile_status_notbalance_front_v5.py <path ของ src\pages\VatReconcileDashboard.js>
import sys, shutil, os

MARKER = "MARKER_VATRECONCILE_STATUS_NOT_BALANCE_V5"

def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์")
        sys.exit(1)
    return src.replace(old, new)

path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
with open(path, "rb") as f:
    raw = f.read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")

if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว")
    sys.exit(0)
if "MARKER_VATRECONCILE_DETAIL_ICON_V3" not in src:
    print("[ABORT] ต้องรัน patch ไอคอน Detail (v3) ก่อน")
    sys.exit(1)

src = safe_replace(src,
    "                            {pill(ok, r.status)}\n",
    "                            {/* " + MARKER + " */}\n"
    "                            {!ok && <span title={r.status}>{pill(false, 'Not Balance')}</span>}\n",
    "status pill")
src = safe_replace(src,
    "เฉพาะสาขาที่ไม่ตรงกัน",
    "เฉพาะสาขา Not Balance",
    "filter label")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
