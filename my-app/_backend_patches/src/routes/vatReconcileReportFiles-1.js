import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { pool, getUsernameByEmail } from "../db.js";
import { buildOriginalWorkbook, buildPctWorkbook, writeSimpleOriginalSheet, simpleRowsToGroups } from "./vatReconcileOriginalWorkbook.js"; // MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1

// MARKER_VATRECONCILE_REPORT_CONFIRM_V1 -- Confirm ไฟล์รายงานก่อน Download / ส่ง SharePoint (Export ใหม่ทับไฟล์เดิม = ต้อง Confirm ใหม่)
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS confirmed_at timestamptz").catch((e) => console.error("[migrate file_storage.confirmed_at]", e.message));
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS input_expire_at timestamptz").catch((e) => console.error("[migrate file_storage.input_expire_at]", e.message));
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false").catch((e) => console.error("[migrate file_storage.is_draft]", e.message)); // MARKER_VATRECONCILE_FIRST_DRAFT_V1 -- First Draft = เก็บไฟล์ใน Backend เป็น Draft (ไม่ Confirm/Download/ส่ง SharePoint ได้)
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS draft_serial text").catch((e) => console.error("[migrate file_storage.draft_serial]", e.message)); // MARKER_VATRECONCILE_FIRST_DRAFT_SERIAL_V1 -- Draft = แถวแยก (Serial FD-BU-Account-YYYYMM-nnn) | Final เก็บ Serial ของ Draft ไว้ในคอลัมน์นี้
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS draft_note text").catch((e) => console.error("[migrate file_storage.draft_note]", e.message)); // Note ของไฟล์ Draft
const INPUT_KEEP_DAYS = Number(process.env.RECON_INPUT_KEEP_DAYS) || 60; // MARKER_VATRECONCILE_INPUT_EXPIRE_V1 -- Confirm = เริ่มนับวันหมดอายุของ Input (ยังไม่มีงานลบอัตโนมัติ)
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS fill_started_at timestamp").catch((e) => console.error("[migrate file_storage.fill_started_at]", e.message)); // MARKER_VATRECONCILE_USER_TRANSACTION_V1 -- เวลาเริ่มงาน (เลือก Period) -> 1 Save = 1 Job ในหน้า User Transaction
pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS confirmed_by text").catch((e) => console.error("[migrate file_storage.confirmed_by]", e.message));

// MARKER_VATRECONCILE_ACTIVITY_TS_V1 -- Timestamp การทำงานของ User ในหน้า Reconcile (งานที่นับเป็น Transaction ไม่ได้): PERIOD_SELECT, EXPIRED_REVIEWED, SAVE, CONFIRM, RELEASE, SP_SENT
pool.query(`CREATE TABLE IF NOT EXISTS vat_reconcile_activity_ts (
  id bigserial PRIMARY KEY, username text, event text NOT NULL, bu text, account text, period text, file_id text, created_at timestamptz NOT NULL DEFAULT NOW())`)
  .then(() => pool.query("CREATE INDEX IF NOT EXISTS idx_vrats_user_time ON vat_reconcile_activity_ts (username, created_at)"))
  .catch((e) => console.error("[migrate vat_reconcile_activity_ts]", e.message));
pool.query("ALTER TABLE vat_reconcile_activity_ts ADD COLUMN IF NOT EXISTS note text").catch((e) => console.error("[migrate vat_reconcile_activity_ts.note]", e.message)); // MARKER_VATRECONCILE_DRAFT_NOTE_TS_V1
function logActivityTs(username, event, { bu = null, account = null, period = null, fileId = null, note = null } = {}) {
  pool.query("INSERT INTO vat_reconcile_activity_ts (username, event, bu, account, period, file_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [username || null, event, bu, account, period, fileId, note])
    .catch((e) => console.error("[activity-ts] insert error:", e.message));
}
const ACTIVITY_TS_CLIENT_EVENTS = new Set(["PERIOD_SELECT", "EXPIRED_REVIEWED"]);
const refParts = (refId) => { const [account, period] = String(refId || "").split("|"); return { account: account || null, period: period || null }; };

// MARKER_VATRECONCILE_TIMELINE_SYNC_V1 -- Backend อัปเดต Timeline (timeline_progress) เอง เมื่อ Draft / Note / Confirm / Release / Delete ไฟล์รายงาน
//   First Draft -> ช่อง First Draft Input = D | Note Draft -> Note ช่อง First Draft | Confirm -> Final + First = D | Release -> Final = P (First = P ถ้าไม่มี Draft ค้ำ) | Delete -> ย้อนทั้งหมด
//   Tax Code ที่ Finish = Tax Type ที่มีข้อมูลจริงของ BU+Account+Period (751->M, 752->N/A, 755->T/F) เฉพาะช่องที่ Enable | ไม่มีแถว Timeline ของ Period นั้น (งวดย้อนหลัง) = ข้ามเงียบๆ
const TL_DEFAULT_CODES = { "11610751": ["M"], "11610752": ["N", "A"], "11610755": ["T", "F"] };
async function tlCodesFor(bu, account, period) {
  let accCodes = TL_DEFAULT_CODES[String(account)] || [];
  try {
    const m = await pool.query(`SELECT tax_type FROM recon_tax_type_map WHERE account = $1 AND enabled IS TRUE`, [String(account)]);
    if (m.rows.length) accCodes = m.rows.map((r) => String(r.tax_type).toUpperCase());
  } catch (e) { /* ยังไม่มีตาราง -> ใช้ค่า Default */ }
  if (!accCodes.length) return [];
  try {
    const c = await pool.query(`SELECT split_part("COMPANY CODE", '-', 3) AS nb FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE LIMIT 1`, [bu]);
    const nb = c.rows[0]?.nb;
    if (nb) {
      const d = await pool.query(
        `SELECT DISTINCT tt FROM (
           SELECT upper(btrim(tax_type)) AS tt FROM vat_reconcile_input_summary WHERE bu = $1 AND period = $2 AND reconcile_account = $3
           UNION ALL
           SELECT upper(btrim(tax_type_code)) AS tt FROM vat_reconcile_simple_header WHERE bu = $1 AND period = $2 AND reconcile_account = $3
         ) x WHERE tt IS NOT NULL`,
        [nb, period, String(account)]
      );
      const have = d.rows.map((r) => r.tt).filter((t) => accCodes.includes(t));
      if (have.length) return have;
    }
  } catch (e) { console.error("[timeline-sync] tlCodesFor:", e.message); }
  return accCodes; // ไม่มีข้อมูลให้ตัดสิน -> ทุกรหัสของ Account (ช่อง X/ND ถูกข้ามอยู่แล้ว)
}
async function tlLoad(bu, period) {
  const q = await pool.query(`SELECT id, state FROM timeline_progress WHERE period_ym = $1 AND bu = $2 LIMIT 1`, [period, bu]);
  const row = q.rows[0];
  if (!row) return null;
  let st = row.state;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch (e) { return null; } }
  if (!st || typeof st !== "object" || !st.rpt || !st.rpt.first) return null;
  return { id: row.id, st: JSON.parse(JSON.stringify(st)) };
}
async function tlSave(row, st, by, bu, period) {
  await pool.query(`UPDATE timeline_progress SET state = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [JSON.stringify(st), by || "", row.id]);
  try {
    if (global._wss) {
      const msg = JSON.stringify({ event: "timeline_progress_updated", period_ym: period, bus: [bu], by: by || "" });
      global._wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
    }
  } catch (e) { /* ไม่กระทบงานหลัก */ }
}
async function tlSyncFirstDraft({ bu, account, period, finish, finishFinal, note, by }) {
  try {
    if (!bu || !account || !period) return;
    const row = await tlLoad(bu, period);
    if (!row) return;
    const codes = await tlCodesFor(bu, account, period);
    const st = row.st; let changed = false;
    codes.forEach((c) => {
      const cell = st.rpt.first[c];
      if (!cell || cell.inp === "X") return;
      if ((finish || finishFinal) && cell.inp === "P") { cell.inp = "D"; changed = true; }
      if (finishFinal) {
        const fc = st.rpt.final && st.rpt.final[c];
        if (fc && fc.inp === "P") { fc.inp = "D"; changed = true; }
      }
      const t = String(note || "").trim();
      if (t) {
        const key = `first:${c}:inp`;
        const arr = Array.isArray(st.rnotes && st.rnotes[key]) ? st.rnotes[key] : [];
        if (!arr.length || arr[0].text !== t) { st.rnotes = { ...(st.rnotes || {}), [key]: [{ text: t, by: by || "", at: new Date().toISOString() }, ...arr].slice(0, 100) }; changed = true; }
      }
    });
    if (changed) await tlSave(row, st, by, bu, period);
  } catch (e) { console.error("[timeline-sync] first draft:", e.message); }
}
async function tlSyncRevert({ bu, account, period, wasDraft, remainDraft, remainFinal, note, by, releaseOnly }) {
  try {
    if (!bu || !account || !period) return;
    const row = await tlLoad(bu, period);
    if (!row) return;
    const codes = await tlCodesFor(bu, account, period);
    const st = row.st; let changed = false;
    codes.forEach((c) => {
      const fi = st.rpt.first[c]; const fn = st.rpt.final && st.rpt.final[c];
      if (!fi) return;
      if (releaseOnly) {
        if (fn && fn.inp === "D") { fn.inp = "P"; changed = true; }
        if (!remainDraft && fi.inp === "D") { fi.inp = "P"; changed = true; }
        return;
      }
      if (wasDraft) {
        if (!remainDraft && !remainFinal && fi.inp === "D") { fi.inp = "P"; changed = true; }
        const t = String(note || "").trim(); const key = `first:${c}:inp`;
        const arr = Array.isArray(st.rnotes && st.rnotes[key]) ? st.rnotes[key] : [];
        if (t && !remainDraft && arr.some((n) => n && n.text === t)) {
          const next = arr.filter((n) => !(n && n.text === t)); const rn = { ...(st.rnotes || {}) };
          if (next.length) rn[key] = next; else delete rn[key];
          st.rnotes = rn; changed = true;
        }
      } else if (!remainFinal) {
        if (fn && fn.inp === "D") { fn.inp = "P"; changed = true; }
        if (!remainDraft && fi.inp === "D") { fi.inp = "P"; changed = true; }
      }
    });
    if (changed) await tlSave(row, st, by, bu, period);
  } catch (e) { console.error("[timeline-sync] revert:", e.message); }
}
// ไฟล์ที่เหลือของ BU+Account+Period (ไม่นับ excludeId) -> { remainDraft, remainFinal }
async function tlRemain(bu, refId, excludeId) {
  const refBase = String(refId || "").split("|").slice(0, 2).join("|");
  const q = await pool.query(
    `SELECT COALESCE(is_draft,false) AS d, COUNT(*)::int AS n FROM file_storage WHERE module=$1 AND bu=$2 AND (ref_id=$3 OR ref_id LIKE $4) AND id <> $5 GROUP BY 1`,
    [REPORT_FILE_MODULE, bu, refBase, refBase + "|%", excludeId]
  );
  return { remainDraft: q.rows.some((r) => r.d && r.n > 0), remainFinal: q.rows.some((r) => !r.d && r.n > 0) };
}

// MARKER_VATRECONCILE_REPORT_FILES_V1 -- ไฟล์นี้แยก Source ออกจาก vatReconcile.js (mount ผ่าน router.use ใน vatReconcile.js)
/**
 * ที่เก็บไฟล์รายงานภาษี (Zone ล่างของ VAT Reconcile Dashboard) -- ใช้ตาราง file_storage ของระบบเดิม เก็บถาวร
 *   POST /vat-reconcile/dashboard/report-files/export   body {bu, account, period} -> สร้าง .xlsx จาก Reconcile Report แล้วเก็บ
 *   GET  /vat-reconcile/dashboard/report-files?bu=&period=                          -> รายการไฟล์ (Zone ล่างโชว์เฉพาะ Period ที่เลือก)
 *   GET  /vat-reconcile/dashboard/report-files/:id/download                         -> ดาวน์โหลด
 * file_storage: module='vat-reconcile-report' | ref_id='{account}|{YYYY-MM}' | retention_days=NULL (ถาวร Cron ไม่แตะ)
 * Disk: {STORAGE_ROOT}/{BU}/{YYYY-MM}/vat-reconcile-report/{account}.xlsx  (STORAGE_ROOT เดียวกับ fileStorage.js)
 * ประหยัดพื้นที่: 1 ไฟล์ต่อ (BU, Account, Period) -- Export ซ้ำทับไฟล์เดิม ไม่สะสม | .xlsx เป็น ZIP อยู่แล้วจึงไม่ Gzip ซ้ำ แต่บีบ DEFLATE ระดับสูงสุด
 * (หน้า Folder เก็บถาวรใน VAT Controller จะออกแบบต่อในขั้นถัดไป -- ข้อมูลพร้อมแล้วเพราะแยก BU/Period ตั้งแต่ Disk)
 */
const REPORT_FILE_MODULE = "vat-reconcile-report";
const REPORT_STORAGE_ROOT = process.env.FILE_STORAGE_ROOT || "C:\\apps\\fastapn-backend\\storage";
// MARKER_VATRECONCILE_EXPORT_FILENAME_V1 -- ชื่อไฟล์ตาม Pattern ไฟล์ Reconcile จริง: {เลข BU}_{BU}_{Account}_{MON-YY}.xlsx เช่น 3218_BTM_11610752_NOV-25.xlsx
const REPORT_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const reportMonYY = (period) => { const [y, mo] = String(period).split("-"); return `${REPORT_MONTHS[(Number(mo) || 1) - 1]}-${String(y).slice(-2)}`; };

// MARKER_VATRECONCILE_SP_SENT_V1 -- บันทึกว่าไฟล์ถูกส่งไป SharePoint แล้ว (Handler ย้ายไฟล์เข้า OneDrive ที่ฝั่งเครื่องผู้ใช้)
// ปลายทาง: {SP_REPORT_BASE}/{เลข BU}/{YYYY.MM}/{ชื่อไฟล์}?web=1 -- เลข BU + เดือน อ่านจากชื่อไฟล์ {เลข BU}_{BU}_{Account}_{MON-YY}.xlsx (อ่านไม่ได้ = ไม่บันทึก)
// สำเนาบน Server เก็บ 30 วันหลังส่ง แล้ว Cron (fileStorage.js) ลบเฉพาะไฟล์ เก็บ Row ไว้แสดงลิงก์ SharePoint
const SP_REPORT_BASE = process.env.SP_REPORT_BASE || "https://centralgroup.sharepoint.com/sites/FAST/AP%20Non%20Merchandise/VAT%20Controller/My%20System/Z_Report%20Reconcile";
function parseSpTarget(fileName) {
  const m = /^(\d{3,6})_.+_([A-Za-z]{3})-(\d{2})\.xlsx$/.exec(String(fileName || ""));
  if (!m) return null;
  const mi = REPORT_MONTHS.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  const buCode = m[1], period = `20${m[3]}.${String(mi + 1).padStart(2, "0")}`;
  const url = `${SP_REPORT_BASE}/${encodeURIComponent(buCode)}/${period}/${encodeURIComponent(fileName)}?web=1`;
  return { buCode, period, url };
}

// เรียก Handler ของ reconcile-report ภายใน (ไม่ผ่าน HTTP) -- คืน {status, body}
function makeReconInvoke(reconcileReportHandler) {
  return function reconInvoke(query) {
  return new Promise((resolve) => {
    let code = 200;
    const res = {
      status(c) { code = c; return res; },
      json(b) { resolve({ status: code, body: b }); return res; },
    };
    reconcileReportHandler({ query }, res).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });
}
}

// MARKER_VATRECONCILE_EXPORT_SOURCES_V1
// ชีตต้นทางตามไฟล์ Reconcile จริง: Detail (100%) / A-Detail (AVG), Pivot (100%), TB, Simple Excel BU / Simple AVG
function addSourceSheets(wb, rep) {
  const src = rep.sources;
  if (!src) return;
  const NUM = "#,##0.00;[Red]-#,##0.00;-";
  const border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F8" } };
  const addTable = (name, headers, rows, widths, numCols) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers).eachCell((c) => { c.font = { bold: true }; c.fill = headFill; c.border = border; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
    rows.forEach((r) => {
      const row = ws.addRow(r.values);
      row.eachCell({ includeEmpty: true }, (c, i) => {
        c.border = border;
        if (numCols.includes(i)) c.numFmt = NUM;
        if (r.bold) { c.font = { bold: true }; c.fill = headFill; }
        if (r.red && i === r.red) c.font = { color: { argb: "FFCF222E" }, bold: true };
      });
    });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return ws;
  };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Detail / A-Detail
  const isAvg = rep.template === "avg";
  const dh = ["Branch", "Receive Date", "GRT No", "Tax Invoice Date", "Tax Invoice No", "Vendor Name", "Tax ID", "HO", "Branch", "Item Detail",
    "Paid Amount", "Paid VAT", "Claim Amount", "Claim VAT", "Calculate Tax"];
  if (!isAvg) dh.push("Check (Amt×7%−Claim VAT)", "Status");
  const drows = (src.detail || []).map((d) => {
    const vals = [d.branch, d.receive_date, d.grt_no, d.tax_invoice_date, d.tax_invoice_no, d.vendor_name, d.tax_id, d.ho, d.branch_field, d.item_detail,
      d.paid_amount, d.paid_vat, d.claimed100_amount, d.claimed100_vat, d.calculate_tax];
    let red = 0;
    if (!isAvg) {
      const chk = r2((Number(d.paid_amount) || 0) * 7 / 100 - (Number(d.claimed100_vat) || 0));
      const unb = Math.abs(chk) > 0.05;
      vals.push(chk, unb ? "Unbalance" : "Balance");
      if (unb) red = 17;
    }
    return { values: vals, red };
  });
  addTable(isAvg ? "A-Detail" : "Detail", dh, drows, [10, 12, 14, 14, 18, 36, 16, 8, 8, 30, 15, 15, 15, 15, 14, 18, 12], [11, 12, 13, 14, 15, 16]);

  // Pivot (100%)
  if (!isAvg) {
    const pv = new Map();
    (src.detail || []).forEach((d) => {
      const p = pv.get(d.branch) || { amt: 0, vat: 0 };
      p.amt += Number(d.paid_amount) || 0; p.vat += Number(d.paid_vat) || 0; pv.set(d.branch, p);
    });
    const prow = [...pv.keys()].sort().map((b) => ({ values: [b, r2(pv.get(b).amt), r2(pv.get(b).vat)] }));
    prow.push({ values: ["Grand Total", r2([...pv.values()].reduce((s, p) => s + p.amt, 0)), r2([...pv.values()].reduce((s, p) => s + p.vat, 0))], bold: true });
    addTable("Pivot", ["Branch", "Sum of Paid Amount", "Sum of Paid VAT"], prow, [14, 20, 20], [2, 3]);
  }

  // TB
  const trows = (src.tb || []).map((t) => ({ values: [t.branch, t.cpc, t.subacc, t.description, t.ending_balance] }));
  trows.push({ values: ["Total", "", "", "", r2((src.tb || []).reduce((s, t) => s + (Number(t.ending_balance) || 0), 0))], bold: true });
  addTable("TB", ["Branch", "CPC", "SubAcc", "Description", "Ending Balance"], trows, [12, 10, 12, 36, 18], [5]);

  // Simple (ถ้ามี) -- MARKER_VATRECONCILE_SIMPLE_REPORT_FORMAT_BACK_V21: Layout ตามไฟล์ Simple_Report_Vat ต้นฉบับ
  const sim = src.simple || [];
  if (sim.length) {
    const sws = wb.addWorksheet(isAvg ? "Simple AVG" : "Simple Excel BU");
    writeSimpleOriginalSheet(sws, simpleRowsToGroups(sim, isAvg ? "AVG" : "100"), { buCode: rep.buCode && rep.buCode.short, zoom: 70 });
  }
}


// MARKER_VATRECONCILE_FILE_PREVIEW_BACK_V10
const PV_MAX_ROWS = 3000, PV_MAX_COLS = 40;
const PV_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pvArgb(c) { return c && typeof c.argb === "string" && c.argb.length >= 6 ? "#" + c.argb.slice(-6) : null; }
function pvFmtNum(n, nf) {
  if (!nf || nf === "General") return Number.isInteger(n) ? String(n) : String(+n.toFixed(10));
  if (nf === "@") return String(n);
  const secs = nf.split(";");
  const pos = secs[0];
  const pct = /%/.test(pos);
  const dm = /0\.(0+)/.exec(pos);
  const dec = dm ? dm[1].length : 0;
  let v = Math.abs(n) * (pct ? 100 : 1);
  if (n === 0 && secs[2] && /-/.test(secs[2])) return { t: "-", neg: false };
  let t = v.toFixed(dec);
  if (/#,##0/.test(pos)) t = Number(t).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (pct) t += "%";
  if (n < 0) {
    const negSec = secs[1] || "";
    const parens = /\(/.test(negSec) || (!secs[1] && /_\)/.test(pos));
    return { t: parens ? `(${t})` : `-${t}`, neg: /\[Red\]/i.test(negSec) };
  }
  return { t, neg: false };
}
function pvText(v, nf) {
  if (v == null) return { t: "" };
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) return pvText(v.result === undefined ? null : v.result, nf);
    if (v.richText) return { t: v.richText.map((x) => x.text).join("") };
    if (v.text != null) return { t: String(v.text) };
    if (v.error) return { t: String(v.error) };
    return { t: "" };
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { t: "" };
    const d = String(v.getUTCDate()), y = v.getUTCFullYear();
    if (nf && /yy/i.test(nf)) return { t: `${d}-${PV_MON[v.getUTCMonth()]}-${String(y).slice(-2)}`, c: 1 };
    return { t: `${y}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${d.padStart(2, "0")}`, c: 1 };
  }
  if (typeof v === "number") { const r = pvFmtNum(v, nf); return typeof r === "string" ? { t: r, n: 1 } : { t: r.t, n: 1, red: r.neg }; }
  if (typeof v === "boolean") return { t: v ? "TRUE" : "FALSE" };
  return { t: String(v) };
}
const PV_BSTYLE = { thin: "1px solid", medium: "2px solid", thick: "3px solid", double: "3px double", hair: "1px dotted", dotted: "1px dotted", dashed: "1px dashed" };
function pvCss(cell, extra) {
  const css = [];
  const f = cell.font || {};
  if (f.bold || (extra && extra.bold)) css.push("font-weight:700");
  if (f.italic) css.push("font-style:italic");
  const fc = pvArgb(f.color) || (extra && extra.color);
  if (fc) css.push(`color:${fc}`);
  if (f.size) css.push(`font-size:${Math.round(f.size * 1.2 * 10) / 10}px`);
  if (f.name) css.push(`font-family:"${f.name}",Tahoma,sans-serif`);
  const fl = cell.fill;
  const bg = (extra && extra.bg) || (fl && fl.type === "pattern" && fl.pattern === "solid" ? pvArgb(fl.fgColor) : null);
  if (bg) css.push(`background:${bg}`);
  const al = cell.alignment || {};
  if (al.horizontal) css.push(`text-align:${al.horizontal === "centerContinuous" ? "center" : al.horizontal}`);
  if (al.vertical) css.push(`vertical-align:${al.vertical === "center" ? "middle" : al.vertical}`);
  if (al.wrapText) css.push("white-space:pre-wrap");
  const b = (extra && extra.border) || cell.border || {};
  for (const [k, side] of [["top", "top"], ["left", "left"], ["bottom", "bottom"], ["right", "right"]]) {
    const x = b[k];
    if (x && x.style) css.push(`border-${side}:${PV_BSTYLE[x.style] || "1px solid"} ${pvArgb(x.color) || "#000"}`);
  }
  return css.join(";");
}

// MARKER_VATRECONCILE_CF_COLORS_BACK_V13
const PV_THEME = [0xFFFFFF, 0x000000, 0xE7E6E6, 0x44546A, 0x4472C4, 0xED7D31, 0xA5A5A5, 0xFFC000, 0x5B9BD5, 0x70AD47];
function pvCfColor(c) {
  if (!c) return null;
  if (typeof c.argb === "string" && c.argb.length >= 6) return "#" + c.argb.slice(-6);
  if (typeof c.theme === "number" && PV_THEME[c.theme] != null) {
    const t = c.tint || 0, base = PV_THEME[c.theme];
    const ch = [(base >> 16) & 255, (base >> 8) & 255, base & 255].map((v) => Math.max(0, Math.min(255, Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t))));
    return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return null;
}
function pvRange(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref).split(" ")[0]);
  if (!m) return null;
  const cn = (L) => L.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: cn(m[1]), r1: Number(m[2]), c2: cn(m[3] || m[1]), r2: Number(m[4] || m[2]), cn };
}
function pvCfPlan(ws) {
  const plan = [];
  for (const cf of ws.conditionalFormattings || []) {
    const rg = pvRange(cf.ref);
    if (!rg) continue;
    for (const rule of cf.rules || []) plan.push({ rg, rule, pr: rule.priority == null ? 9999 : rule.priority });
  }
  return plan.sort((a, b) => a.pr - b.pr);
}
function pvCfEval(plan, ws, r, c, valueOf) {
  const out = {};
  for (const { rg, rule } of plan) {
    if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2) continue;
    const v = valueOf(r, c);
    let hit = false;
    const f0 = rule.formulae && rule.formulae[0];
    if (rule.type === "cellIs") {
      const n = Number(typeof v === "number" ? v : NaN), x = Number(f0);
      if (Number.isFinite(n) && Number.isFinite(x)) hit = ({ lessThan: n < x, lessThanOrEqual: n <= x, greaterThan: n > x, greaterThanOrEqual: n >= x, equal: n === x, notEqual: n !== x })[rule.operator] === true;
    } else if (rule.type === "containsText") {
      hit = rule.text != null && String(v == null ? "" : v).toLowerCase().includes(String(rule.text).toLowerCase());
    } else if (rule.type === "expression" && typeof f0 === "string") {
      const m = /^\$([A-Z]+)(\d+)\s*=\s*"(.*)"$/.exec(f0.replace(/^=/, ""));
      if (m) {
        const rr = r - rg.r1 + Number(m[2]);
        const vv = valueOf(rr, rg.cn(m[1]));
        hit = String(vv == null ? "" : vv).toLowerCase() === m[3].toLowerCase();
      }
    }
    if (!hit) continue;
    const st = rule.style || {};
    const fc = pvCfColor(st.font && st.font.color);
    if (fc && !out.color) out.color = fc;
    if (st.font && st.font.bold && !out.bold) out.bold = true;
    const bg = st.fill && pvCfColor(st.fill.bgColor || st.fill.fgColor);
    if (bg && !out.bg) out.bg = bg;
    if (st.border && !out.border) out.border = st.border;
    if (rule.stopIfTrue) break;
  }
  return out;
}
async function pvLoadSheets(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const styles = [""];
  const styleIdx = new Map([["", 0]]);
  const sid = (css) => { if (!styleIdx.has(css)) { styleIdx.set(css, styles.length); styles.push(css); } return styleIdx.get(css); };
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const maxRow = Math.min(ws.rowCount || 0, PV_MAX_ROWS);
    const maxCol = Math.min(ws.columnCount || 1, PV_MAX_COLS);
    const cfPlan = pvCfPlan(ws);
    const valOf = (rr, cc) => { const v = ws.getRow(rr).getCell(cc).value; return v && typeof v === "object" && !(v instanceof Date) && "formula" in v ? v.result : v && typeof v === "object" && v.richText ? v.richText.map((x) => x.text).join("") : v; };
    const cols = [], hidden = [];
    for (let c = 1; c <= maxCol; c++) {
      const col = ws.getColumn(c);
      cols.push(Math.round(((col.width || 9) * 7 + 5)));
      hidden.push(!!col.hidden);
    }
    const merges = (ws.model.merges || []).map((m) => {
      const [a, z] = String(m).split(":");
      const pa = ws.getCell(a), pz = ws.getCell(z || a);
      return [Number(pa.row), Number(pa.col), Number(pz.row), Number(pz.col)];
    });
    // MARKER_VATRECONCILE_PREVIEW_CENTER_CONTINUOUS_V1 -- Excel "Center Across Selection": ข้อความอยู่ Cell แรก จัดกลางข้ามช่องว่างที่ตั้งค่าเดียวกันไปทางขวา -- Preview ไม่รองรับเอง จึงแปลงเป็น Merge เฉพาะตอนแสดงผล (ไฟล์จริงไม่เปลี่ยน)
    {
      const mset = new Set();
      merges.forEach(([r1, c1, r2, c2]) => { for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) mset.add(`${rr}:${cc}`); });
      for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
          const cell = row.getCell(c);
          if (!cell.alignment || cell.alignment.horizontal !== "centerContinuous" || mset.has(`${r}:${c}`)) continue;
          if (!pvText(cell.value, cell.numFmt).t) continue;
          let e = c;
          while (e + 1 <= maxCol) {
            const nx = row.getCell(e + 1);
            if (pvText(nx.value, nx.numFmt).t || !nx.alignment || nx.alignment.horizontal !== "centerContinuous" || mset.has(`${r}:${e + 1}`)) break;
            e++;
          }
          if (e > c) { merges.push([r, c, r, e]); for (let k = c; k <= e; k++) mset.add(`${r}:${k}`); c = e; }
        }
      }
    }
    const rows = [];
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        const nf = cell.numFmt;
        const tx = pvText(cell.value, nf);
        const extra = pvCfEval(cfPlan, ws, r, c, valOf);
        if (tx.red && !extra.color) extra.color = "#ff0000";
        const css = pvCss(cell, extra);
        if (!tx.t && !css) continue;
        cells.push([c, tx.t, sid(css), tx.n ? 1 : 0]);
      }
      rows.push({ r, h: row.height ? Math.round(row.height * 1.333) : 0, cells });
    }
    const v = (ws.views && ws.views[0]) || {};
    sheets.push({ name: ws.name, cols, hidden, merges, rows, grid: v.showGridLines !== false, truncated: (ws.rowCount || 0) > PV_MAX_ROWS, totalRows: ws.rowCount || 0 });
  });
  return { sheets, styles };
}


// MARKER_VATRECONCILE_DYNAMIC_FORMULA_BACK_V12
// ExcelJS ไม่รองรับ Dynamic-Array (cm="1") -- เติมเองหลังเขียนไฟล์: cell ที่เป็น <f t="array"> ได้ cm="1" + เพิ่ม xl/metadata.xml (XLDAPR) -> Excel เปิดแล้วไม่มี "@" และไม่มีปีกกา {} (เหมือนใช้ Formula2)
async function markDynamicArrayFormulas(buf) {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    let any = false;
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      const xml = await zip.file(name).async("string");
      const out = xml.replace(/<c ([^>]*?)>(<f t="array" ref="[A-Z]+\d+")/g, (m, attrs, f) => (/\bcm=/.test(attrs) ? m : (any = true, `<c ${attrs} cm="1">${f}`)));
      if (out !== xml) zip.file(name, out);
    }
    if (!any) return buf;
    zip.file("xl/metadata.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`);
    let ct = await zip.file("[Content_Types].xml").async("string");
    if (!ct.includes("/xl/metadata.xml")) ct = ct.replace("</Types>", `<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>`);
    zip.file("[Content_Types].xml", ct);
    let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    if (!rels.includes("sheetMetadata")) rels = rels.replace("</Relationships>", `<Relationship Id="rIdMetaDA1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>`);
    zip.file("xl/_rels/workbook.xml.rels", rels);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  } catch (e) {
    console.warn("[vatReconcile] markDynamicArrayFormulas ข้าม:", e.message);
    return buf;
  }
}

async function buildReconcileWorkbook(rep, bu, period) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FASTAPN Link3ase";
  wb.created = new Date();
  const NUM = "#,##0.00;[Red]-#,##0.00;-";
  const border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F8" } };
  const nPairs = rep.pairLabels.length;
  const lastCol = 2 + nPairs * 2 + 3;

  // ── Sheet: Report ──
  const ws = wb.addWorksheet(rep.sheet);
  const titleLines = [rep.header.title, rep.header.company, rep.header.taxId ? `เลขประจำตัวผู้เสียภาษี ${rep.header.taxId}` : "", `ประจำเดือน ${rep.header.periodLabel}`];
  titleLines.forEach((t, i) => {
    ws.mergeCells(i + 1, 1, i + 1, lastCol);
    const c = ws.getCell(i + 1, 1);
    c.value = t; c.alignment = { horizontal: "center" }; c.font = { bold: i === 0, size: i === 0 ? 14 : 11 };
  });
  ws.getCell(5, 1).value = `Account ${rep.account}${rep.accountName ? " · " + rep.accountName : ""}`;
  ws.getCell(5, 1).font = { bold: true };
  if (rep.checkDiff && rep.checkDiff.applicable) {
    ws.getCell(5, lastCol).value = `Check Diff: ${rep.checkDiff.text}`;
    ws.getCell(5, lastCol).font = { bold: true, color: { argb: rep.checkDiff.unbalance ? "FFCF222E" : "FF1A7F37" } };
    ws.getCell(5, lastCol).alignment = { horizontal: "right" };
  }
  const H1 = 6, H2 = 7;
  ws.mergeCells(H1, 1, H2, 1); ws.getCell(H1, 1).value = "รหัสสาขา";
  ws.mergeCells(H1, 2, H2, 2); ws.getCell(H1, 2).value = "สาขา";
  rep.pairLabels.forEach((p, i) => {
    const c0 = 3 + i * 2;
    ws.mergeCells(H1, c0, H1, c0 + 1); ws.getCell(H1, c0).value = p;
    ws.getCell(H2, c0).value = "มูลค่า"; ws.getCell(H2, c0 + 1).value = "ภาษี";
  });
  const tbCol = 3 + nPairs * 2;
  ws.getCell(H1, tbCol).value = "ภาษีตาม T/B"; ws.getCell(H2, tbCol).value = rep.tbLabel;
  ws.mergeCells(H1, tbCol + 1, H2, tbCol + 1); ws.getCell(H1, tbCol + 1).value = "ผลต่าง";
  ws.mergeCells(H1, tbCol + 2, H2, tbCol + 2); ws.getCell(H1, tbCol + 2).value = "NOTE/STATUS";
  for (let r = H1; r <= H2; r++) for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(r, c); cell.fill = headFill; cell.border = border; cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  let r = H2 + 1;
  rep.rows.forEach((row) => {
    const vals = [row.branch, row.name];
    row.pairs.forEach((p) => { vals.push(p[0], p[1]); });
    vals.push(row.tb, row.diff, row.status);
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1); cell.value = v; cell.border = border;
      if (i >= 2 && i < lastCol - 1) cell.numFmt = NUM;
      if (i === lastCol - 1) { cell.alignment = { horizontal: "center" }; cell.font = { color: { argb: v === "ตรงกัน" ? "FF1A7F37" : "FFCF222E" } }; }
    });
    r++;
  });
  // Total (ตามไฟล์จริง: 100% = SUBTOTAL(9), AVG = SUM) -- ใช้สูตรเพื่อให้แก้ตัวเลขใน Excel ต่อได้
  const first = H2 + 1, lastData = r - 1;
  const fn = rep.template === "avg" ? "SUM" : "SUBTOTAL(9,";
  ws.getCell(r, 1).value = "Total"; ws.mergeCells(r, 1, r, 2);
  for (let c = 3; c <= lastCol - 1; c++) {
    const col = ws.getColumn(c).letter;
    const cell = ws.getCell(r, c);
    const f = lastData >= first ? (rep.template === "avg" ? `SUM(${col}${first}:${col}${lastData})` : `SUBTOTAL(9,${col}${first}:${col}${lastData})`) : "0";
    let result = 0;
    if (c < tbCol) { const pi = Math.floor((c - 3) / 2), vi = (c - 3) % 2; result = rep.totals.pairs[pi][vi]; }
    else if (c === tbCol) result = rep.totals.tb; else result = rep.totals.diff;
    cell.value = { formula: f, result }; cell.numFmt = NUM;
  }
  for (let c = 1; c <= lastCol; c++) { const cell = ws.getCell(r, c); cell.font = { bold: true }; cell.fill = headFill; cell.border = border; }
  void fn;
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 30;
  for (let c = 3; c <= lastCol - 1; c++) ws.getColumn(c).width = 16;
  ws.getColumn(lastCol).width = 14;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: H2 }];

  // ── Sheet: Cover ──
  const cv = wb.addWorksheet("Cover");
  cv.getColumn(1).width = 34; cv.getColumn(2).width = 20;
  const lines = [
    ["Reconcile VAT", `${rep.header.company} · ${rep.header.periodLabel}`],
    ["Account", `${rep.account}${rep.accountName ? " · " + rep.accountName : ""}`],
    ["Template", rep.template === "avg" ? "เฉลี่ย (AVG)" : rep.template === "pct" ? "หัว %" : rep.template === "100_simple" ? "100% + Simple" : "100%"],
    ["Per TB", rep.cover.perTb],
    ["Per Detail", rep.cover.perDetail],
    ["Diff", rep.cover.diff],
  ];
  if (rep.cover.finCredit != null) { lines.push(["Detail of FinCredit 46250", rep.cover.finCredit]); lines.push(["Cover Diff", rep.cover.coverDiff]); }
  if (rep.checkDiff && rep.checkDiff.applicable) lines.push(["Check Diff", rep.checkDiff.text]);
  lines.forEach((l, i) => {
    cv.getCell(i + 1, 1).value = l[0]; cv.getCell(i + 1, 1).font = { bold: true };
    cv.getCell(i + 1, 2).value = l[1];
    if (typeof l[1] === "number") cv.getCell(i + 1, 2).numFmt = NUM;
  });
  addSourceSheets(wb, rep); // MARKER_VATRECONCILE_EXPORT_SOURCES_V1
  return wb;
}

export default function createReportFilesRouter({ reconcileReportHandler }) {
  const router = express.Router();
  const reconInvoke = makeReconInvoke(reconcileReportHandler);

  router.post("/dashboard/report-files/export", express.json(), async (req, res) => {
    try {
      const { bu, account, period } = req.body || {};
      const isDraft = req.body?.draft === true; // MARKER_VATRECONCILE_FIRST_DRAFT_V1
      const fillStartedAt = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(String(req.body?.fill_started_at || "")) ? String(req.body.fill_started_at) : null; // MARKER_VATRECONCILE_USER_TRANSACTION_V1
      if (!bu || !account || !period) return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
      const { status, body: rep } = await reconInvoke({ bu, account, period, include: "sources" }); // MARKER_VATRECONCILE_EXPORT_SOURCES_V1
      if (status !== 200) return res.status(status).json(rep);
      if (!rep.rows || rep.rows.length === 0) return res.status(422).json({ error: "ไม่มีข้อมูลสำหรับ Export (BU / Account / Period นี้ยังไม่มียอด)" });
      // MARKER_VATRECONCILE_BRANCH_MISSING_BLOCK_EXPORT_V3 -- สาขาที่ไม่พบใน branch_list ห้าม Export
      const missingBranches = rep.rows.filter((r) => r.branchMissing).map((r) => r.branch);
      if (missingBranches.length) return res.status(422).json({ error: `ไม่อนุญาตให้ Export: ไม่พบสาขา ${missingBranches.slice(0, 20).join(", ")}${missingBranches.length > 20 ? " ..." : ""} ในรายการสาขา (Branch) กรุณาเพิ่ม/แก้ข้อมูลสาขาก่อน`, missing_branches: missingBranches });

      // MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1 -- Template 100% / 100%+Simple = Layout ไฟล์ต้นฉบับ (5 ชีต + สูตร) | AVG ใช้ของเดิม
      const preparedBy = (rep.header && rep.header.preparedBy) || (req.user?.email ? await getUsernameByEmail(req.user.email) : ""); // MARKER_VATRECONCILE_PREPARED_BY_BACK_V9
      const wb = rep.template === "avg" ? await buildReconcileWorkbook(rep, bu, period) : rep.template === "pct" ? buildPctWorkbook(rep, bu, period, { preparedBy, exportDate: new Date() }) : buildOriginalWorkbook(rep, bu, period, { preparedBy, exportDate: new Date() }); // MARKER_VATRECONCILE_PCT_WORKBOOK_V1
      let buf = Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: "DEFLATE", compressionOptions: { level: 9 } } }));
      if (rep.template !== "avg" && rep.template !== "pct") buf = await markDynamicArrayFormulas(buf); // MARKER_VATRECONCILE_DYNAMIC_FORMULA_BACK_V12

      const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_");
      const dir = path.join(REPORT_STORAGE_ROOT, safe(bu), safe(period), REPORT_FILE_MODULE);
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safe(account)}${isDraft ? "_FirstDraft" : ""}.xlsx`); // MARKER_VATRECONCILE_FIRST_DRAFT_SERIAL_V1 -- Draft เก็บคนละไฟล์กับ Final
      await fs.promises.writeFile(filePath, buf);

      const owner = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const buNum = rep.buCode?.numeric || "";
      const buShortCode = rep.buCode?.short || String(bu);
      const fileName = `${buNum ? safe(buNum) + "_" : ""}${safe(buShortCode)}_${safe(account)}_${reportMonYY(period)}${isDraft ? "_FirstDraft" : ""}.xlsx`;
      const refBase = `${account}|${period}`;
      const refId = `${refBase}|${rep.template}`; // เก็บ Template ไว้ท้าย ref_id (ไม่มี Column แยกใน file_storage)
      const old = await pool.query(`SELECT id, draft_serial FROM file_storage WHERE module=$1 AND bu=$2 AND (ref_id=$3 OR ref_id LIKE $4) AND COALESCE(is_draft,false)=$5 LIMIT 1`, [REPORT_FILE_MODULE, bu, refBase, refBase + "|%", isDraft]);
      // MARKER_VATRECONCILE_FIRST_DRAFT_SERIAL_V1 -- Draft: ใช้ Serial เดิมของชุด BU+Account+Period (ไม่มี = สร้างใหม่) | Final: เก็บ Serial ของ Draft ที่มีอยู่ไว้ใน draft_serial
      let draftSerial = null;
      if (isDraft) {
        draftSerial = old.rows[0]?.draft_serial || null;
        if (!draftSerial) {
          const pre = `FD-${safe(buShortCode)}-${safe(account)}-${String(period).replace(/-/g, "")}-`;
          const nx = await pool.query(`SELECT COALESCE(MAX(SUBSTRING(draft_serial FROM '[0-9]+$')::int),0)+1 AS n FROM file_storage WHERE module=$1 AND draft_serial LIKE $2`, [REPORT_FILE_MODULE, pre + "%"]);
          draftSerial = pre + String(nx.rows[0].n).padStart(3, "0");
        }
      } else {
        const dr = await pool.query(`SELECT draft_serial FROM file_storage WHERE module=$1 AND bu=$2 AND (ref_id=$3 OR ref_id LIKE $4) AND is_draft = true LIMIT 1`, [REPORT_FILE_MODULE, bu, refBase, refBase + "|%"]);
        draftSerial = dr.rows[0]?.draft_serial || null;
      }
      let row;
      if (old.rows.length) {
        row = (await pool.query(
          `UPDATE file_storage SET file_path=$1, file_name=$2, owner_username=$3, ref_id=$5, status='active', retention_days=NULL, created_at=NOW(), file_removed_at=NULL, confirmed_at=NULL, confirmed_by=NULL, input_expire_at=NULL, fill_started_at=$6, is_draft=$7, draft_serial=COALESCE($8, draft_serial)
            WHERE id=$4 RETURNING id, bu, ref_id, file_name, owner_username, created_at, draft_serial, draft_note`,
          [filePath, fileName, owner, old.rows[0].id, refId, fillStartedAt, isDraft, draftSerial])).rows[0];
      } else {
        row = (await pool.query(
          `INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days, fill_started_at, is_draft, draft_serial)
           VALUES ($1,$2,$3,$4,$5,$6,'active',NULL,$7,$8,$9) RETURNING id, bu, ref_id, file_name, owner_username, created_at, draft_serial, draft_note`,
          [REPORT_FILE_MODULE, bu, refId, filePath, fileName, owner, fillStartedAt, isDraft, draftSerial])).rows[0];
      }
      logActivityTs(owner, isDraft ? "FIRST_DRAFT" : "SAVE", { bu: row.bu, account, period, fileId: row.id });
      if (isDraft) await tlSyncFirstDraft({ bu: row.bu, account, period, finish: true, by: owner }); // Timeline: First Draft Input Finish
      res.json({ file: { ...row, is_draft: isDraft, account, period, template: rep.template, size_bytes: buf.length, replaced: old.rows.length > 0 } });
    } catch (err) {
      console.error("[vatReconcile] report-files export error:", err);
      res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่าง Export ไฟล์", detail: err.message });
    }
  });

  router.get("/dashboard/report-files", async (req, res) => {
    try {
      // MARKER_VATRECONCILE_REPORT_FILES_SCOPE_V1 -- scope=mine (ของตัวเอง) | all (Owner เห็นทั้งหมด, Admin เห็นเฉพาะไฟล์ของ User ที่มี Permission VAT) -- ไม่เข้าเงื่อนไข fallback เป็น mine
      const { bu, period } = req.query;
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const appRole = req.user?.appRole || "";
      const wantsAll = req.query.scope === "all";
      const cond = ["fs.module = $1", "fs.status <> 'recycled'"], params = [REPORT_FILE_MODULE];
      let join = "";
      if (wantsAll && appRole === "Owner") {
        // เห็นทั้งหมด
      } else if (wantsAll && appRole === "Admin") {
        join = "JOIN user_roles ur ON ur.username = fs.owner_username";
        cond.push("(ur.permissions->>'VAT')::boolean IS TRUE");
      } else {
        params.push(username); cond.push(`fs.owner_username = $${params.length}`);
      }
      if (bu) { params.push(bu); cond.push(`fs.bu = $${params.length}`); }
      if (period) { params.push(`%|${period}`, `%|${period}|%`); cond.push(`(fs.ref_id LIKE $${params.length - 1} OR fs.ref_id LIKE $${params.length})`); }
      const q = await pool.query(
        `SELECT fs.id, fs.bu, fs.ref_id, fs.file_name, fs.file_path, fs.owner_username, fs.created_at, fs.sp_url, fs.sp_sent_at, fs.sp_sent_by, fs.file_removed_at, fs.confirmed_at, fs.confirmed_by, fs.is_draft, fs.draft_serial, fs.draft_note, fs.input_expire_at FROM file_storage fs ${join}
          WHERE ${cond.join(" AND ")} ORDER BY fs.created_at DESC LIMIT 300`, params);
      const files = q.rows.map((r) => {
        let size = null;
        try { size = fs.statSync(r.file_path).size; } catch (_) { /* ไฟล์หาย -> ไม่โชว์ขนาด */ }
        const [account, per, tpl] = String(r.ref_id).split("|");
        return { id: r.id, bu: r.bu, account, period: per, template: tpl || null, file_name: r.file_name,
          size_bytes: size, created_by: r.owner_username, updated_at: r.created_at,
          sp_url: r.sp_url || null, sp_sent_at: r.sp_sent_at || null, sp_sent_by: r.sp_sent_by || null, file_removed_at: r.file_removed_at || null, confirmed_at: r.confirmed_at || null, is_draft: r.is_draft === true, draft_serial: r.draft_serial || null, note: r.draft_note || null, confirmed_by: r.confirmed_by || null, input_expire_at: r.input_expire_at || null }; // MARKER_VATRECONCILE_SP_SENT_V1
      });
      res.json({ files });
    } catch (err) {
      console.error("[vatReconcile] report-files list error:", err);
      res.status(500).json({ error: "โหลดรายการไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_SP_SENT_V1 -- POST /dashboard/report-files/:id/sp-sent : Frontend เรียกหลังสั่ง Handler ส่งไฟล์แล้ว
  // ลิงก์/เลข BU/เดือน สร้างจากชื่อไฟล์ฝั่ง Server เอง (ไม่รับ URL จาก Client) | ทำได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin
  router.post("/dashboard/report-files/:id/sp-sent", async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const privileged = req.user?.appRole === "Owner" || req.user?.appRole === "Admin";
      const q = await pool.query(`SELECT id, bu, ref_id, file_name, owner_username, is_draft FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (rec.is_draft) return res.status(409).json({ error: "ไฟล์ First Draft ส่ง SharePoint ไม่ได้" }); // MARKER_VATRECONCILE_FIRST_DRAFT_V1
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "บันทึกการส่งได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      const target = parseSpTarget(rec.file_name);
      if (!target) return res.status(422).json({ error: "อ่านเลข BU / เดือน จากชื่อไฟล์ไม่ได้ จึงไม่บันทึกการส่ง", file_name: rec.file_name });
      const up = await pool.query(
        `UPDATE file_storage SET sp_url=$1, sp_sent_at=NOW(), sp_sent_by=$2 WHERE id=$3 RETURNING id, sp_url, sp_sent_at, sp_sent_by`,
        [target.url, username, rec.id]);
      logActivityTs(username, "SP_SENT", { bu: rec.bu, ...refParts(rec.ref_id), fileId: rec.id });
      res.json({ ok: true, ...up.rows[0], bu_code: target.buCode, period: target.period });
    } catch (err) {
      console.error("[vatReconcile] report-files sp-sent error:", err);
      res.status(500).json({ error: "บันทึกการส่ง SharePoint ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_REPORT_CONFIRM_V1 -- POST /dashboard/report-files/:id/confirm : ยืนยันว่าตรวจไฟล์แล้ว (เจ้าของไฟล์ หรือ Owner/Admin) -- ยังไม่ Confirm = Download / ส่ง SharePoint ไม่ได้
  router.post("/dashboard/report-files/:id/confirm", async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const privileged = req.user?.appRole === "Owner" || req.user?.appRole === "Admin";
      const q = await pool.query(`SELECT id, bu, ref_id, owner_username, file_path, is_draft FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (rec.is_draft) return res.status(409).json({ error: "ไฟล์นี้เป็น First Draft — Confirm ไม่ได้ ต้อง Save (เมื่อ Balance) ก่อน" }); // MARKER_VATRECONCILE_FIRST_DRAFT_V1
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "Confirm ได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      const up = await pool.query(`UPDATE file_storage SET confirmed_at=NOW(), confirmed_by=$1, input_expire_at=NOW() + ($3 || ' days')::interval WHERE id=$2 RETURNING id, confirmed_at, confirmed_by, input_expire_at`, [username, rec.id, String(INPUT_KEEP_DAYS)]);
      // MARKER_VATRECONCILE_FIRST_DRAFT_SERIAL_V1 -- Confirm = ลบ First Draft ของชุด BU+Account+Period นี้ (ทั้งแถวและไฟล์) | Serial ยังเหลือในคอลัมน์ draft_serial ของไฟล์ Final
      try {
        const refBase = String(rec.ref_id).split("|").slice(0, 2).join("|");
        const dr = await pool.query(`SELECT id, file_path FROM file_storage WHERE module=$1 AND bu=$2 AND is_draft = true AND (ref_id=$3 OR ref_id LIKE $4)`, [REPORT_FILE_MODULE, rec.bu, refBase, refBase + "|%"]);
        for (const d of dr.rows) {
          try { if (d.file_path && fs.existsSync(d.file_path)) fs.unlinkSync(d.file_path); } catch (e) { console.error("[vatReconcile] ลบไฟล์ Draft บน Disk ไม่สำเร็จ:", e.message); }
          await pool.query(`DELETE FROM file_storage WHERE id=$1`, [d.id]);
        }
      } catch (e) { console.error("[vatReconcile] ลบ First Draft หลัง Confirm ไม่สำเร็จ:", e.message); }
      logActivityTs(username, "CONFIRM", { bu: rec.bu, ...refParts(rec.ref_id), fileId: rec.id });
      await tlSyncFirstDraft({ bu: rec.bu, ...refParts(rec.ref_id), finishFinal: true, by: username }); // Timeline: Final + First = Finish
      res.json({ ok: true, ...up.rows[0] });
    } catch (err) {
      console.error("[vatReconcile] report-files confirm error:", err);
      res.status(500).json({ error: "Confirm ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_REPORT_RELEASE_V1 -- POST /dashboard/report-files/:id/release : ปุ่มเดียวกับ Confirm (สลับสถานะ) -- ยกเลิก Confirm หยุดนับวันหมดอายุ
  router.post("/dashboard/report-files/:id/release", async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const privileged = req.user?.appRole === "Owner" || req.user?.appRole === "Admin";
      const q = await pool.query(`SELECT id, bu, ref_id, owner_username FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "Release ได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      await pool.query(`UPDATE file_storage SET confirmed_at=NULL, confirmed_by=NULL, input_expire_at=NULL WHERE id=$1`, [rec.id]);
      logActivityTs(username, "RELEASE", { bu: rec.bu, ...refParts(rec.ref_id), fileId: rec.id });
      { const rm = await tlRemain(rec.bu, rec.ref_id, rec.id); await tlSyncRevert({ bu: rec.bu, ...refParts(rec.ref_id), releaseOnly: true, remainDraft: rm.remainDraft, by: username }); } // Timeline: Final -> Pending
      res.json({ ok: true });
    } catch (err) {
      console.error("[vatReconcile] report-files release error:", err);
      res.status(500).json({ error: "Release ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_ACTIVITY_TS_V1 -- POST /dashboard/activity-ts : หน้าจอส่ง Timestamp ของเหตุการณ์ที่ Server ไม่เห็นเอง (เลือก Period / ตรวจสอบ Expired แล้ว)
  router.post("/dashboard/activity-ts", express.json(), async (req, res) => {
    try {
      const { event, bu, account, period } = req.body || {};
      if (!ACTIVITY_TS_CLIENT_EVENTS.has(event)) return res.status(400).json({ error: "event ไม่ถูกต้อง" });
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const clip = (v) => (v == null ? null : String(v).slice(0, 40));
      logActivityTs(username, event, { bu: clip(bu), account: clip(account), period: clip(period) });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "บันทึก Timestamp ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_ACTIVITY_TS_V1 -- GET /dashboard/activity-ts?username=&from=YYYY-MM-DD&to=YYYY-MM-DD : รายการ Timestamp (แสดงอย่างเดียว ไม่คำนวณเป็น Transaction) | ดูของตัวเอง หรือ Owner/Admin ดูของคนอื่น
  router.get("/dashboard/activity-ts", async (req, res) => {
    try {
      const me = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const privileged = req.user?.appRole === "Owner" || req.user?.appRole === "Admin";
      const { username, from, to } = req.query;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ""))) return res.status(400).json({ error: "ต้องระบุ from, to (YYYY-MM-DD)" });
      const target = username || me;
      if (target !== me && !privileged) return res.status(403).json({ error: "ดูได้เฉพาะของตัวเอง หรือ Owner/Admin" });
      const q = await pool.query(
        `SELECT id, username, event, bu, account, period, file_id, note, created_at FROM vat_reconcile_activity_ts
          WHERE username=$1 AND (created_at AT TIME ZONE 'Asia/Bangkok') >= $2::date AND (created_at AT TIME ZONE 'Asia/Bangkok') < ($3::date + 1)
          ORDER BY created_at ASC LIMIT 2000`, [target, from, to]);
      res.json({ events: q.rows });
    } catch (err) {
      res.status(500).json({ error: "โหลด Timestamp ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_FIRST_DRAFT_NOTE_V1 -- PUT /dashboard/report-files/:id/note  body { note } : Note ของไฟล์ First Draft (เจ้าของไฟล์ หรือ Owner/Admin)
  router.put("/dashboard/report-files/:id/note", express.json(), async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const privileged = req.user?.appRole === "Owner" || req.user?.appRole === "Admin";
      const q = await pool.query(`SELECT id, owner_username, is_draft FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (!rec.is_draft) return res.status(400).json({ error: "Note ใช้ได้เฉพาะไฟล์ First Draft" });
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "แก้ Note ได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      const note = String(req.body?.note ?? "").slice(0, 2000).trim();
      await pool.query(`UPDATE file_storage SET draft_note=$1 WHERE id=$2`, [note || null, rec.id]);
      const fq = await pool.query(`SELECT bu, ref_id FROM file_storage WHERE id=$1`, [rec.id]);
      logActivityTs(username, "DRAFT_NOTE", { bu: fq.rows[0]?.bu, ...refParts(fq.rows[0]?.ref_id), fileId: rec.id, note: note || null }); // Note ผูกกับ Timeline
      if (note && fq.rows[0]) await tlSyncFirstDraft({ bu: fq.rows[0].bu, ...refParts(fq.rows[0].ref_id), note, by: username }); // Timeline: Note ช่อง First Draft
      res.json({ ok: true, note: note || null });
    } catch (err) {
      console.error("[vatReconcile] report-files note error:", err);
      res.status(500).json({ error: "บันทึก Note ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_REPORT_FILES_DELETE_V1 -- ลบไฟล์ (เจ้าของไฟล์ หรือ Owner/Admin เท่านั้น) ลบทั้งไฟล์บน Disk และ Row ใน file_storage
  router.delete("/dashboard/report-files/:id", async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const appRole = req.user?.appRole || "";
      const privileged = appRole === "Owner" || appRole === "Admin";
      const q = await pool.query(`SELECT id, bu, ref_id, is_draft, draft_note, file_path, owner_username FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "ลบได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      try { if (fs.existsSync(rec.file_path)) fs.unlinkSync(rec.file_path); } catch (e) { console.error("[vatReconcile] ลบไฟล์บน Disk ไม่สำเร็จ:", e.message); }
      await pool.query(`DELETE FROM file_storage WHERE id=$1`, [rec.id]);
      { const rm = await tlRemain(rec.bu, rec.ref_id, rec.id); await tlSyncRevert({ bu: rec.bu, ...refParts(rec.ref_id), wasDraft: !!rec.is_draft, remainDraft: rm.remainDraft, remainFinal: rm.remainFinal, note: rec.draft_note, by: username }); } // Timeline: ย้อนกลับ (Rollback)
      res.json({ ok: true });
    } catch (err) {
      console.error("[vatReconcile] report-files delete error:", err);
      res.status(500).json({ error: "ลบไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  router.get("/dashboard/report-files/:id/preview", async (req, res) => { // MARKER_VATRECONCILE_FILE_PREVIEW_BACK_V10
    try {
      const q = await pool.query(`SELECT file_name, file_path FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const { file_name, file_path } = q.rows[0];
      if (!fs.existsSync(file_path)) return res.status(410).json({ error: "ไฟล์บน Server ถูกลบหรือย้ายแล้ว" });
      const out = await pvLoadSheets(file_path);
      res.json({ file_name, ...out });
    } catch (err) {
      console.error("[vatReconcile] report-files preview error:", err);
      res.status(500).json({ error: "เปิด Preview ไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  router.get("/dashboard/report-files/:id/download", async (req, res) => {
    try {
      const q = await pool.query(`SELECT file_name, file_path, confirmed_at, is_draft FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const { file_name, file_path, confirmed_at } = q.rows[0];
      if (q.rows[0].is_draft) return res.status(403).json({ error: "ไฟล์ First Draft ไม่มี Download" }); // MARKER_VATRECONCILE_FIRST_DRAFT_V1
      if (!confirmed_at) return res.status(403).json({ error: "ยังไม่ได้ Confirm ไฟล์ — กด Confirm ก่อนจึงจะ Download ได้" }); // MARKER_VATRECONCILE_REPORT_CONFIRM_V1
      if (!fs.existsSync(file_path)) return res.status(410).json({ error: "ไฟล์บน Server ถูกลบหรือย้ายแล้ว" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${file_name}"`);
      fs.createReadStream(file_path).pipe(res);
    } catch (err) {
      console.error("[vatReconcile] report-files download error:", err);
      res.status(500).json({ error: "ดาวน์โหลดไม่สำเร็จ", detail: err.message });
    }
  });

  return router;
}
