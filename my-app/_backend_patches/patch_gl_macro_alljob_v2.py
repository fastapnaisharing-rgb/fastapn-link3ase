#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_gl_macro_alljob_v2.py  -- Generate by GL Macro: All Job เปิดให้ทุกคนที่ใช้เมนูนี้ (ไม่ต้องเป็น Admin) แต่เห็นเฉพาะงานของ Permission เดียวกัน
ต้องรัน patch_gl_macro_filestorage_v1.py ก่อน (ต่อยอดจาก MARKER_FILESTORAGE_GLMACRO_V1)

กฎ All Job (ตามที่ผู้ใช้กำหนด): ผู้ใช้เห็นงานของ "ผู้ Generate ที่มี Permission (GL / Manual / VAT / I-Pro) ตรงกับตัวเองอย่างน้อย 1 ตัว" + งานของตัวเองเสมอ
  | Owner เห็นทั้งหมด | ไฟล์หมดอายุ 48 ชม. อยู่แล้ว | Permission อ่านจาก user_roles.permissions (Pattern เดียวกับ ap-reconcile-jobs)
แก้ใน routes/fileStorage.js:
  1) GET /file-storage/gl-macro-jobs?scope=all  -- เปิดให้ทุกคนที่ผ่านสิทธิ์เมนู แต่กรองตามกฎข้างบน | ทุกแถวมี is_mine, can_delete
  2) GET /file-storage/:id/download-gl-macro   -- ดาวน์โหลด/Preview ได้ถ้าเป็นไฟล์ตัวเอง / Owner / เจ้าของไฟล์มี Permission ตรงกับผู้เรียก
  3) DELETE /file-storage/:id -- Job ของ gl-macro ลบได้เฉพาะเจ้าของ หรือ Owner/Admin
รันซ้ำได้ (Idempotent: มี MARKER แล้วจะข้าม)   ใช้: python patch_gl_macro_alljob_v2.py [path/to/fileStorage.js]
"""
import os, shutil, subprocess, sys

MARKER = "MARKER_FILESTORAGE_GLMACRO_ALLJOB_V2"
REQUIRE = "MARKER_FILESTORAGE_GLMACRO_V1"
DEFAULT = r"D:\fastapn-backend\src\routes\fileStorage.js"
target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
if not os.path.isfile(target):
    sys.exit("ไม่พบไฟล์: " + target + "  (ระบุ path เป็น argument แรก)")

with open(target, encoding="utf-8", newline="") as f:
    src = f.read()
if MARKER in src:
    print("มี", MARKER, "อยู่แล้ว -- ข้าม (ไม่แก้ซ้ำ)")
    sys.exit(0)
if REQUIRE not in src:
    sys.exit("ยังไม่พบ " + REQUIRE + " -- ต้องรัน patch_gl_macro_filestorage_v1.py ก่อน แล้วค่อยรันไฟล์นี้")
nl = "\r\n" if "\r\n" in src else "\n"
s = src.replace("\r\n", "\n")


def must_replace(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        sys.exit("Anchor ไม่ตรง (พบ %d ครั้ง ต้องการ %d): %r" % (n, count, old[:80]))
    return s.replace(old, new)


# 1) All Job: ทุกคนที่ผ่านสิทธิ์เมนู เห็นงานของ Permission เดียวกัน (+ของตัวเอง) | Owner เห็นทั้งหมด
s = must_replace(s,
'''  const scope = req.query.scope === "all" && isPrivileged ? "all" : "mine";
  try {
    const { rows } = scope === "all"
      ? await pool.query(
          `SELECT id, bu, file_name, ref_id, owner_username, created_at
           FROM file_storage WHERE module = 'gl-macro' ORDER BY created_at DESC`
        )
      : await pool.query(
          `SELECT id, bu, file_name, ref_id, owner_username, created_at
           FROM file_storage WHERE module = 'gl-macro' AND owner_username = $1 ORDER BY created_at DESC`,
          [username]
        );
    res.json(rows);''',
'''  const scope = req.query.scope === "all" ? "all" : "mine"; // %s -- All Job เปิดให้ทุกคนที่ผ่าน canUseGlMacro แต่เห็นเฉพาะ Permission เดียวกัน
  try {
    const myPerms = ["GL", "Manual", "VAT", "I-Pro"].filter((k) => req.user?.permissions?.[k] === true);
    let rows;
    if (scope === "all" && appRole === "Owner") {
      ({ rows } = await pool.query(
        `SELECT id, bu, file_name, ref_id, owner_username, created_at
         FROM file_storage WHERE module = 'gl-macro' ORDER BY created_at DESC`
      ));
    } else if (scope === "all") {
      ({ rows } = await pool.query(
        `SELECT fs.id, fs.bu, fs.file_name, fs.ref_id, fs.owner_username, fs.created_at
         FROM file_storage fs
         LEFT JOIN user_roles ur ON ur.username = fs.owner_username
         WHERE fs.module = 'gl-macro'
           AND (fs.owner_username = $1
                OR EXISTS (SELECT 1 FROM unnest($2::text[]) k WHERE (ur.permissions->>k)::boolean IS TRUE))
         ORDER BY fs.created_at DESC`,
        [username, myPerms]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, bu, file_name, ref_id, owner_username, created_at
         FROM file_storage WHERE module = 'gl-macro' AND owner_username = $1 ORDER BY created_at DESC`,
        [username]
      ));
    }
    res.json(rows.map((r) => ({ ...r, is_mine: r.owner_username === username, can_delete: r.owner_username === username || isPrivileged })));''' % MARKER)

# 2) ดาวน์โหลด/Preview: ไฟล์ตัวเอง / Owner / เจ้าของไฟล์มี Permission ตรงกับผู้เรียก
s = must_replace(s,
'''    if (record.owner_username !== username && !isPrivileged) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้" });
    }
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "ไม่พบไฟล์จริงบน Server (อาจถูกลบไปแล้ว)" });
    }
    const xlsxBuffer = zlib.gunzipSync(fs.readFileSync(record.file_path));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(record.file_name)}"; filename*=UTF-8\'\'${encodeURIComponent(record.file_name)}`);
    res.send(xlsxBuffer);
  } catch (err) {
    console.error("GET /file-storage/:id/download-gl-macro error:", err.message);''',
'''    if (record.owner_username !== username && appRole !== "Owner") { // %s -- เจ้าของไฟล์ต้องมี Permission ตรงกับผู้เรียกอย่างน้อย 1 ตัว
      const myPerms = ["GL", "Manual", "VAT", "I-Pro"].filter((k) => req.user?.permissions?.[k] === true);
      const { rows: okRows } = await pool.query(
        `SELECT 1 FROM user_roles ur WHERE ur.username = $1
           AND EXISTS (SELECT 1 FROM unnest($2::text[]) k WHERE (ur.permissions->>k)::boolean IS TRUE)`,
        [record.owner_username, myPerms]
      );
      if (okRows.length === 0) return res.status(403).json({ error: "ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้" });
    }
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "ไม่พบไฟล์จริงบน Server (อาจถูกลบไปแล้ว)" });
    }
    const xlsxBuffer = zlib.gunzipSync(fs.readFileSync(record.file_path));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(record.file_name)}"; filename*=UTF-8\'\'${encodeURIComponent(record.file_name)}`);
    res.send(xlsxBuffer);
  } catch (err) {
    console.error("GET /file-storage/:id/download-gl-macro error:", err.message);''' % MARKER)

# 3) ลบ: เฉพาะเจ้าของ / Owner / Admin
s = must_replace(s,
'''router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT file_path FROM file_storage WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบไฟล์นี้" });
''',
'''router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT file_path, module, owner_username FROM file_storage WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบไฟล์นี้" });
    if (rows[0].module === "gl-macro") { // %s -- คนอื่นเห็น/ดาวน์โหลดได้แต่ลบไม่ได้
      const delUser = await getUsernameByEmail(req.user.email);
      const delRole = (req.user && req.user.appRole) || "";
      if (rows[0].owner_username !== delUser && delRole !== "Owner" && delRole !== "Admin") {
        return res.status(403).json({ error: "ลบได้เฉพาะไฟล์ของตัวเอง" });
      }
    }
''' % MARKER)

bak = target + ".bak"
shutil.copyfile(target, bak)
out = s.replace("\n", nl)
with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(out)

chk = subprocess.run(["node", "--check", target], capture_output=True, text=True, shell=(os.name == "nt"))
if chk.returncode != 0:
    shutil.copyfile(bak, target)
    sys.exit("node --check ไม่ผ่าน -- คืนไฟล์เดิมแล้ว:\n" + chk.stderr)
print("OK แก้ไข", target, "(สำรองไว้ที่", bak + ")")
print("ขั้นต่อไป: Restart-Service fastapn-backend")
