# -*- coding: utf-8 -*-
# Patch v2: Tax Invoice List (GL-TransferVat Tab 2) เป็นตารางกรอก/วางแบบ Excel จริง
#  - วางที่ช่องไหนก็ได้ -> ข้อมูลไหลลงตั้งแต่ช่องนั้น (ลงล่างตามแถว / ไปขวาตามคอลัมน์) | วางทีละคอลัมน์ได้ (TIV ทั้งแถว, วันที่ทั้งแถว, ยอดทั้งแถว)
#  - วางหลายคอลัมน์ (>=3) = จัดคอลัมน์ให้เอง (หาวันที่ / TIV / ตัวเลข 2 ช่อง สลับ Amount-Vat ได้)
#  - แถวที่ครบ (วันที่ + TIV + Amount) นับเป็นใบกำกับสดๆ ในยอดรวม/บันทึกได้เลย ไม่ต้อง Add | Branch ว่าง = Branch Dr. ต้นทาง
# apply บน VatController.js ที่มี taxgrid v1 อยู่แล้ว
# usage: python patch_vatcontroller_qagl_taxgrid_v2.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:80])
    txt = txt.replace(old, new)

# ---- 1) ตัด Helper + Handler เดิม (v1) ออก ----
h_start = txt.index("  const qaGlCl = (x) =>")
h_end = txt.index("  const handleQaGlPasteRows = async (e) => {")
p_end = txt.index("  const handleQaGlAdd = async () =>")
assert h_start < h_end < p_end
helpers = txt[h_start:h_end]
new_handlers = r"""  const QA_GL_GRID_COLS = ['date', 'tiv', 'br', 'g', 'v']; // MARKER_QA_GL_TAXGRID_V2
  const qaGlGridFit = (arr) => { // แถวพอดีจำนวนใบกำกับ: เหลือแถวว่างต่อท้ายแค่ 1 แถว (ขั้นต่ำ 3 แถว)
    let last = -1; arr.forEach((r, i) => { if (r.date || r.tiv || r.g || r.v) last = i; });
    const out = arr.slice(0, Math.max(last + 2, 3)); // เก็บแถวว่างเดิมไว้ (id คงที่ ไม่ให้ช่องที่โฟกัสอยู่หลุด)
    while (out.length < Math.max(last + 2, 3)) out.push(...qaGlMkGrid(1));
    return out;
  };
  const qaGlCleanCell = (col, x) => { const s2 = qaGlCl(x); if (!s2) return ''; if (col === 'date') { const iso = qaGlParseDateAny(s2); return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : s2; } if (col === 'g' || col === 'v') { const n = qaGlNm(s2); return n == null ? s2 : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } return s2; }; // จัด Format: ตัด ' / เวลา / พ.ศ.->ค.ศ. (วว/ดด/ปปปป) / ยอด 2 ตำแหน่ง มีคอมมา
  const qaGlSmartRec = (cells) => { // จัดคอลัมน์ให้เอง: หาวันที่ -> ที่เหลือช่องแรก = TIV -> ตัวเลข 2 ช่องถัดไป = Amount/Vat (สลับได้)
    const c = cells.map(qaGlCl); const di = c.findIndex(qaGlIsDateLike); const rest = c.filter((_, i) => i !== di);
    const nums = rest.slice(1).filter((x) => qaGlNm(x) != null);
    return { date: di >= 0 ? qaGlCleanCell('date', c[di]) : '', tiv: rest[0] || '', br: '', g: nums[0] ? qaGlCleanCell('g', nums[0]) : '', v: nums[1] ? qaGlCleanCell('v', nums[1]) : '' };
  };
  const qaGlClipMatrix = (e) => { const text = (e.clipboardData && e.clipboardData.getData('text')) || ''; if (!/[\t\r\n]/.test(text.replace(/[\r\n\t ]+$/, ''))) return null; const lines = text.replace(/\r/g, '').split('\n'); while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); return lines.map((l) => l.split('\t')); };
  const handleQaGlGridPaste = (e, rowId, colKey) => { // วางที่ช่องไหนก็ได้ -> ไหลลงตั้งแต่ช่องนั้น
    const matrix = qaGlClipMatrix(e); if (!matrix) return; // ค่าเดียว -> วางตามปกติ
    e.preventDefault(); e.stopPropagation();
    const width = Math.max(...matrix.map((r) => r.length));
    setQaGlGrid((prev) => {
      const idx = Math.max(0, prev.findIndex((x) => x.id === rowId)); const c0 = Math.max(0, QA_GL_GRID_COLS.indexOf(colKey));
      const next = prev.map((x) => ({ ...x })); const need = idx + matrix.length - next.length; if (need > 0) next.push(...qaGlMkGrid(need));
      matrix.forEach((cells, i) => {
        if (width >= 3) { if (!/\d/.test(cells.join(''))) return; const rec = qaGlSmartRec(cells); Object.assign(next[idx + i], rec); }
        else cells.forEach((v, j) => { const col = QA_GL_GRID_COLS[c0 + j]; if (col) next[idx + i][col] = qaGlCleanCell(col, v); });
      });
      return qaGlGridFit(next);
    });
  };
  const handleQaGlPasteRows = (e) => { // วางจาก Tab ① (ช่อง TIV / Amount) หรือที่กรอบ List: หลายคอลัมน์จัดให้เอง ต่อท้ายในตาราง
    const matrix = qaGlClipMatrix(e); if (!matrix) return;
    e.preventDefault(); e.stopPropagation();
    const recs = matrix.filter((cells) => /\d/.test(cells.join(''))).map(qaGlSmartRec);
    if (recs.length) setQaGlGrid((prev) => qaGlGridFit([...prev.filter((r) => r.date || r.tiv || r.g || r.v), ...recs.map((r, i) => ({ id: `gp${Date.now()}-${i}`, ...r }))]));
    setQaGlTab(2);
  };
  const qaGlGridSet = (id, k, val) => setQaGlGrid((prev) => qaGlGridFit(prev.map((x) => (x.id === id ? { ...x, [k]: val } : x))));
  const qaGlGridClearRow = (id) => setQaGlGrid((prev) => { return qaGlGridFit(prev.map((x) => (x.id === id ? { ...x, date: '', tiv: '', br: '', g: '', v: '' } : x))); });
"""
txt = txt[:h_start] + new_handlers + txt[p_end:]

rep("React.useState(() => qaGlMkGrid(6))", "React.useState(() => qaGlMkGrid(3))")
rep("setQaGlGrid(qaGlMkGrid(6))", "setQaGlGrid(qaGlMkGrid(3))")

# ---- 2) Helper ขึ้นไปก่อน qaGlAllItems (ใช้ในการคำนวณตอน Render) + Items จาก Grid ----
old_all = "  const qaGlAllItems = qaGlPendingItem ? [...qaGlTivList, qaGlPendingItem] : qaGlTivList;\n"
new_all = helpers + """  const qaGlGridItems = React.useMemo(() => { // แถวใน Grid ที่ครบ (วันที่ + TIV + Amount) = ใบกำกับ (ตัด TIV ซ้ำ: ตัวแรกชนะ)
    const seen = new Set(qaGlTivList.map((it) => it.tiv)); const out = [];
    qaGlGrid.forEach((r, i) => { const b = qaGlBuildItem(r, `g${i}`); if (!b.item || seen.has(b.item.tiv)) return; seen.add(b.item.tiv); out.push({ ...b.item, id: `grid-${r.id}` }); });
    return out;
  }, [qaGlGrid, qaGlTivList, qaGlBranchDr, qaGlBranchCr, qaGlCpcDr, qaGlAccDr, qaGlSubDr, qaGlCpcCr, qaGlAccCr, qaGlSubCr]); // eslint-disable-line react-hooks/exhaustive-deps
  const qaGlAllItems = React.useMemo(() => [...qaGlTivList, ...(qaGlPendingItem ? [qaGlPendingItem] : []), ...qaGlGridItems], [qaGlTivList, qaGlPendingItem, qaGlGridItems]); // MARKER_QA_GL_TAXGRID_V2
"""
rep(old_all, new_all)

# ---- 3) รายการ List: ไม่แสดงแถวที่มาจาก Grid ซ้ำ (แสดงในช่อง Grid แทน) ----
rep("                    {listGl.map((it, i) => (\n                      <tr key={it.id}>", "                    {listGl.map((it, i) => (String(it.id).startsWith('grid-') ? null : (\n                      <tr key={it.id}>")
# ปิดวงเล็บของ map ที่เพิ่ม: หาจุดจบ block เดิม ของ listGl.map ก่อน Grid
m_old = "                      </tr>\n                    ))}\n                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V1"
rep(m_old, "                      </tr>\n                    )))}\n                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V1")

# ---- 4) Grid JSX ใหม่ ----
g_start = txt.index("                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V1")
g_end_tok = "                    })}\n"
g_end = txt.index(g_end_tok, g_start) + len(g_end_tok)
new_grid = r"""                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V2
                      const itIdx = listGl.findIndex((x) => x.id === `grid-${gr.id}`); const ok = itIdx >= 0; const filled = !!(gr.date || gr.tiv || gr.g || gr.v);
                      const tivT = qaGlCl(gr.tiv); const tivDup = !!tivT && (qaGlTivList.some((it) => it.tiv === tivT) || qaGlGrid.findIndex((x) => qaGlCl(x.tiv) === tivT) !== gi);
                      const gIn = (k, ph, right, bad) => (<input value={gr[k]} placeholder={ph} onChange={(ev) => qaGlGridSet(gr.id, k, ev.target.value)} data-qagc={`${gi}-${k}`} onKeyDown={(ev) => { const d = ev.key === 'Enter' || ev.key === 'ArrowDown' ? 1 : (ev.key === 'ArrowUp' ? -1 : 0); if (!d) return; const el = document.querySelector(`[data-qagc="${gi + d}-${k}"]`); if (el) { ev.preventDefault(); el.focus(); } }} onPaste={(ev) => handleQaGlGridPaste(ev, gr.id, k)} onBlur={(ev) => { const cv = qaGlCleanCell(k, ev.target.value); if (cv !== gr[k]) setQaGlGrid((prev) => prev.map((x) => (x.id === gr.id ? { ...x, [k]: cv } : x))); }} title={bad ? 'TIV ซ้ำ' : undefined} style={{ width: '100%', boxSizing: 'border-box', height: '26px', fontSize: '12px', padding: '0 6px', border: bad ? '1px solid #e5484d' : (ok ? '1px solid #b7dfc0' : '1px solid #e1e6ec'), background: ok ? '#f1faf3' : '#f7fbff', borderRadius: '4px', outline: 'none', textAlign: right ? 'right' : 'left' }} />);
                      return (
                        <tr key={gr.id}>
                          <td style={{ ...tdS, textAlign: 'center', color: ok ? '#2e7d32' : '#bbb' }}>{ok ? itIdx + 1 : '·'}</td>
                          <td style={tdS}>{gIn('date', 'วว/ดด/ปปปป')}</td><td style={tdS}>{gIn('tiv', 'TIV number', false, tivDup)}</td>
                          <td style={{ ...tdS, color: ok ? '#1a3a5c' : '#bbb' }}>{ok ? (grnOfGl(itIdx) || '—') : '—'}{filled && <button type="button" title="ล้างแถวนี้" onClick={() => qaGlGridClearRow(gr.id)} style={{ marginLeft: '6px', border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer' }}>✕</button>}</td>
                          <td style={tdS}>{gIn('br', String(qaGlBranchDr || '') || 'auto')}</td><td style={tdS}>{gIn('g', 'Amount', true)}</td><td style={tdS}>{gIn('v', 'Vat (ว่าง = 7%)', true)}</td>
                        </tr>
                      );
                    })}
"""
txt = txt[:g_start] + new_grid + txt[g_end:]

# ---- 5) ข้อความ Empty State + เช็คแถวที่ไม่ครบก่อนบันทึก ----
rep("(ครบ วันที่ + TIV + Amount เข้า List อัตโนมัติ)", "(ครบ วันที่ + TIV + Amount นับเป็นใบกำกับทันที ไม่ต้อง Add | วางจากช่องไหนก็ได้)")
rep("    if (qaGlPendingMissing.length > 0) {\n      await confirmDialog.alert(`ข้อมูลใบกำกับภาษีที่กรอกไว้ยังไม่ครบ",
"""    const qaGlGridTouched = qaGlGrid.filter((r) => r.date || r.tiv || r.g || r.v).length; // MARKER_QA_GL_TAXGRID_V2
    if (qaGlGridTouched > qaGlGridItems.length) {
      await confirmDialog.alert(`ในตาราง Tax Invoice List มี ${qaGlGridTouched - qaGlGridItems.length} แถวที่ข้อมูลไม่ครบ (ต้องมี วันที่ + TIV + Amount) หรือ TIV ซ้ำ กรุณาแก้หรือกด ✕ ล้างแถวนั้นก่อน`, { title: 'ข้อมูลใบกำกับไม่ครบ', variant: 'danger' });
      return;
    }
    if (qaGlPendingMissing.length > 0) {
      await confirmDialog.alert(`ข้อมูลใบกำกับภาษีที่กรอกไว้ยังไม่ครบ""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
