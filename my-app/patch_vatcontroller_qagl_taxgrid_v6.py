# -*- coding: utf-8 -*-
# Patch v6: แถวที่ครบแล้ว (มี TIV + Amount) แสดง Branch Dr. / Tax Invoice Date ที่ Auto ได้จริงเป็นตัวปกติ (ไม่ใช่ตัวจาง Placeholder)
# usage: python patch_vatcontroller_qagl_taxgrid_v6.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:90])
    txt = txt.replace(old, new)
rep("const k = QA_GL_GRID_COLS[c]; const val = gr[k];",
    "const k = QA_GL_GRID_COLS[c]; const itAuto = ok ? listGl[itIdx] : null; const autoTxt = itAuto ? (k === 'br' ? String(itAuto.brDr || '') : (k === 'date' && itAuto.date ? `${String(itAuto.date).slice(8, 10)}/${String(itAuto.date).slice(5, 7)}/${String(itAuto.date).slice(0, 4)}` : '')) : ''; const val = gr[k] || autoTxt; // MARKER_QA_GL_TAXGRID_V6 -- ครบแล้ว: แสดงค่า Auto จริง")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
