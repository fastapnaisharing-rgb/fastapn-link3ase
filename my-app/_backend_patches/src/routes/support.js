import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
// MARKER_SUPPORT_RECYCLE_BIN_V1
import fs from "fs";
// MARKER_SUPPORT_EXPORT_WORD_V1
// MARKER_SUPPORT_EXPORT_WORD_STYLE_V1
import { Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, WidthType, PageOrientation, AlignmentType, BorderStyle, TableLayoutType, VerticalAlign } from "docx";

const router = Router();

// ── POST /api/support/threads — ตั้งกระทู้ใหม่ (Endpoint 1.5) ──
// Body: { title, body, menuSource }
// ── รูปแนบ อัปโหลดแยกผ่าน POST /api/file-storage/upload-image (refId = thread.id) ──
router.post("/threads", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);

  try {
    const { title, body, menuSource } = req.body;

    if (!title || !body || !menuSource) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี title, body, menuSource)" });
    }

    // MARKER_SUPPORT_SEVERITY_LEVEL_V1
    // ── ระดับความสำคัญ: incident > important > issue > request (รุนแรงมาก -> น้อย) ──
    const ALLOWED_SEVERITY = ['incident', 'important', 'issue', 'request'];
    // MARKER_SEVERITY_DEFAULT_REQUEST_V1
    const severity = ALLOWED_SEVERITY.includes(req.body.severity) ? req.body.severity : 'request';

    // MARKER_SUPPORT_LOG_NUMBER_V1
    // ── Log Number: {PREFIX}-{เลข 4 หลัก} แยกชุดนับตาม Severity ──
    const LOG_NUMBER_PREFIX = { incident: 'INC', important: 'IMT', issue: 'ISS', request: 'REQ' };
    const LOG_NUMBER_SEQUENCE = { incident: 'seq_log_incident', important: 'seq_log_important', issue: 'seq_log_issue', request: 'seq_log_request' };
    const { rows: seqRows } = await pool.query(`SELECT nextval('${LOG_NUMBER_SEQUENCE[severity]}') AS n`);
    const logNumber = `${LOG_NUMBER_PREFIX[severity]}-${String(seqRows[0].n).padStart(4, '0')}`;

    // ── refLogNumber: Optional — กรณีสร้างจาก Disagree อ้างอิงกระทู้เดิม ──
    const refLogNumber = (req.body.refLogNumber || null);
    // MARKER_SUPPORT_DISAGREE_COMMIT_ON_SUBMIT_V1
    // ── refThreadId: Optional — id กระทู้เดิมที่จะ Commit เป็น disagreed ตอน Submit สำเร็จ ──
    const refThreadId = (req.body.refThreadId || null);

    // MARKER_SUPPORT_UNREAD_TRACKING_V1
    // MARKER_SUPPORT_FIX_LAST_ACTIVITY_AT_V1
    // ── last_activity_at เริ่มต้นเป็น NULL — ยังไม่นับว่า "อัปเดต" จนกว่าจะมี Comment/Finish จริง ──
    const { rows } = await pool.query(
      `INSERT INTO support_threads (title, body, status, created_by, menu_source, severity, log_number, ref_log_number)
       VALUES ($1, $2, 'new', $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, body, username, menuSource, severity, logNumber, refLogNumber]
    );

    // MARKER_SUPPORT_NOTIFICATIONS_V1
    // ── แจ้ง Owner ทุกคน (target_role='Owner' รองรับกรณีมี Owner หลายคนในอนาคต) ──
    try {
      const preview = body.length > 100 ? body.slice(0, 100) + "…" : body;
      await pool.query(
        // MARKER_SUPPORT_NOTIF_MENU_SOURCE_V1
        `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, created_by, status, menu_source)
         VALUES ($1, $2, 'support-feedback', 'new_thread', 'Owner', $3, $4, 'unread', $5)`,
        [title, preview, rows[0].id, username, menuSource]
      );
    } catch (notifErr) {
      console.error("แจ้งเตือนตั้งกระทู้ใหม่ไม่สำเร็จ (ไม่กระทบกระทู้ที่สร้างแล้ว):", notifErr.message);
    }

    // MARKER_SUPPORT_AGREEMENT_PERUSER_V1 -- Commit Disagree เป็นคำตอบของ Username นี้เท่านั้น (Per-User)
    if (refThreadId) {
      try {
        await pool.query(
          `INSERT INTO support_thread_agreements (thread_id, username, response) VALUES ($1, $2, 'disagreed')
           ON CONFLICT (thread_id, username) DO NOTHING`,
          [refThreadId, username]
        );
        await pool.query(
          `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1 AND recipient_username = $2`,
          [refThreadId, username]
        );
      } catch (refErr) {
        console.error("Commit disagreed ให้กระทู้เดิมไม่สำเร็จ (ไม่กระทบกระทู้ใหม่ที่สร้างแล้ว):", refErr.message);
      }
    }

    res.json({ ok: true, thread: rows[0] });
  } catch (err) {
    console.error("POST /support/threads error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/support/threads — List กระทู้ (Endpoint 1.8) ──
// ── Owner เห็นทุกกระทู้ / User อื่น (รวม Admin) เห็นกระทู้ตัวเอง + Resolved ของทุกคน ──
router.get("/threads", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";

  try {
    let query;
    let params;

    // ── ไม่รวมกระทู้ที่อยู่ใน Recycle Bin (deleted_at IS NOT NULL) ──
    // ── เพิ่ม last_message/last_message_by (Preview ข้อความล่าสุด) + เรียงตาม last_activity_at ──
    const lastMessageSelect = `,
      (SELECT c.message FROM support_comments c WHERE c.thread_id = support_threads.id ORDER BY c.created_at DESC LIMIT 1) AS last_message,
      (SELECT c.username FROM support_comments c WHERE c.thread_id = support_threads.id ORDER BY c.created_at DESC LIMIT 1) AS last_message_by`;

    // MARKER_SUPPORT_SEVERITY_LEVEL_V1
    // ── เรียง Severity ก่อนเสมอ (Incident=1 รุนแรงสุด ... Request=4 เบาสุด) แล้วค่อยตามเวลา ──
    const severityOrder = `CASE severity WHEN 'incident' THEN 1 WHEN 'important' THEN 2 WHEN 'issue' THEN 3 WHEN 'request' THEN 4 ELSE 5 END`;

    // MARKER_SUPPORT_SHARE_TESTING_V1 -- คนที่ถูก Share เห็นกระทู้นี้ในหน้า List ด้วย
    if (isOwnerRole) {
      query = `SELECT support_threads.*${lastMessageSelect} FROM support_threads WHERE deleted_at IS NULL ORDER BY ${severityOrder}, COALESCE(last_activity_at, created_at) DESC`;
      params = [];
    } else {
      query = `SELECT support_threads.*${lastMessageSelect} FROM support_threads
                WHERE deleted_at IS NULL AND (
                  created_by = $1 OR status = 'resolved'
                  OR EXISTS (SELECT 1 FROM support_thread_shares s WHERE s.thread_id = support_threads.id AND s.shared_with_username = $1)
                )
                ORDER BY ${severityOrder}, COALESCE(last_activity_at, created_at) DESC`;
      params = [username];
    }

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, threads: rows });
  } catch (err) {
    console.error("GET /support/threads error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_SUPPORT_EXPORT_WORD_ROUTE_ORDER_FIX_V1
// ── GET /api/support/threads/export-word — Export รายงานเป็น Word (Phase 5) ──
// ── Query: from, to (YYYY-MM-DD, บังคับ), filterUser (Owner เท่านั้น, optional) ──
// ── ไม่เก็บไฟล์ลง Disk — Generate สดแล้วส่งกลับทันที ──
router.get("/threads/export-word", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";
  const { from, to, filterUser } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "ต้องระบุช่วงวันที่ (from, to)" });
  }

  try {
    let query;
    let params;

    if (isOwnerRole) {
      if (filterUser) {
        query = `SELECT * FROM support_threads
                  WHERE deleted_at IS NULL AND created_by = $1
                    AND created_at >= $2 AND created_at < ($3::date + INTERVAL '1 day')
                  ORDER BY created_at ASC`;
        params = [filterUser, from, to];
      } else {
        query = `SELECT * FROM support_threads
                  WHERE deleted_at IS NULL
                    AND created_at >= $1 AND created_at < ($2::date + INTERVAL '1 day')
                  ORDER BY created_at ASC`;
        params = [from, to];
      }
    } else {
      query = `SELECT * FROM support_threads
                WHERE deleted_at IS NULL AND (created_by = $1 OR status = 'resolved')
                  AND created_at >= $2 AND created_at < ($3::date + INTERVAL '1 day')
                ORDER BY created_at ASC`;
      params = [username, from, to];
    }

    const { rows: threads } = await pool.query(query, params);

    // ── จัดสวย: Header สีธีมแอป (#1a3a5c) + ขอบตาราง + สลับสีแถว + กึ่งกลาง Header ──
    const HEADER_LABELS = ["หัวข้อ", "เมนู", "ผู้ตั้ง", "Created", "Finished", "Status"];
    // MARKER_SUPPORT_EXPORT_WORD_WIDEN_COLUMNS_V1
    const COLUMN_WIDTHS = [5400, 2000, 2000, 1800, 1800, 1400]; // รวม 14400 DXA (เต็มพื้นที่ใช้งานจริงของหน้าแนวนอน 0.5in margin)

    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" };
    const tableBorders = {
      top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
      insideHorizontal: cellBorder, insideVertical: cellBorder,
    };

    const headerRow = new TableRow({
      tableHeader: true,
      children: HEADER_LABELS.map((text, i) => new TableCell({
        width: { size: COLUMN_WIDTHS[i], type: WidthType.DXA },
        shading: { fill: "1A3A5C" },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, bottom: 100, left: 100, right: 100 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
        })],
      })),
    });

    const dataRows = threads.map((t, idx) => new TableRow({
      children: [t.title || "-", t.menu_source || "-", t.created_by || "-", formatDateTh(t.created_at), formatDateTh(t.resolved_at), statusLabelTh(t.status)]
        .map((text, i) => new TableCell({
          width: { size: COLUMN_WIDTHS[i], type: WidthType.DXA },
          shading: idx % 2 === 1 ? { fill: "F5F7FA" } : undefined,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: i >= 3 ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [new TextRun({ text: String(text), size: 20 })],
          })],
        })),
    }));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: [
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: "Feedback Report", bold: true, size: 36, color: "1A3A5C" })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: `ช่วงวันที่: ${formatDateTh(from)} - ${formatDateTh(to)}${filterUser ? ` · ผู้ตั้ง: ${filterUser}` : ""}`, size: 20, color: "666666" })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: `จำนวน: ${threads.length} กระทู้`, size: 20, color: "666666" })],
          }),
          new Table({
            width: { size: COLUMN_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            layout: TableLayoutType.FIXED,
            borders: tableBorders,
            rows: [headerRow, ...dataRows],
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `Feedback Report by ${username} ${ddmmyy(from)}-${ddmmyy(to)}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) {
    console.error("GET /support/threads/export-word error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ── GET /api/support/threads/:id — Thread Detail (Endpoint 1.9) ──
// ── คืน Thread + Comment ทั้งหมด + รายการรูป (ID ไว้ยิงไป /api/file-storage/:id/view-image) ──
// MARKER_SUPPORT_EDIT_THREAD_V1
// ── PATCH /threads/:id -- แก้ไขกระทู้ที่ตัวเองแจ้ง เฉพาะตอน Status='new' เท่านั้น ──
// ── (Owner ยังไม่ได้ Accept -- พอ Accept แล้ว/ status เปลี่ยน จะแก้ไม่ได้อีกเลย) ──
router.patch("/threads/:id", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;
  const { title, body, menuSource, severity } = req.body;

  if (!title || !body || !menuSource) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี title, body, menuSource)" });
  }

  try {
    // MARKER_SUPPORT_EDIT_SEVERITY_LOGNUMBER_SYNC_V1 -- ดึง severity เดิมมาเทียบด้วย เผื่อต้องออก log_number ใหม่
    const { rows: threadRows } = await pool.query(`SELECT created_by, status, severity AS old_severity FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });
    if (thread.created_by !== username) {
      return res.status(403).json({ error: "แก้ไขได้เฉพาะกระทู้ที่ตัวเองแจ้งเท่านั้น" });
    }
    if (thread.status !== "new") {
      return res.status(403).json({ error: "แก้ไขได้เฉพาะกระทู้ที่ยังไม่ถูกรับเรื่อง (สถานะ New) เท่านั้น" });
    }

    const ALLOWED_SEVERITY = ['incident', 'important', 'issue', 'request'];
    const finalSeverity = ALLOWED_SEVERITY.includes(severity) ? severity : 'request';

    // ── Severity เปลี่ยนจริง -> ออก log_number ใหม่จาก Sequence ที่ตรงกับ Severity ใหม่ ──
    let newLogNumberClause = '';
    let newLogNumberParam = null;
    if (finalSeverity !== thread.old_severity) {
      const LOG_NUMBER_PREFIX = { incident: 'INC', important: 'IMT', issue: 'ISS', request: 'REQ' };
      const LOG_NUMBER_SEQUENCE = { incident: 'seq_log_incident', important: 'seq_log_important', issue: 'seq_log_issue', request: 'seq_log_request' };
      const { rows: seqRows } = await pool.query(`SELECT nextval('${LOG_NUMBER_SEQUENCE[finalSeverity]}') AS n`);
      newLogNumberParam = `${LOG_NUMBER_PREFIX[finalSeverity]}-${String(seqRows[0].n).padStart(4, '0')}`;
      newLogNumberClause = ', log_number = $6';
    }

    const updateParams = [title, body, menuSource, finalSeverity, id];
    if (newLogNumberParam) updateParams.push(newLogNumberParam);

    const { rows } = await pool.query(
      `UPDATE support_threads SET title = $1, body = $2, menu_source = $3, severity = $4${newLogNumberClause}
       WHERE id = $5 RETURNING *`,
      updateParams
    );

    // ── Update ข้อความ Notification เดิม (new_thread) ให้ตรงหัวข้อใหม่ด้วย (ถ้ายังไม่ Accept) ──
    try {
      const preview = body.length > 100 ? body.slice(0, 100) + "…" : body;
      await pool.query(
        `UPDATE notifications SET title = $1, message = $2, menu_source = $3
         WHERE category = 'support-feedback' AND link_to = $4 AND action_type = 'new_thread'`,
        [title, preview, menuSource, id]
      );
    } catch (notifErr) {
      console.error("อัปเดต Notification เดิมไม่สำเร็จ (ไม่กระทบการแก้ไขกระทู้):", notifErr.message);
    }

    res.json({ ok: true, thread: rows[0] });
  } catch (err) {
    console.error("PATCH /support/threads/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/threads/:id", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const { id } = req.params;

  try {
    const { rows: threadRows } = await pool.query(`SELECT * FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });

    const isOwnerRole = appRole === "Owner";
    const isThreadOwner = thread.created_by === username;
    const isResolved = thread.status === "resolved";

    // MARKER_SUPPORT_SHARE_TESTING_V1 -- เช็คว่าเป็นคนที่ถูก Share เข้ามา Test กระทู้นี้ไหม
    let isSharedWithMe = false;
    try {
      const { rows: shareRows } = await pool.query(
        `SELECT 1 FROM support_thread_shares WHERE thread_id = $1 AND shared_with_username = $2`,
        [id, username]
      );
      isSharedWithMe = shareRows.length > 0;
    } catch (shareErr) {
      console.error("เช็ค Share ไม่สำเร็จ (ไม่กระทบการเปิดกระทู้):", shareErr.message);
    }

    // ── กระทู้ใน Recycle Bin เห็นได้เฉพาะ Owner (สำหรับกู้คืน) ──
    if (thread.deleted_at && !isOwnerRole) {
      return res.status(404).json({ error: "ไม่พบกระทู้นี้" });
    }

    if (!isOwnerRole && !isThreadOwner && !isResolved && !isSharedWithMe) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ดูกระทู้นี้" });
    }

    // ── Mark Read: อัปเดต read_at ของฝั่งที่เปิดดู (ใช้เช็ค Unread ตอน List) ──
    try {
      if (isOwnerRole) {
        await pool.query(`UPDATE support_threads SET owner_last_read_at = NOW() WHERE id = $1`, [id]);
      } else if (isThreadOwner) {
        await pool.query(`UPDATE support_threads SET creator_last_read_at = NOW() WHERE id = $1`, [id]);
      }
    } catch (readErr) {
      console.error("อัปเดต Read Status ไม่สำเร็จ (ไม่กระทบการเปิดกระทู้):", readErr.message);
    }

    const { rows: comments } = await pool.query(
      `SELECT * FROM support_comments WHERE thread_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // MARKER_SUPPORT_SUB_REF_ID_V1
    const { rows: images } = await pool.query(
      `SELECT id, sub_ref_id, created_at FROM file_storage
       WHERE module = 'support-feedback' AND ref_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // MARKER_SUPPORT_AGREEMENT_PERUSER_V1 -- คำตอบ Agree/Disagree ของ Username นี้เอง (ถ้าเคยตอบแล้ว)
    let myAgreementResponse = null;
    try {
      const { rows: myResp } = await pool.query(
        `SELECT response FROM support_thread_agreements WHERE thread_id = $1 AND username = $2`,
        [id, username]
      );
      myAgreementResponse = myResp[0]?.response || null;
    } catch (respErr) {
      console.error("ดึง myAgreementResponse ไม่สำเร็จ (ไม่กระทบการเปิดกระทู้):", respErr.message);
    }

    // MARKER_SUPPORT_EXPOSE_ISSHARED_V1 -- ส่ง isSharedWithMe กลับไปด้วย ให้ Frontend รู้ว่าคนนี้ถูก Share เข้ามา Test หรือเปล่า
    res.json({ ok: true, thread: { ...thread, myAgreementResponse, isSharedWithMe }, comments, images });
  } catch (err) {
    console.error("GET /support/threads/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/comments — ตอบ Comment (Endpoint 1.6) ──
// ── ตอบได้ทั้งสองฝ่าย: Owner หรือ เจ้าของกระทู้เท่านั้น ──
router.post("/threads/:id/comments", async (req, res) => {
  // MARKER_SUPPORT_ALLOW_EMPTY_COMMENT_V1
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const { id } = req.params;
  // ── รับข้อความว่างได้ (กรณีตอบกลับด้วยรูปอย่างเดียว) — ยังต้องสร้าง Comment Record ──
  // ── เพื่อให้มี ID ไว้ผูกกับรูปที่แนบ (subRefId) ไม่งั้นรูปจะตกไปอยู่ที่โพสต์แรกผิดที่ ──
  const message = (req.body.message || "").trim();

  try {
    // MARKER_SUPPORT_NOTIFY_ON_COMMENT_V1
    // MARKER_SUPPORT_NOTIF_MENU_SOURCE_V1
    const { rows: threadRows } = await pool.query(`SELECT created_by, title, menu_source FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });

    const isOwnerRole = appRole === "Owner";
    const isThreadOwner = thread.created_by === username;
    if (!isOwnerRole && !isThreadOwner) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ Comment ในกระทู้นี้" });
    }

    const { rows } = await pool.query(
      `INSERT INTO support_comments (thread_id, username, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, username, message]
    );
    // MARKER_SUPPORT_ALLOW_EMPTY_COMMENT_V1

    try {
      await pool.query(`UPDATE support_threads SET last_activity_at = NOW() WHERE id = $1`, [id]);
    } catch (activityErr) {
      console.error("อัปเดต last_activity_at ไม่สำเร็จ (ไม่กระทบ Comment ที่ส่งแล้ว):", activityErr.message);
    }

    // MARKER_SUPPORT_HOLD_REMINDER_DEDUP_V1
    // ── แจ้ง "อีกฝ่าย" ว่ามี Comment ใหม่ — ไม่สะสม เช็คก่อนว่ามี Notification ค้างรออ่านของทิศทางเดียวกันไหม ──
    // ── มีอยู่แล้ว -> UPDATE ทับ (message, created_at) / ไม่มี -> INSERT ใหม่ ──
    try {
      const preview = message ? (message.length > 100 ? message.slice(0, 100) + "…" : message) : "แนบรูปภาพ";
      if (isThreadOwner && !isOwnerRole) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM notifications WHERE category='support-feedback' AND action_type='new_reply' AND link_to=$1 AND target_role='Owner' AND status='unread'`,
          [id]
        );
        if (existing.length > 0) {
          await pool.query(`UPDATE notifications SET message=$1, created_at=NOW() WHERE id=$2`, [preview, existing[0].id]);
        } else {
          await pool.query(
            `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, created_by, status, menu_source)
             VALUES ($1, $2, 'support-feedback', 'new_reply', 'Owner', $3, $4, 'unread', $5)`,
            [thread.title, preview, id, username, thread.menu_source]
          );
        }
      } else if (isOwnerRole && thread.created_by !== username) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM notifications WHERE category='support-feedback' AND action_type='owner_reply' AND link_to=$1 AND recipient_username=$2 AND status='unread'`,
          [id, thread.created_by]
        );
        if (existing.length > 0) {
          await pool.query(`UPDATE notifications SET message=$1, created_at=NOW() WHERE id=$2`, [preview, existing[0].id]);
        } else {
          await pool.query(
            `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, created_by, status, menu_source)
             VALUES ($1, $2, 'support-feedback', 'owner_reply', $3, $4, $5, 'unread', $6)`,
            [thread.title, preview, thread.created_by, id, username, thread.menu_source]
          );
        }
      }
    } catch (notifErr) {
      console.error("แจ้งเตือน Comment ใหม่ไม่สำเร็จ (ไม่กระทบ Comment ที่ส่งแล้ว):", notifErr.message);
    }

    res.json({ ok: true, comment: rows[0] });
  } catch (err) {
    console.error("POST /support/threads/:id/comments error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_SUPPORT_DISMISS_ENDPOINT_V1
// ── POST /api/support/threads/:id/dismiss — "ปิด Chat" = ลบ Notification ของฝั่งตัวเอง ──
// ── ถือว่าอ่านจบแล้ว -- ใช้กับทั้ง Owner และผู้แจ้งเหมือนกัน ──
router.post("/threads/:id/dismiss", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const { id } = req.params;

  try {
    if (appRole === "Owner") {
      // ── Owner ปิด Chat -- ลบทั้ง Notification เจาะจงตัวเอง และ Broadcast เดิมของ Owner (new_thread) ──
      await pool.query(
        `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1 AND (recipient_username = $2 OR target_role = 'Owner')`,
        [id, username]
      );
    } else {
      // ── ผู้แจ้งปิด Chat -- ลบเฉพาะ Notification ที่เจาะจงถึงตัวเองเท่านั้น ──
      await pool.query(
        `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1 AND recipient_username = $2`,
        [id, username]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/dismiss error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/view — Owner เปิดดูกระทู้ (Endpoint 1.10) ──
// ── เรียกทันทีตอนเปิดหน้า Thread Detail — บันทึก viewed_at ครั้งแรกเท่านั้น (ใช้จับ Timer 30 วิ) ──
router.post("/threads/:id/view", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้น" });
  }

  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE support_threads SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/view error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/start-process — เปลี่ยนเป็น In process (Endpoint 1.11) ──
// ── Trigger: Owner เปิดกระทู้นี้ค้างไว้ครบ 30 วิ (Frontend เรียกเอง) ──
// ── เช็คว่ายัง status='new' อยู่ก่อน Update กันเผื่อกดซ้ำ/เรียกซ้ำ ──
router.post("/threads/:id/start-process", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้น" });
  }

  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;

  try {
    const { rows: threadRows } = await pool.query(`SELECT title, created_by, menu_source FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];

    const { rowCount } = await pool.query(
      `UPDATE support_threads SET status = 'in_process' WHERE id = $1 AND status = 'new'`,
      [id]
    );

    // MARKER_SUPPORT_ACCEPT_NOTIFY_REQUESTER_V1
    // ── Accept สำเร็จจริง (เปลี่ยน Status ได้จริง ไม่ใช่กด Accept ซ้ำ) -- แจ้งผู้แจ้ง ──
    if (rowCount > 0 && thread) {
      try {
        // ── ลบ Notification "New" เดิมทิ้ง -- Bell ฝั่ง Owner หายทันที ──
        await pool.query(
          `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1 AND action_type = 'new_thread'`,
          [id]
        );
      } catch (cleanupErr) {
        console.error("ลบ Notification New เดิมไม่สำเร็จ (ไม่กระทบการ Accept):", cleanupErr.message);
      }
      try {
        // ── แจ้งผู้แจ้ง -- Bell เท่านั้น (ไม่ใช้ target_role จึงไม่ขึ้น Homepage) ──
        // ── มี expires_at 30 นาที -- ถ้าไม่มีการอ่าน/ปิด Chat ภายในเวลานี้ Cron จะลบทิ้งเอง ──
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, created_by, status, menu_source, expires_at)
           VALUES ($1, $2, 'support-feedback', 'accepted', $3, $4, $5, 'unread', $6, NOW() + INTERVAL '30 minutes')`,
          [thread.title, "Owner รับเรื่องแล้ว กำลังดำเนินการ", thread.created_by, id, username, thread.menu_source]
        );
      } catch (notifErr) {
        console.error("แจ้งเตือน Accept ไม่สำเร็จ (ไม่กระทบการ Accept):", notifErr.message);
      }
    }

    res.json({ ok: true, changed: rowCount > 0 });
  } catch (err) {
    console.error("POST /support/threads/:id/start-process error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/finish — Resolve (Endpoint 1.12) ──
// ── Owner กด Finish เท่านั้น (Manual, คนเดียวที่ทำได้) ──
router.post("/threads/:id/finish", async (req, res) => {
  // MARKER_SUPPORT_NOTIFICATION_DISMISS_V1
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ปิดกระทู้ได้" });
  }

  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;

  try {
    // MARKER_SUPPORT_FINISH_REVERT_GATE_V1 -- ถอน Gate ต้องผ่าน Test ออก -- Owner Resolve ตรงได้เสมอ (Testing เป็น Option เสริม)
    const { rows: threadRows } = await pool.query(`SELECT title, menu_source FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];

    // MARKER_SUPPORT_AGREEMENT_SYSTEM_V1 -- Resolve แล้วเริ่มนับ agreement_status='pending' (ใครก็ได้ยกเว้น Owner กด Agree/Disagree ได้ ภายใน 3 วัน)
    await pool.query(
      `UPDATE support_threads SET status = 'resolved', resolved_at = NOW(), last_activity_at = NOW(), agreement_status = 'pending' WHERE id = $1`,
      [id]
    );

    // MARKER_SUPPORT_RESOLVE_CLEANUP_ALL_V1
    // ── ลบ Notification เดิมของกระทู้นี้ "ทุกประเภท" ทิ้ง (new_thread/new_reply/owner_reply) ──
    // ── ไม่ต้องค้าง Homepage ต่อ เดี๋ยวยิง resolved ใหม่แทนด้านล่างอยู่แล้ว ──────────────────
    try {
      await pool.query(
        `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1`,
        [id]
      );
    } catch (cleanupErr) {
      console.error("ลบ Notification เดิมไม่สำเร็จ (ไม่กระทบการ Resolve):", cleanupErr.message);
    }

    // MARKER_SUPPORT_RESOLVE_BROADCAST_PERMISSION_V1
    // ── Broadcast แจ้งเฉพาะ User ที่มี Permission เข้า Menu ตรงกับ menu_source ของกระทู้ ──
    // ── ยกเว้น Owner ที่เพิ่งกด Finish เอง — ไม่ต้องแจ้งตัวเอง ──
    try {
      const MENU_SOURCE_PERM_KEY = {
        'AP Controller': 'Manual',
        'VAT Controller': 'VAT',
        'I-Expense': 'IE',
        'GL Functional': 'GL',
        'I-Pro Interface': 'I-Pro',
        // Master Data / Resource Center / อื่นๆ -> ไม่มี Key เฉพาะ = ไม่กรอง (แจ้งทุกคน)
      };
      const permKey = MENU_SOURCE_PERM_KEY[thread?.menu_source];

      // MARKER_SUPPORT_USERROLES_COLUMN_FIX_V1 -- Column จริงชื่อ "role" ไม่ใช่ "app_role" (ตาราง user_roles ไม่มี app_role)
      const { rows: allUsers } = await pool.query(`SELECT username, role, permissions FROM user_roles`);
      for (const u of allUsers) {
        if (u.username === username) continue;
        if (permKey) {
          const hasAccess = u.role === 'Owner' || (u.permissions && u.permissions[permKey] === true);
          if (!hasAccess) continue;
        }
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'resolved', $3, $4, 'unread', $5)`,
          [thread?.title || "กระทู้", "กระทู้นี้แก้ไขเสร็จแล้ว เปิดอ่านได้", u.username, id, thread?.menu_source || null]
        );
      }
    } catch (broadcastErr) {
      console.error("Broadcast แจ้งเตือน Resolve ไม่สำเร็จ (ไม่กระทบการ Resolve):", broadcastErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/finish error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_SUPPORT_REJECT_V1
// ── POST /api/support/threads/:id/reject — Reject (แจ้งเฉพาะผู้แจ้งกระทู้เท่านั้น) ──
// ── Owner กด Reject เท่านั้น (Manual, เหมือน Finish) ──
router.post("/threads/:id/reject", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ Reject กระทู้ได้" });
  }

  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;
  // MARKER_SUPPORT_REJECT_COMMENT_V1 -- Comment ไม่บังคับที่ Owner พิมพ์มาตอน Reject (จาก Frontend rejectCommentDraft)
  const rejectComment = String((req.body || {}).comment || "").trim();

  try {
    const { rows: threadRows } = await pool.query(`SELECT title, created_by, menu_source FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });

    await pool.query(
      `UPDATE support_threads SET status = 'resolved', resolution_type = 'rejected', resolved_at = NOW(), last_activity_at = NOW() WHERE id = $1`,
      [id]
    );

    // MARKER_SUPPORT_REJECT_COMMENT_V1 -- บันทึกเหตุผล Reject เป็นข้อความแชทจริง (ถ้า Owner พิมพ์มา -- ปล่อยว่างได้ ไม่บังคับ)
    if (rejectComment) {
      try {
        await pool.query(
          `INSERT INTO support_comments (thread_id, username, message) VALUES ($1, $2, $3)`,
          [id, username, rejectComment]
        );
      } catch (commentErr) {
        console.error("บันทึก Reject Comment ไม่สำเร็จ (ไม่กระทบการ Reject):", commentErr.message);
      }
    }

    // ── ลบ Notification เดิมของกระทู้นี้ "ทุกประเภท" ทิ้ง (Pattern เดียวกับ Finish) ──
    try {
      await pool.query(
        `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1`,
        [id]
      );
    } catch (cleanupErr) {
      console.error("ลบ Notification เดิมไม่สำเร็จ (ไม่กระทบการ Reject):", cleanupErr.message);
    }

    // ── แจ้งเฉพาะผู้แจ้งกระทู้เท่านั้น — ต่างจาก Resolve ที่ Broadcast กลุ่ม Permission ──
    if (thread.created_by !== username) {
      try {
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'rejected', $3, $4, 'unread', $5)`,
          [thread.title, "กระทู้นี้ถูกปฏิเสธ", thread.created_by, id, thread.menu_source]
        );
      } catch (notifErr) {
        console.error("แจ้งเตือน Reject ไม่สำเร็จ (ไม่กระทบการ Reject):", notifErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/reject error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_SUPPORT_TESTING_FLOW_V1
// ── POST /api/support/threads/:id/send-to-test — Owner ส่งให้ผู้แจ้งกระทู้ Test (จาก In Process เท่านั้น) ──
router.post("/threads/:id/send-to-test", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ส่งให้ Test ได้" });
  }
  const { id } = req.params;
  try {
    // MARKER_SUPPORT_TESTING_RECALL_V1 -- บันทึกเวลาที่ส่งให้ Test เพื่อคำนวณ Auto Recall เกิน 3 วัน
    const { rows } = await pool.query(
      `UPDATE support_threads SET status = 'testing', resolve_requested = FALSE, sent_to_test_at = NOW(), last_activity_at = NOW()
       WHERE id = $1 AND status = 'in_process'
       RETURNING id, title, created_by, menu_source`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "กระทู้นี้ไม่อยู่ในสถานะกำลังดำเนินการแล้ว" });
    }
    const thread = rows[0];
    try {
      await pool.query(
        `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, status, menu_source)
         VALUES ($1, $2, 'support-feedback', 'send_to_test', $3, $4, 'unread', $5)`,
        [thread.title, "แก้ไขเสร็จแล้ว รบกวนช่วย Test ให้หน่อยว่าใช้งานได้ตามที่แจ้งไหม", thread.created_by, id, thread.menu_source]
      );
    } catch (notifErr) {
      console.error("แจ้งเตือนส่งให้ Test ไม่สำเร็จ (ไม่กระทบการเปลี่ยนสถานะ):", notifErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/send-to-test error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/request-resolve — ผู้แจ้งกระทู้ Test ผ่าน ขอให้ Owner Resolve ──
router.post("/threads/:id/request-resolve", async (req, res) => {
  // MARKER_SUPPORT_REQUEST_RESOLVE_DIRECT_V2 -- ผู้แจ้งกระทู้ Confirm ว่า Test ผ่าน -> Resolve จริงทันที
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;
  try {
    // MARKER_SUPPORT_SHARE_TESTING_V1 -- คนที่ถูก Share ก็ Confirm ได้ ไม่ใช่แค่เจ้าของกระทู้
    const { rows } = await pool.query(
      `UPDATE support_threads SET status = 'resolved', resolved_at = NOW(), resolve_requested = TRUE, last_activity_at = NOW()
       WHERE id = $1 AND status = 'testing' AND (
         created_by = $2
         OR EXISTS (SELECT 1 FROM support_thread_shares s WHERE s.thread_id = $1 AND s.shared_with_username = $2)
       )
       RETURNING id, title, menu_source, created_by`,
      [id, username]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "กระทู้นี้ไม่อยู่ในสถานะรอ Test หรือคุณไม่มีสิทธิ์ Confirm กระทู้นี้" });
    }
    const thread = rows[0];

    // ── ลบ Notification เดิมของกระทู้นี้ "ทุกประเภท" ทิ้ง (เหมือน /finish) ──
    try {
      await pool.query(
        `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1`,
        [id]
      );
    } catch (cleanupErr) {
      console.error("ลบ Notification เดิมไม่สำเร็จ (ไม่กระทบการ Resolve):", cleanupErr.message);
    }

    // ── Broadcast แจ้งทุกคนตาม Permission "ยกเว้น" เจ้าของกระทู้ (ผู้กด Confirm เอง) และ Owner ──
    try {
      const MENU_SOURCE_PERM_KEY = {
        'AP Controller': 'Manual',
        'VAT Controller': 'VAT',
        'I-Expense': 'IE',
        'GL Functional': 'GL',
        'I-Pro Interface': 'I-Pro',
      };
      const permKey = MENU_SOURCE_PERM_KEY[thread?.menu_source];
      const { rows: allUsers } = await pool.query(`SELECT username, role, permissions FROM user_roles`);
      for (const u of allUsers) {
        if (u.username === username) continue;        // ── เจ้าของกระทู้ (ผู้กด Confirm เอง) ──
        if (u.role === 'Owner') continue;              // ── Owner ──
        if (permKey) {
          const hasAccess = u.permissions && u.permissions[permKey] === true;
          if (!hasAccess) continue;
        }
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'resolved', $3, $4, 'unread', $5)`,
          [thread.title, `${username} Confirm ว่า Test ผ่านแล้ว กระทู้นี้ปิดเรียบร้อย`, u.username, id, thread.menu_source]
        );
      }
    } catch (broadcastErr) {
      console.error("Broadcast แจ้งเตือน Resolve ไม่สำเร็จ (ไม่กระทบการ Resolve):", broadcastErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/request-resolve error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/reject-test — ผู้แจ้งกระทู้ Test ไม่ผ่าน ตีกลับให้ Owner แก้ต่อ ──
router.post("/threads/:id/reject-test", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;
  const reason = (req.body.reason || "").trim();
  if (!reason) {
    return res.status(400).json({ error: "ต้องกรอกเหตุผลก่อนตีกลับ" });
  }
  try {
    // MARKER_SUPPORT_SHARE_TESTING_V1 -- คนที่ถูก Share ก็ตีกลับได้ ไม่ใช่แค่เจ้าของกระทู้
    const { rows } = await pool.query(
      `UPDATE support_threads SET status = 'in_process', resolve_requested = FALSE, last_activity_at = NOW()
       WHERE id = $1 AND status = 'testing' AND (
         created_by = $2
         OR EXISTS (SELECT 1 FROM support_thread_shares s WHERE s.thread_id = $1 AND s.shared_with_username = $2)
       )
       RETURNING id, title, menu_source`,
      [id, username]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "กระทู้นี้ไม่อยู่ในสถานะรอ Test หรือคุณไม่มีสิทธิ์ตีกลับกระทู้นี้" });
    }
    const thread = rows[0];
    try {
      await pool.query(
        `INSERT INTO support_comments (thread_id, username, message) VALUES ($1, $2, $3)`,
        [id, username, `❌ Test ไม่ผ่าน: ${reason}`]
      );
    } catch (commentErr) {
      console.error("บันทึกเหตุผลตีกลับไม่สำเร็จ (ไม่กระทบการเปลี่ยนสถานะ):", commentErr.message);
    }
    try {
      await pool.query(
        `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, status, menu_source)
         VALUES ($1, $2, 'support-feedback', 'reject_test', 'Owner', $3, 'unread', $4)`,
        [thread.title, `${username} Test ไม่ผ่าน: ${reason}`, id, thread.menu_source]
      );
    } catch (notifErr) {
      console.error("แจ้งเตือนตีกลับไม่สำเร็จ (ไม่กระทบการเปลี่ยนสถานะ):", notifErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/reject-test error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_SUPPORT_SHARE_TESTING_V1
// ── GET /api/support/threads/:id/share-candidates — List User ที่มี Permission เดียวกัน (ยังไม่เคยถูก Share) ──
router.get("/threads/:id/share-candidates", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";
  const { id } = req.params;
  try {
    const { rows: threadRows } = await pool.query(`SELECT created_by, menu_source FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });
    if (!isOwnerRole && thread.created_by !== username) {
      return res.status(403).json({ error: "เฉพาะเจ้าของกระทู้หรือ Owner เท่านั้นที่ Share ได้" });
    }

    const MENU_SOURCE_PERM_KEY = {
      'AP Controller': 'Manual',
      'VAT Controller': 'VAT',
      'I-Expense': 'IE',
      'GL Functional': 'GL',
      'I-Pro Interface': 'I-Pro',
    };
    const permKey = MENU_SOURCE_PERM_KEY[thread.menu_source];

    const { rows: alreadyShared } = await pool.query(
      `SELECT shared_with_username FROM support_thread_shares WHERE thread_id = $1`,
      [id]
    );
    const sharedSet = new Set(alreadyShared.map(r => r.shared_with_username));

    const { rows: allUsers } = await pool.query(`SELECT username, role, permissions FROM user_roles`);
    const candidates = allUsers.filter(u => {
      if (u.username === thread.created_by) return false;
      if (u.role === 'Owner') return false;
      if (sharedSet.has(u.username)) return false;
      if (permKey && !(u.permissions && u.permissions[permKey] === true)) return false;
      return true;
    }).map(u => ({ username: u.username }));

    res.json({ ok: true, candidates });
  } catch (err) {
    console.error("GET /support/threads/:id/share-candidates error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/share — Share กระทู้ Testing ให้ User อื่น (Multi-select) ──
router.post("/threads/:id/share", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";
  const { id } = req.params;
  const usernames = Array.isArray(req.body.usernames) ? req.body.usernames.filter(Boolean) : [];

  if (usernames.length === 0) {
    return res.status(400).json({ error: "กรุณาเลือกอย่างน้อย 1 คน" });
  }

  try {
    const { rows: threadRows } = await pool.query(`SELECT title, created_by, menu_source, status FROM support_threads WHERE id = $1`, [id]);
    const thread = threadRows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });
    if (!isOwnerRole && thread.created_by !== username) {
      return res.status(403).json({ error: "เฉพาะเจ้าของกระทู้หรือ Owner เท่านั้นที่ Share ได้" });
    }
    if (thread.status !== 'testing') {
      return res.status(400).json({ error: "Share ได้เฉพาะกระทู้ที่อยู่ในสถานะรอ Test เท่านั้น" });
    }

    for (const target of usernames) {
      try {
        await pool.query(
          `INSERT INTO support_thread_shares (thread_id, shared_with_username, shared_by) VALUES ($1, $2, $3)
           ON CONFLICT (thread_id, shared_with_username) DO NOTHING`,
          [id, target, username]
        );
      } catch (shareInsertErr) {
        console.error("Insert support_thread_shares ไม่สำเร็จ:", shareInsertErr.message);
        continue;
      }
      try {
        await pool.query(
          `INSERT INTO support_comments (thread_id, username, message) VALUES ($1, $2, $3)`,
          [id, username, `📤 ต้องการส่งให้ ${target} ดำเนินการ Test ข้อมูล`]
        );
      } catch (commentErr) {
        console.error("บันทึก Auto Reply Share ไม่สำเร็จ:", commentErr.message);
      }
      try {
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, recipient_username, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'send_to_test', $3, $4, 'unread', $5)`,
          [thread.title, `${username} Share กระทู้นี้ให้คุณช่วย Test`, target, id, thread.menu_source]
        );
      } catch (notifErr) {
        console.error("แจ้งเตือน Share ไม่สำเร็จ:", notifErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/share error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/hold — พักงานกระทู้ (Owner เท่านั้น, บังคับกรอกเหตุผล) ──
router.post("/threads/:id/hold", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ Hold กระทู้ได้" });
  }
  const { id } = req.params;
  const reason = (req.body.reason || "").trim();
  if (!reason) {
    return res.status(400).json({ error: "ต้องกรอกเหตุผลก่อน Hold" });
  }
  try {
    await pool.query(
      `UPDATE support_threads SET on_hold = TRUE, hold_reason = $1, held_at = NOW() WHERE id = $2`,
      [reason, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/hold error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/unhold — ปลด Hold (Owner เท่านั้น, Manual เท่านั้น) ──
router.post("/threads/:id/unhold", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ปลด Hold ได้" });
  }
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE support_threads SET on_hold = FALSE, hold_reason = NULL, held_at = NULL WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/unhold error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/support/threads/:id — Soft Delete เข้า Recycle Bin ──
// ── New: Owner หรือ เจ้าของกระทู้ / In process ขึ้นไป: Owner เท่านั้น ──
router.delete("/threads/:id", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";
  const { id } = req.params;

  try {
    const { rows } = await pool.query(`SELECT * FROM support_threads WHERE id = $1`, [id]);
    const thread = rows[0];
    if (!thread) return res.status(404).json({ error: "ไม่พบกระทู้นี้" });

    if (thread.deleted_at) {
      return res.status(400).json({ error: "กระทู้นี้อยู่ใน Recycle Bin แล้ว" });
    }

    const isThreadOwner = thread.created_by === username;

    if (thread.status === "new") {
      if (!isOwnerRole && !isThreadOwner) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์ลบกระทู้นี้" });
      }
    } else {
      if (!isOwnerRole) {
        return res.status(403).json({ error: "กระทู้นี้เริ่มดำเนินการแล้ว เฉพาะ Owner เท่านั้นที่ลบได้" });
      }
    }

    await pool.query(`UPDATE support_threads SET deleted_at = NOW() WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /support/threads/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/support/threads/recycle-bin/list — Recycle Bin (Owner เท่านั้น) ──
router.get("/threads/recycle-bin/list", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้น" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM support_threads WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    );
    res.json({ ok: true, threads: rows });
  } catch (err) {
    console.error("GET /support/threads/recycle-bin/list error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/restore — กู้คืนจาก Recycle Bin (Owner เท่านั้น) ──
router.post("/threads/:id/restore", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่กู้คืนได้" });
  }

  const { id } = req.params;

  try {
    const { rowCount } = await pool.query(
      `UPDATE support_threads SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "ไม่พบกระทู้นี้ใน Recycle Bin" });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/restore error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cron: ลบถาวรกระทู้ใน Recycle Bin ที่เกิน 3 วัน (เรียกจาก app.js ทุก 5 นาที) ──
// ── ลบ Comment + รูปแนบใน file_storage (ไฟล์จริงบน Disk + Record) + ตัวกระทู้เองทั้งหมด ──
export async function checkAndCleanupSupportThreads() {
  const { rows: expired } = await pool.query(
    `SELECT id FROM support_threads
     WHERE deleted_at IS NOT NULL
       AND deleted_at < NOW() - INTERVAL '3 days'`
  );

  for (const row of expired) {
    const { rows: images } = await pool.query(
      `SELECT id, file_path FROM file_storage WHERE module = 'support-feedback' AND ref_id = $1`,
      [row.id]
    );
    for (const img of images) {
      try {
        if (fs.existsSync(img.file_path)) fs.unlinkSync(img.file_path);
      } catch (err) {
        console.error(`ลบรูป ${img.file_path} ไม่สำเร็จ:`, err.message);
      }
    }
    if (images.length > 0) {
      await pool.query(`DELETE FROM file_storage WHERE id = ANY($1::uuid[])`, [images.map((i) => i.id)]);
    }

    await pool.query(`DELETE FROM support_comments WHERE thread_id = $1`, [row.id]);
    await pool.query(`DELETE FROM support_threads WHERE id = $1`, [row.id]);
  }
}

function statusLabelTh(status) {
  if (status === "new") return "ใหม่";
  if (status === "in_process") return "กำลังดำเนินการ";
  if (status === "resolved") return "แก้ไขแล้ว";
  return status || "-";
}

function formatDateTh(d) {
  if (!d) return "-";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

function ddmmyy(dateStr) {
  const dt = new Date(dateStr);
  return `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getFullYear()).slice(2)}`;
}

// ── DELETE /api/support/notifications/:id — "กด Done" แล้ว Notification หายไปเฉพาะของตัวเอง ──
// ── ลบได้เฉพาะ Notification ของตัวเอง (recipient_username ตรง หรือ Owner ลบของ target_role='Owner' ได้) ──
router.delete("/notifications/:id", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isOwnerRole = appRole === "Owner";
  const { id } = req.params;

  try {
    if (isOwnerRole) {
      await pool.query(
        `DELETE FROM notifications WHERE id = $1 AND category = 'support-feedback' AND (recipient_username = $2 OR target_role = 'Owner')`,
        [id, username]
      );
    } else {
      await pool.query(
        `DELETE FROM notifications WHERE id = $1 AND category = 'support-feedback' AND recipient_username = $2`,
        [id, username]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /support/notifications/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/agree — ผู้เห็นกระทู้ (ยกเว้น Owner) กด Agree หลัง Resolve ──
// ── กดแล้วจบเลย ไม่มีผลอื่น แค่ลบ Notification ของตัวเองออกจาก Bell/Home ──
router.post("/threads/:id/agree", async (req, res) => {
  // MARKER_SUPPORT_AGREEMENT_PERUSER_V1 -- ทุกคนกด Agree ของตัวเองได้อิสระ ไม่เกี่ยวกับคนอื่น
  const appRole = req.user.appRole || "";
  if (appRole === "Owner") {
    return res.status(403).json({ error: "Owner ไม่ต้องกด Agree/Disagree" });
  }
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;

  try {
    const { rows: threadRows } = await pool.query(`SELECT id, status FROM support_threads WHERE id = $1`, [id]);
    if (threadRows.length === 0 || threadRows[0].status !== 'resolved') {
      return res.status(400).json({ error: "กระทู้นี้ไม่อยู่ในสถานะ Resolved" });
    }
    const { rows } = await pool.query(
      `INSERT INTO support_thread_agreements (thread_id, username, response) VALUES ($1, $2, 'agreed')
       ON CONFLICT (thread_id, username) DO NOTHING
       RETURNING id`,
      [id, username]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "คุณตอบกระทู้นี้ไปแล้ว" });
    }
    // ── ลบ Notification ของผู้กดเองออกจาก Bell/Home (เฉพาะของตัวเอง ไม่กระทบคนอื่น) ──
    await pool.query(
      `DELETE FROM notifications WHERE category = 'support-feedback' AND link_to = $1 AND recipient_username = $2`,
      [id, username]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /support/threads/:id/agree error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/threads/:id/disagree — ผู้เห็นกระทู้ (ยกเว้น Owner) กด Disagree หลัง Resolve ──
// ── Set disagreed + คืน log_number เดิมให้ Frontend เอาไป Prefill ref_log_number ตอนตั้งกระทู้ใหม่ ──
router.post("/threads/:id/disagree", async (req, res) => {
  const appRole = req.user.appRole || "";
  if (appRole === "Owner") {
    return res.status(403).json({ error: "Owner ไม่ต้องกด Agree/Disagree" });
  }
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;

  try {
    // MARKER_SUPPORT_DISAGREE_COMMIT_ON_SUBMIT_V1
    // ── ไม่ Commit DB ที่นี่อีกต่อไป -- แค่ Return ข้อมูล Ref ให้ Frontend เอาไป Prefill ──
    // ── การ Commit จริงย้ายไปอยู่ที่ POST /threads (ตอน Submit กระทู้ใหม่สำเร็จ) แทน ──
    // MARKER_SUPPORT_AGREEMENT_PERUSER_V1 -- เช็คว่า Username นี้เคยตอบกระทู้นี้หรือยัง (ไม่เช็คระดับกระทู้)
    const { rows } = await pool.query(
      `SELECT id, log_number, title, menu_source FROM support_threads
       WHERE id = $1 AND status = 'resolved'
         AND NOT EXISTS (SELECT 1 FROM support_thread_agreements a WHERE a.thread_id = $1 AND a.username = $2)`,
      [id, username]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "คุณตอบกระทู้นี้ไปแล้ว หรือกระทู้นี้ไม่อยู่ในสถานะ Resolved" });
    }
    res.json({ ok: true, refThreadId: rows[0].id, refLogNumber: rows[0].log_number, refTitle: rows[0].title, refMenuSource: rows[0].menu_source });
  } catch (err) {
    console.error("POST /support/threads/:id/disagree error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cron: เตือน Owner ถ้ากระทู้ In process ค้างเกิน 3 วัน (นับจาก viewed_at) และไม่ได้ Hold ──
// ── ไม่สะสม — ใช้ Pattern เดียวกับ Comment Notification (UPDATE ทับถ้ามี Notification ค้างอยู่) ──
export async function checkSupportThreadReminders() {
  try {
    const { rows: staleThreads } = await pool.query(
      `SELECT id, title, menu_source FROM support_threads
       WHERE status = 'in_process'
         AND on_hold = FALSE
         AND viewed_at IS NOT NULL
         AND viewed_at < NOW() - INTERVAL '3 days'
         AND (reminder_sent_at IS NULL OR reminder_sent_at < NOW() - INTERVAL '3 days')`
    );

    for (const t of staleThreads) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM notifications WHERE category='support-feedback' AND action_type='reminder' AND link_to=$1 AND target_role='Owner' AND status='unread'`,
        [t.id]
      );
      const msg = "กระทู้นี้ค้างมาเกิน 3 วันแล้ว ยังไม่ได้ Resolve หรือ Hold";
      if (existing.length > 0) {
        await pool.query(`UPDATE notifications SET message=$1, created_at=NOW() WHERE id=$2`, [msg, existing[0].id]);
      } else {
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'reminder', 'Owner', $3, 'unread', $4)`,
          [t.title, msg, t.id, t.menu_source]
        );
      }
      await pool.query(`UPDATE support_threads SET reminder_sent_at = NOW() WHERE id = $1`, [t.id]);
    }
  } catch (err) {
    console.error("checkSupportThreadReminders error:", err.message);
  }
}

// MARKER_SUPPORT_AGREEMENT_PERUSER_V1
// ── Cron: Resolved เกิน 3 วัน แต่ละคนที่ยังไม่ตอบ Auto Agree เฉพาะของตัวเอง (ไม่กระทบคนที่ตอบไปแล้ว) ──
export async function checkAutoAgreeThreads() {
  try {
    const { rows: staleNotifs } = await pool.query(
      `SELECT n.id AS notif_id, n.link_to AS thread_id, n.recipient_username
       FROM notifications n
       JOIN support_threads t ON t.id::text = n.link_to
       WHERE n.category = 'support-feedback' AND n.action_type = 'resolved'
         AND n.recipient_username IS NOT NULL
         AND t.status = 'resolved'
         AND t.resolved_at < NOW() - INTERVAL '3 days'
         AND NOT EXISTS (
           SELECT 1 FROM support_thread_agreements a
           WHERE a.thread_id = n.link_to::uuid AND a.username = n.recipient_username
         )`
    );
    for (const n of staleNotifs) {
      try {
        await pool.query(
          `INSERT INTO support_thread_agreements (thread_id, username, response) VALUES ($1, $2, 'agreed')
           ON CONFLICT (thread_id, username) DO NOTHING`,
          [n.thread_id, n.recipient_username]
        );
        await pool.query(`DELETE FROM notifications WHERE id = $1`, [n.notif_id]);
      } catch (rowErr) {
        console.error("checkAutoAgreeThreads (per-row) error:", rowErr.message);
      }
    }
  } catch (err) {
    console.error("checkAutoAgreeThreads error:", err.message);
  }
}

// MARKER_SUPPORT_ACCEPT_EXPIRY_CRON_V1
// ── Cron: ลบ Notification "Accept" (action_type='accepted') ที่หมดอายุ 30 นาทีแล้ว ──
// ── ไม่มีการอ่าน/ปิด Chat ภายในเวลา -- หายไปเองจาก Bell โดยไม่ต้องเก็บไว้ที่ไหนต่อ ──
export async function checkAndCleanupExpiredAcceptNotifications() {
  try {
    await pool.query(
      `DELETE FROM notifications
       WHERE category = 'support-feedback' AND action_type = 'accepted'
         AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
  } catch (err) {
    console.error("checkAndCleanupExpiredAcceptNotifications error:", err.message);
  }
}

// MARKER_SUPPORT_TESTING_RECALL_V1
// ── Cron: ผู้แจ้งไม่ Test ภายใน 3 วัน -> Auto Recall กลับ Owner (หายจาก List ผู้แจ้งเลย) ──
export async function checkTestingRecall() {
  try {
    const { rows: staleThreads } = await pool.query(
      `SELECT id, title, menu_source, created_by FROM support_threads
       WHERE status = 'testing'
         AND sent_to_test_at IS NOT NULL
         AND sent_to_test_at < NOW() - INTERVAL '3 days'`
    );

    for (const t of staleThreads) {
      await pool.query(
        `UPDATE support_threads SET status = 'in_process', sent_to_test_at = NULL, last_activity_at = NOW() WHERE id = $1`,
        [t.id]
      );
      // ── ลบ Notification "send_to_test" ของผู้แจ้งทิ้ง -- หายจาก List เขาเลย ──
      try {
        await pool.query(
          `DELETE FROM notifications WHERE category = 'support-feedback' AND action_type = 'send_to_test' AND link_to = $1 AND recipient_username = $2`,
          [t.id, t.created_by]
        );
      } catch (cleanupErr) {
        console.error("ลบ Notification send_to_test ตอน Recall ไม่สำเร็จ:", cleanupErr.message);
      }
      // ── แจ้ง Owner ว่ากระทู้นี้ถูก Recall กลับมา ──
      try {
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'testing_recalled', 'Owner', $3, 'unread', $4)`,
          [t.title, `${t.created_by} ไม่ Test ภายใน 3 วัน กระทู้นี้ถูก Recall กลับมาแล้ว`, t.id, t.menu_source]
        );
      } catch (notifErr) {
        console.error("แจ้งเตือน Recall ไม่สำเร็จ:", notifErr.message);
      }
    }
  } catch (err) {
    console.error("checkTestingRecall error:", err.message);
  }
}

// MARKER_SUPPORT_REMINDER_1HOUR_V1
// ── Cron: เตือนผู้แจ้งกระทู้ทุก 1 ชม. ถ้ายังไม่มี Action -- Agree/Disagree ──
export async function checkAgreementReminders() {
  try {
    const { rows: notifs } = await pool.query(
      `SELECT n.id, n.link_to
       FROM notifications n
       JOIN support_threads t ON t.id::text = n.link_to
       WHERE n.category = 'support-feedback' AND n.action_type = 'resolved' AND n.status = 'unread'
         AND n.created_at < NOW() - INTERVAL '1 hour'
         AND t.status = 'resolved' AND t.agreement_status = 'pending'`
    );
    for (const n of notifs) {
      await pool.query(`UPDATE notifications SET created_at = NOW() WHERE id = $1`, [n.id]);
    }
  } catch (err) {
    console.error("checkAgreementReminders error:", err.message);
  }
}

// ── Cron: เตือนผู้แจ้งกระทู้ทุก 1 ชม. ถ้ายังไม่มี Action -- Test Confirm/ไม่ผ่าน ──
export async function checkTestConfirmReminders() {
  try {
    const { rows: notifs } = await pool.query(
      `SELECT n.id, n.link_to
       FROM notifications n
       JOIN support_threads t ON t.id::text = n.link_to
       WHERE n.category = 'support-feedback' AND n.action_type = 'send_to_test' AND n.status = 'unread'
         AND n.created_at < NOW() - INTERVAL '1 hour'
         AND t.status = 'testing'`
    );
    for (const n of notifs) {
      await pool.query(`UPDATE notifications SET created_at = NOW() WHERE id = $1`, [n.id]);
    }
  } catch (err) {
    console.error("checkTestConfirmReminders error:", err.message);
  }
}

// MARKER_SUPPORT_RESTORE_NEW_NOTIFICATION_V1
// ── Cron: กระทู้ status='new' ที่ยังไม่มี Notification 'new_thread' ค้างอยู่
// (เช่น Owner กด Dismiss ไปแล้วแต่ยังไม่ได้กด Accept, หรือตอนสร้างกระทู้ Insert Notification ล้มเหลว)
// -> สร้าง Notification กลับมาใหม่ให้ Bell ของ Owner โชว์อีกครั้ง
// ── เรียกจาก app.js ทุก 2-5 นาที (Pattern เดียวกับ Cron ตัวอื่นในไฟล์นี้) ──
export async function checkAndRestoreNewThreadNotifications() {
  try {
    const { rows: missingThreads } = await pool.query(
      `SELECT t.id, t.title, t.body, t.created_by, t.menu_source
       FROM support_threads t
       WHERE t.status = 'new'
         AND t.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.category = 'support-feedback' AND n.action_type = 'new_thread'
             AND n.link_to = t.id::text AND n.target_role = 'Owner'
         )`
    );

    for (const t of missingThreads) {
      try {
        const preview = t.body.length > 100 ? t.body.slice(0, 100) + "…" : t.body;
        await pool.query(
          `INSERT INTO notifications (title, message, category, action_type, target_role, link_to, created_by, status, menu_source)
           VALUES ($1, $2, 'support-feedback', 'new_thread', 'Owner', $3, $4, 'unread', $5)`,
          [t.title, preview, t.id, t.created_by, t.menu_source]
        );
      } catch (rowErr) {
        console.error("checkAndRestoreNewThreadNotifications (per-row) error:", rowErr.message);
      }
    }
  } catch (err) {
    console.error("checkAndRestoreNewThreadNotifications error:", err.message);
  }
}

export default router;