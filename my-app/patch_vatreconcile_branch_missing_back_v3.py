# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_BRANCH_MISSING_BLOCK_EXPORT_V3
# Reconcile Report: ถ้า "สาขา" ไม่พบใน branch_list ของ BU นั้น -> rows[].branchMissing = true
# และ Export (POST /dashboard/report-files/export) ปฏิเสธ 422 พร้อมรายชื่อสาขาที่ไม่พบ
# แก้ 2 ไฟล์: vatReconcile.js และ vatReconcileReportFiles.js (อยู่โฟลเดอร์ routes เดียวกัน)
# ใช้: python patch_vatreconcile_branch_missing_back_v3.py <path routes\vatReconcile.js> <path routes\vatReconcileReportFiles.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_BRANCH_MISSING_BLOCK_EXPORT_V3"
def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์ใดๆ"); sys.exit(1)
    return src.replace(old, new)
def load(p):
    raw = open(p, "rb").read().decode("utf-8")
    return raw, ("\r\n" in raw), raw.replace("\r\n", "\n")
def save(p, src, crlf):
    n = 1
    while os.path.exists(f"{p}.bak{n:02d}"): n += 1
    shutil.copyfile(p, f"{p}.bak{n:02d}")
    open(p, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
    print(f"[OK] patched {p} (backup .bak{n:02d})")
p1 = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
p2 = sys.argv[2] if len(sys.argv) > 2 else r"C:\apps\fastapn-backend\src\routes\vatReconcileReportFiles.js"
raw1, crlf1, s1 = load(p1)
raw2, crlf2, s2 = load(p2)
if MARKER in s1 and MARKER in s2:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
s1 = safe_replace(s1,
    "        name,\n        branchStatus: bInfo.status || '',\n",
    "        name,\n        branchMissing: !branchInfo.has(String(branch).trim()), // " + MARKER + " -- ไม่พบสาขานี้ใน branch_list ของ BU\n        branchStatus: bInfo.status || '',\n",
    "branchMissing row")
old2 = '      if (!rep.rows || rep.rows.length === 0) return res.status(422).json({ error: "ไม่มีข้อมูลสำหรับ Export (BU / Account / Period นี้ยังไม่มียอด)" });\n'
new2 = old2 + '''      // ''' + MARKER + ''' -- สาขาที่ไม่พบใน branch_list ห้าม Export
      const missingBranches = rep.rows.filter((r) => r.branchMissing).map((r) => r.branch);
      if (missingBranches.length) return res.status(422).json({ error: `ไม่อนุญาตให้ Export: ไม่พบสาขา ${missingBranches.slice(0, 20).join(", ")}${missingBranches.length > 20 ? " ..." : ""} ในรายการสาขา (Branch) กรุณาเพิ่ม/แก้ข้อมูลสาขาก่อน`, missing_branches: missingBranches });
'''
s2 = safe_replace(s2, old2, new2, "export guard")
save(p1, s1, crlf1); save(p2, s2, crlf2)
