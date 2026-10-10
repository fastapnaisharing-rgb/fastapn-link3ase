import { Router } from "express";
import { wsBroadcast } from "../app.js"; // MARKER_PERIOD_REALTIME_BROADCAST_V1
import { pool, getUsernameByEmail } from "../db.js";

const router = Router();

// ── แปลงรูปแบบเดือนจาก "2026-07" เป็น "Jul 2569" ให้อ่านง่ายในข้อความ Notification ──
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

// ── ตรวจ Deadline + Sync สถานะ Current → Pre-close → Blocked ไปที่ company_list ──
// ── เรียกจาก Cron ทุก 5 นาที (app.js) ไม่ต้องพึ่งว่ามีคนเปิดหน้าเว็บหรือเปล่า ──
export async function checkAndSyncPeriodStatus() {
  const { rows } = await pool.query(
    `SELECT key, value FROM system_settings WHERE key IN ('ap_period_current_status', 'ap_period_month')`
  );
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);

  // ── ทำงานได้ทุกสถานะ ยกเว้น 'closed' (เพิ่งปิดไปหมาดๆ รอ /close ตั้งค่า ap_period_month ใหม่ก่อน) ──
  // ── เดิมเช็คแค่ === 'open' ทำให้พอเข้า pre-close/blocked แล้วไม่เคยเช็คซ้ำอีกเลย ──
  if (settings.ap_period_current_status === 'closed' || !settings.ap_period_month) return;

  // ── ap_period_month = M-1 (เดือนที่เพิ่งปิดไปล่าสุด) ──
  // ── Current = M-1 + 1 เดือน (เดือนที่กำลังทำงานอยู่ ยังไม่ปิด) ──
  // ── Deadline การปิด Current ต้องนับ 2 วันทำการแรก "หลังจากสิ้นเดือน Current" ──
  // ── นั่นคือต้นเดือนถัดจาก Current อีกที = M-1 + 2 เดือน ──
  const [y, m] = settings.ap_period_month.split('-').map(Number);
  let d = new Date(y, m + 1, 1), cnt = 0, dl = null;
  while (cnt < 2) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) { cnt++; if (cnt === 2) dl = new Date(d); }
    if (cnt < 2) d.setDate(d.getDate() + 1);
  }
  const today = new Date();
  const diffDays = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));

  // MARKER_APPERIOD_PRECLOSE_STARTS_NEXT_MONTH_V1
  // ── นิยามใหม่: Pre-close ต้องเริ่มทันทีที่ปฏิทินจริงข้ามเข้าเดือนถัดจาก Current ──
  // ── (ไม่ใช่รอแค่ 2 วันทำการสุดท้ายก่อน Deadline) เพราะ Current ยังไม่ปิดแต่เดือน ──
  // ── จริงเปลี่ยนไปแล้ว ถือว่าอยู่ในช่วงผ่อนผันตั้งแต่วันแรกของเดือนถัดไปเลย ──────
  const currentPeriodMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`; // Current = ap_period_month + 1 เดือน
  const todayMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const pastCurrentMonth = todayMonthStr > currentPeriodMonthStr;

  // ── คำนวณสถานะที่ถูกต้อง ณ ตอนนี้เสมอ (ไม่ใช่แค่ตอนเปลี่ยน) ──
  let newStatus = 'open';
  if (diffDays < 0) {
    newStatus = 'blocked';     // ── เลย Deadline ไปแล้ว คีย์ Invoice ไม่ได้เลย ต้องขอ Close Period ──
  } else if (diffDays <= 2 || pastCurrentMonth) {
    newStatus = 'pre-close';   // ── ใกล้ Deadline (≤ 2 วันทำการ) หรือข้ามเดือนปฏิทินมาแล้ว ยังคีย์ได้ แต่ Receive Date ล็อกสิ้นเดือน ──
  }

  if (settings.ap_period_current_status !== newStatus) {
    await pool.query(
      `UPDATE system_settings SET value = $1, updated_by = 'system', updated_at = NOW() WHERE key = 'ap_period_current_status'`,
      [newStatus]
    );
  }

  // ── Force Sync ไป company_list ทุกครั้งที่ Cron รัน ไม่ใช่แค่ตอนสถานะเปลี่ยน ──
  // ── กันค่าเก่า/ผิด Case ค้างอยู่ไม่ถูกแก้ (ใช้ IS DISTINCT FROM กันเขียนทับซ้ำถ้าตรงอยู่แล้ว) ──
  // ── ทุก BU ที่ไม่ได้ Override อยู่ (ap_period_mode != 'prev') เท่านั้น ──
  const statusLabel = newStatus === 'blocked' ? 'Blocked' : newStatus === 'pre-close' ? 'Pre-close' : 'Current';
  await pool.query(
    `UPDATE company_list SET ap_bu_period_status = $1 WHERE ap_period_mode != 'prev' AND ap_bu_period_status IS DISTINCT FROM $1`,
    [statusLabel]
  );

  // ── Force Sync ap_bu_period_month ให้ตรงกับ system_settings.ap_period_month เสมอ ──
  // ── กัน Drift ระหว่าง Field สำเนาต่อ BU กับค่าจริง Global (เจอปัญหานี้จริงจากบาง BU ค้างเดือนเก่า) ──
  await pool.query(
    `UPDATE company_list SET ap_bu_period_month = $1 WHERE ap_period_mode != 'prev' AND ap_bu_period_month IS DISTINCT FROM $1`,
    [settings.ap_period_month]
  );
}

// GET /api/ap/period/status — เก็บไว้เผื่อ Debug/Backward-compat ไม่ใช่กลไกหลักในการ Sync อีกต่อไป
router.get("/status", async (req, res) => {
  try {
    await checkAndSyncPeriodStatus();

    const { rows } = await pool.query(
      `SELECT key, value FROM system_settings 
       WHERE key IN (
         'ap_period_status', 'ap_period_month',
         'ap_period_closed_by', 'ap_period_closed_at',
         'ap_period_current_status', 'ap_period_prev_status'
       )`
    );
    const result = {};
    rows.forEach(r => result[r.key] = r.value);

    // ── เช็คว่ามี Request-Close ค้างอยู่ไหม กันเด้ง Popup ซ้ำ ──
    const { rows: pendingRows } = await pool.query(
      `SELECT id FROM notifications WHERE category = 'AP_PERIOD_REQUEST' AND handled_at IS NULL LIMIT 1`
    );
    result.ap_period_has_pending_close_request = pendingRows.length > 0;

    res.json(result);
  } catch (err) {
    console.error("GET /ap/period/status error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ap/period/pending-close — เช็คว่ามี Request-Close ค้างอยู่ไหม (ใช้ได้ทุก User ไม่ต้องมี Permission)
// แยกออกมาจาก /status เพื่อให้พนักงานที่ไม่มี Permission Manual เช็คได้ด้วย (กัน Popup Blocked เด้งซ้ำ)
router.get("/pending-close", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM notifications WHERE category = 'AP_PERIOD_REQUEST' AND handled_at IS NULL LIMIT 1`
    );
    res.json({ hasPendingCloseRequest: rows.length > 0 });
  } catch (err) {
    console.error("GET /ap/period/pending-close error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ap/period/close
router.post("/close", async (req, res) => {
  const role     = req.user.appRole;
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (!["Owner", "Admin"].includes(role)) {
    return res.status(403).json({ error: "Admin/Owner only" });
  }

  try {
    if (role === "Admin") {
      const { rows } = await pool.query(
        `SELECT value FROM system_settings WHERE key = 'ap_period_current_status'`
      );
      const status = rows[0]?.value;
      if (status === "closed") {
        return res.status(409).json({ error: "Period closed already" });
      }
      if (!["pre-close", "blocked"].includes(status)) {
        return res.status(403).json({ error: "ยังไม่ถึง Pre-close window" });
      }
    }

    // ── ดึงค่า ap_period_month เดิมจาก DB ก่อน (ห้ามใช้ new Date() ของวันนี้มาคำนวณ) ──
    // ── ค่านี้คือ M-1 เดิม (เดือนที่ปิดไปก่อนหน้า) เช่น "2026-05" ──
    const { rows: settingRows } = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'ap_period_month'`
    );
    const prevPeriodMonthStr = settingRows[0]?.value;

    if (!prevPeriodMonthStr) {
      return res.status(500).json({ error: "ap_period_month ไม่ถูกตั้งค่าไว้" });
    }

    // ── เดือนที่กำลังปิดจริงๆ คือเดือนถัดไปจาก M-1 เดิม (คือ Current ปัจจุบัน) ──
    // ── หลังปิดแล้ว เดือนนี้จะกลายเป็น M-1 ใหม่ ──
    const [py, pm] = prevPeriodMonthStr.split('-').map(Number);
    const closingDate = new Date(py, pm, 1); // ไม่ลบ 1 จาก pm → ได้เดือนถัดไปจาก M-1 เดิม = เดือนที่กำลังปิดจริง
    const closingMonthStr = `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, "0")}`;

    // MARKER_PERIOD_NO_SKIP_GUARD_V1 -- ห้ามปิดเดือนที่ยังไม่จบ / ห้ามปิดข้าม Period (ทุก Role รวม Owner)
    if (closingMonthStr > maxClosableMonthStr()) {
      return res.status(409).json({ error: noSkipMsg(closingMonthStr) });
    }

    const curMonthStr  = closingMonthStr; // ค่าใหม่ที่จะเซ็ตเป็น ap_period_month (M-1 ใหม่)
    const prevMonthStr = closingMonthStr; // เดือนที่เพิ่งปิดจริง ใช้บันทึกลง company_list.ap_prev_month ด้วย

    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // MARKER_PERIOD_NO_SKIP_GUARD_V1 -- Lock แถว period_month แล้วเช็คซ้ำ กันกด Close ซ้อน (เดิมทำให้ ap_grt_prev ถูกทับเป็น 0)
      const { rows: lockRows } = await client.query(`SELECT value FROM system_settings WHERE key = 'ap_period_month' FOR UPDATE`);
      if (lockRows[0]?.value !== prevPeriodMonthStr) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Period ถูกปิดไปแล้ว (อาจโดยคนอื่น) กรุณารีเฟรชหน้า" });
      }

      await setSetting("ap_period_status",          "closed",          username, client);
      await setSetting("ap_period_month",            curMonthStr,      username, client);
      await setSetting("ap_period_closed_by",        username,          username, client);
      await setSetting("ap_period_closed_at",        now.toISOString(), username, client);
      await setSetting("ap_period_prev_status",      "closed",          username, client);
      await setSetting("ap_period_current_status",   "open",            username, client);

      // MARKER_APPERIOD_PULL_OV_INTO_CURRENT_V1
      // ── เดิม ap_grt/ap_grn Reset เป็น 0 เสมอตอนปิด Period ──────────────
      // ── ตอนนี้ดึง ap_grt_ov/ap_grn_ov (เลขที่วิ่งล่วงหน้าไว้ก่อน Period ──
      // ── ปิดจริง) มาต่อเป็น Current แทน แล้วค่อย Reset Ov กลับเป็น 0 ──────
      const { rowCount } = await client.query(
        `UPDATE company_list SET 
          ap_grt_prev    = ap_grt,
          ap_grn_prev    = ap_grn,
          ap_prev_month  = $1,
          ap_grt         = ap_grt_ov,
          ap_grn         = ap_grn_ov,
          ap_grt_ov      = 0,
          ap_grn_ov      = 0,
          ap_period_mode = 'current',
          ap_bu_period_status = 'Current'`,
        [prevMonthStr]
      );

      await client.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, 'AP', 'CLOSE_PERIOD', $2, NOW())`,
        [logUsername, JSON.stringify({ prev_month: prevMonthStr, current_month: curMonthStr, bu_reset_count: rowCount })]
      );

      // ── แจ้งเตือนเฉพาะ User ที่มี Permission Manual (เกี่ยวข้องกับ AP) ──
      // ── เก็บแค่ 1 แถวเสมอต่อ category — ถ้ามีอยู่แล้วให้ทับข้อความเดิม (Upsert) ──
      // ── ผู้ส่งเอง (username) ไม่ต้องได้รับ Notification ตัวเอง เพราะเห็น Success Message อยู่แล้ว ──
      await client.query(
        `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
         VALUES ($1, $2, 'AP_PERIOD', 'CLOSE_PERIOD', 'Manual', $3, $4)
         ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           action_type = EXCLUDED.action_type,
           created_by = EXCLUDED.created_by,
           created_at = NOW(),
           read_by = EXCLUDED.read_by`,
        [
          `ปิด Period ${fmtMonth(prevMonthStr)} — ทุก BU`,
          `สั่งปิด Period เดือน ${fmtMonth(prevMonthStr)} ให้ทุก BU (${rowCount} บริษัท) — ผลกระทบ: เลขวิ่ง GRT/GRN ของทุก BU รีเซ็ตเริ่มนับใหม่สำหรับเดือน ${fmtMonth(curMonthStr)} — ดำเนินการโดย ${username}`,
          username,
          JSON.stringify([username])
        ]
      );

      // ── ปิด Period สำเร็จแล้ว ถือว่าคำขอ Request-Close ที่ค้างอยู่ถูก Resolve ทั้งหมด ──
      // ── ไม่ว่าจะปิดผ่าน Close ตรงหรือ Approve Request ก็ตาม ต้องหายไปทั้งคู่ ──
      await client.query(
        `DELETE FROM notifications WHERE category = 'AP_PERIOD_REQUEST'`
      );

      await client.query("COMMIT");
      wsBroadcast('period_status_updated', { type: 'AP' }); // MARKER_PERIOD_REALTIME_BROADCAST_V1
      res.json({ ok: true, prev_month: prevMonthStr, current_month: curMonthStr, bu_reset_count: rowCount });

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("POST /ap/period/close error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});


// POST /api/ap/period/request-close — พนักงานขอให้ Admin/Owner ปิด Period ตอนเจอ Blocked
router.post("/request-close", async (req, res) => {
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  try {
    await pool.query(
      `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
       VALUES ($1, $2, 'AP_PERIOD_REQUEST', 'REQUEST_CLOSE', 'Manual', $3, $4)
       ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         action_type = EXCLUDED.action_type,
         created_by = EXCLUDED.created_by,
         created_at = NOW(),
         read_by = EXCLUDED.read_by,
         handled_at = NULL,
         handled_by = NULL`,
      [
        `คำขอปิด Period จาก ${logUsername}`,
        `${logUsername} ต้องการเริ่ม Batch แต่เลยกำหนดปิด Period แล้ว กรุณาปิด Period ให้ด้วย`,
        username,
        JSON.stringify([username])
      ]
    );

    await pool.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, 'AP', 'REQUEST_CLOSE', $2, NOW())`,
      [logUsername, JSON.stringify({})]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /ap/period/request-close error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ap/period/request-close/:id/handle — Admin/Owner (ที่มี Permission Manual) กด Approve
router.post("/request-close/:id/handle", async (req, res) => {
  const role = req.user.appRole;
  const username = req.user.email;
  const permissions = req.user.permissions || {};
  const { id } = req.params;

  if (!["Owner", "Admin"].includes(role)) {
    return res.status(403).json({ error: "Admin/Owner only" });
  }
  if (permissions.Manual !== true) {
    return res.status(403).json({ error: "ต้องมี Permission Manual เท่านั้น" });
  }

  try {
    // ── กันกดซ้ำ: ต้อง handled_at IS NULL เท่านั้นถึงจะกดผ่านได้ ──
    const { rowCount } = await pool.query(
      `UPDATE notifications 
       SET handled_at = NOW(), handled_by = $1
       WHERE id = $2 AND category = 'AP_PERIOD_REQUEST' AND handled_at IS NULL`,
      [username, id]
    );

    if (rowCount === 0) {
      return res.status(409).json({ error: "คำขอนี้ถูกจัดการไปแล้ว หรือไม่พบคำขอ" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /ap/period/request-close/:id/handle error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ap/period/override/all — Owner only, สั่งทุก BU ให้ Override หรือ Reopen พร้อมกัน
router.post("/override/all", async (req, res) => {
  const role     = req.user.appRole;
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }

  const { mode } = req.body;
  if (!mode || !["prev", "current"].includes(mode)) {
    return res.status(400).json({ error: "mode ต้องเป็น 'prev' หรือ 'current'" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const statusLabel = mode === 'prev' ? 'Override' : 'Current';
      const { rowCount } = await client.query(
        `UPDATE company_list SET ap_period_mode = $1, ap_bu_period_status = $2`,
        [mode, statusLabel]
      );

      const actionName = mode === "prev" ? "OVERRIDE_ALL_BU" : "REOPEN_ALL_BU";
      await client.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, 'AP', $2, $3, NOW())`,
        [logUsername, actionName, JSON.stringify({ bu_count: rowCount, mode })]
      );

      // ── ดึงเดือนปัจจุบัน (M-1 ใน DB) มาคำนวณชื่อเดือน Current และ Previous ให้ระบุในข้อความชัดเจน ──
      const { rows: monthRowsAll } = await client.query(
        `SELECT value FROM system_settings WHERE key = 'ap_period_month'`
      );
      const m1StrAll = monthRowsAll[0]?.value;
      const curDateAll = new Date(m1StrAll + "-01");
      curDateAll.setMonth(curDateAll.getMonth() + 1);
      const curMonthLabelAll = fmtMonth(`${curDateAll.getFullYear()}-${String(curDateAll.getMonth()+1).padStart(2,"0")}`);
      const prevMonthLabelAll = fmtMonth(m1StrAll);

      // ── แจ้งเตือนเฉพาะ User ที่มี Permission Manual (เกี่ยวข้องกับ AP) ──
      // ── เก็บแค่ 1 แถวเสมอต่อ category — ถ้ามีอยู่แล้วให้ทับข้อความเดิม (Upsert) ──
      // ── ผู้ส่งเอง (username) ไม่ต้องได้รับ Notification ตัวเอง ──
      const notifTitle = mode === "prev" ? `เปิด Period ${prevMonthLabelAll} — ทุก BU` : `ปิด Period ${prevMonthLabelAll} — ทุก BU`;
      const notifMsg = mode === "prev"
        ? `สั่งเปิด Period ${prevMonthLabelAll} ให้ทุก BU (${rowCount} บริษัท) (ปัจจุบันเปิดใช้งานปกติคือ ${curMonthLabelAll}) — ผลกระทบ: ใช้เลขวิ่ง GRT/GRN ของ ${prevMonthLabelAll} ได้ และ Received Date ย้อนกลับไปเป็น ${prevMonthLabelAll} ได้ — ดำเนินการโดย ${username}`
        : `สั่งปิด Period ${prevMonthLabelAll} ให้ทุก BU (${rowCount} บริษัท) — ผลกระทบ: กลับมาใช้เลขวิ่ง GRT/GRN และ Received Date ของ ${curMonthLabelAll} ตามปกติ — ดำเนินการโดย ${username}`;
      await client.query(
        `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
         VALUES ($1, $2, 'AP_PERIOD', $3, 'Manual', $4, $5)
         ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           action_type = EXCLUDED.action_type,
           created_by = EXCLUDED.created_by,
           created_at = NOW(),
           read_by = EXCLUDED.read_by`,
        [notifTitle, notifMsg, actionName, username, JSON.stringify([username])]
      );

      await client.query("COMMIT");
      res.json({ ok: true, bu_count: rowCount, mode });

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("POST /ap/period/override/all error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});


// POST /api/ap/period/override/bu — Admin/Owner, toggle M-1 mode per BU
router.post("/override/bu", async (req, res) => {
  const role     = req.user.appRole;
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (!["Owner", "Admin"].includes(role)) {
    return res.status(403).json({ error: "Admin/Owner only" });
  }

  const { bu, mode } = req.body;
  if (!bu || !mode) {
    return res.status(400).json({ error: "bu and mode required" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE company_list SET ap_period_mode = $1, ap_bu_period_status = $2 WHERE bu = $3`,
        [mode, mode === 'prev' ? 'Override' : 'Current', bu]
      );

      const { rows } = await client.query(
        `SELECT COUNT(*) as cnt FROM company_list WHERE ap_period_mode = 'prev'`
      );
      const hasAnyPrev = Number(rows[0]?.cnt || 0) > 0;

      if (mode === "prev") {
        await setSetting("ap_period_prev_status",    "override", username, client);
        await setSetting("ap_period_current_status", "reopen",   username, client);
      } else if (!hasAnyPrev) {
        await setSetting("ap_period_prev_status",    "closed", username, client);
        await setSetting("ap_period_current_status", "open",   username, client);
      }

      await client.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, 'AP', 'OVERRIDE_BU', $2, NOW())`,
        [logUsername, JSON.stringify({ bu, mode })]
      );

      // ── ดึงเดือนปัจจุบัน (M-1 ใน DB) มาคำนวณชื่อเดือน Current และ Previous ให้ระบุในข้อความชัดเจน ──
      const { rows: monthRows } = await client.query(
        `SELECT value FROM system_settings WHERE key = 'ap_period_month'`
      );
      const m1Str = monthRows[0]?.value;
      const curDate = new Date(m1Str + "-01");
      curDate.setMonth(curDate.getMonth() + 1);
      const curMonthLabel = fmtMonth(`${curDate.getFullYear()}-${String(curDate.getMonth()+1).padStart(2,"0")}`);
      const prevMonthLabel = fmtMonth(m1Str);

      // ── แจ้งเตือนเฉพาะ User ที่มี Permission Manual (เกี่ยวข้องกับ AP) ──
      // ── เก็บแค่ 1 แถวเสมอต่อ category — ถ้ามีอยู่แล้วให้ทับข้อความเดิม (Upsert) ──
      // ── ผู้ส่งเอง (username) ไม่ต้องได้รับ Notification ตัวเอง ──
      const buNotifTitle = mode === "prev" ? `เปิด Period ${prevMonthLabel} — BU ${bu}` : `ปิด Period ${prevMonthLabel} — BU ${bu}`;
      const buNotifMsg = mode === "prev"
        ? `สั่งเปิด Period ${prevMonthLabel} ให้ BU: ${bu} (ปัจจุบันเปิดใช้งานปกติคือ ${curMonthLabel}) — ผลกระทบ: ใช้เลขวิ่ง GRT/GRN ของ ${prevMonthLabel} ได้ และ Received Date ย้อนกลับไปเป็น ${prevMonthLabel} ได้ — ดำเนินการโดย ${username}`
        : `สั่งปิด Period ${prevMonthLabel} ให้ BU: ${bu} — ผลกระทบ: กลับมาใช้เลขวิ่ง GRT/GRN และ Received Date ของ ${curMonthLabel} ตามปกติ — ดำเนินการโดย ${username}`;
      await client.query(
        `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
         VALUES ($1, $2, 'AP_PERIOD', 'OVERRIDE_BU', 'Manual', $3, $4)
         ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           action_type = EXCLUDED.action_type,
           created_by = EXCLUDED.created_by,
           created_at = NOW(),
           read_by = EXCLUDED.read_by`,
        [buNotifTitle, buNotifMsg, username, JSON.stringify([username])]
      );

      await client.query("COMMIT");
      res.json({ ok: true, bu, mode, hasAnyPrev });

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("POST /ap/period/override/bu error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});


// POST /api/ap/period/self-override — User (มี Permission Manual) เปิด Override เองได้ทันที ไม่ต้องรอ Approve
// ใช้ได้เฉพาะช่วง Deadline ถึง Deadline+7 วันเท่านั้น (เช็คซ้ำที่ Backend กันคนเลี่ยง Frontend)
router.post("/self-override", async (req, res) => {
  const permissions = req.user.permissions || {};
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);
  const { bu } = req.body;

  if (permissions.Manual !== true) {
    return res.status(403).json({ error: "ต้องมี Permission Manual เท่านั้น" });
  }
  if (!bu) {
    return res.status(400).json({ error: "bu required" });
  }

  try {
    // ── เช็คหน้าต่างเวลา: ต้องอยู่ระหว่าง Deadline ถึง Deadline+7 วัน ──
    // ── อิง ap_prev_month ต่อ BU (ไม่ใช่ system_settings.ap_period_month แบบ Global) ──
    // ── เพราะถ้ามีการปิด Period รอบใหม่ (เดือนถัดไป) ค่า Global จะขยับตามทันที ──
    // ── ทำให้ BU ที่เพิ่งปิดไปหมาดๆ ถูกปฏิเสธผิดพลาด ทั้งที่ยังอยู่ในช่วง 7 วันจริงๆ ──
    const { rows: buRows } = await pool.query(
      `SELECT ap_prev_month FROM company_list WHERE bu = $1`,
      [bu]
    );
    const m1Str = buRows[0]?.ap_prev_month;
    if (!m1Str) return res.status(500).json({ error: "ap_prev_month ของ BU นี้ไม่ถูกตั้งค่าไว้" });

    const [y, m] = m1Str.split('-').map(Number);
    let d = new Date(y, m, 1), cnt = 0, deadline = null;
    while (cnt < 2) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) { cnt++; if (cnt === 2) deadline = new Date(d); }
      if (cnt < 2) d.setDate(d.getDate() + 1);
    }
    const now = new Date();
    const daysSinceDeadline = Math.floor((now - deadline) / (1000 * 60 * 60 * 24));

    if (daysSinceDeadline < 0 || daysSinceDeadline > 7) {
      return res.status(403).json({ error: "อยู่นอกช่วงเวลาที่อนุญาตให้ Override เองได้แล้ว กรุณาติดต่อ Admin" });
    }

    await pool.query(`UPDATE company_list SET ap_period_mode = 'prev', ap_bu_period_status = 'Override' WHERE bu = $1`, [bu]);

    await pool.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, 'AP', 'SELF_OVERRIDE_BU', $2, NOW())`,
      [logUsername, JSON.stringify({ bu })]
    );

    // ── Notification แยกต่อ BU ไม่ทับกันข้าม BU ──
    await pool.query(
      `INSERT INTO notifications (title, message, category, action_type, target_permission, created_by, read_by)
       VALUES ($1, $2, $3, 'SELF_OVERRIDE', 'Manual', $4, '[]'::jsonb)
       ON CONFLICT (category) WHERE category ~ '^(AP|VAT|IE)_PERIOD' DO UPDATE SET
         title = EXCLUDED.title, message = EXCLUDED.message, created_by = EXCLUDED.created_by,
         created_at = NOW(), read_by = EXCLUDED.read_by`,
      [
        `${logUsername} เปิด Override BU: ${bu}`,
        `${logUsername} กำลังใช้เลขวิ่งเดือนก่อนสำหรับ BU: ${bu} กด Reopen เมื่อทำเสร็จแล้ว`,
        `AP_PERIOD_OVERRIDE_${bu}`,
        username
      ]
    );

    res.json({ ok: true, bu });
  } catch (err) {
    console.error("POST /ap/period/self-override error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ap/period/self-override/:bu/reopen — Admin/Owner (Permission Manual) กด Reopen จากกระดิ่ง
router.post("/self-override/:bu/reopen", async (req, res) => {
  const role = req.user.appRole;
  const permissions = req.user.permissions || {};
  const { bu } = req.params;

  if (!["Owner", "Admin"].includes(role)) {
    return res.status(403).json({ error: "Admin/Owner only" });
  }
  if (permissions.Manual !== true) {
    return res.status(403).json({ error: "ต้องมี Permission Manual เท่านั้น" });
  }

  try {
    await pool.query(`UPDATE company_list SET ap_period_mode = 'current', ap_bu_period_status = 'Current' WHERE bu = $1`, [bu]);

    // ── ลบ Notification ทิ้งทันที (ไม่ใช่ Mark read) ──
    await pool.query(`DELETE FROM notifications WHERE category = $1`, [`AP_PERIOD_OVERRIDE_${bu}`]);

    res.json({ ok: true, bu });
  } catch (err) {
    console.error("POST /ap/period/self-override/:bu/reopen error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// GET /api/ap/period/notifications — ดึงรายการแจ้งเตือน กรองตาม Permission ของ User ที่ Login
router.get("/notifications", async (req, res) => {
  const userPermissions = req.user.permissions || {};
  // MARKER_APPERIOD_NOTIF_USERNAME_FIX_V1 -- ต้องแปลง Email เป็น Username จริงก่อน
  // ให้ตรงกับที่เก็บใน recipient_username ตอน Insert (ไม่ใช่ Email) ไม่งั้นไม่ Match กันเลย
  const username = await getUsernameByEmail(req.user.email);
  const userRole = req.user.appRole;

  try {
    // ── ดึงเฉพาะ Notification ที่ target_permission ตรงกับสิทธิ์ของ User หรือไม่ระบุ target (ทุกคนเห็น) ──
    // ── กรอง Notification ที่เก่าเกิน 3 วันออก ไม่ต้องแสดงอีกจนกว่าจะมี Action ใหม่มา Upsert ทับ ──
    // ── ต้อง Cast parameter เป็น text[] อย่างชัดเจน เพราะ pg library ไม่แปลง JS Array ให้อัตโนมัติเสมอไป ──
    const permList = Object.keys(userPermissions).filter(k => userPermissions[k] === true);
    // MARKER_APPERIOD_NOTIF_RECIPIENT_FILTER_FIX_V1
    // ── แก้ Bug: เดิม Fallback "ไม่ระบุ target_permission/target_role" ครอบคลุม
    // ── Notification ที่ใช้ recipient_username (Support & Feedback) ไปด้วยโดยไม่ตั้งใจ
    // ── ทำให้ทุกคนเห็น Notification ของทุกคนหมด -- เพิ่มเงื่อนไข recipient_username แยกให้ถูก ──
    // MARKER_APPERIOD_NOTIF_SEVERITY_V1 -- JOIN support_threads เอา Severity + Log Number มาโชว์ Badge ที่ Bell/Home
    const { rows } = await pool.query(
      `SELECT notifications.*, t.severity AS thread_severity, t.log_number AS thread_log_number
       FROM notifications
       LEFT JOIN support_threads t ON t.id::text = notifications.link_to AND notifications.category = 'support-feedback'
        WHERE (
          (target_permission IS NOT NULL AND target_permission = ANY($1::text[]))
          OR (target_role IS NOT NULL AND target_role = $2)
          OR (recipient_username IS NOT NULL AND recipient_username = $3)
          OR (target_permission IS NULL AND target_role IS NULL AND recipient_username IS NULL)
        )
         -- ── AP_PERIOD/AP_PERIOD_REQUEST: ถ้า User นี้อ่านแล้ว (ไม่ว่าเพราะเป็นคนสร้างเอง
         -- หรือกด Mark Read เอง) ไม่ต้องส่งกลับมาอีกเลย ไม่ใช่แค่ทำสีจาง ──
         AND NOT (
           category IN ('AP_PERIOD', 'AP_PERIOD_REQUEST')
           -- MARKER_APPERIOD_NOTIF_READBY_EMAIL_V2 -- read_by เก็บเป็นอีเมล ต้องเช็คทั้ง username และอีเมล
           AND (read_by @> to_jsonb($3::text) OR read_by @> to_jsonb($4::text))
         )
         -- MARKER_PERIOD_NO_SKIP_GUARD_V1 -- คำขอปิด Period ที่ถูกจัดการแล้ว (handled_at) ต้องไม่โผล่ใน Bell
         AND NOT (category = 'AP_PERIOD_REQUEST' AND handled_at IS NOT NULL)
         -- MARKER_APPERIOD_NOTIF_NEW_THREAD_NO_EXPIRY_V1
         -- ── Fix: กระทู้ Support & Feedback ที่ยัง status = 'new' (ยังไม่ถูก Accept)
         -- ต้องขึ้นค้างใน Bell ตลอดไป ไม่จำกัดอายุ 3 วัน -- เงื่อนไข 3 วันเดิมตั้งใจ
         -- ใช้กับ AP_PERIOD เท่านั้น แต่ดันครอบคลุม support-feedback ไปด้วยโดยไม่ตั้งใจ ──
         -- MARKER_APPERIOD_NOTIF_AMBIGUOUS_COLUMN_FIX_V1
         -- ── Fix: created_at ชนกับ support_threads.created_at (JOIN t) ทำให้ Postgres
         -- Error "column reference created_at is ambiguous" -- Endpoint 500 มาตั้งแต่
         -- ตอนเพิ่ม LEFT JOIN (MARKER_APPERIOD_NOTIF_SEVERITY_V1) -- ต้องระบุ notifications. นำหน้า
         AND (
           notifications.created_at > NOW() - INTERVAL '3 days'
           OR (notifications.category = 'support-feedback' AND t.status = 'new')
         )
         -- MARKER_APPERIOD_NOTIF_30MIN_AFTER_LOGIN_V1
         -- ── AP_PERIOD (แจ้งเพื่อทราบว่าปิด/เปิด Period แล้ว) อยู่ใน Bell ได้แค่ 30 นาที
         -- ── หลัง User นี้ Login (หรือหลังสร้าง Notification ถ้าสร้างหลัง Login) ──
         AND (
           notifications.category <> 'AP_PERIOD'
           OR NOW() < GREATEST(
                notifications.created_at,
                COALESCE(
                  (SELECT MAX(a.created_at) FROM activity_log a
                    WHERE a.user_email = $4::text AND a.action = 'LOGIN' AND a.module = 'AUTH'),
                  notifications.created_at
                )
              ) + INTERVAL '30 minutes'
         )
       ORDER BY notifications.created_at DESC
       LIMIT 50`,
      [permList, userRole, username, req.user.email]
    );

    const result = rows.map(n => ({
      ...n,
      is_read: Array.isArray(n.read_by) && (n.read_by.includes(username) || n.read_by.includes(req.user.email))
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /ap/period/notifications error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ap/period/notifications/:id/read — Mark as read สำหรับ User ปัจจุบัน
router.post("/notifications/:id/read", async (req, res) => {
  const username = req.user.email;
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE notifications 
       SET read_by = read_by || to_jsonb($1::text)
       WHERE id = $2 AND NOT (read_by @> to_jsonb($1::text))`,
      [username, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /ap/period/notifications/:id/read error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ── Auto-Close ถ้า Request-Close ค้างเกิน 1 ชม. ไม่มีคน Approve (Admin/Owner Non-Response) ──
export async function checkAutoCloseRequest() {
  const { rows } = await pool.query(
    `SELECT id FROM notifications 
     WHERE category = 'AP_PERIOD_REQUEST' AND handled_at IS NULL 
       AND created_at < NOW() - INTERVAL '1 hour'
     LIMIT 1`
  );
  if (!rows[0]) return;

  try {
    const { rows: settingRows } = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'ap_period_month'`
    );
    const prevPeriodMonthStr = settingRows[0]?.value;
    if (!prevPeriodMonthStr) return;

    const [py, pm] = prevPeriodMonthStr.split('-').map(Number);
    const closingDate = new Date(py, pm, 1);
    const closingMonthStr = `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, "0")}`;

    // MARKER_PERIOD_NO_SKIP_GUARD_V1 -- Auto-close ก็ห้ามปิดข้าม: ปิดไม่ได้ก็เคลียร์คำขอที่ค้างออกจาก Bell ไปเลย
    if (closingMonthStr > maxClosableMonthStr()) {
      await pool.query(`DELETE FROM notifications WHERE category = 'AP_PERIOD_REQUEST'`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setSetting("ap_period_status", "closed", "system (auto)", client);
      await setSetting("ap_period_month", closingMonthStr, "system (auto)", client);
      await setSetting("ap_period_closed_by", "system (auto)", "system (auto)", client);
      await setSetting("ap_period_closed_at", new Date().toISOString(), "system (auto)", client);
      await setSetting("ap_period_prev_status", "closed", "system (auto)", client);
      await setSetting("ap_period_current_status", "open", "system (auto)", client);

      // MARKER_APPERIOD_PULL_OV_INTO_CURRENT_V1
      const { rowCount } = await client.query(
        `UPDATE company_list SET 
          ap_grt_prev = ap_grt, ap_grn_prev = ap_grn, ap_prev_month = $1,
          ap_grt = ap_grt_ov, ap_grn = ap_grn_ov, ap_grt_ov = 0, ap_grn_ov = 0,
          ap_period_mode = 'current',
          ap_bu_period_status = 'Current'`,
        [closingMonthStr]
      );

      await client.query(
        `UPDATE notifications SET handled_at = NOW(), handled_by = 'system (auto)' WHERE id = $1`,
        [rows[0].id]
      );

      await client.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ('system (auto)', 'AP', 'CLOSE_PERIOD', $1, NOW())`,
        [JSON.stringify({ reason: 'auto_close_no_response_1hr', current_month: closingMonthStr, bu_reset_count: rowCount })]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("checkAutoCloseRequest error:", err.message);
  }
}

// POST /api/ap/period/reopen -- Owner only, ยกเลิกการปิด Period ล่าสุด
// ใช้ได้ภายใน 7 วันหลัง Close เท่านั้น (Pattern เดียวกับ Self-Override)
// เก็บเลขที่วิ่งไปแล้วช่วงเปิดผิดพลาดไว้ที่ ap_grt_ov/ap_grn_ov ไม่ทิ้ง -- พอปิดจริง
// รอบหน้าจะดึงกลับมาต่อเอง (Pattern เดียวกับ /close ด้านบน: ap_grt = ap_grt_ov)
// MARKER_APPERIOD_REOPEN_V1
router.post("/reopen", async (req, res) => {
  const role = req.user.appRole;
  const username = req.user.email;
  const logUsername = await getUsernameByEmail(req.user.email);

  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: settingRows } = await client.query(
        `SELECT key, value FROM system_settings
         WHERE key IN (\'ap_period_month\', \'ap_period_closed_at\')
         FOR UPDATE`
      );
      const s = {};
      settingRows.forEach(r => s[r.key] = r.value);

      if (!s.ap_period_closed_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "ไม่พบประวัติการปิด Period ล่าสุด" });
      }

      const closedAt = new Date(s.ap_period_closed_at);
      const daysSinceClosed = Math.floor((Date.now() - closedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceClosed > 7) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "เกิน 7 วันหลัง Close แล้ว ไม่สามารถ Reopen ได้อีก" });
      }

      const [y, m] = s.ap_period_month.split("-").map(Number);
      const d = new Date(y, m - 2, 1); // ถอยกลับ 1 เดือนจาก M-1 ปัจจุบัน
      const revertedMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

      await setSetting("ap_period_month", revertedMonthStr, username, client);
      await setSetting("ap_period_status", "closed", username, client);
      await setSetting("ap_period_current_status", "open", username, client);
      await setSetting("ap_period_prev_status", "closed", username, client);
      await setSetting("ap_period_closed_by", null, username, client);
      await setSetting("ap_period_closed_at", null, username, client);

      // MARKER_APPERIOD_REOPEN_FIX_PREVMONTH_V1
      // ── Bug เดิม: ไม่เคย Reset ap_prev_month กลับตอน Reopen ค้างเป็นเดือนที่เพิ่ง Close ตลอด ──
      const { rowCount } = await client.query(
        `UPDATE company_list SET
          ap_grt_ov = ap_grt,
          ap_grn_ov = ap_grn,
          ap_grt = ap_grt_prev,
          ap_grn = ap_grn_prev,
          ap_prev_month = $1,
          ap_period_mode = \'current\',
          ap_bu_period_status = \'Current\'`,
        [revertedMonthStr]
      );

      await client.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, \'AP\', \'REOPEN_PERIOD\', $2, NOW())`,
        [logUsername, JSON.stringify({ reverted_month: revertedMonthStr, bu_count: rowCount })]
      );

      // MARKER_APPERIOD_REOPEN_CLEAR_NOTIF_V1
      // ── Bug เดิม: Reopen ไม่เคยลบ Notification "ปิด Period" ที่ /close สร้างไว้ ──
      // ── ทำให้ Bell ยังค้างขึ้นแจ้งว่าปิด Period อยู่ ทั้งที่ Reopen ไปแล้ว ──
      await client.query(
        `DELETE FROM notifications WHERE category = 'AP_PERIOD'`
      );

      await client.query("COMMIT");
      wsBroadcast('period_status_updated', { type: 'AP' }); // MARKER_PERIOD_REALTIME_BROADCAST_V1
      res.json({ ok: true, reverted_month: revertedMonthStr, bu_count: rowCount });

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("POST /ap/period/reopen error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

export default router;