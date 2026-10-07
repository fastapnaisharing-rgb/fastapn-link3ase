# -*- coding: utf-8 -*-
# patch: Tax Invoice List ไม่ล็อกความสูงขั้นต่ำ 300px (หน้า Tab 2 จะไม่ต้อง Scroll) -- สูงตามจำนวนแถว สูงสุด 34vh แล้วค่อย Scroll ในตาราง
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a = "style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto',"
assert s.count(a) == 1
s = s.replace(a, "style={{ minHeight: 0, maxHeight: '34vh', overflowY: 'auto',")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
