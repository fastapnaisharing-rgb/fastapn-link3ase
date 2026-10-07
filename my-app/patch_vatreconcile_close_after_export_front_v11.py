# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_CLOSE_AFTER_EXPORT_V11 -- Export สำเร็จ -> ปิดหน้าต่าง Preview เอง (ไฟล์ไปอยู่ในรายการ "ที่เก็บไฟล์รายงานภาษี" ของหน้าหลักอยู่แล้ว)
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_CLOSE_AFTER_EXPORT_V11"
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
anc = "      setExportMsg({ ok: true, text: `เก็บไฟล์ ${f?.file_name || ''} ไว้ที่ \"ที่เก็บไฟล์รายงานภาษี\" แล้ว` });\n"
if src.count(anc) != 1:
    print(f"[ABORT] anchor พบ {src.count(anc)} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
src = src.replace(anc, anc + "      onClose(); // " + MARKER + "\n")
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
