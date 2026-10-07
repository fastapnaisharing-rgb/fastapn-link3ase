# -*- coding: utf-8 -*-
# Patch: GL-TransferVat Tab 2 -- Tax Invoice List รับกรอก/วางแบบ Excel (ตารางช่องว่างใต้รายการ) ใช้ Data จากตรงนี้ได้เลยโดยไม่ต้อง Add
#  - แถวกรอกครบ (วันที่ + TIV + Amount) -> ย้ายเข้า List อัตโนมัติเมื่อออกจากแถว | Branch ว่าง -> ใช้ Branch Dr. ต้นทางจาก Tab 1
#  - วางหลายแถว/หลายช่องที่ไหนก็ได้ (ไม่สนลำดับคอลัมน์: หาวันที่เอง, TIV = ช่องแรกที่เหลือ, เลข 2 ช่อง = Amount/Vat สลับได้)
# usage: python patch_vatcontroller_qagl_taxgrid.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')

def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:70])
    txt = txt.replace(old, new)

# 1) State
rep("  const [qaGlAmtType, setQaGlAmtType] = React.useState('GRO+VT');\n",
"""  const [qaGlAmtType, setQaGlAmtType] = React.useState('GRO+VT');
  const qaGlMkGrid = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`, date: '', tiv: '', br: '', g: '', v: '' })); // MARKER_QA_GL_TAXGRID_V1 -- แถวกรอก/วางแบบ Excel ใน Tax Invoice List
  const [qaGlGrid, setQaGlGrid] = React.useState(() => qaGlMkGrid(6));
  const qaGlGridRef = React.useRef(qaGlGrid); qaGlGridRef.current = qaGlGrid;
""")

# 2) Reset ตอนเปิด Popup
rep("setQaGlTivList([]); setQaGlAmt(''); setQaGlAmtType('GRO+VT');", "setQaGlTivList([]); setQaGlGrid(qaGlMkGrid(6)); setQaGlAmt(''); setQaGlAmtType('GRO+VT');")

# 3) แทน Handler วางเดิมทั้งก้อน
s = txt.index("  const handleQaGlPasteRows = async (e) => {")
e = txt.index("  const handleQaGlAdd = async () =>")
new_handler = r"""  const qaGlCl = (x) => String(x == null ? '' : x).replace(/^\s*'/, '').replace(/\s+/g, ' ').trim();
  const qaGlNm = (x) => { const s2 = qaGlCl(x).replace(/,/g, ''); return /^-?\d+(\.\d+)?$/.test(s2) ? parseFloat(s2) : null; };
  const qaGlIsDateLike = (x) => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(qaGlCl(x)) || /^\d{4}-\d{2}-\d{2}/.test(qaGlCl(x));
  const qaGlParseDateAny = (x) => { const s2 = qaGlCl(x); if (/^\d{4}-\d{2}-\d{2}/.test(s2)) { let y = +s2.slice(0, 4); if (y > 2400) y -= 543; return `${y}${s2.slice(4, 10)}`; } return amagnoParseDate(s2); };
  const qaGlBuildItem = (r, seq) => { // MARKER_QA_GL_TAXGRID_V1 -- แปลงแถวข้อความ -> ใบกำกับ (ตัด ' / ปัดทศนิยม / จัดสลับ Amount-Vat / Branch ว่างใช้ Dr. ต้นทาง)
    const date = qaGlParseDateAny(r.date); const tiv = qaGlCl(r.tiv); const n1 = qaGlNm(r.g); const n2 = qaGlNm(r.v);
    if (!tiv || !date || !(n1 > 0)) return { err: true };
    let g; let v; let warn = false;
    if (n2 != null && n2 > 0) {
      const a = vatTaxNormalizeAmounts({ gross_value: n1, vat_value: n2 });
      if (a.suspicious) { g = roundMoney2(Math.max(n1, n2)); v = roundMoney2(Math.min(n1, n2)); warn = true; } else { g = roundMoney2(a.amount); v = roundMoney2(a.vat); }
    } else { const sp = qaGlSplitAmt('GRO+VT', n1); g = sp.g; v = sp.v; }
    const brDr = qaGlCl(r.br) || String(qaGlBranchDr || '').trim(); const brCr = String(qaGlBranchCr || '').trim() || brDr;
    return { warn, item: { id: `${Date.now()}-${seq}`, pending: false, date, tiv, type: 'GRO+VT', g, v, brDr, brCr, cpcDr: qaGlCpcDr, accDr: qaGlAccDr, subDr: qaGlSubDr, cpcCr: qaGlCpcCr, accCr: qaGlAccCr, subCr: qaGlSubCr } };
  };
  const handleQaGlPasteRows = async (e) => { // MARKER_QA_GL_PASTE_EXCEL_V1 -- วางหลายแถวจาก Excel (ไม่สนลำดับคอลัมน์): ครบ -> เข้า List เลย / ไม่ครบ -> ลงช่องกรอกให้แก้ต่อ
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!/[\t\r\n]/.test(text.trim())) return; // วางค่าเดียวธรรมดา -> ปล่อยตามปกติ
    e.preventDefault(); e.stopPropagation();
    if (!qaGlSupplier || !String(qaGlBranchDr || '').trim()) { await confirmDialog.alert('กรุณาเลือก Code (Supplier) และ Branch Dr. ใน Tab ① ก่อนวางข้อมูลจาก Excel', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; }
    const seen = new Set(qaGlTivList.map((it) => it.tiv));
    const items = []; const drafts = []; const dup = []; const warn = [];
    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim() || !/\d/.test(line)) return;
      const c = line.split('\t').map(qaGlCl);
      const di = c.findIndex(qaGlIsDateLike);
      const rest = c.filter((_, i) => i !== di).filter((x, i, arr) => x !== '' || i < arr.length);
      const nums = rest.slice(1).filter((x) => qaGlNm(x) != null);
      const rec = { date: di >= 0 ? c[di] : '', tiv: rest[0] || '', br: '', g: nums[0] || '', v: nums[1] || '' };
      if (rec.tiv && seen.has(rec.tiv)) { dup.push(rec.tiv); return; }
      const r = qaGlBuildItem(rec, qaGlTivList.length + items.length);
      if (r.item) { seen.add(rec.tiv); items.push(r.item); if (r.warn) warn.push(r.item.tiv); } else drafts.push(rec);
    });
    if (items.length > 0) { setQaGlTivList((prev) => [...prev, ...items.filter((it) => !prev.some((p) => p.tiv === it.tiv))]); qaGlLastDateRef.current = items[items.length - 1].date; }
    if (drafts.length > 0) setQaGlGrid((prev) => [...prev.filter((rw) => rw.date || rw.tiv || rw.g || rw.v), ...drafts.map((d, i) => ({ id: `gp${Date.now()}-${i}`, ...d })), ...qaGlMkGrid(3)]);
    setQaGlTab(2);
    const notes = [];
    if (dup.length) notes.push(`ข้าม TIV ซ้ำ ${dup.length} ใบ: ${dup.slice(0, 5).join(', ')}${dup.length > 5 ? ' ...' : ''}`);
    if (drafts.length) notes.push(`ข้อมูลไม่ครบ ${drafts.length} แถว (วางไว้ในช่องกรอกด้านล่างให้แก้ต่อ)`);
    if (warn.length) notes.push(`ยอดไม่เข้ากฎ Vat 7% ${warn.length} ใบ (ใช้ค่ามากเป็น Amount ค่าน้อยเป็น Vat — โปรดตรวจ): ${warn.slice(0, 5).join(', ')}${warn.length > 5 ? ' ...' : ''}`);
    if (notes.length || (items.length === 0 && drafts.length === 0)) await confirmDialog.alert(`${items.length > 0 ? `เพิ่มจาก Excel ${items.length} ใบ\n` : (drafts.length === 0 ? 'ไม่พบแถวที่เพิ่มได้ (ต้องมี TIV · วันที่ · ตัวเลข)\n' : '')}${notes.join('\n')}`, { title: 'วางข้อมูลจาก Excel', variant: items.length > 0 && !warn.length && !drafts.length ? 'success' : 'danger' });
  };
  const qaGlGridSet = (id, k, val) => setQaGlGrid((prev) => { const n = prev.map((x) => (x.id === id ? { ...x, [k]: val } : x)); const l = n[n.length - 1]; return (l.date || l.tiv || l.g || l.v) ? [...n, ...qaGlMkGrid(1)] : n; });
  const qaGlGridTryCommit = async (rowId) => { // ออกจากแถว: ถ้าครบ (วันที่ + TIV + Amount) -> ย้ายเข้า Tax Invoice List
    const row = qaGlGridRef.current.find((x) => x.id === rowId); if (!row) return;
    if (!(qaGlCl(row.tiv) && qaGlCl(row.date) && qaGlNm(row.g) > 0)) return; // ยังไม่ครบ -> รอกรอกต่อ
    if (!qaGlSupplier || !String(qaGlBranchDr || '').trim()) { await confirmDialog.alert('กรุณาเลือก Code (Supplier) และ Branch Dr. ใน Tab ① ก่อน', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; }
    const tivT = qaGlCl(row.tiv);
    if (qaGlTivList.some((it) => it.tiv === tivT)) { await confirmDialog.alert(`TIV ${tivT} ซ้ำกับที่มีอยู่ใน List แล้ว`, { title: 'TIV ซ้ำ', variant: 'danger' }); return; }
    const r = qaGlBuildItem(row, qaGlTivList.length);
    if (!r.item) { await confirmDialog.alert('วันที่ไม่ถูกต้อง (ใช้รูปแบบ วว/ดด/ปปปป)', { title: 'ข้อมูลไม่ถูกต้อง', variant: 'danger' }); return; }
    setQaGlTivList((prev) => (prev.some((it) => it.tiv === r.item.tiv) ? prev : [...prev, r.item]));
    qaGlLastDateRef.current = r.item.date;
    setQaGlGrid((prev) => { const rest = prev.filter((x) => x.id !== rowId); return rest.length >= 5 ? rest : [...rest, ...qaGlMkGrid(5 - rest.length)]; });
    if (r.warn) await confirmDialog.alert(`TIV ${tivT}: ยอดไม่เข้ากฎ Vat 7% (ใช้ค่ามากเป็น Amount ค่าน้อยเป็น Vat) โปรดตรวจ`, { title: 'ตรวจยอด', variant: 'danger' });
  };
"""
txt = txt[:s] + new_handler + txt[e:]

# 4) ข้อความ Empty State
rep("ยังไม่มีใบกำกับ — คลิกในกรอบนี้แล้วกด Ctrl+V เพื่อวางจาก Excel (TIV · วันที่ · เลข · เลข) หรือไปที่ Tab ① แล้วกด + Add",
    "ยังไม่มีใบกำกับ — วางจาก Excel (Ctrl+V) หรือพิมพ์ในช่องด้านล่างได้เลย (ครบ วันที่ + TIV + Amount เข้า List อัตโนมัติ) หรือไปที่ Tab ① แล้วกด + Add")

# 5) แถวช่องกรอกใต้ List
rep("                  </tbody>\n                </table>\n                </div>\n                <div style={sumS}>\n                  <span>รวมใบกำกับ Gross",
"""                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V1
                      const gIn = (k, ph, right) => (<input value={gr[k]} placeholder={ph} onChange={(ev) => qaGlGridSet(gr.id, k, ev.target.value)} onPaste={handleQaGlPasteRows} onBlur={(ev) => { const tr = ev.currentTarget.closest('tr'); setTimeout(() => { if (!tr || !tr.contains(document.activeElement)) qaGlGridTryCommit(gr.id); }, 0); }} style={{ width: '100%', boxSizing: 'border-box', height: '26px', fontSize: '12px', padding: '0 6px', border: '1px solid #e1e6ec', background: '#f7fbff', borderRadius: '4px', outline: 'none', textAlign: right ? 'right' : 'left' }} />);
                      return (
                        <tr key={gr.id}>
                          <td style={{ ...tdS, textAlign: 'center', color: '#bbb' }}>{listGl.length + gi + 1}</td>
                          <td style={tdS}>{gIn('date', 'วว/ดด/ปปปป')}</td><td style={tdS}>{gIn('tiv', 'TIV number')}</td><td style={{ ...tdS, color: '#bbb' }}>—</td>
                          <td style={tdS}>{gIn('br', String(qaGlBranchDr || '') || 'auto')}</td><td style={tdS}>{gIn('g', 'Amount', true)}</td><td style={tdS}>{gIn('v', 'Vat (ว่าง = 7%)', true)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <div style={sumS}>
                  <span>รวมใบกำกับ Gross""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
