import express from "express";
import { pool, getUsernameByEmail } from "../db.js";

// ============================================================================
// vatSuspense.js -- หน้า VAT Controller > Suspense Vat Rec.
// MARKER_VATSUSPENSE_ROUTE_V1
//  - เก็บ "วัน Cut Off ของ Incomplete" ต่อ (BU, Tax Type) ที่ได้จาก Upload Incomplete (หน้า Frontend เรียก POST /cutoff หลัง Save)
//  - GET /status?period=YYYY-MM  : สถานะต่อ BU ต่อ Account (TB / Incomplete Pending / Last Date ICP / Status อนุญาต Reconcile)
//  - POST /check                 : ตรวจซ้ำฝั่ง Backend ก่อน Reconcile (กัน Bypass ผ่านการยิง API ตรง)
//  - DELETE /cutoff?bu=XXX       : ล้างค่า Cut Off ของ BU (เรียกพร้อมปุ่มลบข้อมูล VAT Watchlist ของ BU)
// กติกา (ผู้ใช้กำหนด): พร้อม Reconcile ได้ก็ต่อเมื่อข้อมูลเป็น ณ "สิ้นเดือนของ Period นั้น" เท่านั้น
//   - Last Date ICP ไม่ใช่วันสิ้นเดือนของ Period = สีแดง = ไม่อนุญาต
//   - ข้อมูลที่ใช้ Reconcile ต้องเป็นรายการ Incomplete status = pending
// ============================================================================

pool.query(`CREATE TABLE IF NOT EXISTS vat_suspense_cutoff (
  bu text NOT NULL,
  tax_type text NOT NULL,
  cutoff_date date,
  pending_count integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  uploaded_by text,
  PRIMARY KEY (bu, tax_type)
)`).catch((e) => console.error("[migrate vat_suspense_cutoff]", e.message));

// Account <-> Tax Type (ผู้ใช้ยืนยัน): 11630052 = N,A | 11630055 = F,T | 11630051 = M (ใช้งานน้อย)
export const SUSPENSE_ACCOUNTS = [
  { account: "11630052", label: "Expense", taxTypes: ["N", "A"], rare: false },
  { account: "11630055", label: "Asset", taxTypes: ["F", "T"], rare: false },
  { account: "11630051", label: "MER", taxTypes: ["M"], rare: true },
];
const VALID_TAX_TYPES = new Set(["N", "A", "T", "F", "M"]);
const ALL_TYPE_SET = ["N", "A", "T", "F"]; // All Type ไม่รวม M (ตามกติกาเดิมของ Upload Incomplete)

const router = express.Router();

const isPeriod = (p) => /^\d{4}-\d{2}$/.test(String(p || ""));
function monthEnd(period) { // YYYY-MM -> YYYY-MM-DD (วันสุดท้ายของเดือน)
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(d).padStart(2, "0")}`;
}
function allowedSetOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.toLowerCase() === "all type") return ALL_TYPE_SET;
  return s.split(",").map((x) => x.trim().toUpperCase()).filter((x) => VALID_TAX_TYPES.has(x));
}

async function computeStatus(period, onlyBu = null) {
  const end = monthEnd(period);
  const { rows: companies } = await pool.query(
    `SELECT bu, "BOOK" AS book, "COMPANY CODE" AS company_code, allowed_tax_type, to_char(vat_watchlist_incomplete_to::date, 'YYYY-MM-DD') AS inc_to
       FROM company_list
      WHERE deleted IS NOT TRUE AND vat_watchlist_status = 'active'
        AND allowed_tax_type IS NOT NULL AND allowed_tax_type != ''
        ${onlyBu ? "AND bu = $1" : ""}
      ORDER BY bu`, onlyBu ? [onlyBu] : []);
  const accounts = SUSPENSE_ACCOUNTS.map((a) => a.account);
  // Reconcile ยึด TB ปัจจุบัน (ล่าสุด) เป็นหลัก -- ใช้ TB ล่าสุดของ BU/Account ไม่ผูกกับ Period ที่เลือก
  const tb = await pool.query(
    `SELECT DISTINCT ON (bu, account) bu, account, period AS tb_period, updated_at AS last_updated
       FROM vat_reconcile_tb WHERE account = ANY($1::text[])
      ORDER BY bu, account, period DESC, updated_at DESC`, [accounts]);
  const tbMap = new Map(tb.rows.map((r) => [`${r.bu}|${r.account}`, r.last_updated]));
  // นับรายการ Incomplete ที่เข้าระบบจริง (status = pending) ต่อ BU ต่อ Tax Type Class -- ใช้ตัดสินว่า "มีข้อมูล" ของ Account หรือยัง
  const pend = await pool.query(
    `SELECT bu,
            CASE WHEN UPPER(substring(tax_type from '-(N|M)\\s+S?VAT\\s*7\\s*$')) = 'M' THEN 'M'
                 WHEN UPPER(LEFT(TRIM(tax_type), 1)) IN ('A','T','F') THEN UPPER(LEFT(TRIM(tax_type), 1))
                 ELSE 'N' END AS cls,
            COUNT(*)::int AS n
       FROM vat_watchlist_report
      WHERE status = 'pending' AND tax_type ~* '-(N|M)\\s+S?VAT\\s*7\\s*$'
      GROUP BY 1, 2`);
  const pendMap = new Map(pend.rows.map((r) => [`${r.bu}|${r.cls}`, r.n]));
  const cut = await pool.query(`SELECT bu, tax_type, to_char(cutoff_date, 'YYYY-MM-DD') AS cutoff_date, pending_count, uploaded_at FROM vat_suspense_cutoff`);
  const cutMap = new Map(cut.rows.map((r) => [`${r.bu}|${r.tax_type}`, r]));

  const rows = [];
  for (const c of companies) {
    const numericBu = String(c.company_code || "").split("-")[2];
    if (!numericBu) continue;
    const allowed = allowedSetOf(c.allowed_tax_type);
    const cells = {};
    for (const a of SUSPENSE_ACCOUNTS) {
      const types = a.taxTypes.filter((t) => allowed.includes(t));
      if (!types.length) { cells[a.account] = { applicable: false, allowed: false, reasons: ["BU นี้ไม่มี Tax Type ของ Account นี้"] }; continue; }
      const tbAt = tbMap.get(`${numericBu}|${a.account}`) || null;
      let recs = types.map((t) => cutMap.get(`${c.bu}|${t}`)).filter(Boolean);
      // ยังไม่มี Cut Off ต่อ Tax Type แต่มี Incomplete ใน Report แล้ว -> ใช้วัน "Incomplete To" ของ BU จาก Report แทน
      if (!recs.length && c.inc_to) recs = types.map((t) => ({ cutoff_date: c.inc_to, pending_count: 0, tax_type: t }));
      const pending = types.reduce((s, t) => s + Number(pendMap.get(`${c.bu}|${t}`) || 0), 0); // นับจาก Report จริง
      const dates = recs.map((r) => r.cutoff_date).filter(Boolean).sort();
      const minDate = dates[0] || null;
      let icpState = "none"; // none = ยังไม่เคย Upload | ok = สิ้นเดือน | red = ไม่ใช่สิ้นเดือน (หรือ Tax Type บางตัวขาด)
      if (recs.length) icpState = (recs.length === types.length && dates.length === types.length && dates.every((d) => d === end)) ? "ok" : "red";
      const incState = pending > 0 ? "ok" : recs.length ? "empty" : "none"; // มีข้อมูล = มี Incomplete Pending ของ Account นี้เข้าระบบแล้ว
      const reasons = [];
      if (!tbAt) reasons.push("ยังไม่มี TB");
      if (incState === "none") reasons.push("ยังไม่ได้ Upload Incomplete");
      else if (incState === "empty") reasons.push("ไม่มีรายการ Incomplete ที่เป็น Pending");
      if (icpState === "red") reasons.push(`Last Date ICP เป็น ${minDate || "-"} ต้องเป็น ${end} (สิ้นเดือน)`);
      cells[a.account] = {
        applicable: true, tax_types: types,
        tb: !!tbAt, tb_at: tbAt,
        incomplete: incState, pending,
        icp: icpState, icp_date: minDate,
        allowed: reasons.length === 0 && icpState === "ok" && incState === "ok" && !!tbAt,
        reasons,
      };
    }
    rows.push({ bu: c.bu, book: c.book || null, numeric_bu: numericBu, cells });
  }
  return { period, month_end: end, accounts: SUSPENSE_ACCOUNTS, rows };
}

// Period ที่ล็อกไว้ = เดือนของข้อมูล Incomplete ล่าสุด (Incomplete ตาม Report เสมอ)
router.get("/period", async (_req, res) => {
  try {
    let period = null;
    try {
      const r = await pool.query(
        `SELECT to_char(MAX(vat_watchlist_incomplete_to::date), 'YYYY-MM') AS p FROM company_list
          WHERE deleted IS NOT TRUE AND vat_watchlist_status = 'active' AND vat_watchlist_incomplete_to IS NOT NULL`);
      period = r.rows[0] && r.rows[0].p;
    } catch (_) { /* ใช้ fallback */ }
    if (!period) {
      const r = await pool.query(`SELECT to_char(MAX(cutoff_date), 'YYYY-MM') AS p FROM vat_suspense_cutoff`);
      period = r.rows[0] && r.rows[0].p;
    }
    res.json({ period: period || null });
  } catch (err) {
    console.error("[vatSuspense] period error:", err);
    res.status(500).json({ error: "โหลด Period ไม่สำเร็จ", detail: err.message });
  }
});

// Preview ก่อน Save: จำนวนรายการ Incomplete เดิมของแต่ละ BU ที่จะถูกล้าง (replace_bu ล้างทุกแถวยกเว้น send_fp/draft/fu-draft ที่เก็บไว้)
router.get("/existing", async (req, res) => {
  try {
    const bus = String(req.query.bus || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!bus.length) return res.json({ rows: [] });
    const classes = String(req.query.classes || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => ["N","A","T","F","M"].includes(x));
    const clsSql = `(CASE WHEN UPPER(substring(tax_type from '-(N|M)\\s+S?VAT\\s*7\\s*$')) = 'M' THEN 'M' WHEN UPPER(LEFT(TRIM(tax_type), 1)) IN ('A','T','F') THEN UPPER(LEFT(TRIM(tax_type), 1)) ELSE 'N' END)`;
    const { rows } = await pool.query(
      `SELECT bu,
              COUNT(*) FILTER (WHERE status NOT IN ('send_fp','draft','fu-draft','type_a','type_b','type_f'))::int AS to_clear,
              COUNT(*) FILTER (WHERE status IN ('send_fp','draft','fu-draft'))::int AS kept
         FROM vat_watchlist_report WHERE bu = ANY($1::text[])${classes.length ? ` AND ${clsSql} = ANY($2::text[])` : ""} GROUP BY bu ORDER BY bu`, classes.length ? [bus, classes] : [bus]);
    res.json({ rows });
  } catch (err) {
    console.error("[vatSuspense] existing error:", err);
    res.status(500).json({ error: "โหลดจำนวนข้อมูลเดิมไม่สำเร็จ", detail: err.message });
  }
});

router.get("/status", async (req, res) => {
  try {
    if (!isPeriod(req.query.period)) return res.status(400).json({ error: "ต้องระบุ period รูปแบบ YYYY-MM" });
    res.json(await computeStatus(req.query.period));
  } catch (err) {
    console.error("[vatSuspense] status error:", err);
    res.status(500).json({ error: "โหลดสถานะ Suspense ไม่สำเร็จ", detail: err.message });
  }
});

// ตรวจซ้ำก่อน Reconcile -- ไม่ผ่าน = 409 พร้อมเหตุผล
router.post("/check", async (req, res) => {
  try {
    const { bu, account, period } = req.body || {};
    if (!bu || !account || !isPeriod(period)) return res.status(400).json({ error: "ต้องระบุ bu, account, period (YYYY-MM)" });
    const st = await computeStatus(period, bu);
    const cell = st.rows[0] && st.rows[0].cells[account];
    if (!cell) return res.status(404).json({ error: "ไม่พบ BU/Account นี้" });
    if (!cell.allowed) return res.status(409).json({ error: "ไม่อนุญาตให้ Reconcile", reasons: cell.reasons, cell });
    res.json({ ok: true, cell });
  } catch (err) {
    console.error("[vatSuspense] check error:", err);
    res.status(500).json({ error: "ตรวจเงื่อนไข Reconcile ไม่สำเร็จ", detail: err.message });
  }
});

// Upload Incomplete บันทึก Cut Off ต่อ Tax Type (Frontend เรียกหลัง Save สำเร็จ)
router.post("/cutoff", async (req, res) => {
  try {
    const { bu, cutoff_date, items, partial } = req.body || {};
    if (!bu || !/^\d{4}-\d{2}-\d{2}$/.test(String(cutoff_date || "")) || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "ต้องระบุ bu, cutoff_date (YYYY-MM-DD) และ items[]" });
    }
    const username = req.user?.email ? await getUsernameByEmail(req.user.email) : "system";
    // ล้างข้อมูลเก่าของ BU ก่อน แล้วค่อยใส่ของใหม่เข้าไป (Tax Type ที่ไม่อยู่ในไฟล์ใหม่ต้องไม่ค้าง)
    if (partial) { // ไฟล์มี Tax Type เดียว: ล้างเฉพาะ Tax Type ที่ส่งมา
      await pool.query("DELETE FROM vat_suspense_cutoff WHERE bu = $1 AND tax_type = ANY($2::text[])", [bu, items.map((it) => String(it.tax_type || "").toUpperCase())]);
    } else {
      await pool.query("DELETE FROM vat_suspense_cutoff WHERE bu = $1", [bu]);
    }
    let n = 0;
    for (const it of items) {
      const t = String(it.tax_type || "").toUpperCase();
      if (!VALID_TAX_TYPES.has(t)) continue;
      await pool.query(
        `INSERT INTO vat_suspense_cutoff (bu, tax_type, cutoff_date, pending_count, uploaded_at, uploaded_by)
         VALUES ($1,$2,$3,$4,NOW(),$5)
         ON CONFLICT (bu, tax_type) DO UPDATE SET cutoff_date = EXCLUDED.cutoff_date, pending_count = EXCLUDED.pending_count, uploaded_at = NOW(), uploaded_by = EXCLUDED.uploaded_by`,
        [bu, t, cutoff_date, Math.max(0, parseInt(it.pending_count, 10) || 0), username]);
      n += 1;
    }
    res.json({ ok: true, saved: n });
  } catch (err) {
    console.error("[vatSuspense] cutoff save error:", err);
    res.status(500).json({ error: "บันทึก Cut Off ไม่สำเร็จ", detail: err.message });
  }
});

// ล้างของ BU (พร้อมปุ่มลบข้อมูล VAT Watchlist ของ BU)
router.delete("/cutoff", async (req, res) => {
  try {
    const bu = String(req.query.bu || "").trim();
    if (!bu) return res.status(400).json({ error: "ต้องระบุ bu" });
    const r = await pool.query("DELETE FROM vat_suspense_cutoff WHERE bu = $1", [bu]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    console.error("[vatSuspense] cutoff delete error:", err);
    res.status(500).json({ error: "ล้าง Cut Off ไม่สำเร็จ", detail: err.message });
  }
});

export default router;
