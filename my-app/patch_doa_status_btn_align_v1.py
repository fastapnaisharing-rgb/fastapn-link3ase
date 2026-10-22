# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- คอลัมน์ Status: ปุ่ม Connect (SVG) กับปุ่ม ♻ Alignment ไม่ตรงกัน
สาเหตุ: ปุ่มทั้งสองเป็น inline-block ที่เนื้อหาต่างชนิด (SVG กับตัวอักษร) จึงจัดตาม baseline ไม่เท่ากัน => ปุ่มหนึ่งสูง/ต่ำกว่า
แก้: ทั้งสองปุ่มใช้ inline-flex + จัดกึ่งกลางทั้งแนวตั้ง/แนวนอน + vertical-align: middle
Run จากโฟลเดอร์ my-app:  python patch_doa_status_btn_align_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_STATUS_BTN_ALIGN_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_btn_align_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:80], s.count(old))
    s = s.replace(old, new)
FX = "display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', "
rep("borderRadius: 6, width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: (bkAcc[a.code] || {}).conn === 'busy' ? 'wait' : 'pointer' }}>",
    "borderRadius: 6, " + FX + "width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: (bkAcc[a.code] || {}).conn === 'busy' ? 'wait' : 'pointer' }}>{/* MARKER_GL_DOA_STATUS_BTN_ALIGN_V1 */}")
rep("borderRadius: 6, width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: nC ? 'pointer' : 'not-allowed', opacity: nC ? 1 : 0.6 }}>",
    "borderRadius: 6, " + FX + "width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: nC ? 'pointer' : 'not-allowed', opacity: nC ? 1 : 0.6 }}>")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
