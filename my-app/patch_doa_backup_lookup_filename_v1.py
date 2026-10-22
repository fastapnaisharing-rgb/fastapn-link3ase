import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_BACKUP_LOOKUP_NAME_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_backup_lookup_name_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
# 1) เก็บชื่อไฟล์จริงตอน Lookup
rep("if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period }; }","if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; }")
# 2) helper
rep("  const hasInc = (c) =>","  const bkShow = (c) => { const h = bkHaveMap[String(c)]; return h ? '✓ ' + (h.name || bkLbl(c, h.period)) : ((incByAcc.get(String(c)) || 0) > 0 || belowByAcc.has(String(c)) ? `Include ${incCnt(String(c))} แถว · ไม่พบไฟล์ Backup` : '-'); }; /* "+M+" -- Filename = ชื่อไฟล์ Backup จริงที่ Lookup พบข้อมูลของ Account นี้ใน DB (ไม่สร้างชื่อเอง) */\n  const hasInc = (c) =>")
# 3) display
rep("{bkHaveMap[String(a.code)] ? '✓ ' + bkLbl(a.code, bkHaveMap[String(a.code)].period) : (hasInc(String(a.code)) ? '✓ ' + bkLbl(a.code, prevPeriod) : '-')}","{bkShow(a.code)}")
rep("{'✓ ' + bkLbl(a.code, prevPeriod)}</span> : <span style={{ color: '#B9C4D2' }} title=\"Connect แล้ว","{bkShow(a.code)}</span> : <span style={{ color: '#B9C4D2' }} title=\"Connect แล้ว")
rep("{bkFiles.map(f => <option key={f.id} value={String(f.id)}>{bkLbl(a.code, f.period)}</option>)}","{bkFiles.map(f => <option key={f.id} value={String(f.id)}>{f.file_name || bkLbl(a.code, f.period)}</option>)}")
open(p,'w',encoding='utf-8').write(s); print('ok')
