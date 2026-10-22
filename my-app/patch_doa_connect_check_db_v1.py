import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONNECT_CHECK_DB_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_connect_check_db_v1')
a="    if (!bkAcc[code] && ((incByAcc.get(String(code)) || 0) > 0 || bkHaveMap[String(code)])) { bkSet(code, { conn: 'off', sel: '' }); return; }\n"
assert s.count(a)==1, s.count(a)
b="    { await connectAll([{ code }]); return; } /* "+M+" -- กด Connect รายแถว = เช็ค DB ใหม่ (Backup + Include + แถว Below) แล้ว Connect | ถ้า Connect อยู่แล้ว กดอีกครั้ง = Disconnect */\n"
s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s); print('ok')
