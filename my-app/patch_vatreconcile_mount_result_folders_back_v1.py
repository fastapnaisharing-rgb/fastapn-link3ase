# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_MOUNT_RESULT_FOLDERS_V1
# Backend: Mount Router "Reconcile Results Folder" (vatResultFolders.js) เข้า vatReconcile.js
#   -> /api/vat-reconcile/result-folders/...
# ต้องวางไฟล์ vatResultFolders.js ไว้ที่ C:\apps\fastapn-backend\src\routes\ ก่อน แล้วค่อยรัน Patch นี้
# ใช้: python patch_vatreconcile_mount_result_folders_back_v1.py [path vatReconcile.js]
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_MOUNT_RESULT_FOLDERS_V1"
def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์"); sys.exit(1)
    return src.replace(old, new)
path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
if not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(path)), "vatResultFolders.js")):
    print("[ABORT] ไม่พบ vatResultFolders.js ในโฟลเดอร์เดียวกับ vatReconcile.js -- วางไฟล์ก่อน"); sys.exit(1)
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
src = safe_replace(src,
    'import createReportFilesRouter from "./vatReconcileReportFiles.js";\n',
    'import createReportFilesRouter from "./vatReconcileReportFiles.js";\n'
    'import createVatResultFoldersRouter from "./vatResultFolders.js"; // ' + MARKER + '\n',
    "import createReportFilesRouter")
src = safe_replace(src,
    'router.use(createReportFilesRouter({ reconcileReportHandler })); // MARKER_VATRECONCILE_REPORT_FILES_V1\n',
    'router.use(createReportFilesRouter({ reconcileReportHandler })); // MARKER_VATRECONCILE_REPORT_FILES_V1\n'
    'router.use("/result-folders", createVatResultFoldersRouter()); // ' + MARKER + '\n',
    "router.use createReportFilesRouter")
shutil.copyfile(path, path + ".bak")  # .bak เดียว ทับทุกครั้ง
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup {path}.bak)")
