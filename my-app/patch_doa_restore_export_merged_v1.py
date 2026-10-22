import sys,shutil,datetime
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_EXPORT_MERGED_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_restore_drived_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,a[:70]; s=s.replace(a,b)
# helper before restoreInc
rep("  const restoreInc = async (code) => {\n","""  const sendDriveD = (matrix) => { /* MARKER_GL_DOA_RESTORE_EXPORT_MERGED_V1 -- Restore รวมข้อมูลเข้า Backup เดิมแล้ว ส่งไฟล์ที่รวมแล้วออกมาเป็นไฟล์ดาวน์โหลด (ไม่เขียนทับไฟล์ใน Drive D) */
    try { const comR = detailInfo(detMatrix, '').com; const spR = /^[0-9][0-9A-Za-z]{2,7}$/.test(String(comR || '')) ? String(comR) : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); if (!spR) return ' · ข้ามส่งไฟล์ (ไม่พบรหัส COM)'; const nmR = [comR, bu, 'Detail_backup', prevPeriod, 'merged'].filter(Boolean).join('_') + '.xlsx'; const wbR = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbR, XLSX.utils.aoa_to_sheet(matrix), 'Detail'); const urlR = URL.createObjectURL(new Blob([XLSX.write(wbR, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); setTimeout(() => { const dR = document.createElement('a'); dR.href = urlR; dR.download = nmR; dR.style.display = 'none'; document.body.appendChild(dR); dR.click(); dR.remove(); setTimeout(() => URL.revokeObjectURL(urlR), 4000); }, 300); return ' · ส่งไฟล์รวม ' + nmR + ' ออกมาให้ดาวน์โหลดแล้ว (ไม่ได้ทับไฟล์ใน Drive D)'; } catch (eR) { return ' · ส่งไฟล์รวมไม่สำเร็จ'; } };
  const restoreInc = async (code) => {
""")
# unchanged branch: send existing DB file to Drive D
rep("if (!mg.changed) { setDbMsg(`✓ Account ${code}: Backup ${prevPeriod} มีข้อมูล Include ครบแล้ว (${rows.length} แถว) — ไม่ต้องเก็บเพิ่ม`); return; }",
"if (!mg.changed) { let dm0 = ''; try { const d0 = ex ? await getDoaBackup(ex.id) : null; if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(d0.data); } catch (e0) { dm0 = ' · ส่งไฟล์รวมไม่สำเร็จ'; } setDbMsg(`✓ Account ${code}: Backup ${prevPeriod} มีข้อมูล Include ครบแล้ว (${rows.length} แถว) — ไม่ต้องเก็บเพิ่ม` + dm0); return; }")
rep("const sv = await saveDoaBackup(bu, prevPeriod, fnm, mg.matrix, 'Detail'); /* MARKER_GL_DOA_RESTORE_VERIFY_V1","const sv = await saveDoaBackup(bu, prevPeriod, fnm, mg.matrix, 'Detail'); const drvMsg = sendDriveD(mg.matrix); /* MARKER_GL_DOA_RESTORE_VERIFY_V1")
rep("` : `✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า ${fnm} (Backup ${prevPeriod}) แล้ว`);","` : `✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า ${fnm} (Backup ${prevPeriod}) แล้ว` + drvMsg);")
open(p,'w',encoding='utf-8').write(s)
