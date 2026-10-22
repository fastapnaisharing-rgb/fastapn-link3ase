import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONFIRM_DL_NAME_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_confirm_dlname_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,('NF/dup',s.count(a),a[:90]); s=s.replace(a,b)
rep("if (opts && opts.onDownloaded) opts.onDownloaded();","if (opts && opts.onDownloaded) opts.onDownloaded(a2.download); /* MARKER_GL_DOA_CONFIRM_DL_NAME_V1 -- ส่งชื่อไฟล์จริงของ Download Excel กลับไปให้ Confirm */")
rep("dlExcel({ name: autoSend.name, onDownloaded: () => { autoSend.res(true);","dlExcel({ onDownloaded: (nm) => { autoSend.res(nm || true);")
# a2.remove() clears nothing on property; fine. Confirm side:
rep("const okR = await new Promise(res => setRcSend({ code: a.code, name: fname, res })); /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 */","const dlName = await new Promise(res => setRcSend({ code: a.code, res })); const okR = !!dlName; /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 */")
rep("h.href = `fastapn-sp://put?name=${encodeURIComponent(fname)}&path=","h.href = `fastapn-sp://put?name=${encodeURIComponent(dlName)}&path=")
rep("const fname = [com, bu, 'DOH', period, a.code].filter(Boolean).join('_') + '.xlsx';","let fname = [com, bu, 'DOH', period, a.code].filter(Boolean).join('_') + '.xlsx';")
rep("ไฟล์: ${fname} (${rows.length} แถว)","ไฟล์: Reconcile Excel ของ Account ${a.code} (ชื่อไฟล์ตามปุ่ม Download Excel) (${rows.length} แถว Detail)")
rep("const okR = !!dlName;","const okR = !!dlName; if (okR && typeof dlName === 'string') fname = dlName;")
open(p,'w',encoding='utf-8').write(s)
