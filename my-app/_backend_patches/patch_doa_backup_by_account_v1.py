# -*- coding: utf-8 -*-
# Backend patch: Detail backup แยกตาม Account (doa_tb_backup.account)
# ใช้: python patch_doa_backup_by_account_v1.py <path ของ routes/fileStorage.js>
# แล้ว Restart-Service fastapn-backend
import sys, shutil, os
MARKER = "MARKER_GL_DOA_BACKUP_BY_ACCOUNT_V1"
p = sys.argv[1] if len(sys.argv) > 1 else r"src\routes\fileStorage.js"
s = open(p, encoding="utf-8").read()
if MARKER in s:
    print("ข้าม: patch นี้ลงแล้ว"); sys.exit(0)

def rep(old, new):
    global s
    assert s.count(old) == 1, ("anchor ไม่ unique/ไม่พบ", s.count(old), old[:90])
    s = s.replace(old, new)

# 1) migration
rep("  .then(() => pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS doa_tb_backup_uq_owner ON doa_tb_backup (bu, period, kind, owner)`))\n",
    "  .then(() => pool.query(`ALTER TABLE doa_tb_backup ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT ''`)) // " + MARKER + " -- Detail backup แยกต่อ Account ('' = ไฟล์เดิมทั้ง BU)\n"
    "  .then(() => pool.query(`DROP INDEX IF EXISTS doa_tb_backup_uq_owner`))\n"
    "  .then(() => pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS doa_tb_backup_uq_owner_acc ON doa_tb_backup (bu, period, kind, owner, account)`))\n")

# 2) list
rep("SELECT id, bu, period, kind, file_name, row_count, created_by, created_at, expires_at, owner FROM doa_tb_backup WHERE bu = $1 AND expires_at >= NOW()",
    "SELECT id, bu, period, kind, file_name, row_count, created_by, created_at, expires_at, owner, account FROM doa_tb_backup WHERE bu = $1 AND expires_at >= NOW()")

# 3) get by id
rep("SELECT id, bu, period, kind, file_name, data, expires_at FROM doa_tb_backup WHERE id = $1 AND expires_at >= NOW() AND (owner = $2 OR owner = '')",
    "SELECT id, bu, period, kind, file_name, data, expires_at, account FROM doa_tb_backup WHERE id = $1 AND expires_at >= NOW() AND (owner = $2 OR owner = '')")

# 4) post
rep("    const retCfg = await stSettings();\n    const meOwner = String(req.user.email || \"\").toLowerCase();\n",
    "    const retCfg = await stSettings();\n    const meOwner = String(req.user.email || \"\").toLowerCase();\n    const acct = kind === \"Detail\" ? String(b.account || \"\").trim().slice(0, 50) : \"\"; // " + MARKER + "\n")
rep("WHERE bu = $1 AND period = $2 AND kind = $3 AND owner = $4 AND data = $5::jsonb\", [bu, period, kind, meOwner, JSON.stringify(rows)]);",
    "WHERE bu = $1 AND period = $2 AND kind = $3 AND owner = $4 AND account = $6 AND data = $5::jsonb\", [bu, period, kind, meOwner, JSON.stringify(rows), acct]);")
rep("INSERT INTO doa_tb_backup (bu, period, file_name, row_count, data, created_by, created_at, expires_at, kind, owner)\n       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW(),",
    "INSERT INTO doa_tb_backup (bu, period, file_name, row_count, data, created_by, created_at, expires_at, kind, owner, account)\n       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW(),")
rep("ELSE NOW() + (($7::text) || ' months')::interval END, $8, $9)\n       ON CONFLICT (bu, period, kind, owner) DO UPDATE",
    "ELSE NOW() + (($7::text) || ' months')::interval END, $8, $9, $11)\n       ON CONFLICT (bu, period, kind, owner, account) DO UPDATE")
rep("String(kind === \"Simple\" ? (retCfg.doa_simple_days || 0) : kind === \"Detail\" ? (retCfg.doa_detail_days || 0) : 0)]);",
    "String(kind === \"Simple\" ? (retCfg.doa_simple_days || 0) : kind === \"Detail\" ? (retCfg.doa_detail_days || 0) : 0), acct]);")
# legacy replace: ไม่ลบไฟล์เดิมเมื่อบันทึกแบบ by Account
rep("if ((kind === \"Simple\" || kind === \"Detail\") && meOwner) { const lg", "if ((kind === \"Simple\" || kind === \"Detail\") && meOwner && !acct) { const lg")
rep("    if (kind === \"Simple\" || kind === \"Detail\") {\n      const same", "    if (kind === \"Simple\" || kind === \"Detail\") {\n      const same")
# unchanged-branch legacy delete: ข้ามถ้า by Account
rep("        const lg = await pool.query(\"DELETE FROM doa_tb_backup WHERE bu = $1 AND period = $2 AND kind = $3 AND owner = '' AND LOWER(COALESCE(created_by,'')) = $4\", [bu, period, kind, meOwner]);\n        if (lg.rowCount) await doaReclaimNow();\n        return res.json({ ok: true, id: same.rows[0].id",
    "        const lg = acct ? { rowCount: 0 } : await pool.query(\"DELETE FROM doa_tb_backup WHERE bu = $1 AND period = $2 AND kind = $3 AND owner = '' AND LOWER(COALESCE(created_by,'')) = $4\", [bu, period, kind, meOwner]);\n        if (lg.rowCount) await doaReclaimNow();\n        return res.json({ ok: true, id: same.rows[0].id")

rep("res.json({ items: q.rows, retention_months: DOA_BACKUP_MONTHS });", "res.json({ items: q.rows, retention_months: DOA_BACKUP_MONTHS, by_account: true }); // " + MARKER + " -- Frontend ตรวจว่า Backend รองรับ by Account ก่อนบันทึก (กันทับไฟล์ทั้ง BU)")
if not os.path.exists(p + ".bak"):
    shutil.copy2(p, p + ".bak")
open(p, "w", encoding="utf-8", newline="").write(s)
print("OK:", p)
