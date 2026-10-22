# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- คอลัมน์ Filename บรรทัดเดียว แยก Include / ไม่พบ ชัดเจน
 - พบใน Backup (Include):  ✓ REV_11635105_08.2026_Backup  (สีน้ำเงิน)
 - ไม่พบ:                   ไม่พบ Backup 2026.08            (สีส้ม, คำอธิบายอยู่ใน Tooltip)
Run จากโฟลเดอร์ my-app:  python patch_doa_backup_filename_oneline_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_BACKUP_ONELINE_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_backup_oneline_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:70], s.count(old))
    s = s.replace(old, new)
rep("<span style={{ color: '#B54708' }} title={`ไม่มี Backup ของงวดก่อน",
    "<span style={{ color: '#B54708', whiteSpace: 'nowrap', fontWeight: 600 }} title={`ไม่มี Backup ของงวดก่อน")
rep("ไม่พบไฟล์ Backup<div style={{ fontSize: 10, color: '#8A94A6', lineHeight: 1.3 }}>ไม่มี Backup {prevPerOf(period) || ''} · โยนไฟล์ Backup ด้านบน</div></span>",
    "ไม่พบ Backup {prevPerOf(period) || ''}{/* MARKER_GL_DOA_BACKUP_ONELINE_V1 */}</span>")
rep("<span style={{ color: '#1a3a5c', fontWeight: 600 }} title={`พบ Backup ของ BU",
    "<span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={`พบ Backup ของ BU")
rep("{bkHavePer ? bkLbl(a.code, bkHavePer) : '-'}", "{bkHavePer ? '✓ ' + bkLbl(a.code, bkHavePer) : '-'}")
# คอลัมน์กว้างพอสำหรับชื่อไฟล์บรรทัดเดียว
rep("textAlign: 'center', width: 190, maxWidth: 190, fontSize: 12 }}>{/* MARKER_GL_DOA_BACKUP_FILE_COL_V1",
    "textAlign: 'center', width: 230, maxWidth: 230, fontSize: 12 }}>{/* MARKER_GL_DOA_BACKUP_FILE_COL_V1")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
