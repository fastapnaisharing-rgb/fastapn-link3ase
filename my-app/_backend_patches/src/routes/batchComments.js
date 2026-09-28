import { Router } from "express";
import { pool } from "../db.js";
import fs from "fs";
import path from "path";

/**
 * Batch Comments (Chat) — ผูกกับ batch_list.batch_id โดยตรง
 *
 * v2 เพิ่มจาก v1:
 *  - read_by (jsonb array ของ username ที่อ่านข้อความนี้แล้ว) — ใช้คำนวณ Unread
 *  - Mark-read Endpoint — เปิด Chat แล้ว Mark ทุกข้อความว่าอ่านแล้ว
 *  - Endpoint ดึงรูปด้วย comment id แทน batch_id/filename (กัน batch_id ที่มี "/"
 *    ในชื่อ ชนกับ URL Route — Bug ที่เจอตอนทดสอบ)
 *  - Endpoint ลบทั้งหมดของ Batch (ใช้ตอนกดลบ Batch จากปุ่มถังขยะ — ลบ Record + ไฟล์คู่กัน)
 */

const CHAT_STORAGE_ROOT = path.join(process.cwd(), "storage", "chat");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function wsBroadcastLocal(event, data = {}) {
  if (!global._wss) return;
  const msg = JSON.stringify({ event, ...data });
  global._wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

const router = Router();

// ── GET /api/batch-comments/:batch_id — ดึงข้อความทั้งหมดของ Batch นี้ ────
router.get("/:batch_id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, batch_id, sender_username, message, image_url, read_by, created_at
       FROM batch_comments WHERE batch_id = $1 ORDER BY created_at ASC`,
      [req.params.batch_id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/batch-comments — ส่งข้อความใหม่ (แนบรูปได้ผ่าน Base64) ──────
router.post("/", async (req, res, next) => {
  try {
    const { batch_id, message, image_base64, image_filename } = req.body || {};
    const sender_username = req.user?.email || "unknown";

    if (!batch_id) return res.status(400).json({ error: "ต้องระบุ batch_id" });
    if (!message?.trim() && !image_base64) {
      return res.status(400).json({ error: "ต้องมีข้อความหรือรูปอย่างน้อย 1 อย่าง" });
    }

    // ── คนส่งเอง = อ่านแล้วโดยอัตโนมัติ ──────────────────────────────
    const { rows: inserted } = await pool.query(
      `INSERT INTO batch_comments (batch_id, sender_username, message, read_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [batch_id, sender_username, message?.trim() || "", JSON.stringify([sender_username])]
    );
    const commentId = inserted[0].id;

    if (image_base64) {
      const ext = (image_filename?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const dir = path.join(CHAT_STORAGE_ROOT, String(batch_id));
      ensureDir(dir);
      const fileName = `${commentId}.${ext}`;
      const filePath = path.join(dir, fileName);
      const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
      const imageUrl = `${batch_id}/${fileName}`;
      await pool.query(`UPDATE batch_comments SET image_url = $1 WHERE id = $2`, [imageUrl, commentId]);
    }

    const { rows: full } = await pool.query(`SELECT * FROM batch_comments WHERE id = $1`, [commentId]);

    wsBroadcastLocal("batch_comment_new", { batch_id });

    res.status(201).json(full[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/batch-comments/:batch_id/mark-read — Mark ทุกข้อความว่าอ่านแล้ว ──
router.post("/:batch_id/mark-read", async (req, res, next) => {
  try {
    const username = req.user?.email;
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT id, read_by FROM batch_comments WHERE batch_id = $1`,
      [req.params.batch_id]
    );

    for (const row of rows) {
      const readBy = Array.isArray(row.read_by) ? row.read_by : [];
      if (!readBy.includes(username)) {
        await pool.query(
          `UPDATE batch_comments SET read_by = $1 WHERE id = $2`,
          [JSON.stringify([...readBy, username]), row.id]
        );
      }
    }

    wsBroadcastLocal("batch_comment_read", { batch_id: req.params.batch_id, username });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/batch-comments/image-by-id/:commentId — เสิร์ฟไฟล์รูป ────────
// ── (ใช้ comment id แทน batch_id/filename กัน batch_id ที่มี "/" ในชื่อ ─────
// ── ชนกับ URL Route — Bug ที่เจอตอนทดสอบ) ─────────────────────────────
router.get("/image-by-id/:commentId", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT image_url FROM batch_comments WHERE id = $1`,
      [req.params.commentId]
    );
    if (!rows[0]?.image_url) return res.status(404).json({ error: "Not found" });

    const filePath = path.join(CHAT_STORAGE_ROOT, rows[0].image_url);
    if (!filePath.startsWith(CHAT_STORAGE_ROOT)) return res.status(400).json({ error: "Invalid path" });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/batch-comments/by-batch/:batch_id — ลบทั้งหมดของ Batch นี้ ──
// ── (Record + ไฟล์รูปทั้งโฟลเดอร์) ใช้ตอนกดลบ Batch จากปุ่มถังขยะ ─────────
router.delete("/by-batch/:batch_id", async (req, res, next) => {
  try {
    const batchId = req.params.batch_id;
    const dir = path.join(CHAT_STORAGE_ROOT, batchId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const { rowCount } = await pool.query(`DELETE FROM batch_comments WHERE batch_id = $1`, [batchId]);
    res.json({ deleted: rowCount });
  } catch (err) {
    next(err);
  }
});

export default router;
export { CHAT_STORAGE_ROOT };