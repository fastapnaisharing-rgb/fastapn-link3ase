# -*- coding: utf-8 -*-
# โยนไฟล์ Backup (makeBackup): นอกจากเก็บลง DB ต่อ Account ให้ส่งไฟล์ <COM>_<BU>_Detail_backup_<งวด>_<Account>.xlsx ไป Drive D + SharePoint Z_Backup_DOH ผ่าน Handler ด้วย (ทีละไฟล์)
import os, shutil
MARKER = "MARKER_GL_DOA_MAKEBACKUP_SEND_BY_ACC_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
def rep(old, new):
    global s
    assert s.count(old) == 1, ("anchor", s.count(old), old[:80]); s = s.replace(old, new)
helper = r'''  const sendBkAccFiles = async (per, matrix) => { /* ''' + MARKER + r''' -- ส่งไฟล์ Backup ต่อ Account ไป Drive D + SharePoint Z_Backup_DOH (ทีละไฟล์ เว้นระยะให้ Handler ย้ายไฟล์จาก Downloads ทัน) */
    const com = bkComOf(); const spB = /^[0-9][0-9A-Za-z]{2,7}$/.test(com) ? com : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); if (!spB) return 0;
    const g = new Map(); detailRows(matrix).forEach(o => { const k = String(o.account_code); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms)); let n = 0;
    for (const [k, v] of g.entries()) {
      try {
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailMatrixFromRows(v)), 'Detail'); const nm = bkAccName(per, k);
        const url = URL.createObjectURL(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const d = document.createElement('a'); d.href = url; d.download = nm; d.style.display = 'none'; document.body.appendChild(d); d.click(); d.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        await sleep(1000); spLaunch(`fastapn-sp://backup?name=${encodeURIComponent(nm)}&bu=${encodeURIComponent(spB)}&period=${encodeURIComponent(per)}&dest=doh`); await sleep(2500); n++;
      } catch (e) { /* ข้ามไฟล์นี้ */ }
    }
    return n;
  };
  const makeBackup = async (f, perOv) => {'''
rep("  const makeBackup = async (f, perOv) => {", helper)
rep("await saveDetBk(prevP, mg.matrix); out.push(", "await saveDetBk(prevP, mg.matrix); { const nS = await sendBkAccFiles(prevP, mg.matrix); if (nS) out.push(`ส่งไฟล์ Backup ต่อ Account ${nS} ไฟล์ไป Drive D / SharePoint`); } out.push(")
rep("      await saveDetBk(per, mg.matrix);\n", "      await saveDetBk(per, mg.matrix); const nSend = await sendBkAccFiles(per, mg.matrix); /* " + MARKER + " */\n")
rep("setDbMsg(`✓ สร้าง Backup Detail แล้ว (BU ${bu} · งวด ${per} · ${n} แถว)`);", "setDbMsg(`✓ สร้าง Backup Detail แล้ว (BU ${bu} · งวด ${per} · ${n} แถว)` + (nSend ? ` · ส่งไฟล์ต่อ Account ${nSend} ไฟล์ไป Drive D / SharePoint` : ''));")
if not os.path.exists(P + ".bak_sendacc"): shutil.copy2(P, P + ".bak_sendacc")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
