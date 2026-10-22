import sys,shutil,datetime
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_FILENAME_TWOWAY_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_filename_twoway_'+datetime.datetime.now().strftime('%H%M%S'))
a="""`Include ${incCnt(String(c))} แถว · ไม่พบไฟล์ Backup` : '-'); };"""
b="""'✓ ' + `${bu}_Detail_backup_${prevPeriod}.xlsx` : '-'); }; /* MARKER_GL_DOA_FILENAME_TWOWAY_V1 -- เช็ค 2 ทาง: พบไฟล์จริง = ชื่อไฟล์จริง, ไม่พบไฟล์แต่มีข้อมูล Include/Below ใน DB = ชื่อไฟล์ Backup ของงวดก่อน (จาก DB) */"""
assert s.count(a)==1; s=s.replace(a,b)
# remove trailing duplicated marker comment tail not needed
a2="""(hasInc(String(a.code)) ? <span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={`Include ใน DB ${incCnt(String(a.code))} แถว (งวด ${prevPeriod} ลงไป) · BU ${bu} · Account ${a.code}`}>{/* MARKER_GL_DOA_INCLUDE_CONNECTED_V1 */}"""
b2="""((hasInc(String(a.code)) || belowByAcc.has(String(a.code))) ? <span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง' : 'ข้อมูลจาก DB (Include/Below) — ยังไม่มีไฟล์ Backup จริง กด Restore เพื่อสร้างไฟล์') + ` · Include ${incCnt(String(a.code))} แถว · BU ${bu} · Account ${a.code}`}>{/* MARKER_GL_DOA_INCLUDE_CONNECTED_V1 */}"""
assert s.count(a2)==1; s=s.replace(a2,b2)
a3="""title={(hasInc(String(a.code)) ? `Include ใน DB ${incCnt(String(a.code))} แถว (งวด ${prevPeriod} ลงไป) · ` : '') + `BU ${bu} · Account ${a.code}`}>{bkShow(a.code)}"""
b3="""title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง · ' : 'ข้อมูลจาก DB (Include/Below) · ') + (hasInc(String(a.code)) ? `Include ใน DB ${incCnt(String(a.code))} แถว (งวด ${prevPeriod} ลงไป) · ` : '') + `BU ${bu} · Account ${a.code}`}>{bkShow(a.code)}"""
assert s.count(a3)==1; s=s.replace(a3,b3)
open(p,'w',encoding='utf-8').write(s)
