# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_STATUS_ERROR_LABEL_V6 -- ป้ายสาขาที่ไม่ Balance: "Not Balance" -> "Error: Not Balance"
# ต้องรันหลัง patch_vatreconcile_status_notbalance_front_v5.py
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_STATUS_ERROR_LABEL_V6"
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
old = "{pill(false, 'Not Balance')}"
if src.count(old) != 1 or "MARKER_VATRECONCILE_STATUS_NOT_BALANCE_V5" not in src:
    print("[ABORT] anchor ไม่ตรง / ยังไม่ได้รัน v5"); sys.exit(1)
src = src.replace(old, "{pill(false, 'Error: Not Balance')}{/* " + MARKER + " */}")
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
