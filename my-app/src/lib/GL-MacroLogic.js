// GL-MacroLogic.js
// MARKER_GL_MACROLOGIC_PARSER_V1
// ─────────────────────────────────────────────────────────────────────────
// Pure-function parser สำหรับ "Generate by GL Macro" -- ไม่มี React/DOM เจือปน
//
// ที่มา: พอร์ตจาก Logic เดิมของ Macro  M_Vendor Payment History Summary.xlsm
//   (Module General.bas -> M_VendorPayment_Cutting + Function_FT.bas)
// Macro เดิมวางข้อความรายงาน Oracle ลงชีต Detail คอลัมน์ A (บรรทัดละแถว) แล้วใส่สูตร
// MID(...) ตามตำแหน่งตัวอักษรตายตัวลง Column R:AG -- ไฟล์นี้ทำเหมือนกันทุกขั้นแต่ใช้
// String Slicing ใน JS แทนสูตร Excel (ตำแหน่ง MID ทุกตัวเป็นเลขเดียวกับของเดิม)
//
// รายงานที่รองรับตอนนี้: VENDOR_PAYMENT_HISTORY (Vendor Payment History Report (NEW))
// ─────────────────────────────────────────────────────────────────────────

export const GL_MACRO_TYPES = {
  VENDOR_PAYMENT_HISTORY: 'VENDOR_PAYMENT_HISTORY',
  VENDOR_PAYMENT_HISTORY_OLD: 'VENDOR_PAYMENT_HISTORY_OLD', // รุ่นเก่า (APCRC039) -- Macro เดิมไม่รองรับ
};

export const GL_MACRO_TYPE_LABEL = {
  VENDOR_PAYMENT_HISTORY: 'Vendor Payment History',
  VENDOR_PAYMENT_HISTORY_OLD: 'Vendor Payment History (รุ่นเก่า)',
};

// ── รหัส 4 ตัวหน้าของ Branch ที่ Macro เดิมยอมรับ (Check_BU_TaxID_VD) ──────────
// ถ้า 6 ตัวอักษรแรกของบรรทัดเป็น Branch Code และ 4 ตัวหน้าอยู่ในรายการนี้ -> ใช้เป็น Branch
// (เพิ่ม BU ใหม่ที่นี่ที่เดียว)
export const GL_BRANCH_PREFIXES = new Set([
  '0572', '8703', '0511', '3218', '0109', '8125', '8128', '8136', '8204', '8707', '8232',
]);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// บรรทัดธนาคาร (ตัวเริ่ม Block การจ่ายเงิน) -- ค่า Cur/Batch/Due/PaymentDoc/Bank จะถูกส่งลงไปให้ Invoice ที่ตามมา
const BANK_MARKS = ['-MONEY-', '-KBANK-', '-SCBB-', '-SCB-', '-TMBB-', '-TMB-', '-BBL-', '-DUMMY-'];
// บรรทัดที่ไม่ใช่รายการ Invoice แม้จะมีชื่อเดือนอยู่ในบรรทัด
const EXCLUDE_MARKS = ['START DATE', 'END DATE', 'REPORT DATE', 'ADDRES', ...BANK_MARKS];

// MID(text, start, len) ของ Excel (start เริ่มที่ 1)
const mid = (s, start, len) => String(s == null ? '' : s).substr(start - 1, len);
const hasAny = (upper, marks) => marks.some(m => upper.includes(m));

// ── แปลงข้อความวันที่ (03-SEP-2026 / 03-Sep-26 / 03/09/2026) -> Date | null ──
export function parseOraDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})/);
  if (m) {
    const mon = MONTHS.indexOf(m[2].toUpperCase());
    if (mon < 0) return null;
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, mon, Number(m[1]))); // UTC เที่ยงคืน กัน Excel/ExcelJS เลื่อนวันตามเขตเวลา
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return null;
}

export function formatOraDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()];
  const mm = mon.charAt(0) + mon.slice(1).toLowerCase();
  return `${dd}-${mm}-${String(d.getUTCFullYear()).slice(-2)}`;
}

// ── แปลงข้อความจำนวนเงิน -> number (รองรับ 1,234.50 / (1,234.50) / 1,234.50-) ──
export function toAmount(raw) {
  const t = String(raw || '').trim();
  if (!t) return 0;
  const m = t.match(/\(?-?[\d,]*\.?\d+\)?-?/);
  if (!m) return 0;
  const token = m[0];
  const neg = /^\(.*\)$/.test(token) || token.includes('-');
  const n = parseFloat(token.replace(/[(),-]/g, ''));
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

// ── ตรวจจับว่าข้อความที่วางเข้ามาเป็นรายงานประเภทไหน (null = ไม่รู้จัก) ────────
export function detectGlMacroType(rawText) {
  if (!rawText) return null;
  const head = String(rawText).slice(0, 6000);
  if (/Vendor Payment History Report/i.test(head)) {
    // รุ่นที่ Macro รองรับ = "Vendor Payment History Report (Custom) (New)" (APCRC305)
    // รุ่นเก่า "(Custom)" (APCRC039) เรียงคอลัมน์คนละแบบ -> ไม่อ่านเพราะตำแหน่งจะเลื่อนทั้งหมด
    return /\(\s*New\s*\)/i.test(head) ? GL_MACRO_TYPES.VENDOR_PAYMENT_HISTORY : GL_MACRO_TYPES.VENDOR_PAYMENT_HISTORY_OLD;
  }
  return null;
}

// ── Parse Vendor Payment History Report (NEW) ───────────────────────────────
// คืน { rows, meta }  rows[] = แถว Invoice (เรียงตามลำดับในรายงาน เหมือนการ Sort A,B ของ Macro เดิม)
export function parseVendorPaymentHistory(rawText) {
  const lines = String(rawText || '').replace(/\r/g, '').split('\n');
  const meta = { startDate: '', endDate: '', totalLines: lines.length, branchCodes: [], error: null };

  // วันที่ในหัวรายงาน: Macro เดิมอ่านบรรทัดที่ 6 และ 7 ที่ MID(26,10) -- หาจาก Label ก่อน ไม่เจอค่อย Fallback ตำแหน่งเดิม
  const head = lines.slice(0, 20);
  const findLabelDate = (label) => {
    for (const ln of head) {
      const m = ln.match(new RegExp(label + '\\s*:?\\s*([0-9A-Za-z\\-\\/]+)', 'i'));
      if (m) { const d = parseOraDate(m[1]); if (d) return formatOraDate(d); }
    }
    return '';
  };
  meta.startDate = findLabelDate('Start Date') || formatOraDate(parseOraDate(mid(lines[5], 26, 10)));
  meta.endDate = findLabelDate('End Date') || formatOraDate(parseOraDate(mid(lines[6], 26, 10)));

  let name = '', vendor = '', site = '', branch = '';
  let cur = '', batch = '', due = '', payDoc = '', bank = '';
  const rows = [];
  const branchSet = new Set();
  // ── เทียบยอดกับรายงาน: Vendor Total / Report Total ที่พิมพ์ไว้ในรายงาน vs ยอด Amount Paid ที่ดึงได้ ──
  const recVendors = [];
  let vAcc = { parsed: 0, count: 0, curs: new Set(), name: '', vendorNumber: '', payFunc: 0, payCount: 0 };
  let reportTotal = null;
  // ── การจ่ายเงิน (Payment) ระดับ Functional Amount (บาท): ยอดนี้คือฐานของ Vendor Total / Report Total ──
  // นับเฉพาะบรรทัดที่มี Document Name (บรรทัดแรกของการจ่าย) และไม่มี Void Date
  // (บรรทัดที่ซ้ำเมื่อขึ้นหน้าใหม่ไม่มี Document Name -> ข้าม)
  const payRe = /^ {2}(\S.{0,17}?)\s+(\d{3,})\s+(\d\d-[A-Za-z]{3}-\d\d)\s+(\(?[\d,]+\.\d\d\)?)\s+([A-Z]{3})\s+(\(?[\d,]+\.\d\d\)?)(.*)$/;
  const payments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] == null ? '' : lines[i];
    const U = line.toUpperCase();

    // Name (R): บรรทัด Vendor: -> ชื่อ | "Payment End" -> ว่าง | อื่นๆ -> ใช้ค่าบรรทัดก่อนหน้า
    if (U.includes('VENDOR:')) {
      name = U.includes('PAYMENT END') ? '' : line.split('     Vendor: ').join('');
    }
    // Vendor Number (S)
    if (U.includes('NUMBER:')) vendor = line.split('     Number: ').join('');
    else if (name === '') vendor = '';
    // Site (T)
    if (U.includes('SITE:')) site = line.split('       Site: ').join('');
    else if (name === '') site = '';
    // Branch (U): 6 ตัวแรกของบรรทัด ถ้า 4 ตัวหน้าอยู่ในรายการ BU ที่ยอมรับ
    const b10 = mid(line, 1, 10).trim();
    const lineHasBranch = b10.length === 6 && GL_BRANCH_PREFIXES.has(b10.slice(0, 4));
    if (lineHasBranch) branch = b10;

    // GR Transaction (V): บรรทัดที่มีชื่อเดือน + ไม่ใช่หัวรายงาน/บรรทัดธนาคาร + มี Site แล้ว + ไม่ใช่บรรทัดรวม
    let gr = '';
    // ปรับให้สะอาดกว่า Macro เดิม: แถว Invoice จริงต้องมี Inv. Date ที่ตำแหน่ง 44 (บรรทัดต่อเนื่องของ Branch เดียวกันไม่มี Branch แต่มีวันที่เสมอ)
    // -> ตัดบรรทัดขยะที่ Macro เดิมหลุดมา (บรรทัดสรุปยอดจ่าย / บรรทัด Vendor: ที่ชื่อมีคำว่า MAY, MAR ฯลฯ)
    const lineHasDate = !!parseOraDate(mid(line, 44, 20).trim());
    if (lineHasDate && hasAny(U, MONTHS)) {
      if (hasAny(U, EXCLUDE_MARKS)) gr = '';
      else if (site === '' || U.includes('    TOTAL VENDOR QUANTITY')) gr = '';
      else gr = mid(line, 11, 35).trim();
    }

    // บรรทัดธนาคาร: ตั้งค่า Cur / Batch / Due / Payment Doc / Account Bank ให้ Invoice ที่ตามมา
    if (hasAny(U, BANK_MARKS)) {
      cur = mid(line, 73, 10).trim();
      batch = mid(line, 119, 100).trim();
      due = formatOraDate(parseOraDate(mid(line, 37, 12).trim())) || mid(line, 37, 12).trim();
      payDoc = mid(line, 25, 12).trim();
      bank = mid(line, 1, 20).trim() + mid(lines[i + 1], 1, 20).trim();
    }

    const pm = line.match(payRe);
    if (pm && pm[7].trim().length > 0 && !/^\s*\d\d-[A-Za-z]{3}-\d\d/.test(pm[7].slice(0, 16))) {
      const func = toAmount(pm[6]);
      payments.push({ vendorNumber: vendor.trim(), name: name.trim(), site: site.trim(), account: pm[1].trim(), paymentNumber: pm[2], paymentDate: pm[3], paymentAmount: toAmount(pm[4]), cur: pm[5], functional: func, documentName: pm[7].trim() });
      vAcc.payFunc += func; vAcc.payCount += 1;
    }

    // Vendor Total / Report Total (บรรทัดสรุปของรายงาน)
    const vtm = line.match(/Vendor Total:\s*(\(?[\d,]+\.\d\d\)?-?)/i);
    if (vtm) {
      const vt = toAmount(vtm[1]);
      recVendors.push({
        name: vAcc.name, vendorNumber: vAcc.vendorNumber, vendorTotal: vt, parsed: Math.round(vAcc.parsed * 100) / 100,
        diff: Math.round((vt - vAcc.parsed) * 100) / 100, curs: [...vAcc.curs], count: vAcc.count,
        payFunctional: Math.round(vAcc.payFunc * 100) / 100, payCount: vAcc.payCount,
        payDiff: Math.round((vt - vAcc.payFunc) * 100) / 100,
      });
      vAcc = { parsed: 0, count: 0, curs: new Set(), name: '', vendorNumber: '', payFunc: 0, payCount: 0 };
    }
    const rtm = line.match(/Report Total:\s*(\(?[\d,]+\.\d\d\)?-?)/i);
    if (rtm) reportTotal = toAmount(rtm[1]);

    if (gr !== '') {
      const docDate = parseOraDate(mid(line, 44, 20).trim());
      if (branch) branchSet.add(branch);
      rows.push({
        branch,
        name: name.trim(),
        vendorNumber: vendor.trim(),
        site: site.trim(),
        grTrans: gr,
        docDate,
        invoiceNumber: mid(line, 142, 30).trim(),
        amtInv: toAmount(mid(line, 57, 27)),
        whtInv: toAmount(mid(line, 97, 27)),
        totalInv: toAmount(mid(line, 120, 22)),
        description: mid(line, 175, 30).trim(),
        cur,
        batchName: batch,
        dueDate: due,
        paymentDoc: payDoc,
        accountBank: bank,
      });
      const last = rows[rows.length - 1];
      vAcc.parsed += last.totalInv; vAcc.count += 1; vAcc.name = last.name; vAcc.vendorNumber = last.vendorNumber;
      if (last.cur) vAcc.curs.add(last.cur);
    }
  }

  meta.branchCodes = [...branchSet];
  const parsedTotal = Math.round(rows.reduce((a, r) => a + r.totalInv, 0) * 100) / 100;
  const vendorSum = Math.round(recVendors.reduce((a, v) => a + v.vendorTotal, 0) * 100) / 100;
  meta.reconcile = {
    reportTotal, vendorSum, parsedTotal,
    diff: reportTotal == null ? null : Math.round((reportTotal - parsedTotal) * 100) / 100,
    vendors: recVendors,
    mismatches: recVendors.filter(v => Math.abs(v.diff) > 0.005),
    payments,
    paymentTotal: Math.round(payments.reduce((a, x) => a + x.functional, 0) * 100) / 100,
    paymentMismatches: recVendors.filter(v => Math.abs(v.payDiff) > 0.05),
  };
  meta.reconcile.paymentDiff = reportTotal == null ? null : Math.round((reportTotal - meta.reconcile.paymentTotal) * 100) / 100;
  if (rows.length === 0) {
    meta.error = 'ไม่พบรายการ Invoice ในรายงานนี้ (ตรวจว่าเป็น Vendor Payment History Report (NEW) และวางข้อความครบทุกบรรทัด)';
  }
  return { rows, meta };
}

// ── คอลัมน์ในไฟล์ Excel ที่ Generate (ตรงกับชีต Pre-Export/AP07 ของ Macro เดิม A:P) ──
export const GL_VPH_COLUMNS = [
  { key: 'branch',        header: 'Branch',         width: 15.6 },
  { key: 'name',          header: 'Name',           width: 42.3 },
  { key: 'vendorNumber',  header: 'Vendor Number',  width: 14.3 },
  { key: 'site',          header: 'Site',           width: 13.0 },
  { key: 'grTrans',       header: 'GR Trans',       width: 17.8 },
  { key: 'docDate',       header: 'Doc Date.',      width: 14.3, type: 'date' },
  { key: 'invoiceNumber', header: 'Invoice Number', width: 19.6 },
  { key: 'amtInv',        header: 'Amt Inv.',       width: 14.1, type: 'amount' },
  { key: 'whtInv',        header: 'Wht Inv.',       width: 14.1, type: 'amount' },
  { key: 'totalInv',      header: 'Total Inv.',     width: 14.1, type: 'amount' },
  { key: 'description',   header: 'Description',    width: 28.3 },
  { key: 'cur',           header: 'Cur',            width: 6.0 },
  { key: 'batchName',     header: 'Batch Name',     width: 20.6 },
  { key: 'dueDate',       header: 'Due Date',       width: 10.0 },
  { key: 'paymentDoc',    header: 'Payment Doc',    width: 12.5 },
  { key: 'accountBank',   header: 'Account Bank',   width: 21.3 },
];
