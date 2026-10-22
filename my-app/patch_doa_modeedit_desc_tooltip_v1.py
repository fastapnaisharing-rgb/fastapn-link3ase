# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Mode Edit: ลดความกว้างคอลัมน์ Description (360px) ถ้าข้อความเกินตัดเป็น ... และ Hover แสดง Tooltip ข้อความเต็ม
Run จากโฟลเดอร์ my-app:  python patch_doa_modeedit_desc_tooltip_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_MODEEDIT_DESC_TIP_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_desc_tip_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:80], s.count(old))
    s = s.replace(old, new)
rep("padding: sel ? '18px 6px' : '4px 6px', height: sel ? 52 : undefined,",
    "padding: sel ? '18px 6px' : '4px 6px', height: sel ? 52 : undefined, width: (sel && j === 10) ? 360 : undefined, maxWidth: (sel && j === 10) ? 360 : undefined,")
rep(": <td key={j} style={{ ...td, textAlign: [0, 2, 3, 5, 6].includes(j) ? 'center' : 'left' }}>{j === 6 ? fmtD(r[j]) : String(r[j] == null ? '' : r[j])}</td>))}",
    ": <td key={j} title={(sel && j === 10) ? String(r[j] == null ? '' : r[j]) : undefined} style={{ ...td, textAlign: [0, 2, 3, 5, 6].includes(j) ? 'center' : 'left', ...((sel && j === 10) ? { width: 360, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' } : {}) }}>{/* MARKER_GL_DOA_MODEEDIT_DESC_TIP_V1 */}{j === 6 ? fmtD(r[j]) : String(r[j] == null ? '' : r[j])}</td>))}")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
