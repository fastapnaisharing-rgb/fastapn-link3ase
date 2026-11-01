/**
 * routes/vatInputVatRecon.js   -- MARKER_VAT_INPUT_VAT_RECON_ROUTE_V1
 *
 * ตาราง vat_input_vat_recon = รายงาน "Input VAT Reconciliation Report (Custom)" (CRC_AP_I_VAT_RECONCILE) -- ใช้ชั่วคราว มีกำหนดลบ
 * แยกจาก vat_reconcile_input_summary (Input Summary APCRC201) ไม่ใช้ร่วมกัน
 *
 * Route (ต้อง Mount ก่อน createTableRouter("vat_input_vat_recon")):
 *   GET  /api/vat_input_vat_recon/summary?period=YYYY-MM  -- นับ GROUP BY bu, tax_type + วันที่โยน + วันที่จะถูกลบ (expires_at)
 *   GET  /api/vat_input_vat_recon/periods                 -- รายการ Period ที่มีข้อมูล + จำนวนแถว
 *   GET  /api/vat_input_vat_recon/retention               -- จำนวนวันที่เก็บ
 *
 * Retention (Cron รายวันใน app.js เรียก purgeInputVatReconRetention):
 *   ลบแถวที่ created_at เก่ากว่า N วัน ไม่สนใจ Period (รายงานนี้ใช้ชั่วคราว)
 *   ปรับจำนวนวันได้ที่ system_settings key 'input_vat_recon_retention_days' (1-365 ค่าเริ่มต้น 30)
 */
import express from "express";
import { pool } from "../db.js";

const router = express.Router();
const PERIOD_RE = /^\d{4}-\d{2}$/;

export async function getInputVatReconRetentionDays() {
  try {
    const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = 'input_vat_recon_retention_days'`);
    const n = parseInt(rows[0]?.value, 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
  } catch (_) { return 30; }
}

router.get("/retention", async (_req, res) => {
  res.json({ days: await getInputVatReconRetentionDays() });
});

router.get("/summary", async (req, res) => {
  try {
    const period = String(req.query.period || "");
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period ต้องเป็นรูปแบบ YYYY-MM" });
    const days = await getInputVatReconRetentionDays();
    const { rows } = await pool.query(
      `SELECT COALESCE(bu,'') AS bu, COALESCE(tax_type,'') AS tax_type, COUNT(*)::int AS n,
              MIN(created_at) AS first_at, MIN(created_at) + make_interval(days => $2) AS expires_at
         FROM vat_input_vat_recon WHERE period = $1
        GROUP BY 1,2 ORDER BY 1,2`,
      [period, days]
    );
    res.json({ period, retention_days: days, rows });
  } catch (err) {
    console.error("vat_input_vat_recon summary error:", err);
    res.status(500).json({ error: "summary ล้มเหลว" });
  }
});

router.get("/periods", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT period, COUNT(*)::int AS n FROM vat_input_vat_recon GROUP BY 1 ORDER BY 1 DESC`);
    res.json({ rows });
  } catch (err) {
    console.error("vat_input_vat_recon periods error:", err);
    res.status(500).json({ error: "periods ล้มเหลว" });
  }
});

// Cron รายวัน: ลบแถวที่โยนไฟล์มาเกิน N วัน (ค่าเริ่มต้น 30) ไม่สนใจ Period
export async function purgeInputVatReconRetention() {
  const days = await getInputVatReconRetentionDays();
  const del = await pool.query(`DELETE FROM vat_input_vat_recon WHERE created_at < NOW() - make_interval(days => $1)`, [days]);
  if (del.rowCount > 0) console.log(`[MARKER_VAT_INPUT_VAT_RECON_ROUTE_V1] retention purged ${del.rowCount} rows (uploaded > ${days} days ago)`);
  return del.rowCount;
}

export default router;
