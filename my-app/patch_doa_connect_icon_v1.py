# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- เปลี่ยน Icon ปุ่ม Connect จาก emoji (🔗 / 🔌 ซึ่งหน้าตาซ้ำกับ Icon ในคอลัมน์ Action) เป็น SVG
 - Connected: โซ่เชื่อมต่อ (link)   - ยังไม่ Connect: โซ่ขีดฆ่า (unlink)   - กำลังเชื่อมต่อ: …
Run จากโฟลเดอร์ my-app:  python patch_doa_connect_icon_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_CONNECT_ICON_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_conn_icon_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:80], s.count(old))
    s = s.replace(old, new)
rep("/* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */",
    "/* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */ const bkIcon = (on) => (<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" style={{ display: 'block', margin: '0 auto' }} aria-hidden=\"true\"><path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />{!on && <line x1=\"3\" y1=\"3\" x2=\"21\" y2=\"21\" />}</svg>); /* MARKER_GL_DOA_CONNECT_ICON_V1 */")
rep("{(bkAcc[a.code] || {}).conn === 'on' ? '🔗' : ((bkAcc[a.code] || {}).conn === 'busy' ? '…' : '🔌')}</button>",
    "{(bkAcc[a.code] || {}).conn === 'on' ? bkIcon(true) : ((bkAcc[a.code] || {}).conn === 'busy' ? '…' : bkIcon(false))}</button>")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
