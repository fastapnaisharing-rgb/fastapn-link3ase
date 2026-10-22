# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Include / ไม่พบ Backup แสดงเฉพาะ Account ที่งวดปัจจุบันมี TB แล้ว
เหตุผล: งวดที่ยังไม่มี TB (เช่น 2026.10 ที่ยังไม่โยนข้อมูล) ยังไม่มีอะไรให้ Include => คอลัมน์ Filename แสดง '-' (เทา)
Run จากโฟลเดอร์ my-app:  python patch_doa_include_need_current_tb_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_INCLUDE_NEED_TB_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_need_tb_v1')
old = "(ต้อง Connect ก่อน) */}{(!(incByAcc.get("
assert s.count(old) == 1, s.count(old)
new = ("(ต้อง Connect ก่อน) */}{!a.inTb ? <span style={{ color: '#B9C4D2' }} title=\"ยังไม่มี TB ของงวดนี้ — Include ใช้ได้เมื่อมีข้อมูลงวดปัจจุบันแล้ว\">-{/* MARKER_GL_DOA_INCLUDE_NEED_TB_V1 */}</span> : (!(incByAcc.get(")
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
