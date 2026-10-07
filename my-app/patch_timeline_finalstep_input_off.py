# -*- coding: utf-8 -*-
# MARKER_TIMELINE_FINALSTEP_INPUT_OFF_V1 -- Defaults Set: Final Step (First/Final Draft) Incomplete เปิดตาม Tax Type, Input ปิดทุก Tax Code
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_FINALSTEP_INPUT_OFF_V1" in src:
    print("already patched"); sys.exit(0)
OLD = 'x.rpt[sd][c][rk] = !rule.codes[c] ? "X" : cur === "X" ? "P" : cur;'
NEW = 'x.rpt[sd][c][rk] = (!rule.codes[c] || rk === "inp") ? "X" : cur === "X" ? "P" : cur; // Final Step: Incomplete ตาม Tax Type · Input ปิดหมด'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW + " /* MARKER_TIMELINE_FINALSTEP_INPUT_OFF_V1 */")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
