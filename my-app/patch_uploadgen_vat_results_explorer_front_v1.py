# -*- coding: utf-8 -*-
# MARKER_UPLOADGEN_VAT_RESULTS_EXPLORER_V1
# Resource Center > Document Center > Tile "VAT Control": แทนหน้า "Module นี้ยังไม่เปิดใช้งาน" ด้วยหน้า Folder
# เก็บ Reconcile Results (เดือน > BU > ไฟล์) -- Component อยู่ใน src/pages/ReconcileResultsExplorer.js (วางไฟล์ก่อนรัน Patch)
# ใช้: python patch_uploadgen_vat_results_explorer_front_v1.py [path UploadGen.js]
import sys, shutil, os
MARKER = "MARKER_UPLOADGEN_VAT_RESULTS_EXPLORER_V1"
def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์"); sys.exit(1)
    return src.replace(old, new)
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\UploadGen.js"
if not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(path)), "ReconcileResultsExplorer.js")):
    print("[ABORT] ไม่พบ ReconcileResultsExplorer.js ในโฟลเดอร์เดียวกับ UploadGen.js -- วางไฟล์ก่อน"); sys.exit(1)
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)

src = safe_replace(src,
    "import { broadcastWs, subscribeWs } from '../wsManager';\n",
    "import { broadcastWs, subscribeWs } from '../wsManager';\n"
    "import ReconcileResultsExplorer from './ReconcileResultsExplorer'; // " + MARKER + "\n",
    "import wsManager")

# แสดงหน้า Folder เมื่อเข้า Tile VAT Control (ก่อนบล็อก "Module นี้ยังไม่เปิดใช้งาน")
block = (
"  // " + MARKER + " -- VAT Control = ที่เก็บ Reconcile Results (Esc: ปิดเมนู/Dialog ก่อน, ไม่มีอะไรเปิด = Back ตาม Effect เดิม)\n"
"  if (activeFolder && activeFolder.key === 'vat') {\n"
"    return (\n"
"      <div style={{ display:'flex',flexDirection:'column',flex:1,height:'100%',overflow:'hidden',position:'relative' }}>\n"
"        <ReconcileResultsExplorer onBack={() => { setActiveFolder(null); fetchData(); }} />\n"
"      </div>\n"
"    );\n"
"  }\n\n")
src = safe_replace(src,
    "  // MARKER_DOCUMENTCENTER_COMING_SOON_V1\n",
    block + "  // MARKER_DOCUMENTCENTER_COMING_SOON_V1\n",
    "COMING_SOON")

shutil.copyfile(path, path + ".bak")  # .bak เดียว ทับทุกครั้ง
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup {path}.bak)")
