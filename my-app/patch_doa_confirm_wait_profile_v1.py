import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONFIRM_WAIT_PROFILE_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_confirm_waitprofile_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,('NF/dup',s.count(a),a[:90]); s=s.replace(a,b)
rep("const [sp, setSp] = React.useState({});\n","const [sp, setSp] = React.useState({}); const [spReady, setSpReady] = React.useState(false); /* MARKER_GL_DOA_CONFIRM_WAIT_PROFILE_V1 -- Confirm ส่งไฟล์อัตโนมัติต้องรอโหลดชื่อผู้จัดทำ/ผู้สอบทานก่อน ไม่งั้นชื่อเป็น — */\n")
rep("loadSignoffProfile().then(d => { if (!off) setSp(d || {}); }).catch(() => {});","loadSignoffProfile().then(d => { if (!off) { setSp(d || {}); setSpReady(true); } }).catch(() => { if (!off) setSpReady(true); });")
rep("React.useEffect(() => { if (!autoSend || autoRan.current) return undefined; if (!D)","React.useEffect(() => { if (!autoSend || autoRan.current || !spReady) return undefined; if (!D)")
rep("}, 400); return undefined; }, [D, autoSend]);","}, 600); return undefined; }, [D, autoSend, spReady]);")
open(p,'w',encoding='utf-8').write(s)
