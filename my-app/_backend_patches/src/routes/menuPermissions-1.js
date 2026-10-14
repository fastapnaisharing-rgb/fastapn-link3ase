// MARKER_MENU_PERMISSION_CONFIG_BACKEND_V2
// Helper กลางสำหรับ "GL Access แบบตามสิทธิ์ (Permission) + Override รายคน" -- ไม่มี Route ของตัวเอง
// (GET/PUT /ap-reconcile/menu-permissions ยังอยู่ใน apReconcileReport.js เหมือนเดิม)
// ความหมายของตาราง menu_permission_config = "ค่าเริ่มต้น + แถวที่ตั้งทับ" (ตรงกับ apReconcileReport.js):
//   ค่าเริ่มต้นของ gl-ap-recon = Manual | IE | I-Pro | แถว allowed=true = เพิ่มสิทธิ์ | allowed=false = ตัดสิทธิ์นั้นออก
import { pool } from "../db.js";

export const GL_MENU_KEY = "gl-ap-recon";
const DEFAULTS = { [GL_MENU_KEY]: ["Manual", "IE", "I-Pro"] };
const ALL_PERM_KEYS = ["VAT", "I-Pro", "GL", "IE", "Function", "Manual"];

pool.query(`CREATE TABLE IF NOT EXISTS menu_permission_config (
  menu_key text NOT NULL, perm_key text NOT NULL, allowed boolean NOT NULL,
  updated_by text, updated_at timestamptz DEFAULT NOW(), PRIMARY KEY (menu_key, perm_key))`)
  .catch((e) => console.error("[migrate menu_permission_config]:", e.message));

let cache = null; let cacheAt = 0;
async function loadRows() {
  if (cache && Date.now() - cacheAt < 5000) return cache;
  const q = await pool.query("SELECT menu_key, perm_key, allowed FROM menu_permission_config");
  cache = q.rows; cacheAt = Date.now();
  return cache;
}

// สิทธิ์ที่เข้า GL (AP Recon) ได้ = ค่าเริ่มต้น + แถวที่ตั้งทับ
export async function glAllowedPerms() {
  const set = new Set(DEFAULTS[GL_MENU_KEY]);
  try {
    (await loadRows()).filter((r) => r.menu_key === GL_MENU_KEY).forEach((r) => { if (r.allowed) set.add(r.perm_key); else set.delete(r.perm_key); });
  } catch (_) { /* ตารางอ่านไม่ได้ -> ใช้ค่าเริ่มต้น */ }
  return ALL_PERM_KEYS.filter((k) => set.has(k));
}

// MARKER_GL_REPORT_OVERRIDE_V1 -- ผู้ใช้คนนี้เข้า GL (AP Recon / SharePoint Handler ฝั่ง AP) ได้ไหม
// Owner = ได้เสมอ | มี Override รายคน (doc_access_override, folder_key='gl') = ใช้ค่านั้น | ไม่มี = ตาม Permission ใน GL Access
export async function glAccessFor(u) {
  if (!u) return false;
  if (u.appRole === "Owner") return true;
  try {
    const r = await pool.query("SELECT id FROM user_roles WHERE email = $1 LIMIT 1", [u.email]);
    const uid = r.rows[0] && r.rows[0].id;
    if (uid) {
      const o = await pool.query("SELECT allowed FROM doc_access_override WHERE user_id = $1 AND folder_key = 'gl'", [uid]);
      if (o.rows.length) return !!o.rows[0].allowed;
    }
  } catch (_) { /* ไม่มี Override -> ตาม Permission */ }
  const allowed = await glAllowedPerms();
  const p = u.permissions || {};
  return allowed.some((k) => p[k] === true);
}

// เข้ากันได้กับโค้ดที่ import default เดิม -- ไม่ลงทะเบียน Route ซ้ำ (Route อยู่ใน apReconcileReport.js)
export default function registerMenuPermissions() {}
