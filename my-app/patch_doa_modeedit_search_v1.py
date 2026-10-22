# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Mode Edit (Preview Detail): เพิ่มช่อง Search ในพื้นที่เครื่องมือด้านบน
 - ค้นได้ทุกคอลัมน์ (วันที่ทั้งแบบ 30-Sep-26 / ยอดเงินมี-ไม่มี comma / Status Include-Pending) หลายคำ = AND
 - กรองเฉพาะการแสดงผล ไม่กระทบข้อมูล / ลำดับ / การติ๊กเลือก
 - ช่องติ๊กหัวตาราง (เลือกทั้งหมด) เลือกเฉพาะแถวที่ค้นเจอ
Run จากโฟลเดอร์ my-app:  python patch_doa_modeedit_search_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_MODEEDIT_SEARCH_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_search_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:90], s.count(old))
    s = s.replace(old, new)

# 1) DoaDetSheet: รับ prop q + หา index แถวที่ตรง
rep("function DoaDetSheet({ matrix, code, only, ctx, sel, onTog, onAll, totals, stat, incKeys })",
    "function DoaDetSheet({ matrix, code, only, ctx, sel, onTog, onAll, totals, stat, incKeys, q })")
rep("  const fb = totals ?",
"""  const qm = React.useMemo(() => { /* MARKER_GL_DOA_MODEEDIT_SEARCH_V1 -- Search ใน Mode Edit */
    const t = String(q || '').toLowerCase().replace(/,/g, '').split(/\\s+/).filter(Boolean); if (!t.length || !sel) return null; const set = new Set();
    objs.forEach((o, i) => { const d = detDate(o.txn_date); const hay = [Object.values(o).join(' '), d ? fmtD(d) : '', Number(o.amount || 0).toFixed(2), stX ? stX[i] : ''].join(' ').toLowerCase().replace(/,/g, ''); if (t.every(x => hay.includes(x))) set.add(i); });
    return set; }, [q, objs, sel, stX]); // eslint-disable-line react-hooks/exhaustive-deps
  const visKeys = qm ? okeys.filter((k, i) => qm.has(i)) : okeys; const allVis = !!sel && visKeys.length > 0 && visKeys.every(k => sel.has(k));
  const fb = totals ?""")
rep("checked={allOn} onChange={() => onAll && onAll(okeys, !allOn)}",
    "checked={allVis} onChange={() => onAll && onAll(visKeys, !allVis)}")
rep("body.slice(0, LIM).map((r, i) => ({ r, i }))",
    "(qm ? body.map((r, i) => ({ r, i })).filter(e => qm.has(e.i)) : body.map((r, i) => ({ r, i }))).slice(0, LIM)")

# 2) Modal: state q + ส่งเข้า Sheet + ช่อง Search ในพื้นที่เครื่องมือ
rep("const [selK, setSelK] = React.useState(() => new Set());",
    "const [selK, setSelK] = React.useState(() => new Set()); const [q, setQ] = React.useState('');")
rep("incKeys={embed ? undefined : incKeys} />", "incKeys={embed ? undefined : incKeys} q={pageMode ? q : ''} />")
rep("<div style={{ fontSize: 12, color: '#8A94A6' }}>เครื่องมือ (พื้นที่เผื่อไว้)</div></div>}",
    "<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input value={q} onChange={e => setQ(e.target.value)} placeholder=\"🔍 ค้นหา Journal / Description / Invoice / Vendor / Amount / วันที่ / Status …\" style={{ width: 460, height: 32, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 10px', fontSize: 13 }} />{q ? <button type=\"button\" onClick={() => setQ('')} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 32, padding: '0 12px', cursor: 'pointer' }}>ล้าง</button> : null}</div><div style={{ fontSize: 12, color: '#8A94A6', marginTop: 8 }}>เครื่องมือ (พื้นที่เผื่อไว้)</div></div>}")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
