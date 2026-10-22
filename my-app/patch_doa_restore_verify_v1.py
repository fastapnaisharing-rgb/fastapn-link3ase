import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_VERIFY_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_verify_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
rep("      await saveDoaBackup(bu, prevPeriod, (ex && ex.file_name) || `${bu}_Detail_backup_${prevPeriod}.xlsx`, mg.matrix, 'Detail');\n      const j2 = await listDoaBackups(bu);",
"      const fnm = (ex && ex.file_name) || `${bu}_Detail_backup_${prevPeriod}.xlsx`; const sv = await saveDoaBackup(bu, prevPeriod, fnm, mg.matrix, 'Detail'); /* "+M+" -- แสดงชื่อไฟล์ที่เก็บทันที + เตือนถ้า Backend ตั้งวันหมดอายุเลยมาแล้ว (ไฟล์จะถูกซ่อน/ลบ) */\n      const expd = sv && sv.expires_at ? new Date(sv.expires_at) : null; const expired = !!(expd && expd.getTime() < Date.now());\n      const j2 = await listDoaBackups(bu);")
rep("{ const nf = it2.find(x => x.period === prevPeriod); bkSet(code, { conn: 'on', sel: nf ? String(nf.id) : '' }); } setBkTick(t => t + 1); setDbMsg(`✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า Backup ${prevPeriod} แล้ว`);",
"{ const nf = it2.find(x => x.period === prevPeriod); bkSet(code, { conn: 'on', sel: nf ? String(nf.id) : '' }); if (!nf) setBkHaveMap(m0 => ({ ...m0, [String(code)]: { id: sv && sv.id, period: prevPeriod, name: fnm } })); } setBkTick(t => t + 1); setDbMsg(expired ? `⚠ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) ลง ${fnm} แล้ว แต่ Backend ตั้งวันหมดอายุเป็น ${expd.toLocaleDateString('th-TH')} (เลยมาแล้ว) — ไฟล์จะถูกซ่อน/ลบ ต้องแก้กฎอายุไฟล์ที่ Backend` : `✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า ${fnm} (Backup ${prevPeriod}) แล้ว`);")
open(p,'w',encoding='utf-8').write(s); print('ok')
