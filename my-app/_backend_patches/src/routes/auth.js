import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

function verifyPassword(password, hash) {
  if (!hash) return false;
  if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
    return false;
  }
  if (hash.startsWith('sha256:')) {
    const [, salt, storedHash] = hash.split(':');
    const computed = crypto.createHmac('sha256', salt).update(password).digest('hex');
    return computed === storedHash;
  }
  return false;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return `sha256:${salt}:${hash}`;
}

function generateOTP() {
  // 6-digit numeric OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── docAccess: merge user_roles.permissions + doc_access_override ──────────
// mapping เดียวกับ frontend (UserManagement.js DOC_FOLDERS)
const FOLDER_PERM_MAP = { ap: 'VAT', vat: 'VAT', ie: 'IE', gl: 'GL', ipro: 'I-Pro' };

async function getDocAccess(userId, permissions) {
  const folders = Object.keys(FOLDER_PERM_MAP);
  const base = {};
  folders.forEach(key => {
    base[key] = permissions?.[FOLDER_PERM_MAP[key]] === true;
  });
  if (!userId) return base;
  try {
    const { rows } = await pool.query(
      "SELECT folder_key, allowed FROM doc_access_override WHERE user_id = $1",
      [userId]
    );
    const result = { ...base };
    rows.forEach(o => {
      if (Object.prototype.hasOwnProperty.call(result, o.folder_key)) {
        result[o.folder_key] = !!o.allowed;
      }
    });
    return result;
  } catch (err) {
    console.error("getDocAccess error:", err.message);
    return base;
  }
}

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password required" });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_roles WHERE email = $1 LIMIT 1",
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    // ตรวจสอบ status — pending ยังไม่ได้ approve
    if (user.status === 'pending') {
      return res.status(403).json({ error: "บัญชีของคุณยังรอการ Approve จาก Owner ครับ" });
    }

    // ตรวจสอบ OTP login (must_change_password)
    if (user.must_change_password && user.otp_code) {
      const otpValid = user.otp_code === password;
      const notExpired = user.otp_expires_at && new Date() < new Date(user.otp_expires_at);
      if (!otpValid || !notExpired) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      // OTP ถูกต้อง — clear otp แต่ยัง must_change_password = true
      await pool.query(
        "UPDATE user_roles SET otp_code = NULL, otp_expires_at = NULL WHERE email = $1",
        [email]
      );
      const token = jwt.sign(
        { sub: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );
      const otpDocAccess = await getDocAccess(user.id, user.permissions);

    // MARKER_AUTH_LOGIN_ACTIVITY_LOG_V1 -- บันทึกเวลา Login เข้า activity_log สำหรับ Metric วิเคราะห์เวลาเข้าใช้งาน
    // Fire-and-forget (ไม่ await) กัน Insert ช้าไปหน่วง Response ตอน Login
    pool.query(
      `INSERT INTO activity_log (username, user_email, action, module, created_at)
       VALUES ($1, $2, 'LOGIN', 'AUTH', NOW())`,
      [user.username, user.email]
    ).catch(err => console.error('[MARKER_AUTH_LOGIN_ACTIVITY_LOG_V1] บันทึก Login Log ไม่สำเร็จ:', err.message));
      return res.json({
        token,
        must_change_password: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          permissions: { ...(user.permissions || {}), docAccess: otpDocAccess },
        },
      });
    }

    const valid = verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    const docAccess = await getDocAccess(user.id, user.permissions);

    // MARKER_AUTH_LOGIN_ACTIVITY_LOG_V1 -- บันทึกเวลา Login เข้า activity_log สำหรับ Metric วิเคราะห์เวลาเข้าใช้งาน
    // Fire-and-forget (ไม่ await) กัน Insert ช้าไปหน่วง Response ตอน Login
    pool.query(
      `INSERT INTO activity_log (username, user_email, action, module, created_at)
       VALUES ($1, $2, 'LOGIN', 'AUTH', NOW())`,
      [user.username, user.email]
    ).catch(err => console.error('[MARKER_AUTH_LOGIN_ACTIVITY_LOG_V1] บันทึก Login Log ไม่สำเร็จ:', err.message));

    // MARKER_IE_SIMPLEVATDRAFT_ORPHAN_CLEANUP_ON_LOGIN_V1
    // ── ie_simplevatdraft ที่ยังเป็น 'draft' และไม่มี draft_id ผูกอยู่ ────
    // ── (draft_id จะถูกใส่ตอน Submit Invoice สำเร็จเท่านั้น -- ดู IEController.js) ──
    // ── = Add ธรรมดาที่ไม่เคย Submit จริง (Orphan) ลบได้ปลอดภัย ──────────────────
    // ── กันลบ Draft ที่กำลังทำงานอยู่: เว้น Draft ที่สร้างมาไม่ถึง 1 ชม. ไว้ก่อน ──
    // ── รันแบบ Fire-and-forget ไม่ await ไม่ให้หน่วงการตอบ Login ─────────────────
    if (user.permissions?.IE === true) {
      pool.query(
        `DELETE FROM ie_simplevatdraft
         WHERE status = 'draft'
           AND draft_id IS NULL
           AND created_at < NOW() - INTERVAL '1 hour'`
      ).then(({ rowCount }) => {
        if (rowCount > 0) console.log(`[Simple Orphan Cleanup] ลบ Draft ค้างไป ${rowCount} แถว`);
      }).catch(err => console.error('[Simple Orphan Cleanup] error:', err.message));
    }

    res.json({
      token,
      must_change_password: user.must_change_password || false,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        permissions: { ...(user.permissions || {}), docAccess },
      },
    });
  } catch (err) {
    console.error("login error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/me
router.get("/me", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, email, username, role, permissions, must_change_password FROM user_roles WHERE email = $1 LIMIT 1",
      [payload.email]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    const docAccess = await getDocAccess(user.id, user.permissions);
    res.json({ user: { ...user, permissions: { ...(user.permissions || {}), docAccess } } });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.json({ ok: true });
});

// POST /auth/set-password
router.post("/set-password", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password required" });
  try {
    const hash = hashPassword(password);
    await pool.query("UPDATE user_roles SET password_hash = $1 WHERE email = $2", [hash, email]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/forgot-password
// รับ email → generate OTP → save ลง DB → ส่ง OTP กลับให้ Frontend เอาไปส่ง EmailJS
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: "email required" });

  try {
    const { rows } = await pool.query(
      "SELECT id, email, username FROM user_roles WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    const user = rows[0];

    // ไม่บอกว่าไม่เจอ email — ป้องกัน user enumeration
    if (!user) {
      return res.json({ ok: true });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 นาที

    await pool.query(
      "UPDATE user_roles SET otp_code = $1, otp_expires_at = $2, must_change_password = true WHERE email = $3",
      [otp, expiresAt.toISOString(), user.email]
    );

    // ส่ง OTP กลับให้ Frontend เอาไปส่งผ่าน EmailJS
    res.json({
      ok: true,
      otp,
      username: user.username,
      email: user.email,
    });
  } catch (err) {
    console.error("forgot-password error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/change-password
// ใช้หลัง login ด้วย OTP แล้ว บังคับเปลี่ยน password
router.post("/change-password", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const hash = hashPassword(newPassword);
    await pool.query(
      "UPDATE user_roles SET password_hash = $1, must_change_password = false, otp_code = NULL, otp_expires_at = NULL WHERE email = $2",
      [hash, payload.email]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("change-password error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/resolve-username?username=xxx
router.get("/resolve-username", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username required" });
  try {
    const { rows } = await pool.query(
      "SELECT email FROM user_roles WHERE username = $1 LIMIT 1",
      [username.trim().toLowerCase()]
    );
    if (!rows[0]) return res.json({ email: null });
    res.json({ email: rows[0].email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/signup
// รับ username/email/password → insert ลง user_roles แบบ pending → notify Owner
router.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "username, email and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    // เช็ค email ซ้ำ
    const { rows: existing } = await pool.query(
      "SELECT id FROM user_roles WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (existing[0]) return res.status(409).json({ error: "Email นี้มีในระบบแล้วครับ" });

    // เช็ค username ซ้ำ
    const { rows: existingUsername } = await pool.query(
      "SELECT id FROM user_roles WHERE username = $1 LIMIT 1",
      [username.trim().toLowerCase()]
    );
    if (existingUsername[0]) return res.status(409).json({ error: "Username นี้มีในระบบแล้วครับ" });

    const hash = hashPassword(password);
    const defaultPermissions = { VAT: false, "I-Pro": false, GL: false, IE: false, Function: false, Manual: false };

    const { rows } = await pool.query(
      `INSERT INTO user_roles (email, username, password_hash, role, permissions, status, updated_at)
       VALUES ($1, $2, $3, 'Viewer', $4, 'pending', NOW())
       RETURNING id`,
      [email.trim().toLowerCase(), username.trim().toLowerCase(), hash, JSON.stringify(defaultPermissions)]
    );
    const newUserId = rows[0].id;

    // สร้าง notification ให้ Owner
    await pool.query(
      `INSERT INTO access_requests (requester_id, requester_name, status, request_type, ref_user_id, created_at)
       VALUES ($1, $2, 'pending', 'signup', $1, NOW())`,
      [newUserId, username.trim().toLowerCase()]
    );

    // MARKER_AUTH_SIGNUP_BROADCAST_V1
    // ── Broadcast แบบ Real-time — Owner เห็น Signup Request ใหม่ทันที ────────
    // ── ไม่ต้องรอ Poll 30 วิ (ทำจาก Backend เพราะตอนนี้ยังไม่มี Token Login) ──
    if (global._wss) {
      const msg = JSON.stringify({ event: "access_request_new", requester_name: username.trim().toLowerCase() });
      global._wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(msg);
      });
    }

    res.json({ ok: true, message: "ส่งคำขอสำเร็จแล้วครับ รอ Owner Approve" });
  } catch (err) {
    console.error("signup error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/approve-signup
// Owner approve/reject pending user
router.post("/approve-signup", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  const { userId, action } = req.body; // action: 'approve' | 'reject'
  if (!userId || !['approve', 'reject'].includes(action))
    return res.status(400).json({ error: "userId and action required" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const { rows: ownerRows } = await pool.query(
      "SELECT role FROM user_roles WHERE email = $1 LIMIT 1",
      [payload.email]
    );
    if (!ownerRows[0] || ownerRows[0].role !== 'Owner')
      return res.status(403).json({ error: "Owner only" });

    if (action === 'approve') {
      await pool.query(
        "UPDATE user_roles SET status = 'active', updated_at = NOW() WHERE id = $1",
        [userId]
      );
    } else {
      await pool.query("DELETE FROM user_roles WHERE id = $1", [userId]);
    }

    // mark notification as read
    await pool.query(
      "UPDATE access_requests SET status = $1, handled_by = $2, handled_at = NOW() WHERE ref_user_id = $3 AND request_type = 'signup'",
      [action === 'approve' ? 'approved' : 'rejected', payload.email, userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("approve-signup error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// วางต่อท้ายก่อน export default router;

// POST /auth/admin/create-user
// Owner/Admin สร้าง user ใหม่โดยตรง (ไม่ผ่าน signup flow)
router.post("/admin/create-user", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role)
    return res.status(400).json({ error: "username, email, password and role required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const { rows: callerRows } = await pool.query(
      "SELECT role FROM user_roles WHERE email = $1 LIMIT 1",
      [payload.email]
    );
    const callerRole = callerRows[0]?.role;
    if (!['Owner', 'Admin'].includes(callerRole))
      return res.status(403).json({ error: "Owner/Admin only" });

    // เช็ค email ซ้ำ
    const { rows: existing } = await pool.query(
      "SELECT id FROM user_roles WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (existing[0]) return res.status(409).json({ error: "Email นี้มีในระบบแล้วครับ" });

    // เช็ค username ซ้ำ
    const { rows: existingUsername } = await pool.query(
      "SELECT id FROM user_roles WHERE username = $1 LIMIT 1",
      [username.trim().toLowerCase()]
    );
    if (existingUsername[0]) return res.status(409).json({ error: "Username นี้มีในระบบแล้วครับ" });

    const hash = hashPassword(password);
    const DEFAULT_PERMISSIONS = {
      Owner:  { VAT: true,  'I-Pro': true,  GL: true,  IE: true,  Function: true,  Manual: true  },
      Admin:  { VAT: true,  'I-Pro': true,  GL: true,  IE: true,  Function: true,  Manual: true  },
      Editor: { VAT: true,  'I-Pro': false, GL: false, IE: false, Function: false, Manual: true  },
      Viewer: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false },
    };
    const permissions = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.Viewer;

    await pool.query(
      `INSERT INTO user_roles (email, username, password_hash, role, permissions, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
      [email.trim().toLowerCase(), username.trim().toLowerCase(), hash, role, JSON.stringify(permissions)]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("admin/create-user error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /auth/admin/delete-user
// Owner/Admin ลบ user ออกจากระบบ
router.delete("/admin/delete-user", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: "email required" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const { rows: callerRows } = await pool.query(
      "SELECT role FROM user_roles WHERE email = $1 LIMIT 1",
      [payload.email]
    );
    const callerRole = callerRows[0]?.role;
    if (!['Owner', 'Admin'].includes(callerRole))
      return res.status(403).json({ error: "Owner/Admin only" });

    // ป้องกันลบตัวเอง
    if (payload.email === email.trim().toLowerCase())
      return res.status(400).json({ error: "ไม่สามารถลบบัญชีตัวเองได้ครับ" });

    // ป้องกันลบ Owner
    const { rows: targetRows } = await pool.query(
      "SELECT role FROM user_roles WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (targetRows[0]?.role === 'Owner')
      return res.status(403).json({ error: "ไม่สามารถลบ Owner ได้ครับ" });

    await pool.query("DELETE FROM user_roles WHERE email = $1", [email.trim().toLowerCase()]);

    res.json({ ok: true });
  } catch (err) {
    console.error("admin/delete-user error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;