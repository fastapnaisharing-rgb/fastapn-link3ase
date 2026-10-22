import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_NO_DROPDOWN_SINGLE_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_nodd_'+datetime.datetime.now().strftime('%H%M%S'))
a="((bkFiles.length && !(belowByAcc"
assert s.count(a)==1
s=s.replace(a,"((bkFiles.length > 1 /* MARKER_GL_DOA_NO_DROPDOWN_SINGLE_V1 -- มีไฟล์เดียว = แสดงชื่อไฟล์ ไม่ต้อง Dropdown */ && !(belowByAcc")
open(p,'w',encoding='utf-8').write(s)
