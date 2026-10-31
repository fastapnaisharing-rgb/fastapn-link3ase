#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_gl_macro_filestorage_v1.py  -- เมนู GL Functional > Reconcile > Generate by GL Macro
เพิ่มใน routes/fileStorage.js:
  1) GET  /file-storage/gl-macro-jobs?scope=mine|all   (all = Owner/Admin เท่านั้น)
  2) GET  /file-storage/:id/download-gl-macro          (เจ้าของไฟล์ หรือ Owner/Admin)
  3) Guard ใน POST /generate-raw: module 'gl-macro' ต้องมีสิทธิ์ GL/Manual/VAT/I-Pro (หรือ Owner/Admin)
  4) Cron: module 'gl-macro' ไม่เข้า Recycle Bin, ลบตรงหลัง 48 ชม.
รันซ้ำได้ (Idempotent: มี MARKER แล้วจะข้าม)   ใช้: python patch_gl_macro_filestorage_v1.py [path/to/fileStorage.js]
"""
import os, re, shutil, subprocess, sys

MARKER = "MARKER_FILESTORAGE_GLMACRO_V1"
DEFAULT = r"D:\fastapn-backend\src\routes\fileStorage.js"
target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
if not os.path.isfile(target):
    sys.exit("ไม่พบไฟล์: " + target + "  (ระบุ path เป็น argument แรก)")

with open(target, encoding="utf-8", newline="") as f:
    src = f.read()
if MARKER in src:
    print("มี", MARKER, "อยู่แล้ว -- ข้าม (ไม่แก้ซ้ำ)")
    sys.exit(0)
nl = "\r\n" if "\r\n" in src else "\n"
s = src.replace("\r\n", "\n")

def must_replace(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        sys.exit("Anchor ไม่ตรง (พบ %d ครั้ง ต้องการ %d): %r" % (n, count, old[:70]))
    return s.replace(old, new)

# 3) cron: ไม่ให้สูตร recycle / ลบ "other" จับ gl-macro
s = must_replace(s, "       AND module != 'ie-macrologic'\n", "       AND module != 'ie-macrologic'\n       AND module != 'gl-macro' -- " + MARKER + "\n", count=2)

# 4) cron: ลบตรงหลัง 48 ชม.
s = must_replace(s,
"  // MARKER_FILESTORAGE_VATMAIL_RETENTION_3DAYS_V1\n",
"""  // %s -- gl-macro (Generate by GL Macro): ไม่มี Recycle Bin ลบตรงหลัง 48 ชม. นับจาก created_at
  const { rows: toDeleteGlMacro } = await pool.query(
    `SELECT id, file_path FROM file_storage
     WHERE module = 'gl-macro'
       AND status = 'active'
       AND created_at < NOW() - INTERVAL '48 hours'`
  );

  // MARKER_FILESTORAGE_VATMAIL_RETENTION_3DAYS_V1
""" % MARKER)
s = must_replace(s, "...toDeleteIeMacroLogic, ...toDeleteVatMail];", "...toDeleteIeMacroLogic, ...toDeleteGlMacro, ...toDeleteVatMail];")

# 1+2) Routes + helper
routes = """// %s
// ── Generate by GL Macro: สิทธิ์ = Owner/Admin หรือมี Permission ใดอย่างหนึ่งใน GL / Manual / VAT / I-Pro (IE ไม่รวม) ──
function canUseGlMacro(req) {
  const appRole = req.user?.appRole || "";
  if (appRole === "Owner" || appRole === "Admin") return true;
  const p = req.user?.permissions || {};
  return ["GL", "Manual", "VAT", "I-Pro"].some((k) => p[k] === true);
}

// ── GET /api/file-storage/gl-macro-jobs?scope=mine|all ──
// scope=all ใช้ได้เฉพาะ Owner/Admin (คนอื่นขอมาก็ Fallback เป็น mine เงียบๆ)
router.get("/gl-macro-jobs", async (req, res) => {
  if (!canUseGlMacro(req)) return res.status(403).json({ error: "ไม่มีสิทธิ์ใช้งานเมนูนี้" });
  const username = await getUsernameByEmail(req.user.email);
  const appRole = req.user.appRole || "";
  const isPrivileged = appRole === "Owner" || appRole === "Admin";
  const scope = req.query.scope === "all" && isPrivileged ? "all" : "mine";
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
    res.json(rows);
  } catch (err) {
    console.error("GET /file-storage/gl-macro-jobs error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/file-storage/:id/download-gl-macro ──
router.get("/:id/download-gl-macro", async (req, res) => {
  if (!canUseGlMacro(req)) return res.status(403).json({ error: "ไม่มีสิทธิ์ใช้งานเมนูนี้" });
  const username = await getUsernameByEmail(req.user.email);
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM file_storage WHERE id = $1 AND module = 'gl-macro'`, [id]
    );
    const record = rows[0];
    if (!record) return res.status(404).json({ error: "ไม่พบไฟล์นี้" });
    const appRole = req.user.appRole || "";
    const isPrivileged = appRole === "Owner" || appRole === "Admin";
    if (record.owner_username !== username && !isPrivileged) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้" });
    }
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "ไม่พบไฟล์จริงบน Server (อาจถูกลบไปแล้ว)" });
    }
    const xlsxBuffer = zlib.gunzipSync(fs.readFileSync(record.file_path));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(record.file_name)}"; filename*=UTF-8''${encodeURIComponent(record.file_name)}`);
    res.send(xlsxBuffer);
  } catch (err) {
    console.error("GET /file-storage/:id/download-gl-macro error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

""" % MARKER
s = must_replace(s, "// MARKER_FILESTORAGE_APRECONCILE_LIST_V2\n", routes + "// MARKER_FILESTORAGE_APRECONCILE_LIST_V2\n")

# 3) Guard ใน generate-raw
s = must_replace(s,
"""    if (!bu || !refId || !fileBase64) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี bu, refId, fileBase64)" });
    }

    // ── Decode Base64 กลับเป็นไฟล์ต้นฉบับตรงๆ""",
"""    if (!bu || !refId || !fileBase64) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี bu, refId, fileBase64)" });
    }
    if (module === "gl-macro" && !canUseGlMacro(req)) { // %s
      return res.status(403).json({ error: "ไม่มีสิทธิ์ใช้งาน Generate by GL Macro" });
    }

    // ── Decode Base64 กลับเป็นไฟล์ต้นฉบับตรงๆ""" % MARKER)

# ตรวจวงเล็บ
for a, b in ("()", "{}", "[]"):
    pass
if s.count("{") != s.count("}") or s.count("(") != s.count(")"):
    print("เตือน: จำนวนวงเล็บไม่เท่ากัน (อาจมาจากสตริง/Regex เดิมในไฟล์) -- ตรวจด้วย node --check ต่อ")

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
