import sys,shutil,datetime
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_PULL_MERGE_SAVE_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_pull_merge_save_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,a[:80]; s=s.replace(a,b)
# 1) replace sendDriveD
i=s.index("  const sendDriveD = (matrix) =>"); j=s.index("  const restoreInc = async (code) => {")
new="""  const drvName = () => { const comR = detailInfo(detMatrix, '').com; const spR = /^[0-9][0-9A-Za-z]{2,7}$/.test(String(comR || '')) ? String(comR) : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); return { spR, nmR: [comR, bu, 'Detail_backup', prevPeriod].filter(Boolean).join('_') + '.xlsx' }; };
  const drvPull = async () => { /* MARKER_GL_DOA_RESTORE_PULL_MERGE_SAVE_V1 -- Restore: ดึงไฟล์เดิมจาก Drive D (<COM>_<BU>_Detail_backup_<งวดก่อน>.xlsx) -> เพิ่มข้อมูล (union ไม่ลบแถวเดิม) -> Save กลับ Drive D + DB */
    const { spR, nmR } = drvName(); const { root, tk } = spApi(); if (!spR || !tk) return { st: 'err', rows: [] };
    try { const rq = spNewReq(); spLaunch(`fastapn-sp://list?dest=dod&path=&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`); const jl = await spPoll(`${root}/api/file-storage/sp-handler/local/result?req=${rq}`, tk, 15); if (!jl) return { st: 'nolist', rows: [] };
      const hit = (jl.items || []).find(x => !x.dir && String(x.name || String(x.path).split('/').pop()).toLowerCase() === nmR.toLowerCase()); if (!hit) return { st: 'absent', rows: [] };
      const rq2 = spNewReq(); spLaunch(`fastapn-sp://pull?dest=dod&path=${encodeURIComponent(hit.path)}&req=${rq2}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`); const j = await spPoll(`${root}/api/file-storage/sp-handler/local/pull-result?req=${rq2}`, tk, 30); if (!j || !j.b64) return { st: 'nopull', rows: [] };
      const bin = atob(j.b64); const u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); const mt = await fileToMatrix(new File([u8], nmR), 'Detail'); return { st: 'pulled', rows: detailRows(mt) };
    } catch (e) { return { st: 'err', rows: [] }; } };
  const sendDriveD = (matrix, st) => { /* ส่งไฟล์ที่รวมแล้วกลับไป Save ที่ Drive D (ชื่อเดิม) — ทำเมื่อ list/pull ได้ผลชัดเจนเท่านั้น (ไม่ทับไฟล์ที่ยังไม่เห็น) */
    if (st !== 'pulled' && st !== 'absent') return ' · ไม่ได้ Save กลับ Drive D (' + (st === 'nolist' ? 'Handler ไม่ตอบ' : st === 'nopull' ? 'ดึงไฟล์เดิมไม่สำเร็จ' : 'ไม่พร้อม') + ' — กันไม่ให้ทับไฟล์เดิม)';
    try { const { spR, nmR } = drvName(); const wbR = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbR, XLSX.utils.aoa_to_sheet(matrix), 'Detail'); const urlR = URL.createObjectURL(new Blob([XLSX.write(wbR, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); setTimeout(() => { const dR = document.createElement('a'); dR.href = urlR; dR.download = nmR; dR.style.display = 'none'; document.body.appendChild(dR); dR.click(); dR.remove(); setTimeout(() => URL.revokeObjectURL(urlR), 4000); }, 300); setTimeout(() => { spLaunch(`fastapn-sp://backup?name=${encodeURIComponent(nmR)}&bu=${encodeURIComponent(spR)}&period=${encodeURIComponent(prevPeriod)}&dest=doh`); }, 1300); return ' · Save กลับ Drive D แล้ว: ' + nmR + (st === 'pulled' ? ' (ดึงไฟล์เดิมมารวม)' : ' (ไม่เคยมีไฟล์ — สร้างใหม่)'); } catch (eR) { return ' · Save กลับ Drive D ไม่สำเร็จ'; } };
"""
s=s[:i]+new+s[j:]
# 2) pull + merge rows after rows computed
rep("      if (!rows.length) { setDbMsg(`ไม่มีข้อมูล Include / แถว Below ของ Account ${code} ใน DB ให้เก็บ`); return; }",
"""      if (!rows.length) { setDbMsg(`ไม่มีข้อมูล Include / แถว Below ของ Account ${code} ใน DB ให้เก็บ`); return; }
      setDbMsg('กำลังดึงไฟล์เดิมจาก Drive D ...'); const drv = await drvPull(); { const cnt = new Map(); drv.rows.forEach(r => { const k = detKey(r); cnt.set(k, (cnt.get(k) || 0) + 1); }); const addR = []; rows.forEach(r => { const k = detKey(r); const v = cnt.get(k) || 0; if (v > 0) cnt.set(k, v - 1); else addR.push(r); }); rows.length = 0; drv.rows.forEach(r => rows.push(r)); addR.forEach(r => rows.push(r)); }""")
rep("if (!mg.changed) { let dm0 = ''; try { const d0 = ex ? await getDoaBackup(ex.id) : null; if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(d0.data); } catch (e0) { dm0 = ' · ส่งไฟล์รวมไม่สำเร็จ'; }",
    "if (!mg.changed) { let dm0 = ''; try { const d0 = ex ? await getDoaBackup(ex.id) : null; if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(d0.data, drv.st); } catch (e0) { dm0 = ' · Save กลับ Drive D ไม่สำเร็จ'; }") if "ส่งไฟล์รวมไม่สำเร็จ'; }" in s else None
rep("const drvMsg = sendDriveD(mg.matrix);","const drvMsg = sendDriveD(mg.matrix, drv.st);")
open(p,'w',encoding='utf-8').write(s)
