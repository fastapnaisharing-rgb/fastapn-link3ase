# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- แถว Detail ของงวดปัจจุบันที่ Transaction Date ต่ำกว่างวด (Below) => มีชื่อไฟล์ + Connect ได้เลย (ไม่ต้องมีไฟล์ Backup จริง)
 - belowByAcc: จัดกลุ่มแถว Detail ปัจจุบันที่วันที่ < งวด ต่อ Account
 - คอลัมน์ Filename: Account ที่มีแถว Below => ✓ BU_Account_<M-1>_Backup (ชื่อจำลอง) แทน 'ไม่พบ Backup'
 - Connect / Connect ทั้งหมด: Account ที่ไม่มีไฟล์ Backup แต่มีแถว Below => Connect ได้ + ตั้งแถว Below ที่ยังเป็น Pending เป็น Include ใน DB
Run จากโฟลเดอร์ my-app:  python patch_doa_below_rows_connect_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_BELOW_ROWS_CONNECT_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_below_conn_v1')
def rep(old, new, cnt=1):
    global s
    assert s.count(old) == cnt, ('not unique/found', old[:90], s.count(old))
    s = s.replace(old, new)

# 1) helpers (belowByAcc / hasInc / incCnt / stampBelow) ต่อท้าย bkIcon
rep("/* MARKER_GL_DOA_CONNECT_ICON_V1 */",
"""/* MARKER_GL_DOA_CONNECT_ICON_V1 */ /* MARKER_GL_DOA_BELOW_ROWS_CONNECT_V1 */
  const belowByAcc = React.useMemo(() => { const m = new Map(); try { splitByPeriod(detailRows(detMatrix), period).below.forEach(o => { const c = String(o.account_code); if (!m.has(c)) m.set(c, []); m.get(c).push(o); }); } catch (e) { /* ignore */ } return m; }, [detMatrix, period]);
  const hasInc = (c) => (incByAcc.get(String(c)) || 0) > 0 || belowByAcc.has(String(c));
  const incCnt = (c) => Math.max(incByAcc.get(String(c)) || 0, (belowByAcc.get(String(c)) || []).length);
  const stampBelow = async (codes) => { /* Connect: แถว Below (Transaction Date < งวด) ที่ยังเป็น Pending => Include ใน DB */
    const rs = []; codes.forEach(c => (belowByAcc.get(String(c)) || []).forEach(o => { const k = detKey(o); if (!clrKeys.has(k) && !incKeys.has(k)) rs.push(o); })); if (!rs.length || !bu || !period) return 0;
    await saveDoaClear(bu, period, rs.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rs.forEach(o => nx.add(detKey(o))); return nx; }); setDbTick(t => t + 1); return rs.length; };""")

# 2) แสดงผลคอลัมน์ Filename
s = s.replace("incByAcc.get(String(a.code)) > 0", "hasInc(String(a.code))")
s = s.replace("${incByAcc.get(String(a.code))}", "${incCnt(String(a.code))}")

# 3) Connect ราย Account: ไม่มีไฟล์ Backup แต่มีแถว Below => Connect + Include
rep("""    bkSet(code, { conn: 'busy' }); setDbMsg('');
    try {
      let it = bkFiles;""",
"""    bkSet(code, { conn: 'busy' }); setDbMsg('');
    if (belowByAcc.has(String(code)) && !(bkHave && bkHave.has(String(code)))) { /* แถว Below ใน Detail งวดนี้ = Connect ได้เลย ไม่ต้องมีไฟล์ Backup จริง */
      try { const n = await stampBelow([code]); bkSet(code, { conn: 'on', sel: '' }); if (n) setDbMsg(`✓ Connect: ตั้ง Include ${n} แถว (Transaction Date ต่ำกว่า ${period})`); } catch (e) { bkSet(code, { conn: 'off' }); setDbMsg('Connect ไม่สำเร็จ: ' + e.message); }
      return;
    }
    try {
      let it = bkFiles;""")

# 4) Connect ทั้งหมด
rep("n[c] = (bkHave && !bkHave.has(String(c))) ? { conn: 'empty', sel: '' } : { conn: 'on', sel: d1 ? String(d1.id) : '' };",
    "n[c] = (bkHave && !bkHave.has(String(c)) && !belowByAcc.has(String(c))) ? { conn: 'empty', sel: '' } : { conn: 'on', sel: d1 ? String(d1.id) : '' };")
rep("for (const k of Object.keys(grp)) await carryM1(grp[k].d0, grp[k].cs); }",
    "for (const k of Object.keys(grp)) await carryM1(grp[k].d0, grp[k].cs); } try { const nb = await stampBelow(codes.filter(c => belowByAcc.has(String(c)) && !(bkHave && bkHave.has(String(c))))); if (nb) setDbMsg(`✓ Connect: ตั้ง Include ${nb} แถว (Transaction Date ต่ำกว่า ${period})`); } catch (e) { /* ไม่กระทบ */ }")

# 5) Connect ทั้งหมด: ไม่มีไฟล์ Backup เลยแต่มีแถว Below ต้องไม่หยุดที่ 'empty'
rep("if (!it.length) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropAcc(''); setDropPop(true); return; }",
    "if (!it.length && !codes.some(c => belowByAcc.has(String(c)))) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropAcc(''); setDropPop(true); return; }")
# 6) Account ที่ Connect แล้วและมีแค่แถว Below (ไม่มีไฟล์จริง) แสดงชื่อ ไม่ใช่ Dropdown
rep("(bkFiles.length ? (", "((bkFiles.length && !(belowByAcc.has(String(a.code)) && !(bkHave && bkHave.has(String(a.code))))) ? (")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
