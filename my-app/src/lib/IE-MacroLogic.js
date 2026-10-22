// ieOraTextParser.js
// MARKER_IE_ORATEXT_PARSER_V1
// ─────────────────────────────────────────────────────────────────────────
// Pure-function parser สำหรับแปลง Oracle EBS Text Report (Paste/Upload) เป็น
// Array ข้อมูลตาม Report Type — ไม่มี React/DOM เจือปน เรียกใช้จากหน้าเว็บ
// หรือ Unit Test ตรงๆ ได้เลย
//
// ที่มา: แปลงจาก Logic เดิมของ Macro (Copy_of_Macro_Prepayment_Process_06-02-2007__new_.xlsm
// -> Module1.Process_Main / Process_Step2) เอา ActiveCell/Excel COM Overhead ออกทั้งหมด
// ใช้ String Slicing ล้วนๆ จึงเร็วกว่าตัว Macro เดิมมาก และแก้ Bug เดิม
// (Supplier Name ที่ Wrap ไปอีกบรรทัด ไม่ถูกดึงกลับมาต่อให้ใน Process_Step2)
// ─────────────────────────────────────────────────────────────────────────

export const ORA_REPORT_TYPES = {
  PREPAYMENT: 'PREPAYMENT',
};

// ── ตรวจจับว่าไฟล์/ข้อความที่วางเข้ามาเป็นรายงานประเภทไหน ──────────────────
export function detectOraReportType(rawText) {
  if (!rawText) return null;
  const head = rawText.slice(0, 3000);
  if (/Prepayment Status Report/i.test(head)) return ORA_REPORT_TYPES.PREPAYMENT;
  return null; // เผื่ออนาคตเพิ่ม Report Type อื่น เพิ่ม if ที่นี่ที่เดียว
}

// MARKER_IE_MACROLOGIC_ANCHOR_PARSER_V2
// ── เปลี่ยนจาก Fixed-width (นับตำแหน่งตัวอักษรตายตัว) เป็น Anchor-based ──────
// ── เพราะ Fixed-width เปราะมาก: ถ้า Column ไหนขยับแม้แค่ 1 ตัวอักษร (เช่น
// ── Supplier Name ยาวผิดปกติ) จะทำให้ Field ถัดไปเยื้องและถูกตัดข้อมูลหาย ──
// ── ใช้ "จุดสังเกต" ที่รูปแบบตายตัวเสมอแทน: วันที่ (DD-MMM-YYYY), คำว่า
// ── "Prepayment", และตัวเลขจำนวนเงิน (#,###.##) — ต่อให้ Column ขยับแค่ไหน
// ── ก็ยังหาตำแหน่งถูก ไม่ตัดข้อมูลหาย
const DATE_RE = /\d{2}-[A-Z]{3}-\d{4}/g;
const AMOUNT_RE = /\(?-?[\d,]+\.\d{2}\)?/g;
const INVOICE_TYPE_WORDS = ['Prepayment']; // เผื่ออนาคต Report มี Type อื่น เพิ่มในนี้ที่เดียว

function splitBy2Spaces(s) {
  return String(s || '').split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
}

// พยายาม Extract 1 บรรทัดด้วย Anchor — คืน null ถ้าไม่ใช่บรรทัดข้อมูลจริง
function extractPrepaymentFields(line) {
  if (!line) return null;

  // Anchor 1: Invoice Type (คำตายตัว) — แยก Supplier ออกจาก Invoice Number
  let typeWord = null, typeIdx = -1;
  for (const w of INVOICE_TYPE_WORDS) {
    const idx = line.indexOf(w);
    if (idx !== -1) { typeWord = w; typeIdx = idx; break; }
  }
  if (typeIdx === -1) return null;
  const typeEnd = typeIdx + typeWord.length;

  // Anchor 2: วันที่ 2 ตัว (Invoice Date, Settlement Date) หลัง Invoice Type
  DATE_RE.lastIndex = typeEnd;
  const d1 = DATE_RE.exec(line);
  if (!d1) return null;
  DATE_RE.lastIndex = d1.index + d1[0].length;
  const d2 = DATE_RE.exec(line);
  if (!d2) return null;

  // ซ้าย Invoice Type = Supplier Name + Supplier Number
  const leftTokens = splitBy2Spaces(line.slice(0, typeIdx));
  const supplierName = leftTokens[0] || '';
  const supplierNumber = leftTokens[1] || '';

  // ระหว่าง Invoice Type กับวันที่แรก = Invoice Number + Voucher Number
  const midTokens = splitBy2Spaces(line.slice(typeEnd, d1.index));
  const invoiceNumber = midTokens[0] || '';
  const voucherNumber = midTokens[1] || '';

  // Anchor 3: ตัวเลขจำนวนเงิน 3 ตัวแรกหลังวันที่ที่สอง = Invoice/Withheld/Remaining Amount
  // ที่เหลือหลังตัวเลขตัวที่ 3 = Description (เอาไปเลย ไม่ตัดทิ้งแม้จะยาว/มีช่องว่างเยอะแค่ไหน)
  const afterDates = line.slice(d2.index + d2[0].length);
  AMOUNT_RE.lastIndex = 0;
  const nums = [];
  let m;
  while (nums.length < 3 && (m = AMOUNT_RE.exec(afterDates))) nums.push(m);

  if (nums.length < 3) {
    // MARKER_IE_MACROLOGIC_UNPAID_FALLBACK_V1 — บาง Row Amount Remaining เป็นคำว่า
    // "Unpaid" (Status) แทนตัวเลข ไม่ใช่รูปแบบ #,###.## — เจอแค่ 2 ตัวเลข (Invoice/Withheld)
    // แทนที่จะทิ้งทั้งแถว ให้เก็บไว้ (AmountRemaining = 0) แล้วเอาข้อความที่เหลือ
    // (รวมคำว่า "Unpaid") ไปต่อท้าย Description แทน — ข้อมูลไม่หายไปไหน
    if (nums.length === 2) {
      const description2 = afterDates.slice(nums[1].index + nums[1][0].length).trim();
      return {
        supplierName, supplierNumber, invoiceType: typeWord,
        invoiceNumber, voucherNumber,
        invoiceDate: d1[0], settlementDate: d2[0],
        invoiceAmount: parseAmount(nums[0][0]),
        withheldAmount: parseAmount(nums[1][0]),
        amountRemaining: 0,
        description: description2,
      };
    }
    // เจอตัวเลขแค่ 1 ตัว (ยิ่งผิดปกติกว่า Unpaid) — ยังเก็บแถวไว้ ดีกว่าทิ้งข้อมูลหาย
    // เอาไปเป็น Invoice Amount ส่วน Withheld/Remaining = 0 แล้ว Log เตือนไว้ให้ตรวจสอบ
    if (nums.length === 1) {
      console.warn('[IE-MacroLogic] พบแค่ 1 จำนวนเงินในแถวนี้ (ปกติต้องมี 3) — ตรวจสอบ Invoice Number:', invoiceNumber, '| Raw line:', line);
      const description1 = afterDates.slice(nums[0].index + nums[0][0].length).trim();
      return {
        supplierName, supplierNumber, invoiceType: typeWord,
        invoiceNumber, voucherNumber,
        invoiceDate: d1[0], settlementDate: d2[0],
        invoiceAmount: parseAmount(nums[0][0]),
        withheldAmount: 0,
        amountRemaining: 0,
        description: description1,
      };
    }
    // ไม่เจอจำนวนเงินเลยแม้แต่ตัวเดียว — ไม่น่าใช่บรรทัดข้อมูลจริง (อาจเป็น False-positive
    // จากคำว่า "Prepayment" ที่ไปโผล่ในข้อความอื่น) Log เตือนไว้เผื่อต้องตรวจสอบภายหลัง
    console.warn('[IE-MacroLogic] เจอคำว่า "Prepayment" + วันที่ 2 ตัว แต่ไม่มีจำนวนเงินเลย — ข้ามบรรทัดนี้ (อาจไม่ใช่บรรทัดข้อมูลจริง):', line);
    return null;
  }

  const description = afterDates.slice(nums[2].index + nums[2][0].length).trim();

  return {
    supplierName, supplierNumber, invoiceType: typeWord,
    invoiceNumber, voucherNumber,
    invoiceDate: d1[0], settlementDate: d2[0],
    invoiceAmount: parseAmount(nums[0][0]),
    withheldAmount: parseAmount(nums[1][0]),
    amountRemaining: parseAmount(nums[2][0]),
    description,
  };
}

// MARKER_IE_MACROLOGIC_CONTINUATION_ANCHOR_FIX_V1
// ── บรรทัดต่อเนื่องของ Supplier Name ที่ยาวเกิน Wrap ไปอีกบรรทัด — เดิมเช็ค
// ── ด้วยตำแหน่งตัวอักษรตายตัว (slice(0,29)) ซึ่งเป็นความเสี่ยงเดียวกับ Bug
// ── ที่เพิ่งแก้ไป (Column ขยับได้) เปลี่ยนมาเช็คด้วยลักษณะเนื้อหาแทน:
// ── บรรทัดต่อเนื่องจริงจะมีแค่ "ก้อนข้อความก้อนเดียว" ไม่มี ":" (ไม่ใช่บรรทัด
// ── Context เช่น "Branch Name:"), ไม่มีจำนวนเงิน (ไม่ใช่บรรทัด Subtotal/Total),
// ── ไม่ใช่เส้นประ และไม่มีรูปแบบวันที่ (ไม่ใช่บรรทัดข้อมูล)
function isSupplierNameContinuation(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.includes(':')) return false; // บรรทัด Context เช่น "Branch Name: xxx"
  if (!/[A-Za-zก-๙0-9]/.test(trimmed)) return false; // บรรทัดเส้นประ/เส้นคู่ (---, ===) ไม่มีตัวอักษร/ตัวเลขเลย
  // MARKER_IE_MACROLOGIC_FOOTER_EXCLUDE_V1 — ท้ายไฟล์ Ora Text มักมี "Grand Total for
  // Report" / "*** End of Report ***" ต่อท้ายแถวข้อมูลสุดท้าย ซึ่งไม่มี Colon/ตัวเลข/วันที่
  // เหมือนกัน ต้องกันแยกไว้ชัดๆ ไม่งั้นหลุดไปต่อท้าย Supplier Name แถวสุดท้ายผิดพลาด
  if (/Grand Total|Total for|End of Report/i.test(trimmed)) return false;

  AMOUNT_RE.lastIndex = 0;
  if (AMOUNT_RE.test(trimmed)) return false; // มีจำนวนเงิน = Subtotal/Total ไม่ใช่ชื่อ Supplier
  AMOUNT_RE.lastIndex = 0;

  DATE_RE.lastIndex = 0;
  if (DATE_RE.test(trimmed)) return false; // กันพลาด ไม่ควรเป็นบรรทัดข้อมูลอยู่แล้ว
  DATE_RE.lastIndex = 0;

  return splitBy2Spaces(line).length === 1; // มีแค่ก้อนข้อความเดียว ไม่มี Column อื่นปน
}

function parseAmount(str) {
  const cleaned = String(str || '').replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const neg = /^\(.*\)$/.test(cleaned); // Oracle แสดงติดลบด้วยวงเล็บ เช่น (1,234.56)
  const num = parseFloat(cleaned.replace(/[()]/g, ''));
  return Number.isNaN(num) ? 0 : (neg ? -num : num);
}

const ORA_MONTH_IDX = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// MARKER_IE_MACROLOGIC_AGING_V1 — จำนวนวันจาก Invoice Date (DD-MMM-YYYY) ถึงวันนี้ ('' ถ้าอ่านวันที่ไม่ได้)
function calcDaysOutstanding(oraDate, todayUtc) {
  const m = String(oraDate || '').match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  if (!m || ORA_MONTH_IDX[m[2]] === undefined) return '';
  const d = Date.UTC(Number(m[3]), ORA_MONTH_IDX[m[2]], Number(m[1]));
  return Math.round((todayUtc - d) / 86400000);
}

// ช่วง Aging (วัน): A 0-15 | B 16-30 | C 31-60 | D 61-90 | E 91-180 | F >180
export function getAgingBucket(days) {
  if (days === '' || days == null) return '';
  if (days <= 15) return 'A - Below 15 Days';
  if (days <= 30) return 'B - Below 30 Days';
  if (days <= 60) return 'C - 2 Month';
  if (days <= 90) return 'D - 3 Month';
  if (days <= 180) return 'E - 4-6 Month';
  return 'F - Over 6 Month';
}

// MARKER_IE_MACROLOGIC_TOPS_LAYOUT_V1 -- เติมคอลัมน์ Aging (Remark/Currency/Category/Days/Status) ใช้ร่วมกันทุกรูปแบบรายงาน
function applyPrepaymentAging(rows) {
  const now = new Date();
  const cutoffUtc = Date.UTC(now.getFullYear(), now.getMonth(), 0);
  rows.forEach(r => {
    const days = (r.amountRemaining || 0) === 0 ? 0 : calcDaysOutstanding(r.invoiceDate, cutoffUtc);
    r.remark = '';
    r.currency = 'THB';
    r.category = 'IE Advance';
    r.daysOutstanding = days;
    r.status = (r.amountRemaining || 0) === 0 ? 'Settled/Unpaid' : getAgingBucket(days);
  });
}

// MARKER_IE_MACROLOGIC_TOPS_LAYOUT_V1 -- รายงานรูปแบบ TOPS ("Prepayment Status Report for IE (custom)"): จัดกลุ่ม Branch -> Employee
//   บรรทัดสาขา "Branch :  040101" / บรรทัดพนักงาน "Employee :  ชื่อ" / แถวข้อมูล: PREPAYMENT | Invoice No | Invoice Date(ปี 2 หลัก) | Employee(ถูกตัด) | Job | Dept | Tel | Approver | Payment Date | Expected Clear Date | Overdue | Invoice Amt | Remaining | Description...
//   แปลงให้ได้แถวหน้าตาเดียวกับรูปแบบแรก: supplierName = ชื่อพนักงาน, วันที่ปี 2 หลัก -> DD-MMM-YYYY, settlementDate = Payment Date, withheld = 0
const TOPS_DATE_RE = /\b(\d{2})-([A-Z]{3})-(\d{2,4})\b/g;
const TOPS_MONEY_RE = /\(?-?\d[\d,]*\.\d{2}\)?/g;
const normOraDate = (d) => String(d || '').replace(/^(\d{2}-[A-Z]{3}-)(\d{2})$/, (m, a, y) => a + (2000 + Number(y)));
export function isTopsLayout(rawText) {
  const t = String(rawText || '');
  return /^\s*Branch\s*:\s*\S+/m.test(t) && /^\s*Employee\s*:/m.test(t) && !/Branch\s+Name:/.test(t);
}
export function parsePrepaymentTopsText(rawText) {
  const rows = []; let last = null; let branch = ''; let employee = '';
  let spans = [[0,14],[15,27],[28,40],[41,61],[62,69],[70,84],[85,102],[103,118],[119,129],[131,141],[142,152],[153,168],[169,187],[191,221],[225,254]]; // ตำแหน่งคอลัมน์ (อ่านจากบรรทัดขีดของไฟล์ได้ ถ้าไม่เจอใช้ค่านี้)
  const cut = (line, i) => (spans[i] ? line.slice(spans[i][0], spans[i][1]).trim() : '');
  String(rawText || '').split(/\r\n|\r|\n/).forEach((raw) => {
    const line = raw.replace(/\f/g, '').replace(/_x000C_/g, '');
    if (/^\s*-{10,}\s+-{8,}\s+-{8,}\s+-{10,}/.test(line)) { const sp = [...line.matchAll(/-+/g)].map(x => [x.index, x.index + x[0].length]); if (sp.length >= 15) spans = sp; return; }
    let m = line.match(/^\s*Branch\s*:\s*(\S+)/); if (m) { branch = m[1]; last = null; return; }
    m = line.match(/^\s*Employee\s*:\s*(.+?)\s*$/); if (m) { employee = m[1].replace(/\s{2,}/g, ' '); last = null; return; }
    m = line.match(/^\s*PREPAYMENT\s+(\S+)\s+(\d{2}-[A-Z]{3}-\d{2,4})\s/i);
    if (m) {
      TOPS_DATE_RE.lastIndex = 0; const dates = [];
      let dm; while ((dm = TOPS_DATE_RE.exec(line))) dates.push(dm[0]);
      const afterDates = dates.length >= 3 ? line.slice(line.indexOf(dates[2], line.indexOf(dates[1]) + dates[1].length) + dates[2].length) : line.slice(line.indexOf(dates[0]) + dates[0].length);
      TOPS_MONEY_RE.lastIndex = 0; const nums = []; let nm;
      while (nums.length < 2 && (nm = TOPS_MONEY_RE.exec(afterDates))) nums.push(nm);
      if (nums.length < 2) return; // ไม่ใช่แถวข้อมูลจริง
      const description = afterDates.slice(nums[1].index + nums[1][0].length).trim();
      const rec = {
        branchCode: branch, branchName: branch, supplierName: employee, // branchName = รหัสสาขา (ไฟล์ TOPS ไม่มีชื่อสาขา)
        supplierNumber: '', invoiceType: 'Prepayment',
        invoiceNumber: m[1], voucherNumber: '', invoiceDate: normOraDate(m[2]), settlementDate: normOraDate(dates[1] || ''),
        invoiceAmount: parseAmount(nums[0][0]), withheldAmount: 0, amountRemaining: parseAmount(nums[1][0]), description,
        // MARKER_IE_MACROLOGIC_TOPS_EXTRA_COLS_V1 -- ดึงทุกคอลัมน์ของรายงาน TOPS ตามตำแหน่งในไฟล์ (ต่อท้ายคอลัมน์เทมเพลต)
        employeeName: cut(line, 3).replace(/\s{2,}/g, ' '), job: cut(line, 4), department: cut(line, 5), telephone: cut(line, 6), finalApprover: cut(line, 7),
        paymentDate: normOraDate(dates[1] || ''), expectedClearDate: normOraDate(dates[2] || ''), overdueDays: (() => { const v = cut(line, 10); return /^-?\d+$/.test(v) ? Number(v) : v; })(),
        reasonUnapplied: line.length > (spans[14] ? spans[14][0] : 225) ? cut(line, 14) : '',
      };
      rows.push(rec); last = rec; return;
    }
    // บรรทัดต่อของ Description (เยื้องลึก ไม่มีวันที่/จำนวนเงิน)
    if (last && /^\s{60,}\S/.test(line) && !TOPS_MONEY_RE.test(line) && !/Subtotal|Total|Employee|Branch/.test(line)) { last.description = `${last.description} ${line.trim()}`.trim(); }
    TOPS_MONEY_RE.lastIndex = 0;
  });
  applyPrepaymentAging(rows);
  return { rows, meta: { totalRows: rows.length, totalAmount: rows.reduce((s, r) => s + (r.invoiceAmount || 0), 0) } };
}

export function parsePrepaymentOraText(rawText) {
  if (!rawText) return { rows: [], meta: { totalRows: 0, totalAmount: 0 } };
  if (isTopsLayout(rawText)) return parsePrepaymentTopsText(rawText); // MARKER_IE_MACROLOGIC_TOPS_LAYOUT_V1
  const lines = rawText.split(/\r\n|\r|\n/);
  const rows = [];
  let last = null;
  let currentBranchName = ''; // MARKER_IE_MACROLOGIC_BRANCHNAME_V1 — ข้อความหลัง Branch Code ในบรรทัด Branch Name:
  let currentBranch = ''; // MARKER_IE_MACROLOGIC_BRANCH_CODE_V1 — Track จากบรรทัด "Branch  Name: {code}  {desc}"

  const branchRe = /Branch\s+Name:\s*(\S+)\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.replace(/\f/g, ''); // ตัด Form-feed (Page Break marker, Excel เก็บเป็น _x000C_)

    const branchMatch = line.match(branchRe);
    if (branchMatch) {
      currentBranch = branchMatch[1];
      currentBranchName = (branchMatch[2] || '').trim();
      continue; // บรรทัด Context ไม่ใช่บรรทัดข้อมูล ข้ามไปเลย
    }

    const fields = extractPrepaymentFields(line);
    if (fields) {
      const rec = { branchCode: currentBranch, branchName: currentBranchName, ...fields };
      rows.push(rec);
      last = rec;
    } else if (last && isSupplierNameContinuation(line)) {
      // ต่อชื่อ Supplier ที่ Wrap บรรทัด — จุดที่ Macro เดิม (Process_Step2) ตั้งใจทำแต่มี Bug ทำไม่สำเร็จ
      last.supplierName = `${last.supplierName} ${line.trim()}`.trim();
    }
  }

  const parsedRows = rows; // เก็บ Reference ไว้เผื่ออ่านง่ายขึ้นด้านล่าง

  // MARKER_IE_MACROLOGIC_FILLDOWN_SUPPLIER_V1
  // ── Oracle Report ต้นฉบับพิมพ์ Supplier Name/Number ให้แค่บรรทัดแรกของ
  // ── แต่ละ Supplier เท่านั้น — Invoice ถัดไปของ Supplier เดียวกันปล่อยว่างไว้
  // ── (จุดที่ Macro เดิมตั้งใจทำใน Process_Step2 แต่มี Bug ทำไม่สำเร็จ) ──────
  for (let i = 1; i < parsedRows.length; i++) {
    if (!parsedRows[i].supplierName) parsedRows[i].supplierName = parsedRows[i - 1].supplierName;
    if (!parsedRows[i].supplierNumber) parsedRows[i].supplierNumber = parsedRows[i - 1].supplierNumber;
  }

  // MARKER_IE_MACROLOGIC_AGING_V1 — เติมคอลัมน์ตามไฟล์ PTC_Prepayment (Remark/Currency/Branch Name/Category/Status/Days)
  // Days Outstanding = IF(Remaining=0, 0, วันตัดยอด - InvoiceDate) ตามสูตรเดิมใน Excel
  // วันตัดยอด = วันสิ้นเดือนก่อนหน้า (ในไฟล์ต้นแบบอ้าง Cell C6 ของชีต 3_Summary_Proof ซึ่งเป็นสิ้นเดือน)
  // Status = ช่วง Aging (A-F) ; ถ้า Remaining = 0 แสดง "Settled/Unpaid"
  applyPrepaymentAging(rows);

  return {
    rows,
    meta: {
      totalRows: rows.length,
      totalAmount: rows.reduce((s, r) => s + (r.invoiceAmount || 0), 0),
    },
  };
}

// ── Header ตรงกับ Master_Prepayment_Templete.xlsx เป๊ะๆ (ลำดับ+ชื่อคอลัมน์) ──
// ── ใช้ทั้งตอนสร้างตาราง UI และตอน Export Excel เพื่อไม่ให้หลุด Sync กัน ────
export const PREPAYMENT_TEMPLATE_COLUMNS = [
  { key: 'branchCode',      header: 'Branch Code' },
  { key: 'supplierName',    header: 'Supplier Name ' },
  { key: 'supplierNumber',  header: 'SupplierNumber' },
  { key: 'invoiceType',     header: 'InvoiceType ' },
  { key: 'invoiceNumber',   header: 'Invoice Number' },
  { key: 'voucherNumber',   header: 'VoucherNumber' },
  { key: 'invoiceDate',     header: 'InvoiceDate' },
  { key: 'settlementDate',  header: 'SettlementDate' },
  { key: 'invoiceAmount',   header: 'InvoiceAmount' },
  { key: 'withheldAmount',  header: 'WithheldAmount' },
  { key: 'amountRemaining', header: 'AmountRemaining' },
  { key: 'description',     header: 'Description' },
  { key: 'remark',          header: 'Remark' },
  { key: 'currency',        header: 'Currency' },
  { key: 'branchName',      header: 'Branch Name' },
  { key: 'category',        header: 'Category' },
  { key: 'status',          header: 'Status' },
  { key: 'daysOutstanding', header: 'Days Outstanding' },
];

// MARKER_IE_MACROLOGIC_TOPS_EXTRA_COLS_V1 -- คอลัมน์เพิ่มของรายงานแบบ TOPS (ต่อท้าย 18 คอลัมน์แรกที่เรียงเหมือนไฟล์ HWS) -- แสดง/Export เฉพาะเมื่อไฟล์มีข้อมูลคอลัมน์นั้น
export const PREPAYMENT_EXTRA_COLUMNS = [
  { key: 'employeeName',      header: 'Employee Name' },
  { key: 'job',               header: 'Job' },
  { key: 'department',        header: 'Department' },
  { key: 'telephone',         header: 'Telephone' },
  { key: 'finalApprover',     header: 'Final Approver' },
  { key: 'paymentDate',       header: 'Payment Date' },
  { key: 'expectedClearDate', header: 'Expected Clear Date' },
  { key: 'overdueDays',       header: 'Overdue Days' },
  { key: 'reasonUnapplied',   header: 'Reason Unapplied' },
];
const _colsCache = new WeakMap();
// คอลัมน์ที่ใช้จริงกับชุดแถวนี้: 18 คอลัมน์เทมเพลต + คอลัมน์เพิ่มที่มีข้อมูลอย่างน้อย 1 แถว (ไฟล์ HWS ไม่มี = ได้ 18 คอลัมน์เหมือนเดิม)
export function getPrepaymentColumns(rows) {
  if (!rows || typeof rows !== 'object') return PREPAYMENT_TEMPLATE_COLUMNS;
  if (_colsCache.has(rows)) return _colsCache.get(rows);
  const extra = PREPAYMENT_EXTRA_COLUMNS.filter(c => rows.some(r => r && r[c.key] !== undefined && r[c.key] !== null && String(r[c.key]).trim() !== ''));
  const cols = extra.length ? [...PREPAYMENT_TEMPLATE_COLUMNS, ...extra] : PREPAYMENT_TEMPLATE_COLUMNS;
  _colsCache.set(rows, cols);
  return cols;
}
// อ่านย้อนจากไฟล์ที่ Export: คอลัมน์เพิ่มที่มีหัวตรงชื่อในแถวหัวตาราง (ตำแหน่งหลัง 18 คอลัมน์แรก)
export function getPrepaymentColumnsFromHeader(headerRow) {
  const hdr = (headerRow || []).slice(PREPAYMENT_TEMPLATE_COLUMNS.length).map(h => String(h == null ? '' : h).trim());
  const extra = hdr.map(h => PREPAYMENT_EXTRA_COLUMNS.find(c => c.header === h)).filter(Boolean);
  return extra.length ? [...PREPAYMENT_TEMPLATE_COLUMNS, ...extra] : PREPAYMENT_TEMPLATE_COLUMNS;
}

// ── จุดเรียกใช้เดียวจาก Component — Detect Type แล้วเลือก Parser ให้เอง ───
// เผื่ออนาคตมี Report Type อื่นจาก Oracle เพิ่ม แค่เพิ่ม case ที่นี่ที่เดียว
export function parseOraText(rawText) {
  const type = detectOraReportType(rawText);
  if (type === ORA_REPORT_TYPES.PREPAYMENT) {
    return { type, ...parsePrepaymentOraText(rawText) };
  }
  return {
    type: null,
    rows: [],
    meta: { totalRows: 0, totalAmount: 0, error: 'ไม่พบรูปแบบรายงานที่รองรับ (ตรวจสอบว่าไฟล์/ข้อความที่วางเป็น Prepayment Status Report หรือไม่)' },
  };
}