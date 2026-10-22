import sys,shutil,datetime
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_FILENAME_INSIDE_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_filename_inside_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,a[:60]; s=s.replace(a,b)
# 1 state
rep("const [bkHaveMap, setBkHaveMap] = React.useState({});","const [bkHaveMap, setBkHaveMap] = React.useState({}); const [bkKeyMap, setBkKeyMap] = React.useState({}); /* MARKER_GL_DOA_FILENAME_INSIDE_V1 -- เก็บ detKey ของแถวที่อยู่ในไฟล์ Backup จริง เพื่อเช็คข้างในไฟล์ (ไม่ใช่แค่มีไฟล์/มี Account) */")
# 2 effect
rep("if (!files.length) { if (!off) { setBkHaveMap({}); setBkHave(new Set()); } return; }","if (!files.length) { if (!off) { setBkHaveMap({}); setBkKeyMap({}); setBkHave(new Set()); } return; }")
rep("const mp = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; }); });",
"const mp = {}; const mk = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; if (!mk[c]) mk[c] = new Set(); mk[c].add(detKey(o)); }); });")
rep("if (!off) { setBkHaveMap(mp); setBkHave(new Set(Object.keys(mp))); }","if (!off) { setBkHaveMap(mp); setBkKeyMap(mk); setBkHave(new Set(Object.keys(mp))); }")
# 3 bkShow
i=s.index("const bkShow = (c) =>"); j=s.index("/* MARKER_GL_DOA_FILENAME_TWOWAY_V1")
new="""const bkMiss = (c) => { const ks = bkKeyMap[String(c)]; const rows = belowByAcc.get(String(c)) || []; return rows.filter(o => !(ks && ks.has(detKey(o)))).length; }; const bkWarn = (c) => { const h = bkHaveMap[String(c)]; return !!(hasInc(c) && (!h || bkMiss(c) > 0)); }; const bkShow = (c) => { const h = bkHaveMap[String(c)]; const tot = (belowByAcc.get(String(c)) || []).length; const ms = bkMiss(c); const exp = `${bu}_Detail_backup_${prevPeriod}.xlsx`; if (h) return (ms > 0 ? '⚠ ' : '✓ ') + (h.name || bkLbl(c, h.period)) + (ms > 0 ? ` · ขาด ${ms}/${tot} แถว` : ''); return hasInc(c) ? `⚠ ${exp} · ไม่พบข้อมูลในไฟล์ (${incCnt(c)} แถวใน DB)` : '-'; }; """
s=s[:i]+new+s[j:]
# 4 render colors+titles
a="title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง · ' : 'ข้อมูลจาก DB (Include/Below) · ')"
rep("<span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} "+a,"<span style={{ color: bkWarn(a.code) ? '#B54708' : '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} "+a)
b="<span style={{ color: '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง' : 'ข้อมูลจาก DB"
rep(b,b.replace("color: '#1a3a5c'","color: bkWarn(a.code) ? '#B54708' : '#1a3a5c'"))
open(p,'w',encoding='utf-8').write(s)
