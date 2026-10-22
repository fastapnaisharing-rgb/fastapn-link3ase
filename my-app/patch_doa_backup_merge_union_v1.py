import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_BACKUP_UNION_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_backup_union_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:70],s.count(a)); s=s.replace(a,b)
old="else if (o.h === n.h && o.n === n.n) { rep2.push({ c, st: 'เท่าเดิม', n: n.n, o: o.n }); take.push(...o.rows); } else { rep2.push({ c, st: 'อัปเดต', n: n.n, o: o.n }); take.push(...n.rows); changed = true; } });"
new="else { /* "+M+" -- Backup สะสม: รวมแถวเดิม + แถวใหม่ที่ยังไม่มี (เทียบด้วย detKey แบบนับจำนวน) — ห้ามทับ/ลบแถวเดิมของ Account เดียวกัน */ const cnt = new Map(); o.rows.forEach(r => { const k = detKey(r); cnt.set(k, (cnt.get(k) || 0) + 1); }); const add = n.rows.filter(r => { const k = detKey(r); const v = cnt.get(k) || 0; if (v > 0) { cnt.set(k, v - 1); return false; } return true; }); if (!add.length) { rep2.push({ c, st: 'เท่าเดิม', n: o.n, o: o.n }); take.push(...o.rows); } else { rep2.push({ c, st: 'อัปเดต', n: o.n + add.length, o: o.n }); take.push(...o.rows, ...add); changed = true; } } });"
rep(old,new)
rep("['อัปเดต (ทับ)', String(mg.rep.filter(x => x.st === 'อัปเดต').length)]","['รวมเพิ่มแถวใหม่ (ไม่ทับของเดิม)', String(mg.rep.filter(x => x.st === 'อัปเดต').length)]")
rep("อัปเดต (ทับ) ${mg.rep.filter(x => x.st === 'อัปเดต').length}","รวมเพิ่มแถว (ไม่ทับของเดิม) ${mg.rep.filter(x => x.st === 'อัปเดต').length}")
open(p,'w',encoding='utf-8').write(s); print('ok')
