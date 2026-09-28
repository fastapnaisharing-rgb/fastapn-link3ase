import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ── Fix: บังคับ Column Type DATE ให้คืนเป็น String ตรงๆ (กัน Timezone Shift) ──
// ── ปกติ pg จะ Parse DATE เป็น JS Date Object (เที่ยงคืน Local Time) แล้วพอ ──
// ── res.json() เรียก .toISOString() จะแปลงเป็น UTC ทำให้วันที่ถอยไป 1 วัน ──
// ── (เครื่อง Server อยู่ Timezone ไทย UTC+7) — Type OID 1082 = DATE ใน Postgres ──
pg.types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// ── แปลง Email เป็น Username จริง (เก็บใน user_roles) สำหรับ Activity Log ──
// ── ใช้แทน req.user.email ตอน Insert activity_log เพื่อให้ Log แสดงชื่อคน ไม่ใช่ Email ──
export async function getUsernameByEmail(email) {
  try {
    // ── Fix: ไม่สนตัวพิมพ์ใหญ่-เล็ก กัน Email Case ไม่ตรงกับที่เก็บใน DB แล้วหาไม่เจอ ──
    const { rows } = await pool.query(
      `SELECT username FROM user_roles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    return rows[0]?.username || email; // หาไม่เจอ fallback เป็น email เดิม กันระบบพัง
  } catch (err) {
    console.error("getUsernameByEmail error:", err.message);
    return email; // Error ก็ fallback เป็น email เหมือนกัน ไม่ทำให้ Insert Log ล้มเหลว
  }
}