# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- เพิ่มช่อง Search ใน Popup ประวัติ Auto Clear / Clear
- ค้นได้ทุกคอลัมน์ (หลายคำ = AND, ไม่สนตัวพิมพ์, ตัด comma ใน Amount)
- Select All เลือกเฉพาะแถวที่ค้นเจอ
- ไม่ได้ติ๊ก + มีคำค้น => กลับเป็น Pending เฉพาะแถวที่ค้นเจอ (ไม่ใช่ทั้ง Account)
Run จากโฟลเดอร์ my-app:  python patch_doa_clrhist_search_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_CLRHIST_SEARCH_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_clrhist_search_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:70], s.count(old))
    s = s.replace(old, new)

rep("const [clrHist, setClrHist] = React.useState(null);",
"""const clrFilt = (h) => { const it = (h && h.items) || []; const q = String((h && h.q) || '').toLowerCase().replace(/,/g, '').split(/\\s+/).filter(Boolean); if (!q.length) return it; return it.filter(x => { const r = x.row || {}; const hay = [x.status === 'Pending' || x.status === 'Cleared' ? 'clear' : x.status, r.branch_code, r.cost_center, r.txn_date, r.journal_name, r.invoice_no, r.description, r.amount, Number(r.amount || 0).toFixed(2), x.cleared_by, x.cleared_at ? new Date(x.cleared_at).toLocaleString('th-TH') : ''].map(v => String(v == null ? '' : v)).join(' ').toLowerCase().replace(/,/g, ''); return q.every(t => hay.includes(t)); }); }; /* MARKER_GL_DOA_CLRHIST_SEARCH_V1 */ const [clrHist, setClrHist] = React.useState(null);""")

rep("เพื่อคืนแถวกลับมาแสดงใน Detail</span></div>",
"เพื่อคืนแถวกลับมาแสดงใน Detail</span><input value={clrHist.q || ''} onChange={e => { const v = e.target.value; setClrHist(h0 => ({ ...h0, q: v })); }} placeholder=\"🔍 ค้นหา Journal / Description / Invoice / Amount / CPC …\" autoFocus style={{ marginLeft: 'auto', width: 360, height: 30, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 10px', fontSize: 13 }} />{clrHist.q ? <button type=\"button\" onClick={() => setClrHist(h0 => ({ ...h0, q: '' }))} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 30, padding: '0 10px', cursor: 'pointer' }}>ล้าง</button> : null}</div>")

rep("{clrHist.items.length} แถวที่ Clear (Auto Clear",
    "{clrFilt(clrHist).length === clrHist.items.length ? clrHist.items.length : `${clrFilt(clrHist).length} / ${clrHist.items.length}`} แถวที่ Clear (Auto Clear")

rep("checked={clrHist.sel.size > 0 && clrHist.sel.size === clrHist.items.length} onChange={e => setClrHist(h0 => ({ ...h0, sel: e.target.checked ? new Set(h0.items.map(x => x.row_key)) : new Set() }))}",
    "checked={clrFilt(clrHist).length > 0 && clrFilt(clrHist).every(x => clrHist.sel.has(x.row_key))} onChange={e => setClrHist(h0 => { const fk = clrFilt(h0).map(x => x.row_key); return { ...h0, sel: e.target.checked ? new Set([...h0.sel, ...fk]) : new Set([...h0.sel].filter(k => !fk.includes(k))) }; })}")

rep("<tbody>{clrHist.items.map(x => { const r = x.row || {};", "<tbody>{clrFilt(clrHist).map(x => { const r = x.row || {};")

rep("toLocaleString('th-TH') : ''}</td></tr>); })}</tbody>",
    "toLocaleString('th-TH') : ''}</td></tr>); })}{!clrFilt(clrHist).length && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#6B778C' }}>ไม่พบรายการที่ตรงกับคำค้น</td></tr>}</tbody>")

rep("{clrHist.sel.size ? `เลือก ${clrHist.sel.size} แถว` : 'ไม่ได้เลือก = RVS ทั้งหมดของ Account นี้'}",
    "{clrHist.sel.size ? `เลือก ${clrHist.sel.size} แถว` : (clrHist.q ? `ไม่ได้เลือก = RVS เฉพาะ ${clrFilt(clrHist).length} แถวที่ค้นหา` : 'ไม่ได้เลือก = RVS ทั้งหมดของ Account นี้')}")

rep("disabled={!clrHist.items.length || rvsBusy === clrHist.code} onClick={() => reverseClearAcc([...clrHist.sel])}",
    "disabled={!clrHist.items.length || rvsBusy === clrHist.code || (!!clrHist.q && !clrHist.sel.size && !clrFilt(clrHist).length)} onClick={() => reverseClearAcc(clrHist.sel.size ? [...clrHist.sel] : (clrHist.q ? clrFilt(clrHist).map(x => x.row_key) : []))}")

rep("{clrHist.sel.size ? 'กลับเป็น Pending (ที่เลือก)' : 'กลับเป็น Pending (ทั้งหมด)'}",
    "{clrHist.sel.size ? 'กลับเป็น Pending (ที่เลือก)' : (clrHist.q ? 'กลับเป็น Pending (ที่ค้นหา)' : 'กลับเป็น Pending (ทั้งหมด)')}")

open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
