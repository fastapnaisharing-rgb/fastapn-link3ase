# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_BRANCH_MISSING_FRONT_V10
# หน้า Cover: แถวที่ branchMissing (ไม่พบสาขาใน branch_list) = ไฮไลต์แดงทั้งแถว + ไอคอน Notice บอก + ปิดปุ่ม Export พร้อมข้อความ
# ต้องรันหลัง patch ... single_notice_icon_front_v9.py และใช้คู่ patch_vatreconcile_branch_missing_back_v3.py
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_BRANCH_MISSING_FRONT_V10"
def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์"); sys.exit(1)
    return src.replace(old, new)
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
if "MARKER_VATRECONCILE_SINGLE_NOTICE_ICON_V9" not in src:
    print("[ABORT] ต้องรัน v9 ก่อน"); sys.exit(1)
src = safe_replace(src, "<tr key={r.branch}>",
    "<tr key={r.branch} style={r.branchMissing ? { background: '#ffd6d6' } : undefined} title={r.branchMissing ? 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export' : undefined}>", "row")
src = safe_replace(src, "                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,\n",
    "                                r.branchMissing && 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export', // " + MARKER + "\n                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,\n", "issues")
src = safe_replace(src, "const severe = !ok || hasOver;", "const severe = !ok || hasOver || r.branchMissing;", "severe")
src = safe_replace(src, "  const hasDiff = data ?",
    "  const missingBranches = data ? data.rows.filter((r) => r.branchMissing).map((r) => r.branch) : []; // " + MARKER + "\n  const hasDiff = data ?", "missing list")
src = safe_replace(src, "data.rows.length === 0} style=", "data.rows.length === 0 || missingBranches.length > 0} style=", "disabled")
src = safe_replace(src, "data.rows.length === 0 ? 0.5 : 1", "data.rows.length === 0 || missingBranches.length > 0 ? 0.5 : 1", "opacity")
anc = "          {exportMsg && <span style={{ fontSize: 12.5, marginRight: 'auto', color: exportMsg.ok ? '#1a7f37' : '#cf222e' }}>{exportMsg.text}</span>}\n"
src = safe_replace(src, anc,
    "          {missingBranches.length > 0 && !exportMsg && <span style={{ fontSize: 12.5, marginRight: 'auto', color: '#cf222e', fontWeight: 600 }}>ไม่อนุญาตให้ Export: ไม่พบสาขา {missingBranches.slice(0, 5).join(', ')}{missingBranches.length > 5 ? ` และอีก ${missingBranches.length - 5} สาขา` : ''} ในรายการสาขา (Branch) — แถวไฮไลต์แดง</span>}\n" + anc, "msg")
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
