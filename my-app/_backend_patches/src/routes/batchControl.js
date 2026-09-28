// routes/batchControl.js
// ── Batch Control: Query Batch ที่ Approve แล้ว + ยังไม่เคยส่ง Email เรื่องนั้น ──
// ── (Join ข้าม batch_list + batch_email_log ทำผ่าน Generic CRUD ไม่ได้ ────────
// ── เลยต้องเขียน Route เฉพาะ) ──────────────────────────────────────────────
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// GET /api/batch-control/counts
// นับจำนวน Batch ที่รอส่งของทุก Template (สำหรับตัวเลข Badge บน Tab)
router.get("/counts", async (req, res) => {
  try {
    const { rows: templates } = await pool.query(
      `SELECT id, name FROM email_templates ORDER BY created_at ASC`
    );
    // MARKER_BATCHCONTROL_GLOBAL_STATUS_ENDPROCESS — status เป็น Global แล้ว
    // ── ไม่ผูกกับ Template อีกต่อไป ทุก Template จะเห็นจำนวนเท่ากัน ──────────
    const { rows: pendingCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM batch_list WHERE status = 'approved'`
    );
    const pendingCount = pendingCountRows[0]?.cnt || 0;
    const counts = templates.map((t) => ({ ...t, pending_count: pendingCount }));
    res.json(counts);
  } catch (err) {
    console.error("GET /batch-control/counts error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/batch-control/pending/:templateId
// ดึง Batch ที่ Approve แล้ว + ยังไม่เคยส่ง Email ตาม Template นี้
router.get("/pending/:templateId", async (req, res) => {
  const { templateId } = req.params;
  try {
    // MARKER_BATCHCONTROL_DUE_DATE_JOIN
    // Due Date ไม่ได้เก็บที่ batch_list -- เก็บแยกรายใบ Invoice ใน
    // bucket_list.form_data->>'dueDate' -- ต้อง LATERAL JOIN หา Min/Max
    // ของทุก Invoice ในแต่ละ Batch (bucket_list.batch_id = batch_list.batch_id
    // เป็น Business Key แบบ String ไม่ใช่ UUID id)
    // MARKER_BATCHCONTROL_GLOBAL_STATUS_ENDPROCESS — status เป็น Global แล้ว
    // ── templateId รับไว้เผื่ออนาคต แต่ตอนนี้ไม่ได้ใช้กรองอีกต่อไป ──────────
    const { rows } = await pool.query(
      `SELECT b.*, due.due_date_first, due.due_date_last
       FROM batch_list b
       LEFT JOIN LATERAL (
         SELECT MIN((bl.form_data->>'dueDate')::date) AS due_date_first,
                MAX((bl.form_data->>'dueDate')::date) AS due_date_last
         FROM bucket_list bl
         WHERE bl.batch_id = b.batch_id
           AND bl.form_data->>'dueDate' IS NOT NULL
           AND bl.form_data->>'dueDate' <> ''
       ) due ON true
       WHERE b.status = 'approved'
       ORDER BY b.approved_at DESC NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /batch-control/pending error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/batch-control/sent
// ดึง Batch ที่ส่ง Email ไปแล้ว (status = 'end_process') — Tab "ส่งแล้ว"
router.get("/sent", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, due.due_date_first, due.due_date_last
       FROM batch_list b
       LEFT JOIN LATERAL (
         SELECT MIN((bl.form_data->>'dueDate')::date) AS due_date_first,
                MAX((bl.form_data->>'dueDate')::date) AS due_date_last
         FROM bucket_list bl
         WHERE bl.batch_id = b.batch_id
           AND bl.form_data->>'dueDate' IS NOT NULL
           AND bl.form_data->>'dueDate' <> ''
       ) due ON true
       WHERE b.status = 'end_process'
       ORDER BY b.approved_at DESC NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /batch-control/sent error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/batch-control/mark-sent
// บันทึกว่า Batch เหล่านี้ถูกส่ง Email เรื่องนี้ไปแล้ว (เรียกตอนกด "เปิด Outlook Draft")
// Body: { batchIds: [uuid, ...], templateId: uuid, sentBy: string }
router.post("/mark-sent", async (req, res) => {
  const { batchIds, templateId, sentBy } = req.body || {};
  if (!Array.isArray(batchIds) || batchIds.length === 0 || !templateId) {
    return res.status(400).json({ error: "batchIds (Array) และ templateId จำเป็นต้องระบุ" });
  }
  try {
    const values = batchIds.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
    const params = batchIds.flatMap((id) => [id, templateId, sentBy || null]);
    await pool.query(
      `INSERT INTO batch_email_log (batch_id, template_id, sent_by) VALUES ${values}`,
      params
    );
    // MARKER_BATCHCONTROL_GLOBAL_STATUS_ENDPROCESS — ปิดจบ Batch แบบ Global
    // ── ส่ง Template ไหนก็ถือว่าจบขั้นตอน หายจากทุก Template ทันที (ตาม Confirm) ──
    // MARKER_BATCHCONTROL_NOTE_TEMPLATE_NAME — เก็บชื่อ Template ไว้ที่ note
    // ── ไม่แตะ status (ยังเป็น end_process เหมือนเดิม) — note ใช้แค่โชว์อ้างอิงว่า ──
    // ── ส่งด้วย Template ไหน ดึงชื่อจาก email_templates ไม่ hardcode ────────────
    await pool.query(
      `UPDATE batch_list
       SET status = 'end_process',
           note = (SELECT name FROM email_templates WHERE id = $2)
       WHERE id = ANY($1::uuid[])`,
      [batchIds, templateId]
    );

    // MARKER_MARKSENT_ARCHIVE_LEGACY_V1 -- บันทึกถาวรเข้า legacy_poc_history เพิ่ม
    // (ตารางเดียวกับที่ Invoice History ดึงไป Union แสดงถาวร ไม่มีวันหาย ต่างจาก
    // batch_list/bucket_list ที่อยู่ในกลไก Retention/Cleanup) -- source='ap_to_fp'
    try {
      const { rows: batchRows } = await pool.query(
        `SELECT batch_id FROM batch_list WHERE id = ANY($1::uuid[])`,
        [batchIds]
      );
      const textBatchIds = batchRows.map((r) => r.batch_id).filter(Boolean);
      if (textBatchIds.length > 0) {
        const { rows: invoiceRows } = await pool.query(
          `SELECT invoice_no, vendor_no, inv_date, net, description
           FROM bucket_list WHERE batch_id = ANY($1::text[])`,
          [textBatchIds]
        );
        const candidates = invoiceRows.filter((r) => r.invoice_no && r.vendor_no);
        if (candidates.length > 0) {
          // ── กันซ้ำ: เช็ค (vendor_no, invoice_num) ที่มีอยู่แล้วก่อน Insert ──────
          const { rows: existing } = await pool.query(
            `SELECT vendor_no, invoice_num FROM legacy_poc_history
             WHERE (vendor_no, invoice_num) IN (
               SELECT * FROM UNNEST($1::text[], $2::text[])
             )`,
            [candidates.map((r) => r.vendor_no), candidates.map((r) => r.invoice_no)]
          );
          const existingSet = new Set(existing.map((e) => `${e.vendor_no}|${e.invoice_num}`));
          for (const inv of candidates) {
            if (existingSet.has(`${inv.vendor_no}|${inv.invoice_no}`)) continue;
            await pool.query(
              `INSERT INTO legacy_poc_history
                 (invoice_num, vendor_no, doc_date, amount, description, note, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [inv.invoice_no, inv.vendor_no, inv.inv_date, inv.net, inv.description, 'AP TO FP', 'ap_to_fp']
            );
          }
        }
      }
    } catch (archiveErr) {
      // ── ไม่ให้ Archive พังแล้วทำให้ mark-sent ทั้งก้อน Fail ไปด้วย (Log ไว้พอ) ──
      console.error("MARKER_MARKSENT_ARCHIVE_LEGACY_V1 archive error:", archiveErr.message);
    }

    res.json({ success: true, count: batchIds.length });
  } catch (err) {
    console.error("POST /batch-control/mark-sent error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;