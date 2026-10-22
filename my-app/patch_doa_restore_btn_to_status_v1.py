import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_BTN_STATUS_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_rstbtn_'+datetime.datetime.now().strftime('%H%M%S'))
a="{/* MARKER_GL_DOA_RESTORE_INCLUDE_V1 */}{restoreBtn(a)}</td>"
assert s.count(a)==1
s=s.replace(a,"{/* MARKER_GL_DOA_RESTORE_INCLUDE_V1 */}</td>")
b="{rvsBusy === String(a.code) ? '…' : '♻'}</button>); })()}\n"
assert s.count(b)==1
s=s.replace(b,b+"                    {/* MARKER_GL_DOA_RESTORE_BTN_STATUS_V1 -- ย้ายปุ่ม Restore ไปคอลัมน์ Status */}{restoreBtn(a)}\n")
open(p,'w',encoding='utf-8').write(s)
