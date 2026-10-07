# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_EXPORT_SOURCES_V1
# ไฟล์ Excel ที่ Export เพิ่มชีตต้นทางตามไฟล์ Reconcile จริง: Detail (100%) / A-Detail (AVG), Pivot (100%), TB, Simple Excel BU / Simple AVG
# แก้ vatReconcile.js (/dashboard/reconcile-report รับ ?include=sources) + เขียนทับ vatReconcileReportFiles.js (โฟลเดอร์เดียวกัน)
# ต้องรัน patch_vatreconcile_reconcile_report_v1.py และ patch_vatreconcile_report_files_v1.py ก่อน
# วิธีใช้:  python patch_vatreconcile_export_sources_v1.py src\routes\vatReconcile.js   แล้ว Restart-Service fastapn-backend
# Idempotent | .bak ไฟล์เดียวต่อไฟล์ | node --check ทั้ง 2 ไฟล์ | ไม่ผ่าน -> คืนไฟล์เดิม
import sys, io, os, shutil, subprocess
if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_export_sources_v1.py <path to vatReconcile.js>"); sys.exit(2)
path = sys.argv[1]
newpath = os.path.join(os.path.dirname(os.path.abspath(path)), "vatReconcileReportFiles.js")
src = io.open(path, encoding="utf-8", newline="").read()
N = "MARKER_VATRECONCILE_EXPORT_SOURCES_V1"
if N in src:
    print("already patched"); sys.exit(0)
assert "MARKER_VATRECONCILE_REPORT_FILES_V1" in src, "ต้องรัน patch_vatreconcile_report_files_v1.py ก่อน"
crlf = "\r\n" in src
s = src.replace("\r\n", "\n")
BLOCK = r'''    // MARKER_VATRECONCILE_EXPORT_SOURCES_V1 -- ข้อมูลต้นทางสำหรับ Export (Detail / TB / Simple) ส่งเฉพาะเมื่อขอ include=sources
    let sources = null;
    if (req.query.include === "sources") {
      const [detQ, simDetQ] = await Promise.all([
        pool.query(
          `SELECT branch, receive_date::text AS receive_date, grt_no, tax_invoice_date::text AS tax_invoice_date, tax_invoice_no,
                  vendor_name, tax_id, ho, branch_field, item_detail,
                  paid_amount::float8 AS paid_amount, paid_vat::float8 AS paid_vat,
                  claimed100_amount::float8 AS claimed100_amount, claimed100_vat::float8 AS claimed100_vat, calculate_tax::float8 AS calculate_tax
           FROM vat_reconcile_input_summary
           WHERE bu = $1 AND reconcile_account = $2 AND period = $3
           ORDER BY branch, receive_date, tax_invoice_no`,
          [bu, account, period]
        ),
        pool.query(
          `SELECT h.branch, h.simple_type, d.receive_date::text AS receive_date, d.running_no, d.tax_invoice_date::text AS tax_invoice_date,
                  d.tax_invoice_no, d.vendor_name, d.tax_id, d.branch_field, d.item_detail,
                  d.paid_amount::float8 AS paid_amount, d.paid_vat::float8 AS paid_vat,
                  d.claimed_amount::float8 AS claimed_amount, d.claimed_vat::float8 AS claimed_vat, d.claim_percent::float8 AS claim_percent
           FROM vat_reconcile_simple_header h
           JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3
           ORDER BY h.branch, d.running_no`,
          [bu, account, period]
        ),
      ]);
      sources = { detail: detQ.rows, tb: tbQ.rows, simple: simDetQ.rows };
    }

'''
MODULE = r'''import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { pool, getUsernameByEmail } from "../db.js";

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
const reportTemplateTag = (t) => (t === "avg" ? "AVG" : t === "100_simple" ? "100S" : "100");
const reportTemplateFromName = (n) => { const m = /_(AVG|100S|100)\.xlsx$/i.exec(n || ""); return m ? ({ AVG: "avg", "100S": "100_simple", "100": "100" })[m[1].toUpperCase()] : null; };

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
    [...byB.keys()].sort().forEach((b) => {
      const list = byB.get(b);
      list.forEach((d) => srows.push({ values: [d.branch, d.simple_type, d.receive_date, d.running_no, d.tax_invoice_date, d.tax_invoice_no, d.vendor_name, d.tax_id, d.branch_field, d.item_detail,
        d.paid_amount, d.paid_vat, d.claimed_amount, d.claimed_vat, d.claim_percent != null ? r2(Number(d.claim_percent) * 100) : ""] }));
      const sum = (k) => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0));
      srows.push({ values: [`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", sum("paid_amount"), sum("paid_vat"), sum("claimed_amount"), sum("claimed_vat"), ""], bold: true });
    });
    addTable(isAvg ? "Simple AVG" : "Simple Excel BU", sh, srows, [14, 8, 12, 10, 14, 18, 36, 16, 8, 30, 15, 15, 15, 15, 10], [11, 12, 13, 14]);
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

      const wb = await buildReconcileWorkbook(rep, bu, period);
      const buf = Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: "DEFLATE", compressionOptions: { level: 9 } } }));

      const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_");
      const dir = path.join(REPORT_STORAGE_ROOT, safe(bu), safe(period), REPORT_FILE_MODULE);
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safe(account)}.xlsx`);
      await fs.promises.writeFile(filePath, buf);

      const owner = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const fileName = `ReconcileVAT_${safe(bu)}_${safe(account)}_${String(period).replace("-", "")}_${reportTemplateTag(rep.template)}.xlsx`;
      const refId = `${account}|${period}`;
      const old = await pool.query(`SELECT id FROM file_storage WHERE module=$1 AND bu=$2 AND ref_id=$3 LIMIT 1`, [REPORT_FILE_MODULE, bu, refId]);
      let row;
      if (old.rows.length) {
        row = (await pool.query(
          `UPDATE file_storage SET file_path=$1, file_name=$2, owner_username=$3, status='active', retention_days=NULL, created_at=NOW()
            WHERE id=$4 RETURNING id, bu, ref_id, file_name, owner_username, created_at`,
          [filePath, fileName, owner, old.rows[0].id])).rows[0];
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
      if (period) { params.push(`%|${period}`); cond.push(`fs.ref_id LIKE $${params.length}`); }
      const q = await pool.query(
        `SELECT fs.id, fs.bu, fs.ref_id, fs.file_name, fs.file_path, fs.owner_username, fs.created_at FROM file_storage fs ${join}
          WHERE ${cond.join(" AND ")} ORDER BY fs.created_at DESC LIMIT 300`, params);
      const files = q.rows.map((r) => {
        let size = null;
        try { size = fs.statSync(r.file_path).size; } catch (_) { /* ไฟล์หาย -> ไม่โชว์ขนาด */ }
        const [account, per] = String(r.ref_id).split("|");
        return { id: r.id, bu: r.bu, account, period: per, template: reportTemplateFromName(r.file_name), file_name: r.file_name,
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
'''
a = "    return res.json({\n      template,\n"
assert s.count(a) == 1, "anchor return"
s = s.replace(a, BLOCK + a)
b = "      branchCount: { withData: rows.length, total: totalBranchCount || rows.length },\n"
assert s.count(b) == 1, "anchor branchCount"
s = s.replace(b, b + "      ...(sources ? { sources } : {}),\n")
if crlf: s = s.replace("\n", "\r\n")
shutil.copyfile(path, path + ".bak")
if os.path.exists(newpath): shutil.copyfile(newpath, newpath + ".bak")
io.open(path, "w", encoding="utf-8", newline="").write(s)
io.open(newpath, "w", encoding="utf-8", newline="").write(MODULE.replace("\n", "\r\n") if crlf else MODULE)
try:
    for f in (path, newpath):
        r = subprocess.run(["node", "--check", f], capture_output=True, text=True)
        if r.returncode != 0:
            shutil.copyfile(path + ".bak", path)
            if os.path.exists(newpath + ".bak"): shutil.copyfile(newpath + ".bak", newpath)
            print("node --check FAILED, restored:\n" + r.stderr); sys.exit(1)
except FileNotFoundError:
    print("(node not found, skip syntax check)")
print("patched OK")
