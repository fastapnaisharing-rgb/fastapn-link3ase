# -*- coding: utf-8 -*-
# MARKER_TIMELINE_NODATA_MAROON_V1 -- ปุ่ม No Data เมื่อกดแล้วเป็นสีแดงเลือดหมู (เดิมเทาเข้ม #52606d)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_NODATA_MAROON_V1" in src:
    print("already patched"); sys.exit(0)
old = 'border: t.nodata ? "1px solid #52606d" : "1px solid #E3E5EA", background: t.nodata ? "#52606d" : "#FAFAFB"'
new = 'border: t.nodata ? "1px solid #7A1F2B" : "1px solid #E3E5EA", background: t.nodata ? "#7A1F2B" : "#FAFAFB" /* MARKER_TIMELINE_NODATA_MAROON_V1 */'
assert src.count(old) == 1, "anchor count %d" % src.count(old)
io.open(path, "w", encoding="utf-8", newline="").write(src.replace(old, new))
print("patched OK")
