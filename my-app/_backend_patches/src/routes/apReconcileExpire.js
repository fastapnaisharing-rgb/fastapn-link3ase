// MARKER_APRECONCILE_EXPIRE_V1 -- Item Expired Date ของงาน AP/IE Reconcile (My Job / All Job)
//   Confirm งาน -> expire_at = Confirm + 30 วัน (ปรับได้ด้วย Env AP_RECON_EXPIRE_DAYS)
//   ครบกำหนด -> Cron ลบ "แถวข้อมูล AP" (ap_cutting_staging) ของ BU + Period + Account ของงานนั้น แล้วตั้ง expire_purged = true (ไฟล์รายงานและ Detail of Overhead / DT ไม่ถูกลบ)
//   Frontend (ReconcileZoneLayout.js) แสดง "XXX / dd-mmm-yy" จาก expire_lines / expire_at, "ลบแล้ว / dd-mmm-yy" เมื่อ expire_purged
import { pool } from "../db.js";

export const AP_EXPIRE_DAYS = Number(process.env.AP_RECON_EXPIRE_DAYS) || 30;
const AP_MODULE = "ap-reconcile";
// MARKER_APRECONCILE_STALE_AUTOPURGE_V1 -- ข้อมูล AP (ap_cutting_staging) ที่ไม่มีใคร Confirm ภายใน N วันนับจาก Import ล่าสุด -> ลบเอง (เฉพาะด้าน AP)
export const AP_STALE_DAYS = Number(process.env.AP_STALE_UNCONFIRMED_DAYS) || 45;
let lastStalePurge = 0;

let ready = null;
export function ensureApExpireColumns() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS expire_at timestamptz, ADD COLUMN IF NOT EXISTS expire_lines integer, ADD COLUMN IF NOT EXISTS expire_purged boolean NOT NULL DEFAULT false`);
      // งานที่ Confirm ไปแล้วก่อนมี Feature นี้: เริ่มนับ 30 วันจาก "วันนี้" (ไม่นับย้อนจากวัน Confirm เดิม กันข้อมูลถูกลบทันทีที่ Deploy)
      await pool.query(`UPDATE file_storage SET expire_at = NOW() + ($1 || ' days')::interval WHERE module = $2 AND confirmed_at IS NOT NULL AND expire_at IS NULL AND status <> 'recycled'`, [String(AP_EXPIRE_DAYS), AP_MODULE]);
    })().catch((e) => { ready = null; console.error("[apReconcileExpire] ensure columns:", e.message); throw e; });
  }
  return ready;
}

function parseRef(refId) {
  const [account, period] = String(refId || "").split("|");
  return { account: account || null, period: period || null };
}

export async function countApLines(bu, refId) {
  const { account, period } = parseRef(refId);
  if (!bu || !account || !period) return 0;
  const q = await pool.query(`SELECT COUNT(*)::int AS n FROM ap_cutting_staging WHERE branch_cpc_key = $1 AND period = $2 AND gl_account = $3`, [bu, period, account]);
  return q.rows[0]?.n || 0;
}

export async function stampApJobExpire(id) {
  await ensureApExpireColumns();
  const r = await pool.query(`SELECT bu, ref_id FROM file_storage WHERE id = $1 AND module = $2`, [id, AP_MODULE]);
  if (!r.rows.length) return null;
  const n = await countApLines(r.rows[0].bu, r.rows[0].ref_id);
  const up = await pool.query(`UPDATE file_storage SET expire_at = NOW() + ($2 || ' days')::interval, expire_lines = $3, expire_purged = false WHERE id = $1 RETURNING expire_at, expire_lines, expire_purged`, [id, String(AP_EXPIRE_DAYS), n]);
  return up.rows[0];
}

export async function clearApJobExpire(id) {
  await ensureApExpireColumns();
  await pool.query(`UPDATE file_storage SET expire_at = NULL, expire_lines = NULL, expire_purged = false WHERE id = $1`, [id]);
}

// เรียกจาก Cron 5 นาที: ลบแถว AP (ap_cutting_staging) ของงานที่ Confirm แล้วและครบกำหนด
export async function purgeExpiredApReconcileLines() {
  await ensureApExpireColumns();
  try { await purgeStaleUnconfirmedApLines(); } catch (e) { console.error("[apReconcileExpire] stale purge:", e.message); } // MARKER_APRECONCILE_STALE_AUTOPURGE_V1
  const due = await pool.query(`SELECT id, bu, ref_id FROM file_storage WHERE module = $1 AND confirmed_at IS NOT NULL AND expire_at IS NOT NULL AND expire_at < NOW() AND expire_purged IS NOT TRUE ORDER BY expire_at LIMIT 50`, [AP_MODULE]);
  for (const j of due.rows) {
    const { account, period } = parseRef(j.ref_id);
    if (!j.bu || !account || !period) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const del = await client.query(`DELETE FROM ap_cutting_staging WHERE branch_cpc_key = $1 AND period = $2 AND gl_account = $3`, [j.bu, period, account]);
      await client.query(`UPDATE file_storage SET expire_purged = true, expire_lines = $2 WHERE id = $1`, [j.id, del.rowCount]);
      await client.query("COMMIT");
      console.log(`[apReconcileExpire] purged ${del.rowCount} lines bu=${j.bu} period=${period} account=${account}`);
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
      console.error("[apReconcileExpire] purge error:", j.id, e.message);
    } finally { client.release(); }
  }
}

// MARKER_APRECONCILE_STALE_AUTOPURGE_V1 -- ลบข้อมูล AP ค้าง: กลุ่ม BU + Period + Account ที่ Import ล่าสุดเกิน AP_STALE_DAYS (45) วัน และไม่มีงาน Confirm
//   (เงื่อนไข "ไม่มี Confirm" เหมือนปุ่ม "ข้อมูลค้าง" ใน Reconcile Control Zone) | ทำงานจาก Cron เดิมของ purgeExpiredApReconcileLines (ตรวจไม่เกินชั่วโมงละครั้ง)
export async function purgeStaleUnconfirmedApLines() {
  if (Date.now() - lastStalePurge < 55 * 60 * 1000) return;
  lastStalePurge = Date.now();
  const groups = await pool.query(
    `SELECT s.branch_cpc_key AS bu, s.period, s.gl_account AS account, COUNT(*)::int AS lines
       FROM ap_cutting_staging s
      WHERE s.branch_cpc_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM file_storage f WHERE f.module = $1 AND f.bu = s.branch_cpc_key AND f.ref_id = s.gl_account || '|' || s.period || '|ap' AND f.confirmed_at IS NOT NULL AND f.status <> 'recycled')
      GROUP BY s.branch_cpc_key, s.period, s.gl_account
     HAVING MAX(s.imported_at) < NOW() - ($2 || ' days')::interval
      LIMIT 200`,
    [AP_MODULE, String(AP_STALE_DAYS)]
  );
  for (const g of groups.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // ตรวจซ้ำในทรานแซกชันเดียวกัน: ยังไม่ Confirm + ยังเก่าเกินกำหนด (กัน Import/Confirm เข้ามาระหว่างนั้น)
      const del = await client.query(
        `DELETE FROM ap_cutting_staging s
          WHERE s.branch_cpc_key = $1 AND s.period = $2 AND s.gl_account = $3
            AND NOT EXISTS (SELECT 1 FROM file_storage f WHERE f.module = $4 AND f.bu = s.branch_cpc_key AND f.ref_id = s.gl_account || '|' || s.period || '|ap' AND f.confirmed_at IS NOT NULL AND f.status <> 'recycled')
            AND NOT EXISTS (SELECT 1 FROM ap_cutting_staging x WHERE x.branch_cpc_key = s.branch_cpc_key AND x.period = s.period AND x.gl_account = s.gl_account AND x.imported_at >= NOW() - ($5 || ' days')::interval)`,
        [g.bu, g.period, g.account, AP_MODULE, String(AP_STALE_DAYS)]
      );
      await client.query("COMMIT");
      if (del.rowCount) console.log(`[apReconcileExpire] stale-unconfirmed purged ${del.rowCount} lines bu=${g.bu} period=${g.period} account=${g.account} (>${AP_STALE_DAYS}d)`);
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
      console.error("[apReconcileExpire] stale purge error:", g.bu, g.period, g.account, e.message);
    } finally { client.release(); }
  }
}
