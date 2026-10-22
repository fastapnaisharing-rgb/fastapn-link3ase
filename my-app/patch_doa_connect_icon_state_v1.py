import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONNECT_ICON_STATE_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_connect_icon_state_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:60],s.count(a)); s=s.replace(a,b)
# 1) helper
rep("  const hasInc = (c) =>","  const isCn = (c) => { const b = bkAcc[c]; return (b && b.conn === 'on') || (!b && (incByAcc.get(String(c)) || 0) > 0); }; /* "+M+" -- Connect แล้ว = conn on หรือ มี Include ใน DB (ยังไม่เคยกด Disconnect) → ไอคอนเป็นเชื่อมต่อ */\n  const hasInc = (c) =>")
# 2) button block
a=s.index("<button type=\"button\" onClick={() => toggleBk(a.code)}")
b=s.index("</button>",a)
blk=s[a:b]
assert blk.count("(bkAcc[a.code] || {}).conn === 'on'")==5,blk.count("(bkAcc[a.code] || {}).conn === 'on'")
nb=blk.replace("(bkAcc[a.code] || {}).conn === 'on'","isCn(a.code)")
s=s[:a]+nb+s[b:]
# 3) click on already-included row => mark on (no reload)
rep("    if (cur.conn === 'on') { bkSet(code, { conn: 'off', sel: '' }); return; }\n    if (!bu)","    if (cur.conn === 'on') { bkSet(code, { conn: 'off', sel: '' }); return; }\n    if (!bkAcc[code] && (incByAcc.get(String(code)) || 0) > 0) { bkSet(code, { conn: 'on', sel: '' }); return; }\n    if (!bu)")
open(p,'w',encoding='utf-8').write(s); print('ok')
