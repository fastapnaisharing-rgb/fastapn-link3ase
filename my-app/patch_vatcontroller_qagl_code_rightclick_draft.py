# -*- coding: utf-8 -*-
# Patch: GL-TransferVat ช่อง Code -- คลิกขวา = แสดงรายชื่อ Vendor ที่อยู่ใน Draft Monitor (Upload Simple, status=draft ของ BU นี้) เลือกแล้วดึง Code (supplier_code) มาใส่
# usage: python patch_vatcontroller_qagl_code_rightclick_draft.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:80])
    txt = txt.replace(old, new)

rep("  const qaGlGridRef = React.useRef(qaGlGrid); qaGlGridRef.current = qaGlGrid;\n",
"""  const qaGlGridRef = React.useRef(qaGlGrid); qaGlGridRef.current = qaGlGrid;
  const [qaGlDrMenu, setQaGlDrMenu] = React.useState(null); // MARKER_QA_GL_CODE_RIGHTCLICK_DRAFT_V1 -- { x, y } | null
  const [qaGlDrRows, setQaGlDrRows] = React.useState([]);
  const [qaGlDrLoading, setQaGlDrLoading] = React.useState(false);
  const [qaGlDrQ, setQaGlDrQ] = React.useState('');
""")

rep("  const qaGlCl = (x) =>",
"""  const qaGlOpenDraftMenu = (ev) => { // คลิกขวาที่ช่อง Code -> ดึงรายชื่อ Vendor จาก Draft Monitor (Upload Simple) ของ BU นี้
    ev.preventDefault();
    const x = Math.min(ev.clientX, window.innerWidth - 380); const y = Math.min(ev.clientY, window.innerHeight - 360);
    setQaGlDrMenu({ x: Math.max(8, x), y: Math.max(8, y) }); setQaGlDrQ(''); setQaGlDrLoading(true);
    apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu?.bu || '')}&in_status=draft,pre-draft,ovp-draft,fu-draft`)
      .then((res) => {
        const m = new Map();
        (Array.isArray(res) ? res : []).forEach((r) => {
          const code = String(r.supplier_code || '').trim(); const nm0 = String(r.supplier_name || '').trim(); const key = code || `name:${nm0}`; if (!code && !nm0) return;
          const cur = m.get(key) || { code, name: nm0, n: 0 };
          if (!cur.name) cur.name = nm0;
          cur.n += 1; m.set(key, cur);
        });
        setQaGlDrRows([...m.values()].sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code)));
      })
      .catch(() => setQaGlDrRows([]))
      .finally(() => setQaGlDrLoading(false));
  };
  const qaGlCl = (x) =>""")

rep("<input type=\"text\" value={qaGlSupplierCode} onChange={(e) => setQaGlSupplierCode(e.target.value)} style=",
    "<input type=\"text\" value={qaGlSupplierCode} onChange={(e) => setQaGlSupplierCode(e.target.value)} onContextMenu={qaGlOpenDraftMenu} title=\"คลิกขวา = เลือก Vendor จาก Draft Monitor\" style=")

# Popup: วางต่อท้ายปุ่มค้นหาใน Field Code (position: fixed)
rep("""                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle>""",
"""                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle>""")
anchor = "                    </div>\n                  </div>\n                  <div style={{ flex: '13 1 0%', minWidth: 0 }}>\n                    <label style={lblS}>Tax invoice Date</label>"
rep(anchor,
"""                      {qaGlDrMenu && (<>{/* MARKER_QA_GL_CODE_RIGHTCLICK_DRAFT_V1 */}
                        <div onClick={() => setQaGlDrMenu(null)} onContextMenu={(ev) => { ev.preventDefault(); setQaGlDrMenu(null); }} style={{ position: 'fixed', inset: 0, zIndex: 2600 }} />
                        <div style={{ position: 'fixed', left: qaGlDrMenu.x, top: qaGlDrMenu.y, width: '370px', maxHeight: '340px', display: 'flex', flexDirection: 'column', background: 'white', border: '1px solid #cfd8e3', borderRadius: '10px', boxShadow: '0 8px 24px rgba(16,24,40,0.22)', zIndex: 2601, overflow: 'hidden' }}>
                          <div style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: 500 }}>Vendor จาก Draft Monitor <span style={{ opacity: 0.75, fontWeight: 400 }}>({qaGlDrRows.length})</span></div>
                          <input autoFocus value={qaGlDrQ} onChange={(ev) => setQaGlDrQ(ev.target.value)} placeholder="ค้นหาชื่อ / Code" onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); setQaGlDrMenu(null); } }} style={{ margin: '6px', height: '28px', fontSize: '12px', padding: '0 8px', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none' }} />
                          <div style={{ overflowY: 'auto', flex: 1 }}>
                            {qaGlDrLoading && <div style={{ padding: '14px', textAlign: 'center', color: '#999', fontSize: '12px' }}>กำลังโหลด...</div>}
                            {!qaGlDrLoading && qaGlDrRows.length === 0 && <div style={{ padding: '14px', textAlign: 'center', color: '#999', fontSize: '12px' }}>ไม่มี Vendor ใน Draft Monitor ของ BU นี้ (draft / pre-draft)</div>}
                            {!qaGlDrLoading && qaGlDrRows.filter((r) => { const q = qaGlDrQ.trim().toLowerCase(); return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q); }).map((r) => (
                              <div key={r.code || `n:${r.name}`} title={r.code ? '' : 'รายการนี้ใน Draft ไม่มี Supplier Code'} onClick={() => { if (!r.code) return; setQaGlSupplierCode(r.code); setQaGlDrMenu(null); }} onMouseEnter={(ev) => { ev.currentTarget.style.background = '#eaf3fb'; }} onMouseLeave={(ev) => { ev.currentTarget.style.background = 'white'; }} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer', borderTop: '0.5px solid #f0f0f0', background: 'white' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '(ไม่มีชื่อ)'}</span>
                                <span style={{ color: '#1a3a5c', fontWeight: 500, flexShrink: 0 }}>{r.code || '(ไม่มี Code)'}{r.n > 1 && <span style={{ marginLeft: '6px', color: '#999', fontWeight: 400 }}>×{r.n}</span>}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>)}
""" + anchor)
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
