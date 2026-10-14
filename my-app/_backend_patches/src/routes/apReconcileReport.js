import fs from "fs";
import path from "path";
import { pool, getUsernameByEmail } from "../db.js";
import ExcelJS from "exceljs";
import { pvLoadSheets } from "./vatReconcileReportFiles.js";
import { buildApAccountWorkbook, apReportFileName, AP_ACCOUNT_NAMES } from "./apReconcileWorkbook.js";
import { glAccessFor } from "./menuPermissions.js"; // MARKER_GL_REPORT_OVERRIDE_V1
import { ensureApExpireColumns, stampApJobExpire, clearApJobExpire } from "./apReconcileExpire.js"; // MARKER_APRECONCILE_EXPIRE_V1

// MARKER_APRECONCILE_REPORT_V1
/**
 * AP Recon: Preview / Export รายงานรายบัญชี (21930052 / 54 / 84 / 85) ของ 1 BU + 1 Period
 *   GET  /ap-reconcile/report/preview?bu=MPS&period=2026-08  -> ไฟล์ .xlsx ของทั้ง 4 Account (base64) ให้ Popup อ่านแบบเดียวกับ Input
 *   POST /ap-reconcile/report/export {bu, period, accounts?}  -> สร้างไฟล์ + เก็บเป็น Job (file_storage module 'ap-reconcile') ต่อ Account
 * ไฟล์ = Template เดียวกับตัวอย่าง (apReconcileWorkbook.js) | Popup กับไฟล์ที่ Export ออกมาจากตัวสร้างตัวเดียวกัน
 */
// MARKER_APRECONCILE_IE_REPORT_V1 -- รองรับ IE Reconcile (100/220) ใช้ตัวสร้างไฟล์ Template เดียวกับ AP | ค่าเริ่มต้นเมื่อไม่ระบุ Account = กลุ่ม AP 4 ตัวเดิม
const REPORT_ACCOUNTS = ["21930052", "21930054", "21930084", "21930085", "21930100", "21930220"];
const AP_DEFAULT_ACCOUNTS = ["21930052", "21930054", "21930084", "21930085"];
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
  // MARKER_APRECONCILE_IE_SETTING_V1 -- IE Reconcile (100/220) ใช้ IE Setting (คอลัมน์ "IE Prepare By" / "IE Department") คนละชุดกับ AP Setting
  const ipbKey = pickKey(c, /^\s*ie[\s_]*prepar/i); const idpKey = pickKey(c, /^\s*ie[\s_]*depart/i);
  const iePrepareBy = ipbKey && c[ipbKey] ? String(c[ipbKey]).trim() : "";
  const ieDepartment = idpKey && c[idpKey] ? String(c[idpKey]).trim() : "";
  const book = c.BOOK || c.book || bu;
  const [y, m] = period.split("-").map(Number);
  const asOfDate = new Date(Date.UTC(y, m, 0)); // วันสุดท้ายของเดือน (Macro: ก.พ. 28 / เม.ย. มิ.ย. ก.ย. พ.ย. 30 / อื่น ๆ 31)
  return { bu, book, comPrefix, comCode, companyNameEn, prepareBy, department, iePrepareBy, ieDepartment, asOfDate, numericVariants: [comCode, String(Number(comCode))] };
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
  // MARKER_APRECONCILE_DETAIL_SHEET_V1 -- Detail of Overhead (ap_detailoverhead, source='ap_reconcile') ของ BU/Period นี้ -> ชีต "Detail" (มีเฉพาะ Account ที่มีข้อมูล) | ตารางยังไม่มี/Query พัง = ข้าม ไม่ให้ Report พัง
  let detailRows = [];
  try {
    const dq = await pool.query(
      `SELECT branch_code, branch_name, cost_center, account_code, account_name, sub_account_code, to_char(transaction_date, 'YYYY-MM-DD') AS tdate,
              journal_name, invoice_number, vendor_name, description, amount, contact_from_to
         FROM ap_detailoverhead WHERE com = ANY($1::text[]) AND period = $2 AND account_code = ANY($3::text[]) -- ทุก Source (AP 52/54/84/85 = ap_reconcile · IE 100/220 = ie_reconcile)
        ORDER BY account_code, branch_code, sub_account_code, transaction_date, line_no`, [ctx.numericVariants, period, REPORT_ACCOUNTS]);
    detailRows = dq.rows;
  } catch (e) { console.warn("[apReconcileReport] detail sheet skipped:", e.message); }
  const by = {}; for (const a of REPORT_ACCOUNTS) by[a] = { tbRows: [], apRows: [], detailRows: [] };
  for (const r of detailRows) by[String(r.account_code)]?.detailRows.push(r);
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
    account, bu: ctx.bu, book: ctx.book, comCode: ctx.comCode, comPrefix: ctx.comPrefix, companyNameEn: ctx.companyNameEn, prepareBy: ['21930100', '21930220'].includes(String(account)) ? ctx.iePrepareBy : ctx.prepareBy, department: ['21930100', '21930220'].includes(String(account)) ? ctx.ieDepartment : ctx.department,
    branchFrom: all.range.branchFrom, branchTo: all.range.branchTo, asOfDate: ctx.asOfDate, reportDate, ...d,
  });
  const buf = wantBuffer ? Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: "DEFLATE", compressionOptions: { level: 6 } } })) : null;
  const fileName = apReportFileName({ comCode: ctx.comCode, bu: ctx.bu, account, asOfDate: ctx.asOfDate, hasData });
  return { account, hasData, fileName, wb, buf, tbCount: d.tbRows.length, apCount: d.apRows.length };
}

// MARKER_APRECONCILE_PAGED_V1 -- ชีตใหญ่ (> PAGED_ABOVE แถว) ส่งเฉพาะ FIRST_ROWS แถวแรก แล้ว Popup ขอแถวถัดไปเป็นช่วงตามที่เลื่อน (ดึงจาก Workbook ที่เก็บไว้ใน Memory ชั่วคราว)
const PAGED_ABOVE = 3000; const FIRST_ROWS = 400; const MAX_WINDOW = 600;
const WB_TTL_MS = 180000; const WB_MAX = 3;
const wbCache = new Map(); // key -> { t, p(Promise<Workbook>) } | อายุ 3 นาที เก็บไม่เกิน 3 ไฟล์ -- ใช้กับ Preview เท่านั้น (Export สร้างใหม่จากฐานข้อมูลทุกครั้ง)
function wbCacheGet(key, factory) {
  const now = Date.now();
  for (const [k, v] of wbCache) if (now - v.t > WB_TTL_MS) wbCache.delete(k);
  const hit = wbCache.get(key);
  if (hit) { hit.t = now; return hit.p; }
  const p = factory();
  wbCache.set(key, { t: now, p });
  p.catch(() => wbCache.delete(key));
  while (wbCache.size > WB_MAX) wbCache.delete(wbCache.keys().next().value);
  return p;
}
const wbCachePut = (key, wb) => { wbCache.set(key, { t: Date.now(), p: Promise.resolve(wb) }); while (wbCache.size > WB_MAX) wbCache.delete(wbCache.keys().next().value); };
const parseWindow = (q) => {
  const from = Math.max(1, parseInt(q.from, 10) || 1);
  const to = Math.min(parseInt(q.to, 10) || from + 199, from + MAX_WINDOW - 1);
  return { from, to };
};

// MARKER_MENU_PERMISSION_CONFIG_V1 -- สิทธิ์ที่เข้าเมนูได้ ตั้งจากหน้า User Management > GL Access (ตาราง menu_permission_config)
//   ค่าเริ่มต้นของเมนู gl-ap-recon = Manual | IE | I-Pro | แถวในตารางแต่ละแถว = เปิด/ปิดสิทธิ์นั้นทับค่าเริ่มต้น | ผู้ใช้ที่มีสิทธิ์ใดสิทธิ์หนึ่งที่เปิดอยู่ เข้าได้
const MENU_PERM_DEFAULTS = { "gl-ap-recon": ["Manual", "IE", "I-Pro"] };
const ALL_PERM_KEYS = ["VAT", "I-Pro", "GL", "IE", "Function", "Manual"];
pool.query(`CREATE TABLE IF NOT EXISTS menu_permission_config (
  menu_key text NOT NULL, perm_key text NOT NULL, allowed boolean NOT NULL,
  updated_by text, updated_at timestamptz DEFAULT NOW(), PRIMARY KEY (menu_key, perm_key))`).catch((e) => console.error("[migrate menu_permission_config]", e.message));
let menuPermCache = { t: 0, rows: [] };
async function loadMenuPermRows(force) {
  if (!force && Date.now() - menuPermCache.t < 5000) return menuPermCache.rows;
  const q = await pool.query(`SELECT menu_key, perm_key, allowed FROM menu_permission_config`).catch(() => ({ rows: [] }));
  menuPermCache = { t: Date.now(), rows: q.rows };
  return q.rows;
}
async function effectiveMenuPerms(menuKey, force) {
  const set = new Set(MENU_PERM_DEFAULTS[menuKey] || []);
  (await loadMenuPermRows(force)).filter((r) => r.menu_key === menuKey).forEach((r) => { if (r.allowed) set.add(r.perm_key); else set.delete(r.perm_key); });
  return ALL_PERM_KEYS.filter((k) => set.has(k));
}

const validPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));

export default function registerApReport(router) {
  // MARKER_APRECONCILE_REPORT_PERMISSION_V1 -- ทุก Endpoint /report/* (Preview, ขอแถวเพิ่ม, Export, Export Book, Job, Books) ต้องเป็น Owner หรือมีสิทธิ์ Manual | IE | I-Pro อย่างใดอย่างหนึ่ง
  //   (ตรงกับเมนู GL Functional > Account Payable Recon. ที่ menuConfig.js ตั้ง requiredPermissions ไว้) | คนที่มีแต่สิทธิ์ GL เรียกไม่ได้
  //   สิทธิ์ที่เข้าได้ = ค่าที่ตั้งใน GL Access (menu_permission_config) ถ้าไม่เคยตั้ง = Manual | IE | I-Pro
  router.use("/report", async (req, res, next) => {
    try {
      const u = req.user || {};
      if (await glAccessFor(u)) return next(); // MARKER_GL_REPORT_OVERRIDE_V1 -- Owner | Override รายคน (GL) | Permission ใน GL Access
      const perms = await effectiveMenuPerms("gl-ap-recon");
      return res.status(403).json({ error: `ไม่มีสิทธิ์ใช้งาน AP Recon (ต้องมีสิทธิ์ ${perms.join(", ") || "—"})` });
    } catch (err) { return next(err); }
  });
  // อ่าน/ตั้งค่า "สิทธิ์ที่เข้าเมนูได้" (ใช้ที่ App.js และหน้า User Management > GL Access)
  router.get("/menu-permissions", async (req, res) => {
    try {
      const menus = {};
      const keys = new Set([...Object.keys(MENU_PERM_DEFAULTS), ...(await loadMenuPermRows(true)).map((r) => r.menu_key)]);
      for (const k of keys) menus[k] = await effectiveMenuPerms(k);
      res.json({ menus, all_permissions: ALL_PERM_KEYS });
    } catch (err) { res.status(500).json({ error: "โหลดสิทธิ์เมนูไม่สำเร็จ", detail: err.message }); }
  });
  router.put("/menu-permissions", async (req, res) => {
    try {
      const role = req.user?.appRole || "";
      if (role !== "Owner" && role !== "Admin") return res.status(403).json({ error: "ตั้งค่าได้เฉพาะ Owner / Admin" });
      const { menu_key, perm_key, allowed } = req.body || {};
      if (!MENU_PERM_DEFAULTS[menu_key] || !ALL_PERM_KEYS.includes(perm_key) || typeof allowed !== "boolean") return res.status(400).json({ error: "พารามิเตอร์ไม่ถูกต้อง" });
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      await pool.query(
        `INSERT INTO menu_permission_config (menu_key, perm_key, allowed, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (menu_key, perm_key) DO UPDATE SET allowed=EXCLUDED.allowed, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
        [menu_key, perm_key, allowed, username]);
      menuPermCache = { t: 0, rows: [] };
      res.json({ menu_key, permissions: await effectiveMenuPerms(menu_key, true) });
    } catch (err) { res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message }); }
  });
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
      res.set("Timing-Allow-Origin", "*"); // ให้ Browser อ่านเวลา รอ Server/ดาวน์โหลด ข้าม Origin ได้
      const only = req.query.account ? String(req.query.account) : null;
      if (only && !REPORT_ACCOUNTS.includes(only)) return res.status(400).json({ error: "Account ไม่อยู่ในรายการ" });
      const ctx = await loadBuContext(String(bu), period);
      const all = await cachedAll(ctx, period);
      const t1 = Date.now();
      const reportDate = new Date();
      const files = await Promise.all((only ? [only] : AP_DEFAULT_ACCOUNTS).map(async (account) => {
        const f = await buildOne(ctx, all, period, account, reportDate, false);
        wbCachePut(`ap|${ctx.bu}|${period}|${account}`, f.wb);
        const sheets = await pvLoadSheets(null, f.wb, { pagedAbove: PAGED_ABOVE, firstRows: FIRST_ROWS });
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

  // ขอแถวเพิ่มของชีตใหญ่ (ช่วงตามที่ Popup เลื่อนถึง) | ถ้า Workbook ที่เก็บไว้หมดอายุ -> สร้างใหม่จากฐานข้อมูลแล้วเก็บอีกรอบ
  router.get("/report/preview/rows", async (req, res) => {
    try {
      const { bu, period, account, sheet } = req.query;
      if (!bu || !validPeriod(period) || !REPORT_ACCOUNTS.includes(String(account)) || !sheet) return res.status(400).json({ error: "พารามิเตอร์ไม่ครบ" });
      const { from, to } = parseWindow(req.query);
      const ctx = await loadBuContext(String(bu), period);
      const wb = await wbCacheGet(`ap|${ctx.bu}|${period}|${account}`, async () => {
        const all = await cachedAll(ctx, period);
        return (await buildOne(ctx, all, period, String(account), new Date(), false)).wb;
      });
      const r = await pvLoadSheets(null, wb, { onlySheet: String(sheet), rowFrom: from, rowTo: to });
      const sh = r.sheets[0];
      res.json({ from, to, rows: sh ? sh.rows : [], styles: r.styles });
    } catch (err) {
      console.error("[apReconcile] report preview rows error:", err);
      res.status(err.status || 500).json({ error: "โหลดแถวเพิ่มไม่สำเร็จ", detail: err.message });
    }
  });

  // ดู (Preview) ได้เมื่อ: เป็นไฟล์ของตัวเอง | หรือ Confirm แล้ว และเป็น Owner / Admin (Admin ดูได้เฉพาะไฟล์ของ User ที่มีสิทธิ์ Manual | IE | I-Pro) -- ตรงกับ My Job / All Job
  const loadJobWb = async (req, id) => {
    const q = await pool.query(`SELECT file_name, file_path, owner_username, confirmed_at FROM file_storage WHERE id=$1 AND module=$2 AND status <> 'recycled'`, [id, AP_MODULE]);
    if (!q.rows.length) throw Object.assign(new Error("ไม่พบไฟล์"), { status: 404 });
    {
      const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
      const appRole = req.user?.appRole || "";
      let ok = q.rows[0].owner_username === username;
      if (!ok && q.rows[0].confirmed_at) {
        if (appRole === "Owner") ok = true;
        else if (appRole === "Admin") {
          const pr = await pool.query(`SELECT permissions FROM user_roles WHERE username=$1 LIMIT 1`, [q.rows[0].owner_username]);
          const pm = (pr.rows[0] && pr.rows[0].permissions) || {};
          ok = (await effectiveMenuPerms("gl-ap-recon")).some((k) => pm[k] === true);
        }
      }
      if (!ok) throw Object.assign(new Error("ไม่มีสิทธิ์ดูไฟล์นี้"), { status: 403 });
    }
    if (!fs.existsSync(q.rows[0].file_path)) throw Object.assign(new Error("ไฟล์บน Server ถูกลบหรือย้ายแล้ว"), { status: 410 });
    const wb = await wbCacheGet(`job|${id}|${q.rows[0].file_path}`, async () => { const w = new ExcelJS.Workbook(); await w.xlsx.readFile(q.rows[0].file_path); return w; });
    return { fileName: q.rows[0].file_name, wb };
  };
  router.get("/report/jobs/:id/preview/rows", async (req, res) => {
    try {
      if (!req.query.sheet) return res.status(400).json({ error: "ต้องระบุ sheet" });
      const { from, to } = parseWindow(req.query);
      const { wb } = await loadJobWb(req, req.params.id);
      const r = await pvLoadSheets(null, wb, { onlySheet: String(req.query.sheet), rowFrom: from, rowTo: to });
      const sh = r.sheets[0];
      res.json({ from, to, rows: sh ? sh.rows : [], styles: r.styles });
    } catch (err) {
      console.error("[apReconcile] job preview rows error:", err);
      res.status(err.status || 500).json({ error: err.message || "โหลดแถวเพิ่มไม่สำเร็จ" });
    }
  });

  // MARKER_APRECONCILE_REPORT_CONFIRM_V1 -- Confirm / Release / Download ไฟล์ AP Recon
  //   Confirm = เจ้าของไฟล์ยืนยันว่าตรวจแล้ว -> ไฟล์ขึ้นใน All Job (ดูอย่างเดียว) และ Download ได้ | Release = ยกเลิก Confirm (ปุ่มเดียวสลับสถานะ)
  //   ทำได้เฉพาะ "เจ้าของไฟล์" (All Job เป็นการดูอย่างเดียว ไม่มี Confirm/Download) | Export ใหม่ทับไฟล์เดิม = ต้อง Confirm ใหม่
  pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS confirmed_at timestamptz").catch(() => {});
  pool.query("ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS confirmed_by text").catch(() => {});
  const ownJob = async (req, res) => {
    const q = await pool.query(`SELECT id, owner_username, file_name, file_path, confirmed_at FROM file_storage WHERE id=$1 AND module=$2 AND status <> 'recycled'`, [req.params.id, AP_MODULE]);
    if (!q.rows.length) { res.status(404).json({ error: "ไม่พบไฟล์" }); return null; }
    const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
    if (q.rows[0].owner_username !== username) { res.status(403).json({ error: "ทำได้เฉพาะเจ้าของไฟล์ (My Job) — All Job ดูได้อย่างเดียว" }); return null; }
    return { rec: q.rows[0], username };
  };
  router.post("/report/jobs/:id/confirm", async (req, res) => {
    try {
      const o = await ownJob(req, res); if (!o) return;
      const up = await pool.query(`UPDATE file_storage SET confirmed_at=NOW(), confirmed_by=$1 WHERE id=$2 RETURNING id, confirmed_at, confirmed_by`, [o.username, o.rec.id]);
      let exp = null;
      try { exp = await stampApJobExpire(o.rec.id); } catch (e) { console.error("[apReconcile] stamp expire error:", e.message); } // MARKER_APRECONCILE_EXPIRE_V1 -- Confirm ราย Account (ไฟล์ที่ Gen ออกไปแต่ละ Account) -> ครบ 30 วันลบแถวข้อมูล AP ของ BU+Period+Account นั้น (ไม่ทำให้ Confirm ล้มถ้า Stamp พลาด)
      res.json({ ...up.rows[0], ...(exp || {}) });
    } catch (err) {
      console.error("[apReconcile] job confirm error:", err);
      res.status(500).json({ error: "Confirm ไม่สำเร็จ", detail: err.message });
    }
  });
  router.post("/report/jobs/:id/release", async (req, res) => {
    try {
      const o = await ownJob(req, res); if (!o) return;
      const up = await pool.query(`UPDATE file_storage SET confirmed_at=NULL, confirmed_by=NULL WHERE id=$1 RETURNING id, confirmed_at, confirmed_by`, [o.rec.id]);
      try { await clearApJobExpire(o.rec.id); } catch (e) { console.error("[apReconcile] clear expire error:", e.message); } // MARKER_APRECONCILE_EXPIRE_V1 -- Release = ยกเลิก Confirm -> ยกเลิกวันหมดอายุด้วย
      res.json(up.rows[0]);
    } catch (err) {
      console.error("[apReconcile] job release error:", err);
      res.status(500).json({ error: "Release ไม่สำเร็จ", detail: err.message });
    }
  });
  // MARKER_APRECONCILE_REPORT_DELETE_V1 -- ลบไฟล์ AP Recon ออกจาก My Job (เฉพาะเจ้าของไฟล์): ลบแถวใน file_storage + ไฟล์จริง
  router.delete("/report/jobs/:id", async (req, res) => {
    try {
      const o = await ownJob(req, res); if (!o) return;
      await pool.query(`DELETE FROM file_storage WHERE id=$1 AND module=$2`, [o.rec.id, AP_MODULE]);
      try { if (o.rec.file_path && fs.existsSync(o.rec.file_path)) fs.unlinkSync(o.rec.file_path); } catch (e) { console.warn("[apReconcile] job delete: ลบไฟล์จริงไม่สำเร็จ", e.message); }
      res.json({ ok: true, id: o.rec.id });
    } catch (err) {
      console.error("[apReconcile] job delete error:", err);
      res.status(500).json({ error: "ลบไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });
  // ไฟล์ AP Recon เก็บเป็น .xlsx ตรง ๆ (ไม่ได้ Gzip แบบ /file-storage/:id/download เดิม) จึงมี Endpoint Download ของตัวเอง | ยังไม่ Confirm = Download ไม่ได้
  router.get("/report/jobs/:id/download", async (req, res) => {
    try {
      const o = await ownJob(req, res); if (!o) return;
      if (!o.rec.confirmed_at) return res.status(403).json({ error: "ยังไม่ได้ Confirm ไฟล์ — กด Confirm ก่อนจึงจะ Download ได้" });
      if (!fs.existsSync(o.rec.file_path)) return res.status(410).json({ error: "ไฟล์บน Server ถูกลบหรือย้ายแล้ว" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(o.rec.file_name)}"; filename*=UTF-8''${encodeURIComponent(o.rec.file_name)}`);
      fs.createReadStream(o.rec.file_path).pipe(res);
    } catch (err) {
      console.error("[apReconcile] job download error:", err);
      res.status(500).json({ error: "Download ไม่สำเร็จ", detail: err.message });
    }
  });

  // Preview ไฟล์ Job ที่เก็บแล้ว (My Job / All Job) -- Parser เดียวกับ Input
  router.get("/report/jobs/:id/preview", async (req, res) => {
    try {
      const { fileName, wb } = await loadJobWb(req, req.params.id);
      res.json({ file_name: fileName, ...(await pvLoadSheets(null, wb, { pagedAbove: PAGED_ABOVE, firstRows: FIRST_ROWS })) });
    } catch (err) {
      console.error("[apReconcile] job preview error:", err);
      res.status(err.status || 500).json({ error: err.status ? err.message : "เปิด Preview ไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  // MARKER_APRECONCILE_AP_SETTING_V1 -- เฟืองใน Control Zone: ตั้งค่า Prepare by / Department ราย BU | kind=ap -> "AP Prepare By"/"AP Department" | kind=ie -> "IE Prepare By"/"IE Department" (company_list เดียวกับหน้า Business Unit)
  const SET_RE = { ap: { pb: /^\s*ap[\s_]*prepar/i, dp: /^\s*ap[\s_]*depart/i, pbName: "AP Prepare By", dpName: "AP Department" }, ie: { pb: /^\s*ie[\s_]*prepar/i, dp: /^\s*ie[\s_]*depart/i, pbName: "IE Prepare By", dpName: "IE Department" } };
  const kindOf = (v) => (String(v || "").toLowerCase() === "ie" ? "ie" : "ap");
  const findCompany = async (buInput) => (await pool.query(`SELECT * FROM company_list WHERE (bu = $1 OR "COMPANY CODE" LIKE '%-' || $1 || '-%') AND deleted IS NOT TRUE LIMIT 1`, [String(buInput)])).rows[0];
  router.get("/report/ap-setting/bus", async (req, res) => {
    try {
      const r = await pool.query(`SELECT bu, "COMPANY CODE" AS company_code FROM company_list WHERE deleted IS NOT TRUE AND bu IS NOT NULL ORDER BY bu`);
      // MARKER_APSETTING_NAME_OPTIONS_V1 -- รายชื่อไม่ซ้ำสำหรับ Dropdown Prepare by / Department (รวม 3 คอลัมน์: AP, IE, VAT)
      const all = await pool.query(`SELECT * FROM company_list WHERE deleted IS NOT TRUE`);
      const pbSet = new Set(); const dpSet = new Set();
      for (const row of all.rows) {
        const pbKeys = [pickKey(row, SET_RE.ap.pb), pickKey(row, SET_RE.ie.pb), pickKey(row, /^\s*prepar[e]?[\s_]*by\s*$/i)];
        const dpKeys = [pickKey(row, SET_RE.ap.dp), pickKey(row, SET_RE.ie.dp), pickKey(row, /^\s*department\s*$/i)];
        for (const k of pbKeys) { if (k && row[k] && String(row[k]).trim()) pbSet.add(String(row[k]).trim()); }
        for (const k of dpKeys) { if (k && row[k] && String(row[k]).trim()) dpSet.add(String(row[k]).trim()); }
      }
      const srt = (a) => [...a].sort((x, y) => x.localeCompare(y));
      res.json({ bus: r.rows.map((x) => ({ bu: x.bu, code: String(x.company_code || "").split("-")[2] || "" })), prepareOptions: srt(pbSet), departmentOptions: srt(dpSet) });
    } catch (err) { console.error("[apReconcile] ap-setting bus error:", err); res.status(500).json({ error: "โหลดรายชื่อ BU ไม่สำเร็จ", detail: err.message }); }
  });
  router.get("/report/ap-setting", async (req, res) => {
    try {
      const bu = String(req.query.bu || "").trim(); const kind = kindOf(req.query.kind);
      if (!bu) return res.status(400).json({ error: "ต้องระบุ bu" });
      const c = await findCompany(bu);
      if (!c) return res.status(404).json({ error: `ไม่พบ BU ${bu} ใน company_list` });
      const pb = pickKey(c, SET_RE[kind].pb); const dp = pickKey(c, SET_RE[kind].dp);
      res.json({ bu: c.bu, kind, prepareBy: pb && c[pb] ? String(c[pb]).trim() : "", department: dp && c[dp] ? String(c[dp]).trim() : "", columnsFound: !!(pb && dp), usedColumns: [pb, dp].filter(Boolean), nearColumns: Object.keys(c).filter((k) => /prepar|depart|setting|controller|ap[\s_]/i.test(k)) });
    } catch (err) { console.error("[apReconcile] ap-setting get error:", err); res.status(500).json({ error: "โหลดค่าตั้งไม่สำเร็จ", detail: err.message }); }
  });
  router.put("/report/ap-setting", async (req, res) => {
    try {
      const { bu, prepareBy, department } = req.body || {}; const kind = kindOf((req.body || {}).kind);
      if (!bu) return res.status(400).json({ error: "ต้องระบุ bu" });
      const c = await findCompany(bu);
      if (!c) return res.status(404).json({ error: `ไม่พบ BU ${bu} ใน company_list` });
      let pb = pickKey(c, SET_RE[kind].pb); let dp = pickKey(c, SET_RE[kind].dp);
      if (kind === "ie" && (!pb || !dp)) {
        // IE Setting: ไม่สร้างคอลัมน์เองเพื่อกันซ้ำกับคอลัมน์จริงที่ชื่อต่างออกไป -> แจ้งชื่อคอลัมน์ที่ใกล้เคียงให้ตรวจ
        const near = Object.keys(c).filter((k) => /prepar|depart/i.test(k));
        return res.status(409).json({ error: `ไม่พบคอลัมน์ IE Prepare By / IE Department ใน Master Data (คอลัมน์ใกล้เคียง: ${near.join(", ") || "ไม่มี"})` });
      }
      if (!pb) { await pool.query(`ALTER TABLE company_list ADD COLUMN IF NOT EXISTS "${SET_RE.ap.pbName}" text`); pb = SET_RE.ap.pbName; }
      if (!dp) { await pool.query(`ALTER TABLE company_list ADD COLUMN IF NOT EXISTS "${SET_RE.ap.dpName}" text`); dp = SET_RE.ap.dpName; }
      const q = (k) => `"${String(k).replace(/"/g, '""')}"`;
      await pool.query(`UPDATE company_list SET ${q(pb)} = $1, ${q(dp)} = $2 WHERE bu = $3 AND deleted IS NOT TRUE`, [String(prepareBy || "").trim() || null, String(department || "").trim() || null, c.bu]);
      console.log(`[apReconcile] ${kind}-setting bu=${c.bu} by=${req.user?.email || "?"}`);
      res.json({ ok: true, bu: c.bu, kind });
    } catch (err) { console.error("[apReconcile] ap-setting put error:", err); res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message }); }
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
        try { await ensureApExpireColumns(); } catch (_) { /* ignore */ } // MARKER_APRECONCILE_EXPIRE_V1
        row = (await pool.query(`UPDATE file_storage SET file_path=$1, file_name=$2, owner_username=$3, status='active', retention_days=NULL, created_at=NOW(), file_removed_at=NULL, confirmed_at=NULL, confirmed_by=NULL, expire_at=NULL, expire_lines=NULL, expire_purged=false WHERE id=$4 RETURNING id, bu, ref_id, file_name, owner_username, created_at`, [filePath, f.fileName, owner, old.rows[0].id])).rows[0];
      } else {
        row = (await pool.query(`INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days) VALUES ($1,$2,$3,$4,$5,$6,'active',NULL) RETURNING id, bu, ref_id, file_name, owner_username, created_at`, [AP_MODULE, ctx.bu, refId, filePath, f.fileName, owner])).rows[0];
      }
      out.push({ ...row, account, has_data: f.hasData, size_bytes: f.buf.length, replaced: old.rows.length > 0 });
    }
    return out;
  }
  const pickAccounts = (b) => (Array.isArray(b.accounts) && b.accounts.length ? b.accounts.map(String).filter((a) => REPORT_ACCOUNTS.includes(a)) : AP_DEFAULT_ACCOUNTS);

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