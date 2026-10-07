# -*- coding: utf-8 -*-
# Patch: GL-TransferVat Tab 2 -- ขยายกรอบ Tax Invoice List ให้สูงพอเห็นหลายใบ (ไม่ต้อง Scroll ทีละใบ) + Scroll ภายในกรอบถ้าเกิน
# usage: python patch_vatcontroller_qagl_taxlist_taller.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
a_old = "<div style={mhS}>Tax Invoice List <small style={{ fontWeight: 400, opacity: 0.8 }}>{listGl.length} ใบ</small></div>\n                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>"
a_new = "<div style={mhS}>Tax Invoice List <small style={{ fontWeight: 400, opacity: 0.8 }}>{listGl.length} ใบ</small></div>\n                <div style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto' }}> {/* MARKER_QA_GL_TAXLIST_TALLER_V1 -- กรอบสูงขึ้น รองรับหลายใบ */}\n                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>"
assert txt.count(a_old) == 1, txt.count(a_old)
txt = txt.replace(a_old, a_new)
b_old = "                  </tbody>\n                </table>\n                <div style={sumS}>\n                  <span>รวมใบกำกับ Gross"
b_new = "                  </tbody>\n                </table>\n                </div>\n                <div style={sumS}>\n                  <span>รวมใบกำกับ Gross"
assert txt.count(b_old) == 1, txt.count(b_old)
txt = txt.replace(b_old, b_new)
# หัวตารางค้างด้านบนเวลา Scroll
h_old = "<thead><tr><th style={{ ...thS, textAlign: 'center' }}>#</th><th style={thS}>Tax Invoice Date</th>"
h_new = "<thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr><th style={{ ...thS, textAlign: 'center' }}>#</th><th style={thS}>Tax Invoice Date</th>"
assert txt.count(h_old) == 1, txt.count(h_old)
txt = txt.replace(h_old, h_new)
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
