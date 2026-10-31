// MARKER_PP36_PDF_READER_V1 -- อ่าน PDF แบบนำส่ง ภ.พ.36 (หน้าแบบฟอร์ม + หน้าใบเสร็จรับเงินสลับกัน) ด้วย PDF.js ฝั่ง Browser
// คืนค่า rows แบบเดียวกับตาราง T36: [ลำดับ, ชื่อบริษัทที่โอนต่างประเทศ, มูลค่าฐานภาษี, ภ.พ.36, วัน/เดือน/ปี, เลขที่ใบเสร็จ, สาขา Oracle]
let _pdfjsPromise = null;
export function loadPdfjsForPp36() {
  if (!_pdfjsPromise) {
    const base = new URL((process.env.PUBLIC_URL || '') + '/pdfjs/', window.location.href).href;
    _pdfjsPromise = import(/* webpackIgnore: true */ base + 'pdf.min.js').then((m) => {
      const lib = (m && m.getDocument) ? m : (m && m.default) || m;
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
      return lib;
    }).catch((e) => { _pdfjsPromise = null; throw e; });
  }
  return _pdfjsPromise;
}

// รวม text item ของหน้าเป็นบรรทัด (จัดกลุ่มตามแกน Y แล้วเรียงตาม X)
async function pageLines(page) {
  const tc = await page.getTextContent();
  const items = tc.items.filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '').map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
  items.sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));
  const lines = [];
  items.forEach((it) => {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it); else lines.push({ y: it.y, items: [it] });
  });
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return lines;
}
const lineText = (l) => l.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
const num = (intTxt, satang) => `${String(intTxt).replace(/,/g, '')}.${satang}`;

export function parsePp36Page(lines) {
  const texts = lines.map(lineText);
  const all = texts.join('\n');
  if (!/ภ\.พ\.36/.test(all) || !/เลขที่ใบเสร็จ\s*:/.test(all)) return null; // ไม่ใช่หน้าแบบฟอร์ม (เช่นหน้าใบเสร็จ)
  const rec = /เลขที่ใบเสร็จ\s*:\s*(\d+)/.exec(all);
  const dt = /วันที่\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(all);
  // ชื่อผู้รับเงิน = ข้อความบรรทัดเดียวกับป้าย "ชื่อผู้ประกอบการซึ่งเป็นผู้รับเงิน" ที่อยู่ขวาป้าย (ตัดจุดไข่ปลา)
  let name = '';
  for (const l of lines) {
    const idx = l.items.findIndex((i) => /ชื่อผู้ประกอบการซึ่งเป็นผู้รับเงิน/.test(i.s));
    if (idx >= 0) {
      const lab = l.items[idx]; const rest = l.items.filter((i, k) => k !== idx && i.x > lab.x + 1 && !/^[.\s]+$/.test(i.s) && i.x < 450);
      name = rest.map((i) => i.s).join(' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) name = lab.s.replace(/ชื่อผู้ประกอบการซึ่งเป็นผู้รับเงิน/, '').replace(/\.{2,}/g, ' ').trim();
      break;
    }
  }
  name = name.replace(/\s*(จำนวนเงิน|วันที่\s*:).*$/, '').trim();
  // การคำนวณภาษี: บรรทัด "462,235 35 1" = ฐาน (ข้อ 1) , "32,356 47 2" = ภาษีที่ต้องนำส่ง (ข้อ 2)
  let base = '', vat = '', extra = '', pen = '', total = '';
  texts.forEach((t) => { const m = /^([\d,]+)\s+(\d{2})\s+([1-5])$/.exec(t); if (m) { const v = num(m[1], m[2]); if (m[3] === '1') base = v; else if (m[3] === '2') vat = v; else if (m[3] === '3') extra = v; else if (m[3] === '4') pen = v; else total = v; } });
  if (!vat) { const m = /จำนวนเงิน\s*([\d,]+\.\d{2})\s*บาท/.exec(all); if (m) vat = m[1].replace(/,/g, ''); }
  // ผู้นำส่ง : เลขประจำตัวผู้เสียภาษี 13 หลัก (กล่องบรรทัดบน) + สาขา 5 หลัก (กล่องถัดลงมา) อยู่ด้านซ้ายของหน้า
  let ptax = '', pbr = '';
  { const dg = []; lines.forEach((l) => l.items.forEach((i) => { if (/^\d$/.test(i.s.trim()) && i.x < 340 && i.y > 735) dg.push(i); }));
    const rowsY = []; dg.forEach((i) => { const r = rowsY.find((q) => Math.abs(q.y - i.y) <= 4); if (r) r.d.push(i); else rowsY.push({ y: i.y, d: [i] }); });
    rowsY.sort((a, b) => b.y - a.y).forEach((r) => { const t = r.d.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(''); if (t.length === 13 && !ptax) ptax = t; else if (t.length === 5 && !pbr) pbr = t; }); }
  return { name, base, vat, extra, pen, total, ptax, pbr, date: dt ? dt[1] : '', receipt: rec ? rec[1] : '' };
}

// หน้าใบเสร็จรับเงิน (กรมสรรพากร) : เลขที่ใบเสร็จ / วันชำระ / จำนวนเงิน
export function parsePp36Receipt(lines) {
  const texts = lines.map(lineText); const all = texts.join('\n');
  if (!/ใบเสร็จรับเงิน/.test(all) || /เลขที่ใบเสร็จ\s*:/.test(all)) return null;
  const rec = (all.match(/(?:^|\s)(\d{11})(?:\s|$)/) || [])[1] || '';
  const amt = (/\*+([\d,]+\.\d{2})/.exec(all) || [])[1] || '';
  const dt = (/(\d{1,2}\/\d{1,2}\/\d{4})/.exec(all) || [])[1] || '';
  if (!rec && !amt) return null;
  return { receipt: rec, amount: amt.replace(/,/g, ''), date: dt };
}
const dmy = (d) => { const m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(String(d || '').trim()); if (!m) return String(d || '').replace(/\//g, '.'); const y = +m[3]; return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${y > 2400 ? y - 543 : y}`; }; // MARKER_T36_PDF_DATE_CE_V1 -- dd.mm.yyyy (ค.ศ.) แปลงจาก พ.ศ. ในใบเสร็จ (2569 -> 2026)

export async function readPp36Pdf(file, keepDoc) {
  const pdfjs = await loadPdfjsForPp36();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const forms = []; const recs = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const lines = await pageLines(page);
    const f = parsePp36Page(lines);
    if (f && (f.receipt || f.name)) forms.push({ ...f, page: p });
    else { const r = parsePp36Receipt(lines); if (r) recs.push({ ...r, page: p }); }
    try { page.cleanup(); } catch (e) { /* ignore */ }
  }
  if (!keepDoc) { try { await doc.destroy(); } catch (e) { /* ignore */ } }
  const byNo = new Map(); recs.forEach((r) => { if (r.receipt) byNo.set(r.receipt, r); });
  const rows = []; const issues = []; const items = []; let matched = 0;
  forms.forEach((f, i) => {
    const r = byNo.get(f.receipt) || null; // จับคู่ใบเสร็จด้วยเลขที่ใบเสร็จ
    const rc = r ? r.receipt : f.receipt; const dt = (r && r.date) || f.date; const my = [];
    if (!r) { const m = `ไม่พบใบเสร็จเลขที่ ${f.receipt || '-'}`; my.push(m); issues.push(`หน้า ${f.page} (${f.name || '-'}) ${m}`); }
    else {
      matched++;
      const exp = f.total || f.vat; // ใบเสร็จ = ข้อ 5 (ภาษี+เงินเพิ่ม+เบี้ยปรับ) ถ้ามี
      if (r.amount && exp && Math.abs(parseFloat(r.amount) - parseFloat(exp)) > 0.005) { const m = `ยอดในฟอร์ม ${exp} ≠ ใบเสร็จ ${r.amount}`; my.push(m); issues.push(`หน้า ${f.page} ${f.name}: ${m}`); }
      if (f.date && r.date && f.date !== r.date) { const m = `วันที่ฟอร์ม ${f.date} ≠ ใบเสร็จ ${r.date}`; my.push(m); issues.push(`หน้า ${f.page} ${f.name}: ${m}`); }
    }
    rows.push([String(i + 1), f.name, f.base, f.vat, dmy(dt), rc, '']);
    items.push({ formPage: f.page, recPage: r ? r.page : 0, ptax: f.ptax, pbr: f.pbr, extra: f.extra, total: f.total, recAmount: r ? r.amount : '', issues: my, ok: !!r && !my.length });
  });
  return { rows, issues, items, doc: keepDoc ? doc : null, pages: doc.numPages, forms: forms.length, matched };
}
