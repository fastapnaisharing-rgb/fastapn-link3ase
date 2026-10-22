import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONFIRM_BACKUP_ACC_ONLY_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_confirm_accbk_'+datetime.datetime.now().strftime('%H%M%S'))
a="const cur = detailRows(detMatrix); const curAcc = new Set(cur.map(o => String(o.account_code))); let old = [];"
assert s.count(a)==1
s=s.replace(a,"const cur = rows; /* MARKER_GL_DOA_CONFIRM_BACKUP_ACC_ONLY_V1 -- Confirm Account ไหน = เพิ่มเฉพาะแถวของ Account นั้นเข้า Backup เดิม (แถวของ Account อื่นในไฟล์คงเดิม ไม่ดึงทั้งหน้าเข้า Backup) */ const curAcc = new Set([String(a.code)]); let old = [];")
open(p,'w',encoding='utf-8').write(s)
