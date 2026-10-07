# -*- coding: utf-8 -*-
# MARKER_TIMELINE_DEFAULTS_RATE_LT100_V1 -- เพิ่มกฎ Rate < 100% + Daily Suspense T/F ต้องมี N ด้วย (ตามตัวอย่าง CFW / BTM)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_DEFAULTS_RATE_LT100_V1" in src:
    print("already patched"); sys.exit(0)
OLD = '  const vat = [tt.has("A"), tt.has("A"), tt.has("N"), tt.has("T") || tt.has("F")];\n  const r100 = typeof rate === "number" && Math.abs(rate - 100) < 1e-9;\n  if (none) vat.push(false, false, false, false, false);\n  else if (r100) vat.push(true, false, false, true, true);\n  else vat.push(undefined, undefined, undefined, undefined, undefined);'
NEW = '  const vat = [tt.has("A"), tt.has("A"), tt.has("N"), tt.has("N") && (tt.has("T") || tt.has("F"))];\n  const r100 = typeof rate === "number" && Math.abs(rate - 100) < 1e-9;\n  const rLt = typeof rate === "number" && rate > 0 && rate < 100;\n  if (none) vat.push(false, false, false, false, false);\n  else if (r100) vat.push(true, true, false, true, false); // Rate 100%: Trial Balance เปิด · Expense 100% เปิด · Asset 100% เปิด (AVG ปิด)\n  else if (rLt) vat.push(true, false, true, false, true); // Rate < 100%: Trial Balance เปิด · Expense AVG เปิด · Asset AVG เปิด (ตัวที่เป็น 100% ปิด)\n  else vat.push(undefined, undefined, undefined, undefined, undefined);'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW + "  // MARKER_TIMELINE_DEFAULTS_RATE_LT100_V1")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
