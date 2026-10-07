# -*- coding: utf-8 -*-
# Patch: GL-TransferVat -- วางข้อมูลหลายใบจาก Excel ลง TIV number / Amount ครั้งเดียว (TIV | วันที่ | เลข 2 ช่อง) -> Add เข้า Tax Invoice List ให้เลย
#  - ตัด ' นำหน้า / ช่องว่าง, วันที่ d/m/yyyy (พ.ศ.) -> ISO, ทศนิยม 4 ตำแหน่ง -> 2 ตำแหน่ง, จัดสลับ Amount/Vat อัตโนมัติ (vatTaxNormalizeAmounts)
# usage: python patch_vatcontroller_qagl_paste_excel.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')

anchor = "  const handleQaGlAdd = async () => { // Add = เก็บใบกำกับที่กรอกอยู่เข้ารายการ"
assert txt.count(anchor) == 1, txt.count(anchor)
handler = r"""  const handleQaGlPasteRows = async (e) => { // MARKER_QA_GL_PASTE_EXCEL_V1 -- วางหลายแถวจาก Excel: TIV | Tax Invoice Date | เลข 2 ช่อง (Vat/Amount สลับได้) หรือ TIV | Date | Amount
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!/[\t\r\n]/.test(text.trim())) return; // วางค่าเดียวธรรมดา -> ปล่อยตามปกติ
    e.preventDefault();
    if (!qaGlSupplier || !String(qaGlBranchDr || '').trim()) { await confirmDialog.alert('กรุณาเลือก Code (Supplier) และ Branch Dr. ก่อนวางข้อมูลจาก Excel', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; }
    const cl = (x) => String(x == null ? '' : x).replace(/^\s*'/, '').replace(/\s+/g, ' ').trim();
    const nm = (x) => { const n = parseFloat(cl(x).replace(/,/g, '')); return isNaN(n) ? null : n; };
    const seen = new Set(qaGlTivList.map((it) => it.tiv));
    const items = []; const dup = []; const bad = []; const warn = [];
    const brDr = String(qaGlBranchDr).trim(); const brCr = String(qaGlBranchCr || '').trim() || brDr;
    text.split(/\r?\n/).forEach((line, idx) => {
      if (!line.trim()) return;
      const c = line.split('\t').map(cl);
      const tiv = c[0]; const date = amagnoParseDate(c[1]);
      if (!tiv || !date) { bad.push(idx + 1); return; }
      if (seen.has(tiv)) { dup.push(tiv); return; }
      const n1 = nm(c[2]); const n2 = nm(c[3]); let g; let v;
      if (n1 != null && n2 != null) {
        const a = vatTaxNormalizeAmounts({ gross_value: n1, vat_value: n2 });
        if (a.suspicious) { g = roundMoney2(Math.max(n1, n2)); v = roundMoney2(Math.min(n1, n2)); warn.push(tiv); } else { g = roundMoney2(a.amount); v = roundMoney2(a.vat); }
      } else if (n1 != null && n1 > 0) { const s = qaGlSplitAmt(qaGlAmtType, n1); g = s.g; v = s.v; }
      else { bad.push(idx + 1); return; }
      seen.add(tiv);
      items.push({ id: `${Date.now()}-${qaGlTivList.length + items.length}`, pending: false, date, tiv, type: 'GRO+VT', g, v, brDr, brCr, cpcDr: qaGlCpcDr, accDr: qaGlAccDr, subDr: qaGlSubDr, cpcCr: qaGlCpcCr, accCr: qaGlAccCr, subCr: qaGlSubCr });
    });
    if (items.length > 0) { setQaGlTivList((prev) => [...prev, ...items]); qaGlLastDateRef.current = items[items.length - 1].date; setQaGlTab(2); }
    const notes = [];
    if (dup.length) notes.push(`ข้าม TIV ซ้ำ ${dup.length} ใบ: ${dup.slice(0, 5).join(', ')}${dup.length > 5 ? ' ...' : ''}`);
    if (bad.length) notes.push(`อ่านไม่ได้ ${bad.length} แถว (แถวที่ ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ' ...' : ''})`);
    if (warn.length) notes.push(`ยอดไม่เข้ากฎ Vat 7% ${warn.length} ใบ (ระบบใช้ค่ามากเป็น Amount ค่าน้อยเป็น Vat — โปรดตรวจ): ${warn.slice(0, 5).join(', ')}${warn.length > 5 ? ' ...' : ''}`);
    if (notes.length || items.length === 0) await confirmDialog.alert(`${items.length > 0 ? `เพิ่มจาก Excel ${items.length} ใบ\n` : 'ไม่พบแถวที่เพิ่มได้ (รูปแบบ: TIV [Tab] วันที่ [Tab] เลข [Tab] เลข)\n'}${notes.join('\n')}`, { title: 'วางข้อมูลจาก Excel', variant: items.length > 0 && !warn.length ? 'success' : 'danger' });
  };
"""
txt = txt.replace(anchor, handler + anchor)

t_old = "<input ref={qaGlTivInputRef} type=\"text\" value={qaGlTiv} onChange={(e) => setQaGlTiv(e.target.value)} style="
assert txt.count(t_old) == 1, txt.count(t_old)
txt = txt.replace(t_old, "<input ref={qaGlTivInputRef} type=\"text\" value={qaGlTiv} onChange={(e) => setQaGlTiv(e.target.value)} onPaste={handleQaGlPasteRows} style=")

a_old = "<input type=\"text\" value={qaGlAmt} onChange={(e) => setQaGlAmt(e.target.value)}\n"
assert txt.count(a_old) == 1, txt.count(a_old)
txt = txt.replace(a_old, "<input type=\"text\" value={qaGlAmt} onChange={(e) => setQaGlAmt(e.target.value)} onPaste={handleQaGlPasteRows}\n")

# กรอบ Tax Invoice List (Tab 2) รับการวางได้โดยตรง: คลิกในกรอบแล้ว Ctrl+V
box_old = "<div style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto' }}> {/* MARKER_QA_GL_TAXLIST_TALLER_V1"
assert txt.count(box_old) == 1, txt.count(box_old)
txt = txt.replace(box_old, "<div tabIndex={0} onPaste={handleQaGlPasteRows} title=\"คลิกในกรอบนี้แล้วกด Ctrl+V เพื่อวางข้อมูลจาก Excel\" style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto', outline: 'none' }}> {/* MARKER_QA_GL_TAXLIST_TALLER_V1")
e_old = "ยังไม่มีใบกำกับ — ไปที่ Tab ① แล้วกด + Add</td></tr>)}"
assert txt.count(e_old) == 1, txt.count(e_old)
txt = txt.replace(e_old, "ยังไม่มีใบกำกับ — คลิกในกรอบนี้แล้วกด Ctrl+V เพื่อวางจาก Excel (TIV · วันที่ · เลข · เลข) หรือไปที่ Tab ① แล้วกด + Add</td></tr>)}")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
