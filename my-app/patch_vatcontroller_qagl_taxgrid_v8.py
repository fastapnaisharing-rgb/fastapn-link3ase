# -*- coding: utf-8 -*-
# Patch v8: Tax Invoice List มีแถวให้กรอก/วาง Default ขั้นต่ำ 5 แถวเสมอ (เดิม 3) -- ข้อมูลเกิน 5 แถวยังเพิ่มแถวว่างต่อท้าย 1 แถวเสมอ
# usage: python patch_vatcontroller_qagl_taxgrid_v8.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep_all(old, new, n):
    global txt
    assert txt.count(old) == n, (txt.count(old), old[:80])
    txt = txt.replace(old, new)
rep_all("Math.max(last + 2, 3)", "Math.max(last + 2, 5)", 2)
rep_all("React.useState(() => qaGlMkGrid(3))", "React.useState(() => qaGlMkGrid(5))", 1)
rep_all("setQaGlGrid(qaGlMkGrid(3));", "setQaGlGrid(qaGlMkGrid(5));", 1)
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
