# -*- coding: utf-8 -*-
# Frontend: Backup Detail แยกตาม Account (ต้องลง Backend patch_doa_backup_by_account_v1.py ก่อน)
# ใช้: python patch_doa_backup_by_account_fe_v1.py  (รันที่โฟลเดอร์ my-app)
import os, shutil, re
MARKER = "MARKER_GL_DOA_BACKUP_BY_ACCOUNT_FE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js"); C = os.path.join("src", "doaConfig.js")
s = open(P, encoding="utf-8").read(); c = open(C, encoding="utf-8").read()
if MARKER in s:
    print("ข้าม: ลงแล้ว"); raise SystemExit
def rep(t, old, new, n=1):
    assert t.count(old) == n, ("anchor", t.count(old), old[:100]); return t.replace(old, new)

# --- doaConfig.js
c = rep(c, "export const saveDoaBackup = (bu, period, file_name, rows, kind = 'TB') => call(BK, { method: 'POST', body: JSON.stringify({ bu, period, file_name, rows, kind }) });",
           "export const saveDoaBackup = (bu, period, file_name, rows, kind = 'TB', account = '') => call(BK, { method: 'POST', body: JSON.stringify({ bu, period, file_name, rows, kind, account }) });")

# --- module helpers
s = rep(s, "const saveDoaBackup = async (...a) => { const r = await _saveDoaBackup(...a); _bc('doa_tb_changed'); return r; };",
 "const saveDoaBackup = async (...a) => { const r = await _saveDoaBackup(...a); _bc('doa_tb_changed'); return r; };\n"
 "/* " + MARKER + " -- Backup Detail แยกไฟล์ต่อ Account (BU+งวด+Account) */\n"
 "const bkCmp = (x, y) => String(y.period).localeCompare(String(x.period)) || ((y.account ? 1 : 0) - (x.account ? 1 : 0));\n"
 "const bkPick = (it, per) => { const f = it.filter(x => x.period < per).sort(bkCmp); const seen = new Set(); const out = []; let lg = 0; f.forEach(x => { if (x.account) { if (seen.has(x.account)) return; seen.add(x.account); out.push(x); } else if (lg++ < 12) out.push(x); }); return out.slice(0, 170); };\n"
 "const bkSel = (it, per, c) => { const f = it.find(x => x.period === per && String(x.account) === String(c)) || it.find(x => x.period === per && !x.account); return f ? String(f.id) : ''; };\n")
s = s.replace(".sort((x, y) => String(y.period).localeCompare(String(x.period)))", ".sort(bkCmp)")
s = s.replace(".sort((a, b) => String(b.period).localeCompare(String(a.period)))", ".sort(bkCmp)")

# --- file pickers
s = rep(s, "const files = it.slice(0, 12);", "const files = bkPick(it, period);")
s = rep(s, "const fl = it.filter(x => x.period < period).slice(0, 12);", "const fl = bkPick(it, period);")
s = rep(s, "|| it.find(x => x.period === prevPeriod) || null; }; /* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */",
           "|| it.find(x => x.period === prevPeriod && String(x.account) === String(code)) || it.find(x => x.period === prevPeriod && !x.account) || null; }; /* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */")
s = rep(s, "sel: String(def.id) }; }); return n; }); }).catch(() => {});", "sel: bkSel(it, prevPeriod, c) }; }); return n; }); }).catch(() => {});")
s = rep(s, "nn[c] = { conn: 'on', sel: def2 ? String(def2.id) : '' }; }); return nn; });", "nn[c] = { conn: 'on', sel: bkSel(it2, prevPeriod, c) }; }); return nn; });")
s = rep(s, "nn[c] = { conn: 'on', sel: def ? String(def.id) : '' }; }); return nn; });", "nn[c] = { conn: 'on', sel: bkSel(it, prevPeriod, c) }; }); return nn; });")

# --- โหลดหน้า: ไฟล์ Detail ของงวด (ทั้ง BU) ต้องไม่เอาไฟล์ by Account
s = rep(s, "const it = items.find(x => x.period === per && (x.kind || 'TB') === kind); const itRaw", "const it = items.find(x => x.period === per && (x.kind || 'TB') === kind && !x.account); const itRaw")

# --- Drive D ต่อ Account
s = rep(s, "const drvName = () => {", "const drvName = (acc) => {")
s = rep(s, "nmR: [comR, bu, 'Detail_backup', prevPeriod].filter(Boolean).join('_') + '.xlsx' }; };", "nmR: [comR, bu, 'Detail_backup', prevPeriod, acc].filter(Boolean).join('_') + '.xlsx' }; };")
s = rep(s, "const drvPull = async () => {", "const drvPull = async (acc) => {")
s = rep(s, "const { spR, nmR } = drvName(); const { root, tk } = spApi(); if (!spR || !tk) return { st: 'err', rows: [] };", "const { spR, nmR } = drvName(acc); const { root, tk } = spApi(); if (!spR || !tk) return { st: 'err', rows: [] };")
s = rep(s, "const sendDriveD = (matrix, st) => {", "const sendDriveD = (matrix, st, acc) => {")
s = rep(s, "try { const { spR, nmR } = drvName(); const wbR", "try { const { spR, nmR } = drvName(acc); const wbR")

# --- restoreInc
s = rep(s, "const drv = await drvPull(); /* MARKER_GL_DOA_RESTORE_NOPOPUP_V1", "const drv = await drvPull(String(code)); /* MARKER_GL_DOA_RESTORE_NOPOPUP_V1")
s = rep(s, "const j = await listDoaBackups(bu); const ex = (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod);\n      /* MARKER_GL_DOA_RESTORE_GUARD_V1",
           "const j = await listDoaBackups(bu); const ex = (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod && String(x.account) === String(code)) || (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod && !x.account);\n      /* MARKER_GL_DOA_RESTORE_GUARD_V1")
s = rep(s, "if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(d0.data, drv.st);", "if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(detailMatrixFromRows(drv.rows.concat(detailRows(d0.data).filter(o => String(o.account_code) === String(code)))), drv.st, String(code));")
s = rep(s, "const fnm = (ex && ex.file_name) || `${bu}_Detail_backup_${prevPeriod}.xlsx`; const sv = await saveDoaBackup(bu, prevPeriod, fnm, mg.matrix, 'Detail'); const drvMsg = sendDriveD(mg.matrix, drv.st);",
           "const fnm = bkAccName(prevPeriod, String(code)); const sv = await saveDetBk(prevPeriod, mg.matrix); const drvMsg = sendDriveD(mg.matrix, drv.st, String(code));")
s = rep(s, "const nf = it2.find(x => x.period === prevPeriod);", "const nf = it2.find(x => x.period === prevPeriod && String(x.account) === String(code));")

# --- prepBackupMerge + helpers
a = s.index("  const prepBackupMerge = async (per, mat) => {"); b = s.index("  const carryM1 = async")
new_pb = r'''  const bkComOf = () => String(detailInfo(detMatrix, '').com || ((buOptions.find(o => o.value === bu) || {}).com) || '').trim();
  const bkAccName = (per, acc) => [bkComOf(), bu, 'Detail_backup', per, acc].filter(Boolean).join('_') + '.xlsx';
  const bkExistRows = async (per, accs, noLegacy) => { /* แถวเดิมของ Account (ไฟล์ by Account + แถวของ Account นั้นในไฟล์รวมเดิม) */
    const j = await listDoaBackups(bu); const its = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period === per && (x.account ? accs.has(String(x.account)) : !noLegacy));
    const ds = await Promise.all(its.map(it => getDoaBackup(it.id).then(d => ({ it, rows: detailRows(Array.isArray(d && d.data) ? d.data : []) })).catch(() => null)));
    const out = []; const legacy = []; ds.forEach(r => { if (!r) return; if (r.it.account) out.push(...r.rows.filter(o => accs.has(String(o.account_code)))); else legacy.push(...r.rows.filter(o => accs.has(String(o.account_code)))); });
    const cnt = new Map(); out.forEach(o => { const k = detKey(o); cnt.set(k, (cnt.get(k) || 0) + 1); }); legacy.forEach(o => { const k = detKey(o); const v = cnt.get(k) || 0; if (v > 0) cnt.set(k, v - 1); else out.push(o); });
    return { rows: out, any: its.length > 0 };
  };
  const saveDetBk = async (per, matrix) => { /* เก็บ 1 ไฟล์ต่อ Account */
    const jj = await listDoaBackups(bu); if (!jj || !jj.by_account) throw new Error('Backend ยังไม่ได้อัปเดต (patch_doa_backup_by_account_v1.py + Restart-Service) — ไม่บันทึก เพื่อกันทับไฟล์ทั้ง BU');
    const g = new Map(); detailRows(matrix).forEach(o => { const k = String(o.account_code); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
    const ents = [...g.entries()]; let last = null; for (let i = 0; i < ents.length; i += 5) { const rs = await Promise.all(ents.slice(i, i + 5).map(([k, v]) => saveDoaBackup(bu, per, bkAccName(per, k), detailMatrixFromRows(v), 'Detail', k))); last = rs[rs.length - 1]; } return last;
  };
  const prepBackupMerge = async (per, mat, noLegacy) => { /* ทีละ Account: รวมแถวเดิม + แถวใหม่ที่ยังไม่มี (ไม่ทับ/ไม่ลบ) — ผลลัพธ์มีเฉพาะ Account ในไฟล์ที่ส่งเข้ามา */
    const newRows = detailRows(mat); const nSig = detSigByAcc(newRows); const accs = new Set(Object.keys(nSig));
    const ex = await bkExistRows(per, accs, noLegacy);
    if (!ex.any) return { matrix: mat, rep: Object.keys(nSig).map(c => ({ c, st: 'ใหม่', n: nSig[c].n, o: 0 })), changed: true, merged: false };
    const oSig = detSigByAcc(ex.rows); const rep2 = []; let changed = false; const take = [];
    Object.keys(nSig).forEach(c => { const o = oSig[c], n = nSig[c]; if (!o) { rep2.push({ c, st: 'ใหม่', n: n.n, o: 0 }); take.push(...n.rows); changed = true; } else { const cnt = new Map(); o.rows.forEach(r => { const k = detKey(r); cnt.set(k, (cnt.get(k) || 0) + 1); }); const add = n.rows.filter(r => { const k = detKey(r); const v = cnt.get(k) || 0; if (v > 0) { cnt.set(k, v - 1); return false; } return true; }); if (!add.length) { rep2.push({ c, st: 'เท่าเดิม', n: o.n, o: o.n }); take.push(...o.rows); } else { rep2.push({ c, st: 'อัปเดต', n: o.n + add.length, o: o.n }); take.push(...o.rows, ...add); changed = true; } } });
    return { matrix: changed ? detailMatrixFromRows(take) : mat, rep: rep2, changed, merged: true };
  };
'''
s = s[:a] + new_pb + s[b:]

# --- carryM1
s = rep(s, "await saveDoaBackup(bu, period, (d && d.file_name) || def.file_name || ('Backup ' + def.period), mg.matrix, 'Detail');", "await saveDetBk(period, mg.matrix);")
s = rep(s, "const mg = await prepBackupMerge(period, detailMatrixFromRows(rows)); if (!mg.changed) return;", "const mg = await prepBackupMerge(period, detailMatrixFromRows(rows), true); if (!mg.changed) return;")

# --- makeBackup
s = rep(s, "await saveDoaBackup(bu, prevP, bkName, mg.matrix, 'Detail'); out.push(", "await saveDetBk(prevP, mg.matrix); out.push(")
s = rep(s, "if (spB) { const wbB", "if (false) { const wbB")
s = rep(s, "} else out.push('ข้ามส่ง Drive D / SharePoint (ไม่พบรหัส COM)'); }", "} else out.push('Drive D แยกราย Account เก็บตอน Confirm / Restore'); }")
s = rep(s, "const jj3 = await listDoaBackups(bu); const ex3 = (jj3.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === dp); let exRows = []; let exName = '';\n            if (ex3) { const d3 = await getDoaBackup(ex3.id); exRows = detailRows(Array.isArray(d3 && d3.data) ? d3.data : []); exName = ex3.file_name || ''; }",
           "const exRows = (await bkExistRows(dp, new Set(sp.parts.below.map(o => String(o.account_code))), true)).rows;")
s = rep(s, "await saveDoaBackup(bu, dp, exName || f.name, detailMatrixFromRows([...exRows, ...addR]), 'Detail');", "await saveDetBk(dp, detailMatrixFromRows([...exRows, ...addR]));")
s = rep(s, "await saveDoaBackup(bu, per, f.name, mg.matrix, 'Detail');", "await saveDetBk(per, mg.matrix);")

# --- Confirm
s = rep(s, "try { const j2 = await listDoaBackups(bu); const it = (j2.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === period); if (it) { const d0 = await getDoaBackup(it.id); old = detailRows(Array.isArray(d0 && d0.data) ? d0.data : []); } } catch (e3) { old = []; }",
           "try { old = (await bkExistRows(period, curAcc, true)).rows; } catch (e3) { old = []; }")
s = rep(s, "try { await saveDoaBackup(bu, period, [com, bu, 'Detail_backup', period].filter(Boolean).join('_') + '.xlsx', mat, 'Detail'); setBkTick", "try { await saveDetBk(period, mat); setBkTick")
s = rep(s, "const bkName = [com, bu, 'Detail_backup', period].filter(Boolean).join('_') + '.xlsx';", "const bkName = [com, bu, 'Detail_backup', period, a.code].filter(Boolean).join('_') + '.xlsx'; /* by Account */")
i0 = s.index("          /* Backup แยกราย Account: Detail ของ Account ที่ Confirm"); i1 = s.index("}, 4800);\n", i0) + len("}, 4800);\n")
s = s[:i0] + s[i1:]
s = s.replace("สร้าง Backup ใหม่ (ทับของเดิม)", "เพิ่ม Backup ของ Account นี้ (สะสม ไม่ซ้ำ)")

s = s.replace("/* MARKER_GL_DOA_BACKUP_CHECK_DB_FIRST_V1", "/* " + MARKER + " */ /* MARKER_GL_DOA_BACKUP_CHECK_DB_FIRST_V1", 1) if MARKER not in s else s
for p, t in ((P, s), (C, c)):
    if not os.path.exists(p + ".bak_byacc"): shutil.copy2(p, p + ".bak_byacc")
    open(p, "w", encoding="utf-8", newline="").write(t)
print("OK")
