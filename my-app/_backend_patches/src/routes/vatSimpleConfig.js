// vatSimpleConfig.js -- MARKER_VAT_SIMPLE_CONFIG_ROUTER_V1
// ตาราง vat_simple_config = Config กลางของงานที่ส่งเข้า Simple (Standard Temp) ใช้ร่วมกันได้หลายหน้า/หลาย Match
//   config_type : ชนิดงาน เช่น 'T36' (Generate Overall > Temp. T36) -- เพิ่มชนิดใหม่ได้โดยไม่ต้องแก้ตาราง
//   cfg_key     : '*' (ทุก BU) | 'BU' | 'BU|ชื่อ Supplier(ปรับรูปแล้ว)' | '__gdesc' (สูตรรายการกลาง)
//   level       : '*' | 'bu' | 'sup' | 'gdesc'
//   vals        : jsonb ค่าที่ตั้งไว้ (lcpc/lacc/lsub/scode/taxid/brno/cpc/sub/cpctax/exp/recv/day/vat/fill/snMode/snCustom/_n ...)
//   alias       : ชื่ออื่นของ Supplier (คั่นด้วย ,)
// GET    /api/vat-simple-config?type=T36                       -> { items }
// PUT    /api/vat-simple-config/item  { type, key, level, bu, supplier, vals, alias }
// DELETE /api/vat-simple-config/item?type=T36&key=...
import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";

const router = Router();
const normType = (v) => String(v || "").trim().toUpperCase().slice(0, 40);
const LEVELS = ["*", "bu", "sup", "gdesc"];

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS vat_simple_config (
      config_type text NOT NULL,
      cfg_key text NOT NULL,
      level text NOT NULL DEFAULT 'bu',
      bu text NOT NULL DEFAULT '',
      supplier text NOT NULL DEFAULT '',
      vals jsonb NOT NULL DEFAULT '{}'::jsonb,
      alias text NOT NULL DEFAULT '',
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (config_type, cfg_key))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS vat_simple_config_type_bu_idx ON vat_simple_config (config_type, bu)`);
  } catch (err) { console.error("vat_simple_config init error:", err); }
})();

const fail = (res, tag, err) => { console.error(tag, err); res.status(500).json({ error: "เกิดข้อผิดพลาดในระบบ" }); };

router.get("/", async (req, res) => {
  try {
    const type = normType(req.query && req.query.type);
    if (!type) return res.status(400).json({ error: "ไม่ระบุชนิด Config" });
    const { rows } = await pool.query(
      `SELECT config_type, cfg_key, level, bu, supplier, vals, alias, updated_by, updated_at FROM vat_simple_config WHERE config_type = $1 ORDER BY level, bu, supplier`, [type]);
    res.json({ items: rows });
  } catch (err) { fail(res, "GET /vat-simple-config error:", err); }
});

router.put("/item", async (req, res) => {
  try {
    const b = req.body || {};
    const type = normType(b.type);
    const key = String(b.key == null ? "" : b.key).trim().slice(0, 300);
    const level = String(b.level || "").trim();
    if (!type || !key) return res.status(400).json({ error: "ไม่ระบุชนิดหรือ Key" });
    if (!LEVELS.includes(level)) return res.status(400).json({ error: "ระดับ Config ไม่ถูกต้อง" });
    const vals = b.vals && typeof b.vals === "object" && !Array.isArray(b.vals) ? b.vals : {};
    const bu = String(b.bu || "").trim().toUpperCase().slice(0, 60);
    const supplier = String(b.supplier || "").trim().slice(0, 300);
    const alias = String(b.alias || "").trim().slice(0, 1000);
    const username = await getUsernameByEmail(req.user.email);
    await pool.query(
      `INSERT INTO vat_simple_config (config_type, cfg_key, level, bu, supplier, vals, alias, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (config_type, cfg_key) DO UPDATE SET level = EXCLUDED.level, bu = EXCLUDED.bu, supplier = EXCLUDED.supplier,
         vals = EXCLUDED.vals, alias = EXCLUDED.alias, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [type, key, level, bu, supplier, JSON.stringify(vals), alias, username]);
    res.json({ ok: true });
  } catch (err) { fail(res, "PUT /vat-simple-config/item error:", err); }
});

router.delete("/item", async (req, res) => {
  try {
    const type = normType(req.query && req.query.type);
    const key = String((req.query && req.query.key) || "").trim();
    if (!type || !key) return res.status(400).json({ error: "ไม่ระบุชนิดหรือ Key" });
    await pool.query(`DELETE FROM vat_simple_config WHERE config_type = $1 AND cfg_key = $2`, [type, key]);
    res.json({ ok: true });
  } catch (err) { fail(res, "DELETE /vat-simple-config/item error:", err); }
});

export default router;
