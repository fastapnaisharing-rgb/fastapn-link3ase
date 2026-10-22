# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- เพิ่มความสูงหัวคอลัมน์ของตาราง Detail เฉพาะ Mode Edit (sel มีค่าเฉพาะตอน Edit)
Run จากโฟลเดอร์ my-app:  python patch_doa_modeedit_header_height_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_MODEEDIT_HEAD_H_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_head_h_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:80], s.count(old))
    s = s.replace(old, new)
rep("fontWeight: 700, textAlign: 'center', padding: '4px 6px', fontSize: 12, border: '1px solid #000', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3 }}>{t}",
    "fontWeight: 700, textAlign: 'center', padding: sel ? '18px 6px' : '4px 6px', height: sel ? 52 : undefined, fontSize: sel ? 13 : 12, border: '1px solid #000', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3 }}>{/* MARKER_GL_DOA_MODEEDIT_HEAD_H_V1 */}{t}")
rep("textAlign: 'center', padding: '4px 10px', fontSize: 12, border: '1px solid #000', position: 'sticky', top: 0, zIndex: 3 }}",
    "textAlign: 'center', padding: sel ? '18px 10px' : '4px 10px', height: sel ? 52 : undefined, fontSize: sel ? 13 : 12, border: '1px solid #000', position: 'sticky', top: 0, zIndex: 3 }}")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
