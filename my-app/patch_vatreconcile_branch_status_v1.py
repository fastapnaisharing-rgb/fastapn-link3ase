# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_BRANCH_STATUS_V1
# เพิ่ม สถานะสาขา (branch_list.status: Active/Closed/Relocate/Temporary + Inactive Date) ใน /dashboard/reconcile-report
# วิธีใช้:  python patch_vatreconcile_branch_status_v1.py src\routes\vatReconcile.js   แล้ว Restart-Service fastapn-backend
# Idempotent | .bak ไฟล์เดียว | node --check | ไม่ผ่าน -> คืนไฟล์เดิม
import sys, io, shutil, subprocess
if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_branch_status_v1.py <path to vatReconcile.js>"); sys.exit(2)
path = sys.argv[1]
src = io.open(path, encoding="utf-8", newline="").read()
N = "MARKER_VATRECONCILE_BRANCH_STATUS_V1"
if N in src:
    print("already patched"); sys.exit(0)
crlf = "\r\n" in src
s = src.replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, "anchor x%d: %s" % (s.count(a), a[:60])
    s = s.replace(a, b)
rep("    const branchNames = new Map();\n", "    const branchNames = new Map();\n    const branchInfo = new Map(); // " + N + " -- สถานะสาขา\n")
rep("          for (const r of bq.rows) {\n            if (r[codeKey] != null && nameKey && r[nameKey]) branchNames.set(String(r[codeKey]).trim(), String(r[nameKey]).trim());",
    "          const stKey = reconPickKey(bq.rows[0], /^status$/i);\n          const inKey = reconPickKey(bq.rows[0], /inactive/i);\n          for (const r of bq.rows) {\n            if (r[codeKey] != null) branchInfo.set(String(r[codeKey]).trim(), { status: stKey && r[stKey] ? String(r[stKey]).trim() : '', inactiveDate: inKey && r[inKey] ? String(r[inKey]).slice(0, 10) : '' });\n            if (r[codeKey] != null && nameKey && r[nameKey]) branchNames.set(String(r[codeKey]).trim(), String(r[nameKey]).trim());")
rep("      return {\n        branch,\n        name,\n        pairs,", "      const bInfo = branchInfo.get(String(branch).trim()) || {};\n      return {\n        branch,\n        name,\n        branchStatus: bInfo.status || '',\n        inactiveDate: bInfo.inactiveDate || '',\n        pairs,")
if crlf: s = s.replace("\n", "\r\n")
shutil.copyfile(path, path + ".bak")
io.open(path, "w", encoding="utf-8", newline="").write(s)
try:
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.copyfile(path + ".bak", path); print("node --check FAILED, restored:\n" + r.stderr); sys.exit(1)
except FileNotFoundError:
    print("(node not found, skip syntax check)")
print("patched OK")
