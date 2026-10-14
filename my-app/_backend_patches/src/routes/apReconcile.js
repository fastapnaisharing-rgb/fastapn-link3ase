/**
 * apReconcile.js
 * ==========================================================================
 * FASTAPN Link3ase — Feature: GL Functional > Reconcile > Account Payable Recon.
 * ส่วนที่ 1: AP Cutting (Detail) — รับไฟล์ Raw จาก Oracle EBS
 *            "Accounts Payable Trial Balance Summary(New) (Custom)" (.out)
 *
 * ไฟล์นี้แยก Namespace ออกจาก vat-reconcile.js โดยตั้งใจ (Confirm กับผู้ใช้แล้ว)
 * เพราะ AP Cutting เป็นข้อมูล Detail-grain (รายบรรทัด Invoice) คนละ Table/Concept
 * กับ TB (Balance-grain, ใช้ vat_reconcile_tb ร่วมกับ VAT อยู่แล้ว ไม่ต้องแตะที่นี่)
 *
 * ⚠️ ตาราง ap_cutting_staging มีอยู่แล้วจริงในฐานข้อมูล (สร้างไว้นอกรอบ Session นี้,
 *    ตอนตรวจสอบพบว่ายังว่างเปล่า 0 Row) ห้ามรัน ap_cutting_staging_v1.sql ซ้ำ —
 *    ไฟล์นั้นปรับเป็น Documentation ให้ตรง Schema จริงแล้ว ไม่ต้อง Migrate อะไรเพิ่ม
 *    Router นี้ Insert ตาม Column ชุดจริงของตาราง มี 4 จุดที่เป็นการ "สันนิษฐาน"
 *    ความหมาย Column ที่หาโค้ด/เอกสารอ้างอิงเดิมไม่เจอ (Comment กำกับไว้ในจุด Insert
 *    ของ /ap-cutting/commit) — ผู้ใช้ควรตรวจทานหลัง Deploy ว่าตรงกับที่ออกแบบไว้เดิม
 *
 * db.js อยู่ที่ src/db.js, ไฟล์นี้อยู่ที่ src/routes/apReconcile.js จึง import ด้วย "../db.js"
 * (Pattern เดียวกับ vatReconcile.js ทุกอย่าง — Auth Middleware เดิม (verifyAuthLocal +
 * attachAppRole) Apply ระดับ app.js อยู่แล้วก่อนถึง Router นี้ ไม่ต้องเพิ่มเอง)
 *
 * Flow:
 *   1) POST /ap-reconcile/ap-cutting/preview -> Parse ไฟล์ + Resolve BU จาก Branch
 *      คืน Summary/Records ให้ดูก่อน (ไม่เขียน DB)
 *   2) POST /ap-reconcile/ap-cutting/commit  -> Parse ไฟล์ซ้ำ + Replace ทั้งก้อน
 *      (DELETE ข้อมูลเก่าของ (bu, period) นั้นก่อน แล้ว Insert ใหม่ทั้งหมด)
 *      เหตุผลที่ Replace ทั้งก้อนแทน Upsert ทีละแถวแบบ TB: เพราะเป็นข้อมูลระดับ
 *      Invoice ณ วันที่ Snapshot — ถ้ารอบใหม่ไม่มี Invoice ที่เคยมี ต้องไม่เหลือค้าง
 *      (Pattern เดียวกับ /input-summary/commit ใน vatReconcile.js)
 *
 * Whitelist Account (Liability Account 7-Segment ตำแหน่งที่ 6 — GL Account):
 *   ยืนยันจาก VBA Macro (Z_Option_TB_Cutting_for_Reconcile) + Validate กับไฟล์จริง
 *   3 Book (REV/CRG/TOPS) แล้ว ครบทั้ง 6 รหัส ไม่มี Unmatched Line เหลือเลย
 *
 * ⚠️ Retention: ยังไม่มี Auto-Delete ของ ap_cutting_staging (ผู้ใช้บอกจะแจ้ง
 *    Logic ลบเองทีหลัง — ตอนนี้ข้อมูลจะอยู่ถาวรจนกว่าจะมี Instruction เพิ่ม)
 * ==========================================================================
 */

import express from "express";
import multer from "multer";
import crypto from "crypto";
import zlib from "zlib"; // MARKER_APRECONCILE_SPEED_V1
import { pool, getUsernameByEmail } from "../db.js";
import registerApReport from "./apReconcileReport.js"; // MARKER_APRECONCILE_REPORT_V1
import registerMenuPermissions from "./menuPermissions.js"; // MARKER_MENU_PERMISSION_CONFIG_BACKEND_V1

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// MARKER_APRECONCILE_SPEED_V1 -- ส่ง JSON แบบบีบอัด (gzip) เมื่อ Browser รองรับ: Preview ~4MB -> ~0.3MB (ไม่ต้องลง Package เพิ่ม ใช้ zlib ของ Node)
function sendJsonGz(req, res, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  if (body.length > 20000 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    const gz = zlib.gzipSync(body, { level: 1 });
    res.set({ "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Content-Length": gz.length, Vary: "Accept-Encoding" });
    return res.end(gz);
  }
  res.set("Content-Type", "application/json; charset=utf-8");
  return res.end(body);
}

// ── ตัวแปลง windows-874 (cp874/Thai) เอง — Copy จาก vatReconcile.js (ไม่ Export ที่นั่น
// เลย Duplicate มาแทนที่จะแก้ไฟล์ VAT เดิม กันความเสี่ยงต่อ Endpoint ที่ทำงานอยู่แล้ว) ──
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
  // MARKER_APRECONCILE_FAST_DECODE_V1 -- เดิมต่อ String ทีละ Byte (ไฟล์ 2 MB ช้า ~0.4 วินาที) -> แปลงเป็น Code Unit แล้วแปลง Text ทีละก้อน
  const CHUNK = 8192;
  const parts = [];
  const units = new Array(Math.min(CHUNK, buffer.length));
  for (let i = 0; i < buffer.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, buffer.length);
    const n = end - i;
    units.length = n;
    for (let j = 0; j < n; j++) {
      const b = buffer[i + j];
      units[j] = b < 0x80 ? b : CP874_HIGH_BYTE_TABLE[b - 0x80];
    }
    parts.push(String.fromCharCode.apply(null, units));
  }
  return parts.join("");
}

// MARKER_APRECONCILE_AUTODETECT_ENCODING_V1
// ── ไฟล์ AP Cutting บางไฟล์ถูก Save เป็น UTF-8 (เดิมสมมติเป็น cp874 เสมอ -> ภาษาไทยเพี้ยนเป็น "เธเธฒ…" + �)
// ── ลอง UTF-8 แบบ Strict ก่อน (ไบต์ cp874 ภาษาไทยแทบไม่มีทางเป็น UTF-8 ที่ถูกต้อง) ไม่ผ่านค่อย Fallback cp874 ──
function decodeApText(buffer) {
  let buf = buffer;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3); // ตัด UTF-8 BOM
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (_) {
    return decodeCp874(buffer);
  }
}

// ── Whitelist GL Account ของ AP Cutting (ยืนยันแล้วจาก VBA + ไฟล์จริง 3 Book) ──
const TARGET_GL_ACCOUNTS = new Set([
  "21930052", "21930054", "21930100", "21930084", "21930085", "21930220",
]);

/**
 * Parse ไฟล์ AP Cutting (.out จาก Oracle EBS "Accounts Payable Trial Balance
 * Summary(New) (Custom)") — Validate แล้วกับไฟล์จริง 3 Book (REV/CRG/TOPS),
 * Unmatched Line = 0 ทั้ง 3 ไฟล์
 *
 * โครงสร้างไฟล์ (Fixed-width หลัง Header):
 *   ' Liability Account:  1-05-0572-057201-99999-21930052-018408'
 *     7-Segment: Company-CostCenter-Department-Branch-Future-GLAccount-SubAccount
 *   'Supplier :  N-131483          : ชื่อ Supplier ภาษาไทย'
 *   'P7201/2010009685/1/2  23-JUL-25  THB              728.03              728.03   คำอธิบาย'
 *     Column Width ตาม Dash Header: Invoice No(20) Date(9) Curr(4) Amount(18) Remaining(18) Desc(เหลือ)
 *   บรรทัดที่ต้องข้าม: ว่าง, '---...', 'Total for Supplier/Liability Account/Report',
 *                      'Page: N', 'Invoice Number'/'Invoice' (Header ซ้ำตอนขึ้นหน้าใหม่)
 *   Form Feed (\x0c) อาจติดอยู่หน้าบรรทัดถัดไปเลย (ไม่ได้แยกเป็นบรรทัดของตัวเอง
 *   เสมอ — แล้วแต่ Book) ต้อง Strip ออกก่อนเช็คเงื่อนไขอื่นทุกครั้ง
 */
function parseApCuttingText(rawText) {
  const lines = rawText.split("\n");
  let book = null;
  let asOfDate = null;
  const records = [];
  const unmatchedLines = [];
  let dataLineCount = 0; // MARKER_APRECONCILE_NO_DATA_LOSS_V1 -- จำนวนบรรทัดข้อมูลทั้งหมดในไฟล์ (ใช้ปิดยอดกับ records)
  let fileTotals = null; // { amount, remaining } จาก 'Total for Report'
  const dataLikeRe = /\b\d{2}-[A-Z]{3}-\d{2}\s+[A-Z]{3}\s+\(?[\d,]+\.\d{2}\)?\s+\(?[\d,]+\.\d{2}\)?/;

  let curLiability = null; // { company, costCenter, department, branch, future, glAccount, subAccount }
  let curSupplierCode = null;
  let curSupplierName = null;

  const liabRe = /^\s*Liability Account:\s+([A-Za-z0-9-]+)\s*$/; // MARKER_APRECONCILE_NO_DATA_LOSS_V1 -- Sub Account/CPC มีตัวอักษรได้ (เช่น 0560B9, 0560H2) ห้ามจับไม่ได้ ไม่งั้นรายการถูกยัดเข้า Account ก่อนหน้า
  const supplierRe = /^Supplier\s*:\s*([^\s:]+)\s*:\s*(.*)$/;
  const dashRe = /^-{10,}/;

  for (let i = 0; i < lines.length; i++) {
    // Strip Form Feed (Page Break) ที่อาจติดหน้าบรรทัด + Trailing \r (CRLF เดิม)
    const line = lines[i].replace(/\f/g, "").replace(/\r+$/, "");
    const stripped = line.trim();

    if (book === null && i < 15 && stripped && !stripped.startsWith("Page:")) {
      // ชื่อ Book คือกลุ่มคำแรกก่อนช่องว่างยาว (เช่น "REV BOOK" จาก
      // "REV BOOK                    ...   Report Date: ...")
      const m = line.match(/^(\S+(?:\s\S+)*?)\s{2,}/);
      book = m ? m[1].trim() : stripped;
      continue;
    }
    if (line.startsWith("                     As of Date:")) {
      asOfDate = line.split(":").slice(1).join(":").trim();
      continue;
    }

    const liabM = liabRe.exec(line);
    if (liabM) {
      const segs = liabM[1].split("-");
      curLiability = segs.length === 7
        ? {
            company: segs[0], costCenter: segs[1], department: segs[2],
            branch: segs[3], future: segs[4], glAccount: segs[5], subAccount: segs[6],
          }
        : null;
      curSupplierCode = null;
      curSupplierName = null;
      continue;
    }

    const supM = supplierRe.exec(line);
    if (supM) {
      curSupplierCode = supM[1].trim();
      curSupplierName = supM[2].trim();
      continue;
    }

    if (stripped.startsWith("Total for Report")) { // MARKER_APRECONCILE_NO_DATA_LOSS_V1
      const tm = /Total for Report\s*:\s*(\(?[\d,]+\.\d{2}\)?)\s+(\(?[\d,]+\.\d{2}\)?)/.exec(stripped);
      if (tm) fileTotals = { amount: parseAmount(tm[1]), remaining: parseAmount(tm[2]) };
    }
    if (
      stripped.startsWith("Total for Supplier") ||
      stripped.startsWith("Total for Liability Account") ||
      stripped.startsWith("Total for Report") ||
      stripped.startsWith("Page:") ||
      stripped.startsWith("Invoice Number") ||
      stripped.startsWith("Invoice")
    ) {
      continue;
    }
    if (dashRe.test(line) || stripped === "") continue;

    if (dataLikeRe.test(line)) dataLineCount++; // MARKER_APRECONCILE_NO_DATA_LOSS_V1
    if (
      curLiability &&
      line.length > 40 &&
      line[0] !== " "
    ) {
      const invNo = line.slice(0, 20).trim();
      const invDate = line.slice(22, 31).trim();
      const curr = line.slice(33, 37).trim();
      const amount = line.slice(39, 57).trim();
      const remaining = line.slice(59, 77).trim();
      const desc = line.slice(79).trim();

      if (invNo && invDate) {
        records.push({
          book,
          com: curLiability.department, // MARKER_APRECONCILE_COM_RESOLVE_V1 -- Segment 3 (4 ตัวท้ายของ 1-04-0401) ใช้จับ BU/Book
          branch: curLiability.branch,
          cpc: curLiability.future, // Segment 5 = CPC (โค้ดเดิมเรียกว่า future)
          gl_account: curLiability.glAccount,
          sub_account: curLiability.subAccount,
          supplier_code: curSupplierCode,
          supplier_name: curSupplierName,
          invoice_no: invNo,
          invoice_date: invDate,
          currency: curr,
          amount_raw: amount,
          remaining_amount_raw: remaining,
          description: desc,
          in_whitelist: TARGET_GL_ACCOUNTS.has(curLiability.glAccount), // MARKER_APRECONCILE_NO_DATA_LOSS_V1 -- ไม่ทิ้งแถวที่ GL ไม่อยู่ใน Whitelist แล้ว (เก็บครบ แค่ทำเครื่องหมาย)
        });
      } else {
        unmatchedLines.push(line);
      }
    } else if (dataLikeRe.test(line)) {
      unmatchedLines.push(line); // MARKER_APRECONCILE_NO_DATA_LOSS_V1 -- บรรทัดที่หน้าตาเป็นข้อมูลแต่อ่านไม่ได้ (เช่น ไม่รู้ว่าอยู่ใต้ Liability Account ไหน) -> Error ไม่ทิ้งเงียบ
    }
  }

  return { book, asOfDate, records, unmatchedLines, dataLineCount, fileTotals };
}

/** แปลง "31-AUG-26" (Oracle Date Format) -> "2026-08-31" (ISO) เพื่อเก็บเป็น DATE ใน Postgres */
function oracleDateToIso(oracleDate) {
  if (!oracleDate) return null;
  const MONTHS = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const m = /^(\d{2})-([A-Z]{3})-(\d{2})$/.exec(oracleDate.trim());
  if (!m) return null;
  const [, dd, mon, yy] = m;
  const month = MONTHS[mon.toUpperCase()];
  if (!month) return null;
  // Oracle 2-digit year: 00-68 => 2000-2068, 69-99 => 1969-1999 (Standard Oracle Rule)
  const year = parseInt(yy, 10) <= 68 ? `20${yy}` : `19${yy}`;
  return `${year}-${month}-${dd}`;
}

/** แปลง "(3,791.44)" (ติดลบแบบวงเล็บ) หรือ "3,791.44" -> Number */
function parseAmount(text) {
  if (!text) return 0;
  const negative = text.startsWith("(") && text.endsWith(")");
  const cleaned = text.replace(/[(),]/g, "").trim();
  const num = parseFloat(cleaned) || 0;
  return negative ? -num : num;
}

/** Period จาก As-of-Date เช่น "31-AUG-26" -> "2026-08" */
function periodFromAsOfDate(asOfDate) {
  const iso = oracleDateToIso(asOfDate);
  return iso ? iso.slice(0, 7) : null;
}

// ── resolveBranchToBu / resolveBuToNumeric / resolveAllBranches — Copy จาก
// vatReconcile.js (ไม่ Export ที่นั่น เลย Duplicate แทนที่จะแก้ไฟล์ VAT เดิม) ──
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
    if (numericBu) return { bu: numericBu, source: "branch_list" };
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
        continue;
      }
      return { bu: r.group_name, source: "group_range" };
    }
  }
  return { bu: null, source: "unmatched" };
}

// MARKER_APRECONCILE_COM_RESOLVE_V1 -- จับ BU/Book จาก "Com" (Segment 3 ของ Liability Account) ไม่ใช้ Branch แล้ว
//   1) Group Range (ตัด Com ตาม prefix_length แล้วเทียบช่วง)  2) company_list ("COMPANY CODE" Segment 3)
//   3) ไม่เจอ -> unmatched (Error ห้ามบันทึก) | Book ดึงจาก company_list."BOOK" ของ BU นั้น
//   โหลด company_list + Group Range ครั้งเดียวต่อไฟล์ (2 Query) แล้วจับในหน่วยความจำ ไม่ Query ทีละแถว
async function loadComMaps() {
  const { rows: cl } = await pool.query(
    `SELECT bu, "BOOK" AS book, "COMPANY CODE" AS company_code FROM company_list WHERE deleted IS NOT TRUE`
  );
  const { rows: ranges } = await pool.query(
    `SELECT group_name, range_start, range_end, exclude_start, exclude_end, prefix_length FROM vat_watchlist_bu_group_range`
  );
  const comToRow = new Map();
  const buToBook = new Map();
  for (const r of cl) {
    const com = r.company_code ? r.company_code.split("-")[2] : null;
    const book = (r.book || "").trim();
    if (com && r.bu) {
      const cur = comToRow.get(com);
      if (!cur || (!cur.book && book)) comToRow.set(com, { bu: r.bu, book });
    }
    if (r.bu && book && !buToBook.has(r.bu)) buToBook.set(r.bu, book);
  }
  return { comToRow, buToBook, ranges };
}

function resolveCom(com, maps) {
  if (!com) return { bu: null, book: null, source: "unmatched", reason: "ไม่พบ Com ใน Liability Account" };
  for (const r of maps.ranges) {
    const n = r.prefix_length || 0;
    const key = n ? com.slice(0, n) : com;
    const st = n ? String(r.range_start).slice(0, n) : String(r.range_start);
    const en = n ? String(r.range_end).slice(0, n) : String(r.range_end);
    if (key >= st && key <= en) {
      if (r.exclude_start && r.exclude_end && com >= r.exclude_start && com <= r.exclude_end) continue;
      const book = maps.buToBook.get(r.group_name) || null;
      if (!book) return { bu: r.group_name, book: null, source: "unmatched", reason: `BU ${r.group_name} ไม่มี BOOK ใน company_list` };
      return { bu: r.group_name, book, source: "group_range" };
    }
  }
  const row = maps.comToRow.get(com);
  if (row) {
    if (!row.book) return { bu: row.bu, book: null, source: "unmatched", reason: `BU ${row.bu} ไม่มี BOOK ใน company_list` };
    return { bu: row.bu, book: row.book, source: "company_list" };
  }
  return { bu: null, book: null, source: "unmatched", reason: `ไม่พบ Com ${com} ทั้งใน Group Range และ company_list` };
}

async function resolveAllBranches(records) {
  const maps = await loadComMaps();
  const resolved = [];
  const unmatched = [];
  for (let i = 0; i < records.length; i++) {
    const r = { ...records[i], row_no: i + 1 };
    const x = resolveCom(r.com, maps);
    if (!x.bu || !x.book) {
      unmatched.push({ ...r, status: "out_of_scope", reason: x.reason });
      continue;
    }
    resolved.push({ ...r, bu: x.bu, book: x.book, branch_match_source: x.source, status: "ok" });
  }
  return { resolved, unmatched };
}


// MARKER_APRECONCILE_NO_DATA_LOSS_V1 -- ปิดยอดไฟล์กับที่อ่านได้: ไม่ตรง = Error (ห้ามบันทึก) เพื่อให้ข้อมูลไม่หายเงียบ
function buildApControl(parsed, resolvedCount, outOfScopeRows) { // Com ที่จับ BU ไม่ได้ = นอก Scope (ไม่บันทึก แต่ยังนับเพื่อให้ยอดปิดกับไฟล์)
  const { records, unmatchedLines, dataLineCount, fileTotals } = parsed;
  const parsedAmount = Math.round(records.reduce((n, r) => n + parseAmount(r.amount_raw), 0) * 100) / 100;
  const parsedRemaining = Math.round(records.reduce((n, r) => n + parseAmount(r.remaining_amount_raw), 0) * 100) / 100;
  const errors = [];
  if (unmatchedLines.length) errors.push(`มี ${unmatchedLines.length} บรรทัดที่อ่านไม่ได้`);
  const oosAmount = Math.round(outOfScopeRows.reduce((n, r) => n + parseAmount(r.amount_raw), 0) * 100) / 100;
  if (records.length !== dataLineCount) errors.push(`จำนวนแถวไม่ปิด: ไฟล์มี ${dataLineCount} บรรทัดข้อมูล แต่อ่านได้ ${records.length}`);
  if (fileTotals) {
    if (Math.abs(fileTotals.amount - parsedAmount) > 0.005) errors.push(`ยอด Amount ไม่ปิด: ไฟล์ ${fileTotals.amount.toFixed(2)} แต่อ่านได้ ${parsedAmount.toFixed(2)}`);
    if (Math.abs(fileTotals.remaining - parsedRemaining) > 0.005) errors.push(`ยอด Remaining ไม่ปิด: ไฟล์ ${fileTotals.remaining.toFixed(2)} แต่อ่านได้ ${parsedRemaining.toFixed(2)}`);
  } else {
    errors.push("ไม่พบบรรทัด 'Total for Report' ในไฟล์ จึงปิดยอดเงินไม่ได้");
  }
  return {
    file_line_count: dataLineCount,
    saved_line_count: resolvedCount,
    file_total_amount: fileTotals ? fileTotals.amount : null,
    file_total_remaining: fileTotals ? fileTotals.remaining : null,
    parsed_amount_total: parsedAmount,
    parsed_remaining_total: parsedRemaining,
    out_of_scope_count: outOfScopeRows.length,
    out_of_scope_amount: oosAmount,
    out_of_scope_coms: [...new Set(outOfScopeRows.map((r) => r.com))],
    saved_amount: Math.round((parsedAmount - oosAmount) * 100) / 100,
    outside_whitelist_count: records.filter((r) => !r.in_whitelist).length,
    errors,
    ok: errors.length === 0,
  };
}

/**
 * POST /ap-reconcile/ap-cutting/preview
 * รับไฟล์ AP Cutting ดิบ -> Parse + Resolve BU -> คืน Summary/Records (ไม่เขียน DB)
 */
router.post("/ap-cutting/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const t0 = Date.now();
    const rawText = decodeApText(req.file.buffer);

    const parsedAp = parseApCuttingText(rawText);
    const tParse = Date.now() - t0;
    const { book, asOfDate, records, unmatchedLines } = parsedAp;
    const period = periodFromAsOfDate(asOfDate);

    if (!period) {
      return res.status(422).json({
        error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ AP Cutting ที่ถูกต้อง",
      });
    }

    const { resolved, unmatched } = await resolveAllBranches(records);
    const tResolve = Date.now() - t0 - tParse;
    const buSet = [...new Set(resolved.map((r) => r.bu))];

    // MARKER_APRECONCILE_PREVIEW_SUMMARY_FIELDS_V1 -- Frontend (VatReconcileSystem.js ส่วน ap_cutting) อ่าน summary.bu / parsed_count / matched_count / existing_rows_to_replace
    // ของเดิมส่งแค่ bu_list/total/resolved_count ทำให้ Popup ขึ้น "—" ทุกช่อง -> ส่งทั้งชื่อเดิมและชื่อที่ Frontend ใช้
    let existingRows = 0;
    if (buSet.length) {
      const ex = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ap_cutting_staging WHERE branch_cpc_key = ANY($1) AND period = $2`,
        [buSet, period]
      );
      existingRows = ex.rows[0]?.n || 0;
    }
    const bookList = [...new Set(resolved.map((r) => r.book))];
    const summary = {
      book: bookList.join(", ") || book,
      period,
      bu: buSet.join(", "),
      bu_list: buSet,
      total: records.length,
      parsed_count: records.length,
      resolved_count: resolved.length,
      matched_count: resolved.length,
      existing_rows_to_replace: existingRows,
      unmatched_branch_count: unmatched.length,
      unmatched_lines_count: unmatchedLines.length,
    };
    const control = buildApControl(parsedAp, resolved.length, unmatched); // MARKER_APRECONCILE_NO_DATA_LOSS_V1
    summary.control = control;

    // Preview ยังไม่ตัดอะไรออก: records = ทุกแถวในไฟล์ตามลำดับเดิม (status 'ok' = จะบันทึก, 'out_of_scope' = Com จับ BU/Book ไม่ได้ จะไม่ถูกบันทึกตอน Commit)
    const allRows = [...resolved, ...unmatched].sort((a, b) => a.row_no - b.row_no);
    const tBeforeSend = Date.now() - t0;
    sendJsonGz(req, res, { summary, records: allRows, unmatchedLines, unmatchedBranches: unmatched, control });
    console.log(`[apReconcile] preview rows=${records.length} parse=${tParse}ms resolve=${tResolve}ms total_before_send=${tBeforeSend}ms send=${Date.now() - t0 - tBeforeSend}ms`);
  } catch (err) {
    console.error("[apReconcile] ap-cutting preview error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างประมวลผลไฟล์", detail: err.message });
  }
});

/**
 * POST /ap-reconcile/ap-cutting/commit
 * Parse ไฟล์ซ้ำ -> Replace ทั้งก้อน: DELETE (bu, period, book) เดิม -> Insert ใหม่ทั้งหมด
 * Body เพิ่มเติม (form field): file_id (จาก file_storage ถ้ามี)
 */
router.post("/ap-cutting/commit", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }
    const t0 = Date.now();
    const rawText = decodeApText(req.file.buffer);
    const fileId = req.body.file_id ? parseInt(req.body.file_id, 10) : null;
    const updatedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";

    const parsedAp = parseApCuttingText(rawText);
    const { book, asOfDate, records, unmatchedLines } = parsedAp;
    const period = periodFromAsOfDate(asOfDate);

    if (!period) {
      return res.status(422).json({ error: "ไม่สามารถอ่าน Period จาก Header ของไฟล์ได้" });
    }

    const { resolved, unmatched } = await resolveAllBranches(records);
    const control = buildApControl(parsedAp, resolved.length, unmatched); // MARKER_APRECONCILE_NO_DATA_LOSS_V1
    if (!control.ok) {
      return res.status(422).json({ error: "ไม่อนุญาตให้บันทึก: ข้อมูลในไฟล์ไม่ปิดยอด — " + control.errors.join(" / "), code: "AP_CUTTING_NOT_BALANCED", control });
    }
    const buSet = [...new Set(resolved.map((r) => r.bu))];

    // ── ตาราง ap_cutting_staging มีอยู่แล้วจริงในฐานข้อมูล (สร้างไว้ก่อนหน้านี้
    // นอกรอบ Session นี้ — ตอน Deploy ห้ามรัน ap_cutting_staging_v1.sql เพราะจะชน
    // Schema เดิม) — จึง Insert ตาม Column ชุดจริงที่มีอยู่ ไม่ใช่ Schema ที่ผมออกแบบเอง
    // แรกเริ่ม ส่วนที่แม็พ 1:1 ชัดเจน (source_book/period/branch_code/gl_account/... )
    // กับส่วนที่ "สันนิษฐาน" (มี Comment กำกับ) เพราะไม่พบโค้ดเดิมอ้างอิงความหมาย:
    //   - branch_cpc_key  = ใช้เก็บค่า BU ที่ Resolve ได้จาก Branch (เทียบเท่า bu เดิม)
    //   - brand_group     = ตัวอักษรแรกของ Book (REV->'R', CRG->'C', TOPS->'T')
    //   - is_special_case = true เมื่อ Resolve BU ผ่าน Fallback (vat_watchlist_bu_group_range)
    //                       แทนการ Match ตรงจาก branch_list (branch_match_source==='group_range')
    //   - status          = ค่าเริ่มต้น 'imported' (ยังไม่มี Workflow สถานะอื่นตอนนี้)
    //   - source_request_id = ปล่อย NULL (ไม่พบ Concept นี้ใช้ที่ไหนในระบบตอนนี้)
    // ผู้ใช้ควรตรวจสอบ 4 จุดที่สันนิษฐานนี้หลัง Deploy ว่าตรงกับที่ออกแบบไว้เดิมหรือไม่
    const batchId = crypto.randomUUID();

    await client.query("BEGIN");

    let deletedCount = 0;
    if (buSet.length) {
      const del = await client.query(
        `DELETE FROM ap_cutting_staging WHERE branch_cpc_key = ANY($1) AND period = $2`,
        [buSet, period]
      );
      deletedCount = del.rowCount;
    }

    const now = new Date();
    const asOfDateIso = oracleDateToIso(asOfDate);
    let insertedCount = 0;
    // MARKER_APRECONCILE_BATCH_INSERT_V1 -- Insert ทีละหลายร้อยแถวต่อ 1 Query (ไฟล์ใหญ่ เช่น 9,000+ แถว/BU เยอะ ไม่ช้า/ไม่ Timeout)
    const COLS = 23;
    const CHUNK = 500; // 500*23 = 11,500 params (< 65,535)
    for (let i = 0; i < resolved.length; i += CHUNK) {
      const part = resolved.slice(i, i + CHUNK);
      const params = [];
      const tuples = part.map((r, k) => {
        const isSpecialCase = r.branch_match_source === "group_range";
        const brandGroup = (r.book || "").trim().charAt(0).toUpperCase() || null;
        params.push(
          batchId, r.book, fileId != null ? String(fileId) : null, req.file.originalname || null, asOfDateIso, period,
          r.branch, r.gl_account, r.sub_account, r.supplier_code, r.supplier_name,
          r.invoice_no, oracleDateToIso(r.invoice_date), r.currency, parseAmount(r.amount_raw), parseAmount(r.remaining_amount_raw), r.description,
          r.bu, brandGroup, isSpecialCase, "imported", now, updatedBy
        );
        const o = k * COLS;
        return "(" + Array.from({ length: COLS }, (_, c) => "$" + (o + c + 1)).join(",") + ")";
      });
      await client.query(
        `INSERT INTO ap_cutting_staging (
            batch_id, source_book, source_request_id, source_file_name, as_of_date, period,
            branch_code, gl_account, sub_account, supplier_code, supplier_name,
            invoice_number, invoice_date, currency, amount, remaining_amount, description,
            branch_cpc_key, brand_group, is_special_case, status, imported_at, imported_by
         ) VALUES ` + tuples.join(","),
        params
      );
      insertedCount += part.length;
    }

    await client.query("COMMIT");
    console.log(`[apReconcile] commit rows=${insertedCount} deleted=${deletedCount} total=${Date.now() - t0}ms`);

    res.json({
      book,
      period,
      bu_list: buSet,
      book: [...new Set(resolved.map((r) => r.book))].join(", "),
      deleted: deletedCount,
      inserted: insertedCount,
      unmatched_branch_count: unmatched.length,
      unmatched_lines_count: unmatchedLines.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[apReconcile] ap-cutting commit error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล", detail: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /ap-reconcile/dashboard/status?period=YYYY-MM
 * ────────────────────────────────────────────────────────────────────────
 * ใช้แทน MOCK_BU_ROWS ใน GLFunctionalController.js (Frontend) — คืนรายชื่อ BU
 * ที่ "มีข้อมูลจริง" ใน Period นั้น (จาก ap_cutting_staging และ/หรือ vat_reconcile_tb)
 * พร้อมสถานะต่อ 1 ใน 6 Account Whitelist (TARGET_GL_ACCOUNTS) ของแต่ละ BU
 *
 * ออกแบบตาม Pattern เดียวกับ vatReconcile.js's GET /dashboard/status
 * (Batch Query ด้วย GROUP BY ครั้งเดียวต่อตาราง แทนที่จะ Query วนทีละ BU)
 * แต่ต่างจาก VAT ตรงที่ "รายชื่อ BU" ไม่ได้มาจาก company_list — ผู้ใช้ยืนยันแล้วว่า
 * อยากให้ BUSINESS UNIT Dropdown ขึ้นเฉพาะ BU ที่มีข้อมูลจริงใน Period ที่เลือก
 * (Data-Driven ล้วนๆ) จึงรวบรวม BU จาก Distinct branch_cpc_key/bu ที่เจอใน
 * 2 ตารางนี้โดยตรงแทน
 *
 * Response Shape (ตรงกับที่ ReconcileZoneLayout.js ฝั่ง Frontend ต้องการ V4):
 *   { period, bu_rows: [ { bu, cells: { [account]: { count, tbActive, exported } }, last_activity_at } ] }
 *
 * ⚠️ exported จะเป็น false เสมอตอนนี้ — ยังไม่มี Infra เก็บสถานะ "Export ไปแล้ว"
 *    (ตาราง/Column สำหรับ Track เรื่องนี้ยังไม่ถูกออกแบบ รอ Feature Export จริง
 *    ที่ต้องรอไฟล์ Macro "A_Reconcile" + Template Master Reconcile ก่อน)
 */
// MARKER_DASHBOARD_STATUS_BU_FORMAT_FIX_V2 — แก้บั๊กสำคัญ: vat_reconcile_tb.bu เก็บเป็น
// "เลข BU" (เช่น "3218") ไม่ใช่ Short Code (เช่น "CDS") แบบที่ ap_cutting_staging.branch_cpc_key
// ใช้ — ยืนยันจาก vatReconcile.js (resolveBuToNumeric, Comment บรรทัด ~656 พูดถึงปัญหานี้ตรงๆ
// ว่า "กันปัญหา BTM vs 3218 ไม่ตรงกันที่เจอซ้ำหลายรอบ") ตอน V1 เขียน Query เทียบ bu ตรงๆ
// ไม่ได้แปลง Format เลย ทำให้ TB ขึ้น "No Data" เสมอไม่ว่าจะมีข้อมูลจริงหรือไม่ — แก้โดย Join
// company_list แปลง Short Code <-> เลข BU ทั้ง 2 ทาง (Pattern เดียวกับ vatReconcile.js)
router.get("/dashboard/status", async (req, res) => {
  try {
    const period = req.query.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "ต้องระบุ period รูปแบบ YYYY-MM เช่น ?period=2026-08" });
    }
    const accounts = [...TARGET_GL_ACCOUNTS];

    // Batch Query จำนวน Row AP Cutting ต่อ (BU, Account) — ใช้ branch_cpc_key เป็น "bu"
    // (Column เดียวกับที่ /ap-cutting/commit Insert ค่า Resolve BU ลงไป) — เป็น Short Code เสมอ
    const cuttingRows = await pool.query(
      `SELECT branch_cpc_key AS bu, gl_account AS account, COUNT(*) AS cnt, MAX(imported_at) AS last_activity
       FROM ap_cutting_staging
       WHERE period = $1 AND gl_account = ANY($2::text[]) AND branch_cpc_key IS NOT NULL
       GROUP BY branch_cpc_key, gl_account`,
      [period, accounts]
    );
    const cuttingMap = new Map(
      cuttingRows.rows.map((r) => [`${r.bu}|${r.account}`, { count: parseInt(r.cnt, 10), lastActivity: r.last_activity }])
    );

    // แปลง Short Code <-> เลข BU ทั้งระบบ (ตาราง company_list เล็ก โหลดทีเดียวจบ ไม่ต้อง Query
    // ทีละ BU) — Format "COMPANY CODE" เป็น Flexfield Prefix "1-32-3218-" เอา Segment ที่ 3
    const companyRows = await pool.query(
      `SELECT bu, "COMPANY CODE" AS company_code FROM company_list WHERE deleted IS NOT TRUE`
    );
    const shortToNumericBu = new Map();
    const numericToShortBu = new Map();
    for (const r of companyRows.rows) {
      const numericBu = r.company_code ? r.company_code.split("-")[2] : null;
      if (r.bu && numericBu) {
        shortToNumericBu.set(r.bu, numericBu);
        numericToShortBu.set(numericBu, r.bu);
      }
    }

    // Batch Query สถานะ TB ต่อ (BU, Account) — vat_reconcile_tb.bu เป็นเลข BU เสมอ ต้องแปลง
    // กลับเป็น Short Code ก่อนเทียบกับฝั่ง AP Cutting (ไม่งั้นจะไม่ Match กันเลย)
    const tbRows = await pool.query(
      `SELECT bu AS numeric_bu, account, COUNT(*) AS cnt, MAX(updated_at) AS last_activity
       FROM vat_reconcile_tb
       WHERE period = $1 AND account = ANY($2::text[])
       GROUP BY bu, account`,
      [period, accounts]
    );
    const tbMap = new Map(
      tbRows.rows.map((r) => [`${numericToShortBu.get(r.numeric_bu) || r.numeric_bu}|${r.account}`, { last: r.last_activity, cnt: parseInt(r.cnt, 10) }]) // MARKER_DASHBOARD_TB_COUNT_V1
    );

    // MARKER_DASHBOARD_DETAIL_SIGNAL_V1 — Detail of Overhead (ap_detailoverhead, source='ap_reconcile') ต่อ (COM, Account)
    // COM = Segment 3 ของ Flexfield -> แปลงเป็น Short Code ผ่าน numericToShortBu เดียวกับ TB (เทียบแบบตัดเลข 0 หน้าด้วย)
    const jvMap = new Map();
    try {
      const jvRows = await pool.query(
        `SELECT com, account_code AS account, COUNT(*) AS cnt
         FROM ap_detailoverhead
         WHERE period = $1 AND account_code = ANY($2::text[])
         GROUP BY com, account_code`,
        [period, accounts]
      );
      const stripZ = (v) => String(v == null ? "" : v).replace(/^0+/, "");
      const numByStripped = new Map([...numericToShortBu.entries()].map(([n, sh]) => [stripZ(n), sh]));
      for (const r of jvRows.rows) {
        const short = numericToShortBu.get(r.com) || numByStripped.get(stripZ(r.com)) || r.com;
        const k = `${short}|${r.account}`;
        jvMap.set(k, (jvMap.get(k) || 0) + parseInt(r.cnt, 10));
      }
    } catch (e) {
      console.warn("[apReconcile] dashboard detail signal skipped:", e.message); // ตารางยังไม่สร้าง -> ไม่ให้ Dashboard พัง
    }

    // MARKER_DASHBOARD_STATUS_AP_DRIVEN_ROWS_V1 — ผู้ใช้ยืนยันว่า BU ที่จะโชว์ในตาราง ต้อง
    // Trigger จาก AP Cutting เป็นหลักเท่านั้น (ไม่ใช่ Union กับ TB เหมือน V2 เดิม) เพราะ TB
    // มีโอกาสมีข้อมูลอยู่แล้วในหลาย BU/Account แทบทุกตัวเป็นปกติ (ไม่ผูกกับ Period) ในขณะที่
    // AP Cutting ผูกกับ Period จริงๆ — ถ้าเอา TB มา Union ด้วยจะทำให้เห็น BU ที่ไม่มี AP
    // ให้ Reconcile เลยในเดือนนี้โผล่มาปนด้วย ไม่ตรงกับของจริงที่ต้องทำ
    const buSet = new Set(cuttingRows.rows.map((r) => r.bu));

    const buRowsResult = [...buSet].sort().map((bu) => {
      const cells = {};
      let lastActivity = null;
      for (const account of accounts) {
        const key = `${bu}|${account}`;
        const cutting = cuttingMap.get(key);
        const tbEntry = tbMap.get(key) || null;
        const tbLast = tbEntry ? tbEntry.last : null;
        cells[account] = {
          count: cutting ? cutting.count : null,
          tbCount: tbEntry ? tbEntry.cnt : 0, // MARKER_DASHBOARD_TB_COUNT_V1 -- จำนวนบรรทัด TB ของ Account นี้ (Tooltip)
          tbActive: tbLast !== null,
          jvCount: jvMap.get(key) || 0, // MARKER_DASHBOARD_DETAIL_SIGNAL_V1
          exported: false,
        };
        for (const c of [cutting?.lastActivity, tbLast].filter(Boolean)) {
          if (!lastActivity || new Date(c) > new Date(lastActivity)) lastActivity = c;
        }
      }
      return { bu, cells, last_activity_at: lastActivity ? new Date(lastActivity).toISOString() : null };
    });

    // เรียงจาก Activity ล่าสุดขึ้นก่อน (ไม่มี Activity เลย -> ท้ายสุด เรียงตามชื่อ BU)
    buRowsResult.sort((a, b) => {
      if (a.last_activity_at && b.last_activity_at) return new Date(b.last_activity_at) - new Date(a.last_activity_at);
      if (a.last_activity_at) return -1;
      if (b.last_activity_at) return 1;
      return a.bu.localeCompare(b.bu);
    });

    res.json({ period, bu_rows: buRowsResult });
  } catch (err) {
    console.error("[apReconcile] dashboard status error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึงสถานะ Dashboard", detail: err.message });
  }
});

// MARKER_DASHBOARD_PERIODS_REAL_DB_V1 — ผู้ใช้ยืนยันว่า Dropdown PERIOD ต้อง Default เป็นค่าว่าง
// "-" เสมอ (ไม่ Auto-Fetch จน Users เลือกเอง) แล้ว List ตัวเลือกต้องดึงจาก DB จริงว่าตอนนี้มี
// Period ไหนที่มีข้อมูล ap_cutting_staging อยู่บ้าง (ไม่ใช่ List Hardcode ในโค้ด Frontend อีกต่อไป)
// ส่วน BUSINESS UNIT Dropdown ฝั่ง Frontend Filter ต่อจาก bu_rows ของ /dashboard/status?period=
// ที่ Fetch มาแล้วอยู่แล้ว (ตาม Period ที่เลือก) ไม่ต้องเพิ่ม Endpoint แยกสำหรับ BU
router.get("/periods", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT period FROM ap_cutting_staging WHERE period IS NOT NULL ORDER BY period DESC`
    );
    res.json({ periods: result.rows.map((r) => r.period) });
  } catch (err) {
    console.error("[apReconcile] periods list error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างดึงรายการ Period", detail: err.message });
  }
});

registerMenuPermissions(router); // MARKER_MENU_PERMISSION_CONFIG_BACKEND_V1 -- GET/PUT /menu-permissions
// MARKER_DASHBOARD_AP_CLEAR_V1 -- คลิกขวาจุด AP ใน Dashboard > ล้างข้อมูล: ลบ ap_cutting_staging ของ BU + Account + Period (ลบจริงใน DB | ไม่แตะ TB เพราะใช้ร่วมกับหน้า VAT)
router.delete("/dashboard/ap-data", async (req, res) => {
  try {
    const { bu, account, period } = req.query;
    if (!bu || !account || !period || !/^\d{4}-\d{2}$/.test(String(period))) return res.status(400).json({ error: "ต้องระบุ bu, account และ period (YYYY-MM)" });
    if (!TARGET_GL_ACCOUNTS.has(String(account))) return res.status(400).json({ error: "Account ไม่อยู่ในรายการ" });
    const del = await pool.query(
      `DELETE FROM ap_cutting_staging WHERE branch_cpc_key = $1 AND period = $2 AND gl_account = $3`,
      [String(bu), String(period), String(account)]
    );
    console.log(`[apReconcile] clear AP data bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "?"}`);
    res.json({ deleted: del.rowCount });
  } catch (err) {
    console.error("[apReconcile] clear AP data error:", err);
    res.status(500).json({ error: "ล้างข้อมูลไม่สำเร็จ", detail: err.message });
  }
});

// MARKER_APRECONCILE_STALE_AP_V1 -- (Owner เท่านั้น) รายการข้อมูล AP ที่ค้างหลังปิด Period: ap_cutting_staging ของ Period ที่ปิดแล้ว (<= system_settings.ap_period_month) แต่ BU + Account นั้นไม่มีไฟล์ที่ Confirm
//   ข้อมูลที่กรอกเข้ามาไม่ใช่ของ Period ปัจจุบันและไม่ได้ถูกนำไปใช้ (ไม่ Confirm) ระบบจึงไม่นับ Expired Date / ไม่ลบเอง -> Owner เลือกล้างเอง (ลบจริง | ไม่แตะ Detail of Overhead / DT / ไฟล์รายงาน)
const requireStaleOwner = (req, res) => {
  if (String(req.user?.appRole || "").toLowerCase() !== "owner") { res.status(403).json({ error: "เฉพาะ Owner เท่านั้น" }); return false; }
  return true;
};
async function getApClosedPeriod() {
  const q = await pool.query(`SELECT value FROM system_settings WHERE key = 'ap_period_month'`);
  const v = q.rows[0]?.value;
  return v && /^\d{4}-\d{2}$/.test(String(v)) ? String(v) : null;
}
const STALE_NOT_CONFIRMED_SQL = `NOT EXISTS (SELECT 1 FROM file_storage f WHERE f.module = 'ap-reconcile' AND f.bu = s.branch_cpc_key AND f.ref_id = s.gl_account || '|' || s.period || '|ap' AND f.confirmed_at IS NOT NULL AND f.status <> 'recycled')`;
router.get("/stale-data", async (req, res) => {
  try {
    if (!requireStaleOwner(req, res)) return;
    const closed = await getApClosedPeriod();
    if (!closed) return res.json({ closed_period: null, rows: [] });
    const q = await pool.query(
      `SELECT s.branch_cpc_key AS bu, s.period, s.gl_account AS account, COUNT(*)::int AS lines, MAX(s.imported_at) AS last_import,
              EXISTS (SELECT 1 FROM file_storage f WHERE f.module = 'ap-reconcile' AND f.bu = s.branch_cpc_key AND f.ref_id = s.gl_account || '|' || s.period || '|ap' AND f.status <> 'recycled') AS has_job
         FROM ap_cutting_staging s
        WHERE s.period <= $1 AND s.gl_account = ANY($2::text[]) AND s.branch_cpc_key IS NOT NULL AND ${STALE_NOT_CONFIRMED_SQL}
        GROUP BY s.branch_cpc_key, s.period, s.gl_account
        ORDER BY s.period DESC, s.branch_cpc_key, s.gl_account`,
      [closed, [...TARGET_GL_ACCOUNTS]]
    );
    res.json({ closed_period: closed, rows: q.rows });
  } catch (err) {
    console.error("[apReconcile] stale-data list error:", err);
    res.status(500).json({ error: "ดึงรายการข้อมูลค้างไม่สำเร็จ", detail: err.message });
  }
});
// body: { items: [{ bu, period, account, lines }] } -- ตรวจซ้ำทุกรายการตอนลบ: ยังเป็นของ Period ที่ปิดแล้ว + ยังไม่ Confirm + จำนวน Line ยังตรงกับที่ Owner เห็น (ไม่ตรง = ข้าม ไม่ลบ)
router.post("/stale-data/clear", async (req, res) => {
  try {
    if (!requireStaleOwner(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "ไม่ได้เลือกรายการ" });
    if (items.length > 500) return res.status(400).json({ error: "เลือกได้ไม่เกิน 500 รายการต่อครั้ง" });
    const closed = await getApClosedPeriod();
    if (!closed) return res.status(409).json({ error: "ยังไม่มี Period ที่ปิด" });
    const results = [];
    for (const it of items) {
      const bu = String(it?.bu || ""), period = String(it?.period || ""), account = String(it?.account || "");
      const seen = Number(it?.lines);
      if (!bu || !/^\d{4}-\d{2}$/.test(period) || !TARGET_GL_ACCOUNTS.has(account)) { results.push({ bu, period, account, status: "invalid" }); continue; }
      if (period > closed) { results.push({ bu, period, account, status: "skipped_not_closed" }); continue; }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const chk = await client.query(
          `SELECT COUNT(*)::int AS n FROM ap_cutting_staging s WHERE s.branch_cpc_key = $1 AND s.period = $2 AND s.gl_account = $3 AND ${STALE_NOT_CONFIRMED_SQL}`,
          [bu, period, account]
        );
        const n = chk.rows[0]?.n || 0;
        const confirmed = await client.query(`SELECT 1 FROM file_storage f WHERE f.module = 'ap-reconcile' AND f.bu = $1 AND f.ref_id = $2 AND f.confirmed_at IS NOT NULL AND f.status <> 'recycled' LIMIT 1`, [bu, `${account}|${period}|ap`]);
        if (confirmed.rows.length) { await client.query("ROLLBACK"); results.push({ bu, period, account, status: "skipped_confirmed" }); continue; }
        if (Number.isFinite(seen) && seen !== n) { await client.query("ROLLBACK"); results.push({ bu, period, account, status: "skipped_changed", lines_now: n }); continue; }
        const del = await client.query(`DELETE FROM ap_cutting_staging WHERE branch_cpc_key = $1 AND period = $2 AND gl_account = $3`, [bu, period, account]);
        await client.query("COMMIT");
        console.log(`[apReconcile] stale clear bu=${bu} period=${period} account=${account} deleted=${del.rowCount} by=${req.user?.email || "?"}`);
        results.push({ bu, period, account, status: "deleted", deleted: del.rowCount });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
        console.error("[apReconcile] stale clear item error:", bu, period, account, e.message);
        results.push({ bu, period, account, status: "error", error: e.message });
      } finally { client.release(); }
    }
    res.json({ deleted: results.filter((r) => r.status === "deleted").reduce((t, r) => t + (r.deleted || 0), 0), results });
  } catch (err) {
    console.error("[apReconcile] stale-data clear error:", err);
    res.status(500).json({ error: "ล้างข้อมูลไม่สำเร็จ", detail: err.message });
  }
});

// MARKER_DASHBOARD_DETAIL_OPERATION_V1 -- หน้ากาก Detail Operation: ดู/ลบ Detail of Overhead (ap_detailoverhead) ของ BU + Account + Period
//   ไม่ Auto Clear: ต้องส่งรายการแถวที่เลือกมาเอง | ลบจริงใน DB | ลบเฉพาะแถวที่ (ctid + row_hash) ตรงกับที่เห็นตอนเปิดหน้ากาก (ข้อมูลเปลี่ยน = ไม่ลบ) | บันทึกผู้ลบ+สำเนาแถวที่ลบลง Log ของ Server
async function resolveDetailComVariants(bu) {
  const r = await pool.query(`SELECT "COMPANY CODE" AS company_code FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE`, [String(bu)]);
  const out = new Set();
  for (const x of r.rows) {
    const n = x.company_code ? String(x.company_code).split("-")[2] : null;
    if (n) { out.add(n); out.add(n.replace(/^0+/, "")); }
  }
  return [...out].filter(Boolean);
}
router.get("/dashboard/detail", async (req, res) => {
  try {
    const { bu, account, period } = req.query;
    if (!bu || !account || !period || !/^\d{4}-\d{2}$/.test(String(period))) return res.status(400).json({ error: "ต้องระบุ bu, account และ period (YYYY-MM)" });
    if (!TARGET_GL_ACCOUNTS.has(String(account))) return res.status(400).json({ error: "Account ไม่อยู่ในรายการ" });
    const coms = await resolveDetailComVariants(bu);
    if (!coms.length) return res.json({ rows: [], total: 0, count: 0 });
    const q = await pool.query(
      `SELECT ctid::text AS rid, row_hash AS hash, branch_code, branch_name, cost_center, sub_account_code, to_char(transaction_date,'YYYY-MM-DD') AS tdate,
              journal_name, invoice_number, vendor_name, description, amount, contact_from_to, source
         FROM ap_detailoverhead WHERE com = ANY($1::text[]) AND period = $2 AND account_code = $3
        ORDER BY branch_code, sub_account_code, transaction_date, line_no`, [coms, String(period), String(account)]);
    const total = q.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    res.json({ rows: q.rows, count: q.rows.length, total });
  } catch (err) {
    console.error("[apReconcile] detail list error:", err);
    res.status(500).json({ error: "ดึง Detail ไม่สำเร็จ", detail: err.message });
  }
});
router.post("/dashboard/detail/delete", async (req, res) => {
  const client = await pool.connect();
  try {
    const { bu, account, period, items } = req.body || {};
    if (!bu || !account || !period || !/^\d{4}-\d{2}$/.test(String(period))) return res.status(400).json({ error: "ต้องระบุ bu, account และ period (YYYY-MM)" });
    if (!TARGET_GL_ACCOUNTS.has(String(account))) return res.status(400).json({ error: "Account ไม่อยู่ในรายการ" });
    if (!Array.isArray(items) || !items.length || items.length > 5000) return res.status(400).json({ error: "ต้องเลือกแถวที่จะลบ (1-5000 แถว)" });
    const rids = items.map((i) => String(i.rid || ""));
    if (rids.some((x) => !/^\(\d+,\d+\)$/.test(x))) return res.status(400).json({ error: "รายการแถวไม่ถูกต้อง" });
    const hashes = items.map((i) => (i.hash == null ? "" : String(i.hash)));
    const coms = await resolveDetailComVariants(bu);
    if (!coms.length) return res.status(404).json({ error: "ไม่พบ BU" });
    await client.query("BEGIN");
    const del = await client.query(
      `DELETE FROM ap_detailoverhead d USING unnest($1::tid[], $2::text[]) AS t(rid, h)
        WHERE d.ctid = t.rid AND COALESCE(d.row_hash,'') = t.h AND d.com = ANY($3::text[]) AND d.period = $4 AND d.account_code = $5
        RETURNING d.com, d.period, d.account_code, d.branch_code, d.cost_center, d.sub_account_code, d.transaction_date, d.journal_name, d.invoice_number, d.vendor_name, d.description, d.amount`,
      [rids, hashes, coms, String(period), String(account)]);
    if (del.rowCount !== items.length) { await client.query("ROLLBACK"); return res.status(409).json({ error: `ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้าจอ (ลบได้ ${del.rowCount} จาก ${items.length} แถว) — ไม่ได้ลบอะไร กรุณาเปิดใหม่`, code: "STALE" }); }
    await client.query("COMMIT");
    console.log(`[apReconcile] detail delete bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "?"} backup=${JSON.stringify(del.rows)}`);
    res.json({ deleted: del.rowCount });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
    console.error("[apReconcile] detail delete error:", err);
    res.status(500).json({ error: "ลบ Detail ไม่สำเร็จ", detail: err.message });
  } finally { client.release(); }
});

registerApReport(router); // MARKER_APRECONCILE_REPORT_V1 -- Preview / Export รายงานรายบัญชี

export default router;
