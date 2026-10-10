import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pool } from "../db.js";

// MARKER_VAT_RESULT_FOLDERS_V1
/**
 * Reconcile Results (VAT Control > Folder) -- เดือน > BU > (Folder ย่อย) > ไฟล์ แบบ Windows Explorer
 * Mount: router.use("/result-folders", ...) ใน vatReconcile.js  =>  /api/vat-reconcile/result-folders/...
 *
 *   GET    /months                         เดือนล่าสุด 2 เดือน (เดือนเก่ากว่านี้เข้าถึงผ่าน /search เท่านั้น)
 *   GET    /months/:period/bus             BU ที่มีข้อมูลในเดือนนั้น
 *   GET    /list?period=&bu=&folder=       Folder ย่อย + ไฟล์ ใน BU (หรือใน Folder ย่อย) พร้อม breadcrumb
 *   GET    /search?q=                      ค้นทุกเดือน (เดือน/BU/Folder/ไฟล์) สูงสุด 40 รายการ
 *   POST   /folders        {period,bu,parentId?,name}
 *   DELETE /folders/:id                    ลบ Folder (+ของข้างใน) -- เจ้าของ Folder และของข้างในต้องเป็นของตัวเองทั้งหมด / Owner,Admin ลบได้ทุกอย่าง
 *   POST   /upload         {fileName,fileBase64,folderId?,period?,bu?}   วางไฟล์ .xlsx (<=10MB) -- ไม่ส่ง period/bu/folderId = อ่านจากชื่อไฟล์ เลขBU_BU_รายงาน_Mon-YY.xlsx
 *   GET    /files/:id/download
 *   DELETE /files/:id                      เจ้าของไฟล์ หรือ Owner/Admin
 *
 * สิทธิ์: ต้องมี Permission VAT (หรือ Owner/Admin) จึงเห็นได้ทุกเดือน/ทุก BU และเพิ่ม (วางไฟล์/สร้าง Folder) ได้
 * ที่เก็บ: ไฟล์ Export เดิม = file_storage.module 'vat-reconcile-report' | ไฟล์ที่วาง = 'vat-result-upload'
 *         Disk: {FILE_STORAGE_ROOT}/{BU}/{YYYY-MM}/vat-result-upload/{uuid}.xlsx
 */
const MODULES = ["vat-reconcile-report", "vat-result-upload"];
const UPLOAD_MODULE = "vat-result-upload";
const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT || "C:\\apps\\fastapn-backend\\storage";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SEARCH_LIMIT = 40;
const FILE_LIMIT = 500;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const BU_RE = /^[A-Za-z0-9_-]{1,20}$/;
const BAD_NAME_RE = /[\\/:*?"<>|]/;
// เดือนอยู่ใน ref_id: ไฟล์ Export = '{account}|{YYYY-MM}|{template}' / ไฟล์ที่วาง = '{YYYY-MM}|{uuid}' (ตรงกับ Index idx_file_storage_vatresult_period_bu)
const PERIOD_SQL = `(CASE WHEN fs.module = 'vat-reconcile-report' THEN split_part(fs.ref_id, '|', 2) ELSE split_part(fs.ref_id, '|', 1) END)`;
const FILE_BASE = `fs.module = ANY($MODS) AND fs.status <> 'recycled'`;

async function getCtx(req) {
  const email = req.user && req.user.email;
  if (!email) return null;
  const { rows } = await pool.query(`SELECT username, role, permissions FROM user_roles WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
  const row = rows[0] || {};
  const appRole = req.user.appRole || row.role || "";
  const privileged = appRole === "Owner" || appRole === "Admin";
  const v = row.permissions && row.permissions.VAT;
  const canVat = privileged || v === true || v === "true" || v === 1;
  return { username: row.username || email, privileged, canVat };
}

async function statSize(p) {
  try { return (await fs.promises.stat(p)).size; } catch (_) { return null; }
}

// path ของ Folder ย่อย (จากรากไปหา Folder นี้) พร้อมตรวจว่าอยู่ใน period/bu ที่ระบุ
async function folderPath(folderId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, name, period, bu, 0 AS lvl FROM vat_result_folder WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id, f.name, f.period, f.bu, up.lvl + 1 FROM vat_result_folder f JOIN up ON f.id = up.parent_id
     ) SELECT id, name, period, bu FROM up ORDER BY lvl DESC`, [folderId]);
  return rows;
}

const fileItem = async (r, ctx) => ({
  kind: "file", id: r.id, name: r.file_name, size_bytes: await statSize(r.file_path),
  created_by: r.owner_username, updated_at: r.created_at,
  can_delete: ctx.privileged || r.owner_username === ctx.username,
  // MARKER_VRF_SP_STATUS_V1 -- สถานะส่ง SharePoint (ไฟล์ Report ที่กด Confirm ส่งแล้ว) | file_removed = สำเนาบน Server ถูกลบแล้ว (เปิดได้จากลิงก์ SharePoint เท่านั้น)
  sp_url: r.sp_url || null, sp_sent_at: r.sp_sent_at || null, sp_sent_by: r.sp_sent_by || null, file_removed: !!r.file_removed_at,
});
const folderItem = (r, ctx) => ({
  kind: "folder", id: r.id, name: r.name, created_by: r.created_by, updated_at: r.created_at,
  can_delete: ctx.privileged || r.created_by === ctx.username,
});

function parseFileName(name) {
  const m = /^(?:(\d+)_)?([A-Za-z0-9-]+)_(.+)_([A-Za-z]{3})-(\d{2})\.xlsx$/i.exec(name);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[4].toUpperCase());
  if (mi < 0) return null;
  return { bu: m[2].toUpperCase(), report: m[3], period: `20${m[5]}-${String(mi + 1).padStart(2, "0")}` };
}

const likeEsc = (s) => "%" + String(s).replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export default function createVatResultFoldersRouter() {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const ctx = await getCtx(req);
      if (!ctx) return res.status(401).json({ error: "กรุณา Login" });
      if (!ctx.canVat) return res.status(403).json({ error: "ต้องมีสิทธิ์ VAT จึงเข้า Folder นี้ได้" });
      req.ctx = ctx;
      next();
    } catch (err) {
      console.error("[vatResultFolders] auth error:", err);
      res.status(500).json({ error: "ตรวจสิทธิ์ไม่สำเร็จ", detail: err.message });
    }
  });
  const fail = (res, tag, err) => { console.error(`[vatResultFolders] ${tag}:`, err); res.status(500).json({ error: "เกิดข้อผิดพลาด", detail: err.message }); };

  // ── เดือนล่าสุด 2 เดือน ──
  router.get("/months", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT period, MAX(ts) AS updated_at FROM (
           SELECT ${PERIOD_SQL} AS period, fs.created_at AS ts FROM file_storage fs WHERE ${FILE_BASE.replace("$MODS", "$1")}
           UNION ALL SELECT period, created_at FROM vat_result_folder
         ) x WHERE period ~ '^[0-9]{4}-[0-9]{2}$' GROUP BY period ORDER BY period DESC LIMIT 2`, [MODULES]);
      res.json({ months: rows.map((r) => ({ period: r.period, updated_at: r.updated_at })) });
    } catch (err) { fail(res, "months", err); }
  });

  // ── BU ในเดือน ──
  router.get("/months/:period/bus", async (req, res) => {
    try {
      const { period } = req.params;
      if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period ไม่ถูกต้อง (YYYY-MM)" });
      const { rows } = await pool.query(
        `SELECT bu, MAX(ts) AS updated_at FROM (
           SELECT fs.bu AS bu, fs.created_at AS ts FROM file_storage fs WHERE ${FILE_BASE.replace("$MODS", "$1")} AND ${PERIOD_SQL} = $2
           UNION ALL SELECT bu, created_at FROM vat_result_folder WHERE period = $2
         ) x WHERE bu IS NOT NULL GROUP BY bu ORDER BY bu`, [MODULES, period]);
      res.json({ period, bus: rows.map((r) => ({ bu: r.bu, updated_at: r.updated_at })) });
    } catch (err) { fail(res, "bus", err); }
  });

  // ── รายการใน BU / Folder ย่อย ──
  router.get("/list", async (req, res) => {
    try {
      const { period, bu } = req.query;
      const folder = req.query.folder ? String(req.query.folder) : null;
      if (!PERIOD_RE.test(String(period || "")) || !BU_RE.test(String(bu || ""))) return res.status(400).json({ error: "ต้องระบุ period (YYYY-MM) และ bu ให้ถูกต้อง" });
      let crumbs = [];
      if (folder) {
        if (!UUID_RE.test(folder)) return res.status(400).json({ error: "folder ไม่ถูกต้อง" });
        crumbs = await folderPath(folder);
        if (!crumbs.length || crumbs[0].period !== period || crumbs[0].bu !== bu) return res.status(404).json({ error: "ไม่พบ Folder" });
      }
      const fRows = (await pool.query(
        `SELECT id, name, created_by, created_at FROM vat_result_folder WHERE period = $1 AND bu = $2 AND parent_id IS NOT DISTINCT FROM $3::uuid ORDER BY lower(name)`,
        [period, bu, folder])).rows;
      const base = `SELECT fs.id, fs.file_name, fs.file_path, fs.owner_username, fs.created_at, fs.sp_url, fs.sp_sent_at, fs.sp_sent_by, fs.file_removed_at FROM file_storage fs`;
      const where = `${FILE_BASE.replace("$MODS", "$1")} AND fs.bu = $2 AND ${PERIOD_SQL} = $3`;
      const fileRows = folder
        ? (await pool.query(`${base} JOIN vat_result_file_link l ON l.file_id = fs.id WHERE ${where} AND l.folder_id = $4 ORDER BY fs.created_at DESC LIMIT ${FILE_LIMIT}`, [MODULES, bu, period, folder])).rows
        : (await pool.query(`${base} LEFT JOIN vat_result_file_link l ON l.file_id = fs.id WHERE ${where} AND l.file_id IS NULL ORDER BY fs.created_at DESC LIMIT ${FILE_LIMIT}`, [MODULES, bu, period])).rows;
      const files = await Promise.all(fileRows.map((r) => fileItem(r, req.ctx)));
      res.json({ period, bu, folder, crumbs: crumbs.map((c) => ({ id: c.id, name: c.name })), folders: fRows.map((r) => folderItem(r, req.ctx)), files });
    } catch (err) { fail(res, "list", err); }
  });

  // ── ค้นหาทุกเดือน ──
  router.get("/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json({ items: [] });
      const qLike = likeEsc(q), pLike = likeEsc(q.replace(/\./g, "-"));
      const out = [];
      const mons = await pool.query(
        `SELECT DISTINCT period FROM (SELECT ${PERIOD_SQL} AS period FROM file_storage fs WHERE ${FILE_BASE.replace("$MODS", "$1")} UNION SELECT period FROM vat_result_folder) x
          WHERE period ~ '^[0-9]{4}-[0-9]{2}$' AND period ILIKE $2 ORDER BY period DESC LIMIT ${SEARCH_LIMIT}`, [MODULES, pLike]);
      mons.rows.forEach((r) => out.push({ kind: "month", period: r.period, name: r.period, location: "Reconcile Results" }));
      const bus = await pool.query(
        `SELECT DISTINCT period, bu FROM (SELECT ${PERIOD_SQL} AS period, fs.bu AS bu FROM file_storage fs WHERE ${FILE_BASE.replace("$MODS", "$1")} UNION SELECT period, bu FROM vat_result_folder) x
          WHERE period ~ '^[0-9]{4}-[0-9]{2}$' AND (bu ILIKE $2 OR (period || ' ' || bu) ILIKE $3) ORDER BY period DESC, bu LIMIT ${SEARCH_LIMIT}`, [MODULES, qLike, pLike]);
      bus.rows.forEach((r) => out.push({ kind: "bu", period: r.period, bu: r.bu, name: r.bu, location: `Reconcile Results › ${r.period}` }));
      const fol = await pool.query(`SELECT id, period, bu, name, created_by, created_at FROM vat_result_folder WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT ${SEARCH_LIMIT}`, [qLike]);
      for (const r of fol.rows) {
        const crumbs = await folderPath(r.id);
        out.push({ ...folderItem(r, req.ctx), period: r.period, bu: r.bu, parent: crumbs.slice(0, -1).length ? crumbs[crumbs.length - 2].id : null, location: ["Reconcile Results", r.period, r.bu, ...crumbs.slice(0, -1).map((c) => c.name)].join(" › ") });
      }
      const fil = await pool.query(
        `SELECT fs.id, fs.file_name, fs.file_path, fs.owner_username, fs.created_at, fs.sp_url, fs.sp_sent_at, fs.sp_sent_by, fs.file_removed_at, fs.bu, ${PERIOD_SQL} AS period, l.folder_id
           FROM file_storage fs LEFT JOIN vat_result_file_link l ON l.file_id = fs.id
          WHERE ${FILE_BASE.replace("$MODS", "$1")} AND (fs.file_name ILIKE $2 OR fs.bu ILIKE $2 OR ${PERIOD_SQL} ILIKE $3)
          ORDER BY fs.created_at DESC LIMIT ${SEARCH_LIMIT}`, [MODULES, qLike, pLike]);
      for (const r of fil.rows) {
        const crumbs = r.folder_id ? await folderPath(r.folder_id) : [];
        out.push({ ...(await fileItem(r, req.ctx)), period: r.period, bu: r.bu, folder: r.folder_id || null, location: ["Reconcile Results", r.period, r.bu, ...crumbs.map((c) => c.name)].join(" › ") });
      }
      res.json({ items: out.slice(0, SEARCH_LIMIT), truncated: out.length > SEARCH_LIMIT });
    } catch (err) { fail(res, "search", err); }
  });

  // ── สร้าง Folder ย่อย ──
  router.post("/folders", async (req, res) => {
    try {
      const { period, bu, parentId } = req.body || {};
      const name = String((req.body || {}).name || "").trim();
      if (!PERIOD_RE.test(String(period || "")) || !BU_RE.test(String(bu || ""))) return res.status(400).json({ error: "ต้องระบุ period และ bu ให้ถูกต้อง" });
      if (!name) return res.status(400).json({ error: "กรุณาตั้งชื่อ Folder" });
      if (name.length > 100) return res.status(400).json({ error: "ชื่อ Folder ยาวเกิน 100 ตัวอักษร" });
      if (BAD_NAME_RE.test(name)) return res.status(400).json({ error: 'ห้ามใช้อักขระ \\ / : * ? " < > |' });
      if (parentId) {
        if (!UUID_RE.test(String(parentId))) return res.status(400).json({ error: "parentId ไม่ถูกต้อง" });
        const pp = await folderPath(parentId);
        if (!pp.length || pp[0].period !== period || pp[0].bu !== bu) return res.status(404).json({ error: "ไม่พบ Folder ต้นทาง" });
      }
      try {
        const { rows } = await pool.query(
          `INSERT INTO vat_result_folder (period, bu, parent_id, name, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, created_by, created_at`,
          [period, bu, parentId || null, name, req.ctx.username]);
        res.json({ folder: folderItem(rows[0], req.ctx) });
      } catch (e) {
        if (e.code === "23505") return res.status(409).json({ error: "มี Folder ชื่อนี้อยู่แล้ว" });
        throw e;
      }
    } catch (err) { fail(res, "create folder", err); }
  });

  // ── ลบ Folder (+ของข้างใน) ──
  router.delete("/folders/:id", async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    const client = await pool.connect();
    let diskFiles = [];
    try {
      const tree = (await client.query(
        `WITH RECURSIVE t AS (SELECT id, created_by, 0 AS depth FROM vat_result_folder WHERE id = $1
           UNION ALL SELECT f.id, f.created_by, t.depth + 1 FROM vat_result_folder f JOIN t ON f.parent_id = t.id)
         SELECT id, created_by, depth FROM t ORDER BY depth DESC`, [id])).rows;
      if (!tree.length) return res.status(404).json({ error: "ไม่พบ Folder" });
      const folderIds = tree.map((r) => r.id);
      const files = (await client.query(
        `SELECT fs.id, fs.file_path, fs.owner_username FROM vat_result_file_link l JOIN file_storage fs ON fs.id = l.file_id WHERE l.folder_id = ANY($1::uuid[])`, [folderIds])).rows;
      const me = req.ctx;
      if (!me.privileged) {
        if (tree.some((r) => r.created_by !== me.username) || files.some((f) => f.owner_username !== me.username))
          return res.status(403).json({ error: "ลบไม่ได้: Folder นี้หรือของข้างในมีรายการที่ผู้อื่นสร้างไว้ (ลบได้เฉพาะ Admin/Owner)" });
      }
      await client.query("BEGIN");
      if (files.length) await client.query(`DELETE FROM file_storage WHERE id = ANY($1::uuid[])`, [files.map((f) => f.id)]);
      for (const r of tree) await client.query(`DELETE FROM vat_result_folder WHERE id = $1`, [r.id]); // ลึกสุดก่อน (ON DELETE RESTRICT)
      await client.query("COMMIT");
      diskFiles = files.map((f) => f.file_path);
      res.json({ ok: true, deleted_folders: tree.length, deleted_files: files.length });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) { /* ไม่มี Transaction ค้าง */ }
      fail(res, "delete folder", err);
    } finally {
      client.release();
      for (const p of diskFiles) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { console.error("[vatResultFolders] ลบไฟล์บน Disk ไม่สำเร็จ:", e.message); } }
    }
  });

  // ── วางไฟล์ ──
  router.post("/upload", async (req, res) => {
    try {
      const body = req.body || {};
      let fileName = path.basename(String(body.fileName || "").replace(/\\/g, "/")).trim();
      if (!fileName || !body.fileBase64) return res.status(400).json({ error: "ต้องมี fileName และ fileBase64" });
      if (!/\.xlsx$/i.test(fileName)) return res.status(415).json({ error: "รับเฉพาะไฟล์ .xlsx" });
      if (fileName.length > 150 || BAD_NAME_RE.test(fileName)) return res.status(400).json({ error: 'ชื่อไฟล์ไม่ถูกต้อง (ยาวเกิน 150 ตัวอักษร หรือมี \\ / : * ? " < > |)' });
      const buf = Buffer.from(String(body.fileBase64), "base64");
      if (!buf.length) return res.status(400).json({ error: "ไฟล์ว่างเปล่า" });
      if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return res.status(415).json({ error: "ไฟล์ไม่ใช่ .xlsx ที่ถูกต้อง" });

      // ปลายทาง: Folder ที่ระบุ > period+bu ที่ระบุ > อ่านจากชื่อไฟล์
      let period, bu, folderId = null;
      if (body.folderId) {
        if (!UUID_RE.test(String(body.folderId))) return res.status(400).json({ error: "folderId ไม่ถูกต้อง" });
        const fp = await folderPath(body.folderId);
        if (!fp.length) return res.status(404).json({ error: "ไม่พบ Folder ปลายทาง" });
        period = fp[0].period; bu = fp[0].bu; folderId = body.folderId;
      } else if (body.period || body.bu) {
        period = String(body.period || ""); bu = String(body.bu || "");
        if (!PERIOD_RE.test(period) || !BU_RE.test(bu)) return res.status(400).json({ error: "period/bu ปลายทางไม่ถูกต้อง" });
      } else {
        const p = parseFileName(fileName);
        if (!p) return res.status(422).json({ needDest: true, error: "อ่านเดือน/BU จากชื่อไฟล์ไม่ได้ (รูปแบบ เลขBU_BU_รายงาน_Mon-YY.xlsx) — กรุณาเลือกปลายทางเอง" });
        period = p.period; bu = p.bu;
      }

      // ชื่อซ้ำในที่เดียวกัน = แทนที่ (ต้องมีสิทธิ์ลบไฟล์เดิมนั้น)
      const dup = (await pool.query(
        `SELECT fs.id, fs.file_path, fs.owner_username FROM file_storage fs LEFT JOIN vat_result_file_link l ON l.file_id = fs.id
          WHERE ${FILE_BASE.replace("$MODS", "$1")} AND fs.bu = $2 AND ${PERIOD_SQL} = $3 AND lower(fs.file_name) = lower($4)
            AND l.folder_id IS NOT DISTINCT FROM $5::uuid LIMIT 1`, [MODULES, bu, period, fileName, folderId])).rows[0];
      if (dup) {
        if (!req.ctx.privileged && dup.owner_username !== req.ctx.username)
          return res.status(409).json({ error: `มีไฟล์ชื่อนี้ที่ ${dup.owner_username} สร้างไว้แล้ว — แทนที่ไม่ได้ (เปลี่ยนชื่อไฟล์ หรือให้เจ้าของ/Admin ลบก่อน)` });
        await fs.promises.mkdir(path.dirname(dup.file_path), { recursive: true });
        await fs.promises.writeFile(dup.file_path, buf);
        const r = (await pool.query(`UPDATE file_storage SET created_at = NOW(), owner_username = $2 WHERE id = $1 RETURNING id, file_name, file_path, owner_username, created_at`, [dup.id, req.ctx.username])).rows[0];
        return res.json({ file: { ...(await fileItem(r, req.ctx)), period, bu, folder: folderId, replaced: true } });
      }

      const safeSeg = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_");
      const uid = crypto.randomUUID();
      const dir = path.join(STORAGE_ROOT, safeSeg(bu), period, UPLOAD_MODULE);
      const filePath = path.join(dir, `${uid}.xlsx`);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, buf);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = (await client.query(
          `INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days)
           VALUES ($1,$2,$3,$4,$5,$6,'active',NULL) RETURNING id, file_name, file_path, owner_username, created_at`,
          [UPLOAD_MODULE, bu, `${period}|${uid}`, filePath, fileName, req.ctx.username])).rows[0];
        if (folderId) await client.query(`INSERT INTO vat_result_file_link (file_id, folder_id) VALUES ($1,$2)`, [r.id, folderId]);
        await client.query("COMMIT");
        res.json({ file: { ...(await fileItem(r, req.ctx)), period, bu, folder: folderId, replaced: false } });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) { /* ไม่มี Transaction ค้าง */ }
        try { fs.unlinkSync(filePath); } catch (_) { /* ไม่มีไฟล์ให้ลบ */ }
        throw e;
      } finally { client.release(); }
    } catch (err) { fail(res, "upload", err); }
  });

  const getFile = async (id) => {
    if (!UUID_RE.test(String(id))) return null;
    return (await pool.query(`SELECT fs.id, fs.file_name, fs.file_path, fs.owner_username FROM file_storage fs WHERE fs.id = $1 AND fs.module = ANY($2) AND fs.status <> 'recycled'`, [id, MODULES])).rows[0] || null;
  };

  router.get("/files/:id/download", async (req, res) => {
    try {
      const f = await getFile(req.params.id);
      if (!f) return res.status(404).json({ error: "ไม่พบไฟล์" });
      if (!fs.existsSync(f.file_path)) return res.status(410).json({ error: "สำเนาบน Server ถูกลบแล้ว (เก็บ 30 วันหลังส่ง) — เปิดไฟล์จาก SharePoint แทน" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${f.file_name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`);
      fs.createReadStream(f.file_path).pipe(res);
    } catch (err) { fail(res, "download", err); }
  });

  router.delete("/files/:id", async (req, res) => {
    try {
      const f = await getFile(req.params.id);
      if (!f) return res.status(404).json({ error: "ไม่พบไฟล์" });
      if (!req.ctx.privileged && f.owner_username !== req.ctx.username) return res.status(403).json({ error: "ลบได้เฉพาะไฟล์ที่ตัวเองสร้าง (หรือ Admin/Owner)" });
      try { if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path); } catch (e) { console.error("[vatResultFolders] ลบไฟล์บน Disk ไม่สำเร็จ:", e.message); }
      await pool.query(`DELETE FROM file_storage WHERE id = $1`, [f.id]);
      res.json({ ok: true });
    } catch (err) { fail(res, "delete file", err); }
  });

  return router;
}
