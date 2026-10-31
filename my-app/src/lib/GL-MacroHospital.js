// GL-MacroHospital.js
// MARKER_GL_MACRO_IB_HOSPITAL_V1
// ─────────────────────────────────────────────────────────────────────────
// พอร์ตจาก GL_SystemControl.xlam > "Generate Loop" (ค่ารักษาพยาบาล) + Hybrid ADI Loop (GL_Project / Karn_Project)
//   ไฟล์ใบสรุป "เดินสะพัด" หลายไฟล์ -> รวม -> ใส่ BU -> สร้างรายการ Debit/Credit -> ADI Upload (เฉพาะกรณี IB)
//
// กฎที่ได้จาก Macro:
//   - Debit  = ทุกแถวของใบสรุป (ฝั่ง "เดินเข้าสาขา" E:H) ยอด = คอลัมน์ Amount
//   - Credit = 1 บรรทัดต่อ 1 ใบ (ฝั่ง "เดินจากสาขา" A:D ของแถวแรก) ยอด = ผลรวมของใบนั้น
//   - IB     = ทุกใบถูกสร้างเป็น IB (Category Com-IB-ALL) -- รวมใบที่สาขาเดินจาก = เดินเข้า (Macro เดิมจัดเป็น ADJ) ตามที่ผู้ใช้กำหนดว่าต้องสร้างให้ทุกใบ
//   - Category  = Com-IB-ALL | Source = Excel-APN
//   - Batch     = APN-MMYY-Com-OTH-IB-001
//   - Journal   = APN-<SE38|JA01|JB01>-Com-OTH-IB-<เลขรัน 3 หลัก ต่อ 1 ใบ>
//   - Line Desc = IB-<MM.YYYY> ค่ารักษาพยาบาล|<Invoice>|<โรงพยาบาล>
//   - Acc Date  = ถ้า Period ไม่ใช่เดือนปัจจุบัน -> วันสิ้นเดือน, ถ้าเป็นเดือนปัจจุบัน -> วันนี้ (ตามสูตร B2 ของ Web ADI Form)
//   - Bus/Grp/Com = COMPANY CODE ของ BU (แยกด้วย "-") ตามสาขา
// ฟังก์ชันทั้งหมดเป็น Pure Function (รับ Array of Arrays จากชีต) เพื่อทดสอบนอก Browser ได้
// ─────────────────────────────────────────────────────────────────────────

export const HOSPITAL_TYPE = 'IB_HOSPITAL';
export const HOSPITAL_TYPE_LABEL = 'Hospital IB';
export const HOSPITAL_MIN_SCORE = 80;   // >= 80 = ใช่แน่นอน
export const HOSPITAL_MAYBE_SCORE = 50; // 50-79 = น่าจะใช่ แต่โครงสร้างต่างจากปกติ

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON_PROPER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const norm = (v) => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const low = (v) => norm(v).toLowerCase();
const isNum = (v) => typeof v === 'number' && isFinite(v);
const toNum = (v) => {
  if (isNum(v)) return v;
  const s = norm(v).replace(/,/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function findCell(aoa, test, maxRow = 30, maxCol = 40) {
  for (let r = 0; r < Math.min(aoa.length, maxRow); r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < Math.min(row.length, maxCol); c++) {
      if (test(low(row[c]))) return { r, c };
    }
  }
  return null;
}
function firstRight(row, c) {
  for (let j = c + 1; j < (row || []).length; j++) if (norm(row[j]) !== '') return row[j];
  return '';
}
function nextTwoRight(row, c) {
  const out = [];
  for (let j = c + 1; j < (row || []).length && out.length < 2; j++) if (norm(row[j]) !== '') out.push(row[j]);
  return out;
}

// หาแถวหัวตาราง: แถวที่มีคำว่า Branch อย่างน้อย 2 ช่อง (ฝั่งเดินจาก / เดินเข้า)
function findHeader(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 30); r++) {
    const row = aoa[r] || [];
    const bcols = [];
    row.forEach((v, c) => { if (low(v) === 'branch') bcols.push(c); });
    if (bcols.length >= 2) return { r, creditCol: bcols[0], debitCol: bcols[1] };
  }
  return null;
}

// ── ตรวจชนิดไฟล์ด้วยคะแนน (ไม่ดูชื่อไฟล์) ───────────────────────────────────
export function scoreHospitalAoa(aoa) {
  const reasons = [];
  let score = 0;
  const has = (t) => findCell(aoa, (x) => x.includes(t));
  if (has('เดินสะพัด')) { score += 25; reasons.push('เดินสะพัด'); }
  if (has('ค่ารักษาพยาบาล') && has('ประจำเดือน')) { score += 25; reasons.push('ค่ารักษาพยาบาล/ประจำเดือน'); }
  if (has('เดินจากสาขา') && has('เดินเข้าสาขา')) { score += 20; reasons.push('เดินจาก/เดินเข้า'); }
  const inv = findCell(aoa, (x) => /^invoice\s*number$/.test(x));
  if (inv && norm(firstRight(aoa[inv.r], inv.c)) !== '') { score += 10; reasons.push('Invoice Number'); }
  if (has('employee id') && findCell(aoa, (x) => x === 'amount')) { score += 10; reasons.push('Employee ID/Amount'); }
  const h = findHeader(aoa);
  if (h) {
    const row = (aoa[h.r] || []).map(low);
    const cc = row.filter((x) => x === 'cost center').length;
    const ac = row.filter((x) => x === 'account code').length;
    if (cc >= 2 && ac >= 2) { score += 10; reasons.push('หัวตาราง 2 ชุด'); }
  }
  return { score, reasons };
}

// ── อ่านใบสรุป 1 ไฟล์ (1 ชีต) ───────────────────────────────────────────────
export function parseHospitalAoa(aoa) {
  const out = { ok: false, error: '', warnings: [], hospital: '', invoice: '', company: '', taxId: '', monthText: '', yearBE: '', credit: null, rows: [] };
  const h = findHeader(aoa);
  if (!h) { out.error = 'ไม่พบหัวตาราง Branch ทั้ง 2 ฝั่ง'; return out; }

  const vendor = findCell(aoa, (x) => x === 'vendor', h.r);
  if (vendor) out.hospital = norm(firstRight(aoa[vendor.r], vendor.c));
  const inv = findCell(aoa, (x) => /^invoice\s*number$/.test(x), h.r);
  if (inv) {
    const v = firstRight(aoa[inv.r], inv.c);
    out.invoice = isNum(v) ? String(Math.round(v)) : norm(v);
  }
  const mon = findCell(aoa, (x) => x === 'ประจำเดือน', h.r);
  if (mon) { const [m, y] = nextTwoRight(aoa[mon.r], mon.c); out.monthText = norm(m); out.yearBE = norm(y); }
  if (aoa[1]) { out.company = norm(aoa[1][0]); out.taxId = norm(aoa[1][1]); }
  if (!out.hospital) out.warnings.push('ไม่พบชื่อโรงพยาบาล (Vendor)');
  if (!out.invoice) { out.error = 'ไม่พบเลข Invoice'; return out; }

  // คอลัมน์ Amount / Employee ID
  let amtCol = null; let empCol = null;
  for (let r = 0; r <= h.r; r++) {
    (aoa[r] || []).forEach((v, c) => {
      const t = low(v);
      if (t === 'amount' && amtCol == null) amtCol = c;
      if (t === 'employee id' && empCol == null) empCol = c;
    });
  }
  if (amtCol == null) amtCol = h.debitCol + 4;

  const pad = (v) => {
    let s = norm(v);
    if (/^\d+$/.test(s) && s.length < 6) s = s.padStart(6, '0');
    return s;
  };
  const txt = (v) => (isNum(v) ? String(v) : norm(v));

  let firstCredit = null;
  for (let r = h.r + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    if (row.some((v) => norm(v) === 'รวม')) break; // แถวรวมท้ายตาราง
    const jb = pad(row[h.debitCol]);
    const amt = toNum(row[amtCol]);
    if (jb === '' && amt == null) continue;
    if (jb === '' || amt == null) { out.error = `แถว ${r + 1}: ข้อมูลไม่ครบ (สาขา/ยอด)`; return out; }
    // MARKER_GL_MACRO_HOSPITAL_SKIP_VAT_ADJ_V1 -- แถวสรุปท้ายตาราง ("Tax Adjustment", "VAT 7%") ไม่ใช่สาขา
    //   Macro เดิมนับเฉพาะแถวที่มี Employee ID (COUNTA คอลัมน์ Q) จึงไม่ดึง 2 แถวนี้ -> ข้าม + แจ้งเตือน (ไม่รวมในยอด Credit)
    if (!/^[ATF]?\d{4}/i.test(jb) && txt(row[h.debitCol + 1]) === '' && txt(row[h.debitCol + 2]) === '' && (empCol == null || txt(row[empCol]) === '')) {
      // MARKER_GL_MACRO_HOSPITAL_NO_SKIP_WARNING_V1 -- แถวสรุป (Tax Adjustment / VAT 7%) เป็นเรื่องปกติของไฟล์ ข้ามเงียบ ๆ ไม่ใส่หมายเหตุ
      continue;
    }
    const rec = {
      jb, jc: txt(row[h.debitCol + 1]), ja: txt(row[h.debitCol + 2]), js: txt(row[h.debitCol + 3]), amt,
      cb: pad(row[h.creditCol]), cc: txt(row[h.creditCol + 1]), ca: txt(row[h.creditCol + 2]), cs: txt(row[h.creditCol + 3]),
      emp: empCol != null ? txt(row[empCol]) : '', srcRow: r + 1,
    };
    if (!firstCredit && rec.cb) firstCredit = { cb: rec.cb, cc: rec.cc, ca: rec.ca, cs: rec.cs };
    if (empCol != null && rec.emp === '') out.warnings.push(`แถว ${r + 1}: ไม่มี Employee ID`);
    if (amt < 0) out.warnings.push(`แถว ${r + 1}: ยอดติดลบ ${amt}`);
    out.rows.push(rec);
  }
  if (!out.rows.length) { out.error = 'ไม่พบแถวข้อมูล'; return out; }
  if (!firstCredit) { out.error = 'ไม่พบสาขาฝั่งเดินจาก (Credit) ในแถวแรก'; return out; }
  out.credit = firstCredit; // Macro ใช้ค่าฝั่ง Credit ของแถวแรกเท่านั้น
  out.ok = true;
  return out;
}

// ── Period / วันที่ ─────────────────────────────────────────────────────────
export function periodOptions(now = new Date(), back = 3, fwd = 1) {
  const out = [];
  for (let i = -back; i <= fwd; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`);
  }
  return out.reverse();
}
export function parsePeriod(p) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(String(p || '').trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toUpperCase());
  if (mi < 0) return null;
  return { month: mi, year: 2000 + Number(m[2]), mmyy: String(mi + 1).padStart(2, '0') + m[2], mmyyyy: String(mi + 1).padStart(2, '0') + '.' + (2000 + Number(m[2])) };
}
// ตามสูตร B2: เดือนไม่ใช่เดือนปัจจุบัน -> สิ้นเดือน | เดือนปัจจุบัน -> วันนี้   (รูปแบบ DD-MMM-YY)
export function accountingDate(period, now = new Date()) {
  const p = parsePeriod(period);
  if (!p) return '';
  const fmt = (d, m, y) => `${String(d).padStart(2, '0')}-${MON_PROPER[m]}-${String(y).slice(-2)}`;
  if (p.month === now.getMonth() && p.year === now.getFullYear()) return fmt(now.getDate(), now.getMonth(), now.getFullYear());
  return fmt(new Date(p.year, p.month + 1, 0).getDate(), p.month, p.year);
}

// ── Sub-journal source ตามสูตรคอลัมน์ "JV (Auto)" ของ Macro ───────────────────
function journalSource(first, credit) {
  if (first.jb !== credit.cb) return 'SE38';
  if (first.jc !== credit.cc && first.ja !== credit.ca) return 'JA01';
  if (first.ja !== credit.ca) return 'JB01';
  return 'SE38';
}

// ── หา BU เมื่อสาขาไม่อยู่ใน Branch List: Group Range ก่อน แล้วค่อย COM (SEGMENT3) ──
// MARKER_GL_MACRO_IB_BRANCH_COM_FALLBACK_V1
// groupRanges: [{ group_name, range_start, range_end, prefix_length, exclude_start, exclude_end }]
// companies  : [{ bu, segment3 }]
// คืน { bu, via } หรือ null  -- รับเฉพาะกรณีได้ BU เดียวชัดเจน (กำกวม = null -> ไปเป็น Exception)
export function matchGroupRangeName(branchCode, groupRanges) {
  if (!branchCode || !Array.isArray(groupRanges) || !groupRanges.length) return null;
  const clean = String(branchCode).trim().replace(/^[ATF]/i, '');
  let best = null; let bestSpan = Infinity;
  for (const r of groupRanges) {
    const key = r.prefix_length ? clean.slice(0, r.prefix_length) : clean;
    if (r.exclude_start && r.exclude_end && key >= r.exclude_start && key <= r.exclude_end) continue;
    if (key >= r.range_start && key <= r.range_end) {
      const span = (Number(r.range_end) || 0) - (Number(r.range_start) || 0);
      if (span < bestSpan) { bestSpan = span; best = r.group_name; }
    }
  }
  return best;
}
export function resolveBuByCom(branchCode, groupRanges, companies) {
  const code = norm(branchCode);
  if (!code) return null;
  const list = Array.isArray(companies) ? companies : [];
  // 1) Group Range -> ชื่อกลุ่ม (COM เช่น CRG) ต้องตรงกับ BU ใน Company List
  const g = matchGroupRangeName(code, groupRanges);
  if (g) {
    const hit = list.filter((c) => norm(c.bu).toLowerCase() === norm(g).toLowerCase());
    if (hit.length === 1) return { bu: norm(hit[0].bu), via: `Group Range ${g}` };
  }
  // 2) COM = SEGMENT3 ของ Company List -- รหัสสาขาขึ้นต้นด้วย COM 4 หลัก (เช่น 0509Z1 -> 0509)
  const m = /^[ATF]?(\d{4})/i.exec(code);
  if (m) {
    const bus = [...new Set(list.filter((c) => norm(c.segment3) === m[1]).map((c) => norm(c.bu)).filter(Boolean))];
    if (bus.length === 1) return { bu: bus[0], via: `COM ${m[1]}` };
  }
  return null;
}

// ── รวม + แยก BU + สร้างรายการ ────────────────────────────────────────────────
// files: [{ name, parsed }]   ctx: { period, accDate, buOfBranch(code)->bu|'', companyOf(bu)->{ companyCode, name } }
export function buildIbHospital(files, ctx) {
  const per = parsePeriod(ctx.period);
  const exceptions = [];
  const groups = new Map(); // bu -> { bu, parts, entries[] }
  const sorted = [...files].sort((a, b) => { const x = a.name.toLowerCase(); const y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  if (!per) return { groups: [], exceptions: [{ file: '-', reason: `Period ไม่ถูกต้อง: ${ctx.period}`, amount: null }], warnings: [] };

  sorted.forEach((f) => {
    const p = f.parsed;
    const total = p && p.rows ? round2(p.rows.reduce((s, r) => s + r.amt, 0)) : null;
    const ex = (reason) => exceptions.push({ file: f.name, hospital: p ? p.hospital : '', invoice: p ? p.invoice : '', reason, amount: total });
    if (!p || !p.ok) { ex(p && p.error ? p.error : 'อ่านไฟล์ไม่ได้'); return; }
    const credit = p.credit;
    const codes = [...new Set([credit.cb, ...p.rows.map((r) => r.jb)])];
    // MARKER_GL_MACRO_IB_BRANCH_COM_FALLBACK_V1 -- ไม่พบสาขาใน Branch List -> พิสูจน์ด้วย Group Range / COM (ctx.viaOf) ก่อนค่อยตกเป็น Exception
    const missing = codes.filter((c) => !ctx.buOfBranch(c));
    if (missing.length) { ex(`ไม่พบสาขาใน Branch List และพิสูจน์ด้วย Group Range/COM ไม่ได้: ${missing.join(', ')}`); return; }
    if (typeof ctx.viaOf === 'function') {
      codes.forEach((c) => { const v = ctx.viaOf(c); if (v) p.warnings.push(`สาขา ${c} ไม่อยู่ใน Branch List -- พิสูจน์ BU ${v.bu} ด้วย ${v.via}`); });
    }
    const bus = [...new Set(codes.map((c) => ctx.buOfBranch(c)))];
    if (bus.length > 1) { ex(`สาขาอยู่คนละ BU: ${bus.join(', ')}`); return; }
    const bu = bus[0];
    const co = ctx.companyOf(bu);
    const parts = String((co && co.companyCode) || '').split('-').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) { ex(`ไม่พบ COMPANY CODE (Bus-Grp-Com) ของ BU ${bu}`); return; }
    if (!groups.has(bu)) groups.set(bu, { bu, company: (co && co.name) || '', bus: parts[0], grp: parts[1], com: parts[2], entries: [] });
    const sameBranch = !p.rows.some((r) => r.jb !== credit.cb);
    groups.get(bu).entries.push({ file: f.name, p, total, sameBranch });
  });

  const warnings = [];
  const out = [];
  groups.forEach((g) => {
    const lines = [];
    const fileRows = [];
    const seenInv = new Map();
    let run = 0;
    g.entries.forEach((e) => {
      const { p } = e;
      run += 1;
      const sj = journalSource(p.rows[0], p.credit);
      const journal = `APN-${sj}-${g.com}-OTH-IB-${String(run).padStart(3, '0')}`;
      const desc = `IB-${per.mmyyyy} ค่ารักษาพยาบาล|${p.invoice}|${p.hospital}`;
      const base = {
        category: `${g.com}-IB-ALL`, source: 'Excel-APN', accDate: ctx.accDate, bus: g.bus, grp: g.grp, com: g.com,
        period: ctx.period, batch: `APN-${per.mmyy}-${g.com}-OTH-IB-001`, batchDesc: '', journal, journalDesc: '', desc,
      };
      p.rows.forEach((r) => lines.push({ ...base, branch: r.jb, cpc: r.jc, acc: r.ja, sub: r.js, debit: r.amt, credit: null, file: e.file }));
      lines.push({ ...base, branch: p.credit.cb, cpc: p.credit.cc, acc: p.credit.ca, sub: p.credit.cs, debit: null, credit: e.total, file: e.file });
      const dup = seenInv.get(p.invoice);
      seenInv.set(p.invoice, (dup || 0) + 1);
      const note = [...p.warnings];
      if (e.sameBranch) note.push('สาขาเดินจาก = เดินเข้าทุกแถว (ต่างกันที่ CPC) -- สร้างเป็น IB ตามที่กำหนด');
      fileRows.push({ file: e.file, hospital: p.hospital, invoice: p.invoice, rows: p.rows.length, amount: e.total, journal, note });
    });
    fileRows.forEach((fr) => { if (seenInv.get(fr.invoice) > 1) { fr.note.push('Invoice ซ้ำกับไฟล์อื่นใน BU เดียวกัน'); warnings.push(`BU ${g.bu}: Invoice ${fr.invoice} ซ้ำ`); } });
    const debit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
    const credit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
    out.push({ ...g, entries: undefined, lines, files: fileRows, debit, credit, diff: round2(debit - credit), balanced: Math.abs(debit - credit) < 0.005 });
  });
  out.sort((a, b) => (a.bu < b.bu ? -1 : a.bu > b.bu ? 1 : 0));
  return { groups: out, exceptions, warnings };
}

export const IB_ADI_COLUMNS = [
  { key: 'category', header: 'Category', width: 14 }, { key: 'source', header: 'Source', width: 11 },
  { key: 'accDate', header: 'Acc Date', width: 11 }, { key: 'bus', header: 'Bus', width: 5 },
  { key: 'grp', header: 'Grp', width: 5 }, { key: 'com', header: 'Com', width: 7 },
  { key: 'branch', header: 'Branch', width: 9 }, { key: 'cpc', header: 'CPC', width: 8 },
  { key: 'acc', header: 'Acc', width: 10 }, { key: 'sub', header: 'Sub_Acc', width: 9 },
  { key: 'debit', header: 'Debit', width: 14, type: 'amount' }, { key: 'credit', header: 'Credit', width: 14, type: 'amount' },
  { key: 'period', header: 'Period', width: 9 }, { key: 'batch', header: 'Batch Name', width: 26 },
  { key: 'batchDesc', header: 'Batch Description', width: 8 }, { key: 'journal', header: 'Journal Name', width: 30 },
  { key: 'journalDesc', header: 'Journal Description', width: 8 }, { key: 'desc', header: 'Line Description', width: 72 },
];
