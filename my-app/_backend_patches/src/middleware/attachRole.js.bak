import { pool } from "../db.js";
/**
 * หลังจาก verifyAuth ยืนยันตัวตนผ่านแล้ว (รู้ email ของ user)
 * ดึง role และ permissions จากตาราง user_roles ที่มีอยู่แล้วในระบบ เพื่อใช้ตัดสินใจเรื่อง permission ต่อไป
 * (แทนที่ auth.jwt() ->> 'role' หรือการ query user_roles ที่เคยอยู่ใน RLS policy เดิม)
 */
export async function attachAppRole(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT role, permissions, username FROM user_roles WHERE email = $1 LIMIT 1",
      [req.user.email]
    );
    // ถ้าไม่เจอ email ในตาราง user_roles เลย ให้ถือเป็น role ต่ำสุด (viewer) เพื่อความปลอดภัย
    req.user.appRole = rows[0]?.role || "viewer";
    // ── เพิ่มการแนบ permissions เข้า req.user ด้วย (เดิมขาดไปจึงทำให้ Notification Bell ไม่มีข้อมูลให้กรอง) ──
    req.user.permissions = rows[0]?.permissions || {};
    // ── เพิ่มการแนบ username เข้า req.user ด้วย (เดิมมีแค่ id/email จาก JWT Token
    // ── ทำให้ Backend ทุกจุดที่ต้องบันทึก "ใครทำ Action นี้" เช่น deleted_by ใน
    // ── recycle_bin ใช้ Email แทน Username ผิดพลาด — Fallback เป็น email ถ้าหา
    // ── username ไม่เจอ กัน undefined หลุดไปที่อื่น) ──────────────────────────
    req.user.username = rows[0]?.username || req.user.email;
    next();
  } catch (err) {
    next(err);
  }
}