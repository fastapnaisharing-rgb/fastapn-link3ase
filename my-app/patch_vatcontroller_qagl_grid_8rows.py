# -*- coding: utf-8 -*-
# patch: Tax Invoice List Default 8 แถว (ขั้นต่ำ) + แถวว่างต่อท้าย 3 แถวเสมอ + กรอบสูงพอดี 8 แถว
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
n = s.count("qaGlMkGrid(5)"); assert n >= 2, n
s = s.replace("qaGlMkGrid(5)", "qaGlMkGrid(8)")
a = "Math.max(last + 4, 5)"; assert s.count(a) == 1; s = s.replace(a, "Math.max(last + 4, 8)")
a = "maxHeight: '196px', overflowY: 'auto',"; assert s.count(a) == 1; s = s.replace(a, "maxHeight: '292px', overflowY: 'auto',")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
