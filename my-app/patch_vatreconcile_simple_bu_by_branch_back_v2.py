# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_BU_BY_BRANCH_V2
# Simple Report (preview + commit): หา BU จาก "รหัสสาขา" ในไฟล์ (เช่น 056101) โดยเทียบตรงๆ กับ branch_list ก่อน
# แล้วค่อย Fallback ไปใช้ "Bu Code" ในหัวไฟล์ (เดิมใช้แค่ Bu Code -> ไฟล์ที่เขียน ODP ขึ้น "ไม่พบ BU ODP ในระบบ")
# ใช้: python patch_vatreconcile_simple_bu_by_branch_back_v2.py <path ของ routes\vatReconcile.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SIMPLE_BU_BY_BRANCH_V2"
def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์"); sys.exit(1)
    return src.replace(old, new)
path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)

helper = '''/**
 * ''' + MARKER + '''
 * หา BU (เลข) ของไฟล์ Simple Report: เทียบ "รหัสสาขา" ในไฟล์กับ branch_list ตรงๆ ก่อน (เฉพาะที่ตรงใน branch_list จริง)
 * ไม่เจอค่อยใช้ "Bu Code" ในหัวไฟล์ (resolveBuToNumeric) -- คืน null ถ้าทั้งสองทางหาไม่เจอ
 */
async function resolveSimpleBu(headerCommon, branches) {
  const cands = [headerCommon.primaryBranch, ...(branches || []).map((b) => b.branch)]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const br of [...new Set(cands)]) {
    const direct = await pool.query(
      `SELECT cl."COMPANY CODE" AS company_code
       FROM branch_list bl
       JOIN company_list cl ON cl.bu = bl.bu
       WHERE bl."Branch Code" = $1 AND bl.deleted IS NOT TRUE
       LIMIT 1`,
      [br]
    );
    const numericBu = (direct.rows[0]?.company_code || "").split("-")[2];
    if (numericBu) return numericBu;
  }
  return resolveBuToNumeric(headerCommon.bu);
}

/**
 * POST /vat-reconcile/simple/preview'''
src = safe_replace(src, "/**\n * POST /vat-reconcile/simple/preview", helper, "helper")

src = safe_replace(src,
    "    const numericBu = await resolveBuToNumeric(headerCommon.bu);\n\n    const branchSummaries = branches.map(",
    "    const numericBu = await resolveSimpleBu(headerCommon, branches); // " + MARKER + "\n\n    const branchSummaries = branches.map(",
    "preview")
src = safe_replace(src,
    "    const numericBu = await resolveBuToNumeric(headerCommon.bu);\n    if (!numericBu) {\n      return res.status(422).json({ error: `ไม่พบ BU \"${headerCommon.bu}\" ในระบบ (แปลงเป็นเลข BU ไม่ได้)` });",
    "    const numericBu = await resolveSimpleBu(headerCommon, branches); // " + MARKER + "\n    if (!numericBu) {\n      return res.status(422).json({ error: `ไม่พบ BU \"${headerCommon.bu}\" / สาขา \"${headerCommon.primaryBranch || ''}\" ในระบบ (แปลงเป็นเลข BU ไม่ได้)` });",
    "commit")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
