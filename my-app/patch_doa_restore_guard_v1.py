import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_GUARD_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_guard_v1')
a="      const mg = await prepBackupMerge(prevPeriod, detailMatrixFromRows(rows));\n      if (!mg.changed) { setDbMsg(`✓ Account ${code}: Backup ${prevPeriod} มีข้อมูล Include ครบแล้ว"
assert s.count(a)==1, s.count(a)
b="      /* "+M+" -- ไม่เห็นไฟล์ Backup เดิมของงวดนี้ (อาจหมดอายุแล้วถูก Backend ซ่อน) = ถ้าเก็บต่อจะสร้างใหม่แล้วทับไฟล์เดิมที่ซ่อนอยู่ จึงถามก่อน ไม่เก็บเงียบๆ */\n      if (!ex && !await askDoa(`⚠ ไม่เห็นไฟล์ Backup Detail เดิมของงวด ${prevPeriod} ใน DB\\n\\nอาจหมดอายุและถูก Backend ซ่อนไว้ — ถ้าเก็บต่อ ระบบจะสร้างไฟล์ใหม่จาก Data Include ${rows.length} แถวนี้ และ **ทับไฟล์เดิมที่ซ่อนอยู่**\\n\\nแนะนำ: ให้ Backend ขยายอายุไฟล์ Detail ก่อน (patch_doa_detail_expiry_v2.py) แล้วค่อยกด Restore\\n\\nเก็บต่อเลยหรือไม่?`)) { setDbMsg('ยกเลิก Restore — ไม่เห็น Backup เดิมของงวด ' + prevPeriod + ' (ให้ Backend ขยายอายุไฟล์ก่อน)'); return; }\n"
s=s.replace(a,b+a)
open(p,'w',encoding='utf-8').write(s); print('ok')
