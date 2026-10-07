# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1
# Export Reconcile (Template 100% / 100%+Simple) ให้เหมือนไฟล์ Excel ต้นฉบับ: 5 ชีต Cover/ReportVat_VGR/Detail/TB/Pivot + สูตรเดียวกัน
#   1) vatReconcile.js          : reconcile-report ส่ง header.companyEn + TB เพิ่ม account/beginning_balance/period_activity
#   2) vatReconcileReportFiles.js: import vatReconcileOriginalWorkbook.js และใช้แทน buildReconcileWorkbook เมื่อ template != "avg"
#   (ไฟล์ใหม่ vatReconcileOriginalWorkbook.js ต้องวางไว้โฟลเดอร์เดียวกัน -- ส่งให้เป็นไฟล์เต็ม)
# ใช้: python patch_vatreconcile_original_workbook_back_v6.py <routes\vatReconcile.js> <routes\vatReconcileReportFiles.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1"
p1 = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
p2 = sys.argv[2] if len(sys.argv) > 2 else r"C:\apps\fastapn-backend\src\routes\vatReconcileReportFiles.js"

def load(p):
    raw = open(p, "rb").read().decode("utf-8")
    return raw, raw.replace("\r\n", "\n")

def rep(s, old, new, label):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] {label}: anchor พบ {c} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
    return s.replace(old, new)

def save(p, raw, s):
    n = 1
    while os.path.exists(f"{p}.bak{n:02d}"): n += 1
    shutil.copy2(p, f"{p}.bak{n:02d}")
    out = s.replace("\n", "\r\n") if "\r\n" in raw else s
    open(p, "wb").write(out.encode("utf-8"))
    print(f"[OK] patched {p} (backup .bak{n:02d})")

# ---- 1) vatReconcile.js ----
raw1, s1 = load(p1)
if MARKER in s1:
    print("[SKIP] vatReconcile.js ถูก patch แล้ว")
else:
    s1 = rep(s1,
        "`SELECT branch, cpc, subacc, description, ending_balance::float8 AS ending_balance\n         FROM vat_reconcile_tb WHERE bu = $1 AND account = $2 AND period = $3`",
        "`SELECT branch, cpc, account, subacc, description, beginning_balance::float8 AS beginning_balance, period_activity::float8 AS period_activity, ending_balance::float8 AS ending_balance\n         FROM vat_reconcile_tb WHERE bu = $1 AND account = $2 AND period = $3`",
        "tbQ")
    s1 = rep(s1, "    let companyTaxId = null;\n", "    let companyTaxId = null;\n    let companyNameEn = null; // " + MARKER + "\n", "companyNameEn decl")
    s1 = rep(s1, "          if (tk && c[tk]) companyTaxId = String(c[tk]).trim();\n",
        "          if (tk && c[tk]) companyTaxId = String(c[tk]).trim();\n"
        "          const enKey = reconPickKey(c, /company.*name|^name$/i, /thai|บริษัท/i);\n"
        "          if (enKey && c[enKey]) companyNameEn = String(c[enKey]).trim();\n", "companyNameEn read")
    s1 = rep(s1, "        taxId: companyTaxId || \"\",\n", "        taxId: companyTaxId || \"\",\n        companyEn: companyNameEn || \"\",\n", "header.companyEn")
    save(p1, raw1, s1)

# ---- 2) vatReconcileReportFiles.js ----
raw2, s2 = load(p2)
if MARKER in s2:
    print("[SKIP] vatReconcileReportFiles.js ถูก patch แล้ว")
else:
    s2 = rep(s2, 'import { pool, getUsernameByEmail } from "../db.js";\n',
        'import { pool, getUsernameByEmail } from "../db.js";\nimport { buildOriginalWorkbook } from "./vatReconcileOriginalWorkbook.js"; // ' + MARKER + '\n', "import")
    s2 = rep(s2, "      const wb = await buildReconcileWorkbook(rep, bu, period);\n",
        "      // " + MARKER + " -- Template 100% / 100%+Simple = Layout ไฟล์ต้นฉบับ (5 ชีต + สูตร) | AVG ใช้ของเดิม\n"
        "      const preparedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : \"\";\n"
        "      const wb = rep.template === \"avg\" ? await buildReconcileWorkbook(rep, bu, period) : buildOriginalWorkbook(rep, bu, period, { preparedBy, exportDate: new Date() });\n", "wb build")
    save(p2, raw2, s2)
