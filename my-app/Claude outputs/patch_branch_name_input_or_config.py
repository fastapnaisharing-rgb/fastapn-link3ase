#!/usr/bin/env python3
# patch_branch_name_input_or_config.py -- ชื่อสาขาในรายงาน Reconcile: ดึงจาก Input ก่อน, ไม่มี Input -> ดึงจาก Config (branch_list "Company for Report"), ไม่มี = ว่าง
# ไม่ดึงจากหัวไฟล์ Simple แล้ว (เคยได้ชื่อมั่ว เช่น "[0402H1]")  | MARKER_VATRECONCILE_BRANCH_NAME_INPUT_OR_CONFIG_V1
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "MARKER_VATRECONCILE_BRANCH_NAME_INPUT_OR_CONFIG_V1" in s:
    print("already patched"); sys.exit(0)
old = 'const fileName = i.operator_name || (simpleAvg.get(branch) || simple100.get(branch) || {}).operator_name || "";'
assert s.count(old) == 1, s.count(old)
new = 'const fileName = i.operator_name || ""; // MARKER_VATRECONCILE_BRANCH_NAME_INPUT_OR_CONFIG_V1 -- ชื่อจาก Input เท่านั้น (ไม่ดึงหัวไฟล์ Simple) ไม่มี Input -> ใช้ Config "Company for Report" ถ้าไม่มี = ว่าง'
s = s.replace(old, new, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched")
