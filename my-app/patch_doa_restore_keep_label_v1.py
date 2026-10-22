import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_KEEP_LABEL_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_restore_keeplabel_'+datetime.datetime.now().strftime('%H%M%S'))
a="{ const nf = it2.find(x => x.period === prevPeriod); bkSet(code, { conn: 'on', sel: nf ? String(nf.id) : '' }); if (!nf)"
assert s.count(a)==1
s=s.replace(a,"{ const nf = it2.find(x => x.period === prevPeriod); /* MARKER_GL_DOA_RESTORE_KEEP_LABEL_V1 -- ไม่ตั้ง conn=on หลัง Restore (ทำให้ช่อง Filename เปลี่ยนเป็น Dropdown ไม่เหมือนแถวอื่น) — แสดงเป็นชื่อไฟล์ ✓ เหมือนเดิม */ if (!nf)")
open(p,'w',encoding='utf-8').write(s)
