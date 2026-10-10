﻿﻿﻿/**
 * vatReconcile.js
 * ==========================================================================
 * FASTAPN Link3ase — Feature: Reconcile รายงานภาษีซื้อ (VAT Purchase Tax Reconcile)
 * ส่วนที่ 1: Trial Balance (TB) — รับไฟล์ Raw TB (.out จาก Oracle GL, GLCRC064.rdf)
 *
 * db.js อยู่ที่ src/db.js (ยืนยันจาก app.js: import { pool } from "./db.js")
 * ไฟล์นี้อยู่ที่ src/routes/vatReconcile.js จึง import ด้วย "../db.js"
 *
 * Flow:
 *   1) POST /vat-reconcile/tb/preview  -> Parse ไฟล์ + เทียบกับ DB ปัจจุบัน คืน Summary/Diff
 *      (ไม่เขียนอะไรลง DB ใช้แสดงหน้า Preview ก่อนกดยืนยัน ตาม Mockup ที่ออกแบบไว้)
 *   2) POST /vat-reconcile/tb/commit   -> Parse ไฟล์ + Upsert จริงลง vat_reconcile_tb
 *      พร้อม Insert History เมื่อ Effective Value เปลี่ยน
 *
 * Logic สำคัญที่ต้อง Apply:
 *   - Filter เฉพาะ Account ที่อยู่ใน vat_reconcile_account_config (active=true)
 *   - Protected Account (is_protected_account=true): ถ้า Raw ใหม่ = 0
 *     ไม่ Overwrite Effective Value เดิม (แค่บันทึก raw_period_activity + zeroed_at)
 *   - Unique Key: (bu, period, branch, cpc, account, subacc)
 *
 * TODO (ยังไม่ Implement ในไฟล์นี้ - รอ Requirement เพิ่มเติม):
 *   - Group Range Matching (CRG-type: Branch ข้ามบริษัท เช่นที่เห็นในไฟล์ HWS-BOOK)
 *     ตอนนี้ยังใช้ Branch/BU ตรงตัวจาก Flexfield เท่านั้น ยังไม่เช็ค vat_watchlist_bu_group_range
 *   - Record ที่หายไปทั้งแถวจากไฟล์ Upload ใหม่ (ไม่ใช่ Protected Account) ยังไม่ตัดสินใจ
 *     ว่าจะลบหรือ Flag ไว้ (ต้องคุยเพิ่มก่อน Implement)
 * ==========================================================================
 */

import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
// MARKER_VATRECONCILE_REPORT_FILES_V1
import createReportFilesRouter from "./vatReconcileReportFiles.js";
import createVatResultFoldersRouter from "./vatResultFolders.js"; // MARKER_VATRECONCILE_MOUNT_RESULT_FOLDERS_V1
import { pool, getUsernameByEmail } from "../db.js";
// MARKER_VATRECONCILE_TAX_TYPE_MAP_V1 -- Tax Type -> Account/กลุ่ม อ่านจากตาราง recon_tax_type_map (เพิ่ม Tax Type ใหม่ = เพิ่มแถว ไม่ต้องแก้โค้ด)
const DEFAULT_TAX_TYPE_MAP = [
  { tax_type: "N", account: "11610752", grp: "Expense", label: "Input N", in_all_type: true },
  { tax_type: "A", account: "11610752", grp: "Expense", label: "Input A", in_all_type: true },
  { tax_type: "F", account: "11610755", grp: "Asset", label: "Input F", in_all_type: true },
  { tax_type: "T", account: "11610755", grp: "Asset", label: "Input T", in_all_type: true },
  { tax_type: "M", account: "11610751", grp: "Merchandise", label: "Input M", in_all_type: false },
];
let TAX_MAP = DEFAULT_TAX_TYPE_MAP.map((x) => ({ ...x }));
async function loadTaxTypeMap() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS recon_tax_type_map (
      tax_type text PRIMARY KEY, account text NOT NULL, grp text NOT NULL, label text,
      in_all_type boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true, sort_no int NOT NULL DEFAULT 0)`);
    for (const [i, d] of DEFAULT_TAX_TYPE_MAP.entries()) {
      await pool.query(
        `INSERT INTO recon_tax_type_map (tax_type, account, grp, label, in_all_type, sort_no) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tax_type) DO NOTHING`,
        [d.tax_type, d.account, d.grp, d.label, d.in_all_type, i]
      );
    }
    const { rows } = await pool.query(`SELECT tax_type, account, grp, label, in_all_type FROM recon_tax_type_map WHERE enabled IS TRUE ORDER BY sort_no, tax_type`);
    if (rows.length) TAX_MAP = rows.map((r) => ({ ...r, tax_type: String(r.tax_type).toUpperCase() }));
  } catch (e) {
    console.error("[vatReconcile] loadTaxTypeMap (ใช้ค่า Default):", e.message);
  }
}
loadTaxTypeMap();
const taxAccountOf = (t) => TAX_MAP.find((x) => x.tax_type === String(t || "").toUpperCase())?.account || null;
const taxGroupOf = (t) => TAX_MAP.find((x) => x.tax_type === String(t || "").toUpperCase())?.grp || null;
const taxCodes = () => TAX_MAP.map((x) => x.tax_type);
const accountOfGroup = (g) => TAX_MAP.find((x) => x.grp === g)?.account || null;
// MARKER_VATRECONCILE_SIMPLE_BU_CODE_COL_V21 -- เก็บ "Bu Code" (D3) ของไฟล์ Simple Report ไว้ใช้ตอนสร้างหัวรายงาน
pool.query("ALTER TABLE vat_reconcile_simple_header ADD COLUMN IF NOT EXISTS bu_code text").catch((e) => console.error("[migrate simple bu_code]:", e.message));
// MARKER_VATRECONCILE_SIMPLE_SUBTOTAL_COLS_V1 -- เก็บยอด "รวมสาขา" ที่พิมพ์มากับไฟล์ Simple Report (Oracle คิดจากทศนิยมเต็ม อาจต่างจากผลรวมรายบรรทัด 0.01) -- Template หัว % ใช้ยอดนี้ให้ตรงกับไฟล์ Reconcile จริง
for (const col of ["sub_paid_amount", "sub_paid_vat", "sub_claimed_amount", "sub_claimed_vat"]) {
  pool.query(`ALTER TABLE vat_reconcile_simple_header ADD COLUMN IF NOT EXISTS ${col} numeric`).catch((e) => console.error(`[migrate simple ${col}]:`, e.message));
}

// MARKER_VATRECONCILE_MANUAL_CP874_V1
// ── ตัวแปลง windows-874 (cp874/Thai) เอง ไม่พึ่ง Library ภายนอก (เครื่อง Backend ไม่มี Internet) ──
// Byte 0x00-0x7F เหมือน ASCII ทุก Encoding อยู่แล้ว, Byte 0x80-0xFF ตาราง Mapping ตายตัวด้านล่าง
// (สร้างจาก Python cp874 Codec ที่ถูกต้องตามมาตรฐาน แล้วแปลงเป็นตาราง JS)
const CP874_HIGH_BYTE_TABLE = [
  8364, 65533, 65533, 65533, 65533, 8230, 65533, 65533, 65533, 65533, 65533, 65533, 65533, 65533, 65533, 65533,
  65533, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 65533, 65533, 65533, 65533, 65533, 65533, 65533, 65533,
  160, 3585, 3586, 3587, 3588, 3589, 3590, 3591, 3592, 3593, 3594, 3595, 3596, 3597, 3598, 3599,
  3600, 3601, 3602, 3603, 3604, 3605, 3606, 3607, 3608, 3609, 3610, 3611, 3612, 3613, 3614, 3615,
  3616, 3617, 3618, 3619, 3620, 3621, 3622, 3623, 3624, 3625, 3626, 3627, 3628, 3629, 3630, 3631,
  3632, 3633, 3634, 3635, 3636, 3637, 3638, 3639, 3640, 3641, 3642, 65533, 65533, 65533, 65533, 3647,
  3648, 3649, 3650, 3651, 3652, 3653, 3654, 3655, 3656, 3657, 3658, 3659, 3660, 3661, 3662, 3663,
  3664, 3665, 3666, 3667, 3668, 3669, 3670, 3671, 3672, 3673, 3674, 3675, 65533, 65533, 65533, 65533,
];

function decodeCp874(buffer) {
  let result = "";
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    result += b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(CP874_HIGH_BYTE_TABLE[b - 0x80]);
  }
  return result;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Parsing helpers (แปลงจาก Python Parser ต้นแบบที่ทดสอบผ่านแล้ว 12/12 แถว)
// ---------------------------------------------------------------------------

const SKIP_SUBSTRINGS = [
  "BOOK", "GLCRC064", "Currency:", "Company Range:",
  "Company:", "Acc         Description", "-----------",
];

// จับ 1 บรรทัดข้อมูล TB ดิบ: Account, Description, Flexfield, Beginning, Period, Ending
const LINE_PATTERN =
  /^(\d{5,})\s+(.+?)(\d+-\d+-\d+-[A-Za-z0-9]+-\d+-\d+-\d+)\s+([()\d,.\s-]+?)\s+([()\d,.\s-]+?)\s+([()\d,.\s-]+?)\s*$/;

const MONTH_MAP = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function parseAmount(raw) {
  raw = raw.trim().replace(/,/g, "");
  if (!raw) return 0;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  if (negative) raw = raw.slice(1, -1);
  const value = parseFloat(raw);
  if (Number.isNaN(value)) {
    throw new Error(`ไม่สามารถแปลงยอดเงิน: ${raw}`);
  }
  return negative ? -value : value;
}

function parseFlexfield(flexfield) {
  const parts = flexfield.split("-");
  if (parts.length !== 7) {
    throw new Error(`Flexfield ไม่ครบ 7 Segment: ${flexfield}`);
  }
  return {
    bu: parts[2],
    branch: parts[3],
    cpc: parts[4],
    account: parts[5],
    subacc: parts[6],
  };
}

function extractHeaderInfo(rawText) {
  const periodMatch = rawText.match(/Period to date for\s+([A-Z]{3}-\d{2})/);
  const companyMatch = rawText.match(/Company Range:\s*(\d+)\s+to\s+(\d+)/);
  return {
    periodRaw: periodMatch ? periodMatch[1] : null,
    bu: companyMatch ? companyMatch[1] : null,
  };
}

function monthAbbrToPeriod(periodRaw) {
  const [mon, yy] = periodRaw.split("-");
  const mm = MONTH_MAP[mon.toUpperCase()];
  if (!mm) throw new Error(`ไม่รู้จักเดือน: ${mon}`);
  return `20${yy}-${mm}`;
}

/**
 * Parse ไฟล์ TB ดิบทั้งก้อน (string) -> { bu, period, records, unmatchedLines }
 * accountConfigMap: Map<accountCode, { label, protected }> จาก vat_reconcile_account_config
 */
function parseTbText(rawText, accountConfigMap) {
  const { bu, periodRaw } = extractHeaderInfo(rawText);
  const period = periodRaw ? monthAbbrToPeriod(periodRaw) : null;

  const records = [];
  const unmatchedLines = [];

  const lines = rawText.split("\n");
  for (let line of lines) {
    line = line.replace(/\r$/, "");
    // MARKER_VATRECONCILE_TB_STRIP_QUOTES_V1 -- ไฟล์ TB บางบรรทัดถูกครอบด้วย " ต้น/ท้ายบรรทัด (เช่น "11610752 ... 1,859,068.91") -- เดิมถูกข้ามหมดเพราะไม่ขึ้นต้นด้วยตัวเลข
    line = line.replace(/^"/, "").replace(/"\s*$/, "");
    if (!line.trim()) continue;
    if (SKIP_SUBSTRINGS.some((s) => line.includes(s))) continue;
    if (!/^\d{5,}\s/.test(line)) continue; // ข้ามบรรทัด Grand Total ท้ายไฟล์

    const m = line.match(LINE_PATTERN);
    if (!m) {
      unmatchedLines.push(line);
      continue;
    }

    const [, account, description, flexfieldStr, beginStr, periodStr, endStr] = m;
    if (!accountConfigMap.has(account)) continue; // ไม่อยู่ใน Config -> ข้าม

    const flex = parseFlexfield(flexfieldStr);
    if (flex.account !== account) {
      unmatchedLines.push(line);
      continue;
    }

    const cfg = accountConfigMap.get(account);
    records.push({
      bu: flex.bu,
      branch: flex.branch,
      cpc: flex.cpc,
      account,
      subacc: flex.subacc,
      description: description.trim(),
      beginning_balance: parseAmount(beginStr),
      period_activity_raw: parseAmount(periodStr),
      ending_balance: parseAmount(endStr),
      is_protected_account: cfg.protected,
    });
  }

  return { bu, period, records, unmatchedLines };
}

// MARKER_VATRECONCILE_TB_XLSX_V1 -- TB ที่ตัดออกมาแล้ว (.xlsx) เช่น "09.2026 TB for Reconcile_0402.xlsx"
// Sheet "Recon_TB" หัวคอลัมน์: Branch, CPC, Account, SubAcc, Description, Beginning Balance, Period Activity, Ending Balance
// BU / Period: ใช้ค่าที่ผู้ใช้กำหนด (override) > Sheet "Raw TB" (หัวรายงานต้นฉบับ) > ชื่อไฟล์ (09.2026 = Period, 0402 = BU) ถ้าหาไม่ได้ -> NEED_META (Frontend เปิด Popup)
async function parseTbXlsx(buffer, filename, accountConfigMap, overrides = {}) {
  const name = String(filename || "").trim();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const H = ["branch", "cpc", "account", "subacc", "description", "beginning balance", "period activity", "ending balance"];
  // MARKER_VATRECONCILE_TB_XLSX_HEADER_ROW_V1 -- หัวคอลัมน์อาจไม่อยู่แถว 1 (แบบ DETAIL OF ACCOUNT มีหัวรายงาน Company/Period อยู่ด้านบน)
  let ws = null, hdrRow = 1;
  for (const w of wb.worksheets) {
    const maxR = Math.min(w.rowCount || 1, 30);
    for (let r = 1; r <= maxR && !ws; r++) {
      const h = H.map((_, i) => (simpleCleanText(w.getRow(r).getCell(i + 1).value) || "").toLowerCase());
      if (H.every((x, i) => h[i] === x || (i === 5 && /^beg/.test(h[i])))) { ws = w; hdrRow = r; } // รับ 'Beginnging Balance' (สะกดผิดในไฟล์ต้นทาง)
    }
    if (ws) break;
  }
  if (!ws) {
    const e = new Error("รูปแบบไฟล์ .xlsx ไม่ตรงกับ TB ที่ตัดออกมาแล้ว (ต้องมี Sheet ที่มีหัวคอลัมน์ = Branch, CPC, Account, SubAcc, Description, Beginning Balance, Period Activity, Ending Balance)");
    e.code = "UNKNOWN_FORMAT";
    throw e;
  }
  let rawBu = null, rawPeriod = null;
  const rawWs = wb.worksheets.find((w) => w !== ws && /raw/i.test(w.name));
  if (rawWs) {
    const lines = [];
    rawWs.eachRow({ includeEmpty: false }, (row, rn) => { if (rn <= 60) lines.push(simpleCleanText(row.getCell(1).value) || ""); });
    const hi = extractHeaderInfo(lines.join("\n"));
    rawBu = hi.bu;
    try { rawPeriod = hi.periodRaw ? monthAbbrToPeriod(hi.periodRaw) : null; } catch (_) { rawPeriod = null; }
  }
  if (hdrRow > 1) {
    const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    for (let r = 1; r < hdrRow; r++) {
      const row = ws.getRow(r);
      const k = (simpleCleanText(row.getCell(1).value) || "").trim().toLowerCase();
      let v = null;
      for (let c = 2; c <= 8 && v === null; c++) { const x = row.getCell(c).value; if (x !== null && x !== undefined && String(x).trim() !== "") v = x; }
      if (v === null) continue;
      if (k === "company") { const m = /^(\d{4})/.exec(String(simpleCleanText(v) || "").trim()); if (m && !rawBu) rawBu = m[1]; }
      else if (k === "period" && !rawPeriod) {
        if (v instanceof Date) rawPeriod = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
        else {
          const t = String(simpleCleanText(v) || "").trim(); let m;
          if ((m = /(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})/.exec(t)) && MON[m[2].toUpperCase()]) rawPeriod = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${MON[m[2].toUpperCase()]}`;
          else if ((m = /^(\d{4})-(\d{2})-\d{2}/.exec(t))) rawPeriod = `${m[1]}-${m[2]}`;
        }
      }
    }
  }
  const pm = /(?:^|[^\d])(\d{2})\.(\d{4})(?!\d)/.exec(name);
  const bm = /[ _](\d{4})\.xlsx$/i.exec(name);
  const bu = /^\d{4}$/.test(String(overrides.bu || "").trim()) ? String(overrides.bu).trim() : (rawBu || (bm ? bm[1] : null));
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(overrides.period || "")) ? overrides.period : (rawPeriod || (pm ? `${pm[2]}-${pm[1]}` : null));
  if (!bu || !period) {
    const e = new Error("ชื่อไฟล์/ไฟล์ระบุ " + [!bu ? "BU" : null, !period ? "Period" : null].filter(Boolean).join(" และ ") + " ไม่ได้ — กรุณากำหนดเอง");
    e.code = "NEED_META";
    let sb = bu || null;
    if (!sb) { const r2 = ws.getRow(hdrRow + 1).getCell(1).value; const t = simpleCleanText(r2); if (t && /^\d{4}/.test(t)) sb = t.slice(0, 4); }
    e.suggest = { period: period || null, bu: sb };
    throw e;
  }
  const records = [];
  const unmatchedLines = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= hdrRow) return;
    const account = simpleCleanText(row.getCell(3).value);
    if (!account) return;
    const branch = simpleCleanText(row.getCell(1).value);
    const cpc = simpleCleanText(row.getCell(2).value);
    const subacc = simpleCleanText(row.getCell(4).value);
    if (!branch || !cpc || !subacc) { unmatchedLines.push(`row ${rn}`); return; }
    if (!accountConfigMap.has(account)) return; // ไม่อยู่ใน Config -> ข้าม (เหมือน TB ดิบ)
    const cfg = accountConfigMap.get(account);
    records.push({
      bu,
      branch,
      cpc,
      account,
      subacc,
      description: simpleCleanText(row.getCell(5).value) || "",
      beginning_balance: simpleCellNumber(row, 6),
      period_activity_raw: simpleCellNumber(row, 7),
      ending_balance: simpleCellNumber(row, 8),
      is_protected_account: cfg.protected,
    });
  });
  return { bu, period, records, unmatchedLines };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function loadAccountConfigMap() {
  const { rows } = await pool.query(
    `SELECT account, account_label, is_protected_account
     FROM vat_reconcile_account_config
     WHERE active = true`
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.account, { label: r.account_label, protected: r.is_protected_account });
  }
  // MARKER_VATRECONCILE_TB_VAT_ACCOUNTS_ALWAYS_V1 -- บัญชีภาษีซื้อ 11610751/52/55 ต้องประมวลผลเสมอ และเป็น Protected เสมอ
  // (ยอดใหม่ = 0 ห้ามทับยอดเดิม / ยอดเปลี่ยนจริงให้อัปเดต) ไม่ขึ้นกับว่าอยู่ใน vat_reconcile_account_config หรือ Active หรือไม่
  for (const [acc, label] of [["11610751", "Input Tax - Merchandise"], ["11610752", "Input Tax - Non Merchandise"], ["11610755", "Input Tax - Asset"]]) {
    const cur = map.get(acc);
    if (cur) cur.protected = true;
    else map.set(acc, { label, protected: true });
  }
  return map;
}

/**
 * เทียบ Record ที่ Parse ได้ กับค่าที่มีอยู่ใน DB ปัจจุบัน
 * คืนค่า record พร้อม field เพิ่ม: status ('new' | 'updated' | 'protected_kept' | 'unchanged'),
 * effective_period_activity, old_period_activity
 */
async function diffAgainstDb(bu, period, records) {
  const results = [];
  for (const r of records) {
    const { rows } = await pool.query(
      `SELECT period_activity, beginning_balance, ending_balance FROM vat_reconcile_tb
       WHERE bu=$1 AND period=$2 AND branch=$3 AND cpc=$4 AND account=$5 AND subacc=$6`,
      [bu, period, r.branch, r.cpc, r.account, r.subacc]
    );
    const existing = rows[0];
    const oldValue = existing ? Number(existing.period_activity) : null;

    let effective = r.period_activity_raw;
    let status;
    let zeroedThisRun = false;

    if (oldValue === null) {
      // MARKER_VATRECONCILE_TB_ZERO_NOT_INSERT_V1 -- บัญชี Protected ที่ยังไม่เคยมีแถว และยอดใหม่เป็น 0 -> ไม่ต้องบันทึกเข้าไป
      status = (r.is_protected_account && r.period_activity_raw === 0) ? "zero_skipped" : "new";
    } else if (r.is_protected_account && r.period_activity_raw === 0) {
      effective = oldValue; // ห้าม Overwrite เป็น 0
      zeroedThisRun = true;
      status = oldValue === 0 ? "unchanged" : "protected_kept";
    } else if (
      // MARKER_VATRECONCILE_TB_DIFF_ALL_COLS_V1 -- ยอดไหนเปลี่ยน (Period Activity / Beginning / Ending) ถือว่า "อัปเดต" -- เดิมเทียบแค่ Period Activity
      Math.abs(oldValue - r.period_activity_raw) > 0.004 ||
      Math.abs(Number(existing.beginning_balance) - r.beginning_balance) > 0.004 ||
      Math.abs(Number(existing.ending_balance) - r.ending_balance) > 0.004
    ) {
      status = "updated";
    } else {
      status = "unchanged";
    }

    results.push({
      ...r,
      old_period_activity: oldValue,
      effective_period_activity: effective,
      status,
      zeroed_this_run: zeroedThisRun,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /vat-reconcile/tb/preview
 * รับไฟล์ TB ดิบ (multipart, field name = "file") -> คืน Summary + รายละเอียดต่อแถว
 * ไม่เขียนอะไรลง DB
 */
router.post("/tb/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const rawText = req.file.buffer.toString("latin1"); // cp1252 ใกล้เคียง latin1 สำหรับตัวอักษร/ตัวเลขภาษาอังกฤษ

    if (isPasteTsvName(req.file.originalname)) { const cv = await tsvToXlsxBuffer(req.file.buffer, "tb"); req.file.buffer = cv.buffer; req.file.originalname = "pasted-excel.xlsx"; } // MARKER_VATRECONCILE_PASTE_TSV_V1
    const accountConfigMap = await loadAccountConfigMap();
    const { bu, period, records, unmatchedLines } = /\.xlsx$/i.test(req.file.originalname || "")
      ? await parseTbXlsx(req.file.buffer, req.file.originalname, accountConfigMap, { period: req.body.period, bu: req.body.bu }) // MARKER_VATRECONCILE_TB_XLSX_V1
      : parseTbText(rawText, accountConfigMap);

    if (!bu || !period) {
      return res.status(422).json({
        error: "ไม่สามารถอ่าน BU หรือ Period จาก Header ของไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ TB ที่ถูกต้อง",
      });
    }

    const diffed = await diffAgainstDb(bu, period, records);

    let buShort = null; // MARKER_VATRECONCILE_TB_BU_SHORT_V1 -- ชื่อย่อ BU จาก company_list (เช่น 0568 = MPS) ไว้แสดงในหน้า Preview
    try {
      const cq = await pool.query(`SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`, [String(bu)]);
      buShort = cq.rows[0]?.bu || null;
    } catch (_) { buShort = null; }

    const summary = {
      bu,
      bu_short: buShort,
      period,
      total: diffed.length,
      new_count: diffed.filter((r) => r.status === "new").length,
      updated_count: diffed.filter((r) => r.status === "updated").length,
      protected_kept_count: diffed.filter((r) => r.status === "protected_kept").length,
      unchanged_count: diffed.filter((r) => r.status === "unchanged").length,
      zero_skipped_count: diffed.filter((r) => r.status === "zero_skipped").length,
      unmatched_lines_count: unmatchedLines.length,
    };

    res.json({ summary, records: diffed, unmatchedLines });
  } catch (err) {
    if (err.code === "NEED_META" || err.code === "UNKNOWN_FORMAT") return res.status(422).json({ error: err.message, code: err.code, suggest: err.suggest || null });
    console.error("[vatReconcile] preview error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างประมวลผลไฟล์", detail: err.message });
  }
});

/**
 * POST /vat-reconcile/tb/commit
 * รับไฟล์ TB ดิบเหมือนกับ preview แต่ Upsert จริงลง vat_reconcile_tb
 * Body เพิ่มเติม (form field): file_id (จาก file_storage ถ้ามี)
 * updated_by: ดึงจาก req.user.email -> แปลงเป็น username ผ่าน getUsernameByEmail (Pattern เดิมของระบบ)
 *             ถ้าไม่มี req.user (เช่นยังไม่ต่อ Middleware auth) fallback เป็น 'system'
 */
router.post("/tb/commit", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const rawText = req.file.buffer.toString("latin1");
    const fileId = req.body.file_id ? parseInt(req.body.file_id, 10) : null;

    const updatedBy = req.user?.email
      ? await getUsernameByEmail(req.user.email)
      : "system";

    if (isPasteTsvName(req.file.originalname)) { const cv = await tsvToXlsxBuffer(req.file.buffer, "tb"); req.file.buffer = cv.buffer; req.file.originalname = "pasted-excel.xlsx"; } // MARKER_VATRECONCILE_PASTE_TSV_V1
    const accountConfigMap = await loadAccountConfigMap();
    const { bu, period, records, unmatchedLines } = /\.xlsx$/i.test(req.file.originalname || "")
      ? await parseTbXlsx(req.file.buffer, req.file.originalname, accountConfigMap, { period: req.body.period, bu: req.body.bu }) // MARKER_VATRECONCILE_TB_XLSX_V1
      : parseTbText(rawText, accountConfigMap);

    if (!bu || !period) {
      return res.status(422).json({
        error: "ไม่สามารถอ่าน BU หรือ Period จาก Header ของไฟล์ได้",
      });
    }

    const diffed = await diffAgainstDb(bu, period, records);

    await client.query("BEGIN");

    let insertedCount = 0;
    let updatedCount = 0;

    for (const r of diffed) {
      const now = new Date();
      if (r.status === "zero_skipped") continue; // MARKER_VATRECONCILE_TB_ZERO_NOT_INSERT_V1

      // Upsert หลัก: ON CONFLICT บน Unique Key (bu, period, branch, cpc, account, subacc)
      const upsertResult = await client.query(
        `INSERT INTO vat_reconcile_tb (
            bu, period, branch, cpc, account, subacc, description,
            beginning_balance, period_activity, ending_balance,
            raw_beginning_balance, raw_period_activity, raw_ending_balance, raw_uploaded_at,
            is_protected_account, zeroed_at,
            updated_by, update_source, last_file_id,
            created_at, updated_at
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,
            $8,$11,$10,$12,
            $13,$14,
            $15,'upload',$16,
            $12,$12
         )
         ON CONFLICT (bu, period, branch, cpc, account, subacc)
         DO UPDATE SET
            description = EXCLUDED.description,
            beginning_balance = CASE
                WHEN (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account) AND EXCLUDED.raw_period_activity = 0
                THEN vat_reconcile_tb.beginning_balance
                ELSE EXCLUDED.beginning_balance
            END,
            is_protected_account = (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account),
            period_activity = EXCLUDED.period_activity,
            ending_balance = CASE
                WHEN (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account) AND EXCLUDED.raw_period_activity = 0
                THEN vat_reconcile_tb.ending_balance
                ELSE EXCLUDED.ending_balance
            END,
            raw_beginning_balance = EXCLUDED.raw_beginning_balance,
            raw_period_activity = EXCLUDED.raw_period_activity,
            raw_ending_balance = EXCLUDED.raw_ending_balance,
            raw_uploaded_at = EXCLUDED.raw_uploaded_at,
            zeroed_at = CASE
                WHEN (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account) AND EXCLUDED.raw_period_activity = 0
                THEN EXCLUDED.raw_uploaded_at
                ELSE vat_reconcile_tb.zeroed_at
            END,
            updated_by = CASE
                WHEN vat_reconcile_tb.period_activity IS DISTINCT FROM (
                    CASE WHEN (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account) AND EXCLUDED.raw_period_activity = 0
                         THEN vat_reconcile_tb.period_activity
                         ELSE EXCLUDED.period_activity
                    END
                ) THEN EXCLUDED.updated_by ELSE vat_reconcile_tb.updated_by END,
            last_file_id = EXCLUDED.last_file_id,
            updated_at = CASE
                WHEN vat_reconcile_tb.period_activity IS DISTINCT FROM (
                    CASE WHEN (vat_reconcile_tb.is_protected_account OR EXCLUDED.is_protected_account) AND EXCLUDED.raw_period_activity = 0
                         THEN vat_reconcile_tb.period_activity
                         ELSE EXCLUDED.period_activity
                    END
                ) THEN EXCLUDED.updated_at ELSE vat_reconcile_tb.updated_at END
         RETURNING id, (xmax = 0) AS inserted, period_activity`,
        [
          r.bu, period, r.branch, r.cpc, r.account, r.subacc, r.description,
          r.beginning_balance, r.effective_period_activity, r.ending_balance,
          r.period_activity_raw, now,
          r.is_protected_account, r.zeroed_this_run ? now : null,
          updatedBy, fileId,
        ]
      );

      const row = upsertResult.rows[0];
      if (row.inserted) {
        insertedCount++;
      } else if (r.status === "updated") {
        updatedCount++;
      }

      // Insert History เฉพาะตอน Effective Value เปลี่ยนจริง (new หรือ updated)
      if (r.status === "new" || r.status === "updated") {
        await client.query(
          `INSERT INTO vat_reconcile_tb_history (
              tb_id, old_period_activity, new_period_activity,
              old_ending_balance, new_ending_balance,
              change_source, changed_by, changed_at
           ) VALUES ($1,$2,$3,$4,$5,'upload',$6,$7)`,
          [
            row.id,
            r.old_period_activity,
            r.effective_period_activity,
            null, // old_ending_balance: ต้อง Query แยกถ้าต้องการ Track ละเอียดกว่านี้
            r.ending_balance,
            updatedBy,
            now,
          ]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      bu,
      period,
      total: diffed.length,
      inserted: insertedCount,
      updated: updatedCount,
      protected_kept: diffed.filter((r) => r.status === "protected_kept").length,
      unmatched_lines_count: unmatchedLines.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "NEED_META" || err.code === "UNKNOWN_FORMAT") return res.status(422).json({ error: err.message, code: err.code, suggest: err.suggest || null });
    console.error("[vatReconcile] commit error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล", detail: err.message });
  } finally {
    client.release();
  }
});

// ===========================================================================
// ส่วนที่ 2: Input Summary (APCRC201 — รายงานภาษีซื้อ ระดับ Tax Invoice)
// ===========================================================================
// ต่างจาก TB: ไม่มี BU Code ตรงๆ ในไฟล์ ต้อง Match จาก Branch (Header "สาขา : XXXXXX")
// ผ่าน branch_list ก่อน -> ถ้าไม่เจอ Fallback ไป vat_watchlist_bu_group_range
//
// ⚠️ สมมติฐานเรื่อง Group Range ที่ยังไม่ยืนยัน 100% กับข้อมูลจริง:
//   ตาราง vat_watchlist_bu_group_range ไม่มี Column "bu" ตรงๆ มีแค่ "group_name"
//   โค้ดนี้สมมติว่า group_name เก็บค่า BU ที่จะคืนกลับตรงๆ (ตาม Pattern ที่เคยคุยไว้
//   เช่น "5891-5898 อยู่ในกลุ่ม OTY/TTCDS/..." -> group_name น่าจะเก็บ 'OTY' ฯลฯ)
//   ถ้า Format จริงต่างจากนี้ ต้องแก้ resolveBranchToBu() ให้ตรง
//
// Logic Replace ทั้งก้อน (ไม่ใช่ Upsert ทีละแถวแบบ TB):
//   ก่อน Insert -> DELETE ข้อมูลเก่าของ (bu, period, tax_type) นั้นทั้งหมดก่อน
//   เพราะข้อมูลระดับ Invoice ถ้า Report รอบใหม่ไม่มี Invoice ที่เคยมี ต้องไม่เหลือค้าง
// ===========================================================================

const IS_FIELD_POSITIONS = [0, 12, 28, 43, 59, 93, 109, 123, 134, 160, 181, 200, 219, 237, 260];
const IS_FIELD_NAMES = [
  "receive_date", "grt_no", "tax_invoice_date", "tax_invoice_no",
  "vendor_name", "tax_id", "ho", "branch_field", "item_detail",
  "paid_amount", "paid_vat", "claimed100_amount", "claimed100_vat", "calculate_tax",
];

// MARKER_VATRECONCILE_IS_MACRO_CONT_V3
const IS_TEXT_FIELDS = ["tax_invoice_no", "vendor_name", "grt_no", "tax_id", "branch_field", "item_detail"];
const IS_TEXT_JOIN_SPACE = new Set(["vendor_name", "item_detail"]); // ที่เหลือ (เลขที่/รหัส) ต่อติดกันไม่เว้นวรรค
const IS_OVERFLOW_PRIORITY = ["tax_invoice_no", "grt_no", "tax_id", "branch_field", "vendor_name", "item_detail"];
const IS_DATE_ROW_PATTERN = /^\d{2}-[A-Za-z]{3}-\d{2}\s/;
// MARKER_VATRECONCILE_IS_BRANCH_ALNUM_V1 -- รองรับรหัสสาขาที่มีตัวอักษร เช่น 0560A1 (4 หลัก + ตัวอักษร) ไม่ใช่แค่ตัวเลข 5-6 หลัก
const IS_BRANCH_HEADER_STRICT = /^[^\d]{2,15}:\s*(\d{5,6}[A-Za-z0-9]*|\d{4}[A-Za-z][A-Za-z0-9]?)\s*$/;

// MARKER_VATRECONCILE_FIX_PAGE_HEADER_JUNK_V1
// ── Page Header ที่พิมพ์ซ้ำทุกครั้งที่ขึ้นหน้าใหม่ (Page Break) -- ต้องข้าม ไม่ใช่ต่อเข้า vendor_name ──
// Bug จริงที่พบ: Record ที่ Invoice ตกอยู่พอดีก่อนขึ้นหน้าใหม่ ถูกต่อ Header หน้าถัดไป
// เข้ากับ vendor_name ทำให้ยาวเกิน 300 ตัวอักษร (Error "value too long for type character varying(300)")
const IS_PAGE_HEADER_SUBSTRINGS = [
  "BOOK", "APCRC201", "FAPMGR008",
  "----------",       // เส้นประคั่น Column Header
  "Calculate Tax",    // แถวหัว Column
  "<", ">",           // แถวหัว Column ใช้ < > ล้อมชื่อกลุ่ม Column ข้อมูลจริงไม่มีอักขระนี้
  "TOTAL GROUP",      // แถว Subtotal ของกลุ่ม Invoice (พบใน BU 0402/CFW ที่ไม่เคยเจอมาก่อน)
  "รวมตามสาขา",        // แถวสรุปยอดตามสาขา (ท้ายไฟล์)
  "รวมทั้งสิ้น",        // แถว Grand Total ท้ายไฟล์
  "รวม :",            // แถวสรุปยอดรวม
  "====",             // เส้นคั่น Grand Total (คนละแบบกับ "----------")
  "TAPVATIN",         // ลายเซ็นชื่อโปรแกรมที่ออกรายงาน (ท้ายไฟล์)
];

function isPageHeaderJunk(strippedLine) {
  return IS_PAGE_HEADER_SUBSTRINGS.some((s) => strippedLine.includes(s));
}

// MARKER_VATRECONCILE_IS_PAGEJUNK_V1 -- เลขหน้า/เลขล้วนยาวที่พิมพ์ซ้ำตอนขึ้นหน้าใหม่ ห้ามต่อเข้า vendor_name
const IS_PAGE_NO_PATTERN = /(?:หน้า|page)\s*[:：]?\s*\d+\s*(?:\/|of)\s*\d+/gi; // เช่น "หน้า: 2 / 3"
function isStripPageNoJunk(strippedLine) {
  if (/^\d{6,}$/.test(strippedLine)) return ""; // บรรทัดเป็นเลขล้วนยาว (เช่น 10004411) ไม่ใช่ชื่อผู้ค้า
  return strippedLine.replace(IS_PAGE_NO_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function isParseAmount(raw) {
  raw = (raw || "").trim().replace(/,/g, "");
  if (!raw || raw === "-") return 0;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  if (negative) raw = raw.slice(1, -1);
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return negative ? -value : value;
}

function isParseDate(raw) {
  const m = (raw || "").trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{2})/);
  if (!m) return null;
  const mm = MONTH_MAP[m[2].toUpperCase()];
  if (!mm) return null;
  return `20${m[3]}-${mm}-${m[1]}`;
}

// MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1 -- Zone Page Header: เริ่มที่ "<BU> BOOK ..." จบที่เส้นประคั่นหัว Column
const IS_PAGE_HEADER_START = /^[A-Za-z0-9]{2,8}\s+BOOK\b/;
const IS_PAGE_HEADER_END = /^-{5,}(?:\s+-{5,}){2,}\s*$/;
const IS_PAGE_HEADER_MAX_LINES = 40;

function isParseRowFields(line) {
  const values = {};
  for (let i = 0; i < IS_FIELD_NAMES.length; i++) {
    const start = IS_FIELD_POSITIONS[i];
    const end = IS_FIELD_POSITIONS[i + 1];
    values[IS_FIELD_NAMES[i]] = start < line.length ? line.slice(start, end).trim() : "";
  }
  return values;
}

function isExtractHeaderInfo(rawText) {
  const endDateMatch = rawText.match(/End Receive Date\s*:\s*(\d{2}-[A-Za-z]{3}-\d{2})/);
  let period = null;
  if (endDateMatch) {
    const iso = isParseDate(endDateMatch[1]);
    if (iso) period = iso.slice(0, 7);
  }

  const merchMatch = rawText.match(/Merchandise \[Y\/N\]\s*:\s*([A-Za-z]*)/);
  const taxType = (merchMatch && merchMatch[1].trim()) || "N";

  const reconcileAccount = taxAccountOf(taxType);

  const operatorMatch = rawText.match(/ชื่อผู้ประกอบการ\s*:\s*(.+?)\s{5,}/); // ต้องอ่านไฟล์ด้วย windows874 ก่อนถึงจะ Match ตรงนี้ได้
  const operatorName = operatorMatch ? operatorMatch[1].trim() : null;

  return { period, taxType, reconcileAccount, operatorName };
}

/**
 * Parse ไฟล์ Input Summary ดิบ -> { header, records, unmatchedLines }
 * หมายเหตุ: Text ยาวล้นบรรทัด (tax_invoice_no/item_detail บางรายการ) ยังเป็น Known Limitation
 * ตอนนี้บรรทัดต่อเนื่องจะถูกต่อเข้ากับ vendor_name เท่านั้น (ตามที่คุยไว้ในแชท)
 */
function parseInputSummaryText(rawText) {
  const header = isExtractHeaderInfo(rawText);
  const lines = rawText.split("\n");

  const records = [];
  const unmatchedLines = [];
  let currentBranch = null;
  let currentRecord = null;
  let currentOperator = header.operatorName; // MARKER_VATRECONCILE_IS_OPERATOR_PER_PAGE_V1
  let currentRaw = {}; // MARKER_VATRECONCILE_IS_MACRO_CONT_V3 -- ค่าดิบ (ไม่ trim) ของแถวข้อมูลล่าสุด ไว้ดูว่า Field ไหนเต็ม Column
  let contEligible = false; // MARKER_VATRECONCILE_IS_INV_WRAP_COL0_V2 -- true เฉพาะเมื่อบรรทัดก่อนหน้า (ที่ไม่ว่าง) คือแถวข้อมูล/บรรทัดต่อของมันเอง
  let inPageHeader = false; // MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1
  let pageHeaderCount = 0;

  for (let rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const stripped = line.trim();
    if (!stripped) continue;

    // MARKER_VATRECONCILE_IS_OPERATOR_PER_PAGE_V1 -- ชื่อผู้ประกอบการอ่านจากหัวหน้าของสาขานั้นเอง (ทุกหน้ามีหัว) ไม่ใช่หัวหน้าแรกของทั้งไฟล์
    const opm = stripped.match(/^ชื่อผู้ประกอบการ\s*:\s*(.+?)(?:\s{5,}|$)/);
    if (opm && opm[1].trim()) currentOperator = opm[1].trim();

    const bh = stripped.match(IS_BRANCH_HEADER_STRICT);
    if (bh && stripped.length < 20) {
      currentBranch = bh[1];
      currentRecord = null;
      continue;
    }

    if (stripped.includes(":") && /:\s*(?:\d{5,6}|\d{4}[A-Za-z][A-Za-z0-9]?)\s+[\d,]+\.\d{2}/.test(stripped)) {
      const m = stripped.match(/:\s*((?:\d{5,6}|\d{4}[A-Za-z][A-Za-z0-9]?))\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
      if (m) {
        currentRecord = null;
        continue; // บรรทัดสรุป "รวมตามสาขา" -- ไม่ Insert เป็น Record
      }
    }

    // MARKER_VATRECONCILE_IS_PAGEHEADER_ZONE_V1 -- ข้าม Page Header ทั้งก้อน (ไม่ต่อเข้า vendor_name / tax_invoice_no)
    if (IS_DATE_ROW_PATTERN.test(line)) {
      inPageHeader = false; // แถวข้อมูลจริง -> ปิด Zone เสมอ
    } else if (!inPageHeader && IS_PAGE_HEADER_START.test(stripped)) {
      inPageHeader = true;
      pageHeaderCount = 0;
    }
    if (inPageHeader) {
      pageHeaderCount++;
      if (IS_PAGE_HEADER_END.test(stripped)) {
        inPageHeader = false;
        continue;
      }
      if (pageHeaderCount > IS_PAGE_HEADER_MAX_LINES) {
        inPageHeader = false; // ไม่เจอเส้นประปิด Zone -> เลิก Zone แล้วประมวลผลบรรทัดนี้ตามปกติ
      } else {
        continue;
      }
    }

    if (IS_DATE_ROW_PATTERN.test(line)) {
      if (!currentBranch) {
        unmatchedLines.push(line);
        continue;
      }
      const f = isParseRowFields(line);
      const rawHo = f.ho;
      const rawBranchField = f.branch_field;
      let hoFinal;
      if (!rawHo && !rawBranchField) hoFinal = "00000";
      else if (rawHo === "X") hoFinal = "00000";
      else hoFinal = rawHo;

      const record = {
        branch: currentBranch,
        operator_name: currentOperator || header.operatorName,
        receive_date: isParseDate(f.receive_date),
        grt_no: f.grt_no,
        tax_invoice_date: isParseDate(f.tax_invoice_date),
        tax_invoice_no: f.tax_invoice_no.replace(/^\*/, "").trim(),
        vendor_name: f.vendor_name.trim(),
        tax_id: f.tax_id,
        ho: hoFinal,
        branch_field: rawBranchField || null,
        item_detail: f.item_detail,
        paid_amount: isParseAmount(f.paid_amount),
        paid_vat: isParseAmount(f.paid_vat),
        claimed100_amount: isParseAmount(f.claimed100_amount),
        claimed100_vat: isParseAmount(f.claimed100_vat),
        calculate_tax: isParseAmount(f.calculate_tax),
      };
      records.push(record);
      currentRecord = record;
      currentRaw = {};
      IS_FIELD_NAMES.forEach((k, ix) => { const st = IS_FIELD_POSITIONS[ix]; currentRaw[k] = st < line.length ? line.slice(st, IS_FIELD_POSITIONS[ix + 1]) : ""; });
      contEligible = true;
      continue;
    }

    if (currentRecord) {
      if (isPageHeaderJunk(stripped)) {
        contEligible = false;
        continue; // ข้าม Page Header ที่พิมพ์ซ้ำทุกครั้งที่ขึ้นหน้าใหม่ (ไม่ใช่ข้อมูลจริง)
      }
      // MARKER_VATRECONCILE_IS_MACRO_CONT_V3 -- บรรทัดต่อ (Text ยาวล้น) จับตาม "Column ของ Field นั้น" แล้วต่อเข้า Field เดียวกันของแถวก่อนหน้า (ทุก Text Field ไม่ใช่แค่ tax_invoice_no / vendor_name)
      const cf = isParseRowFields(line);
      const appendTo = (key, val) => {
        if (!val) return;
        const joiner = IS_TEXT_JOIN_SPACE.has(key) ? " " : "";
        currentRecord[key] = ((currentRecord[key] || "") + joiner + val).trim();
      };
      let touched = false;
      // 1) Text ที่อยู่ใน Column ของ Field นั้นเอง
      for (const key of IS_TEXT_FIELDS) {
        let v = (cf[key] || "").trim();
        if (key === "tax_invoice_no") v = v.replace(/^\*/, "").trim();
        if (key === "vendor_name") v = isStripPageNoJunk(v);
        if (!v) continue;
        if (key !== "tax_invoice_no" && key !== "vendor_name" && !contEligible) continue; // Field ใหม่ (item_detail/tax_id/branch/grt) ต้องต่อติดแถวข้อมูลเท่านั้น กันเศษ Header
        appendTo(key, v);
        touched = true;
      }
      // 2) Text ที่ตกลงมาขึ้นต้นที่ Column แรก (ตำแหน่ง 0-12) -- ส่วนท้ายของ Field ที่ "ล้น/ถูกตัด" ในแถวก่อนหน้า
      //    รู้ว่าเป็น Field ไหนจากสถานะของแถวก่อนหน้า (เต็มความกว้าง Column หรือลงท้าย - /) ไม่เดาจากหน้าตาเลข
      if (!touched && contEligible && !IS_DATE_ROW_PATTERN.test(line)) {
        const restBlank = IS_FIELD_NAMES.slice(1).every((k) => !(cf[k] || "").trim());
        const tok = (cf.receive_date || "").trim();
        if (restBlank && tok && /^[A-Za-z0-9._\-\/]+$/.test(tok)) {
          let target = "tax_invoice_no"; // Default: เลขที่ใบกำกับ (เคสที่พบจริง: "* PK46BI-" + "260900005")
          for (const key of IS_OVERFLOW_PRIORITY) {
            const idx = IS_FIELD_NAMES.indexOf(key);
            const width = IS_FIELD_POSITIONS[idx + 1] - IS_FIELD_POSITIONS[idx];
            const raw = (currentRaw[key] || "").replace(/\s+$/, "");
            if (raw && (raw.length >= width - 1 || /[-\/]$/.test(raw))) { target = key; break; }
          }
          appendTo(target, tok);
          touched = true;
        }
      }
      if (!touched) { contEligible = false; continue; } // ไม่มีข้อมูลใน Text Field ใดเลย = Macro ให้เป็น Z (ทิ้ง)
    }
  }

  return { header, records, unmatchedLines };
}

/**
 * แปลง Branch Code -> BU (ตัวเลข เช่น "3218" ให้ Format ตรงกับ vat_reconcile_tb.bu)
 * 1) เช็ค branch_list ก่อน -> ได้ Short Code (เช่น "BTM") -> Join company_list
 *    แปลง Short Code เป็นตัวเลขจาก "COMPANY CODE" (Format Flexfield Prefix "1-32-3218-"
 *    เอา Segment ที่ 3 ออกมา) -- ยืนยันด้วยข้อมูลจริงในแชทแล้วว่า Format นี้ถูกต้อง
 * 2) Fallback: vat_watchlist_bu_group_range (Branch ในช่วง range_start-range_end
 *    ตัดตาม prefix_length ถ้ามี, ไม่อยู่ใน exclude_start-exclude_end) -> คืน group_name เป็น bu
 *    ⚠️ group_name ในตารางนี้ยังไม่ยืนยันว่าเป็นตัวเลขหรือ Short Code เหมือนกัน
 *    ต้องเช็คเพิ่มถ้าเจอ CRG-type Branch จริง (ยังไม่เคยทดสอบ)
 * คืน { bu, source: 'branch_list' | 'group_range' | 'unmatched' }
 */
async function resolveBranchToBu(branch) {
  const direct = await pool.query(
    `SELECT cl."COMPANY CODE" AS company_code
     FROM branch_list bl
     JOIN company_list cl ON cl.bu = bl.bu
     WHERE bl."Branch Code" = $1 AND bl.deleted IS NOT TRUE
     LIMIT 1`,
    [branch]
  );
  const companyCode = direct.rows[0]?.company_code;
  if (companyCode) {
    const segments = companyCode.split("-");
    const numericBu = segments[2];
    if (numericBu) {
      return { bu: numericBu, source: "branch_list" };
    }
  }

  const { rows: ranges } = await pool.query(
    `SELECT group_name, range_start, range_end, exclude_start, exclude_end, prefix_length
     FROM vat_watchlist_bu_group_range`
  );
  const branchNum = branch.replace(/\D/g, "");
  for (const r of ranges) {
    const key = r.prefix_length ? branchNum.slice(0, r.prefix_length) : branchNum;
    const rangeStart = r.prefix_length ? r.range_start.slice(0, r.prefix_length) : r.range_start;
    const rangeEnd = r.prefix_length ? r.range_end.slice(0, r.prefix_length) : r.range_end;
    if (key >= rangeStart && key <= rangeEnd) {
      if (r.exclude_start && r.exclude_end && branchNum >= r.exclude_start && branchNum <= r.exclude_end) {
        continue; // อยู่ในช่วง Exclude -> ไม่นับ Group นี้
      }
      return { bu: r.group_name, source: "group_range" };
    }
  }

  return { bu: null, source: "unmatched" };
}

/**
 * แปลง BU ไม่ว่าจะส่งมาแบบไหน (เลขล้วน "3218" หรือ Short Code "BTM") ให้เป็นเลข BU เสมอ
 * (Format ที่ vat_reconcile_tb / vat_reconcile_input_summary เก็บจริง)
 * ใช้จุดเดียวนี้ที่ทุก Endpoint เรียกใช้ กันปัญหา BTM vs 3218 ไม่ตรงกันที่เจอซ้ำหลายรอบ
 * คืนค่าเลข BU หรือ null ถ้าแปลงไม่ได้ (ไม่พบ BU นี้ในระบบเลย)
 */
async function resolveBuToNumeric(buInput) {
  if (!buInput) return null;
  if (/^\d+$/.test(buInput)) return buInput; // เป็นเลขอยู่แล้ว ไม่ต้องแปลง

  const { rows } = await pool.query(
    `SELECT "COMPANY CODE" AS company_code FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE LIMIT 1`,
    [buInput]
  );
  const companyCode = rows[0]?.company_code;
  if (!companyCode) return null;
  const segments = companyCode.split("-");
  return segments[2] || null;
}

// MARKER_VATRECONCILE_PASTE_TSV_V1 -- วาง Text ที่ Copy มาจาก Excel (คั่นด้วย Tab) -> แปลงเป็น Workbook ในหน่วยความจำ แล้วใช้ Parser .xlsx ตัวเดิม (Logic เดียวกัน)
const IS_PASTE_HEADER = ["สาขา", "ชื่อผู้ประกอบการ", "วันที่ (รับสินค้า)", "GRT_No. (รับสินค้า)", "วันที่ใบกำกับภาษี", "เลขที่ใบกำกับภาษี", "ชื่อผู้ค้า", "TAX ID", "HO", "BRANCH", "รายการ", "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ชำระ(เงินภาษี)", "ภาษีซื้อที่ใช้สิทธิ์ 100%  (มูลค่าสินค้า)", "ภาษีซื้อที่ใช้สิทธิ์ 100%  (เงินภาษี)", "Calculate Tax (M-O)"];
const TB_PASTE_HEADER = ["Branch", "CPC", "Account", "SubAcc", "Description", "Beginning Balance", "Period Activity", "Ending Balance"];
function isPasteTsvName(name) { return /\.tsv$/i.test(String(name || "").trim()); }
function parseTsvText(text) {
  const rows = []; let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === "") { q = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; continue; }
    cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
// kind: 'input_summary' | 'tb' -- ถ้าไม่ระบุ เดาจากหัวคอลัมน์/จำนวนคอลัมน์
async function tsvToXlsxBuffer(buffer, kindHint) {
  const rows = parseTsvText(buffer.toString("utf8"));
  if (!rows.length) { const e = new Error("ไม่พบข้อมูลในข้อความที่วาง"); e.code = "UNKNOWN_FORMAT"; throw e; }
  // MARKER_VATRECONCILE_PASTE_TB_PREFACE_V1 -- TB ที่ Copy มาพร้อมหัวรายงาน (Company / Branch / Account code / Period) -> อ่าน BU (4 ตัวหน้าของ Company) และ Period จากหัว
  let prefaceBu = null, prefacePeriod = null;
  {
    const hIdx = rows.slice(0, 30).findIndex((r) => /^branch$/i.test((r[0] || "").trim()) && /^cpc$/i.test((r[1] || "").trim()));
    if (hIdx > 0) {
      const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
      for (const r of rows.slice(0, hIdx)) {
        const k = (r[0] || "").trim().toLowerCase();
        const v = r.slice(1).map((c) => c.trim()).find((c) => c !== "") || "";
        if (k === "company") { const m = /^(\d{4})/.exec(v); if (m) prefaceBu = m[1]; }
        else if (k === "period") {
          let m = /(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})/.exec(v);
          if (m && MON[m[2].toUpperCase()]) prefacePeriod = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${MON[m[2].toUpperCase()]}`;
          else if ((m = /^(\d{4})-(\d{2})-\d{2}/.exec(v))) prefacePeriod = `${m[1]}-${m[2]}`;
        }
      }
      rows.splice(0, hIdx);
    }
  }
  const first = rows[0].map((c) => c.trim());
  let kind = null; let hasHeader = false;
  if (/สาขา/.test(first[0] || "") && /GRT/i.test(first[3] || "")) { kind = "input_summary"; hasHeader = true; }
  else if (/^branch$/i.test(first[0] || "") && /^cpc$/i.test(first[1] || "")) { kind = "tb"; hasHeader = true; }
  else if (first.length >= 16 && /^\d{4}[0-9A-Za-z]{1,2}$/.test(first[0])) kind = "input_summary";
  else if (first.length >= 8 && /^\d{5}$/.test(first[1]) && /^\d{8}$/.test(first[2])) kind = "tb";
  if (!kind) { const e = new Error("รูปแบบข้อความที่วางไม่ตรงกับ Input Summary / TB ที่ตัดแล้ว (ต้อง Copy จาก Excel พร้อมคอลัมน์ครบ)"); e.code = "UNKNOWN_FORMAT"; throw e; }
  if (kindHint && kindHint !== kind) { const e = new Error("ข้อความที่วางเป็นข้อมูลคนละชนิดกับที่เลือก"); e.code = "UNKNOWN_FORMAT"; throw e; }
  const header = kind === "tb" ? TB_PASTE_HEADER : IS_PASTE_HEADER;
  const numCols = kind === "tb" ? [5, 6, 7] : [11, 12, 13, 14, 15];
  const toNum = (v) => { let t = String(v ?? "").trim(); if (t === "" || t === "-") return 0; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); t = t.replace(/[(),\s-]/g, ""); const n = Number(t); return Number.isFinite(n) ? (neg ? -n : n) : 0; };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === "tb" ? "Recon_TB" : "Input Review");
  ws.addRow(hasHeader ? first.slice(0, header.length) : header);
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const out = header.map((_, i) => (numCols.includes(i) ? toNum(r[i]) : (String(r[i] ?? "").trim() === "" ? null : String(r[i]).trim())));
    ws.addRow(out);
  }
  if (kind === "tb" && (prefaceBu || prefacePeriod)) {
    const rw = wb.addWorksheet("Raw TB");
    const MN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    if (prefaceBu) rw.addRow([`Company Range: ${prefaceBu} to ${prefaceBu}`]);
    if (prefacePeriod) rw.addRow([`Period to date for ${MN[Number(prefacePeriod.slice(5, 7)) - 1]}-${prefacePeriod.slice(2, 4)}`]);
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), kind };
}

// MARKER_VATRECONCILE_IS_XLSX_CONFIRMED_V1 -- Input Summary รูปแบบ .xlsx ที่ Confirm แล้ว (ใช้ได้ทันที)
// ชื่อไฟล์ที่สื่อได้: "09.2026 Input Summary_CF-Y.Y-A.B_0402.xlsx" -> 09.2026 = Period, A = Tax Type (N/A -> 11610752, F/T -> 11610755), 0402 = BU (หาจากสาขาในไฟล์)
// ถ้าชื่อไฟล์ระบุ Period / Tax Type ไม่ได้ -> โยน NEED_META ให้ Frontend เปิด Popup ให้ผู้ใช้กำหนด แล้วส่งกลับมาทาง period / tax_type
// หัวคอลัมน์แถวที่ 1 (A-P): สาขา, ชื่อผู้ประกอบการ, วันที่รับสินค้า, GRT, วันที่ใบกำกับ, เลขที่ใบกำกับ, ชื่อผู้ค้า, TAX ID, HO, BRANCH, รายการ, ซื้อชำระ(มูลค่า/ภาษี), ใช้สิทธิ์100%(มูลค่า/ภาษี), Calculate Tax
function isInputSummaryXlsxName(name) { return /\.xlsx$/i.test(String(name || "").trim()); }
function isAccountOfTaxType(t) { return taxAccountOf(t); }

async function parseInputSummaryXlsx(buffer, filename, overrides = {}) {
  const name = String(filename || "").trim();
  const pm = /(?:^|[^\d])(\d{2})\.(\d{4})(?!\d)/.exec(name);
  const tm = /-[YN]\.[YN]-([A-Za-z])(?:\.[A-Za-z])?(?:[ _.]|$)/i.exec(name);
  const bm = /[ _](\d{4})\.xlsx$/i.exec(name);
  let period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(overrides.period || "")) ? overrides.period : (pm ? `${pm[2]}-${pm[1]}` : null);
  let taxType = String(overrides.taxType || "").toUpperCase();
  if (!taxCodes().includes(taxType)) taxType = tm && taxCodes().includes(tm[1].toUpperCase()) ? tm[1].toUpperCase() : null;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const hdr = ws ? [1, 4, 12, 16].map((c) => simpleCleanText(ws.getRow(1).getCell(c).value) || "") : [];
  if (!ws || !hdr[0].includes("สาขา") || !/GRT/i.test(hdr[1]) || !hdr[2].includes("ภาษีซื้อที่ชำระ") || !/Calculate/i.test(hdr[3])) {
    const e = new Error("รูปแบบไฟล์ .xlsx ไม่ตรงกับ Input Summary ที่ Confirm แล้ว (หัวคอลัมน์แถวที่ 1 ต้องเป็น สาขา, ..., GRT_No., ..., ภาษีซื้อที่ชำระ, ..., Calculate Tax)");
    e.code = "UNKNOWN_FORMAT";
    throw e;
  }
  const txt = (row, c) => simpleCleanText(row.getCell(c).value);
  const dt = (row, c) => {
    const v = row.getCell(c).value;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const t = simpleCleanText(v);
    return t ? isParseDate(t) : null;
  };
  const num = (row, c) => simpleCellNumber(row, c);
  const records = [];
  const unmatchedLines = [];
  let operatorName = null;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return; // หัวคอลัมน์
    const branch = txt(row, 1);
    if (!branch) { if (txt(row, 6) || txt(row, 4)) unmatchedLines.push(`row ${rn}`); return; }
    const op = txt(row, 2);
    if (!operatorName && op) operatorName = op;
    const ho = txt(row, 9);
    const branchField = txt(row, 10);
    records.push({
      branch,
      operator_name: op,
      receive_date: dt(row, 3),
      grt_no: txt(row, 4) || "",
      tax_invoice_date: dt(row, 5),
      tax_invoice_no: (txt(row, 6) || "").replace(/^\*/, "").trim(),
      vendor_name: txt(row, 7) || "",
      tax_id: txt(row, 8) || "",
      ho: !ho && !branchField ? "00000" : (ho || ""),
      branch_field: branchField || null,
      item_detail: txt(row, 11) || "",
      paid_amount: num(row, 12),
      paid_vat: num(row, 13),
      claimed100_amount: num(row, 14),
      claimed100_vat: num(row, 15),
      calculate_tax: num(row, 16),
    });
  });
  if (!period || !taxType) {
    const dates = records.map((r) => r.receive_date).filter(Boolean).sort();
    const e = new Error("ชื่อไฟล์ระบุ " + [!period ? "Period" : null, !taxType ? "Tax Type" : null].filter(Boolean).join(" และ ") + " ไม่ได้ — กรุณากำหนดเอง");
    e.code = "NEED_META";
    e.suggest = { period: period || (dates.length ? dates[dates.length - 1].slice(0, 7) : null), taxType: taxType || null, rows: records.length };
    throw e;
  }
  return { header: { period, taxType, reconcileAccount: isAccountOfTaxType(taxType), operatorName, confirmedXlsx: true, fileBu: bm ? bm[1] : null }, records, unmatchedLines };
}

/**
 * Resolve BU ให้ทุก Record พร้อมกัน (Cache ผลต่อ Branch กันเรียก Query ซ้ำ)
 */
async function resolveAllBranches(records, period) {
  // MARKER_VATRECONCILE_BRANCH_FALLBACK_KEEP_ROWS_V1 -- ห้ามทิ้งแถว: สาขาที่ Match ไม่ได้ (ไม่มีใน branch_list / Group Range) ให้ดู BU จาก TB (สาขาเดียวกัน) หรือ BU ของไฟล์นี้ แล้วเก็บเข้า Detail พร้อมธง (branch_match_source = tb_fallback / file_fallback)
  const cache = new Map();
  const resolved = [];
  const pending = [];
  const unmatched = [];

  for (const r of records) {
    if (!cache.has(r.branch)) {
      cache.set(r.branch, await resolveBranchToBu(r.branch));
    }
    const { bu, source } = cache.get(r.branch);
    if (!bu) { pending.push(r); continue; }
    resolved.push({ ...r, bu, branch_match_source: source, branch_warning: false });
  }

  const fileBus = [...new Set(resolved.map((x) => x.bu))];
  const fbCache = new Map();
  const fallbackFor = async (branch) => {
    if (fbCache.has(branch)) return fbCache.get(branch);
    let out = null;
    try { // 1) TB มีสาขานี้ -> ต้อง Match ได้เสมอ (เทียบแบบ trim/ตัวพิมพ์ใหญ่; ลอง Period นี้ก่อน ไม่เจอค่อยทุก Period; ถ้าหลาย BU เลือกตัวที่ตรงกับ BU ของไฟล์ก่อน)
      const pre = String(branch || "").replace(/\D/g, "").slice(0, 4);
      const tryTb = async (withPeriod) => {
        const q = withPeriod
          ? await pool.query(`SELECT bu, COUNT(*)::int AS n FROM vat_reconcile_tb WHERE upper(btrim(branch)) = upper(btrim($1)) AND period = $2 GROUP BY bu`, [branch, period])
          : await pool.query(`SELECT bu, COUNT(*)::int AS n FROM vat_reconcile_tb WHERE upper(btrim(branch)) = upper(btrim($1)) GROUP BY bu`, [branch]);
        const bus = q.rows.map((x) => String(x.bu)).filter(Boolean);
        if (!bus.length) return null;
        return bus.find((b) => fileBus.includes(b)) || bus.find((b) => b === pre) || bus[0];
      };
      let tbBu = period ? await tryTb(true) : null;
      if (!tbBu) tbBu = await tryTb(false);
      if (tbBu) out = { bu: tbBu, source: "tb_fallback" };
    } catch (e) { console.warn("[vatReconcile] tb fallback skipped:", e.message); }
    if (!out) { // 2) BU ของไฟล์นี้ (มี BU เดียว หรือ 4 หลักแรกของสาขาตรงกับ BU ใด BU หนึ่ง)
      const pre = String(branch || "").replace(/\D/g, "").slice(0, 4);
      if (fileBus.length === 1) out = { bu: fileBus[0], source: "file_fallback" };
      else if (fileBus.includes(pre)) out = { bu: pre, source: "file_fallback" };
    }
    fbCache.set(branch, out);
    return out;
  };
  for (const r of pending) {
    const fb = await fallbackFor(r.branch);
    if (!fb) { unmatched.push(r); continue; }
    resolved.push({ ...r, bu: fb.bu, branch_match_source: fb.source, branch_warning: true });
  }

  return { resolved, unmatched };
}

/**
 * POST /vat-reconcile/input-summary/preview
 * รับไฟล์ Input Summary ดิบ -> Parse + Match BU -> คืน Summary (ไม่เขียน DB)
 */
router.post("/input-summary/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    if (isPasteTsvName(req.file.originalname)) { const cv = await tsvToXlsxBuffer(req.file.buffer, "input_summary"); req.file.buffer = cv.buffer; req.file.originalname = "pasted-excel.xlsx"; } // MARKER_VATRECONCILE_PASTE_TSV_V1
    const isXlsx = isInputSummaryXlsxName(req.file.originalname);
    const rawText = isXlsx ? "" : decodeCp874(req.file.buffer); // แก้จาก latin1 -- ต้องใช้ cp874 ถึงจะอ่าน Thai Text ถูกต้อง -- decodeCp874() เขียนเอง ไม่พึ่ง Library
    const { header, records, unmatchedLines } = isXlsx ? await parseInputSummaryXlsx(req.file.buffer, req.file.originalname, { period: req.body.period, taxType: req.body.tax_type }) : parseInputSummaryText(rawText);

    if (!header.period) {
      return res.status(422).json({ error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้" });
    }

    const { resolved, unmatched } = await resolveAllBranches(records, header.period);

    // สรุปจำนวน Record เดิมที่จะถูกลบ ต่อ (bu, tax_type) ที่เจอในไฟล์นี้
    const buSet = [...new Set(resolved.map((r) => r.bu))];
    let existingCount = 0;
    if (buSet.length) {
      const { rows } = await pool.query(
        header.confirmedXlsx
          ? `SELECT COUNT(*) FROM vat_reconcile_input_summary WHERE bu = ANY($1) AND period = $2 AND reconcile_account = $3` // xlsx Confirm แล้ว: แทนที่ทั้งก้อน BU + Period + Account
          : `SELECT COUNT(*) FROM vat_reconcile_input_summary
         WHERE bu = ANY($1) AND period = $2 AND tax_type = $3`,
        [buSet, header.period, header.confirmedXlsx ? header.reconcileAccount : header.taxType]
      );
      existingCount = parseInt(rows[0].count, 10);
    }

    // MARKER_VATRECONCILE_INPUT_PREVIEW_DIFF_V1 -- เทียบไฟล์ใหม่กับข้อมูลเดิมใน DB (ขอบเขตเดียวกับที่ Commit จะลบ): ใหม่ / ยอดเปลี่ยน / ไม่เปลี่ยน / จะถูกลบ (ไม่อยู่ในไฟล์ใหม่) -- อ่านอย่างเดียว ไม่เขียน DB
    let diffCounts = { new_count: resolved.length, updated_count: 0, unchanged_count: 0, removed_count: 0 };
    let removedRecords = [];
    try {
      const existingRows = buSet.length ? (await pool.query(
        header.confirmedXlsx
          ? `SELECT bu, branch, tax_invoice_no, vendor_name, claimed100_amount, claimed100_vat FROM vat_reconcile_input_summary WHERE bu = ANY($1) AND period = $2 AND reconcile_account = $3`
          : `SELECT bu, branch, tax_invoice_no, vendor_name, claimed100_amount, claimed100_vat FROM vat_reconcile_input_summary WHERE bu = ANY($1) AND period = $2 AND tax_type = $3`,
        [buSet, header.period, header.confirmedXlsx ? header.reconcileAccount : header.taxType]
      )).rows : [];
      const keyOf = (bu, branch, inv) => `${String(bu || "").trim()}|${String(branch || "").trim().toUpperCase()}|${String(inv || "").trim().toUpperCase()}`;
      const pool_ = new Map(); // key -> แถวเดิมที่ยังไม่ถูกจับคู่ (รองรับเลขซ้ำ: จับคู่ทีละแถว)
      for (const e of existingRows) { const k = keyOf(e.bu, e.branch, e.tax_invoice_no); if (!pool_.has(k)) pool_.set(k, []); pool_.get(k).push(e); }
      const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
      let nNew = 0, nUpd = 0, nSame = 0;
      for (const r of resolved) {
        const list = pool_.get(keyOf(r.bu, r.branch, r.tax_invoice_no));
        const old = list && list.length ? list.shift() : null;
        if (!old) { r.status = "new"; nNew++; continue; }
        if (same(old.claimed100_amount, r.claimed100_amount) && same(old.claimed100_vat, r.claimed100_vat)) { r.status = "unchanged"; nSame++; }
        else { r.status = "updated"; r.old_claimed100_amount = old.claimed100_amount; r.old_claimed100_vat = old.claimed100_vat; nUpd++; }
      }
      for (const list of pool_.values()) for (const e of list) removedRecords.push({ status: "removed", branch: e.branch, tax_invoice_no: e.tax_invoice_no, vendor_name: e.vendor_name, claimed100_amount: e.claimed100_amount, claimed100_vat: e.claimed100_vat });
      diffCounts = { new_count: nNew, updated_count: nUpd, unchanged_count: nSame, removed_count: removedRecords.length };
    } catch (diffErr) { console.warn("[vatReconcile] input-summary preview diff skipped:", diffErr.message); diffCounts = null; }

    res.json({
      summary: {
        period: header.period,
        tax_type: header.taxType,
        reconcile_account: header.reconcileAccount,
        bu_list: buSet,
        ...(diffCounts || {}),
        parsed_count: records.length,
        matched_count: resolved.length,
        unmatched_branch_count: unmatched.length,
        fallback_count: resolved.filter((x) => x.branch_warning).length, // MARKER_VATRECONCILE_BRANCH_FALLBACK_KEEP_ROWS_V1
        fallback_branches: [...new Set(resolved.filter((x) => x.branch_warning).map((x) => x.branch))],
        unmatched_lines_count: unmatchedLines.length,
        existing_rows_to_replace: existingCount,
      },
      records: resolved,
      removed_records: removedRecords, // MARKER_VATRECONCILE_INPUT_PREVIEW_DIFF_V1
      unmatched_branches: unmatched,
      unmatchedLines,
    });
  } catch (err) {
    if (err.code === "NEED_META" || err.code === "UNKNOWN_FORMAT") return res.status(422).json({ error: err.message, code: err.code, suggest: err.suggest || null }); // MARKER_VATRECONCILE_IS_XLSX_CONFIRMED_V1
    console.error("[vatReconcile] input-summary preview error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างประมวลผลไฟล์", detail: err.message });
  }
});

/**
 * POST /vat-reconcile/input-summary/commit
 * Parse + Match BU เหมือน Preview แล้ว Replace ทั้งก้อน: ลบของเก่า (bu, period, tax_type)
 * แต่ละ BU ที่เจอในไฟล์ แล้ว Insert ชุดใหม่ทั้งหมด ในทำ Transaction เดียว
 */
router.post("/input-summary/commit", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    if (isPasteTsvName(req.file.originalname)) { const cv = await tsvToXlsxBuffer(req.file.buffer, "input_summary"); req.file.buffer = cv.buffer; req.file.originalname = "pasted-excel.xlsx"; } // MARKER_VATRECONCILE_PASTE_TSV_V1
    const isXlsx = isInputSummaryXlsxName(req.file.originalname);
    const rawText = isXlsx ? "" : decodeCp874(req.file.buffer); // แก้จาก latin1 -- เหตุผลเดียวกับ /input-summary/preview
    const fileId = req.body.file_id ? parseInt(req.body.file_id, 10) : null;
    const updatedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";

    const { header, records, unmatchedLines } = isXlsx ? await parseInputSummaryXlsx(req.file.buffer, req.file.originalname, { period: req.body.period, taxType: req.body.tax_type }) : parseInputSummaryText(rawText);
    if (!header.period) {
      return res.status(422).json({ error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้" });
    }

    const { resolved, unmatched } = await resolveAllBranches(records, header.period);
    const buSet = [...new Set(resolved.map((r) => r.bu))];

    await client.query("BEGIN");

    let deletedCount = 0;
    if (buSet.length) {
      const del = header.confirmedXlsx
        ? await client.query( // xlsx Confirm แล้ว: แทนที่ทั้งก้อน BU + Period + Account
            `DELETE FROM vat_reconcile_input_summary WHERE bu = ANY($1) AND period = $2 AND reconcile_account = $3`,
            [buSet, header.period, header.reconcileAccount]
          )
        : await client.query(
            `DELETE FROM vat_reconcile_input_summary
         WHERE bu = ANY($1) AND period = $2 AND tax_type = $3`,
            [buSet, header.period, header.taxType]
          );
      deletedCount = del.rowCount;
    }

    const now = new Date();
    let insertedCount = 0;
    for (const r of resolved) {
      await client.query(
        `INSERT INTO vat_reconcile_input_summary (
            bu, period, branch, branch_match_source, tax_type, reconcile_account,
            operator_name, receive_date, grt_no, tax_invoice_date, tax_invoice_no,
            vendor_name, tax_id, ho, branch_field, item_detail,
            paid_amount, paid_vat, claimed100_amount, claimed100_vat, calculate_tax,
            last_file_id, updated_by, update_source, created_at, updated_at
         ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,
            $12,$13,$14,$15,$16,
            $17,$18,$19,$20,$21,
            $22,$23,'upload',$24,$24
         )`,
        [
          r.bu, header.period, r.branch, r.branch_match_source, header.taxType, header.reconcileAccount,
          r.operator_name, r.receive_date, r.grt_no, r.tax_invoice_date, r.tax_invoice_no,
          r.vendor_name, r.tax_id, r.ho, r.branch_field, r.item_detail,
          r.paid_amount, r.paid_vat, r.claimed100_amount, r.claimed100_vat, r.calculate_tax,
          fileId, updatedBy, now,
        ]
      );
      insertedCount++;
    }

    await client.query("COMMIT");

    res.json({
      period: header.period,
      tax_type: header.taxType,
      bu_list: buSet,
      deleted: deletedCount,
      inserted: insertedCount,
      unmatched_branch_count: unmatched.length,
      unmatched_lines_count: unmatchedLines.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "NEED_META" || err.code === "UNKNOWN_FORMAT") return res.status(422).json({ error: err.message, code: err.code, suggest: err.suggest || null });
    console.error("[vatReconcile] input-summary commit error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล", detail: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /vat-reconcile/rebind-branches   body: { period?, bu?, branch? }
 * MARKER_VATRECONCILE_REBIND_BRANCHES_V1 -- หลังเพิ่ม/แก้สาขาใน branch_list: ผูกแถว Input Summary ที่เคยถูก Fallback (tb_fallback / file_fallback) ใหม่
 * ด้วย branch_list / Group Range จริง -> อัปเดต bu + branch_match_source (ไม่ลบ ไม่ย้ายแถวอื่น) แล้วคืนจำนวนที่ผูกได้
 */
router.post("/rebind-branches", async (req, res) => {
  try {
    const { period, bu, branch } = req.body || {};
    const filters = []; // [{ col, val }] -- สร้าง WHERE ใหม่ทุกครั้งให้เลข $ ตรงกับ Query นั้น
    if (period) filters.push({ col: "period", val: period });
    if (branch) filters.push({ col: "branch", val: String(branch).trim() }); // แก้สาขาเดี่ยว: ผูกทุกแถวของสาขานั้นใหม่ (รวมกรณีเปลี่ยน BU ใน Edit Branch) ไม่จำกัด BU/แหล่งที่มาเดิม
    else if (bu) {
      const numeric = await resolveBuToNumeric(bu);
      if (numeric) filters.push({ col: "bu", val: numeric });
    }
    const baseCond = branch ? "TRUE" : "branch_match_source IN ('tb_fallback','file_fallback')";
    const buildWhere = (offset) => ({
      sql: baseCond + filters.map((f, i) => ` AND ${f.col} = $${offset + i + 1}`).join(""),
      vals: filters.map((f) => f.val),
    });
    const w0 = buildWhere(0);
    const { rows } = await pool.query(`SELECT DISTINCT branch FROM vat_reconcile_input_summary WHERE ${w0.sql}`, w0.vals);
    let reboundBranches = 0;
    let reboundRows = 0;
    const stillMissing = [];
    for (const r of rows) {
      const hit = await resolveBranchToBu(r.branch);
      if (!hit || !hit.bu) { stillMissing.push(r.branch); continue; }
      const w1 = buildWhere(3);
      const upd = await pool.query(
        `UPDATE vat_reconcile_input_summary
            SET bu = $1, branch_match_source = $2, updated_at = now()
          WHERE branch = $3 AND ${w1.sql}`,
        [hit.bu, hit.source, r.branch, ...w1.vals]
      );
      reboundBranches++;
      reboundRows += upd.rowCount;
    }
    console.log(`[vatReconcile] rebind-branches period=${period || "-"} bu=${bu || "-"} branches=${reboundBranches} rows=${reboundRows} by=${req.user?.email || "unknown"}`);
    res.json({ rebound_branches: reboundBranches, rebound_rows: reboundRows, still_missing: stillMissing });
  } catch (err) {
    console.error("[vatReconcile] rebind-branches error:", err);
    res.status(500).json({ error: "ผูกสาขาใหม่ไม่สำเร็จ", detail: err.message });
  }
});

/**
 * DELETE /vat-reconcile/input-summary?bu=...&account=...&period=...
 * MARKER_VATRECONCILE_INPUT_SUMMARY_CLEAR_V1 -- ล้าง Input Summary ทั้งก้อนของ BU + Account + Period (ใช้ตอนนำเข้าผิด แล้วต้องนำเข้าใหม่)
 * รับ bu ได้ทั้งเลข ("3218") และ Short Code ("BTM") เหมือน /dashboard/report
 */
router.delete("/input-summary", async (req, res) => {
  try {
    const { account, period } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
    }
    bu = await resolveBuToNumeric(bu);
    if (!bu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }
    const del = await pool.query(
      `DELETE FROM vat_reconcile_input_summary
       WHERE bu = $1 AND reconcile_account = $2 AND period = $3`,
      [bu, account, period]
    );
    console.log(`[vatReconcile] input-summary CLEAR bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "unknown"}`);
    res.json({ bu, account, period, deleted: del.rowCount });
  } catch (err) {
    console.error("[vatReconcile] input-summary clear error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างล้างข้อมูล", detail: err.message });
  }
});

/**
 * DELETE /vat-reconcile/tb?bu=...&account=...&period=...
 * MARKER_VATRECONCILE_TB_CLEAR_V1 -- ล้าง Trial Balance ทั้งก้อนของ BU + Account + Period (ใช้ตอนบันทึก TB ผิด แล้วต้องนำเข้าใหม่)
 * Freeze: Period ที่ปิดงวดแล้ว (tax_close_period.status closed/purged) หรือมี TB Period ใหม่กว่า -> 409 ล้างไม่ได้ (Input Summary ไม่ Freeze)
 * ลบทุกแถวรวมแถว is_protected_account ด้วย (TB Commit เป็น Upsert จึงต้องล้างก่อนถึงจะแก้ที่ผิดออกได้)
 */
// MARKER_VATRECONCILE_CELL_EDIT_BACK_V7 -- แก้ Cell จาก Preview (Excel Grid) ลง DB | Period ที่ปิดงวดแล้ว (tax_close_period closed/purged) = 409
const CELL_EDIT = {
  tb: {
    table: "vat_reconcile_tb",
    periodSql: "SELECT period FROM vat_reconcile_tb WHERE id = $1",
    cols: { branch: "t", cpc: "t", account: "t", subacc: "t", description: "t", beginning_balance: "n", period_activity: "n", ending_balance: "n" },
  },
  simple_detail: {
    table: "vat_reconcile_simple_detail",
    periodSql: "SELECT h.period FROM vat_reconcile_simple_detail d JOIN vat_reconcile_simple_header h ON h.id = d.header_id WHERE d.id = $1",
    cols: { running_no: "t", receive_date: "d", tax_invoice_date: "d", tax_invoice_no: "t", vendor_name: "t", tax_id: "t", branch_field: "t", item_detail: "t",
            paid_amount: "n", paid_vat: "n", claimed_amount: "n", claimed_vat: "n", claim_percent: "p" },
  },
};
router.put("/cell", express.json(), async (req, res) => {
  try {
    const { table, id, field, value } = req.body || {};
    const cfg = CELL_EDIT[table];
    if (!cfg || !Number.isInteger(Number(id)) || !Object.prototype.hasOwnProperty.call(cfg.cols, field)) {
      return res.status(400).json({ error: "ตาราง/คอลัมน์ไม่อนุญาตให้แก้ไข" });
    }
    const pr = await pool.query(cfg.periodSql, [Number(id)]);
    if (!pr.rows.length) return res.status(404).json({ error: "ไม่พบแถวที่ต้องการแก้ไข" });
    try {
      const st = (await pool.query(`SELECT status FROM tax_close_period WHERE period_ym = $1`, [pr.rows[0].period])).rows[0]?.status;
      if (st === "closed" || st === "purged") return res.status(409).json({ error: `Period ${pr.rows[0].period} ปิดงวดแล้ว แก้ไขไม่ได้`, code: "PERIOD_FROZEN" });
    } catch (e) { if (e.code !== "42P01") throw e; }
    const kind = cfg.cols[field];
    let v = value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();
    if (v !== null && (kind === "n" || kind === "p")) {
      const n = Number(v.replace(/,/g, "").replace(/%$/, ""));
      if (!Number.isFinite(n)) return res.status(400).json({ error: "ต้องเป็นตัวเลข" });
      v = kind === "p" ? n / 100 : n; // claim_percent เก็บเป็นสัดส่วน (100 -> 1)
    }
    if (v !== null && kind === "d" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ error: "วันที่ต้องเป็นรูปแบบ YYYY-MM-DD" });
    await pool.query(`UPDATE ${cfg.table} SET ${field} = $1 WHERE id = $2`, [v, Number(id)]);
    console.log(`[vatReconcile] cell edit ${table}#${id}.${field} by=${req.user?.email || "unknown"}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[vatReconcile] cell edit error:", err);
    res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message });
  }
});

// MARKER_VATRECONCILE_SIMPLE_CLEAR_V1 -- ล้าง Simple 100 / Simple AVG ของ BU + Account + Period (ลบจริงใน DB: detail แล้วตาม header) -- ใช้กับจุดเขียวใน Dashboard (คลิกขวา > ล้างข้อมูล)
router.delete("/simple", async (req, res) => {
  const client = await pool.connect();
  try {
    const { account, period, type } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period || !["simple_100", "simple_avg"].includes(type)) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period และ type (simple_100 | simple_avg) ให้ครบ" });
    }
    bu = await resolveBuToNumeric(bu);
    if (!bu) return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    const dbType = type === "simple_100" ? "100" : "AVG"; // simple_type ใน DB เก็บเป็น '100' / 'AVG'
    await client.query("BEGIN");
    const d = await client.query(
      `DELETE FROM vat_reconcile_simple_detail WHERE header_id IN (
         SELECT id FROM vat_reconcile_simple_header WHERE bu = $1 AND reconcile_account = $2 AND period = $3 AND simple_type = $4)`,
      [bu, account, period, dbType]
    );
    const h = await client.query(
      `DELETE FROM vat_reconcile_simple_header WHERE bu = $1 AND reconcile_account = $2 AND period = $3 AND simple_type = $4`,
      [bu, account, period, dbType]
    );
    await client.query("COMMIT");
    console.log(`[vatReconcile] simple CLEAR bu=${bu} account=${account} period=${period} type=${type} headers=${h.rowCount} details=${d.rowCount} by=${req.user?.email || "unknown"}`);
    res.json({ bu, account, period, type, deleted: h.rowCount, details: d.rowCount });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[vatReconcile] simple clear error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างล้างข้อมูล", detail: err.message });
  } finally {
    client.release();
  }
});

router.delete("/tb", async (req, res) => {
  try {
    const { account, period } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
    }
    bu = await resolveBuToNumeric(bu);
    if (!bu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }
    // Freeze: TB ของ Period ที่ปิดงวดแล้ว หรือมี TB ของ Period ใหม่กว่านำเข้าแล้ว = ยอดสุดท้าย ล้างไม่ได้
    try {
      const st = (await pool.query(`SELECT status FROM tax_close_period WHERE period_ym = $1`, [period])).rows[0]?.status;
      if (st === "closed" || st === "purged") {
        return res.status(409).json({ error: `Period ${period} ปิดงวดแล้ว — TB ถูก Freeze ล้างไม่ได้`, code: "PERIOD_FROZEN" });
      }
    } catch (e) {
      if (e.code !== "42P01") throw e; // ไม่มีตาราง tax_close_period = ข้ามเช็คสถานะปิดงวด
    }
    const newer = await pool.query(`SELECT 1 FROM vat_reconcile_tb WHERE period > $1 LIMIT 1`, [period]);
    if (newer.rowCount > 0) {
      return res.status(409).json({ error: `Period ${period} ถูก Freeze (มี TB ของ Period ใหม่กว่านำเข้าแล้ว) ล้างไม่ได้`, code: "PERIOD_FROZEN" });
    }
    const del = await pool.query(
      `DELETE FROM vat_reconcile_tb
       WHERE bu = $1 AND account = $2 AND period = $3`,
      [bu, account, period]
    );
    console.log(`[vatReconcile] tb CLEAR bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "unknown"}`);
    res.json({ bu, account, period, deleted: del.rowCount });
  } catch (err) {
    console.error("[vatReconcile] tb clear error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างล้างข้อมูล", detail: err.message });
  }
});

// ===========================================================================
// ส่วนที่ 3: Dashboard Status (สรุปสถานะข้อมูลต่อ BU / Tax Type Group)
// ===========================================================================
// ตาม Mockup ที่ออกแบบไว้: 1 แถว = 1 (BU, กลุ่มภาษี Asset/Expense)
// Column: TB / Input Summary / Simple 100 / Simple AVG / พร้อม Reconcile
//
// Filter BU: company_list.vat_watchlist_status='active' + allowed_tax_type ไม่ว่าง
// Tax Type Group: F,T -> Asset (Account 11610755) / A,N -> Expense (Account 11610752)
// "All Type" -> เท่ากับมีครบทั้ง 4 ตัว (N,T,A,F) -> มีทั้ง 2 กลุ่ม
//
// ⚠️ Simple 100 / Simple AVG ยังไม่มีตารางเก็บข้อมูลจริง (ยังไม่ได้ทำ Endpoint ฝั่งนั้น)
//    ตอนนี้ Column นี้ Hardcode เป็น false (Inactive) ไปก่อนเสมอ รอทำ Feature ถัดไป
// ===========================================================================

const EXPENSE_ACCOUNT = "11610752";
const ASSET_ACCOUNT = "11610755";

function parseAllowedTaxTypeGroups(allowedTaxType) {
  const raw = (allowedTaxType || "").trim();
  if (!raw) return [];

  let codes;
  if (raw.toLowerCase() === "all type") {
    codes = TAX_MAP.filter((x) => x.in_all_type).map((x) => x.tax_type);
  } else {
    codes = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }

  const groups = new Set();
  for (const c of codes) {
    const g = taxGroupOf(c);
    if (g) groups.add(g);
  }
  return [...groups];
}

/**
 * GET /vat-reconcile/dashboard/status?period=2026-08
 * คืนรายการ (BU, กลุ่มภาษี) พร้อมสถานะ Active/Inactive ต่อรายงาน
 */
/**
 * GET /vat-reconcile/dashboard/periods
 * คืนรายการ Period (YYYY-MM) ที่มีข้อมูลจริงอยู่ (ยึดจาก Detail: Input Summary หรือ Simple Detail -- มีแต่ TB ไม่นับ MARKER_VATRECONCILE_PERIODS_NO_TB_ONLY_V1) เรียงใหม่สุดก่อน
 * ใช้เป็น Option ของ Dropdown "PERIOD" ใน Command Center แทนการ Gen ปฏิทินลอยๆ
 */
router.get("/dashboard/periods", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT period FROM vat_reconcile_input_summary
       UNION
       SELECT h.period FROM vat_reconcile_simple_header h
        WHERE EXISTS (SELECT 1 FROM vat_reconcile_simple_detail d WHERE d.header_id = h.id)
       ORDER BY period DESC`
    );
    res.json({ periods: rows.map((r) => r.period) });
  } catch (err) {
    console.error("[vatReconcile] dashboard periods error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึงรายการ Period", detail: err.message });
  }
});

// MARKER_VATRECONCILE_CLAIM_PERCENT_V1 -- % ใช้สิทธิ์เฉลี่ยของ BU: ดูจากช่อง "%" ของแต่ละสาขาใน branch_list ก่อน; ถ้า Match สาขาไม่ได้ (หรือสาขานั้นไม่มี %) ใช้ "VAT %" ของ Company แทน; ไม่มีทั้งคู่ = 100
function reconParsePct(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[%,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}
async function reconClaimPercentLookup(numericBu, buRaw) {
  let buShort = /^\d+$/.test(String(buRaw)) ? null : String(buRaw);
  const byBranch = new Map();
  let companyPct = null;
  try {
    if (!buShort) {
      const sc = await pool.query(
        `SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`,
        [String(numericBu)]
      );
      buShort = sc.rows[0]?.bu || null;
    }
    if (buShort) {
      const bq = await pool.query(`SELECT * FROM branch_list WHERE bu = $1 AND deleted IS NOT TRUE`, [buShort]);
      if (bq.rows.length) {
        const codeKey = reconPickKey(bq.rows[0], /branch.*code/i) || "Branch Code";
        const pctKey = reconPickKey(bq.rows[0], /^[\s_]*%[\s_]*$/) || reconPickKey(bq.rows[0], /^[\s_]*(claim|percent|pct)/i);
        for (const r of bq.rows) {
          const p = pctKey ? reconParsePct(r[pctKey]) : null;
          if (r[codeKey] != null && p != null) byBranch.set(String(r[codeKey]).trim(), p);
        }
      }
      const cq = await pool.query(`SELECT * FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE LIMIT 1`, [buShort]);
      if (cq.rows[0]) {
        const vk = reconPickKey(cq.rows[0], /vat.*(%|percent)/i);
        companyPct = vk ? reconParsePct(cq.rows[0][vk]) : null;
      }
    }
  } catch (e) {
    console.warn("[vatReconcile] claim percent lookup skipped:", e.message);
  }
  return { pctOf: (branch) => byBranch.get(String(branch).trim()) ?? companyPct ?? 100 };
}

/**
 * GET /vat-reconcile/dashboard/report?type=tb|input_summary|reconcile&bu=...&account=...&period=...
 * ดึงข้อมูลที่มีอยู่แล้วมาโชว์เฉยๆ (Preview) -- ไม่มีการเขียน DB ใดๆ ในนี้เลย
 *
 * type=tb            -> ยอดจาก vat_reconcile_tb ต่อสาขา
 * type=input_summary -> ยอดรวม (Sum) จาก vat_reconcile_input_summary ต่อสาขา
 * type=reconcile     -> เทียบยอด TB vs Input Summary ต่อสาขา (Label เดิม "Input-N 100%" ที่คุยกันไว้)
 *
 * ⚠️ type=simple_100 / simple_avg ยังไม่มีตารางเก็บข้อมูลจริง (Feature นี้ยังไม่ได้ทำ)
 *    ถ้าเลือกจะคืน Error แจ้งตรงๆ ว่ายังไม่รองรับ
 */
router.get("/dashboard/report", async (req, res) => {
  try {
    const { type, account, period } = req.query;
    let { bu } = req.query;
    const buRawForPct = bu; // MARKER_VATRECONCILE_CLAIM_PERCENT_V1
    if (!type || !bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ type, bu, account, period ให้ครบ" });
    }

    // รับ bu ได้ทั้ง 2 แบบ (เลข "3218" หรือ Short Code "BTM") -- แปลงเป็นเลขเสมอก่อน Query DB
    bu = await resolveBuToNumeric(bu);
    if (!bu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }

    if (type === "tb") {
      const { rows } = await pool.query(
        `SELECT id, branch, cpc, account, subacc, description,
                beginning_balance::float8 AS beginning_balance,
                period_activity::float8 AS period_activity,
                ending_balance::float8 AS ending_balance
         FROM vat_reconcile_tb
         WHERE bu = $1 AND account = $2 AND period = $3
         ORDER BY branch`,
        [bu, account, period]
      );
      return res.json({ type, rows });
    }

    if (type === "input_summary") {
      const view = req.query.view === "detail" ? "detail" : "summary";

      if (view === "detail") {
        // โชว์ครบ 16 Column ตรงกับ Format "Detail Sheet" ต้นฉบับเป๊ะ (ตามไฟล์อ้างอิงที่ยืนยันในแชท)
        // MARKER_VATRECONCILE_INPUTSUMMARY_DETAIL_RETURN_ID_V1 -- เพิ่ม id เข้ามา (เดิมไม่มี) เพื่อให้ Frontend
        // แก้ไข Field แล้ว PUT กลับ /vat_reconcile_input_summary/:id ได้ (Inline Edit แบบ Excel Grid ในหน้า Dashboard)
        let { rows } = await pool.query(
          `SELECT id, tax_type, branch, operator_name, receive_date, grt_no, tax_invoice_date, tax_invoice_no,
                  vendor_name, tax_id, ho, branch_field, item_detail,
                  paid_amount::float8 AS paid_amount,
                  paid_vat::float8 AS paid_vat,
                  claimed100_amount::float8 AS claimed100_amount,
                  claimed100_vat::float8 AS claimed100_vat,
                  calculate_tax::float8 AS calculate_tax,
                  CASE
                    WHEN tax_invoice_date IS NOT NULL AND to_char((CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END), 'YYYY-MM') > $3 THEN 'Over Period'
                    WHEN tax_invoice_date IS NOT NULL AND COALESCE(grt_no::text, '') !~* 'F' AND (substr($3::text,1,4)::int * 12 + substr($3::text,6,2)::int) - (EXTRACT(YEAR FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int * 12 + EXTRACT(MONTH FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int) > 6 THEN 'Expired' -- MARKER_VATRECONCILE_EXPIRED_V1 -- ใบกำกับเก่ากว่า 6 เดือนจาก Period = Expired (ปี พ.ศ. >= 2500 แปลงเป็น ค.ศ.)
                    WHEN receive_date IS NOT NULL AND tax_invoice_date IS NOT NULL AND receive_date < (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END) THEN 'Futuredate'
                    WHEN ABS(ROUND((COALESCE(paid_amount, 0) * 7 / 100 - COALESCE(claimed100_vat, 0))::numeric, 2)) > 0.05 THEN 'Unbalance'
                    ELSE 'Balance'
                  END AS status
           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
             AND ($4::text IS NULL OR branch::text = $4::text) -- MARKER_VATRECONCILE_INPUTSUMMARY_DETAIL_BRANCH_FILTER_V1
           ORDER BY branch, tax_invoice_date`,
          [bu, account, period, req.query.branch ? String(req.query.branch) : null]
        );
        // MARKER_VATRECONCILE_STATUS_COL_V1 -- Status ตามสูตร Excel (Futuredate: Receive Date < Tax Invoice Date · Balance: |ROUND(มูลค่า×7/100 − ภาษีใช้สิทธิ์,2)| ≤ 0.05) + Over Period
        // MARKER_VATRECONCILE_CLAIM_PERCENT_V1 -- ช่องใช้สิทธิ์ (มูลค่า/ภาษี) = ที่ชำระ x % ของสาขา (หรือ VAT % ของ Company); % = 100 คงค่าเดิมจากไฟล์
        let claimPercent = null; let claimMixed = false;
        try {
          // เฉพาะ Tax Type กลุ่ม Asset (T/F = Account 11610755) ตามกติกา Asset-Average เดิมในระบบ (buRate != 100); N/A (11610752) คงใช้สิทธิ์ตามไฟล์
          const lk = await reconClaimPercentLookup(bu, buRawForPct); // MARKER_VATRECONCILE_PCT_N_ROWS_V1 -- ใช้ตรวจว่าเป็นหัว % ไหม (ทุก Account) / คิด % เฉพาะ 11610755 เหมือนเดิม
          const applyPct = String(account) === "11610755";
          // MARKER_VATRECONCILE_PCT_N_ROWS_V1 -- BU หัว % ที่มี Input N (Tax Type N อยู่ Account 11610752): ดึงเข้ามาในหน้า Detail ของ 11610755 ให้เลย คิดใช้สิทธิ์ 100% + Highlight ให้ตรวจ
          // MARKER_VATRECONCILE_NO_CROSS_ACCOUNT_V1 -- ดึงเฉพาะ BU + Account + Branch + Period ของตัวเอง (752 กับ 755 คนละรายงาน ไม่ดึงข้าม Account)
          const set = new Set();
          for (const r of rows) {
            const pct = (applyPct || (String(account) === "11610752" && String(r.tax_type) === "A")) ? lk.pctOf(r.branch) : 100; // MARKER_VATRECONCILE_PCT_TAX_A_752_V1 -- Account 11610752: แถว Tax A คิดตาม % สาขา (หัว %) · Tax N คิด 100%
            if (String(r.tax_type) === "N" && lk.pctOf(r.branch) < 100) { // Input N ในหัว % = ใช้สิทธิ์ 100% + ติดธง is_n ให้ Frontend Highlight (คงไว้จนกว่าจะแก้ไข Tax Type)
              r.is_n = true;
              r.claimed100_amount = r.paid_amount;
              r.claimed100_vat = r.paid_vat;
              r.calculate_tax = 0;
              r.status = Math.abs(reconR2((Number(r.paid_amount) || 0) * 7 / 100) - (Number(r.paid_vat) || 0)) > 0.05 ? "Unbalance" : "Balance";
              continue; // N = ใช้สิทธิ์ 100% -> Calculate Tax = 0 ไม่มีส่วนต่าง และไม่นับเป็น % ของสาขา
            }
            set.add(pct);
            if (pct < 100) {
              r.claim_percent = pct;
              const pr = reconPctRow(r, pct); // MARKER_VATRECONCILE_PCT_ROW_ROUND_V1 -- ปัดทีละรายการ + Calculate Tax ตามไฟล์ CFW SEP-26
              r.claimed100_amount = pr.n;
              r.claimed100_vat = pr.o;
              r.calculate_tax = pr.p;
              if (r.status === "Balance" || r.status === "Unbalance") {
                r.status = Math.abs(reconR2((Number(r.paid_amount) || 0) * 7 / 100 * pct / 100) - r.claimed100_vat) > 0.05 ? "Unbalance" : "Balance";
              }
            }
          }
          const lows = [...set].filter((x) => x < 100);
          if (lows.length === 1 && set.size === 1) claimPercent = lows[0];
          else if (lows.length > 0) claimMixed = true;
        } catch (e) {
          console.warn("[vatReconcile] detail claim percent skipped:", e.message);
        }
        const nRowsAll = rows.filter((r) => r.is_n);
        return res.json({ type, view, period, rows, claim_percent: claimPercent, claim_percent_mixed: claimMixed, n_count: nRowsAll.length, n_total: Math.round(nRowsAll.reduce((a, r) => a + (Number(r.paid_vat) || 0), 0) * 100) / 100 });
      }

      const { rows } = await pool.query(
        `SELECT branch,
                SUM(claimed100_amount)::float8 AS claimed100_amount,
                SUM(claimed100_vat)::float8 AS claimed100_vat,
                COUNT(*)::int AS invoice_count
         FROM vat_reconcile_input_summary
         WHERE bu = $1 AND reconcile_account = $2 AND period = $3
         GROUP BY branch
         ORDER BY branch`,
        [bu, account, period]
      );
      return res.json({ type, view, rows });
    }

    if (type === "reconcile") {
      const TOLERANCE = 1.0; // ผลต่างไม่เกิน 1 บาท ถือว่า Matched (ปัดเศษทศนิยม)

      const tbResult = await pool.query(
        `SELECT branch, period_activity FROM vat_reconcile_tb
         WHERE bu = $1 AND account = $2 AND period = $3`,
        [bu, account, period]
      );
      const isResult = await pool.query(
        `SELECT branch, SUM(claimed100_vat) AS claimed100_vat FROM vat_reconcile_input_summary
         WHERE bu = $1 AND reconcile_account = $2 AND period = $3
         GROUP BY branch`,
        [bu, account, period]
      );
      const tbMap = new Map(tbResult.rows.map((r) => [r.branch, Number(r.period_activity)]));
      const isMap = new Map(isResult.rows.map((r) => [r.branch, Number(r.claimed100_vat)]));
      const branches = [...new Set([...tbMap.keys(), ...isMap.keys()])].sort();

      const rows = branches.map((branch) => {
        const hasTb = tbMap.has(branch);
        const hasInput = isMap.has(branch);
        const tbAmount = tbMap.get(branch) ?? 0;
        const inputAmount = isMap.get(branch) ?? 0;
        const difference = tbAmount - inputAmount;

        let status;
        if (!hasTb) status = "ไม่มี TB";
        else if (!hasInput) status = "ไม่มี Input Summary";
        else if (Math.abs(difference) <= TOLERANCE) status = "ตรงกัน";
        else status = "ไม่ตรงกัน";

        return {
          branch,
          tb_amount: tbAmount,
          input_summary_amount: inputAmount,
          difference,
          status,
        };
      });

      const summary = {
        total: rows.length,
        matched: rows.filter((r) => r.status === "ตรงกัน").length,
        mismatched: rows.filter((r) => r.status === "ไม่ตรงกัน").length,
        missing: rows.filter((r) => r.status === "ไม่มี TB" || r.status === "ไม่มี Input Summary").length,
      };

      return res.json({ type, rows, summary });
    }

    // DASHBOARD_SIMPLE_HEADER_AND_BRANCH_FILTER_PATCH_APPLIED
    if (type === "simple_100" || type === "simple_avg") {
      const simpleType = type === "simple_100" ? "100" : "AVG";
      const view = req.query.view === "detail" ? "detail" : "summary";
      const branchFilter = req.query.branch || null; // Optional -- กรอง Detail เฉพาะสาขาเดียว

      if (view === "detail") {
        // ครบทุก Column เหมือนไฟล์ Simple Report ต้นฉบับ (โชว์ใน Popup เต็มจอ)
        // MARKER_VATRECONCILE_SIMPLE_N_MERGE_V1 -- Account 11610755 (หัว %): ดู Simple ของ 11610752 (N) ร่วมด้วย (ดูอย่างเดียว ไม่นำไปรวมยอด) + คอลัมน์ Account บอกที่มา
        const simpleMerge = false; // MARKER_VATRECONCILE_NO_CROSS_ACCOUNT_V1
        const params = [bu, simpleMerge ? ["11610755", "11610752"] : [account], period, simpleType];
        const srcCol = simpleMerge ? ", h.reconcile_account AS src_account" : "";
        let branchClause = "";
        if (branchFilter) {
          params.push(branchFilter);
          branchClause = ` AND h.branch = $${params.length}`;
        }
        // DASHBOARD_SIMPLE_DETAIL_DROP_BRANCH_TAXTYPE_PATCH_APPLIED -- ตัด branch/tax_type_code ออก (ซ้ำซ้อนกับ Title Popup)
        const { rows } = await pool.query(
          `SELECT d.id,
                  d.running_no,
                  d.receive_date,
                  d.tax_invoice_date,
                  d.tax_invoice_no,
                  d.tax_id,
                  d.vendor_name,
                  d.branch_field,
                  d.item_detail,
                  d.paid_amount::float8 AS paid_amount,
                  d.paid_vat::float8 AS paid_vat,
                  d.claimed_amount::float8 AS claimed_amount,
                  d.claimed_vat::float8 AS claimed_vat,
                  d.claim_percent::float8 * 100 AS claim_percent${srcCol} -- SIMPLE_DETAIL_CLAIM_PERCENT_X100_PATCH_APPLIED (Ratio -> %)
           FROM vat_reconcile_simple_header h
           JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = ANY($2::text[]) AND h.period = $3 AND h.simple_type = $4${branchClause}
           ORDER BY h.branch, d.receive_date, d.running_no`,
          params
        );
        // MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_BACK_V5 -- หัวรายงาน + แถวแยกตามสาขา สำหรับวาด Layout ต้นฉบับ
        const gq = await pool.query(
          `SELECT h.branch, h.simple_type, to_jsonb(h)->>'bu_code' AS bu_code, h.report_title, h.report_id, h.print_date::text AS print_date, h.print_by, h.operator_name,
                  h.address_line1, h.address_line2, h.address_line3, h.company_tax_id, h.branch_no,
                  d.id, d.running_no, d.receive_date::text AS receive_date, d.tax_invoice_date::text AS tax_invoice_date,
                  d.tax_invoice_no, d.tax_id, d.vendor_name, d.branch_field, d.item_detail,
                  d.paid_amount::float8 AS paid_amount, d.paid_vat::float8 AS paid_vat,
                  d.claimed_amount::float8 AS claimed_amount, d.claimed_vat::float8 AS claimed_vat,
                  d.claim_percent::float8 * 100 AS claim_percent,
                  (to_jsonb(h)->>'sub_paid_amount')::float8 AS sub_paid_amount, (to_jsonb(h)->>'sub_paid_vat')::float8 AS sub_paid_vat, (to_jsonb(h)->>'sub_claimed_amount')::float8 AS sub_claimed_amount, (to_jsonb(h)->>'sub_claimed_vat')::float8 AS sub_claimed_vat,
                  h.reconcile_account AS src_account
           FROM vat_reconcile_simple_header h
           LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = ANY($2::text[]) AND h.period = $3 AND h.simple_type = $4${branchClause}
           ORDER BY h.branch, h.reconcile_account, d.receive_date, d.running_no`,
          params
        );
        const groups = [];
        const byBranch = new Map();
        for (const r of gq.rows) {
          let g = byBranch.get(r.branch + '|' + r.src_account);
          if (!g) {
            g = {
              branch: r.branch, src_account: r.src_account,
              header: {
                bu_code: r.bu_code, report_title: r.report_title, report_id: r.report_id, print_date: r.print_date, print_by: r.print_by,
                operator_name: r.operator_name, address_line1: r.address_line1, address_line2: r.address_line2,
                address_line3: r.address_line3, company_tax_id: r.company_tax_id, branch_no: r.branch_no,
                sub_paid_amount: r.sub_paid_amount, sub_paid_vat: r.sub_paid_vat, sub_claimed_amount: r.sub_claimed_amount, sub_claimed_vat: r.sub_claimed_vat,
              },
              rows: [],
            };
            byBranch.set(r.branch + '|' + r.src_account, g);
            groups.push(g);
          }
          if (r.running_no != null || r.receive_date != null) {
            g.rows.push({
              id: r.id, simple_type: r.simple_type, running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date, // MARKER_VATRECONCILE_SIMPLE_FLAT_BACK_V11
              tax_invoice_no: r.tax_invoice_no, tax_id: r.tax_id, vendor_name: r.vendor_name, branch_field: r.branch_field,
              item_detail: r.item_detail, paid_amount: r.paid_amount, paid_vat: r.paid_vat,
              claimed_amount: r.claimed_amount, claimed_vat: r.claimed_vat, claim_percent: r.claim_percent,
            });
          }
        }
        return res.json({ type, view, branch: branchFilter, rows, groups });
      }

      // DASHBOARD_SIMPLE_SUMMARY_FINAL_COLUMNS_PATCH_APPLIED -- Column สุดท้ายตามที่ยืนยันผ่าน Mockup แล้ว
      const { rows } = await pool.query(
        `SELECT h.branch,
                h.operator_name,
                h.company_tax_id,
                h.branch_no,
                COUNT(d.id)::int AS invoice_count,
                COALESCE(SUM(d.claimed_amount), 0)::float8 AS claimed_amount,
                COALESCE(SUM(d.claimed_vat), 0)::float8 AS claimed_vat,
                COALESCE(AVG(d.claim_percent), 0)::float8 * 100 AS claim_percent -- SIMPLE_CLAIM_PERCENT_X100_PATCH_APPLIED (Ratio -> %)
         FROM vat_reconcile_simple_header h
         LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
         WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3 AND h.simple_type = $4
         GROUP BY h.branch, h.operator_name, h.company_tax_id, h.branch_no
         ORDER BY h.branch`,
        [bu, account, period, simpleType]
      );
      return res.json({ type, view, rows });
    }

    return res.status(400).json({ error: `ยังไม่รองรับ Report ชนิด "${type}"` });
  } catch (err) {
    console.error("[vatReconcile] dashboard report error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึง Report", detail: err.message });
  }
});

// MARKER_VATRECONCILE_RECONCILE_REPORT_V1
/**
 * GET /vat-reconcile/dashboard/reconcile-report?bu=...&account=...&period=YYYY-MM
 * สร้างข้อมูล Popup Preview ให้ "เหมือน Reconcile จริงตาม Macro" (ชีต ReportVat_VGR / ReportVat_AVG + Cover)
 * ไม่มีการเขียน DB -- อ่านอย่างเดียว
 *
 * เลือก Template อัตโนมัติจากชนิด Simple ที่มีข้อมูลของ (BU, Account, Period):
 *   - มี Simple AVG  -> "avg"         (ReportVat_AVG: Input-N 100% | Input ใช้สิทธิ์ x% | Excel ใช้สิทธิ์ x% | รวม | เพิ่มเติม | รวมทั้งสิ้น)
 *   - มี Simple 100  -> "100_simple"  (ReportVat_VGR: Input-N 100% | Excel-N 100% | รวม | เพิ่มเติม | รวมทั้งสิ้น)
 *   - ไม่มี Simple   -> "100"         (ReportVat_VGR เหมือนบน แต่ Excel-N = 0)
 *
 * สูตรตามไฟล์ Macro จริง:
 *   100%: Input-N 100% = Σ paid (มูลค่า/ภาษี) | Excel-N 100% = Σ Simple 100 claimed | รวม = Input + Excel
 *         T/B = Σ ending(SubAcc 999999) - Σ ending(CPC 46119)   (บวก/ลบ CPC 46250 หักล้างกันเอง)
 *         Total = SUBTOTAL(9) ทุกสาขา | Check Diff = มี Unbalance ใน Detail (|paid_amount*7/100 - claimed100_vat| > 0.05) ไหม
 *   AVG : Input-N 100% ภาษี = Σ paid_amount ที่ paid_vat=0, มูลค่า = ภาษี*100/7
 *         Input ใช้สิทธิ์ x% = Σ claimed - Σ claimed ที่ calculate_tax=0 | Excel ใช้สิทธิ์ x% = Σ Simple AVG claimed
 *         รวม = Input-N100% + Input ใช้สิทธิ์ + Excel ใช้สิทธิ์ | T/B = Σ ending ต่อสาขา
 *   Cover: Per TB = Σ ending ทั้ง TB | Per Detail = รวมทั้งสิ้น(ภาษี) | Diff | (100% เท่านั้น) FinCredit 46250 = -Σ ending(CPC 46250)
 * "ภาษีซื้อที่ต้องยื่นเพิ่มเติม" ในไฟล์เป็นค่ากรอกมือ -> ส่ง 0 (ยังไม่มีข้อมูลในระบบ)
 */
const RECON_THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
function reconThaiPeriodLabel(period) {
  const m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return String(period || "");
  return `${RECON_THAI_MONTHS[Number(m[2]) - 1] || m[2]} ${Number(m[1]) + 543}`;
}
const reconR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// MARKER_VATRECONCILE_PCT_ROW_ROUND_V1 -- Template หัว %: ปัดเศษ "ทีละรายการ" แบบ Half-up ก่อนรวม (ตรงกับไฟล์ Reconcile จริง เช่น CFW SEP-26) | Calculate Tax = มูลค่าที่ชำระ − มูลค่าที่ใช้สิทธิ์
const reconRHalf = (x) => { const v = Number(x) || 0; return (v < 0 ? -1 : 1) * Math.round(Math.abs(v) * 100 + 1e-6) / 100; };
const reconPctRow = (d, pb) => {
  const L = Number(d.paid_amount) || 0;
  const n = reconRHalf(L * pb / 100);
  return { n, o: reconRHalf((Number(d.paid_vat) || 0) * pb / 100), p: reconRHalf(L - n) };
};
function reconPickKey(row, re, exclude) {
  return Object.keys(row || {}).find((k) => re.test(k) && !(exclude && exclude.test(k)));
}

// MARKER_VATRECONCILE_PREPARED_BY_BACK_V9
// หา "Prepare by" ของ BU จากตารางตั้งค่า (company_list ก่อน แล้ว vat_setting) -- คอลัมน์ใดก็ได้ที่ชื่อมี prepar / ผู้จัดทำ
const PREPARED_BY_TABLES = ["company_list", "vat_setting"];
const PREPARED_BY_RE = /prepar|ผู้จัดทำ|maker/i;
async function reconFindPreparedBy(buShort) {
  if (!buShort) return null;
  for (const t of PREPARED_BY_TABLES) {
    let row = null;
    for (const w of [`bu = $1 AND deleted IS NOT TRUE`, `bu = $1`]) {
      try {
        const q = await pool.query(`SELECT * FROM ${t} WHERE ${w} LIMIT 1`, [buShort]);
        row = q.rows[0] || null;
        break;
      } catch (e) { if (e.code !== "42703" && e.code !== "42P01") throw e; if (e.code === "42P01") break; }
    }
    if (!row) continue;
    const key = reconPickKey(row, PREPARED_BY_RE);
    if (key) return { table: t, key, value: row[key] == null ? "" : String(row[key]).trim(), softDel: Object.prototype.hasOwnProperty.call(row, "deleted") };
    console.warn(`[vatReconcile] ${t} (bu=${buShort}) ไม่มีคอลัมน์ Prepare by -- คอลัมน์ที่มี:`, Object.keys(row).join(", "));
  }
  return null;
}
router.put("/prepared-by", express.json(), async (req, res) => {
  try {
    let bu = String((req.body || {}).bu || "").trim();
    const value = String((req.body || {}).value ?? "").trim();
    if (!bu) return res.status(400).json({ error: "ต้องระบุ bu" });
    if (/^\d+$/.test(bu)) {
      const r = await pool.query(`SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`, [bu]);
      if (r.rows[0]?.bu) bu = r.rows[0].bu;
    }
    const src = await reconFindPreparedBy(bu);
    if (!src) return res.status(404).json({ error: "ไม่พบคอลัมน์ Prepare by ใน company_list / vat_setting ของ BU นี้" });
    const qk = src.key.replace(/"/g, '""');
    await pool.query(`UPDATE ${src.table} SET "${qk}" = $1 WHERE bu = $2${src.softDel ? " AND deleted IS NOT TRUE" : ""}`, [value || null, bu]);
    console.log(`[vatReconcile] prepared-by ${src.table}.${src.key} bu=${bu} by=${req.user?.email || "unknown"}`);
    res.json({ ok: true, value });
  } catch (err) {
    console.error("[vatReconcile] prepared-by error:", err);
    res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message });
  }
});

// MARKER_VATRECONCILE_AUTO_REBIND_V1 -- ระบบรู้เอง: ทุกครั้งที่เปิดรายงาน Reconcile ให้ผูกแถวที่เคยเก็บแบบ Fallback (tb_fallback / file_fallback) ใหม่กับ branch_list / Group Range จริงอัตโนมัติ
// (เช่น มีการเพิ่มสาขาใน Master Data > Branch ทีหลัง) -- ถูกต้องเสมอโดยไม่ต้องกดอะไร / ไม่ลบแถว / ล้มเหลวก็ไม่กระทบรายงาน
async function autoRebindFallbackRows(numericBu, period) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT branch FROM vat_reconcile_input_summary
        WHERE bu = $1 AND period = $2 AND branch_match_source IN ('tb_fallback','file_fallback')`,
      [numericBu, period]
    );
    for (const r of rows) {
      const hit = await resolveBranchToBu(r.branch);
      if (!hit || !hit.bu) continue;
      await pool.query(
        `UPDATE vat_reconcile_input_summary
            SET bu = $1, branch_match_source = $2, updated_at = now()
          WHERE branch = $3 AND period = $4 AND bu = $5 AND branch_match_source IN ('tb_fallback','file_fallback')`,
        [hit.bu, hit.source, r.branch, period, numericBu]
      );
    }
  } catch (e) {
    console.warn("[vatReconcile] auto rebind skipped:", e.message);
  }
}

const reconcileReportHandler = async (req, res) => {
  try {
    const { account, period } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
    }
    const buInput = String(bu);
    const numericBu = await resolveBuToNumeric(buInput);
    if (!numericBu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }
    bu = numericBu;
    await autoRebindFallbackRows(numericBu, period); // MARKER_VATRECONCILE_AUTO_REBIND_V1

    // Short Code ของ BU (ไว้ Join branch_list / company_list)
    let buShort = /^\d+$/.test(buInput) ? null : buInput;
    if (!buShort) {
      const sc = await pool.query(
        `SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`,
        [numericBu]
      );
      buShort = sc.rows[0]?.bu || null;
    }

    const [tbQ, inQ, simQ] = await Promise.all([
      pool.query(
        `SELECT branch, cpc, account, subacc, description, beginning_balance::float8 AS beginning_balance, period_activity::float8 AS period_activity, ending_balance::float8 AS ending_balance
         FROM vat_reconcile_tb WHERE bu = $1 AND account = $2 AND period = $3`,
        [bu, account, period]
      ),
      pool.query(
        `SELECT branch,
                COALESCE(SUM(paid_amount), 0)::float8 AS paid_amount,
                COALESCE(SUM(paid_vat), 0)::float8 AS paid_vat,
                COALESCE(SUM(claimed100_amount), 0)::float8 AS claimed_amount,
                COALESCE(SUM(claimed100_vat), 0)::float8 AS claimed_vat,
                COALESCE(SUM(paid_amount) FILTER (WHERE COALESCE(paid_vat, 0) = 0), 0)::float8 AS zero_vat_amount,
                COALESCE(SUM(claimed100_amount) FILTER (WHERE COALESCE(calculate_tax, 0) = 0), 0)::float8 AS claimed_amount_p0,
                COALESCE(SUM(claimed100_vat) FILTER (WHERE COALESCE(calculate_tax, 0) = 0), 0)::float8 AS claimed_vat_p0,
                COUNT(*) FILTER (
                  WHERE ABS(ROUND((COALESCE(paid_amount, 0) * 7 / 100 - COALESCE(claimed100_vat, 0))::numeric, 2)) > 0.05
                )::int AS unbalance_count,
                COUNT(*)::int AS invoice_count,
                COUNT(*) FILTER (WHERE tax_invoice_date IS NOT NULL AND to_char((CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END), 'YYYY-MM') > $3)::int AS over_count,
                COUNT(*) FILTER (WHERE tax_invoice_date IS NOT NULL AND to_char((CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END), 'YYYY-MM') <= $3 AND COALESCE(grt_no::text, '') !~* 'F' AND (substr($3::text,1,4)::int * 12 + substr($3::text,6,2)::int) - (EXTRACT(YEAR FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int * 12 + EXTRACT(MONTH FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int) > 6)::int AS expired_count, -- MARKER_VATRECONCILE_EXPIRED_V1
                JSONB_AGG(jsonb_build_object('id', id, 'pv', ABS(COALESCE(paid_vat, 0)), 'cv', ABS(COALESCE(claimed100_vat, 0)))) FILTER (WHERE receive_date IS NOT NULL AND tax_invoice_date IS NOT NULL AND receive_date < (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END) AND to_char((CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END), 'YYYY-MM') <= $3 AND NOT (COALESCE(grt_no::text, '') !~* 'F' AND (substr($3::text,1,4)::int * 12 + substr($3::text,6,2)::int) - (EXTRACT(YEAR FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int * 12 + EXTRACT(MONTH FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int) > 6)) AS future_rows, -- MARKER_VATRECONCILE_FUTURE_CAUSE_V2
                COUNT(*) FILTER (WHERE receive_date IS NOT NULL AND tax_invoice_date IS NOT NULL AND receive_date < (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END) AND to_char((CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END), 'YYYY-MM') <= $3 AND NOT (COALESCE(grt_no::text, '') !~* 'F' AND (substr($3::text,1,4)::int * 12 + substr($3::text,6,2)::int) - (EXTRACT(YEAR FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int * 12 + EXTRACT(MONTH FROM (CASE WHEN EXTRACT(YEAR FROM tax_invoice_date) >= 2500 THEN tax_invoice_date - INTERVAL '543 years' ELSE tax_invoice_date END))::int) > 6))::int AS future_count,
                MAX(operator_name) AS operator_name
         FROM vat_reconcile_input_summary
         WHERE bu = $1 AND reconcile_account = $2 AND period = $3
         GROUP BY branch`,
        [bu, account, period]
      ),
      pool.query(
        `SELECT h.branch, h.simple_type, MAX(h.operator_name) AS operator_name, MAX(h.company_tax_id) AS company_tax_id,
                MAX((to_jsonb(h)->>'sub_claimed_amount')::numeric)::float8 AS sub_claimed_amount, MAX((to_jsonb(h)->>'sub_claimed_vat')::numeric)::float8 AS sub_claimed_vat, -- MARKER_VATRECONCILE_SIMPLE_SUBTOTAL_COLS_V1
                COALESCE(SUM(d.claimed_amount), 0)::float8 AS claimed_amount,
                COALESCE(SUM(d.claimed_vat), 0)::float8 AS claimed_vat,
                COALESCE(AVG(NULLIF(d.claim_percent, 0)), 0)::float8 * 100 AS claim_percent
         FROM vat_reconcile_simple_header h
         LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
         WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3
         GROUP BY h.branch, h.simple_type`,
        [bu, account, period]
      ),
    ]);

    // ชื่อสาขา / ข้อมูลบริษัท -- ป้องกันชื่อคอลัมน์ไม่ตรง (ไม่ Crash ถ้าไม่เจอ)
    const branchNames = new Map();
    const branchInfo = new Map(); // MARKER_VATRECONCILE_BRANCH_STATUS_V1 -- สถานะสาขา
    let totalBranchCount = 0;
    if (buShort) {
      try {
        const bq = await pool.query(`SELECT * FROM branch_list WHERE bu = $1 AND deleted IS NOT TRUE`, [buShort]);
        totalBranchCount = bq.rows.length;
        if (bq.rows.length) {
          const codeKey = reconPickKey(bq.rows[0], /branch.*code/i) || "Branch Code";
          // MARKER_VATRECONCILE_BRANCH_NAME_COMPANYNAME_V2 -- ชื่อสาขา = คอลัมน์ "Company Name" ของ branch_list (Lookup ด้วย Branch Code)
          // เดิมจับ /name|desc/ ตัวแรกซึ่งอาจเป็นคอลัมน์อื่น ทำให้ชื่อซ้ำทุกแถว
          const nameKey = reconPickKey(bq.rows[0], /company.*show.*(report|display)/i) || reconPickKey(bq.rows[0], /^[\s_]*company[\s_]*name[\s_]*$/i) || reconPickKey(bq.rows[0], /name|desc/i, /code/i); // ชื่อสาขา: Company for Show in Report Display > Company Name > คอลัมน์แรกที่มีคำว่า name
          const stKey = reconPickKey(bq.rows[0], /^status$/i);
          const inKey = reconPickKey(bq.rows[0], /inactive/i);
          for (const r of bq.rows) {
            if (r[codeKey] != null) branchInfo.set(String(r[codeKey]).trim(), { status: stKey && r[stKey] ? String(r[stKey]).trim() : '', inactiveDate: inKey && r[inKey] ? String(r[inKey]).slice(0, 10) : '' });
            if (r[codeKey] != null && nameKey && r[nameKey]) branchNames.set(String(r[codeKey]).trim(), String(r[nameKey]).trim());
          }
        }
      } catch (e) {
        console.warn("[vatReconcile] reconcile-report branch_list lookup skipped:", e.message);
      }
    }
    let companyName = null;
    let companyTaxId = null;
    let companyNameEn = null; // MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1
    if (buShort) {
      try {
        const cq = await pool.query(`SELECT * FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE LIMIT 1`, [buShort]);
        const c = cq.rows[0];
        if (c) {
          // MARKER_VATRECONCILE_THAI_COMPANY_V1 -- ใช้ "THAI COMPANY NAME" ก่อน ถ้าว่าง/ไม่มีค่อย Fallback ชื่ออังกฤษ
          const thaiKey = reconPickKey(c, /thai.*company.*name/i);
          const nk = thaiKey && c[thaiKey] ? thaiKey : reconPickKey(c, /company.*name|^name$|บริษัท/i, /thai/i);
          const tk = reconPickKey(c, /tax.*id|taxid|เลขประจำตัว/i);
          if (nk && c[nk]) companyName = String(c[nk]).trim();
          if (tk && c[tk]) companyTaxId = String(c[tk]).trim();
          const enKey = reconPickKey(c, /company.*name|^name$/i, /thai|บริษัท/i);
          if (enKey && c[enKey]) companyNameEn = String(c[enKey]).trim();
        }
      } catch (e) {
        console.warn("[vatReconcile] reconcile-report company_list lookup skipped:", e.message);
      }
    }
    let preparedBySrc = null;
    try { preparedBySrc = await reconFindPreparedBy(buShort); } catch (e) { console.warn("[vatReconcile] prepared-by lookup skipped:", e.message); } // MARKER_VATRECONCILE_PREPARED_BY_BACK_V9
    for (const r of simQ.rows) {
      if (!companyTaxId && r.company_tax_id) companyTaxId = String(r.company_tax_id).replace(/-\d+$/, "").trim();
    }

    // แยกข้อมูลตามชนิด Simple
    const simple100 = new Map();
    const simpleAvg = new Map();
    let ratePercent = null;
    for (const r of simQ.rows) {
      if (String(r.simple_type) === "AVG") {
        simpleAvg.set(r.branch, r);
        if (!ratePercent && Number(r.claim_percent) > 0) ratePercent = reconR2(r.claim_percent);
      } else {
        simple100.set(r.branch, r);
      }
    }
    // MARKER_VATRECONCILE_SIMPLE_N_MERGE_V1 -- Simple ของ 11610752 (N) ใช้เปิดแท็บ Simple ให้ดูได้เท่านั้น ไม่เข้าสูตรยอด
    const nSimpleFlag = new Map();
    if (false) { // MARKER_VATRECONCILE_NO_CROSS_ACCOUNT_V1
      try {
        const nq = await pool.query(
          `SELECT h.branch, h.simple_type, COALESCE(SUM(ABS(d.claimed_amount)),0)+COALESCE(SUM(ABS(d.claimed_vat)),0) AS amt
           FROM vat_reconcile_simple_header h LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = '11610752' AND h.period = $2 GROUP BY h.branch, h.simple_type`,
          [bu, period]
        );
        for (const r of nq.rows) if (Number(r.amt) > 0.004) nSimpleFlag.set(`${r.branch}|${String(r.simple_type) === "AVG" ? "AVG" : "100"}`, true);
      } catch (e) { console.warn("[vatReconcile] N simple flag skipped:", e.message); }
    }
    // MARKER_VATRECONCILE_PCT_TEMPLATE_V1 -- Template ใหม่ "หัว %" (BU เฉลี่ย เช่น CFW): Account 11610755 (T/F) ที่มีสาขาใช้ % < 100 (ช่อง % ของสาขาใน branch_list หรือ VAT % ของ Company)
    // ไม่แตะ Logic เดิมของ 100 / 100_simple / avg: BU ที่ไม่เข้าเงื่อนไขนี้ได้ผลเหมือนเดิมทุกประการ
    const pctByBranch = new Map();
    let pctLookup = null;
    if (String(account) === "11610755" || String(account) === "11610752") { // MARKER_VATRECONCILE_PCT_752_REPORT_V1 -- Tax A (752) ใช้ Logic หัว % เหมือน T/F (755) ในรายงานของตัวเอง
      pctLookup = await reconClaimPercentLookup(numericBu, buInput);
      for (const r of inQ.rows) pctByBranch.set(r.branch, pctLookup.pctOf(r.branch));
    }
    const proratedMode = [...pctByBranch.values()].some((p) => p < 100);
    if (proratedMode && ratePercent == null) {
      const lows = [...new Set([...pctByBranch.values()].filter((p) => p < 100))];
      if (lows.length === 1) ratePercent = lows[0];
    }
    const template = proratedMode ? "pct" : simpleAvg.size > 0 ? "avg" : simple100.size > 0 ? "100_simple" : "100";
    const isAvgLayout = template === "avg" || template === "pct";
    // MARKER_VATRECONCILE_PCT_ROW_ROUND_V1 -- รวมยอดต่อสาขาจาก "รายการที่ปัดเศษแล้ว" (ตามสูตรไฟล์ Reconcile หัว %)
    const pctAgg = new Map();
    let pctNRows = []; // MARKER_VATRECONCILE_PCT_IP_DETAIL_V1 -- Input N (Tax Type N อยู่ Account อื่น) ของสาขาหัว % = N 100% ที่แท้จริง -> ชีต IP-DETAIL + ช่อง Input-N 100%
    if (template === "pct") {
      const rq = await pool.query(
        `SELECT branch, paid_amount::float8 AS paid_amount, paid_vat::float8 AS paid_vat, claimed100_amount::float8 AS claimed100_amount,
                claimed100_vat::float8 AS claimed100_vat, calculate_tax::float8 AS calculate_tax, tax_type
           FROM vat_reconcile_input_summary WHERE bu = $1 AND reconcile_account = $2 AND period = $3`,
        [bu, account, period]
      );
      for (const d of rq.rows) {
        const pb = pctByBranch.has(d.branch) ? pctByBranch.get(d.branch) : pctLookup.pctOf(d.branch);
        let n; let o; let p;
        const keepN = String(account) === "11610752" && String(d.tax_type) === "N"; // 752: Tax N = 100% (ค่าที่เก็บไว้) · Tax A = % สาขา
        if (pb < 100 && !keepN) { const pr = reconPctRow(d, pb); n = pr.n; o = pr.o; p = pr.p; }
        else { n = Number(d.claimed100_amount) || 0; o = Number(d.claimed100_vat) || 0; p = Number(d.calculate_tax) || 0; }
        const a = pctAgg.get(d.branch) || { zeroL: 0, sumN: 0, sumO: 0, p0N: 0, p0O: 0, c100N: 0, c100O: 0 };
        const L = Number(d.paid_amount) || 0; const M = Number(d.paid_vat) || 0;
        if (M === 0) a.zeroL += L;
        a.sumN += n; a.sumO += o;
        if (Math.abs(p) < 0.005) { a.p0N += n; a.p0O += o; if (M !== 0) { a.c100N += n; a.c100O += o; } } // รายการที่ใช้สิทธิ์ 100% (Calculate Tax = 0) -> Input-N 100%
        pctAgg.set(d.branch, a);
      }
      // MARKER_VATRECONCILE_NO_CROSS_ACCOUNT_V1 -- ไม่ดึง Input N ข้าม Account มารวม (pctNRows = ว่าง)
    }

    // TB ต่อสาขา
    const tbBy = new Map();
    let tbAll = 0;
    let tbFin46250 = 0;
    let accountName = null;
    for (const r of tbQ.rows) {
      const b = r.branch;
      if (!tbBy.has(b)) tbBy.set(b, { sub999: 0, cpc46119: 0, all: 0 });
      const t = tbBy.get(b);
      const v = Number(r.ending_balance) || 0;
      t.all += v;
      tbAll += v;
      if (String(r.subacc || "").trim() === "999999") t.sub999 += v;
      if (String(r.cpc || "").trim() === "46119") t.cpc46119 += v;
      if (String(r.cpc || "").trim() === "46250") tbFin46250 += v;
      if (!accountName && r.description) accountName = String(r.description).trim();
    }
    const inBy = new Map(inQ.rows.map((r) => [r.branch, r]));

    const branchSet = new Set([...tbBy.keys(), ...inBy.keys(), ...simple100.keys(), ...simpleAvg.keys(), ...pctAgg.keys()]);
    const branches = [...branchSet].sort();

    let pairLabels;
    if (isAvgLayout) {
      const pct = ratePercent != null ? `${ratePercent}%` : (template === "pct" ? "ตาม % สาขา" : "");
      pairLabels = [
        "ภาษีซื้อ Input-N 100%",
        `ภาษีซื้อ Input ใช้สิทธิ์ ${pct}`.trim(),
        `ภาษีซื้อ Excel ใช้สิทธิ์ ${pct}`.trim(),
        "รวมภาษีซื้อ",
        "ภาษีซื้อที่ต้องยื่นเพิ่มเติม",
        "รวมภาษีซื้อทั้งสิ้น",
      ];
    } else {
      pairLabels = ["ภาษีซื้อ Input-N 100%", "ภาษีซื้อ Excel-N 100%", "รวมภาษีซื้อ", "ภาษีซื้อที่ต้องยื่นเพิ่มเติม", "รวมภาษีซื้อทั้งสิ้น"];
    }
    const nPairs = pairLabels.length;
    const TOLERANCE = 1.0; // เหมือน type=reconcile เดิม

    const rows = branches.map((branch) => {
      const i = inBy.get(branch) || {};
      const tb = tbBy.get(branch) || { sub999: 0, cpc46119: 0, all: 0 };
      let pairs;
      let tbAmount;
      if (template === "pct") {
        // สูตรตามไฟล์ ReportVat_AVG ต้นแบบ: Input-N 100% = ยอดใช้สิทธิ์ที่ Calculate Tax = 0 (+ Simple 100) | Input ใช้สิทธิ์ x% = ยอดใช้สิทธิ์ที่ Calculate Tax != 0 | Excel ใช้สิทธิ์ x% = Simple AVG
        const s100 = simple100.get(branch) || {};
        const sa = simpleAvg.get(branch) || {};
        const ag = pctAgg.get(branch) || { zeroL: 0, sumN: 0, sumO: 0, p0N: 0, p0O: 0, c100N: 0, c100O: 0 };
        // สูตรตามไฟล์ CFW SEP-26: D = Σ มูลค่าชำระที่ภาษีชำระ=0 | C = ROUND(D×100/7) | E/F = Σ ใช้สิทธิ์ทั้งหมด − Σ ที่ Calculate Tax = 0 | (+ รายการ 100% และ Simple 100 ถ้ามี)
        const dz = reconR2(ag.zeroL);
        const c = reconR2(reconR2(dz * 100 / 7) + reconR2(ag.c100N) + (Number(s100.claimed_amount) || 0));
        const d = reconR2(dz + reconR2(ag.c100O) + (Number(s100.claimed_vat) || 0));
        const e = reconR2(reconR2(ag.sumN) - reconR2(ag.p0N));
        const f = reconR2(reconR2(ag.sumO) - reconR2(ag.p0O));
        // Simple AVG: ใช้ยอด "รวมสาขา" ที่พิมพ์มากับไฟล์ (ตรงกับสูตร Excel SUMIF รวมสาขา) ถ้ามี | ไฟล์ที่ Import ก่อนหน้านี้ไม่มี -> ใช้ผลรวมรายบรรทัดเหมือนเดิม
        const g = reconR2(sa.sub_claimed_amount != null ? sa.sub_claimed_amount : sa.claimed_amount);
        const h = reconR2(sa.sub_claimed_vat != null ? sa.sub_claimed_vat : sa.claimed_vat);
        const ii = reconR2(c + e + g);
        const j = reconR2(d + f + h);
        pairs = [[c, d], [e, f], [g, h], [ii, j], [0, 0], [reconR2(ii), reconR2(j)]];
        tbAmount = reconR2(tb.all);
      } else if (template === "avg") {
        const s = simpleAvg.get(branch) || {};
        const d = reconR2(i.zero_vat_amount);
        const c = reconR2((d * 100) / 7);
        const e = reconR2((i.claimed_amount || 0) - (i.claimed_amount_p0 || 0));
        const f = reconR2((i.claimed_vat || 0) - (i.claimed_vat_p0 || 0));
        const g = reconR2(s.claimed_amount);
        const h = reconR2(s.claimed_vat);
        const ii = reconR2(c + e + g);
        const j = reconR2(d + f + h);
        pairs = [[c, d], [e, f], [g, h], [ii, j], [0, 0], [reconR2(ii), reconR2(j)]];
        tbAmount = reconR2(tb.all);
      } else {
        const s = simple100.get(branch) || {};
        const inA = reconR2(i.paid_amount);
        const inV = reconR2(i.paid_vat);
        const exA = reconR2(s.claimed_amount);
        const exV = reconR2(s.claimed_vat);
        pairs = [[inA, inV], [exA, exV], [reconR2(inA + exA), reconR2(inV + exV)], [0, 0], [reconR2(inA + exA), reconR2(inV + exV)]];
        tbAmount = reconR2(tb.sub999 - tb.cpc46119);
      }
      const allVat = pairs[nPairs - 1][1];
      const diff = reconR2(allVat - tbAmount);
      // MARKER_VATRECONCILE_FUTURE_CAUSE_V1 -- Future Date (ในเดือนเดียวกับ Period) เป็น Issue เฉพาะเมื่อเป็นสาเหตุของ Diff: |Diff| ตรงกับ VAT ของใบ Future ใบใดใบหนึ่ง หรือผลรวมของใบ Future ทั้งหมดของสาขา (ถ้าไม่มี Diff / ไม่เกี่ยวกับ Diff = ไม่แจ้ง)
      const futureCauseIds = (() => {
        // V2: หา Future Date ชุดที่ "รวมกันแล้วเท่ากับ Diff" (ลองทั้ง VAT ที่ชำระ และ VAT ใช้สิทธิ์) -- เจอ = ไฮไลต์ + Notice, ไม่เจอ = คงสถานะ Futuredate เฉยๆ
        if (!(Number(i.future_count) > 0) || Math.abs(diff) <= TOLERANCE) return [];
        const items = Array.isArray(i.future_rows) ? i.future_rows : [];
        const target = Math.round(Math.abs(diff) * 100);
        for (const key of ["pv", "cv"]) {
          const arr = items.map((x) => ({ id: x.id, v: Math.round((Number(x[key]) || 0) * 100) })).filter((x) => x.v > 0);
          if (!arr.length) continue;
          let best = null;
          if (arr.length <= 20) {
            for (let mask = 1; mask < (1 << arr.length); mask++) {
              let sum = 0, cnt = 0;
              for (let b = 0; b < arr.length; b++) if (mask & (1 << b)) { sum += arr[b].v; cnt++; }
              if (Math.abs(sum - target) <= 6 && (!best || cnt < best.cnt)) best = { mask, cnt };
            }
            if (best) return arr.filter((_, b) => best.mask & (1 << b)).map((x) => x.id);
          } else {
            const tot = arr.reduce((t, x) => t + x.v, 0);
            if (Math.abs(tot - target) <= 6) return arr.map((x) => x.id);
            const one = arr.find((x) => Math.abs(x.v - target) <= 6);
            if (one) return [one.id];
          }
        }
        return [];
      })();
      const futureIsCause = futureCauseIds.length > 0;
      // MARKER_VATRECONCILE_BRANCH_NAME_NO_FALLBACK_V1 -- สาขาที่ไม่มีใน branch_list ห้ามเอาชื่อบริษัทจากหัวไฟล์ (operator_name) มาแทน -- ปล่อยว่าง (แถวแดง branchMissing เตือนอยู่แล้ว)
      const inBranchList = branchInfo.has(String(branch).trim());
      const name = branchNames.get(String(branch).trim()) || (inBranchList ? (i.operator_name || (simpleAvg.get(branch) || simple100.get(branch) || {}).operator_name || "") : "");
      const bInfo = branchInfo.get(String(branch).trim()) || {};
      return {
        branch,
        name,
        branchMissing: !branchInfo.has(String(branch).trim()), // MARKER_VATRECONCILE_BRANCH_MISSING_BLOCK_EXPORT_V3 -- ไม่พบสาขานี้ใน branch_list ของ BU
        hasSimpleAvg: Math.abs(Number((simpleAvg.get(branch) || {}).claimed_amount) || 0) + Math.abs(Number((simpleAvg.get(branch) || {}).claimed_vat) || 0) > 0.004 || nSimpleFlag.has(`${branch}|AVG`), // MARKER_VATRECONCILE_PCT_SIMPLE_TAB_V1 -- ให้หน้าเว็บรู้ว่าสาขานี้มี Simple AVG / Simple 100 ชุดไหน (Template หัว % ใช้ทั้งสองชุด)
        hasSimple100: Math.abs(Number((simple100.get(branch) || {}).claimed_amount) || 0) + Math.abs(Number((simple100.get(branch) || {}).claimed_vat) || 0) > 0.004 || nSimpleFlag.has(`${branch}|100`),
        branchStatus: bInfo.status || '',
        inactiveDate: bInfo.inactiveDate || '',
        futureCount: futureCauseIds.length, futureCountRaw: Number(i.future_count) || 0, futureCauseIds, // MARKER_VATRECONCILE_FUTURE_CAUSE_V1 -- Future Date นับเป็น Issue เฉพาะเมื่อเป็นสาเหตุของ Diff
        // MARKER_VATRECONCILE_FUTURE_DATE_V1 -- Future Date = Receive Date < Tax Invoice Date (ในเดือนเดียวกับ Period)
        expiredCount: Number(i.expired_count) || 0, // MARKER_VATRECONCILE_EXPIRED_V1
        overCount: Number(i.over_count) || 0, // Over Period = เดือนของ Tax Invoice Date เกินเดือน Period (เช่น Period 2026-09 แต่ใบกำกับ 2026-10)
        pairs,
        tb: tbAmount,
        diff,
        status: Math.abs(diff) <= TOLERANCE ? "ตรงกัน" : "ไม่ตรงกัน",
      };
    });

    const totalPairs = Array.from({ length: nPairs }, (_, k) => [
      reconR2(rows.reduce((s, r) => s + r.pairs[k][0], 0)),
      reconR2(rows.reduce((s, r) => s + r.pairs[k][1], 0)),
    ]);
    const totalTb = reconR2(rows.reduce((s, r) => s + r.tb, 0));
    const totalDiff = reconR2(totalPairs[nPairs - 1][1] - totalTb);

    const unbalanceCount = inQ.rows.reduce((s, r) => s + (Number(r.unbalance_count) || 0), 0);
    const perTb = reconR2(tbAll);
    const perDetail = totalPairs[nPairs - 1][1];
    const coverDiff = reconR2(perTb - perDetail);
    const finCredit = isAvgLayout ? null : reconR2(-tbFin46250);

    // MARKER_VATRECONCILE_EXPORT_SOURCES_V1 -- ข้อมูลต้นทางสำหรับ Export (Detail / TB / Simple) ส่งเฉพาะเมื่อขอ include=sources
    let sources = null;
    if (req.query.include === "sources") {
      const [detQ, simDetQ] = await Promise.all([
        pool.query(
          `SELECT branch, receive_date::text AS receive_date, grt_no, tax_invoice_date::text AS tax_invoice_date, tax_invoice_no,
                  vendor_name, tax_id, ho, branch_field, item_detail, operator_name, tax_type,
                  paid_amount::float8 AS paid_amount, paid_vat::float8 AS paid_vat,
                  claimed100_amount::float8 AS claimed100_amount, claimed100_vat::float8 AS claimed100_vat, calculate_tax::float8 AS calculate_tax
           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
           ORDER BY branch, receive_date, tax_invoice_no`,
          [bu, account, period]
        ),
        pool.query(
          `SELECT h.branch, h.simple_type, to_jsonb(h)->>'bu_code' AS bu_code, h.report_title, h.report_id, h.print_date::text AS print_date, h.print_by, h.operator_name,
                  h.address_line1, h.address_line2, h.address_line3, h.company_tax_id, h.branch_no, -- MARKER_VATRECONCILE_SIMPLE_REPORT_FORMAT_BACK_V21
                  d.receive_date::text AS receive_date, d.running_no, d.tax_invoice_date::text AS tax_invoice_date,
                  d.tax_invoice_no, d.vendor_name, d.tax_id, d.branch_field, d.item_detail,
                  d.paid_amount::float8 AS paid_amount, d.paid_vat::float8 AS paid_vat,
                  d.claimed_amount::float8 AS claimed_amount, d.claimed_vat::float8 AS claimed_vat, d.claim_percent::float8 AS claim_percent,
                  (to_jsonb(h)->>'sub_paid_amount')::float8 AS sub_paid_amount, (to_jsonb(h)->>'sub_paid_vat')::float8 AS sub_paid_vat,
                  (to_jsonb(h)->>'sub_claimed_amount')::float8 AS sub_claimed_amount, (to_jsonb(h)->>'sub_claimed_vat')::float8 AS sub_claimed_vat -- MARKER_VATRECONCILE_SIMPLE_SUBTOTAL_COLS_V1
           FROM vat_reconcile_simple_header h
           JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3
           ORDER BY h.branch, d.id`,
          [bu, account, period]
        ),
      ]);
      // MARKER_VATRECONCILE_PCT_EXPORT_SOURCES_V1 -- Template หัว %: Detail ของสาขาที่ใช้สิทธิ์ < 100% ต้องเป็นยอดใช้สิทธิ์ตาม % (paid × %) และ Calculate Tax = paid VAT − ใช้สิทธิ์ (เหมือนหน้า Detail)
      if (template === "pct") {
        for (const d of detQ.rows) {
          const pb = pctByBranch.has(d.branch) ? pctByBranch.get(d.branch) : pctLookup.pctOf(d.branch);
          if (pb < 100 && !(String(account) === "11610752" && String(d.tax_type) === "N")) {
            const pr = reconPctRow(d, pb);
            d.claimed100_amount = pr.n; d.claimed100_vat = pr.o; d.calculate_tax = pr.p;
          }
        }
      }
      sources = { detail: detQ.rows, tb: tbQ.rows, simple: simDetQ.rows, ip: pctNRows };
    }

    return res.json({
      template,
      sheet: isAvgLayout ? "ReportVat_AVG" : "ReportVat_VGR",
      account,
      accountName: accountName || "",
      tbLabel: `${account.slice(0, 3)}-${account.slice(3, 5)}-${account.slice(5)}`,
      ratePercent,
      header: {
        title: "รายงานสรุปภาษีซื้อ Non Merchandise",
        company: companyName || buShort || String(numericBu),
        taxId: companyTaxId || "",
        companyEn: companyNameEn || "",
        preparedBy: preparedBySrc ? preparedBySrc.value : "",
        preparedByEditable: !!preparedBySrc,
        periodLabel: reconThaiPeriodLabel(period),
      },
      pairLabels,
      rows,
      totals: { pairs: totalPairs, tb: totalTb, diff: totalDiff },
      cover: {
        perTb,
        perDetail,
        diff: coverDiff,
        finCredit,
        coverDiff: reconR2(coverDiff + (finCredit || 0)),
      },
      checkDiff: isAvgLayout
        ? { applicable: false }
        : { applicable: true, unbalance: unbalanceCount, text: unbalanceCount > 0 ? "Found Diff in Detail" : "Approve Balance" },
      futureCount: rows.reduce((s, r) => s + (r.futureCount || 0), 0), // MARKER_VATRECONCILE_FUTURE_DATE_V1
      overCount: rows.reduce((s, r) => s + (r.overCount || 0), 0),
      branchCount: { withData: rows.length, total: totalBranchCount || rows.length },
      buCode: { numeric: String(numericBu), short: buShort || null }, // MARKER_VATRECONCILE_EXPORT_FILENAME_V1
      ...(sources ? { sources } : {}),
    });
  } catch (err) {
    console.error("[vatReconcile] reconcile-report error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างสร้าง Reconcile Report", detail: err.message });
  }
};
router.get("/dashboard/reconcile-report", reconcileReportHandler);
router.use(createReportFilesRouter({ reconcileReportHandler })); // MARKER_VATRECONCILE_REPORT_FILES_V1
router.use("/result-folders", createVatResultFoldersRouter()); // MARKER_VATRECONCILE_MOUNT_RESULT_FOLDERS_V1

router.get("/dashboard/status", async (req, res) => {
  try {
    const period = req.query.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "ต้องระบุ period รูปแบบ YYYY-MM เช่น ?period=2026-08" });
    }

    const { rows: companies } = await pool.query(
      `SELECT bu, "COMPANY CODE" AS company_code, allowed_tax_type
       FROM company_list
       WHERE deleted IS NOT TRUE
         AND vat_watchlist_status = 'active'
         AND allowed_tax_type IS NOT NULL
         AND allowed_tax_type != ''`
    );

    // แปลง Short Code -> เลข BU + แตกเป็น Row ต่อ (BU, กลุ่มภาษี)
    const rowsToCheck = [];
    for (const c of companies) {
      const segments = (c.company_code || "").split("-");
      const numericBu = segments[2];
      if (!numericBu) continue; // Format ไม่ตรง -> ข้าม (ไม่ Crash)

      const groups = parseAllowedTaxTypeGroups(c.allowed_tax_type);
      for (const group of groups) {
        rowsToCheck.push({
          label: c.bu, // Short Code เช่น "BTM", "CRG" ใช้แสดงผล
          numericBu,
          group, // 'Asset' | 'Expense'
          account: accountOfGroup(group) || (group === "Asset" ? ASSET_ACCOUNT : EXPENSE_ACCOUNT),
        });
      }
    }

    if (rowsToCheck.length === 0) {
      return res.json({ period, rows: [] });
    }

    // Query สถานะ TB แบบ Batch เดียว (bu, account) พร้อมเวลา Upload ล่าสุด
    const tbPairs = await pool.query(
      `SELECT bu, account, MAX(updated_at) AS last_updated FROM vat_reconcile_tb
       WHERE period = $1 AND (bu, account) IN (${rowsToCheck
         .map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`)
         .join(", ")})
       GROUP BY bu, account`,
      [period, ...rowsToCheck.flatMap((r) => [r.numericBu, r.account])]
    );
    const tbMap = new Map(tbPairs.rows.map((r) => [`${r.bu}|${r.account}`, r.last_updated]));

    // Query สถานะ Input Summary แบบ Batch เดียว พร้อมเวลา Upload ล่าสุด
    const isPairs = await pool.query(
      `SELECT bu, reconcile_account, MAX(updated_at) AS last_updated FROM vat_reconcile_input_summary
       WHERE period = $1 AND (bu, reconcile_account) IN (${rowsToCheck
         .map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`)
         .join(", ")})
       GROUP BY bu, reconcile_account`,
      [period, ...rowsToCheck.flatMap((r) => [r.numericBu, r.account])]
    );
    const isMap = new Map(isPairs.rows.map((r) => [`${r.bu}|${r.reconcile_account}`, r.last_updated]));

    // DASHBOARD_SIMPLE_STATUS_PATCH_APPLIED
    // Query สถานะ Simple 100 / Simple AVG แบบ Batch เดียว จาก vat_reconcile_simple_header จริง
    const simple100Pairs = await pool.query(
      `SELECT bu, reconcile_account, MAX(updated_at) AS last_updated FROM vat_reconcile_simple_header
       WHERE period = $1 AND simple_type = '100' AND (bu, reconcile_account) IN (${rowsToCheck
         .map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`)
         .join(", ")})
       GROUP BY bu, reconcile_account`,
      [period, ...rowsToCheck.flatMap((r) => [r.numericBu, r.account])]
    );
    const simple100Map = new Map(simple100Pairs.rows.map((r) => [`${r.bu}|${r.reconcile_account}`, r.last_updated]));

    const simpleAvgPairs = await pool.query(
      `SELECT bu, reconcile_account, MAX(updated_at) AS last_updated FROM vat_reconcile_simple_header
       WHERE period = $1 AND simple_type = 'AVG' AND (bu, reconcile_account) IN (${rowsToCheck
         .map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`)
         .join(", ")})
       GROUP BY bu, reconcile_account`,
      [period, ...rowsToCheck.flatMap((r) => [r.numericBu, r.account])]
    );
    const simpleAvgMap = new Map(simpleAvgPairs.rows.map((r) => [`${r.bu}|${r.reconcile_account}`, r.last_updated]));

    // MARKER_VATRECONCILE_STATUS_TAX_TYPES_V1 -- Tax Type ที่มีข้อมูลจริงต่อ (BU, Account) จาก Input Summary + Simple
    const ttPairs = await pool.query(
      `SELECT bu, acc, array_agg(DISTINCT tt) AS tts FROM (
         SELECT bu, reconcile_account AS acc, upper(btrim(tax_type)) AS tt FROM vat_reconcile_input_summary WHERE period = $1
         UNION ALL
         SELECT bu, reconcile_account AS acc, upper(btrim(tax_type_code)) AS tt FROM vat_reconcile_simple_header WHERE period = $1
       ) x WHERE tt IS NOT NULL AND tt <> '' GROUP BY bu, acc`,
      [period]
    );
    const ttMap = new Map(ttPairs.rows.map((r) => [`${r.bu}|${r.acc}`, r.tts]));

    const result = rowsToCheck.map((r) => {
      const key = `${r.numericBu}|${r.account}`;
      const tbLastUpdated = tbMap.get(key) || null;
      const isLastUpdated = isMap.get(key) || null;
      const simple100LastUpdated = simple100Map.get(key) || null;
      const simpleAvgLastUpdated = simpleAvgMap.get(key) || null;
      const tbActive = tbLastUpdated !== null;
      const inputSummaryActive = isLastUpdated !== null;
      const simple100Active = simple100LastUpdated !== null;
      const simpleAvgActive = simpleAvgLastUpdated !== null;

      // เวลา Upload ล่าสุดของแถวนี้ = ล่าสุดสุดในบรรดา TB / Input Summary / Simple 100 / Simple AVG (ใช้ Sort)
      const candidates = [tbLastUpdated, isLastUpdated, simple100LastUpdated, simpleAvgLastUpdated].filter(Boolean);
      const lastUploadedAt = candidates.length ? new Date(Math.max(...candidates.map((d) => new Date(d)))) : null;

      return {
        label: r.label,
        bu: r.numericBu,
        group: r.group,
        account: r.account,
        tb_active: tbActive,
        input_summary_active: inputSummaryActive,
        simple_100_active: simple100Active,
        simple_avg_active: simpleAvgActive,
        tax_types: (ttMap.get(key) || []).sort(),
        ready: tbActive && (inputSummaryActive || simple100Active || simpleAvgActive),
        last_uploaded_at: lastUploadedAt ? lastUploadedAt.toISOString() : null,
      };
    });

    // เรียงจาก Upload ล่าสุดขึ้นก่อน (ไม่มีข้อมูลเลย -> ไปอยู่ท้ายสุด เรียงตามชื่อ BU)
    result.sort((a, b) => {
      if (a.last_uploaded_at && b.last_uploaded_at) {
        return new Date(b.last_uploaded_at) - new Date(a.last_uploaded_at);
      }
      if (a.last_uploaded_at) return -1;
      if (b.last_uploaded_at) return 1;
      return a.label.localeCompare(b.label) || a.group.localeCompare(b.group);
    });

    res.json({ period, rows: result });
  } catch (err) {
    console.error("[vatReconcile] dashboard status error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึงสถานะ Dashboard", detail: err.message });
  }
});

// ===========================================================================
// ส่วนที่ 4: Simple Report (Simple Report Vat 100% / Average) — .xlsx
// ===========================================================================
// อ่าน .xlsx ด้วย ExcelJS (Package มีอยู่แล้วในระบบ) โครงสร้างไฟล์ยืนยันจาก
// ไฟล์ตัวอย่างจริงแล้ว: Header (Row 1-11) + Column Header (Row 13-14)
// + Data (Row 15+) แบ่งหลายสาขาด้วย Marker "รวมสาขา XXXXXX" จบไฟล์ด้วย "รวมสุทธิ"
//
// Tax Type Code (N/A/F/T) เช็ค 2 ทาง: ตัวอักษรท้ายชื่อไฟล์ + วันที่ Column
// "รับสินค้า" (1-15=T, 16+=A) -- ยืนยันด้วยไฟล์ตัวอย่างจริงแล้วว่าตรงกันสำหรับ AVG
// ===========================================================================

// SIMPLE_FILENAME_FLEXIBLE_SEP_PATCH_APPLIED — รองรับทั้ง Space และ Underscore คั่นคำในชื่อไฟล์
const SIMPLE_FILENAME_PATTERN = /Simple[ _]+Report[ _]+Vat[ _]+(100|AVG)[ _]+([NAFT])/i;
const SIMPLE_TAX_TYPE_TO_ACCOUNT = {
  N: ["Expense", "11610752"],
  A: ["Expense", "11610752"],
  F: ["Asset", "11610755"],
  T: ["Asset", "11610755"],
};

function simpleParseFilename(filename) {
  const m = SIMPLE_FILENAME_PATTERN.exec(filename);
  if (!m) return { simpleType: null, taxTypeCode: null };
  return { simpleType: m[1].toUpperCase(), taxTypeCode: m[2].toUpperCase() };
}

// SIMPLE_TAXTYPE_GROUP_FROM_DATE_V2_PATCH_APPLIED
// วันที่บอกได้แค่ "กลุ่ม" เท่านั้น: 1-15 = Asset (T/F), 16-31 = Expense (N/A)
// ไม่สามารถแยกตัวอักษรแน่นอนในกลุ่มได้จากวันที่ (ยืนยัน Business Rule กับ LeKarn แล้ว)
function simpleDeriveTaxGroupFromDates(dates) {
  if (!dates.length) return null;
  let firstHalfCount = 0;
  let secondHalfCount = 0;
  for (const d of dates) {
    const day = d.getDate();
    if (day >= 1 && day <= 15) firstHalfCount++;
    else secondHalfCount++;
  }
  return firstHalfCount >= secondHalfCount ? "Asset" : "Expense";
}

// SIMPLE_CLEANTEXT_OBJECT_FIX_PATCH_APPLIED
// ExcelJS คืนค่า Cell ที่เป็นสูตรหรือ Rich Text เป็น Object ไม่ใช่ String ตรงๆ
// ต้องดึงค่าจริงออกมาก่อน ไม่งั้น String(object) จะได้ "[object Object]" ฝังลง DB
function simpleCleanText(v) {
  if (v === null || v === undefined) return null;
  let value = v;
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      value = value.richText.map((r) => r.text).join("");
    } else if (value.result !== undefined) {
      value = value.result;
    } else if (value.text !== undefined) {
      value = value.text;
    }
  }
  const s = String(value).replace(/[\u202d\u202c]/g, "").trim();
  return s === "" ? null : s;
}

function simpleCellText(row, col) {
  return simpleCleanText(row.getCell(col).value);
}

function simpleCellDate(row, col) {
  const v = row.getCell(col).value;
  if (!v) return null;
  if (v instanceof Date) return v;
  return null;
}

function simpleCellNumber(row, col) {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return 0;
  const n = typeof v === "object" && v.result !== undefined ? v.result : v;
  return Number(n) || 0;
}

/**
 * Parse Buffer ของไฟล์ Simple Report (.xlsx) -> { headerCommon, branches: [{branch, rows}] }
 */
async function parseSimpleReportBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.worksheets[0];

  const headerCommon = {
    reportTitle: simpleCellText(ws.getRow(1), 2),
    bu: simpleCellText(ws.getRow(3), 4),
    reportId: simpleCellText(ws.getRow(4), 4),
    printDate: simpleCellText(ws.getRow(5), 4),
    printBy: simpleCellText(ws.getRow(6), 4),
    operatorName: simpleCellText(ws.getRow(8), 6),
    companyTaxId: (simpleCellText(ws.getRow(8), 15) || "").replace(/^:\s*/, "") || null,
    addressLine1: simpleCellText(ws.getRow(9), 6),
    primaryBranch: (simpleCellText(ws.getRow(9), 15) || "").replace(/^:\s*/, "") || null,
    addressLine2: simpleCellText(ws.getRow(10), 6),
    branchNo: (simpleCellText(ws.getRow(10), 15) || "").replace(/^:\s*/, "") || null,
    addressLine3: simpleCellText(ws.getRow(11), 6),
  };

  const branches = [];
  let currentRows = [];
  // MARKER_VATRECONCILE_SIMPLE_BLOCK_HEADER_BACK_V21 -- ไฟล์ Simple Report มี "หัวบริษัท" ซ้ำทุกสาขา (ชื่อผู้ประกอบการ/ที่อยู่/เลขผู้เสียภาษี-สาขา/รหัสสาขา/สาขาที่) -- เก็บแยกต่อสาขา
  const stripColon = (v) => (v == null ? null : String(v).replace(/^:\s*/, "") || null);
  const readBlockHdr = (r0) => ({
    operatorName: simpleCellText(ws.getRow(r0), 6),
    companyTaxId: stripColon(simpleCellText(ws.getRow(r0), 15)),
    addressLine1: simpleCellText(ws.getRow(r0 + 1), 6),
    primaryBranch: stripColon(simpleCellText(ws.getRow(r0 + 1), 15)),
    addressLine2: simpleCellText(ws.getRow(r0 + 2), 6),
    branchNo: stripColon(simpleCellText(ws.getRow(r0 + 2), 15)),
    addressLine3: simpleCellText(ws.getRow(r0 + 3), 6),
  });
  let curHdr = { operatorName: headerCommon.operatorName, companyTaxId: headerCommon.companyTaxId, addressLine1: headerCommon.addressLine1, primaryBranch: headerCommon.primaryBranch, addressLine2: headerCommon.addressLine2, branchNo: headerCommon.branchNo, addressLine3: headerCommon.addressLine3 };

  for (let r = 15; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const qVal = simpleCellText(row, 17);

    if (simpleCellText(row, 13) === "เลขประจำตัวผู้เสียภาษี") { curHdr = readBlockHdr(r); continue; } // V21: หัวบริษัทของสาขาถัดไป

    if (qVal && qVal.startsWith("รวมสุทธิ")) break; // จบไฟล์

    if (qVal && qVal.startsWith("รวมสาขา")) {
      // SIMPLE_BRANCHCODE_ALNUM_PATCH_APPLIED — รองรับ Branch Code ที่มีตัวอักษรปน เช่น "0402W2" (เดิมใช้ \d+ ตัดเหลือ "0402")
      const m = /รวมสาขา\s*(\S+)/.exec(qVal);
      const branchCode = m ? m[1] : headerCommon.primaryBranch;
      branches.push({ branch: branchCode, rows: currentRows, hdr: curHdr, sub: { paid_amount: simpleCellNumber(row, 21), paid_vat: simpleCellNumber(row, 22), claimed_amount: simpleCellNumber(row, 23), claimed_vat: simpleCellNumber(row, 25) } }); // MARKER_VATRECONCILE_SIMPLE_SUBTOTAL_COLS_V1
      currentRows = [];
      continue;
    }

    const receiveDate = simpleCellDate(row, 2);
    if (!receiveDate) continue; // แถวว่าง/ไม่ใช่ Data

    currentRows.push({
      receive_date: receiveDate,
      running_no: simpleCellText(row, 3),
      tax_invoice_date: simpleCellDate(row, 5),
      tax_invoice_no: simpleCellText(row, 8),
      vendor_name: simpleCellText(row, 10),
      tax_id: simpleCellText(row, 14),
      branch_field: simpleCellText(row, 16),
      item_detail: simpleCellText(row, 17),
      paid_amount: simpleCellNumber(row, 21),
      paid_vat: simpleCellNumber(row, 22),
      claimed_amount: simpleCellNumber(row, 23),
      claimed_vat: simpleCellNumber(row, 25),
      claim_percent: simpleCellNumber(row, 27),
    });
  }

  if (currentRows.length) {
    branches.push({ branch: headerCommon.primaryBranch, rows: currentRows, hdr: curHdr });
  }

  return { headerCommon, branches };
}

// SIMPLE_PERIOD_FROM_DATES_PATCH_APPLIED
// Period ของไฟล์ Simple Report ดูจากคอลัมน์ "วัน/เดือน/ปี" (รับสินค้า) ของทุกแถวทุกสาขา
// เอาค่า YYYY-MM ที่พบบ่อยที่สุด (Mode) เป็น Period ของทั้งไฟล์
function simpleComputePeriodFromBranches(branches) {
  const counts = new Map();
  for (const b of branches) {
    for (const r of b.rows) {
      const d = r.receive_date;
      if (!(d instanceof Date)) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let bestKey = null;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && (bestKey === null || key < bestKey))) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

/**
 * MARKER_VATRECONCILE_SIMPLE_BU_BY_BRANCH_V2
 * หา BU (เลข) ของไฟล์ Simple Report: เทียบ "รหัสสาขา" ในไฟล์กับ branch_list ตรงๆ ก่อน (เฉพาะที่ตรงใน branch_list จริง)
 * ไม่เจอค่อยใช้ "Bu Code" ในหัวไฟล์ (resolveBuToNumeric) -- คืน null ถ้าทั้งสองทางหาไม่เจอ
 */
async function resolveSimpleBu(headerCommon, branches) {
  const cands = [headerCommon.primaryBranch, ...(branches || []).map((b) => b.branch)]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const br of [...new Set(cands)]) {
    const direct = await pool.query(
      `SELECT cl."COMPANY CODE" AS company_code
       FROM branch_list bl
       JOIN company_list cl ON cl.bu = bl.bu
       WHERE bl."Branch Code" = $1 AND bl.deleted IS NOT TRUE
       LIMIT 1`,
      [br]
    );
    const numericBu = (direct.rows[0]?.company_code || "").split("-")[2];
    if (numericBu) return numericBu;
  }
  return resolveBuToNumeric(headerCommon.bu);
}

/**
 * POST /vat-reconcile/simple/preview
 * รับไฟล์ Simple Report (.xlsx) -> Parse + คำนวณ Tax Type -> คืน Summary (ไม่เขียน DB)
 */
router.post("/simple/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const filename = req.file.originalname || "";
    const { simpleType, taxTypeCode: taxTypeFromName } = simpleParseFilename(filename);
    if (!simpleType) {
      return res.status(422).json({
        error: "ชื่อไฟล์ไม่ตรง Pattern ที่รองรับ (ต้องมี Simple_Report_Vat_100 หรือ Simple_Report_Vat_AVG ในชื่อไฟล์)",
      });
    }

    const { headerCommon, branches } = await parseSimpleReportBuffer(req.file.buffer);
    const numericBu = await resolveSimpleBu(headerCommon, branches); // MARKER_VATRECONCILE_SIMPLE_BU_BY_BRANCH_V2

    const branchSummaries = branches.map((b) => {
      const dates = b.rows.map((r) => r.receive_date).filter(Boolean);
      const taxGroupFromDate = simpleDeriveTaxGroupFromDates(dates);
      const finalTaxType = taxTypeFromName;
      const [group, account] = SIMPLE_TAX_TYPE_TO_ACCOUNT[finalTaxType] || [null, null];
      // เทียบระดับ "กลุ่ม" เท่านั้น (Asset/Expense) -- วันที่แยกตัวอักษรแน่นอนในกลุ่มไม่ได้
      const taxTypeDateMismatch = Boolean(taxGroupFromDate && group && taxGroupFromDate !== group);
      const totalClaimedAmount = b.rows.reduce((s, r) => s + r.claimed_amount, 0);
      const totalClaimedVat = b.rows.reduce((s, r) => s + r.claimed_vat, 0);
      return {
        branch: b.branch,
        row_count: b.rows.length,
        tax_type_from_name: taxTypeFromName,
        tax_type_group_from_date: taxGroupFromDate,
        tax_type_date_mismatch: taxTypeDateMismatch,
        tax_type_final: finalTaxType,
        tax_type_group: group,
        reconcile_account: account,
        total_claimed_amount: totalClaimedAmount,
        total_claimed_vat: totalClaimedVat,
      };
    });

    const period = simpleComputePeriodFromBranches(branches);

    res.json({
      simple_type: simpleType,
      bu: headerCommon.bu,
      bu_numeric: numericBu,
      period,
      header: headerCommon,
      branches: branchSummaries,
      raw_branches: branches, // เก็บ Rows เต็มไว้ส่งกลับตอน Commit (กันต้อง Parse ไฟล์ซ้ำ)
    });
  } catch (err) {
    console.error("[vatReconcile] simple preview error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างประมวลผลไฟล์", detail: err.message });
  }
});

/**
 * POST /vat-reconcile/simple/commit
 * Parse ไฟล์ซ้ำ (เหมือน Preview) แล้วเขียนลง DB จริง — Replace ทั้งก้อนต่อ (bu, branch, period, reconcile_account, simple_type)
 * ลบ Header เดิม (Detail จะลบตามด้วย ON DELETE CASCADE) แล้ว Insert Header+Detail ชุดใหม่
 */
router.post("/simple/commit", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const filename = req.file.originalname || "";
    const { simpleType, taxTypeCode: taxTypeFromName } = simpleParseFilename(filename);
    if (!simpleType) {
      return res.status(422).json({
        error: "ชื่อไฟล์ไม่ตรง Pattern ที่รองรับ (ต้องมี Simple_Report_Vat_100 หรือ Simple_Report_Vat_AVG ในชื่อไฟล์)",
      });
    }
    const { headerCommon, branches } = await parseSimpleReportBuffer(req.file.buffer);
    const numericBu = await resolveSimpleBu(headerCommon, branches); // MARKER_VATRECONCILE_SIMPLE_BU_BY_BRANCH_V2
    if (!numericBu) {
      return res.status(422).json({ error: `ไม่พบ BU "${headerCommon.bu}" / สาขา "${headerCommon.primaryBranch || ''}" ในระบบ (แปลงเป็นเลข BU ไม่ได้)` });
    }

    // SIMPLE_PERIOD_FROM_DATES_PATCH_APPLIED -- คำนวณ Period จากคอลัมน์วันที่ในไฟล์เอง (Logic เดียวกับ Preview)
    const period = simpleComputePeriodFromBranches(branches);
    if (!period) {
      return res.status(422).json({ error: "ไม่สามารถระบุ Period จากไฟล์ได้ (ไม่พบวันที่รับสินค้าที่ถูกต้องในไฟล์)" });
    }

    const updatedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";

    await client.query("BEGIN");

    let deletedHeaders = 0;
    let insertedHeaders = 0;
    let insertedDetails = 0;

    for (const b of branches) {
      const finalTaxType = taxTypeFromName;
      const [group, account] = SIMPLE_TAX_TYPE_TO_ACCOUNT[finalTaxType] || [null, null];
      if (!group || !account) continue; // แปลง Tax Type ไม่ได้ -- ข้ามสาขานี้ไป (ไม่ควรเกิดถ้าชื่อไฟล์ถูก Pattern)

      // ลบ Header เดิมของ (bu, branch, period, reconcile_account, simple_type) นี้ก่อน (Detail ลบตาม CASCADE)
      const del = await client.query(
        `DELETE FROM vat_reconcile_simple_header
         WHERE bu = $1 AND branch = $2 AND period = $3 AND reconcile_account = $4 AND simple_type = $5`,
        [numericBu, b.branch, period, account, simpleType]
      );
      deletedHeaders += del.rowCount;

      const headerResult = await client.query(
        `INSERT INTO vat_reconcile_simple_header (
           bu, branch, period, simple_type, tax_type_code, tax_type_group, reconcile_account,
           report_title, report_id, print_date, print_by, operator_name,
           address_line1, address_line2, address_line3, company_tax_id, branch_no,
           source_filename, updated_by, bu_code, sub_paid_amount, sub_paid_vat, sub_claimed_amount, sub_claimed_vat, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now(),now())
         RETURNING id`,
        [
          numericBu, b.branch, period, simpleType, finalTaxType, group, account,
          headerCommon.reportTitle, headerCommon.reportId, headerCommon.printDate, headerCommon.printBy, (b.hdr && b.hdr.operatorName) || headerCommon.operatorName,
          (b.hdr && b.hdr.addressLine1) || headerCommon.addressLine1, (b.hdr && b.hdr.addressLine2) || headerCommon.addressLine2, (b.hdr && b.hdr.addressLine3) || headerCommon.addressLine3,
          (b.hdr && b.hdr.companyTaxId) || headerCommon.companyTaxId, (b.hdr && b.hdr.branchNo) || headerCommon.branchNo,
          filename, updatedBy, headerCommon.bu || null,
          b.sub ? b.sub.paid_amount : null, b.sub ? b.sub.paid_vat : null, b.sub ? b.sub.claimed_amount : null, b.sub ? b.sub.claimed_vat : null,
        ]
      );
      insertedHeaders++;
      const headerId = headerResult.rows[0].id;

      for (const r of b.rows) {
        await client.query(
          `INSERT INTO vat_reconcile_simple_detail (
             header_id, receive_date, running_no, tax_invoice_date, tax_invoice_no,
             vendor_name, tax_id, branch_field, item_detail,
             paid_amount, paid_vat, claimed_amount, claimed_vat, claim_percent,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())`,
          [
            headerId, r.receive_date, r.running_no, r.tax_invoice_date, r.tax_invoice_no,
            r.vendor_name, r.tax_id, r.branch_field, r.item_detail,
            r.paid_amount, r.paid_vat, r.claimed_amount, r.claimed_vat, r.claim_percent,
          ]
        );
        insertedDetails++;
      }
    }

    await client.query("COMMIT");

    res.json({
      bu: numericBu,
      period,
      simple_type: simpleType,
      deleted_headers: deletedHeaders,
      inserted_headers: insertedHeaders,
      inserted_details: insertedDetails,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[vatReconcile] simple commit error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล", detail: err.message });
  } finally {
    client.release();
  }
});
export default router;