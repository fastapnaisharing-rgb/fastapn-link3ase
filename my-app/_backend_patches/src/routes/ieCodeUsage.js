import { Router } from "express";
import { pool } from "../db.js";
import { checkPermission } from "../middleware/checkPermission.js";

// MARKER_IECODE_USAGE_TOUCH_ROUTER_V1 -- นับจำนวนครั้งที่ IE-Code Supplier ถูกเลือกใช้จริง
// (คลิกจาก Search Popup หรือพิมพ์ Code ตรงแล้ว Resolve เจอ) ใช้จัดอันดับ "ใช้บ่อย" ต่อ BU
// Atomic Increment ตรงที่ DB (usage_count = usage_count + 1) กัน Race Condition ที่จะเกิด
// ถ้าใช้ PUT ธรรมดาของ Generic Router (อ่านค่ามาก่อน +1 แล้วค่อยเขียนทับ — เสี่ยงนับหายถ้ามี
// คนกดพร้อมกันเป๊ะ) Mount คู่กับ Generic Router เดิมที่ path เดียวกัน (/api/ie_code_list)
// ไม่ชนกันเพราะ Generic Router ไม่มี Route รูปแบบ /:id/touch อยู่แล้ว
// ใช้ checkPermission("read") ไม่ใช่ "write" เพราะแค่บันทึกสถิติการใช้งาน ไม่ได้แก้ข้อมูล
// Supplier จริง — ใครก็ตามที่เห็น/เลือก Supplier ได้ ควรนับสถิติได้ด้วย
const router = Router();

router.post("/:id/touch", checkPermission("ie_code_list", "read"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE "ie_code_list"
       SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = NOW()
       WHERE id = $1
       RETURNING id, usage_count, last_used_at`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
