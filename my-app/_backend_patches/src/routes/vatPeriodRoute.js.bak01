/**
 * routes/vatPeriodRoute.js
 *
 * VAT Period Management — เก็บข้อมูลใน system_settings แบบเดียวกับ AP
 * (apPeriod.js) เพื่อ Consistent กับ Pattern เดิมที่มีอยู่แล้วในระบบ
 * แต่ Logic เรียบง่ายกว่ามาก:
 *
 *   AP  = 4 สถานะ (open/pre-close/blocked/closed) + Cron Sync ทุก 5 นาที +
 *         Request-Close + Approve + Auto-Close หลัง 1 ชม.
 *   VAT = 2 สถานะ (open/closed) เท่านั้น — Owner/Admin(มี Permission VAT)
 *         ปิดได้ทันทีเมื่อไหร่ก็ได้ ไม่มี Pre-close/Blocked Window มากั้น
 *         ไม่มี Request-Close Workflow ไม่มี Auto-Close
 *
 * Key ที่ใช้ใน system_settings (แยกจาก ap_period_* ของ AP โดยสิ้นเชิง):
 *   vat_period_month           = เดือนล่าสุดที่ปิดไปแล้ว (M-1) เช่น '2026-07'
 *   vat_period_current_status  = 'open' | 'closed'
 *   vat_period_closed_by       = Username คนที่กดปิดล่าสุด
 *   vat_period_closed_at       = Timestamp ที่ปิดล่าสุด
 *
 * ยังไม่ได้ Mount เข้า app.js — ต้องเพิ่มเองก่อนใช้งานจริง:
 *   import vatPeriodRoute from "./routes/vatPeriodRoute.js";
 *   app.use("/api/vat/period", vatPeriodRoute);
 *
 * ต้อง Insert Key เริ่มต้นเข้า system_settings ก่อนใช้งานครั้งแรก (ดู SQL
 * ท้ายไฟล์นี้ในส่วน Comment — ปรับเดือนให้ตรงกับปัจจุบันก่อนรัน)
 */

import { Router } from "express";
import { wsBroadcast } from "../app.js"; // MARKER_PERIOD_REALTIME_BROADCAST_V1
import { pool, getUsernameByEmail } from "../db.js";
import { markTaxClosePeriodClosed, markTaxClosePeriodReopened } from "./taxClosePeriod.js"; // MARKER_TAXCLOSE_LIFECYCLE_V1

const router = Router();

const BUSINESS_DAYS = 4; // VAT ต่างจาก AP (2 วันทำการ) — ยืนยันแล้วก่อนหน้า

// ── แปลงรูปแบบเดือนจาก "2026-07" เป็น "Jul 2569" (Pattern เดียวกับ AP) ────
// MARKER_PERIOD_NO_SKIP_GUARD_V1
// ── เดือนสูงสุดที่ปิดได้ = เดือนปฏิทินก่อนหน้าเดือนปัจจุบัน (เวลาไทย) เช่น วันนี้ต.ค. 2026 → ปิดได้สูงสุด 2026-09 ──
function maxClosableMonthStr() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function noSkipMsg(closingMonthStr) {
  return `ปิด Period ${fmtMonth(closingMonthStr)} ไม่ได้ — ปิดได้สูงสุดถึง ${fmtMonth(maxClosableMonthStr())} เท่านั้น (ห้ามปิดข้าม Period)`;
}

function fmtMonth(ym) {
  if (!ym) return "---";
  const [y, m] = ym.split("-").map(Number);
  const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mn[m-1]} ${y+543}`;
}

async function setSetting(key, value, updatedBy, client) {
  const db = client || pool;
  await db.query(
    `UPDATE system_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3`,
    [value, updatedBy, key]
  );
}

// ── คำนวณ Deadline (นับ 4 วันทำการจากวันที่ 1 ของเดือนถัดจาก Current) ─────
function getDeadline(currentMonthStr, businessDays = BUSINESS_DAYS) {
  const [y, m] = currentMonthStr.split("-").map(Number);
  let d = new Date(y, m, 1);
  let cnt = 0;
  let dl = null;
  while (cnt < businessDays) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) { cnt++; if (cnt === businessDays) dl = new Date(d); }
    if (cnt < businessDays) d.setDate(d.getDate() + 1);
  }
  return dl;
}

function nextMonthStr(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── GET /api/vat/period/status — สถานะ Period ปัจจุบันของ VAT ─────────────
router.get("/status", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM system_settings
       WHERE key IN ('vat_period_month', 'vat_period_current_status',
                      'vat_period_closed_by', 'vat_period_closed_at')`
    );
    const s = {};
    rows.forEach(r => s[r.key] = r.value);

    if (!s.vat_period_month) {
      return res.status(404).json({ error: "vat_period_month ยังไม่ถูกตั้งค่าเริ่มต้น — ต้อง Seed ก่อน" });
    }

    const currentMonthStr = nextMonthStr(s.vat_period_month);
    const deadline = getDeadline(currentMonthStr);

    res.json({
      ok: true,
      vat_period_month: s.vat_period_month,
      vat_period_current_month: currentMonthStr,
      vat_period_current_status: s.vat_period_current_status || "open",
      vat_period_closed_by: s.vat_period_closed_by || null,
      vat_period_closed_at: s.vat_period_closed_at || null,
      vat_period_deadline: deadline,
      vat_period_business_days: BUSINESS_DAYS,
    });
  } catch (err) {
    console.error("GET /vat/period/status error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/vat/period/close — ปิด Period ปัจจุบัน + เปิดเดือนถัดไป ─────
// MARKER_VATPERIOD_CLOSE_INTEGRITY_CHECK_V1 -- นับจำนวนแถวตามสถานะ Over/ปกติ ก่อน-หลังปิด Period เพื่อตรวจว่าข้อมูลไม่ตกหล่น
async function countOverStatuses(client) {
  const out = { pre: 0, ovp: 0, draft: 0, fu: 0 };
  for (const tbl of ["vat_upload_popvatdraft", "vat_simpleinputdraft", "vat_adi_transferdraft", "vat_watchlist_report"]) {
    try {
      await client.query("SAVEPOINT cntchk_sp");
      const { rows } = await client.query(`SELECT status, COUNT(*)::int AS n FROM ${tbl} WHERE status IN ('pre-draft','ovp-draft','draft','fu-draft') GROUP BY status`);
      rows.forEach((r) => { const k = { "pre-draft": "pre", "ovp-draft": "ovp", draft: "draft", "fu-draft": "fu" }[r.status]; if (k) out[k] += r.n; });
      await client.query("RELEASE SAVEPOINT cntchk_sp");
    } catch (e) {
      try { await client.query("ROLLBACK TO SAVEPOINT cntchk_sp"); } catch (e2) { /* ignore */ }
    }
  }
  return out;
}

router.post("/close", async (req, res) => {
  const role = req.user.appRole;
  const permissions = req.user.permissions || {};
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (!["Owner", "Admin"].includes(role)) {
    return res.status(403).json({ error: "Admin/Owner only" });
  }
  if (role === "Admin" && permissions.VAT !== true) {
    return res.status(403).json({ error: "ต้องมี Permission VAT เท่านั้น" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: settingRows } = await client.query(
      `SELECT key, value FROM system_settings
       WHERE key IN ('vat_period_month', 'vat_period_current_status')
       FOR UPDATE`
    );
    const s = {};
    settingRows.forEach(r => s[r.key] = r.value);

    if (!s.vat_period_month) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "vat_period_month ไม่ถูกตั้งค่าไว้" });
    }
    if (s.vat_period_current_status === "closed") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "VAT Period นี้ถูกปิดไปแล้ว (อาจถูกปิดไปแล้วโดยคนอื่น)" });
    }

    const closingMonthStr = nextMonthStr(s.vat_period_month);

    // MARKER_PERIOD_NO_SKIP_GUARD_V1 -- ห้ามปิดเดือนที่ยังไม่จบ / ห้ามปิดข้าม Period (ทุก Role รวม Owner) -- เดิม VAT ไม่เช็ค Deadline ฝั่ง Server เลย
    if (closingMonthStr > maxClosableMonthStr()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: noSkipMsg(closingMonthStr) });
    }
    const now = new Date();

    // MARKER_VATPERIOD_CLOSE_AUTO_FREEZE_V1 -- ก่อนเลื่อนงวด: เปลี่ยน Draft ของงวดที่กำลังปิดเป็น Final ทุก BU (Draft ตาม Live มาตลอดแล้ว) -- หลังปิด Draft หยุด และเริ่มนับหน้าต่างอัปเดต 20/30 วัน
    // ใช้ SAVEPOINT ต่อ BU -- ถ้า Freeze พลาดต้องไม่ทำให้การปิด Period ล้ม (แจ้งผลใน activity_log + Response)
    const freezeSummary = { frozen: 0, unchanged: 0, cleared: 0, skipped: 0, errors: [] };
    try {
      // MARKER_VATPERIOD_CLOSE_FREEZE_CLEARED_BU_V1 -- รายชื่อ BU ที่ต้อง Freeze = company_list (ทุก BU) + BU ที่มีใน Live + BU ที่มี Draft ค้าง
      // กัน BU ที่เคลียร์หมดก่อนปิดเดือน (Live ว่าง) หลุดรอบ -- ฟังก์ชัน Finalize จะย้าย Draft ค้างไป History แล้วถือเดือนนั้นเป็นศูนย์
      // งวดของแต่ละ BU = fn_vat_effective_period_month (BU โหมด prev ถือเดือนก่อนหน้างวดระบบ) -- Final ตามงวดของ BU เอง
      const { rows: freezeBus } = await client.query(
        `SELECT b.bu, fn_vat_effective_period_month(b.bu) AS period_month
           FROM (SELECT bu FROM company_list WHERE bu IS NOT NULL AND btrim(bu) <> ''
                 UNION SELECT bu FROM vat_summary_live
                 UNION SELECT bu FROM vat_summary_frozen WHERE freeze_status = 'draft') b
          WHERE fn_vat_effective_period_month(b.bu) IS NOT NULL
          ORDER BY b.bu`);
      for (const { bu: fbu, period_month: fper } of freezeBus) {
        try {
          await client.query("SAVEPOINT closefreeze_sp");
          const fr = await client.query(`SELECT fn_freeze_vat_finalize($1, $2, $3, 'auto-close') AS r`, [fper, fbu, username]);
          const act = fr.rows[0] && fr.rows[0].r && fr.rows[0].r.action;
          if (act === "frozen") freezeSummary.frozen++; else if (act === "unchanged") freezeSummary.unchanged++; else if (act === "cleared") freezeSummary.cleared++; else freezeSummary.skipped++;
          await client.query("RELEASE SAVEPOINT closefreeze_sp");
        } catch (e) {
          try { await client.query("ROLLBACK TO SAVEPOINT closefreeze_sp"); } catch (e2) { /* ignore */ }
          console.error("POST /vat/period/close auto freeze error:", fbu, e.message);
          freezeSummary.errors.push({ bu: fbu, error: e.message });
        }
      }
    } catch (e) {
      console.error("POST /vat/period/close auto freeze list error:", e.message);
      freezeSummary.errors.push({ bu: "*", error: e.message });
    }

    await setSetting("vat_period_month", closingMonthStr, username, client);
    await setSetting("vat_period_current_status", "open", username, client);
    await setSetting("vat_period_closed_by", username, username, client);
    await setSetting("vat_period_closed_at", now.toISOString(), username, client);

    // MARKER_VATPERIOD_PULL_OV_INTO_CURRENT_V1
    // ดึง vat_grn_ov (เลขที่วิ่งไว้ก่อนจาก Reopen ถ้ามี) มาต่อเป็น Current
    // แทนการ Reset เป็น 0 ตรงๆ -- จะไม่มีผลกระทบต่อ Case ปกติ (vat_grn_ov=0 เสมอ)
    const { rowCount } = await client.query(
      `UPDATE company_list SET
        vat_grn_prev = vat_grn,
        vat_grn = vat_grn_ov,
        vat_grn_ov = 0,
        vat_over_period = false -- MARKER_VATPERIOD_CLOSE_RELEASE_OVER_MODE_V1 ปิด Period แล้วปลดโหมด Over Period (เลขที่วิ่งไว้ใน vat_grn_ov ถูกดึงมาเป็นเลขปัจจุบันข้างบนแล้ว)
       WHERE deleted = false`
    );

    // MARKER_VATPERIOD_CLOSE_RELEASE_FU_OVP_DRAFT_V1
    // ปิด Period: รายการที่พักไว้ (status='ovp-draft' จาก Over Period) กลับเป็น 'draft' ทั้งหมด (Period ของแถวเป็นเดือนถัดไป = Period ใหม่พอดี)
    // ใช้ SAVEPOINT -- ถ้าตารางไหนไม่มี/พลาด ต้องไม่ทำให้การปิด Period ล้มทั้งก้อน
    const cntBefore = await countOverStatuses(client); // MARKER_VATPERIOD_CLOSE_INTEGRITY_CHECK_V1
    let ovpReleased = 0;
    // MARKER_VATPERIOD_REOPEN_RESTORE_OVER_V1 -- จดรายการที่ปล่อยตอนปิด เพื่อให้ /reopen ย้อนกลับได้ตรงตัว (ไม่ต้องเดาจากรูปแบบวันที่)
    try {
      await client.query("SAVEPOINT ovplog_sp");
      await client.query(`CREATE TABLE IF NOT EXISTS vat_close_released_rows (tbl text NOT NULL, row_id bigint NOT NULL, lane text NOT NULL, closed_period text, created_at timestamptz DEFAULT NOW())`);
      await client.query(`DELETE FROM vat_close_released_rows`);
      await client.query("RELEASE SAVEPOINT ovplog_sp");
    } catch (e) {
      console.error("POST /vat/period/close ovp log init error:", e.message);
      try { await client.query("ROLLBACK TO SAVEPOINT ovplog_sp"); } catch (e2) { /* ignore */ }
    }
    const logReleased = async (tbl, lane, rows) => {
      if (!rows || !rows.length) return;
      await client.query(
        `INSERT INTO vat_close_released_rows (tbl, row_id, lane, closed_period) SELECT $1, x, $2, $3 FROM unnest($4::bigint[]) AS x`,
        [tbl, lane, closingMonthStr, rows.map((r) => r.id)]
      );
    };
    for (const tbl of ["vat_upload_popvatdraft", "vat_simpleinputdraft", "vat_adi_transferdraft", "vat_watchlist_report"]) {
      try {
        await client.query("SAVEPOINT ovprel_sp");
        const r = await client.query(`UPDATE ${tbl} SET status = 'draft' WHERE status = 'fu-draft' RETURNING id`); // FU-Draft (Confirm แล้วตอน Over) -> draft
        ovpReleased += r.rowCount;
        await logReleased(tbl, 'fu', r.rows);
        if (tbl === "vat_simpleinputdraft" || tbl === "vat_adi_transferdraft") { // OVP-Draft (ยังไม่ Confirm ฝั่ง Over) -> pre-draft
          const r2 = await client.query(`UPDATE ${tbl} SET status = 'pre-draft' WHERE status = 'ovp-draft' RETURNING id`);
          ovpReleased += r2.rowCount;
          await logReleased(tbl, 'ovp', r2.rows);
        }
        await client.query("RELEASE SAVEPOINT ovprel_sp");
      } catch (e) {
        console.error("POST /vat/period/close release ovp-draft error:", tbl, e.message);
        try { await client.query("ROLLBACK TO SAVEPOINT ovprel_sp"); } catch (e2) { /* ignore */ }
      }
    }

    const cntAfter = await countOverStatuses(client); // MARKER_VATPERIOD_CLOSE_INTEGRITY_CHECK_V1
    const integrityOk = cntAfter.ovp === 0 && cntAfter.fu === 0
      && (cntBefore.pre + cntBefore.ovp) === cntAfter.pre
      && (cntBefore.draft + cntBefore.fu) === cntAfter.draft;
    const integrityText = `ตรวจข้อมูลตอนปิด: ก่อน Pre-draft ${cntBefore.pre} / OVP ${cntBefore.ovp} / Draft ${cntBefore.draft} / FU ${cntBefore.fu} → หลัง Pre-draft ${cntAfter.pre} / Draft ${cntAfter.draft} / OVP ${cntAfter.ovp} / FU ${cntAfter.fu} — ${integrityOk ? "ครบ ไม่ตกหล่น" : "⚠ ตัวเลขไม่ตรง กรุณาตรวจสอบ"}`;
    if (!integrityOk) console.error("POST /vat/period/close integrity mismatch:", JSON.stringify({ cntBefore, cntAfter }));

    // MARKER_VATPERIOD_CLOSE_AUTO_PVBACKUP_V1
    // กรณีไม่มีใครกด Finish: ปิด Period แล้ว Batch ที่ Export ค้างอยู่ (status='exported') เปลี่ยนเป็น 'pv-backup' อัตโนมัติ + กำหนดหมดอายุ = วันปิด (Popvat/Simple 6 เดือน, ADI 1 เดือน)
    // ใช้ SAVEPOINT -- ถ้าส่วนนี้พลาด ต้องไม่ทำให้การปิด Period ล้มทั้งก้อน
    let pvBackupCount = 0;
    try {
      await client.query("SAVEPOINT pvbackup_sp");
      for (const [tbl, retention, backupStatus] of [["vat_upload_popvatdraft", "6 months", "pv-backup"], ["vat_simpleinputdraft", "6 months", "sm-backup"], ["vat_adi_transferdraft", "1 month", "adi-backup"]]) { // MARKER_VATPERIOD_SEPARATE_BACKUP_STATUS_V1 // อายุเก็บ: Popvat/Simple 6 เดือน, ADI 1 เดือน
        await client.query(`ALTER TABLE IF EXISTS ${tbl} ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS expire_at TIMESTAMPTZ`);
        const r = await client.query(
          `UPDATE ${tbl} SET status = '${backupStatus}', finished_at = NOW(), expire_at = NOW() + INTERVAL '${retention}'
           WHERE status = 'exported' AND batch_id IS NOT NULL`
        );
        pvBackupCount += r.rowCount;
      }
      await client.query("RELEASE SAVEPOINT pvbackup_sp");
    } catch (e) {
      console.error("POST /vat/period/close auto pv-backup error:", e.message);
      try { await client.query("ROLLBACK TO SAVEPOINT pvbackup_sp"); } catch (e2) { /* ignore */ }
      pvBackupCount = 0;
    }

    // MARKER_TAXCLOSE_LIFECYCLE_V1
    // ตั้งเวลาล้างข้อมูล Timeline ปิดภาษี = วันปิด + tax_close_retention_days (ค่าเริ่มต้น 15 วัน ปฏิทิน)
    // ใช้ SAVEPOINT -- ถ้าส่วนนี้พลาด (เช่น ยังไม่ได้รัน SQL สร้างตาราง) ต้องไม่ทำให้การปิด Period ล้มทั้งก้อน
    try {
      await client.query("SAVEPOINT taxclose_sp");
      await markTaxClosePeriodClosed(client, closingMonthStr, username);
      await client.query("RELEASE SAVEPOINT taxclose_sp");
    } catch (e) {
      console.error("POST /vat/period/close tax-close lifecycle error:", e.message);
      try { await client.query("ROLLBACK TO SAVEPOINT taxclose_sp"); } catch (e2) { /* ignore */ }
    }

    await client.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, 'VAT', 'CLOSE_PERIOD', $2, NOW())`,
      [logUsername, JSON.stringify({ closed_month: closingMonthStr, bu_reset_count: rowCount, pv_backup_rows: pvBackupCount, freeze: freezeSummary, over_before: cntBefore, over_after: cntAfter, integrity_ok: integrityOk })]
    );

    await client.query(
      `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
       VALUES ($1, $2, 'VAT_PERIOD', 'CLOSE_PERIOD', 'VAT', $3, $4)
       ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         action_type = EXCLUDED.action_type,
         created_by = EXCLUDED.created_by,
         created_at = NOW(),
         read_by = EXCLUDED.read_by`,
      [
        `ปิด VAT Period ${fmtMonth(closingMonthStr)} — ทุก BU`,
        `สั่งปิด VAT Period เดือน ${fmtMonth(closingMonthStr)} ให้ทุก BU (${rowCount} บริษัท) — เลขวิ่ง GRN Reset เป็น 0 — ดำเนินการโดย ${username} — ${integrityText}`,
        username,
        JSON.stringify([username]),
      ]
    );

    await client.query("COMMIT");
    wsBroadcast('period_status_updated', { type: 'VAT' }); // MARKER_PERIOD_REALTIME_BROADCAST_V1

    res.json({
      ok: true,
      closed_month: closingMonthStr,
      bu_reset_count: rowCount,
      closed_by: username,
      freeze: freezeSummary,
      integrity: { ok: integrityOk, before: cntBefore, after: cntAfter },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /vat/period/close error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// MARKER_PERIOD_REOPEN_DEADLINE7_V1
// ── Reopen ได้ถึง "Deadline + 7 วัน" ของงวดที่ปิด (ไม่ใช่ 7 วันหลังกดปิด) ──
// Deadline = วันทำการ (จันทร์-ศุกร์) ที่ 4 (BUSINESS_DAYS ของ VAT) ของเดือนถัดจากเดือนที่ปิด -- เวลาไทย
// เลยวันที่ 7 หลัง Deadline (สิ้นวัน) แล้ว Reopen ไม่ได้ และปิดซ้ำไม่ได้ (Guard เดือน + Lock) จนกว่าจะถึง Deadline ของงวดถัดไป
function reopenWindowEnd(closedMonthStr) {
  const [cy, cm] = String(closedMonthStr).split("-").map(Number); // cm = 1-12 (เดือนที่ปิด)
  const d = new Date(cy, cm, 1); // วันที่ 1 ของเดือนถัดไป
  let cnt = 0;
  while (true) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) { cnt++; if (cnt === BUSINESS_DAYS) break; } // VAT = วันทำการที่ 4
    d.setDate(d.getDate() + 1);
  }
  d.setDate(d.getDate() + 8); // Deadline + 7 วัน (ถึงสิ้นวัน) = 00:00 ของวันที่ +8
  return d;
}
function isReopenWindowExpired(closedMonthStr) {
  const bkkNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return bkkNow >= reopenWindowEnd(closedMonthStr);
}

// POST /api/vat/period/reopen -- Owner only, ยกเลิกการปิด Period ล่าสุด
// ใช้ได้ถึง Deadline + 7 วัน ของงวดที่ปิด เท่านั้น (MARKER_PERIOD_REOPEN_DEADLINE7_V1) (Pattern เดียวกับ Self-Override ของ AP)
// เก็บเลขที่วิ่งไปแล้วช่วงเปิดผิดพลาดไว้ที่ vat_grn_ov ไม่ทิ้ง -- พอปิดจริงรอบหน้า
// จะดึงกลับมาต่อเอง (ดู /close ด้านบน)
router.post("/reopen", async (req, res) => {
  const role = req.user.appRole;
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: settingRows } = await client.query(
      `SELECT key, value FROM system_settings
       WHERE key IN (\'vat_period_month\', \'vat_period_closed_at\')
       FOR UPDATE`
    );
    const s = {};
    settingRows.forEach(r => s[r.key] = r.value);

    if (!s.vat_period_closed_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "ไม่พบประวัติการปิด Period ล่าสุด" });
    }

    // MARKER_PERIOD_REOPEN_DEADLINE7_V1 -- Reopen ได้ถึง Deadline + 7 วัน ของงวดที่ปิด (vat_period_month = เดือนที่เพิ่งปิด)
    if (isReopenWindowExpired(s.vat_period_month)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "เกิน Deadline + 7 วัน แล้ว ไม่สามารถ Reopen ได้อีก (ปิดซ้ำไม่ได้จนกว่าจะถึง Deadline ถัดไป)" });
    }

    const [y, m] = s.vat_period_month.split("-").map(Number);
    const d = new Date(y, m - 2, 1); // ถอยกลับ 1 เดือนจาก M-1 ปัจจุบัน
    const revertedMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    await setSetting("vat_period_month", revertedMonthStr, username, client);
    await setSetting("vat_period_current_status", "open", username, client);
    await setSetting("vat_period_closed_by", null, username, client);
    await setSetting("vat_period_closed_at", null, username, client);

    const { rowCount } = await client.query(
      `UPDATE company_list SET
        vat_grn_ov = vat_grn,
        vat_grn = vat_grn_prev
       WHERE deleted = false`
    );

    await client.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, \'VAT\', \'REOPEN_PERIOD\', $2, NOW())`,
      [logUsername, JSON.stringify({ reverted_month: revertedMonthStr, bu_count: rowCount })]
    );

    // MARKER_TAXCLOSE_LIFECYCLE_V1
    // Reopen ภายใน 7 วัน (< 15 วันที่ล้างข้อมูล) -- ยกเลิกการนับถอยหลังล้างข้อมูล Timeline ของเดือนที่เปิดกลับ
    try {
      await client.query("SAVEPOINT taxclose_sp");
      await markTaxClosePeriodReopened(client, s.vat_period_month);
      await client.query("RELEASE SAVEPOINT taxclose_sp");
    } catch (e) {
      console.error("POST /vat/period/reopen tax-close lifecycle error:", e.message);
      try { await client.query("ROLLBACK TO SAVEPOINT taxclose_sp"); } catch (e2) { /* ignore */ }
    }

    // MARKER_VATPERIOD_REOPEN_RESTORE_OVER_V1
    // Reopen: รายการที่ถูกปล่อยตอน Close กลับไปเป็น Over อีกครั้ง (draft -> fu-draft, pre-draft -> ovp-draft)
    // ย้อนเฉพาะแถวที่ยังไม่ถูกเปลี่ยนต่อ (ยัง draft / pre-draft อยู่ ; ที่ Export / Confirm ไปแล้วไม่แตะ)
    let overRestored = 0;
    for (const [tbl, lane, fromSt, toSt] of [["vat_upload_popvatdraft", "fu", "draft", "fu-draft"], ["vat_simpleinputdraft", "fu", "draft", "fu-draft"], ["vat_adi_transferdraft", "fu", "draft", "fu-draft"], ["vat_watchlist_report", "fu", "draft", "fu-draft"], ["vat_simpleinputdraft", "ovp", "pre-draft", "ovp-draft"], ["vat_adi_transferdraft", "ovp", "pre-draft", "ovp-draft"]]) {
      try {
        await client.query("SAVEPOINT ovprestore_sp");
        const r = await client.query(
          `UPDATE ${tbl} SET status = $1 WHERE status = $2 AND id IN (SELECT row_id FROM vat_close_released_rows WHERE tbl = $3 AND lane = $4)`,
          [toSt, fromSt, tbl, lane]
        );
        overRestored += r.rowCount;
        await client.query("RELEASE SAVEPOINT ovprestore_sp");
      } catch (e) {
        console.error("POST /vat/period/reopen restore over error:", tbl, lane, e.message);
        try { await client.query("ROLLBACK TO SAVEPOINT ovprestore_sp"); } catch (e2) { /* ignore */ }
      }
    }
    try {
      await client.query("SAVEPOINT ovpclr_sp");
      await client.query(`DELETE FROM vat_close_released_rows`);
      await client.query("RELEASE SAVEPOINT ovpclr_sp");
    } catch (e) {
      try { await client.query("ROLLBACK TO SAVEPOINT ovpclr_sp"); } catch (e2) { /* ignore */ }
    }

    // MARKER_VATPERIOD_REOPEN_CLEAR_NOTIF_V1
    // ── Bug เดิม: Reopen ไม่เคยลบ Notification "ปิด Period" ที่ /close สร้างไว้ ──
    // ── ทำให้ Bell ยังค้างขึ้นแจ้งว่าปิด Period อยู่ ทั้งที่ Reopen ไปแล้ว ──
    await client.query(
      `DELETE FROM notifications WHERE category = 'VAT_PERIOD'`
    );

    await client.query("COMMIT");
    wsBroadcast('period_status_updated', { type: 'VAT' }); // MARKER_PERIOD_REALTIME_BROADCAST_V1
    res.json({ ok: true, reverted_month: revertedMonthStr, bu_count: rowCount, over_restored: overRestored });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /vat/period/reopen error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;

/* ═══════════════════════════════════════════════════════════════════════
   SQL Seed — รันครั้งเดียวก่อนใช้งานจริง (ปรับเดือนให้ตรงปัจจุบันก่อนรัน)
   ═══════════════════════════════════════════════════════════════════════

INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES
  ('vat_period_month', '2026-07', 'system', NOW()),
  ('vat_period_current_status', 'open', 'system', NOW()),
  ('vat_period_closed_by', NULL, 'system', NOW()),
  ('vat_period_closed_at', NULL, 'system', NOW())
ON CONFLICT (key) DO NOTHING;

*/
