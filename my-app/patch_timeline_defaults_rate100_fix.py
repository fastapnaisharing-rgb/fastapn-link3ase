# -*- coding: utf-8 -*-
# MARKER_TIMELINE_DEFAULTS_RATE100_FIX_V1 -- Rate 100%: Trial Balance + Expense 100% + Asset 100% เปิด, AVG ปิด (แก้จากเดิมที่เป็น Expense ปิด/Asset AVG เปิด)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_DEFAULTS_RATE100_FIX_V1" in src:
    print("already patched"); sys.exit(0)
OLD = 'else if (r100) vat.push(true, false, false, true, true); // Trial Balance เปิด · Expense 100%/AVG ปิด · Asset 100%/AVG เปิด'
NEW = 'else if (r100) vat.push(true, true, false, true, false); // Rate 100%: Trial Balance เปิด · Expense 100% เปิด · Asset 100% เปิด (AVG ปิด)'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW + " // MARKER_TIMELINE_DEFAULTS_RATE100_FIX_V1")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
