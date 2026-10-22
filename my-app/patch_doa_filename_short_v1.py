import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_FILENAME_SHORT_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_filename_short_'+datetime.datetime.now().strftime('%H%M%S'))
a="return hasInc(c) ? `⚠ ${exp} · ไม่พบข้อมูลในไฟล์ (${incCnt(c)} แถวใน DB)` : '-'; };"
assert s.count(a)==1
s=s.replace(a,"return hasInc(c) ? `⚠ ไม่พบในไฟล์ · ${incCnt(c)} แถวใน DB` : '-'; }; /* MARKER_GL_DOA_FILENAME_SHORT_V1 -- ข้อความสั้น ไม่ล้นคอลัมน์ (ชื่อไฟล์ที่จะใช้เก็บอยู่ใน Tooltip) */")
a2="(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง' : 'ข้อมูลจาก DB (Include/Below) — ยังไม่มีไฟล์ Backup จริง กด Restore เพื่อสร้างไฟล์')"
assert s.count(a2)==1
s=s.replace(a2,"(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง' : `ข้อมูลจาก DB (Include/Below) — ไม่พบ Account นี้ในไฟล์ Backup ใด กดปุ่ม Restore เพื่อเก็บเข้าไฟล์ ${bu}_Detail_backup_${prevPeriod}.xlsx`)")
open(p,'w',encoding='utf-8').write(s)
