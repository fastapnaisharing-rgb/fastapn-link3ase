import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONNECT_AUTO_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_connect_auto_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
# isCn: เจอไฟล์ Backup จริง หรือมี Include ใน DB = Connect อัตโนมัติ (ยกเว้นผู้ใช้กด Disconnect เอง)
rep("(!b && (incByAcc.get(String(c)) || 0) > 0); }; /* MARKER_GL_DOA_CONNECT_ICON_STATE_V1","(!b && ((incByAcc.get(String(c)) || 0) > 0 || !!bkHaveMap[String(c)])); }; /* "+M+" */ /* MARKER_GL_DOA_CONNECT_ICON_STATE_V1")
# toggle: คลิกตอนแสดง Connect อัตโนมัติ => Disconnect จริง (off) ไม่ใช่ Connect ซ้ำ
rep("if (!bkAcc[code] && (incByAcc.get(String(code)) || 0) > 0) { bkSet(code, { conn: 'on', sel: '' }); return; }","if (!bkAcc[code] && ((incByAcc.get(String(code)) || 0) > 0 || bkHaveMap[String(code)])) { bkSet(code, { conn: 'off', sel: '' }); return; }")
# Restore เสร็จ => Connect อัตโนมัติ
rep("setBkTick(t => t + 1); setDbMsg(`✓ เก็บ Data Include ของ Account ${code}","{ const nf = it2.find(x => x.period === prevPeriod); bkSet(code, { conn: 'on', sel: nf ? String(nf.id) : '' }); } setBkTick(t => t + 1); setDbMsg(`✓ เก็บ Data Include ของ Account ${code}")
open(p,'w',encoding='utf-8').write(s); print('ok')
