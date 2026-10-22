# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Mode Edit (Preview Detail เต็มหน้า): เผื่อพื้นที่ด้านบนตารางสูง 10 แถว (~220px) ไว้ใส่เครื่องมือต่าง ๆ
Run จากโฟลเดอร์ my-app:  python patch_doa_modeedit_tools_area_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_MODEEDIT_TOOLS_AREA_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_tools_area_v1')
old = "        </div>}\n        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', fontFamily: FONT }}>\n          {!matrix.length ?"
assert s.count(old) == 1, s.count(old)
new = ("        </div>}\n"
"        {pageMode && <div id=\"doa-edit-tools\" style={{ flex: '0 0 auto', height: 220, minHeight: 220, boxSizing: 'border-box', padding: '10px 16px', background: '#F7F9FC', borderBottom: '1px solid #D5DEEA', overflow: 'auto' }}>{/* MARKER_GL_DOA_MODEEDIT_TOOLS_AREA_V1 -- พื้นที่เครื่องมือ (เผื่อสูง 10 แถว ~ 22px x 10) -- ใส่ปุ่ม/ตัวกรอง/Restatus ในนี้ภายหลัง */}<div style={{ fontSize: 12, color: '#8A94A6' }}>เครื่องมือ (พื้นที่เผื่อไว้)</div></div>}\n"
"        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', fontFamily: FONT }}>\n          {!matrix.length ?")
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
