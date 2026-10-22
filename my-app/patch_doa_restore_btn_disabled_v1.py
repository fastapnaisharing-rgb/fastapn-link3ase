import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_BTN_ALLROWS_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_rstall_'+datetime.datetime.now().strftime('%H%M%S'))
a="const restoreBtn = (a) => { const n = incByAcc.get(String(a.code)) || 0; if (!n) return null; return ("
assert s.count(a)==1
s=s.replace(a,"const restoreBtn = (a) => { const n = incByAcc.get(String(a.code)) || 0; /* MARKER_GL_DOA_RESTORE_BTN_ALLROWS_V1 -- แสดงปุ่ม Restore ครบทุกแถว: ไม่มีข้อมูลให้เก็บ = Disable (สีจาง) */ if (!n) return (<button type=\"button\" disabled title=\"Restore — ไม่มี Data Include ของ Account นี้\" style={{ marginLeft: 6, border: '1px solid #D5DEEA', background: '#fff', color: '#C3CCD9', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 26, height: 24, padding: 0, opacity: 0.6, cursor: 'not-allowed' }}><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 12a9 9 0 1 0 3-6.7\" /><polyline points=\"3 4 3 9 8 9\" /><path d=\"M12 8v5l3 2\" /></svg></button>); return (")
open(p,'w',encoding='utf-8').write(s)
