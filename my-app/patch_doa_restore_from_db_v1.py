import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_FROM_DB_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_from_db_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:90],s.count(a)); s=s.replace(a,b)
# 1) เอา Drive D / โยนไฟล์ ออกจากปุ่ม Restore
a1="    /* MARKER_GL_DOA_RESTORE_NO_INCLUDE_WRITE_V1 -- Restore = ดึงทั้งไฟล์ Backup ต้นฉบับจาก Drive D เท่านั้น (ไม่เขียน Data Include จาก DB ลงไฟล์ Backup อีก — Include ไม่ใช่ข้อมูลใน Backup จริง และเคยทำให้ไฟล์เดิมถูกทับ) */\n    { setDropAcc(String(code)); setDropPop(true); return; }\n"
rep(a1,"    /* "+M+" -- Restore = สร้าง/เพิ่ม Backup จากข้อมูลใน DB เลย ไม่ต้องโยนไฟล์: Include ใน DB + แถวใน Detail งวดนี้ที่ Transaction Date ต่ำกว่างวด */\n")
# 2) แหล่งข้อมูล = Include ใน DB + แถว Below ของ Detail งวดปัจจุบัน (รวมแบบไม่ซ้ำ)
a2="      const items = (await listDoaClearDetail(bu, String(code))).filter(x => x.status === 'Include' && x.row);\n      if (!items.length) { setDbMsg(`ไม่มีข้อมูล Include ของ Account ${code} ใน DB ให้เก็บ`); return; }\n      const rows = items.map(x => x.row);\n"
b2="      const items = (await listDoaClearDetail(bu, String(code))).filter(x => x.status === 'Include' && x.row);\n      const seenK = new Set(); const rows = []; [...items.map(x => x.row), ...(belowByAcc.get(String(code)) || [])].forEach(o => { const k = detKey(o); if (!seenK.has(k)) { seenK.add(k); rows.push(o); } });\n      if (!rows.length) { setDbMsg(`ไม่มีข้อมูล Include / แถว Below ของ Account ${code} ใน DB ให้เก็บ`); return; }\n"
rep(a2,b2)
# 3) tooltip
rep("title={`Restore — ดึงไฟล์ Backup ต้นฉบับของ Account นี้จาก Drive D (ทั้งไฟล์) มารวมเข้า Backup ${prevPeriod} เดิม แบบสะสม ไม่ทับ`}","title={`Restore — เก็บ Data Include ของ Account นี้จาก DB (Transaction Date ต่ำกว่างวด ${period}) เข้า Backup ${prevPeriod} แบบสะสม ไม่ต้องโยนไฟล์`}")
open(p,'w',encoding='utf-8').write(s); print('ok')
