# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Account ที่ Connect แล้ว (🔗 เขียว) แต่ไม่มีไฟล์ Backup ใน DB: ถ้า DB มี Include ของ Account นั้น ให้แสดง Include (ชื่อไฟล์ M-1) แทนข้อความ "ไม่มีไฟล์ Backup ใน DB"
Run จากโฟลเดอร์ my-app:  python patch_doa_include_show_when_connected_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_INCLUDE_CONNECTED_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_include_conn_v1')
old = "<span style={{ color: '#B9C4D2' }} title=\"Connect แล้ว แต่ใน DB ยังไม่มีไฟล์ Backup Detail ของ BU นี้ (ที่ไม่ใช่งวดปัจจุบัน)\">ไม่มีไฟล์ Backup ใน DB</span>"
assert s.count(old) == 1, s.count(old)
new = ("(incByAcc.get(String(a.code)) > 0 ? <span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={`Include ใน DB ${incByAcc.get(String(a.code))} แถว (งวด ${prevPeriod} ลงไป) · BU ${bu} · Account ${a.code}`}>{/* MARKER_GL_DOA_INCLUDE_CONNECTED_V1 */}{'✓ ' + bkLbl(a.code, prevPeriod)}</span> : "
       + old + ")")
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
