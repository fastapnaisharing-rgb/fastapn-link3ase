import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { pool, getUsernameByEmail } from "../db.js";
import { buildOriginalWorkbook } from "./vatReconcileOriginalWorkbook.js"; // MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1

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

  // Simple (ถ้ามี)
  const sim = src.simple || [];
  if (sim.length) {
    const sh = ["Branch", "Type", "Receive Date", "Running No", "Tax Invoice Date", "Tax Invoice No", "Vendor Name", "Tax ID", "Branch", "Item Detail",
      "Paid Amount", "Paid VAT", "Claim Amount", "Claim VAT", "Claim %"];
    const srows = [];
    const byB = new Map();
    sim.forEach((d) => { if (!byB.has(d.branch)) byB.set(d.branch, []); byB.get(d.branch).push(d); });
    [...byB.keys()].sort().forEach((b) => { // MARKER_VATRECONCILE_SIMPLE_SUM_FORMULA_BACK_V8
      const list = byB.get(b);
      const firstR = srows.length + 2;
      list.forEach((d) => srows.push({ values: [d.branch, d.simple_type, d.receive_date, d.running_no, d.tax_invoice_date, d.tax_invoice_no, d.vendor_name, d.tax_id, d.branch_field, d.item_detail,
        d.paid_amount, d.paid_vat, d.claimed_amount, d.claimed_vat, d.claim_percent != null ? r2(Number(d.claim_percent) * 100) : ""] }));
      const sum = (k) => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0));
      const lastR = srows.length + 1;
      const fm = (L, k) => ({ formula: `SUBTOTAL(9,${L}${firstR}:${L}${lastR})`, result: sum(k) });
      srows.push({ values: [`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", fm("K", "paid_amount"), fm("L", "paid_vat"), fm("M", "claimed_amount"), fm("N", "claimed_vat"), ""], bold: true });
    });
    {
      const lastAll = srows.length + 1;
      const gs = (k) => r2(sim.reduce((s, d) => s + (Number(d[k]) || 0), 0));
      const gm = (L, k) => ({ formula: `SUBTOTAL(9,${L}2:${L}${lastAll})`, result: gs(k) });
      srows.push({ values: ["รวมสุทธิ", "", "", "", "", "", "", "", "", "", gm("K", "paid_amount"), gm("L", "paid_vat"), gm("M", "claimed_amount"), gm("N", "claimed_vat"), ""], bold: true });
    }
    addTable(isAvg ? "Simple AVG" : "Simple Excel BU", sh, srows, [14, 8, 12, 10, 14, 18, 36, 16, 8, 30, 15, 15, 15, 15, 10], [11, 12, 13, 14]);
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
  if (f.bold) css.push("font-weight:700");
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
  const b = cell.border || {};
  for (const [k, side] of [["top", "top"], ["left", "left"], ["bottom", "bottom"], ["right", "right"]]) {
    const x = b[k];
    if (x && x.style) css.push(`border-${side}:${PV_BSTYLE[x.style] || "1px solid"} ${pvArgb(x.color) || "#000"}`);
  }
  return css.join(";");
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
    const isRv = /^ReportVat/i.test(ws.name);
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
    const rows = [];
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const cells = [];
      const closed = isRv && r >= 9 && String((row.getCell(16).value && row.getCell(16).value.result) ?? row.getCell(16).value ?? "") === "Closed";
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        const nf = cell.numFmt;
        const tx = pvText(cell.value, nf);
        const extra = {};
        if (isRv && r >= 9) {
          if (tx.n && Number(cell.value && cell.value.result !== undefined ? cell.value.result : cell.value) < 0 && c >= 3 && c <= 14) extra.color = "#ff5050";
          if (closed && c <= 16) extra.color = "#ff0000";
          if (c === 16 && tx.t === "Active") { extra.bg = "#ccffcc"; extra.color = "#002060"; }
          if (c === 16 && (tx.t === "Temp." || tx.t === "Relocate")) { extra.bg = "#ffffcc"; extra.color = "#002060"; }
        }
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
    ["Template", rep.template === "avg" ? "เฉลี่ย (AVG)" : rep.template === "100_simple" ? "100% + Simple" : "100%"],
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
      if (!bu || !account || !period) return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
      const { status, body: rep } = await reconInvoke({ bu, account, period, include: "sources" }); // MARKER_VATRECONCILE_EXPORT_SOURCES_V1
      if (status !== 200) return res.status(status).json(rep);
      if (!rep.rows || rep.rows.length === 0) return res.status(422).json({ error: "ไม่มีข้อมูลสำหรับ Export (BU / Account / Period นี้ยังไม่มียอด)" });
      // MARKER_VATRECONCILE_BRANCH_MISSING_BLOCK_EXPORT_V3 -- สาขาที่ไม่พบใน branch_list ห้าม Export
      const missingBranches = rep.rows.filter((r) => r.branchMissing).map((r) => r.branch);
      if (missingBranches.length) return res.status(422).json({ error: `ไม่อนุญาตให้ Export: ไม่พบสาขา ${missingBranches.slice(0, 20).join(", ")}${missingBranches.length > 20 ? " ..." : ""} ในรายการสาขา (Branch) กรุณาเพิ่ม/แก้ข้อมูลสาขาก่อน`, missing_branches: missingBranches });

      // MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1 -- Template 100% / 100%+Simple = Layout ไฟล์ต้นฉบับ (5 ชีต + สูตร) | AVG ใช้ของเดิม
      const preparedBy = (rep.header && rep.header.preparedBy) || (req.user?.email ? await getUsernameByEmail(req.user.email) : ""); // MARKER_VATRECONCILE_PREPARED_BY_BACK_V9
      const wb = rep.template === "avg" ? await buildReconcileWorkbook(rep, bu, period) : buildOriginalWorkbook(rep, bu, period, { preparedBy, exportDate: new Date() });
      const buf = Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: "DEFLATE", compressionOptions: { level: 9 } } }));

      const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_");
      const dir = path.join(REPORT_STORAGE_ROOT, safe(bu), safe(period), REPORT_FILE_MODULE);
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safe(account)}.xlsx`);
      await fs.promises.writeFile(filePath, buf);

      const owner = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const buNum = rep.buCode?.numeric || "";
      const buShortCode = rep.buCode?.short || String(bu);
      const fileName = `${buNum ? safe(buNum) + "_" : ""}${safe(buShortCode)}_${safe(account)}_${reportMonYY(period)}.xlsx`;
      const refBase = `${account}|${period}`;
      const refId = `${refBase}|${rep.template}`; // เก็บ Template ไว้ท้าย ref_id (ไม่มี Column แยกใน file_storage)
      const old = await pool.query(`SELECT id FROM file_storage WHERE module=$1 AND bu=$2 AND (ref_id=$3 OR ref_id LIKE $4) LIMIT 1`, [REPORT_FILE_MODULE, bu, refBase, refBase + "|%"]);
      let row;
      if (old.rows.length) {
        row = (await pool.query(
          `UPDATE file_storage SET file_path=$1, file_name=$2, owner_username=$3, ref_id=$5, status='active', retention_days=NULL, created_at=NOW()
            WHERE id=$4 RETURNING id, bu, ref_id, file_name, owner_username, created_at`,
          [filePath, fileName, owner, old.rows[0].id, refId])).rows[0];
      } else {
        row = (await pool.query(
          `INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days)
           VALUES ($1,$2,$3,$4,$5,$6,'active',NULL) RETURNING id, bu, ref_id, file_name, owner_username, created_at`,
          [REPORT_FILE_MODULE, bu, refId, filePath, fileName, owner])).rows[0];
      }
      res.json({ file: { ...row, account, period, template: rep.template, size_bytes: buf.length, replaced: old.rows.length > 0 } });
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
        `SELECT fs.id, fs.bu, fs.ref_id, fs.file_name, fs.file_path, fs.owner_username, fs.created_at FROM file_storage fs ${join}
          WHERE ${cond.join(" AND ")} ORDER BY fs.created_at DESC LIMIT 300`, params);
      const files = q.rows.map((r) => {
        let size = null;
        try { size = fs.statSync(r.file_path).size; } catch (_) { /* ไฟล์หาย -> ไม่โชว์ขนาด */ }
        const [account, per, tpl] = String(r.ref_id).split("|");
        return { id: r.id, bu: r.bu, account, period: per, template: tpl || null, file_name: r.file_name,
          size_bytes: size, created_by: r.owner_username, updated_at: r.created_at };
      });
      res.json({ files });
    } catch (err) {
      console.error("[vatReconcile] report-files list error:", err);
      res.status(500).json({ error: "โหลดรายการไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_VATRECONCILE_REPORT_FILES_DELETE_V1 -- ลบไฟล์ (เจ้าของไฟล์ หรือ Owner/Admin เท่านั้น) ลบทั้งไฟล์บน Disk และ Row ใน file_storage
  router.delete("/dashboard/report-files/:id", async (req, res) => {
    try {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const appRole = req.user?.appRole || "";
      const privileged = appRole === "Owner" || appRole === "Admin";
      const q = await pool.query(`SELECT id, file_path, owner_username FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const rec = q.rows[0];
      if (!privileged && rec.owner_username !== username) return res.status(403).json({ error: "ลบได้เฉพาะเจ้าของไฟล์ หรือ Owner/Admin" });
      try { if (fs.existsSync(rec.file_path)) fs.unlinkSync(rec.file_path); } catch (e) { console.error("[vatReconcile] ลบไฟล์บน Disk ไม่สำเร็จ:", e.message); }
      await pool.query(`DELETE FROM file_storage WHERE id=$1`, [rec.id]);
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
      const q = await pool.query(`SELECT file_name, file_path FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const { file_name, file_path } = q.rows[0];
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
