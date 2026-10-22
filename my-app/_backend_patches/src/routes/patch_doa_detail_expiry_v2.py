# -*- coding: utf-8 -*-
"""patch_doa_detail_expiry_v2.py  (Backend: routes/fileStorage.js -- ตัวที่รันจริง)
Backup Detail ใช้สะสม Include ไปเรื่อยๆ => ไม่หมดอายุอัตโนมัติ (ลบเองรายไฟล์ได้ที่ DOA Storage)
แก้ 3 จุด:
  1) POST /doa-backup  : INSERT ตั้ง expires_at ของ Detail = 2999-12-31 (หน้าเว็บถือว่า >= ปี 2100 = ไม่หมดอายุ)
  2) doaFixExpiry      : ไม่คำนวณอายุ Detail ตามงวด/วันที่ตั้งค่าอีก แต่ขยาย Detail ทั้งหมดเป็น 2999-12-31
     (ทำงานตอน Start ระบบก่อน purge จึงช่วยไฟล์ Detail เดิมที่ยังไม่ถูกลบ เช่น งวด 2026.08)
รัน: วางไฟล์นี้ไว้โฟลเดอร์เดียวกับ fileStorage.js แล้ว  python patch_doa_detail_expiry_v2.py  -> Restart-Service fastapn-backend
"""
import sys, os, shutil, subprocess
p = sys.argv[1] if len(sys.argv) > 1 else 'fileStorage.js'
s = open(p, encoding='utf-8', newline='').read()
M = 'MARKER_GL_DOA_DETAIL_EXPIRY_V2'
if M in s:
    print('already patched'); sys.exit(0)
FAR = "timestamptz '2999-12-31 23:59:59+00'"
A1 = "CASE WHEN $8::text IN ('Simple','Detail') THEN ((date_trunc('month', to_date($2, 'YYYY.MM'))"
B1 = "CASE WHEN $8::text = 'Detail' THEN " + FAR + " WHEN $8::text = 'Simple' THEN ((date_trunc('month', to_date($2, 'YYYY.MM'))"
A2 = 'for (const [kind, days] of [["Simple", c.doa_simple_days || 0], ["Detail", c.doa_detail_days || 0]]) {'
B2 = ('/* ' + M + ' -- Detail ไม่หมดอายุ (สะสม Include) */ await pool.query("UPDATE doa_tb_backup SET expires_at = ' + FAR + " WHERE kind = 'Detail' AND expires_at < " + FAR + '"); '
      'for (const [kind, days] of [["Simple", c.doa_simple_days || 0]]) {')
for nm, a in (('INSERT CASE', A1), ('doaFixExpiry loop', A2)):
    assert s.count(a) == 1, 'anchor %s ไม่พบ/ซ้ำ: %d (ไฟล์จริงต่างจากที่ Patch เตรียมไว้ — ไม่แก้อะไร)' % (nm, s.count(a))
s2 = s.replace(A1, B1).replace(A2, B2)
if os.path.exists(p):
    shutil.copy(p, p + '.bak')  # .bak ไฟล์เดียวตาม Convention
open(p, 'w', encoding='utf-8', newline='').write(s2)
r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
if r.returncode != 0:
    shutil.copy(p + '.bak', p); print('node --check FAIL -> restore\n' + r.stderr); sys.exit(1)
print('ok: patched + node --check passed (อย่าลืม Restart-Service fastapn-backend)')
