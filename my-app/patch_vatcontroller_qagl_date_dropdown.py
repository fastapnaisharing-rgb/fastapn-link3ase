# -*- coding: utf-8 -*-
# patch: ช่อง Tax invoice Date (GL-TransferVat Tab 1) คลิกขวา/ลูกศรลง -> Dropdown วันที่ใบกำกับของ Vendor นี้ใน Draft Monitor
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)
rep("  const [qaGlDrQ, setQaGlDrQ] = React.useState('');",
"""  const [qaGlDrQ, setQaGlDrQ] = React.useState('');
  const [qaGlDrRaw, setQaGlDrRaw] = React.useState([]); // MARKER_QA_GL_DATE_DROPDOWN_V1 -- แถว Draft ดิบ (ใช้หาวันที่ของ Vendor)
  const [qaGlDtMenu, setQaGlDtMenu] = React.useState(false);""")
rep("""      .then((res) => {
        const m = new Map();
        (Array.isArray(res) ? res : []).forEach((r) => {""",
"""      .then((res) => {
        setQaGlDrRaw(Array.isArray(res) ? res : []);
        const m = new Map();
        (Array.isArray(res) ? res : []).forEach((r) => {""")
rep("  const qaGlOpenDraftMenu = (ev) => {",
"""  const qaGlDraftDates = () => { // วันที่ใบกำกับใน Draft ของ Vendor ที่เลือกอยู่ (จับคู่ด้วย sm_code / Tax ID+สาขา / ชื่อ) พร้อมจำนวนใบ
    const sup = qaGlSupplier; if (!sup) return null;
    const code = String(sup['SM-Code'] || '').trim().toLowerCase(); const tx = String(sup['Tax ID'] || '').trim(); const br = String(sup['Branch'] || '').trim();
    const nm = [sup['Company Name'], sup['Thai Company Name'], sup['Supplier Name']].map((v) => String(v || '').replace(/\\s+/g, '').toLowerCase()).filter(Boolean);
    const m = new Map();
    (qaGlDrRaw || []).forEach((r) => {
      const hit = (String(r.sm_code || '').trim().toLowerCase() === code) || (tx && String(r.tax_id || '').trim() === tx && (!br || !String(r.branch_no || '').trim() || String(r.branch_no || '').trim() === br)) || (nm.length && nm.includes(String(r.supplier_name || '').replace(/\\s+/g, '').toLowerCase()));
      if (!hit) return;
      const txt = formatQuickActionReceiveDateText(r.tax_invoice_date) || ''; if (!txt) return;
      const mm = /^(\\d{1,2})-([A-Za-z]{3})-(\\d{2,4})$/.exec(txt); const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      let iso = ''; if (mm && MON[mm[2].toLowerCase()]) { const y = Number(mm[3]) < 100 ? 2000 + Number(mm[3]) : Number(mm[3]); iso = `${y}-${String(MON[mm[2].toLowerCase()]).padStart(2, '0')}-${String(mm[1]).padStart(2, '0')}`; } else { iso = qaGlParseDateAny(txt) || ''; }
      const cur = m.get(txt) || { txt, iso, n: 0 }; cur.n += 1; m.set(txt, cur);
    });
    return [...m.values()].sort((a, b) => String(b.iso).localeCompare(String(a.iso)));
  };
  const qaGlOpenDateMenu = (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    setQaGlDtMenu(true);
    if (!qaGlDrRaw.length) apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu?.bu || '')}&in_status=draft,pre-draft,ovp-draft,fu-draft`).then((res) => setQaGlDrRaw(Array.isArray(res) ? res : [])).catch(() => {});
  };
  const qaGlOpenDraftMenu = (ev) => {""")
rep("""                      <input key={`qgd${qaGlFormKey}`} type="text" defaultValue={formatDateDisplayMDY(qaGlDate)} placeholder="MM/DD/YYYY"
""",
"""                      <input key={`qgd${qaGlFormKey}`} type="text" defaultValue={formatDateDisplayMDY(qaGlDate)} placeholder="MM/DD/YYYY" onContextMenu={qaGlOpenDateMenu} title="คลิกขวา / ลูกศรลง = วันที่ใบกำกับของ Vendor นี้ใน Draft Monitor"
                        onKeyDown={(ev) => { if (ev.key === 'ArrowDown' && !qaGlDtMenu) { qaGlOpenDateMenu(ev); } else if (ev.key === 'Escape' && qaGlDtMenu) { ev.stopPropagation(); ev.preventDefault(); setQaGlDtMenu(false); } }}
""")
rep("""                      <input key={`qgp${qaGlFormKey}`} type="date" tabIndex={-1} value={qaGlDate || ''}""",
"""                      {qaGlDtMenu && (() => { const L = qaGlDraftDates(); return (<>
                        <div onClick={() => setQaGlDtMenu(false)} onContextMenu={(ev) => { ev.preventDefault(); setQaGlDtMenu(false); }} style={{ position: 'fixed', inset: 0, zIndex: 2600 }} />
                        <div style={{ position: 'absolute', left: 0, top: '100%', marginTop: '2px', minWidth: '210px', maxHeight: '240px', overflowY: 'auto', background: 'white', border: '1px solid #cfd8e3', borderRadius: '8px', boxShadow: '0 8px 24px rgba(16,24,40,0.22)', zIndex: 2601 }}>
                          {L === null && <div style={{ padding: '12px', fontSize: '12px', color: '#999' }}>เลือก Code ก่อน เพื่อดูวันที่ของรายนี้</div>}
                          {L && L.length === 0 && <div style={{ padding: '12px', fontSize: '12px', color: '#999' }}>ไม่พบวันที่ของ Vendor นี้ใน Draft Monitor</div>}
                          {L && L.map((d) => (
                            <div key={d.txt} onClick={() => { if (d.iso) { setQaGlDate(d.iso); setQaGlFormKey((k) => k + 1); } setQaGlDtMenu(false); }} onMouseEnter={(ev) => { ev.currentTarget.style.background = '#eaf3fb'; }} onMouseLeave={(ev) => { ev.currentTarget.style.background = 'white'; }} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer', borderTop: '0.5px solid #f0f0f0', background: 'white' }}>
                              <span style={{ color: '#1a3a5c', fontWeight: 500 }}>{d.txt}</span><span style={{ color: '#999' }}>{d.n} ใบ</span>
                            </div>
                          ))}
                        </div>
                      </>); })()}
                      <input key={`qgp${qaGlFormKey}`} type="date" tabIndex={-1} value={qaGlDate || ''}""")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
