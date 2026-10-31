#!/usr/bin/env python3
# patch_vat_swap_drafts_v1.py -- MARKER_PATCH_VAT_SWAP_DRAFTS_V1
# สร้าง src/routes/vatSwapDrafts.js (ตาราง vat_swap_drafts / vat_swap_draft_rows สร้างเองตอนเริ่ม Backend + ล้างรายการหมดอายุเองทุก 6 ชั่วโมง)
# และ Mount ใน src/app.js  (รูปแบบเดียวกับ patch_vat_simple_config_v1.py)
# วิธีรัน: วางไฟล์นี้ในโฟลเดอร์ fastapn-backend (ที่มี src\) แล้ว  python patch_vat_swap_drafts_v1.py  จากนั้น Restart-Service fastapn-backend
import os, re, shutil, subprocess, sys
BASE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(BASE, "src", "app.js")
ROUTE = os.path.join(BASE, "src", "routes", "vatSwapDrafts.js")
ROUTE_SRC = r'''// vatSwapDrafts.js -- MARKER_VAT_SWAP_DRAFTS_ROUTER_V1
// Draft ชั่วคราวของ VAT Toolbox > VAT Swap Finder
//   * บันทึก Draft: PUT /:id (ตัวงาน) + POST /:id/rows (รายการใบกำกับรายแถว ตามรูปแบบ Input VAT Reconcile)
//   * กด Export:    POST /:id/export -> expires_at = now() + 3 วัน (Backend ล้างให้เองทุก 6 ชั่วโมง)
//   * Draft เป็นของ User ที่สร้าง (อ่าน/แก้/ลบได้เฉพาะของตัวเอง)
// GET    /api/vat-swap-drafts            -> { items }   (ไม่รวมที่หมดอายุ)
// GET    /api/vat-swap-drafts/:id        -> { id, job, ... }
// PUT    /api/vat-swap-drafts/:id        { job, name, status, lastMonth, savedAt }
// POST   /api/vat-swap-drafts/:id/rows   { replace, rows:[{...}] }   (ส่งเป็นชุด ชุดแรกให้ replace=true)
// POST   /api/vat-swap-drafts/:id/export -> { ok, expiresAt }
// DELETE /api/vat-swap-drafts/:id
import { Router } from "express";
import crypto from "crypto";
import { pool, getUsernameByEmail } from "../db.js";

const router = Router();
const EXPIRE_DAYS = 3;
const PURGE_EVERY_MS = 6 * 3600 * 1000;

const purge = async () => {
  try {
    const r1 = await pool.query(`DELETE FROM vat_swap_draft_rows WHERE draft_id IN (SELECT id FROM vat_swap_drafts WHERE expires_at IS NOT NULL AND expires_at <= now())`);
    const r2 = await pool.query(`DELETE FROM vat_swap_drafts WHERE expires_at IS NOT NULL AND expires_at <= now()`);
    if (r2.rowCount) console.log(`vat_swap_drafts purge: draft ${r2.rowCount} / rows ${r1.rowCount}`);
  } catch (err) { console.error("vat_swap_drafts purge error:", err); }
};

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS vat_swap_drafts (
      id text PRIMARY KEY,
      username text NOT NULL,
      name text,
      status text,
      last_month text,
      job jsonb NOT NULL,
      saved_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      exported_at timestamptz,
      expires_at timestamptz)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vat_swap_drafts_user ON vat_swap_drafts (username, saved_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vat_swap_drafts_expires ON vat_swap_drafts (expires_at) WHERE expires_at IS NOT NULL`);
    await pool.query(`CREATE TABLE IF NOT EXISTS vat_swap_draft_rows (
      id text PRIMARY KEY,
      draft_id text NOT NULL,
      batch text NOT NULL DEFAULT '',
      username text,
      file_name text,
      file_period text,
      src_row integer,
      source text,
      branch text,
      tax_invoice_date date,
      tax_invoice_no text,
      invoice_ref text,
      vendor_name text,
      tax_id text,
      vendor_branch text,
      ho text,
      tax_code text,
      tax_type text,
      vat_amount numeric(18,2),
      base_amount numeric(18,2))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsdr_draft ON vat_swap_draft_rows (draft_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsdr_taxinv ON vat_swap_draft_rows (tax_invoice_no)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsdr_ref ON vat_swap_draft_rows (invoice_ref) WHERE invoice_ref IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsdr_code ON vat_swap_draft_rows (tax_code)`);
    await purge();
    setInterval(purge, PURGE_EVERY_MS).unref();
  } catch (err) { console.error("vat_swap_drafts init error:", err); }
})();

const fail = (res, tag, err) => { console.error(tag, err); res.status(500).json({ error: "เกิดข้อผิดพลาดในระบบ" }); };
const me = async (req) => getUsernameByEmail(req.user.email);
const idOf = (req) => String((req.params && req.params.id) || "").trim().slice(0, 120);
const s = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

router.get("/", async (req, res) => {
  try {
    const u = await me(req);
    const { rows } = await pool.query(
      `SELECT id, username, name, status, last_month, saved_at, exported_at, expires_at FROM vat_swap_drafts
        WHERE username = $1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY saved_at DESC`, [u]);
    res.json({ items: rows });
  } catch (err) { fail(res, "GET /vat-swap-drafts error:", err); }
});

router.get("/:id", async (req, res) => {
  try {
    const u = await me(req);
    const { rows } = await pool.query(
      `SELECT id, username, name, status, last_month, saved_at, exported_at, expires_at, job FROM vat_swap_drafts
        WHERE id = $1 AND username = $2 AND (expires_at IS NULL OR expires_at > now())`, [idOf(req), u]);
    if (!rows.length) return res.status(404).json({ error: "ไม่พบ Draft (หรือหมดอายุแล้ว)" });
    res.json(rows[0]);
  } catch (err) { fail(res, "GET /vat-swap-drafts/:id error:", err); }
});

router.put("/:id", async (req, res) => {
  try {
    const u = await me(req);
    const b = req.body || {};
    const id = idOf(req);
    if (!id || !b.job || typeof b.job !== "object") return res.status(400).json({ error: "ข้อมูล Draft ไม่ครบ" });
    const savedAt = b.savedAt ? new Date(Number(b.savedAt)) : new Date();
    const r = await pool.query(
      `INSERT INTO vat_swap_drafts (id, username, name, status, last_month, job, saved_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, last_month = EXCLUDED.last_month,
         job = EXCLUDED.job, saved_at = EXCLUDED.saved_at, updated_at = now()
         WHERE vat_swap_drafts.username = EXCLUDED.username`,
      [id, u, s(b.name, 300), s(b.status, 40), s(b.lastMonth, 20), JSON.stringify(b.job), Number.isNaN(savedAt.getTime()) ? new Date() : savedAt]);
    if (!r.rowCount) return res.status(403).json({ error: "Draft นี้เป็นของผู้ใช้อื่น" });
    res.json({ ok: true });
  } catch (err) { fail(res, "PUT /vat-swap-drafts/:id error:", err); }
});

router.post("/:id/rows", async (req, res) => {
  const client = await pool.connect();
  try {
    const u = await me(req);
    const id = idOf(req);
    const b = req.body || {};
    const list = Array.isArray(b.rows) ? b.rows : [];
    const own = await client.query(`SELECT 1 FROM vat_swap_drafts WHERE id = $1 AND username = $2`, [id, u]);
    if (!own.rowCount) return res.status(404).json({ error: "ไม่พบ Draft (บันทึกตัวงานก่อน)" });
    await client.query("BEGIN");
    if (b.replace) await client.query(`DELETE FROM vat_swap_draft_rows WHERE draft_id = $1`, [id]);
    const COLS = 20;
    for (let i = 0; i < list.length; i += 1000) {
      const part = list.slice(i, i + 1000);
      const vals = []; const ph = [];
      part.forEach((x, k) => {
        const o = k * COLS;
        ph.push("(" + Array.from({ length: COLS }, (_, j) => `$${o + j + 1}`).join(",") + ")");
        vals.push(crypto.randomUUID(), id, "", u, s(x.file_name, 300), s(x.file_period, 20), Number.isInteger(x.src_row) ? x.src_row : null, s(x.source, 60), s(x.branch, 60),
          s(x.tax_invoice_date, 10), s(x.tax_invoice_no, 120), s(x.invoice_ref, 120), s(x.vendor_name, 300), s(x.tax_id, 40), s(x.vendor_branch, 40), s(x.ho, 40),
          s(x.tax_code, 60), s(x.tax_type, 4), num(x.vat_amount), num(x.base_amount));
      });
      if (part.length) await client.query(
        `INSERT INTO vat_swap_draft_rows (id, draft_id, batch, username, file_name, file_period, src_row, source, branch, tax_invoice_date, tax_invoice_no, invoice_ref,
           vendor_name, tax_id, vendor_branch, ho, tax_code, tax_type, vat_amount, base_amount) VALUES ${ph.join(",")}`, vals);
    }
    await client.query("COMMIT");
    res.json({ ok: true, inserted: list.length });
  } catch (err) { try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ } fail(res, "POST /vat-swap-drafts/:id/rows error:", err); }
  finally { client.release(); }
});

router.post("/:id/export", async (req, res) => {
  try {
    const u = await me(req);
    const { rows } = await pool.query(
      `UPDATE vat_swap_drafts SET exported_at = now(), expires_at = now() + ($3 || ' days')::interval
        WHERE id = $1 AND username = $2 RETURNING expires_at`, [idOf(req), u, String(EXPIRE_DAYS)]);
    if (!rows.length) return res.status(404).json({ error: "ไม่พบ Draft" });
    res.json({ ok: true, expiresAt: rows[0].expires_at });
  } catch (err) { fail(res, "POST /vat-swap-drafts/:id/export error:", err); }
});

router.delete("/:id", async (req, res) => {
  try {
    const u = await me(req);
    const id = idOf(req);
    const own = await pool.query(`SELECT 1 FROM vat_swap_drafts WHERE id = $1 AND username = $2`, [id, u]);
    if (!own.rowCount) return res.json({ ok: true });
    await pool.query(`DELETE FROM vat_swap_draft_rows WHERE draft_id = $1`, [id]);
    await pool.query(`DELETE FROM vat_swap_drafts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) { fail(res, "DELETE /vat-swap-drafts/:id error:", err); }
});

export default router;
'''
IMP = 'import vatSwapDraftsRouter from "./routes/vatSwapDrafts.js"; // MARKER_APP_VAT_SWAP_DRAFTS_ROUTER_V1\n'
MNT = 'app.use("/api/vat-swap-drafts", vatSwapDraftsRouter); // MARKER_APP_VAT_SWAP_DRAFTS_ROUTER_V1\n'
ANCHORS = [
    ('import vatSimpleConfigRouter from "./routes/vatSimpleConfig.js";', 'app.use("/api/vat-simple-config", vatSimpleConfigRouter);'),
    ('import ieMacroMailConfigRouter from "./routes/ieMacroMailConfig.js";', 'app.use("/api/ie-macrologic-mail", ieMacroMailConfigRouter);'),
]
def main():
    s = open(APP, encoding="utf-8").read()
    if "MARKER_APP_VAT_SWAP_DRAFTS_ROUTER_V1" in s and os.path.exists(ROUTE):
        print("already patched"); return
    pair = next(((a, m) for a, m in ANCHORS if s.count(a) == 1 and s.count(m) == 1), None)
    if not pair:
        print("anchor not found (ไม่พบบรรทัดอ้างอิงใน src/app.js) -- เพิ่ม 2 บรรทัดนี้เองใน app.js:\n" + IMP + MNT); sys.exit(1)
    a_imp, a_mnt = pair
    shutil.copyfile(APP, APP + ".bak_swapdrafts")
    i = s.index(a_imp); i = s.index("\n", i) + 1
    s = s[:i] + IMP + s[i:]
    j = s.index(a_mnt); j = s.index("\n", j) + 1
    s = s[:j] + MNT + s[j:]
    if s.count("(") != s.count(")") or s.count("{") != s.count("}"):
        print("bracket imbalance"); sys.exit(1)
    os.makedirs(os.path.dirname(ROUTE), exist_ok=True)
    open(ROUTE, "w", encoding="utf-8", newline="\n").write(ROUTE_SRC)
    open(APP, "w", encoding="utf-8", newline="\n").write(s)
    for f in (ROUTE, APP):
        r = subprocess.run(["node", "--check", f], capture_output=True, text=True)
        if r.returncode != 0:
            print("node --check failed", f, r.stderr); shutil.copyfile(APP + ".bak_swapdrafts", APP); sys.exit(1)
    lim = [ln.strip() for ln in s.splitlines() if "express.json" in ln]
    print("express.json ใน app.js:", lim if lim else "ไม่พบ (ใช้ค่าเริ่มต้น 100kb -- ต้องเพิ่ม limit)")
    print("ถ้า limit ต่ำกว่า ~50mb ให้ปรับเป็น express.json({ limit: '50mb' }) เพราะ Draft เก็บไฟล์ Input ที่อ่านแล้วทั้งก้อน")
    print("patched OK -> Restart-Service fastapn-backend")
main()
