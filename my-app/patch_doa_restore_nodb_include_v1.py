import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_NO_INCLUDE_WRITE_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_nodb_include_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
a="    if (await askDoa(`Restore Account ${code}\\n\\nOK = ดึงทั้งไฟล์ Backup ต้นฉบับจาก Drive D (เลือกไฟล์ในรายการ) แล้วรวมเข้า Backup เดิม\\nCancel = เก็บเฉพาะ Data Include จาก DB`)) { setDropAcc(String(code)); setDropPop(true); return; }\n"
b="    /* "+M+" -- Restore = ดึงทั้งไฟล์ Backup ต้นฉบับจาก Drive D เท่านั้น (ไม่เขียน Data Include จาก DB ลงไฟล์ Backup อีก — Include ไม่ใช่ข้อมูลใน Backup จริง และเคยทำให้ไฟล์เดิมถูกทับ) */\n    { setDropAcc(String(code)); setDropPop(true); return; }\n"
rep(a,b)
rep("title={`Restore — เก็บ Data Include ${n} แถวของ Account นี้เข้า Backup ${prevPeriod} อีกรอบ (รวมกับของเดิม ไม่ทับ)`}","title={`Restore — ดึงไฟล์ Backup ต้นฉบับของ Account นี้จาก Drive D (ทั้งไฟล์) มารวมเข้า Backup ${prevPeriod} เดิม แบบสะสม ไม่ทับ`}")
open(p,'w',encoding='utf-8').write(s); print('ok')
