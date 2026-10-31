/**
 * pdfTaxInvoiceReader.js
 * ================================================================
 * MARKER_PDFTAXINV_READER_V1
 * อ่านใบกำกับภาษี (PDF ที่มี Text ในไฟล์) ด้วย PDF.js ฝั่ง Browser
 * -- ไม่ส่งไฟล์ขึ้น Server  / ไม่ต้อง OCR สำหรับไฟล์ที่มี Text
 *
 * หลักการ: Template ต่อ Supplier (ดู SUPPLIER_TEMPLATES ด้านล่าง)
 *   - detect()  : บอกว่าเอกสารนี้เป็นของ Supplier ไหน
 *   - extract() : ดึง เลขที่/วันที่/Invoice Ref./ยอด ด้วย Label ของ Supplier นั้น
 *   - supplier  : Tax ID + สาขา ของ Supplier (INET ส่วนหัวเป็นรูปภาพ จึงกำหนดใน Template)
 * ส่วน BU = Tax ID + สาขา ของ "ผู้ซื้อ" (Generic ใช้ได้ทุก Supplier)
 *
 * เพิ่ม Supplier ใหม่ = เพิ่ม 1 Object ใน SUPPLIER_TEMPLATES (ไม่ต้องแก้ส่วนอื่น)
 * ================================================================
 */

// ── แปลงตัวเลข/วันที่ ───────────────────────────────────────────
const toNum = (s) => {
  if (s === undefined || s === null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

// รับ y,m,d (อาจเป็น พ.ศ.) -> 'YYYY-MM-DD' | null
const toIso = (y, m, d) => {
  let yy = parseInt(y, 10); const mm = parseInt(m, 10); const dd = parseInt(d, 10);
  if (!yy || !mm || !dd || mm > 12 || dd > 31) return null;
  if (yy > 2400) yy -= 543;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

// ── อ่าน Text จาก PDF.js เป็น "บรรทัด" (เรียงตาม Y แล้ว X) ───────────
export async function extractPdfLines(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const lines = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const text = r.items.map((i) => i.str).join('  ');
      lines.push(text);
      chars += text.length;
    }
  }
  return { lines, text: lines.join('\n'), numPages: doc.numPages, charCount: chars };
}

// ── Branch ของผู้ซื้อ/ผู้ขาย จากข้อความรอบ Tax ID ───────────────────
// ตัวอักษรไทยใน PDF บางฉบับเพี้ยน (Font Encoding) แต่คำว่า "ใหญ" ยังอยู่ จึงจับแค่ ใหญ / Head Office
const HQ_RE = /ใหญ|Head\s*Office/i;
function branchNear(text, taxId) {
  const i = text.indexOf(taxId);
  if (i < 0) return null;
  const near = text.slice(i + taxId.length, i + taxId.length + 60);
  const m5 = near.match(/(?:สาขา|Branch)[^\d]{0,8}(\d{5})/i) || near.match(/^\s*[(\s]*(\d{5})\b/);
  if (m5) return m5[1];
  if (HQ_RE.test(near)) return '00000';
  return null;
}

// ── Template ต่อ Supplier ────────────────────────────────────────
export const SUPPLIER_TEMPLATES = [
  {
    key: 'INET',
    name: 'บริษัท อินเทอร์เน็ตประเทศไทย จำกัด (มหาชน)',
    // ส่วนหัว (Tax ID/สาขา) ของ INET เป็นรูปภาพ -> กำหนดตายตัวใน Template
    supplier: { taxId: '0107544000094', branch: '00000' },
    detect: (t) => /INET-RC\d+-\d+/.test(t) || (/Receipt\/Tax Invoice/.test(t) && /\bINET\b/.test(t)),
    buyerTaxIdLabel: /Tax ID\.?\s*[:：]?\s*(\d{13})/,
    extract: (t) => {
      const no = (t.match(/\/No\.\s*(\d{6,})/) || [])[1] || null;
      const d = t.match(/\/Date\.\s*(\d{2})\/(\d{2})\/(\d{4})/);
      const ref = (t.match(/\b([A-Z]{2,5}-\d{2}-\d{6,8})\b/) || [])[1] || null;
      const gt = toNum((t.match(/Grand Total\s+([\d,]+\.\d{2})/) || [])[1]);
      const vat = toNum((t.match(/Vat\s*7\s*%\s+([\d,]+\.\d{2})/i) || [])[1]);
      const tot = toNum((t.match(/Total Amount\s+([\d,]+\.\d{2})/) || [])[1]);
      return {
        invoiceNo: no,
        invoiceDate: d ? toIso(d[3], d[2], d[1]) : null,
        invoiceRef: ref,
        vat, grandTotal: gt, beforeVat: tot,
        fileRef: (t.match(/\b(INET-RC\d+-\d+)\b/) || [])[1] || null,
      };
    },
  },
  {
    // MARKER_PDFTAXINV_MALL_V1 -- The Mall Bangkapi (ใบเสร็จรับเงิน/ใบกำกับภาษี จาก SAP FI) : 1 ใบ = หลาย Invoice (IN…/CN…) หลายหน้า
    key: 'MALL_BANGKAPI',
    name: 'THE MALL BANGKAPI COMPLEX CO., LTD.',
    supplier: { taxId: '0105534051727', branch: '00000' }, // ส่วนหัวระบุ HEADQUARTERS / สำนักงานใหญ่
    detect: (t) => /0105534051727/.test(t) || /MALL BANGKAPI COMPLEX/i.test(t),
    // สาขาผู้ซื้ออยู่ในบรรทัด "ชื่อลูกค้า ... สำนักงานใหญ่" (ตัวไทยเพี้ยนแต่ "ใหญ" ยังอยู่)
    buyerBranchHint: (t) => (/ชื่อลูกค[^\n]*ใหญ/.test(t) ? '00000' : null),
    extract: (t) => {
      const no = (t.match(/\/\s*No\.\s*([0-9A-Z][0-9A-Z\/-]+)/) || [])[1] || null;
      const d = t.match(/Date\s+(\d{2})\.(\d{2})\.(\d{4})/);
      const fiNo = (t.match(/FI No\.\s*(\d+)/) || [])[1] || null;
      const money = (x) => { const neg = /^\(.*\)$/.test(x); const n = toNum(x.replace(/[()]/g, '')); return n === null ? null : (neg ? -n : n); };
      const lines = [];
      t.split('\n').forEach((ln) => {
        const m = ln.match(/^((?:IN|CN|DN)\d{6,})\s+.*?\s(\(?[\d,]+\.\d{2}\)?)\s(\(?[\d,]+\.\d{2}\)?)\s(\(?[\d,]+\.\d{2}\)?)\s*$/);
        if (m) lines.push({ invoiceNo: m[1], amount: money(m[2]), vat: money(m[3]), total: money(m[4]) });
      });
      const pick = (re) => toNum((t.match(re) || [])[1]);
      return {
        invoiceNo: no,
        invoiceDate: d ? toIso(d[3], d[2], d[1]) : null,
        invoiceRef: null, fiNo, lines,
        nonVat: pick(/Total Amount Without VAT\)\s+([\d,]+\.\d{2})/),
        beforeVat: pick(/Total Amount Before VAT\)\s+([\d,]+\.\d{2})/),
        vat: pick(/\(VAT Amount\)\s+([\d,]+\.\d{2})/),
        grandTotal: pick(/Grand Total\s*:\s*BAHT\)\s+([\d,]+\.\d{2})/),
      };
    },
  },
  {
    key: 'LINE',
    name: 'LINE COMPANY (THAILAND) LIMITED',
    supplier: null, // อ่านจาก Text ได้ (Tax ID No. ใต้ชื่อบริษัท)
    detect: (t) => /LINE COMPANY \(THAILAND\)/i.test(t) || /Tax Invoice\/Receipt/.test(t) && /LGTTX/.test(t),
    supplierTaxIdLabel: /Tax ID No\.?\s*[:：]?\s*(\d{13})/, // ตัวแรกในเอกสาร = ผู้ขาย
    buyerSectionStart: /Customer\s*:/,
    extract: (t) => {
      const no = (t.match(/Tax Invoice No\.?\s*[:：]?\s*([A-Z0-9-]+)/i) || [])[1] || null;
      const d = t.match(/Tax Invoice Date\s*[:：]?\s*(\d{4})\.(\d{2})\.(\d{2})/i);
      const ref = (t.match(/Reference ID\s*[:：]?\s*([A-Z0-9-]+)/i) || [])[1] || null;
      const before = toNum((t.match(/Amount after discount\s+([\d,]+\.\d{2})/i) || [])[1]);
      const vat = toNum((t.match(/VAT\s*7\s*%\s+([\d,]+\.\d{2})/i) || [])[1]);
      const gt = toNum((t.match(/Amount Inc VAT\s+([\d,]+\.\d{2})/i) || [])[1]);
      const wht = toNum((t.match(/Withholding Tax 3%\s+([\d,]+\.\d{2})/i) || [])[1]);
      const pd = t.match(/Payment Date\s*[:：]?\s*(\d{4})\.(\d{2})\.(\d{2})/i); // MARKER_PDFTAXINV_PAYDATE_V1 -- LINE มี Payment Date ในเอกสาร
      return {
        paymentDate: pd ? toIso(pd[1], pd[2], pd[3]) : null,
        invoiceNo: no,
        invoiceDate: d ? toIso(d[1], d[2], d[3]) : null,
        invoiceRef: ref,
        beforeVat: before, vat, grandTotal: gt, withholdingTax: wht,
      };
    },
  },
];

// ── ผู้ซื้อ (BU) : Generic ───────────────────────────────────────
function findBuyer(text, tpl) {
  // LINE: ผู้ซื้ออยู่ใต้ "Customer:"
  if (tpl && tpl.buyerSectionStart) {
    const idx = text.search(tpl.buyerSectionStart);
    if (idx >= 0) {
      const sec = text.slice(idx);
      const m = sec.match(/Tax ID No\.?\s*[:：]?\s*(\d{13})/i);
      if (m) {
        const name = (sec.split('\n')[1] || '').replace(/\(.*?\)/g, '').trim();
        return { taxId: m[1], branch: branchNear(sec, m[1]) || (HQ_RE.test(sec.slice(0, 200)) ? '00000' : null), name };
      }
    }
  }
  // INET และอื่นๆ: Tax ID ที่ไม่ใช่ของผู้ขาย
  const re = /Tax ID\.?\s*[:：]?\s*(\d{13})/g;
  let m;
  while ((m = re.exec(text))) {
    if (tpl && tpl.supplier && m[1] === tpl.supplier.taxId) continue;
    return { taxId: m[1], branch: branchNear(text, m[1]) || (tpl && tpl.buyerBranchHint ? tpl.buyerBranchHint(text) : null), name: '' }; // ชื่อผู้ซื้อของ INET เพี้ยน อ่านไม่ได้ -> ใช้ Tax ID+สาขา หา BU
  }
  return { taxId: null, branch: null, name: '' };
}

// ── ผู้ขาย ───────────────────────────────────────────────────────
function findSupplier(text, tpl) {
  if (!tpl) return { taxId: null, branch: null };
  if (tpl.supplier) return { ...tpl.supplier };
  const m = text.match(tpl.supplierTaxIdLabel || /Tax ID No\.?\s*[:：]?\s*(\d{13})/i);
  const taxId = m ? m[1] : null;
  return { taxId, branch: taxId ? (branchNear(text, taxId) || null) : null };
}

/**
 * อ่าน PDF 1 ไฟล์ -> Object ผลลัพธ์ (ไม่ throw: ใส่ warnings แทน)
 * status: 'ok' | 'review' (อ่านได้แต่ต้องตรวจ) | 'unreadable' (ไม่มี Text -> ต้อง OCR)
 */
export async function readPdfTaxInvoice(pdfjsLib, data, fileName) {
  const out = {
    fileName, status: 'ok', warnings: [], supplierKey: null,
    supplier: { taxId: null, branch: null }, buyer: { taxId: null, branch: null, name: '' },
    invoiceNo: null, invoiceDate: null, invoiceRef: null,
    beforeVat: null, vat: null, grandTotal: null, withholdingTax: null, paymentDate: null, nonVat: null, lines: null, fiNo: null,
  };
  let parsed;
  try { parsed = await extractPdfLines(pdfjsLib, data); }
  catch (e) { out.status = 'unreadable'; out.warnings.push('เปิด PDF ไม่ได้: ' + (e && e.message)); return out; }
  if (parsed.charCount < 50) { out.status = 'unreadable'; out.warnings.push('ไม่พบ Text ในไฟล์ (อาจเป็น PDF สแกน) -- ต้องใช้ OCR'); return out; }

  const text = parsed.text.replace(/[ \t]+/g, ' '); // ยุบช่องว่าง (PDF.js แยก Item ทีละคำ)
  const tpl = SUPPLIER_TEMPLATES.find((t) => { try { return t.detect(text); } catch (_) { return false; } }) || null;
  if (!tpl) { out.status = 'review'; out.warnings.push('ไม่รู้จักรูปแบบเอกสารของ Supplier นี้ (ยังไม่มี Template)'); return out; }

  out.supplierKey = tpl.key;
  out.supplier = findSupplier(text, tpl);
  out.supplierName = tpl.name; // MARKER_PDFTAXINV_CONFIRM_V1
  out.buyer = findBuyer(text, tpl);
  Object.assign(out, tpl.extract(text));

  // beforeVat ที่ INET อ่านจาก "Total Amount" ไม่ได้ในบางฉบับ -> คำนวณย้อนจาก รวม - VAT
  if (out.beforeVat == null && out.grandTotal != null && out.vat != null) out.beforeVat = round2(out.grandTotal - out.vat);

  // ตรวจความสมเหตุสมผล
  if (!out.invoiceNo) out.warnings.push('ไม่พบเลขที่ใบกำกับภาษี');
  if (!out.invoiceDate) out.warnings.push('ไม่พบวันที่');
  if (!out.buyer.taxId) out.warnings.push('ไม่พบ Tax ID ผู้ซื้อ (หา BU ไม่ได้)');
  if (!out.buyer.branch) out.warnings.push('ไม่พบสาขาผู้ซื้อ');
  if (out.grandTotal == null || out.vat == null) out.warnings.push('ไม่พบยอด VAT/รวม');
  else if (out.beforeVat != null && Math.abs(round2(out.beforeVat + out.vat + (out.nonVat || 0)) - out.grandTotal) > 0.02) {
    out.warnings.push(`ยอดไม่ลงตัว: ${out.beforeVat} + ${out.vat}${out.nonVat ? ' + ' + out.nonVat : ''} ≠ ${out.grandTotal}`);
  }
  if (out.lines && out.lines.length && out.vat != null) { // MARKER_PDFTAXINV_MALL_V1 -- ผลรวม VAT รายบรรทัดต้องเท่ากับ VAT รวม
    const sv = round2(out.lines.reduce((a, l) => a + (l.vat || 0), 0));
    if (Math.abs(sv - out.vat) > 0.02) out.warnings.push(`VAT รายบรรทัดรวม ${sv} ≠ VAT รวม ${out.vat}`);
  }
  if (out.warnings.length) out.status = 'review';
  return out;
}
