import { tablePermissions } from "../config/tablePermissions.js";

/**
 * คืนค่า middleware ที่เช็คว่า req.user.appRole มีสิทธิ์ทำ action นี้กับ table นี้ไหม
 * ใช้แทน RLS policy ที่เคยทำงานอยู่ที่ระดับ database บน Supabase
 */
export function checkPermission(tableName, action) {
  return (req, res, next) => {
    const rules = tablePermissions[tableName];

    if (!rules) {
      // ไม่มี config เลย = ปฏิเสธไปก่อนเพื่อความปลอดภัย (fail-safe)
      return res.status(404).json({ error: `No permission rule defined for table "${tableName}"` });
    }

    const rule = rules[action];

    if (!rule) {
      return res.status(403).json({ error: `Action "${action}" not allowed on "${tableName}"` });
    }

    if (rule.publicRead) {
      // login แล้ว (ผ่าน verifyAuth มาแล้ว) ก็ทำ action นี้ได้เลย
      return next();
    }

    if (rule.roles && rule.roles.includes(req.user.appRole)) {
      return next();
    }

    return res.status(403).json({ error: "Insufficient permission" });
  };
}
