import fs from "fs";
import path from "path";
import { pool, getUsernameByEmail } from "../db.js";
import { pvLoadSheets } from "./vatReconcileReportFiles.js";
import { buildApAccountWorkbook, apReportFileName, AP_ACCOUNT_NAMES } from "./apReconcileWorkbook.js";

// MARKER_APRECONCILE_REPORT_V1
/**
 * AP Recon: Preview / Export รายงานรายบัญชี (21930052 / 54 / 84 / 85) ของ 1 BU + 1 Period
 *   GET  /ap-reconcile/report/preview?bu=MPS&period=2026-08  -> ไฟล์ .xlsx ของทั้ง 4 Account (base64) ให้ Popup อ่านแบบเดียวกับ Input
 *   POST /ap-reconcile/report/export {bu, period, accounts?}  -> สร้างไฟล์ + เก็บเป็น Job (file_storage module 'ap-reconcile') ต่อ Account
 * ไฟล์ = Template เดียวกับตัวอย่าง (apReconcileWorkbook.js) | Popup กับไฟล์ที่ Export ออกมาจากตัวสร้างตัวเดียวกัน
 */
const REPORT_ACCOUNTS = ["21930052", "21930054", "21930084", "21930085"];
const AP_MODULE = "ap-reconcile";
const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT || "C:\\apps\\fastapn-backend\\storage";
const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_");
const pickKey = (row, re, exclude) => Object.keys(row || {}).find((k) => re.test(k) && !(exclude && exclude.test(k)));

async function loadBuContext(buInput, period) {
  const cq = await pool.query(`SELECT * FROM company_list WHERE (bu = $1 OR "COMPANY CODE" LIKE '%-' || $1 || '-%') AND deleted IS NOT TRUE LIMIT 1`, [buInput]);
  const c = cq.rows[0];
  if (!c) throw Object.assign(new Error(`ไม่พบ BU ${buInput} ใน company_list`), { status: 404 });
  const comPrefix = String(c["COMPANY CODE"] || "");
  const comCode = comPrefix.split("-")[2] || "";
  const enKey = pickKey(c, /company.*name|^name$/i, /thai|บริษัท/i);
  const companyNameEn = enKey && c[enKey] ? String(c[enKey]).trim() : "";
  const bu = c.bu;
  // Prepare by / Department จาก AP Setting (หน้า Business Unit: คอลัมน์ AP Prepare By / AP Department ใน company_list)
  const pbKey = pickKey(c, /^\s*ap[\s_]*prepar/i); const dpKey = pickKey(c, /^\s*ap[\s_]*depart/i);
  const prepareBy = pbKey && c[pbKey] ? String(c[pbKey]).trim() : "";
  const department = dpKey && c[dpKey] ? String(c[dpKey]).trim() : "";
  const book = c.BOOK || c.book || bu;
  const [y, m] = period.split("-").map(Number);
  const asOfDate = new Date(Date.UTC(y, m, 0)); // วันสุดท้ายของเดือน (Macro: ก.พ. 28 / เม.ย. มิ.ย. ก.ย. พ.ย. 30 / อื่น ๆ 31)
  return { bu, book, comPrefix, comCode, companyNameEn, prepareBy, department, asOfDate, numericVariants: [comCode, String(Number(comCode))] };
}

// ดึง TB + AP ของทั้ง 4 Account ใน 2 Query (แทน 8) แล้วแยกใน Memory | ช่วงสาขา (Branch From/To) คำนวณจากชุดเดียวกัน
async function loadAllData(ctx, period) {
  const [tb, ap] = await Promise.all([
    pool.query(
      `SELECT branch, cpc, account, subacc, description, beginning_balance, period_activity, ending_balance
         FROM vat_reconcile_tb WHERE bu::text = ANY($1::text[]) AND period = $2 AND account = ANY($3::text[])
        ORDER BY branch, subacc`, [ctx.numericVariants, period, REPORT_ACCOUNTS]),
    pool.query(
      `SELECT branch_code, gl_account, sub_account, supplier_code, supplier_name, invoice_number, invoice_date, currency, amount, remaining_amount, description
         FROM ap_cutting_staging WHERE branch_cpc_key = $1 AND period = $2 AND gl_account = ANY($3::text[])
        ORDER BY branch_code, sub_account, ctid`, [ctx.bu, period, REPORT_ACCOUNTS]),
  ]);
  const by = {}; for (const a of REPORT_ACCOUNTS) by[a] = { tbRows: [], apRows: [] };
  let lo = null; let hi = null;
  const rng = (b) => { if (!b) return; if (lo === null || b < lo) lo = b; if (hi === null || b > hi) hi = b; };
  for (const r of tb.rows) {
    rng(String(r.branch));
    by[String(r.account)]?.tbRows.push({ branch: String(r.branch), cpc: r.cpc, account: Number(r.account), subacc: String(r.subacc), description: r.description, beginning: Number(r.beginning_balance), activity: Number(r.period_activity), ending: Number(r.ending_balance) });
  }
  for (const r of ap.rows) {
    rng(String(r.branch_code));
    by[String(r.gl_account)]?.apRows.push({ branch: String(r.branch_code), account: Number(r.gl_account), subacc: String(r.sub_account), supplier_code: r.supplier_code, supplier_name: r.supplier_name, invoice_no: r.invoice_number, invoice_date: r.invoice_date ? new Date(r.invoice_date) : null, currency: r.currency, amount: Number(r.amount), remaining: Number(r.remaining_amount), description: r.description });
  }
  return { by, range: { branchFrom: lo || "", branchTo: hi || "" } };
}

// สร้าง Workbook ของ 1 Account (wantBuffer = true เฉพาะตอน Export | Preview ใช้ Workbook ในหน่วยความจำอ่านตรง ๆ ไม่เขียนไฟล์)
async function buildOne(ctx, all, period, account, reportDate, wantBuffer) {
  const d = all.by[account];
  const { wb, hasData } = await buildApAccountWorkbook({
    account, bu: ctx.bu, book: ctx.book, comCode: ctx.comCode, comPrefix: ctx.comPrefix, companyNameEn: ctx.companyNameEn, prepareBy: ctx.prepareBy, department: ctx.department,
    branchFrom: all.range.branchFrom, branchTo: all.range.branchTo, asOfDate: ctx.asOfDate, reportDate, ...d,
  });
  const buf = wantBuffer ? Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: "DEFLATE", compressionOptions: { level: 6 } } })) : null;
  const fileName = apReportFileName({ comCode: ctx.comCode, bu: ctx.bu, account, asOfDate: ctx.asOfDate, hasData });
  return { account, hasData, fileName, wb, buf, tbCount: d.tbRows.length, apCount: d.apRows.length };
}

const validPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));

export default function registerApReport(router) {
  // Preview 1 Account (หรือทั้ง 4 ถ้าไม่ส่ง account) | แคชข้อมูล DB ของ BU+Period 20 วินาที ให้ 4 Tab ที่ขอพร้อมกันใช้ Query ชุดเดียวกัน
  const dataCache = new Map();
  const cachedAll = (ctx, period) => {
    const key = `${ctx.bu}|${period}`;
    const hit = dataCache.get(key);
    if (hit && Date.now() - hit.t < 20000) return hit.p;
    const p = loadAllData(ctx, period);
    dataCache.set(key, { t: Date.now(), p });
    p.catch(() => dataCache.delete(key));
    return p;
  };
  router.get("/report/preview", async (req, res) => {
    try {
      const t0 = Date.now();
      const { bu, period } = req.query;
      if (!bu || !validPeriod(period)) return res.status(400).json({ error: "ต้องระบุ bu และ period (YYYY-MM)" });
      const only = req.query.account ? String(req.query.account) : null;
      if (only && !REPORT_ACCOUNTS.includes(only)) return res.status(400).json({ error: "Account ไม่อยู่ในรายการ" });
      const ctx = await loadBuContext(String(bu), period);
      const all = await cachedAll(ctx, period);
      const t1 = Date.now();
      const reportDate = new Date();
      const files = await Promise.all((only ? [only] : REPORT_ACCOUNTS).map(async (account) => {
        const f = await buildOne(ctx, all, period, account, reportDate, false);
        const sheets = await pvLoadSheets(null, f.wb);
        return { account, account_name: AP_ACCOUNT_NAMES[account], file_name: f.fileName, has_data: f.hasData, tb_rows: f.tbCount, ap_rows: f.apCount, ...sheets };
      }));
      const timing = { db_ms: t1 - t0, build_ms: Date.now() - t1, total_ms: Date.now() - t0 };
      console.log(`[apReconcile] report preview bu=${ctx.bu} period=${period} account=${only || "all"} db=${timing.db_ms}ms build+parse=${timing.build_ms}ms total=${timing.total_ms}ms`);
      res.json({ bu: ctx.bu, period, files, timing });
    } catch (err) {
      console.error("[apReconcile] report preview error:", err);
      res.status(err.status || 500).json({ error: "สร้าง Preview ไม่สำเร็จ", detail: err.message });
    }
  });

  // Preview ไฟล์ Job ที่เก็บแล้ว (My Job / All Job) -- Parser เดียวกับ Input
  router.get("/report/jobs/:id/preview", async (req, res) => {
    try {
      const q = await pool.query(`SELECT file_name, file_path FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, AP_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      if (!fs.existsSync(q.rows[0].file_path)) return res.status(410).json({ error: "ไฟล์บน Server ถูกลบหรือย้ายแล้ว" });
      res.json({ file_name: q.rows[0].file_name, ...(await pvLoadSheets(q.rows[0].file_path)) });
    } catch (err) {
      console.error("[apReconcile] job preview error:", err);
      res.status(500).json({ error: "เปิด Preview ไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  // Book -> BU ที่อยู่ใน Book นั้น (เฉพาะ BU ที่มี AP Cutting ใน Period) ใช้กับสวิตช์ BU | Book ใน Control Zone
  router.get("/report/books", async (req, res) => {
    try {
      const { period } = req.query;
      if (!validPeriod(period)) return res.status(400).json({ error: "ต้องระบุ period (YYYY-MM)" });
      const q = await pool.query(
        `SELECT cl."BOOK" AS book, cl.bu FROM company_list cl
          WHERE cl.deleted IS NOT TRUE AND cl."BOOK" IS NOT NULL
            AND EXISTS (SELECT 1 FROM ap_cutting_staging a WHERE a.branch_cpc_key = cl.bu AND a.period = $1)
          ORDER BY cl."BOOK", cl.bu`, [period]);
      const map = new Map();
      for (const r of q.rows) { if (!map.has(r.book)) map.set(r.book, []); map.get(r.book).push(r.bu); }
      res.json({ period, books: [...map].map(([book, bus]) => ({ book, bus })) });
    } catch (err) {
      console.error("[apReconcile] report books error:", err);
      res.status(500).json({ error: "โหลดรายการ Book ไม่สำเร็จ", detail: err.message });
    }
  });

  // Export 1 BU -> ไฟล์ต่อ Account เก็บเป็น Job (ใช้ร่วมกันทั้งโหมด BU และโหมด Book)
  async function exportBu(bu, period, accounts, owner) {
    const ctx = await loadBuContext(String(bu), period);
    const all = await loadAllData(ctx, period);
    const reportDate = new Date();
    const dir = path.join(STORAGE_ROOT, safe(ctx.bu), safe(period), AP_MODULE);
    await fs.promises.mkdir(dir, { recursive: true });
    const out = [];
    for (const account of accounts) {
      const f = await buildOne(ctx, all, period, account, reportDate, true);
      const filePath = path.join(dir, `${safe(account)}.xlsx`);
      await fs.promises.writeFile(filePath, f.buf);
      const refId = `${account}|${period}|ap`;
      const old = await pool.query(`SELECT id FROM file_storage WHERE module=$1 AND bu=$2 AND ref_id=$3 LIMIT 1`, [AP_MODULE, ctx.bu, refId]);
      let row;
      if (old.rows.length) {
        row = (await pool.query(`UPDATE file_storage SET file_path=$1, file_name=$2, owner_username=$3, status='active', retention_days=NULL, created_at=NOW(), file_removed_at=NULL WHERE id=$4 RETURNING id, bu, ref_id, file_name, owner_username, created_at`, [filePath, f.fileName, owner, old.rows[0].id])).rows[0];
      } else {
        row = (await pool.query(`INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days) VALUES ($1,$2,$3,$4,$5,$6,'active',NULL) RETURNING id, bu, ref_id, file_name, owner_username, created_at`, [AP_MODULE, ctx.bu, refId, filePath, f.fileName, owner])).rows[0];
      }
      out.push({ ...row, account, has_data: f.hasData, size_bytes: f.buf.length, replaced: old.rows.length > 0 });
    }
    return out;
  }
  const pickAccounts = (b) => (Array.isArray(b.accounts) && b.accounts.length ? b.accounts.map(String).filter((a) => REPORT_ACCOUNTS.includes(a)) : REPORT_ACCOUNTS);

  // โหมด BU (หลัก): 1 BU = 4 Account = 4 Job
  router.post("/report/export", async (req, res) => {
    try {
      const { bu, period } = req.body || {};
      if (!bu || !validPeriod(period)) return res.status(400).json({ error: "ต้องระบุ bu และ period (YYYY-MM)" });
      const owner = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      res.json({ files: await exportBu(bu, period, pickAccounts(req.body), owner) });
    } catch (err) {
      console.error("[apReconcile] report export error:", err);
      res.status(err.status || 500).json({ error: "Export ไม่สำเร็จ", detail: err.message });
    }
  });

  // โหมด Book (สลับจาก BU): ทุก BU ของ Book ที่มี AP ใน Period นั้น วนทีละ BU กดครั้งเดียว | BU ไหนพลาดไม่หยุดตัวอื่น
  router.post("/report/export-book", async (req, res) => {
    try {
      const { book, period } = req.body || {};
      if (!book || !validPeriod(period)) return res.status(400).json({ error: "ต้องระบุ book และ period (YYYY-MM)" });
      const owner = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const q = await pool.query(
        `SELECT DISTINCT cl.bu FROM company_list cl
          WHERE cl."BOOK" = $1 AND cl.deleted IS NOT TRUE
            AND EXISTS (SELECT 1 FROM ap_cutting_staging a WHERE a.branch_cpc_key = cl.bu AND a.period = $2)
          ORDER BY cl.bu`, [String(book), period]);
      if (!q.rows.length) return res.status(422).json({ error: `Book ${book} ไม่มี BU ที่มี AP Cutting ใน Period ${period}` });
      const accounts = pickAccounts(req.body);
      const done = []; const failed = [];
      for (const r of q.rows) {
        try { done.push({ bu: r.bu, files: await exportBu(r.bu, period, accounts, owner) }); }
        catch (e) { console.error("[apReconcile] export-book", r.bu, e.message); failed.push({ bu: r.bu, error: e.message }); }
      }
      res.json({ book, period, bu_total: q.rows.length, bu_done: done.length, files_total: done.reduce((n, d) => n + d.files.length, 0), done, failed });
    } catch (err) {
      console.error("[apReconcile] report export-book error:", err);
      res.status(err.status || 500).json({ error: "Export Book ไม่สำเร็จ", detail: err.message });
    }
  });
}
