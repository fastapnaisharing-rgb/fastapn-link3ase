# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_REPORT_FILES_V1
# "ที่เก็บไฟล์รายงานภาษี": Export .xlsx จาก Popup Preview -> เก็บถาวรใน file_storage (module 'vat-reconcile-report') -> List/Download
# แยก Source: สร้างไฟล์ใหม่ vatReconcileReportFiles.js (อยู่โฟลเดอร์เดียวกับ vatReconcile.js) + แก้ vatReconcile.js แค่ 3 จุด (import / export handler / mount)
# ต้องรัน patch_vatreconcile_reconcile_report_v1.py ก่อน
# วิธีใช้:  python patch_vatreconcile_report_files_v1.py src\routes\vatReconcile.js   แล้ว Restart-Service fastapn-backend
# Idempotent | สำรอง <ไฟล์>.bak ไฟล์เดียว | node --check ทั้ง 2 ไฟล์ | ไม่ผ่าน -> คืนไฟล์เดิม
import sys, io, os, shutil, subprocess
if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_report_files_v1.py <path to vatReconcile.js>"); sys.exit(2)
path = sys.argv[1]
newpath = os.path.join(os.path.dirname(os.path.abspath(path)), "vatReconcileReportFiles.js")
src = io.open(path, encoding="utf-8", newline="").read()
N = "MARKER_VATRECONCILE_REPORT_FILES_V1"
if N in src:
    print("already patched"); sys.exit(0)
crlf = "\r\n" in src
s = src.replace("\r\n", "\n")
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
  return wb;
}

export default function createReportFilesRouter({ reconcileReportHandler }) {
  const router = express.Router();
  const reconInvoke = makeReconInvoke(reconcileReportHandler);

  router.post("/dashboard/report-files/export", express.json(), async (req, res) => {
    try {
      const { bu, account, period } = req.body || {};
      if (!bu || !account || !period) return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
      const { status, body: rep } = await reconInvoke({ bu, account, period });
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
      const { bu, period } = req.query;
      const cond = ["module = $1", "status <> 'recycled'"], params = [REPORT_FILE_MODULE];
      if (bu) { params.push(bu); cond.push(`bu = $${params.length}`); }
      if (period) { params.push(`%|${period}`); cond.push(`ref_id LIKE $${params.length}`); }
      const q = await pool.query(
        `SELECT id, bu, ref_id, file_name, file_path, owner_username, created_at FROM file_storage
          WHERE ${cond.join(" AND ")} ORDER BY created_at DESC LIMIT 200`, params);
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

imp = 'import ExcelJS from "exceljs";\n'
assert s.count(imp) == 1, "import anchor"
s = s.replace(imp, imp + '// ' + N + '\nimport createReportFilesRouter from "./vatReconcileReportFiles.js";\n')
a = 'router.get("/dashboard/reconcile-report", async (req, res) => {'
assert s.count(a) == 1, "handler start"
s = s.replace(a, 'const reconcileReportHandler = async (req, res) => {')
end = '\n});\n\nrouter.get("/dashboard/status"'
assert s.count(end) == 1, "handler end"
s = s.replace(end, '\n};\nrouter.get("/dashboard/reconcile-report", reconcileReportHandler);\nrouter.use(createReportFilesRouter({ reconcileReportHandler })); // ' + N + '\n\nrouter.get("/dashboard/status"')
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
            else: os.remove(newpath)
            print("node --check FAILED, restored:\n" + r.stderr); sys.exit(1)
except FileNotFoundError:
    print("(node not found, skip syntax check)")
print("patched OK ->", path, "+", newpath)
