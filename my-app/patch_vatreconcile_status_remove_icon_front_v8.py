# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_STATUS_NO_WARN_ICON_V8 -- เอาไอคอนเตือนสรุป (v7) ออกจากช่อง NOTE/STATUS เหลือเฉพาะไอคอน Detail
# ต้องรันหลัง patch ... summary_icon_front_v7.py
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_STATUS_NO_WARN_ICON_V8"
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
start_m = "                            {/* MARKER_VATRECONCILE_STATUS_SUMMARY_ICON_V7 -- ไอคอนเตือนสรุป (ชี้เมาส์ดูรายการ / กด = ไปหน้า Detail) */}\n"
end_m = "                            })()}\n"
if src.count(start_m) != 1:
    print("[ABORT] ไม่พบ block v7 -- ไม่เขียนไฟล์"); sys.exit(1)
s = src.index(start_m)
e = src.index(end_m, s)
if src.count(end_m, s, e + len(end_m)) != 1:
    print("[ABORT] anchor จบ block ไม่ชัดเจน"); sys.exit(1)
e += len(end_m)
src = src[:s] + "                            {/* " + MARKER + " -- ไม่แสดงไอคอนเตือน เหลือเฉพาะไอคอน Detail */}\n" + src[e:]
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
