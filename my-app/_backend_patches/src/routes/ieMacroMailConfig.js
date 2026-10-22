// ieMacroMailConfig.js -- MARKER_IE_MACROMAIL_CONFIG_ROUTER_V2
// Mail Manage ของหน้า "Generate by Macro Logic" (I-Expense) -- โครงเดียวกับ VAT (vat_mail_draft / vat_mail_config.draft_id)
//   ie_macrologic_mail_template : Draft Template กลาง (Subject/Body + Placeholder) ใช้ร่วมกันได้หลาย Config -- แก้ที่เดียวมีผลทุก Config ที่ผูกอยู่
//   ie_macrologic_mail_config   : Config ต่อ (ประเภทรายงาน + BU) = To / CC / ชื่อผู้รับ / แนบไฟล์ + template_id
//   ie_macrologic_mail_log      : ประวัติ Draft ที่สร้างแล้ว พร้อม Source (Job/ไฟล์ที่มา, เปิดจากหน้าไหน, Config+Template ที่ใช้)
// GET    /api/ie-macrologic-mail/templates?report_type=PREPAYMENT          -> { items: [{..., used_by}] }
// PUT    /api/ie-macrologic-mail/template   { id?, report_type, name, subject_template, body_template }
// DELETE /api/ie-macrologic-mail/template/:id                              (409 ถ้ายังมี Config ใช้อยู่)
// GET    /api/ie-macrologic-mail/config?report_type=PREPAYMENT&bu=CTD      -> { config|null, template }
// GET    /api/ie-macrologic-mail/list?report_type=PREPAYMENT               -> { items } (ทุก BU ที่ตั้งค่าไว้)
// PUT    /api/ie-macrologic-mail/config     { report_type, bu, to_emails, cc_emails, greeting_name, attach_file, template_id }
// DELETE /api/ie-macrologic-mail/config?report_type=PREPAYMENT&bu=CTD
// POST   /api/ie-macrologic-mail/draft      { report_type, bu, source_job_id, source_file_name, source_origin, config_snapshot, to_emails, cc_emails, subject, body_html, body_text, summary }
// GET    /api/ie-macrologic-mail/drafts?report_type=PREPAYMENT&bu=CTD&limit=50 -> { items } (ไม่รวม body)
// GET    /api/ie-macrologic-mail/draft/:id  -> { draft } (รวม body)
// DELETE /api/ie-macrologic-mail/draft/:id
import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";

const router = Router();
const REPORT_TYPES = ["PREPAYMENT"]; // เพิ่มประเภทรายงานใหม่ที่นี่ที่เดียว
const MAIL_RE = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/;
const AGING_TOKEN = "{Prepayment_Aging}"; // Placeholder ตารางสรุป -- ล็อกเป็นบรรทัดสุดท้ายของ Body เสมอ
const DEFAULT_SUBJECT = "{BU} - ขอจัดส่งรายละเอียด Prepayment ตั้งแต่ {Min_Date} - {Max_Date}";
const DEFAULT_BODY = "เรียน {greeting_name}\n\nรบกวนตรวจสอบรายการ Prepayment ที่ค้างตามตารางด้านล่าง";

const lockBody = (t) => `${String(t || "").replace(/\{Prepayment_Aging\}/gi, "").replace(/\s+$/, "")}\n${AGING_TOKEN}`;

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ie_macrologic_mail_template (
      id bigserial PRIMARY KEY,
      report_type text NOT NULL,
      name text NOT NULL,
      subject_template text NOT NULL DEFAULT '',
      body_template text NOT NULL DEFAULT '',
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (report_type, name))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ie_macrologic_mail_config (
      report_type text NOT NULL,
      bu text NOT NULL,
      to_emails text NOT NULL DEFAULT '',
      cc_emails text NOT NULL DEFAULT '',
      greeting_name text NOT NULL DEFAULT '',
      attach_file boolean NOT NULL DEFAULT true,
      template_id bigint,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (report_type, bu))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ie_macrologic_mail_log (
      id bigserial PRIMARY KEY,
      report_type text NOT NULL,
      bu text NOT NULL,
      source_type text NOT NULL DEFAULT 'IE_MACROLOGIC_JOB',
      source_job_id text,
      source_file_name text,
      source_origin text,
      config_snapshot jsonb,
      to_emails text NOT NULL DEFAULT '',
      cc_emails text NOT NULL DEFAULT '',
      subject text NOT NULL DEFAULT '',
      body_html text NOT NULL DEFAULT '',
      body_text text NOT NULL DEFAULT '',
      summary jsonb,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`ALTER TABLE ie_macrologic_mail_config ADD COLUMN IF NOT EXISTS subject_template text, ADD COLUMN IF NOT EXISTS body_template text`); // MARKER_IE_MACROMAIL_CONFIG_OWN_TEMPLATE_V1 -- Subject/เนื้อหาเก็บใน Config ต่อ (ประเภทรายงาน + BU) เลย (NULL = ใช้ Draft Template เดิมเป็นค่าเริ่มต้น)
    await pool.query(`CREATE INDEX IF NOT EXISTS ie_macrologic_mail_log_type_bu_idx ON ie_macrologic_mail_log (report_type, bu, created_at DESC)`);
    // Seed Template เริ่มต้นของแต่ละประเภทรายงาน (ถ้ายังไม่มีเลย)
    for (const t of REPORT_TYPES) {
      await pool.query(
        `INSERT INTO ie_macrologic_mail_template (report_type, name, subject_template, body_template, updated_by)
         SELECT $1, 'Default', $2, $3, 'system'
         WHERE NOT EXISTS (SELECT 1 FROM ie_macrologic_mail_template WHERE report_type = $1)`,
        [t, DEFAULT_SUBJECT, lockBody(DEFAULT_BODY)]);
    }
  } catch (e) { console.error("[migrate ie_macrologic_mail_*]:", e.message); }
})();

function dedupeMails(t) {
  const seen = new Set(); const out = [];
  String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).forEach((m) => {
    const k = m.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(m); }
  });
  return out;
}
const normType = (v) => String(v || "").trim().toUpperCase();
const normBu = (v) => String(v || "").trim();
const CFG_COLS = "report_type, bu, to_emails, cc_emails, greeting_name, attach_file, template_id, updated_by, updated_at";
const TPL_COLS = "id, report_type, name, subject_template, body_template, updated_by, updated_at";
const DRAFT_LIST_COLS = "id, report_type, bu, source_type, source_job_id, source_file_name, source_origin, to_emails, cc_emails, subject, summary, created_by, created_at";
const fail = (res, tag, err) => { console.error(tag, err); res.status(500).json({ error: err.message || "Internal server error" }); };

// ── Template ────────────────────────────────────────────────────────────────
router.get("/templates", async (req, res) => {
  try {
    const type = normType(req.query && req.query.report_type);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    const { rows } = await pool.query(
      `SELECT t.id, t.report_type, t.name, t.subject_template, t.body_template, t.updated_by, t.updated_at,
         (SELECT count(*)::int FROM ie_macrologic_mail_config c WHERE c.template_id = t.id) AS used_by
       FROM ie_macrologic_mail_template t WHERE t.report_type = $1 ORDER BY t.id`, [type]);
    res.json({ items: rows });
  } catch (err) { fail(res, "GET /ie-macrologic-mail/templates error:", err); }
});

router.put("/template", async (req, res) => {
  try {
    const b = req.body || {};
    const type = normType(b.report_type);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    const name = String(b.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "ตั้งชื่อ Draft ก่อน" });
    const subject = String(b.subject_template || "").trim().slice(0, 300);
    const body = lockBody(String(b.body_template || "").slice(0, 10000));
    const username = await getUsernameByEmail(req.user.email);
    const id = b.id ? parseInt(b.id, 10) : null;
    let row;
    if (id) {
      const r = await pool.query(
        `UPDATE ie_macrologic_mail_template SET name = $2, subject_template = $3, body_template = $4, updated_by = $5, updated_at = now()
         WHERE id = $1 AND report_type = $6 RETURNING ${TPL_COLS}`, [id, name, subject, body, username, type]);
      row = r.rows[0];
      if (!row) return res.status(404).json({ error: "ไม่พบ Draft Template" });
    } else {
      const r = await pool.query(
        `INSERT INTO ie_macrologic_mail_template (report_type, name, subject_template, body_template, updated_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${TPL_COLS}`, [type, name, subject, body, username]);
      row = r.rows[0];
    }
    res.json({ ok: true, template: row });
  } catch (err) {
    if (err && err.code === "23505") return res.status(409).json({ error: "มี Draft ชื่อนี้อยู่แล้ว" });
    fail(res, "PUT /ie-macrologic-mail/template error:", err);
  }
});

router.delete("/template/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    const used = await pool.query(`SELECT count(*)::int AS n FROM ie_macrologic_mail_config WHERE template_id = $1`, [id]);
    if (used.rows[0].n > 0) return res.status(409).json({ error: `ลบไม่ได้ — ยังมี ${used.rows[0].n} Config ใช้ Draft นี้อยู่` });
    const t = await pool.query(`SELECT report_type FROM ie_macrologic_mail_template WHERE id = $1`, [id]);
    if (!t.rows[0]) return res.status(404).json({ error: "ไม่พบ Draft Template" });
    const left = await pool.query(`SELECT count(*)::int AS n FROM ie_macrologic_mail_template WHERE report_type = $1`, [t.rows[0].report_type]);
    if (left.rows[0].n <= 1) return res.status(409).json({ error: "ต้องเหลือ Draft Template อย่างน้อย 1 ชุด" });
    await pool.query(`DELETE FROM ie_macrologic_mail_template WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) { fail(res, "DELETE /ie-macrologic-mail/template error:", err); }
});

// ── Config ต่อ (ประเภทรายงาน + BU) ───────────────────────────────────────────
async function templateFor(type, templateId) {
  if (templateId) {
    const r = await pool.query(`SELECT ${TPL_COLS} FROM ie_macrologic_mail_template WHERE id = $1 AND report_type = $2`, [templateId, type]);
    if (r.rows[0]) return r.rows[0];
  }
  const d = await pool.query(`SELECT ${TPL_COLS} FROM ie_macrologic_mail_template WHERE report_type = $1 ORDER BY id LIMIT 1`, [type]);
  return d.rows[0] || null;
}

// MARKER_IE_MACROMAIL_CONFIG_OWN_TEMPLATE_V1 -- รวม Subject/เนื้อหาของ Config เอง (ถ้ามี) ทับ Draft Template ค่าเริ่มต้น
const CFG_SEL = `${CFG_COLS}, subject_template, body_template`;
function mergeOwnTpl(cfg, tpl) {
  if (!cfg) return tpl;
  const hasS = cfg.subject_template !== null && cfg.subject_template !== undefined;
  const hasB = cfg.body_template !== null && cfg.body_template !== undefined;
  if (!hasS && !hasB) return tpl;
  return { ...(tpl || {}), subject_template: hasS ? cfg.subject_template : (tpl && tpl.subject_template) || "", body_template: hasB ? cfg.body_template : (tpl && tpl.body_template) || "" };
}

router.get("/config", async (req, res) => {
  try {
    const type = normType(req.query && req.query.report_type);
    const bu = normBu(req.query && req.query.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    if (!bu) return res.status(400).json({ error: "ไม่ระบุ BU" });
    const { rows } = await pool.query(`SELECT ${CFG_SEL} FROM ie_macrologic_mail_config WHERE report_type = $1 AND bu = $2`, [type, bu]);
    const cfg = rows[0] || null;
    res.json({ config: cfg, template: mergeOwnTpl(cfg, await templateFor(type, cfg && cfg.template_id)) });
  } catch (err) { fail(res, "GET /ie-macrologic-mail/config error:", err); }
});

router.get("/list", async (req, res) => {
  try {
    const type = normType(req.query && req.query.report_type);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    const { rows } = await pool.query(`SELECT ${CFG_COLS} FROM ie_macrologic_mail_config WHERE report_type = $1 ORDER BY bu`, [type]);
    res.json({ items: rows });
  } catch (err) { fail(res, "GET /ie-macrologic-mail/list error:", err); }
});

router.put("/config", async (req, res) => {
  try {
    const b = req.body || {};
    const type = normType(b.report_type);
    const bu = normBu(b.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    if (!bu || bu.length > 60) return res.status(400).json({ error: "ไม่ระบุ BU" });
    const to = dedupeMails(b.to_emails); const cc = dedupeMails(b.cc_emails);
    const bad = [...to, ...cc].filter((m) => !MAIL_RE.test(m));
    if (bad.length) return res.status(400).json({ error: "รูปแบบอีเมลไม่ถูกต้อง: " + bad.join(", ") });
    const greeting = String(b.greeting_name || "").trim().slice(0, 200);
    const attachFile = b.attach_file === false || b.attach_file === "false" ? false : true;
    const tpl = await templateFor(type, b.template_id ? parseInt(b.template_id, 10) : null);
    if (!tpl) return res.status(400).json({ error: "ไม่พบ Draft Template" });
    const username = await getUsernameByEmail(req.user.email);
    // Subject/เนื้อหาเก็บใน Config ต่อ BU (ส่งมาเฉพาะที่ผู้ใช้แก้; ไม่ส่ง = คงค่าเดิมของ Config)
    const hasSub = typeof b.subject_template === "string"; const hasBody = typeof b.body_template === "string";
    const subj = hasSub ? String(b.subject_template).trim().slice(0, 300) : null;
    const bodyT = hasBody ? lockBody(String(b.body_template).slice(0, 10000)) : null;
    await pool.query(
      `INSERT INTO ie_macrologic_mail_config (report_type, bu, to_emails, cc_emails, greeting_name, attach_file, template_id, subject_template, body_template, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (report_type, bu) DO UPDATE SET to_emails = EXCLUDED.to_emails, cc_emails = EXCLUDED.cc_emails,
         greeting_name = EXCLUDED.greeting_name, attach_file = EXCLUDED.attach_file, template_id = EXCLUDED.template_id,
         subject_template = COALESCE(EXCLUDED.subject_template, ie_macrologic_mail_config.subject_template),
         body_template = COALESCE(EXCLUDED.body_template, ie_macrologic_mail_config.body_template),
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [type, bu, to.join("; "), cc.join("; "), greeting, attachFile, tpl.id, subj, bodyT, username]);
    const { rows } = await pool.query(`SELECT ${CFG_SEL} FROM ie_macrologic_mail_config WHERE report_type = $1 AND bu = $2`, [type, bu]);
    res.json({ ok: true, config: rows[0], template: mergeOwnTpl(rows[0], tpl) });
  } catch (err) { fail(res, "PUT /ie-macrologic-mail/config error:", err); }
});

router.delete("/config", async (req, res) => {
  try {
    const type = normType(req.query && req.query.report_type);
    const bu = normBu(req.query && req.query.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    if (!bu) return res.status(400).json({ error: "ไม่ระบุ BU" });
    await pool.query(`DELETE FROM ie_macrologic_mail_config WHERE report_type = $1 AND bu = $2`, [type, bu]);
    res.json({ ok: true });
  } catch (err) { fail(res, "DELETE /ie-macrologic-mail/config error:", err); }
});

// ── ประวัติ Draft ที่สร้างแล้ว (พร้อม Source) ────────────────────────────────
router.post("/draft", async (req, res) => {
  try {
    const b = req.body || {};
    const type = normType(b.report_type);
    const bu = normBu(b.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    if (!bu || bu.length > 60) return res.status(400).json({ error: "ไม่ระบุ BU" });
    const jobId = String(b.source_job_id || "").trim().slice(0, 100);
    if (!jobId) return res.status(400).json({ error: "ไม่ระบุ Source (source_job_id)" });
    const origin = ["PREVIEW", "JOB_LIST"].includes(String(b.source_origin)) ? String(b.source_origin) : "PREVIEW";
    const username = await getUsernameByEmail(req.user.email);
    await pool.query(`DELETE FROM ie_macrologic_mail_log WHERE report_type = $1 AND bu = $2 AND source_job_id = $3 AND created_by IS NOT DISTINCT FROM $4`, [type, bu, jobId, username]); // เก็บเฉพาะ Draft ล่าสุดของ Job เดียวกัน (ต่อ User)
    const { rows } = await pool.query(
      `INSERT INTO ie_macrologic_mail_log (report_type, bu, source_job_id, source_file_name, source_origin, config_snapshot,
         to_emails, cc_emails, subject, body_html, body_text, summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${DRAFT_LIST_COLS}`,
      [type, bu, jobId, String(b.source_file_name || "").slice(0, 300), origin,
       b.config_snapshot ? JSON.stringify(b.config_snapshot) : null,
       String(b.to_emails || "").slice(0, 2000), String(b.cc_emails || "").slice(0, 2000), String(b.subject || "").slice(0, 300),
       String(b.body_html || "").slice(0, 500000), String(b.body_text || "").slice(0, 200000),
       b.summary ? JSON.stringify(b.summary) : null, username]);
    res.json({ ok: true, draft: rows[0] });
  } catch (err) { fail(res, "POST /ie-macrologic-mail/draft error:", err); }
});

// MARKER_IE_MACROMAIL_DRAFT_CLEAR_V1 -- ล้าง Draft ทั้งหมด + ลบอัตโนมัติเมื่อเก่ากว่า N วัน
const DEFAULT_DRAFT_RETENTION_DAYS = 1; // MARKER_IE_MACROMAIL_DRAFT_KEEP_LATEST_V1 -- ไม่ต้องเก็บประวัติ: เก็บแค่ 1 วัน (Handler ต้องใช้ Draft ตอนเปิด Outlook เท่านั้น) + สร้างซ้ำจาก Job เดิมจะแทนที่ของเก่า
let lastDraftPurge = 0;
async function getDraftRetentionDays() {
  try {
    const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = 'ie_macromail_draft_retention_days'`);
    const n = parseInt(rows[0] && rows[0].value, 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_DRAFT_RETENTION_DAYS;
  } catch (e) { return DEFAULT_DRAFT_RETENTION_DAYS; }
}
async function purgeOldDrafts(force) {
  if (!force && Date.now() - lastDraftPurge < 3600 * 1000) return 0;
  lastDraftPurge = Date.now();
  const days = await getDraftRetentionDays();
  const { rowCount } = await pool.query(`DELETE FROM ie_macrologic_mail_log WHERE created_at < now() - make_interval(days => $1)`, [days]);
  if (rowCount > 0) console.log(`[MARKER_IE_MACROMAIL_DRAFT_CLEAR_V1] purged ${rowCount} drafts older than ${days} days`);
  // MARKER_IE_MACROMAIL_DRAFT_SRC_EXPIRED_V1 -- ไฟล์ต้นฉบับ (Job ใน file_storage) หมดอายุ/ถูกลบแล้ว -> ลบ Draft ของไฟล์นั้นออกด้วย
  const orphan = await pool.query(`DELETE FROM ie_macrologic_mail_log l
     WHERE NOT EXISTS (SELECT 1 FROM file_storage fs WHERE fs.id::text = l.source_job_id AND (fs.expire_at IS NULL OR fs.expire_at >= NOW()) AND fs.status IS DISTINCT FROM 'recycled')`);
  if (orphan.rowCount > 0) console.log(`[MARKER_IE_MACROMAIL_DRAFT_SRC_EXPIRED_V1] purged ${orphan.rowCount} drafts (source file expired/deleted)`);
  return rowCount + orphan.rowCount;
}

router.delete("/drafts", async (req, res) => {
  try {
    const type = normType(req.query && req.query.report_type);
    const bu = normBu(req.query && req.query.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    if (!bu) return res.status(400).json({ error: "ไม่ระบุ BU" });
    const { rowCount } = await pool.query(`DELETE FROM ie_macrologic_mail_log WHERE report_type = $1 AND bu = $2`, [type, bu]);
    res.json({ ok: true, deleted: rowCount });
  } catch (err) { fail(res, "DELETE /ie-macrologic-mail/drafts error:", err); }
});

router.get("/drafts", async (req, res) => {
  try {
    try { await purgeOldDrafts(false); } catch (e) { console.error("purgeOldDrafts:", e.message); }
    const type = normType(req.query && req.query.report_type);
    const bu = normBu(req.query && req.query.bu);
    if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const params = [type]; let where = "report_type = $1";
    if (bu) { params.push(bu); where += " AND bu = $2"; }
    params.push(limit);
    const { rows } = await pool.query(`SELECT ${DRAFT_LIST_COLS} FROM ie_macrologic_mail_log WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    res.json({ items: rows, retention_days: await getDraftRetentionDays() });
  } catch (err) { fail(res, "GET /ie-macrologic-mail/drafts error:", err); }
});

router.get("/draft/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    const { rows } = await pool.query(`SELECT ${DRAFT_LIST_COLS}, body_html, body_text, config_snapshot FROM ie_macrologic_mail_log WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "ไม่พบ Draft" });
    res.json({ draft: rows[0] });
  } catch (err) { fail(res, "GET /ie-macrologic-mail/draft/:id error:", err); }
});

// MARKER_IE_MACROMAIL_DRAFT_BODY_V1 -- เนื้อเมล HTML ของ Draft (text/html ล้วน) ให้ Outlook Draft Handler v3 ดึงผ่าน bodyPath (เนื้อเมลใหญ่เกินกว่าจะส่งผ่าน URL fastapn://)
router.get("/draft/:id/body", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    const { rows } = await pool.query(`SELECT body_html FROM ie_macrologic_mail_log WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "ไม่พบ Draft" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(String(rows[0].body_html || ""));
  } catch (err) { fail(res, "GET /ie-macrologic-mail/draft/:id/body error:", err); }
});

router.delete("/draft/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    await pool.query(`DELETE FROM ie_macrologic_mail_log WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) { fail(res, "DELETE /ie-macrologic-mail/draft/:id error:", err); }
});

export default router;
