import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_INCLUDE_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_include_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
helper = r"""  const [rstBusy, setRstBusy] = React.useState(''); /* """+M+""" -- Restore: เก็บ Data Include ของ Account (จาก DB doa_detail_clear) กลับเข้า Backup Detail อีกรอบ แบบรวมสะสม ไม่ทับของเดิม */
  const restoreInc = async (code) => {
    if (rstBusy || !bu) return; setRstBusy(String(code)); setDbMsg('');
    try {
      const items = (await listDoaClearDetail(bu, String(code))).filter(x => x.status === 'Include' && x.row);
      if (!items.length) { setDbMsg(`ไม่มีข้อมูล Include ของ Account ${code} ใน DB ให้เก็บ`); return; }
      const rows = items.map(x => x.row);
      const j = await listDoaBackups(bu); const ex = (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod);
      const mg = await prepBackupMerge(prevPeriod, detailMatrixFromRows(rows));
      if (!mg.changed) { setDbMsg(`✓ Account ${code}: Backup ${prevPeriod} มีข้อมูล Include ครบแล้ว (${rows.length} แถว) — ไม่ต้องเก็บเพิ่ม`); return; }
      if (!await askDoa(`เก็บ Data Include กลับเข้า Backup Detail?\n\nBU ${bu} · Account ${code}\nแถว Include ใน DB: ${rows.length} แถว\nเก็บเข้า Backup งวด ${prevPeriod} (รวมกับของเดิม ไม่ทับ)`)) return;
      await saveDoaBackup(bu, prevPeriod, (ex && ex.file_name) || `${bu}_Detail_backup_${prevPeriod}.xlsx`, mg.matrix, 'Detail');
      const j2 = await listDoaBackups(bu); const it2 = (j2.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort((x, y) => String(y.period).localeCompare(String(x.period))); setBkFiles(it2); bkLoaded.current = bu;
      setBkTick(t => t + 1); setDbMsg(`✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า Backup ${prevPeriod} แล้ว`);
    } catch (e) { setDbMsg('เก็บ Data Include ไม่สำเร็จ: ' + e.message); } finally { setRstBusy(''); }
  };
  const restoreBtn = (a) => { const n = incByAcc.get(String(a.code)) || 0; if (!n) return null; return (<button type="button" disabled={!!rstBusy} onClick={() => restoreInc(a.code)} title={`Restore — เก็บ Data Include ${n} แถวของ Account นี้เข้า Backup ${prevPeriod} อีกรอบ (รวมกับของเดิม ไม่ทับ)`} style={{ marginLeft: 6, border: '1px solid #B9D3F2', background: '#EEF5FF', color: '#1F5FBF', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 26, height: 24, padding: 0, cursor: rstBusy ? 'wait' : 'pointer' }}>{rstBusy === String(a.code) ? '…' : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /><path d="M12 8v5l3 2" /></svg>)}</button>); };
"""
rep("  const isCn = (c) =>", helper+"  const isCn = (c) =>")
rep("ไม่มีไฟล์ Backup ใน DB</span>))}</td>","ไม่มีไฟล์ Backup ใน DB</span>))}{/* "+M+" */}{restoreBtn(a)}</td>")
rep("width: 230, maxWidth: 230, fontSize: 12 }}>{/* MARKER_GL_DOA_BACKUP_FILE_COL_V1","width: 270, maxWidth: 270, fontSize: 12 }}>{/* MARKER_GL_DOA_BACKUP_FILE_COL_V1")
open(p,'w',encoding='utf-8').write(s); print('ok')
