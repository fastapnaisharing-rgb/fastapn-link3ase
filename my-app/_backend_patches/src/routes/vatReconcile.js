/**
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
import { pool, getUsernameByEmail } from "../db.js";

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
      `SELECT period_activity FROM vat_reconcile_tb
       WHERE bu=$1 AND period=$2 AND branch=$3 AND cpc=$4 AND account=$5 AND subacc=$6`,
      [bu, period, r.branch, r.cpc, r.account, r.subacc]
    );
    const existing = rows[0];
    const oldValue = existing ? Number(existing.period_activity) : null;

    let effective = r.period_activity_raw;
    let status;
    let zeroedThisRun = false;

    if (oldValue === null) {
      status = "new";
    } else if (r.is_protected_account && r.period_activity_raw === 0) {
      effective = oldValue; // ห้าม Overwrite เป็น 0
      zeroedThisRun = true;
      status = oldValue === 0 ? "unchanged" : "protected_kept";
    } else if (oldValue !== r.period_activity_raw) {
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

    const accountConfigMap = await loadAccountConfigMap();
    const { bu, period, records, unmatchedLines } = parseTbText(rawText, accountConfigMap);

    if (!bu || !period) {
      return res.status(422).json({
        error: "ไม่สามารถอ่าน BU หรือ Period จาก Header ของไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ TB ที่ถูกต้อง",
      });
    }

    const diffed = await diffAgainstDb(bu, period, records);

    const summary = {
      bu,
      period,
      total: diffed.length,
      new_count: diffed.filter((r) => r.status === "new").length,
      updated_count: diffed.filter((r) => r.status === "updated").length,
      protected_kept_count: diffed.filter((r) => r.status === "protected_kept").length,
      unchanged_count: diffed.filter((r) => r.status === "unchanged").length,
      unmatched_lines_count: unmatchedLines.length,
    };

    res.json({ summary, records: diffed, unmatchedLines });
  } catch (err) {
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

    const accountConfigMap = await loadAccountConfigMap();
    const { bu, period, records, unmatchedLines } = parseTbText(rawText, accountConfigMap);

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
            beginning_balance = EXCLUDED.beginning_balance,
            period_activity = EXCLUDED.period_activity,
            ending_balance = CASE
                WHEN vat_reconcile_tb.is_protected_account AND EXCLUDED.raw_period_activity = 0
                THEN vat_reconcile_tb.ending_balance
                ELSE EXCLUDED.ending_balance
            END,
            raw_beginning_balance = EXCLUDED.raw_beginning_balance,
            raw_period_activity = EXCLUDED.raw_period_activity,
            raw_ending_balance = EXCLUDED.raw_ending_balance,
            raw_uploaded_at = EXCLUDED.raw_uploaded_at,
            zeroed_at = CASE
                WHEN vat_reconcile_tb.is_protected_account AND EXCLUDED.raw_period_activity = 0
                THEN EXCLUDED.raw_uploaded_at
                ELSE vat_reconcile_tb.zeroed_at
            END,
            updated_by = CASE
                WHEN vat_reconcile_tb.period_activity IS DISTINCT FROM (
                    CASE WHEN vat_reconcile_tb.is_protected_account AND EXCLUDED.raw_period_activity = 0
                         THEN vat_reconcile_tb.period_activity
                         ELSE EXCLUDED.period_activity
                    END
                ) THEN EXCLUDED.updated_by ELSE vat_reconcile_tb.updated_by END,
            last_file_id = EXCLUDED.last_file_id,
            updated_at = CASE
                WHEN vat_reconcile_tb.period_activity IS DISTINCT FROM (
                    CASE WHEN vat_reconcile_tb.is_protected_account AND EXCLUDED.raw_period_activity = 0
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

const IS_DATE_ROW_PATTERN = /^\d{2}-[A-Za-z]{3}-\d{2}\s/;
const IS_BRANCH_HEADER_STRICT = /^[^\d]{2,15}:\s*(\d{5,6}[A-Za-z0-9]*)\s*$/;

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

  let reconcileAccount = null;
  if (taxType === "N" || taxType === "A") reconcileAccount = "11610752";
  else if (taxType === "F" || taxType === "T") reconcileAccount = "11610755";

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

  for (let rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const stripped = line.trim();
    if (!stripped) continue;

    const bh = stripped.match(IS_BRANCH_HEADER_STRICT);
    if (bh && stripped.length < 20) {
      currentBranch = bh[1];
      currentRecord = null;
      continue;
    }

    if (stripped.includes(":") && /:\s*\d{5,6}\s+[\d,]+\.\d{2}/.test(stripped)) {
      const m = stripped.match(/:\s*(\d{5,6})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
      if (m) {
        currentRecord = null;
        continue; // บรรทัดสรุป "รวมตามสาขา" -- ไม่ Insert เป็น Record
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
        operator_name: header.operatorName,
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
      continue;
    }

    if (currentRecord) {
      if (isPageHeaderJunk(stripped)) {
        continue; // ข้าม Page Header ที่พิมพ์ซ้ำทุกครั้งที่ขึ้นหน้าใหม่ (ไม่ใช่ข้อมูลจริง)
      }
      currentRecord.vendor_name = (currentRecord.vendor_name + " " + stripped).trim();
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

/**
 * Resolve BU ให้ทุก Record พร้อมกัน (Cache ผลต่อ Branch กันเรียก Query ซ้ำ)
 */
async function resolveAllBranches(records) {
  const cache = new Map();
  const resolved = [];
  const unmatched = [];

  for (const r of records) {
    if (!cache.has(r.branch)) {
      cache.set(r.branch, await resolveBranchToBu(r.branch));
    }
    const { bu, source } = cache.get(r.branch);
    if (!bu) {
      unmatched.push(r);
      continue;
    }
    resolved.push({ ...r, bu, branch_match_source: source });
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
    const rawText = decodeCp874(req.file.buffer); // แก้จาก latin1 -- ต้องใช้ cp874 ถึงจะอ่าน Thai Text ถูกต้อง -- decodeCp874() เขียนเอง ไม่พึ่ง Library
    const { header, records, unmatchedLines } = parseInputSummaryText(rawText);

    if (!header.period) {
      return res.status(422).json({ error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้" });
    }

    const { resolved, unmatched } = await resolveAllBranches(records);

    // สรุปจำนวน Record เดิมที่จะถูกลบ ต่อ (bu, tax_type) ที่เจอในไฟล์นี้
    const buSet = [...new Set(resolved.map((r) => r.bu))];
    let existingCount = 0;
    if (buSet.length) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) FROM vat_reconcile_input_summary
         WHERE bu = ANY($1) AND period = $2 AND tax_type = $3`,
        [buSet, header.period, header.taxType]
      );
      existingCount = parseInt(rows[0].count, 10);
    }

    res.json({
      summary: {
        period: header.period,
        tax_type: header.taxType,
        reconcile_account: header.reconcileAccount,
        bu_list: buSet,
        parsed_count: records.length,
        matched_count: resolved.length,
        unmatched_branch_count: unmatched.length,
        unmatched_lines_count: unmatchedLines.length,
        existing_rows_to_replace: existingCount,
      },
      records: resolved,
      unmatched_branches: unmatched,
      unmatchedLines,
    });
  } catch (err) {
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
    const rawText = decodeCp874(req.file.buffer); // แก้จาก latin1 -- เหตุผลเดียวกับ /input-summary/preview
    const fileId = req.body.file_id ? parseInt(req.body.file_id, 10) : null;
    const updatedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";

    const { header, records, unmatchedLines } = parseInputSummaryText(rawText);
    if (!header.period) {
      return res.status(422).json({ error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้" });
    }

    const { resolved, unmatched } = await resolveAllBranches(records);
    const buSet = [...new Set(resolved.map((r) => r.bu))];

    await client.query("BEGIN");

    let deletedCount = 0;
    if (buSet.length) {
      const del = await client.query(
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
    console.error("[vatReconcile] input-summary commit error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล", detail: err.message });
  } finally {
    client.release();
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
    codes = ["N", "T", "A", "F"];
  } else {
    codes = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }

  const groups = new Set();
  for (const c of codes) {
    if (c === "F" || c === "T") groups.add("Asset");
    else if (c === "A" || c === "N") groups.add("Expense");
  }
  return [...groups];
}

/**
 * GET /vat-reconcile/dashboard/status?period=2026-08
 * คืนรายการ (BU, กลุ่มภาษี) พร้อมสถานะ Active/Inactive ต่อรายงาน
 */
/**
 * GET /vat-reconcile/dashboard/periods
 * คืนรายการ Period (YYYY-MM) ที่มีข้อมูลจริงอยู่ (จาก TB หรือ Input Summary) เรียงใหม่สุดก่อน
 * ใช้เป็น Option ของ Dropdown "PERIOD" ใน Command Center แทนการ Gen ปฏิทินลอยๆ
 */
router.get("/dashboard/periods", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT period FROM vat_reconcile_tb
       UNION
       SELECT period FROM vat_reconcile_input_summary
       ORDER BY period DESC`
    );
    res.json({ periods: rows.map((r) => r.period) });
  } catch (err) {
    console.error("[vatReconcile] dashboard periods error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึงรายการ Period", detail: err.message });
  }
});

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
        `SELECT branch, cpc, account, subacc, description,
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
        const { rows } = await pool.query(
          `SELECT branch, operator_name, receive_date, grt_no, tax_invoice_date, tax_invoice_no,
                  vendor_name, tax_id, ho, branch_field, item_detail,
                  paid_amount::float8 AS paid_amount,
                  paid_vat::float8 AS paid_vat,
                  claimed100_amount::float8 AS claimed100_amount,
                  claimed100_vat::float8 AS claimed100_vat,
                  calculate_tax::float8 AS calculate_tax
           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
           ORDER BY branch, tax_invoice_date`,
          [bu, account, period]
        );
        return res.json({ type, view, rows });
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
        const params = [bu, account, period, simpleType];
        let branchClause = "";
        if (branchFilter) {
          params.push(branchFilter);
          branchClause = ` AND h.branch = $${params.length}`;
        }
        // DASHBOARD_SIMPLE_DETAIL_DROP_BRANCH_TAXTYPE_PATCH_APPLIED -- ตัด branch/tax_type_code ออก (ซ้ำซ้อนกับ Title Popup)
        const { rows } = await pool.query(
          `SELECT d.running_no,
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
                  d.claim_percent::float8 * 100 AS claim_percent -- SIMPLE_DETAIL_CLAIM_PERCENT_X100_PATCH_APPLIED (Ratio -> %)
           FROM vat_reconcile_simple_header h
           JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3 AND h.simple_type = $4${branchClause}
           ORDER BY h.branch, d.receive_date, d.running_no`,
          params
        );
        return res.json({ type, view, branch: branchFilter, rows });
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
          account: group === "Asset" ? ASSET_ACCOUNT : EXPENSE_ACCOUNT,
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

  for (let r = 15; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const qVal = simpleCellText(row, 17);

    if (qVal && qVal.startsWith("รวมสุทธิ")) break; // จบไฟล์

    if (qVal && qVal.startsWith("รวมสาขา")) {
      // SIMPLE_BRANCHCODE_ALNUM_PATCH_APPLIED — รองรับ Branch Code ที่มีตัวอักษรปน เช่น "0402W2" (เดิมใช้ \d+ ตัดเหลือ "0402")
      const m = /รวมสาขา\s*(\S+)/.exec(qVal);
      const branchCode = m ? m[1] : headerCommon.primaryBranch;
      branches.push({ branch: branchCode, rows: currentRows });
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
    branches.push({ branch: headerCommon.primaryBranch, rows: currentRows });
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
    const numericBu = await resolveBuToNumeric(headerCommon.bu);

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
    const numericBu = await resolveBuToNumeric(headerCommon.bu);
    if (!numericBu) {
      return res.status(422).json({ error: `ไม่พบ BU "${headerCommon.bu}" ในระบบ (แปลงเป็นเลข BU ไม่ได้)` });
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
           source_filename, updated_by, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())
         RETURNING id`,
        [
          numericBu, b.branch, period, simpleType, finalTaxType, group, account,
          headerCommon.reportTitle, headerCommon.reportId, headerCommon.printDate, headerCommon.printBy, headerCommon.operatorName,
          headerCommon.addressLine1, headerCommon.addressLine2, headerCommon.addressLine3, headerCommon.companyTaxId, headerCommon.branchNo,
          filename, updatedBy,
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