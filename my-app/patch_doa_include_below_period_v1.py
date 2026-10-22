# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Include = Account (BU + Account) มีใน Backup ของงวดใดก็ได้ที่ต่ำกว่างวดปัจจุบัน
 - เดิมเช็คจากไฟล์เดียว (M-1 หรือล่าสุด)  -> ใหม่เช็คทุกไฟล์ Backup Detail ของ BU ที่ period < งวดปัจจุบัน (ล่าสุด 12 ไฟล์)
 - แต่ละ Account ผูกกับไฟล์ที่ใหม่ที่สุดที่มี Account นั้น -> ชื่อ REV_<Account>_<MM.YYYY>_Backup
 - Connect: เลือกไฟล์ของ Account นั้นให้เอง + ดึงแถวเข้า Detail งวดปัจจุบัน (carryM1 แยกตามไฟล์)
Run จากโฟลเดอร์ my-app:  python patch_doa_include_below_period_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_include_below_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:80], s.count(old))
    s = s.replace(old, new)

# 1) state + helper
rep("const [bkHavePer, setBkHavePer] = React.useState('');",
    "const [bkHaveMap, setBkHaveMap] = React.useState({}); const bkDefFor = (it, code) => { const hv = bkHaveMap[String(code)]; return (hv && it.find(x => String(x.id) === String(hv.id))) || it.find(x => x.period === prevPeriod) || null; }; /* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */")

# 2) precheck: ทุกไฟล์ที่ period < งวดปัจจุบัน
rep("""        const t = it.find(x => x.period === prevPeriod) || it[0];
        if (!t) { if (!off) setBkHave(new Set()); return; }
        const d = await getDoaBackup(t.id); const have = new Set(detailRows(Array.isArray(d && d.data) ? d.data : []).map(o => String(o.account_code)));
        if (!off) { setBkHavePer(t.period); setBkHave(have); }""",
"""        const files = it.slice(0, 12);
        if (!files.length) { if (!off) { setBkHaveMap({}); setBkHave(new Set()); } return; }
        const ds = await Promise.all(files.map(f => getDoaBackup(f.id).then(d => ({ f, d })).catch(() => null)));
        const mp = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period }; }); });
        if (!off) { setBkHaveMap(mp); setBkHave(new Set(Object.keys(mp))); }""")

# 3) Connect ราย Account
rep("""      const def = it.find(x => x.period === prevPeriod) || null;
      bkSet(code, { conn: 'on', sel: def ? String(def.id) : '' }); await carryM1(def, [code]);""",
"""      const def = bkDefFor(it, code);
      bkSet(code, { conn: 'on', sel: def ? String(def.id) : '' }); await carryM1(def, [code]);""")

# 4) Connect ทั้งหมด (แยกตามไฟล์ของแต่ละ Account)
rep("""      const def = it.find(x => x.period === prevPeriod) || null;
      setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn !== 'on') n[c] = (bkHave && !bkHave.has(String(c))) ? { conn: 'empty', sel: '' } : { conn: 'on', sel: def ? String(def.id) : '' }; }); return n; }); await carryM1(def, codes.filter(c => !(bkHave && !bkHave.has(String(c)))));""",
"""      setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn !== 'on') { const d1 = bkDefFor(it, c); n[c] = (bkHave && !bkHave.has(String(c))) ? { conn: 'empty', sel: '' } : { conn: 'on', sel: d1 ? String(d1.id) : '' }; } }); return n; });
      { const grp = {}; codes.filter(c => !(bkHave && !bkHave.has(String(c)))).forEach(c => { const d0 = bkDefFor(it, c); const k = d0 ? String(d0.id) : ''; (grp[k] = grp[k] || { d0, cs: [] }).cs.push(c); }); for (const k of Object.keys(grp)) await carryM1(grp[k].d0, grp[k].cs); }""")

# 5) แสดงผลคอลัมน์ Filename
rep("{bkHavePer ? '✓ ' + bkLbl(a.code, bkHavePer) : '-'}",
    "{bkHaveMap[String(a.code)] ? '✓ ' + bkLbl(a.code, bkHaveMap[String(a.code)].period) : '-'}")
rep("ไม่พบ Backup {prevPerOf(period) || ''}{/* MARKER_GL_DOA_BACKUP_ONELINE_V1 */}",
    "ไม่พบ Backup ก่อน {period}{/* MARKER_GL_DOA_BACKUP_ONELINE_V1 */}")
rep("title={`ไม่มี Backup ของงวดก่อน (${prevPerOf(period) || '-'}) ใน DB สำหรับ Account นี้",
    "title={`ไม่มี Backup ของงวดที่ต่ำกว่า ${period} ใน DB สำหรับ BU + Account นี้")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
