# -*- coding: utf-8 -*-
# Patch v9: แสดงกล่อง Cal Logic (Simple Input / ADI Journal) ใน Tab 2 (Invoice / Tax Invoice) ด้วย -- ใช้ JSX เดียวกับ Tab 1 (ดึงมาเป็นตัวแปรใช้ร่วมกัน)
# usage: python patch_vatcontroller_qagl_taxgrid_v9.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')

start_tok = "              {/* ③ Cal Logic */}\n"
end_tok = "            </>)}\n\n            {qaGlTab === 2 && (<>"
s = txt.index(start_tok); e = txt.index(end_tok, s)
assert txt.count(start_tok) == 1 and txt.count(end_tok) == 1
block = txt[s + len(start_tok):e]  # <div ...> ... </div>\n
assert block.lstrip().startswith("<div style={{ ...cardS, padding: '4px 16px 8px'"), block[:60]
# 1) Tab 1 ใช้ตัวแปร
txt = txt[:s] + "              {/* ③ Cal Logic */}\n              {qaGlCalLogicCard} {/* MARKER_QA_GL_CALLOGIC_IN_TAB2_V1 */}\n" + txt[e:]
# 2) ประกาศตัวแปรก่อน return ของ IIFE (หลัง simOnGl ถูกนิยามแล้ว)
i_sim = txt.index("const simOnGl = hasGl && qaGlSimpleCond !== 'standby';")
i_ret = txt.index("\n        return (\n", i_sim)
decl = "\n        const qaGlCalLogicCard = (\n" + block.rstrip("\n") + "\n        ); // MARKER_QA_GL_CALLOGIC_IN_TAB2_V1 -- ใช้ร่วม Tab 1 / Tab 2"
txt = txt[:i_ret] + decl + txt[i_ret:]
# 3) Tab 2: ต่อท้าย Tax Invoice List
t2_end = "            </>)}\n            {qaGlTab === 3 && qaGlAdjDraft"
assert txt.count(t2_end) == 1, txt.count(t2_end)
txt = txt.replace(t2_end, "              {qaGlCalLogicCard}\n" + t2_end)
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
