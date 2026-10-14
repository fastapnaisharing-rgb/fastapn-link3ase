# -*- coding: utf-8 -*-
"""Patch apReconcileReport.js (ไฟล์จริงบน Server): GL Access แบบ Override รายคน + Route ลบไฟล์ My Job
ใช้: python patch_apreconcilereport_gl_access.py <path ของ apReconcileReport.js> [path ปลายทาง]
เติมเฉพาะส่วนที่ขาด ไม่แตะส่วนอื่น | รันซ้ำได้ (มี Marker กันซ้ำ)"""
import sys
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else src
s = open(src, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
def rep(old, new):
    global s
    old = old.replace('\n', nl); new = new.replace('\n', nl)
    assert s.count(old) == 1, 'ไม่พบจุดแทนที่ (ไฟล์ไม่ตรงฐาน): ' + old[:60]
    s = s.replace(old, new)
if 'MARKER_GL_REPORT_OVERRIDE_V1' not in s:
    rep('import { buildApAccountWorkbook, apReportFileName, AP_ACCOUNT_NAMES } from "./apReconcileWorkbook.js";\n',
        'import { buildApAccountWorkbook, apReportFileName, AP_ACCOUNT_NAMES } from "./apReconcileWorkbook.js";\nimport { glAccessFor } from "./menuPermissions.js"; // MARKER_GL_REPORT_OVERRIDE_V1\n')
    rep('''      if (u.appRole === "Owner") return next();
      const perms = await effectiveMenuPerms("gl-ap-recon");
      if (perms.some((k) => u.permissions && u.permissions[k] === true)) return next();
''', '''      if (await glAccessFor(u)) return next(); // MARKER_GL_REPORT_OVERRIDE_V1 -- Owner | Override รายคน (GL) | Permission ใน GL Access
      const perms = await effectiveMenuPerms("gl-ap-recon");
''')
if 'MARKER_APRECONCILE_REPORT_DELETE_V1' not in s:
    rep('''  // ไฟล์ AP Recon เก็บเป็น .xlsx ตรง ๆ''', '''  // MARKER_APRECONCILE_REPORT_DELETE_V1 -- ลบไฟล์ AP Recon ออกจาก My Job (เฉพาะเจ้าของไฟล์): ลบแถวใน file_storage + ไฟล์จริง
  router.delete("/report/jobs/:id", async (req, res) => {
    try {
      const o = await ownJob(req, res); if (!o) return;
      await pool.query(`DELETE FROM file_storage WHERE id=$1 AND module=$2`, [o.rec.id, AP_MODULE]);
      try { if (o.rec.file_path && fs.existsSync(o.rec.file_path)) fs.unlinkSync(o.rec.file_path); } catch (e) { console.warn("[apReconcile] job delete: ลบไฟล์จริงไม่สำเร็จ", e.message); }
      res.json({ ok: true, id: o.rec.id });
    } catch (err) {
      console.error("[apReconcile] job delete error:", err);
      res.status(500).json({ error: "ลบไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });
  // ไฟล์ AP Recon เก็บเป็น .xlsx ตรง ๆ''')
open(dst, 'w', encoding='utf-8', newline='').write(s)
print('OK ->', dst)
