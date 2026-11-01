/**
 * routes/amagnoAp0105.js   -- MARKER_AMAGNO_AP0105_ROUTE_V1
 *
 * ตาราง vat_amagno_ap0105 (ข้อมูลไฟล์ AP01-AP05 จาก Amagno) แยกจาก vat_backup_tax_invoice (AR Collection / Tax Invoice)
 *
 * Route (ต้อง Mount ก่อน createTableRouter("vat_amagno_ap0105")):
 *   GET  /api/vat_amagno_ap0105/summary?period=YYYY-MM   -- นับ GROUP BY bu, ap_set, tax_type, bu_state (ให้ Lobby ใช้แทนการดึงทุกแถว)
 *   GET  /api/vat_amagno_ap0105/periods                  -- รายการ Period ที่มีข้อมูล + จำนวนแถว
 *   POST /api/vat_amagno_ap0105/purge                    -- ล้างข้อมูล (เฉพาะ Owner) action: options | preview | delete
 *        filter: period, ap_set, bu, all=true ; delete ต้องส่ง expected_count ตรงกับที่นับสด
 *
 * Retention (Cron รายวันใน app.js เรียก purgeAp0105Retention):
 *   แบ่ง 2 กลุ่ม: (1) Period ล่าสุด = period > vat_period_month (เดือนที่ปิดล่าสุด) -> ไม่ลบ
 *                 (2) ข้อมูลเก่า = period <= vat_period_month -> เก็บ 30 วันนับจากวันที่โยนไฟล์ (created_at) ไม่สนใจ Period
 *   ปรับจำนวนวันได้ที่ system_settings key 'ap01_05_retention_days' (1-365 ค่าเริ่มต้น 30)
 */
import express from "express";
import { pool } from "../db.js";

const router = express.Router();
const PERIOD_RE = /^\d{4}-\d{2}$/;
const AP_SETS = ["AP01", "AP02", "AP03", "AP04", "AP05"];

router.get("/summary", async (req, res) => {
  try {
    const period = String(req.query.period || "");
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period ต้องเป็นรูปแบบ YYYY-MM" });
    const { rows } = await pool.query(
      `SELECT COALESCE(bu,'') AS bu, ap_set, COALESCE(tax_type,'') AS tax_type, COALESCE(bu_state,'active') AS bu_state,
              MIN(created_at) AS first_at, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE value_flag IS NOT NULL)::int AS flagged
         FROM vat_amagno_ap0105 WHERE period = $1
        GROUP BY 1,2,3,4 ORDER BY 1,2,3`,
      [period]
    );
    res.json({ period, rows });
  } catch (err) {
    console.error("vat_amagno_ap0105 summary error:", err);
    res.status(500).json({ error: "summary ล้มเหลว" });
  }
});

router.get("/periods", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT period, COUNT(*)::int AS n FROM vat_amagno_ap0105 GROUP BY 1 ORDER BY 1 DESC`);
    res.json({ rows });
  } catch (err) {
    console.error("vat_amagno_ap0105 periods error:", err);
    res.status(500).json({ error: "periods ล้มเหลว" });
  }
});

router.post("/purge", async (req, res) => {
  if (req.user?.appRole !== "Owner") return res.status(403).json({ error: "เฉพาะ Owner เท่านั้น" });
  const body = req.body || {};
  const action = body.action || "preview";
  try {
    if (action === "options") {
      const [byPeriod, bySet, byBu, total] = await Promise.all([
        pool.query(`SELECT period AS k, COUNT(*)::int AS n FROM vat_amagno_ap0105 GROUP BY 1 ORDER BY 1 DESC`),
        pool.query(`SELECT ap_set AS k, COUNT(*)::int AS n FROM vat_amagno_ap0105 GROUP BY 1 ORDER BY 1`),
        pool.query(`SELECT COALESCE(bu,'') AS k, COUNT(*)::int AS n FROM vat_amagno_ap0105 GROUP BY 1 ORDER BY 1`),
        pool.query(`SELECT COUNT(*)::int AS n FROM vat_amagno_ap0105`),
      ]);
      return res.json({ by_period: byPeriod.rows, by_ap_set: bySet.rows, by_bu: byBu.rows, total: total.rows[0].n });
    }

    const conds = [];
    const vals = [];
    const add = (sql, v) => { vals.push(v); conds.push(sql.replace("?", "$" + vals.length)); };
    if (body.period) {
      if (!PERIOD_RE.test(String(body.period))) return res.status(400).json({ error: "period ต้องเป็นรูปแบบ YYYY-MM" });
      add("period = ?", String(body.period));
    }
    if (body.ap_set) {
      if (!AP_SETS.includes(String(body.ap_set))) return res.status(400).json({ error: "ap_set ไม่ถูกต้อง" });
      add("ap_set = ?", String(body.ap_set));
    }
    if (body.bu) add("COALESCE(bu,'') = ?", String(body.bu) === "__blank__" ? "" : String(body.bu));
    if (conds.length === 0 && body.all !== true) {
      return res.status(400).json({ error: "ไม่ได้ระบุเงื่อนไข -- ถ้าต้องการล้างทั้งหมดต้องส่ง all=true" });
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM vat_amagno_ap0105 " + where, vals);
    const count = cnt.rows[0].n;

    if (action === "preview") {
      const sample = await pool.query(
        "SELECT period, ap_set, bu, supplier_name, tax_invoice_number, doc_date, gross_value, vat_value FROM vat_amagno_ap0105 " + where + " ORDER BY period DESC, id DESC LIMIT 15",
        vals
      );
      return res.json({ count, sample: sample.rows });
    }
    if (action === "delete") {
      if (Number(body.expected_count) !== count) {
        return res.status(409).json({ error: `จำนวนที่จะลบเปลี่ยนไป (ตอนนี้ ${count} แถว) กรุณาตรวจสอบใหม่`, count });
      }
      const del = await pool.query("DELETE FROM vat_amagno_ap0105 " + where, vals);
      console.log(`[MARKER_AMAGNO_AP0105_ROUTE_V1] purge by ${req.user?.username || req.user?.email || "?"}: deleted=${del.rowCount} filter=${JSON.stringify({ period: body.period, ap_set: body.ap_set, bu: body.bu, all: body.all })}`);
      return res.json({ deleted: del.rowCount });
    }
    return res.status(400).json({ error: "action ไม่ถูกต้อง" });
  } catch (err) {
    console.error("vat_amagno_ap0105 purge error:", err);
    res.status(500).json({ error: "purge ล้มเหลว" });
  }
});

// Cron รายวัน: เก็บข้อมูล N วัน (ค่าเริ่มต้น 30) นับจากวันที่โยนไฟล์ ไม่สนใจ Period
export async function getAp0105RetentionDays() {
  try {
    const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = 'ap01_05_retention_days'`);
    const n = parseInt(rows[0]?.value, 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
  } catch (_) { return 30; }
}
export async function purgeAp0105Retention() {
  const days = await getAp0105RetentionDays();
  // Period ล่าสุด (ยังเปิดอยู่) ไม่ถูกลบ ; ถ้าไม่มี vat_period_month ให้ป้องกัน Period ที่ใหม่สุดในตาราง
  const del = await pool.query(
    `DELETE FROM vat_amagno_ap0105
      WHERE created_at < NOW() - make_interval(days => $1)
        AND period <= COALESCE((SELECT value FROM system_settings WHERE key = 'vat_period_month'),
                               (SELECT TO_CHAR(TO_DATE(MAX(period) || '-01', 'YYYY-MM-DD') - INTERVAL '1 month', 'YYYY-MM') FROM vat_amagno_ap0105))`,
    [days]
  );
  if (del.rowCount > 0) console.log(`[MARKER_AMAGNO_AP0105_ROUTE_V1] retention purged ${del.rowCount} rows (old period, uploaded > ${days} days ago)`);
  return del.rowCount;
}

export default router;
