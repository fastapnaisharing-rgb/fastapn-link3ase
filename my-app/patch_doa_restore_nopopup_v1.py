import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_NOPOPUP_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_restore_nopopup_'+datetime.datetime.now().strftime('%H%M%S'))
a="setDbMsg('กำลังดึงไฟล์เดิมจาก Drive D ...'); const drv = await drvPull();"
assert s.count(a)==1
s=s.replace(a,"const drv = await drvPull(); /* MARKER_GL_DOA_RESTORE_NOPOPUP_V1 -- ไม่เด้ง Popup ระหว่างรอ (ปุ่มเป็น … อยู่แล้ว) เพื่อไม่ให้บังข้อความผลลัพธ์ */")
open(p,'w',encoding='utf-8').write(s)
