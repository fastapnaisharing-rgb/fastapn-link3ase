# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js
1) ลบป้ายสถานะ (Not included / Include / Connected) ข้างปุ่ม 🔗
2) ขยายความกว้าง Popup ประวัติ Auto Clear / Clear
Run: python patch_doa_remove_status_badge_widen_clrhist_v1.py  (จากโฟลเดอร์ my-app)"""
import re, shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_REMOVE_STATUS_BADGE_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_status_badge_v1')
pat = re.compile(r"\{\(\(\) => \{ const cn = \(bkAcc\[a\.code\] \|\| \{\}\)\.conn; const nb = .*?\}\)\(\)\}\{/\* MARKER_GL_DOA_CONNECT_STATUS_LABEL_V1 \*/\}", re.S)
s, n1 = pat.subn('{/* MARKER_GL_DOA_REMOVE_STATUS_BADGE_V1 */}', s, count=1)
old = "width: 'min(1300px, 96vw)', height: '80vh'"
new = "width: 'min(1900px, 98vw)', height: '85vh'"
n2 = s.count(old); s = s.replace(old, new)
assert n1 == 1 and n2 == 1, (n1, n2)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK: badge removed, popup widened')
