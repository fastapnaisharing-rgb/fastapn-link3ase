#!/usr/bin/env python3
# patch_branch_name_for_report.py -- คอลัมน์ใหม่ branch_list."Branch Name for Report" (Config เอง) | MARKER_VATRECONCILE_BRANCH_NAME_FOR_REPORT_V1
# ชื่อสาขาในรายงาน Reconcile: Input ก่อน -> ไม่มี Input ใช้ช่องนี้ -> ไม่มี = ว่าง (ไม่ดึงช่องอื่น/หัวไฟล์ Simple)
# ใช้: python3 patch_branch_name_for_report.py <vatReconcile.js> <BranchFormModal.js>
import sys
p1, p2 = sys.argv[1], sys.argv[2]
s = open(p1, encoding="utf-8").read()
if "MARKER_VATRECONCILE_BRANCH_NAME_FOR_REPORT_V1" in s:
    print("vatReconcile.js already patched")
else:
    i = s.index("const nameKey = reconPickKey(bq.rows[0], /company.*show.*(report|display)/i)")
    j = s.index("\n", i)
    old = s[i:j]
    assert old.count("const nameKey") == 1
    new = 'const nameKey = reconPickKey(bq.rows[0], /^[\\s_]*branch[\\s_]*name[\\s_]*for[\\s_]*report[\\s_]*$/i); // MARKER_VATRECONCILE_BRANCH_NAME_FOR_REPORT_V1 -- ชื่อสาขาเมื่อไม่มี Input = คอลัมน์ "Branch Name for Report" เท่านั้น (ไม่มี = ว่าง ไม่ดึงช่องอื่น)'
    s = s.replace(old, new, 1)
    open(p1, "w", encoding="utf-8").write(s)
    print("vatReconcile.js patched")

m = open(p2, encoding="utf-8").read()
if "MARKER_BRANCHFORM_NAME_FOR_REPORT_V1" in m:
    print("BranchFormModal.js already patched")
else:
    a = "  ['Company for Show in Report Display', 'Company for Report'], ['Simple Company', 'Simple Company'],"
    assert m.count(a) == 1
    m = m.replace(a, a + "\n  ['Branch Name for Report', 'Branch Name for Report'], // MARKER_BRANCHFORM_NAME_FOR_REPORT_V1", 1)
    b = "  ['Company for Show in Report Display'],\n"
    assert m.count(b) == 1
    m = m.replace(b, b + "  ['Branch Name for Report'], // MARKER_BRANCHFORM_NAME_FOR_REPORT_V1 -- ชื่อสาขาที่ใช้ในรายงาน Reconcile เมื่อสาขานั้นไม่มี Input\n", 1)
    open(p2, "w", encoding="utf-8").write(m)
    print("BranchFormModal.js patched")
