# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_KEEP_SEARCH_AFTER_POPVAT_V1
# หลัง Popvat (Quick Action / Cancel / Full Page - Add Data / Cancel) ไม่ล้างช่อง Search ของ Incomplete Detail อีก
# (Selection ยังเคลียร์เหมือนเดิม -- ตารางฐานกรอง eq_status=pending จึงไม่ดึงแถวที่ทำเสร็จกลับมา)
import sys, io, re
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_VATCONTROLLER_KEEP_SEARCH_AFTER_POPVAT_V1" in src:
    print("already patched"); sys.exit(0)
N = "MARKER_VATCONTROLLER_KEEP_SEARCH_AFTER_POPVAT_V1"

# 1) Quick Action (Save + Cancel): 2 จุด
pat1 = re.compile(r"setDetailSearch\(''\); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CLEAR_SEARCH_V1\n(\s*)setDetailSearchDebounced\(''\);")
src, n1 = pat1.subn(lambda m: "// " + N + " -- ไม่ล้าง Search หลัง Quick Action แล้ว (เดิม MARKER_VATWATCHLISTOPS_QUICK_ACTION_CLEAR_SEARCH_V1)", src)
assert n1 == 2, "quick action x%d" % n1

# 2) Quick Action multi-GL (Full Page ADI): 1 จุด
old2 = "setDetailSearch(''); setDetailSearchDebounced('');\n      reportVatTransactionToDashboard(draftIdMultiFP"
assert src.count(old2) == 1, "multiFP"
src = src.replace(old2, "// " + N + " -- ไม่ล้าง Search\n      reportVatTransactionToDashboard(draftIdMultiFP")

# 3) Full Page Add Data / Cancel: 2 จุด
pat3 = re.compile(r"^( *)setDetailSearch\(''\);\n\1setDetailSearchDebounced\(''\);\n", re.M)
src, n3 = pat3.subn(lambda m: m.group(1) + "// " + N + " -- ไม่ล้าง Search หลัง Popvat (Selection ยังเคลียร์ตามเดิม)\n", src)
assert n3 == 2, "fullpage x%d" % n3

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK", n1, n3)
