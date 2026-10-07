# -*- coding: utf-8 -*-
# patch: Tax Invoice List เหลือแถวว่างต่อท้าย 3 แถวเสมอ (เดิม 1 แถว) หลังวาง/กรอกข้อมูล -- ขั้นต่ำรวมยัง 5 แถว
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a = """    const out = arr.slice(0, Math.max(last + 2, 5));"""
b = """    const want = Math.max(last + 4, 5); // MARKER_QA_GL_GRID_3BLANK_V1 -- ข้อมูลจบที่แถว last -> เหลือว่าง 3 แถวเสมอ
    const out = arr.slice(0, want);"""
assert s.count(a) == 1; s = s.replace(a, b)
a2 = "while (out.length < Math.max(last + 2, 5)) out.push(...qaGlMkGrid(1));"
assert s.count(a2) == 1; s = s.replace(a2, "while (out.length < want) out.push(...qaGlMkGrid(1));")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
