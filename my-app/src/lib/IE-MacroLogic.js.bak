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

export function parsePrepaymentOraText(rawText) {
  if (!rawText) return { rows: [], meta: { totalRows: 0, totalAmount: 0 } };
  const lines = rawText.split(/\r\n|\r|\n/);
  const rows = [];
  let last = null;
  let currentBranch = ''; // MARKER_IE_MACROLOGIC_BRANCH_CODE_V1 — Track จากบรรทัด "Branch  Name: {code}  {desc}"

  const branchRe = /Branch\s+Name:\s*(\S+)/;

  for (const raw of lines) {
    const line = raw.replace(/\f/g, ''); // ตัด Form-feed (Page Break marker, Excel เก็บเป็น _x000C_)

    const branchMatch = line.match(branchRe);
    if (branchMatch) {
      currentBranch = branchMatch[1];
      continue; // บรรทัด Context ไม่ใช่บรรทัดข้อมูล ข้ามไปเลย
    }

    const fields = extractPrepaymentFields(line);
    if (fields) {
      const rec = { branchCode: currentBranch, ...fields };
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
];

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