import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_confirm_xlsx_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,('NF/dup',s.count(a),a[:90]); s=s.replace(a,b)
# --- Modal ---
rep("function DoaReconcileModal({ code, tbMatrix, detMatrix, simMatrix, onClose, bu, period }) {","function DoaReconcileModal({ code, tbMatrix, detMatrix, simMatrix, onClose, bu, period, autoSend, hidden }) {")
rep("  const dlExcel = async () => { /* MARKER_GL_DOA_RECON_DOWNLOAD_V1","  const dlExcel = async (opts) => { /* MARKER_GL_DOA_RECON_DOWNLOAD_V1")
rep("a2.download = (() => { const com = (detailInfo(detMatrix || [], '').com","a2.download = (opts && opts.name) ? opts.name : (() => { const com = (detailInfo(detMatrix || [], '').com")
rep("})(); /* MARKER_GL_DOA_RECON_FILENAME_V1","})(); /* MARKER_GL_DOA_RECON_FILENAME_V1")
# closing paren for the ternary: find the IIFE end right after FILENAME marker text
i=s.index("/* MARKER_GL_DOA_RECON_FILENAME_V1"); j=s.rfind("})();",0,i)
pass
rep("a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);\n    } catch (e) { window.alert('Download ไม่สำเร็จ: ' + e.message); }","a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); if (opts && opts.onDownloaded) opts.onDownloaded();\n    } catch (e) { if (opts && opts.onFail) opts.onFail(e); else window.alert('Download ไม่สำเร็จ: ' + e.message); }")
# effect after dlExcel definition end: insert before 'return (\n    <div onClick={onClose}'
anc="  return (\n    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600,"
rep(anc,"""  const autoRan = React.useRef(false); /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 -- Confirm = สร้างไฟล์ Reconcile (ตัวเดียวกับปุ่ม Download Excel) แบบไม่แสดงหน้าต่าง แล้วดาวน์โหลดเพื่อให้ Handler ส่งต่อ SharePoint */
  React.useEffect(() => { if (!autoSend || autoRan.current) return undefined; if (!D) { const t = setTimeout(() => { if (!autoRan.current) { autoRan.current = true; autoSend.res(false); onClose(); } }, 4000); return () => clearTimeout(t); } autoRan.current = true; setTimeout(() => { dlExcel({ name: autoSend.name, onDownloaded: () => { autoSend.res(true); setTimeout(onClose, 50); }, onFail: () => { autoSend.res(false); onClose(); } }); }, 400); return undefined; }, [D, autoSend]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div onClick={onClose} style={{ visibility: hidden ? 'hidden' : undefined, position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600,""")
# --- Main ---
rep("const [recAcc, setRecAcc] = React.useState(null);","const [recAcc, setRecAcc] = React.useState(null); const [rcSend, setRcSend] = React.useState(null);")
a="      {recAcc && <DoaReconcileModal code={recAcc} tbMatrix={tbMatrix} detMatrix={detMatrix} simMatrix={simMatrix} bu={bu} period={period} onClose={() => setRecAcc(null)} />}"
rep(a,a+"\n      {rcSend && <DoaReconcileModal hidden autoSend={rcSend} code={rcSend.code} tbMatrix={tbMatrix} detMatrix={detMatrix} simMatrix={simMatrix} bu={bu} period={period} onClose={() => setRcSend(null)} />}")
rep("const fname = [com, bu, 'DOH', period, a.code].filter(Boolean).join('_') + '.csv';","const fname = [com, bu, 'DOH', period, a.code].filter(Boolean).join('_') + '.xlsx';")
rep("ระบบสร้างไฟล์ CSV แล้วส่งเข้าโฟลเดอร์ SharePoint ผ่าน Handler","ระบบสร้างไฟล์ Reconcile (Excel ตัวเดียวกับปุ่ม Download Excel) แล้วส่งเข้าโฟลเดอร์ SharePoint Z_Detail of Account ผ่าน Handler")
st=s.index("      const q = (v) => '\"' + String(v == null ? '' : v)"); en=s.index("}, 800);",st)+len("}, 800);")
new="""      const okR = await new Promise(res => setRcSend({ code: a.code, name: fname, res })); /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 */
      if (!okR) { setNotice({ tone: 'err', title: 'Confirm ไม่ได้', lines: ['สร้างไฟล์ Reconcile ไม่สำเร็จ — ตรวจว่ามี TB ของงวดนี้และ Account นี้อยู่ใน TB'] }); return; }
      let sp = ''; try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\\/api$/, ''); const tk = sessionStorage.getItem('fastapn_token') || ''; if (tk) sp = `&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`; } catch (e) { /* ignore */ }
      /* MARKER_GL_DOA_CONFIRM_GL_PUT_V1 -- dest=gl (v17) = รากโฟลเดอร์ Reconcile_Backup: send จะวางที่ Reconcile_Backup\\<COM>\\<งวด> ไม่เข้า Z_Detail of Account -> ใช้ put ระบุ path ให้เข้า Z_Detail of Account\\<COM>\\<งวด> */
      setTimeout(() => { const h = document.createElement('a'); h.href = `fastapn-sp://put?name=${encodeURIComponent(fname)}&path=${encodeURIComponent('Z_Detail of Account/' + spBu + '/' + period)}&dest=${DOA_SP_DEST}${sp}`; h.style.display = 'none'; document.body.appendChild(h); h.click(); h.remove(); }, 800);"""
s=s[:st]+new+s[en:]
open(p,'w',encoding='utf-8').write(s)
