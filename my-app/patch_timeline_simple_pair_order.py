# -*- coding: utf-8 -*-
# MARKER_TIMELINE_SIMPLE_PAIR_ORDER_V1 -- Simple: Expense 100% / Asset 100% ติดกัน แล้ว Expense AVG / Asset AVG ติดกัน (Enable ขึ้นก่อนเหมือนเดิม)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_SIMPLE_PAIR_ORDER_V1" in src:
    print("already patched"); sys.exit(0)
OLD = 'simple: onFirst([5, 6, 7, 8], (i) => u.vat.cards[i].on),'
NEW = 'simple: onFirst([5, 7, 6, 8], (i) => u.vat.cards[i].on), // 100% คู่กัน (Expense 100%, Asset 100%) แล้วตามด้วย AVG คู่กัน'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW + " // MARKER_TIMELINE_SIMPLE_PAIR_ORDER_V1")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
