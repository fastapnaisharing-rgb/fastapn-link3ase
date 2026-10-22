# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- คอลัมน์ Filename ระบุชื่อไฟล์ Backup ตรง ๆ ตาม BU + Account + งวด
รูปแบบ: REV_11635105_08.2026_Backup   (BU_Account_MM.YYYY_Backup)
Run จากโฟลเดอร์ my-app:  python patch_doa_backup_filename_label_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_BACKUP_LABEL_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_backup_label_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:60], s.count(old))
    s = s.replace(old, new)
# 1) เก็บงวดของไฟล์ Backup ที่ใช้เช็ค + ฟังก์ชันสร้างชื่อ
rep("const [bkHave, setBkHave] = React.useState(null);",
    "const [bkHavePer, setBkHavePer] = React.useState(''); const bkLbl = (code, per) => { const p = String(per || '').split('.'); return `${bu}_${code}_${p[1] || ''}.${p[0] || ''}_Backup`; }; /* MARKER_GL_DOA_BACKUP_LABEL_V1 */ const [bkHave, setBkHave] = React.useState(null);")
rep("if (!off) setBkHave(have);",
    "if (!off) { setBkHavePer(t.period); setBkHave(have); }")
# 2) Account ที่มีใน Backup แต่ยังไม่ Connect: แสดงชื่อไฟล์แทน "-"
rep(": (bkAcc[a.code] || {}).conn !== 'on' ? <span style={{ color: '#B9C4D2' }}>-</span> :",
    ": (bkAcc[a.code] || {}).conn !== 'on' ? <span style={{ color: '#1a3a5c', fontWeight: 600 }} title={`พบ Backup ของ BU ${bu} · Account ${a.code} — กด 🔗 เพื่อ Connect`}>{bkHavePer ? bkLbl(a.code, bkHavePer) : '-'}</span> :")
# 3) Dropdown: ชื่อตาม BU + Account + งวดของไฟล์
rep("{(f.file_name || 'Backup') + ' · ' + f.period}</option>",
    "{bkLbl(a.code, f.period)}</option>")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
