import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RECON_DETAIL_FREEZE_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_detfreeze_'+datetime.datetime.now().strftime('%H%M%S'))
a="            ws.columns.forEach((c, j) => { c.width = [14, 18, 16, 14, 22, 18, 18, 30, 16, 26].map(x => x)[j] || 16; }); return;"
assert s.count(a)==1
s=s.replace(a,"            ws.views = [{ state: 'frozen', ySplit: 9, zoomScale: 70, zoomScaleNormal: 70 }]; /* MARKER_GL_DOA_RECON_DETAIL_FREEZE_V1 -- Freeze ตั้งแต่บรรทัดที่ 10 (แถว 1-9 = หัวรายงาน + หัวตาราง คงอยู่ตอนเลื่อน) */\n"+a)
open(p,'w',encoding='utf-8').write(s)
