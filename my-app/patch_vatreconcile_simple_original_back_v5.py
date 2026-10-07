# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_BACK_V5
# GET /vat-reconcile/dashboard/report (type=simple_100|simple_avg, view=detail): เพิ่ม "groups" = หัวรายงาน + แถวแยกตามสาขา
# (ให้ Frontend วาด Layout เหมือนไฟล์ Simple Report ต้นฉบับ) -- rows เดิมไม่เปลี่ยน ผู้ใช้อื่นของ Endpoint นี้ไม่กระทบ
# ใช้: python patch_vatreconcile_simple_original_back_v5.py <path routes\vatReconcile.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_BACK_V5"
path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
old = "        return res.json({ type, view, branch: branchFilter, rows });\n"
if src.count(old) != 1:
    print(f"[ABORT] anchor พบ {src.count(old)} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
new = """        // """ + MARKER + """ -- หัวรายงาน + แถวแยกตามสาขา สำหรับวาด Layout ต้นฉบับ
        const gq = await pool.query(
          `SELECT h.branch, h.report_title, h.report_id, h.print_date::text AS print_date, h.print_by, h.operator_name,
                  h.address_line1, h.address_line2, h.address_line3, h.company_tax_id, h.branch_no,
                  d.running_no, d.receive_date::text AS receive_date, d.tax_invoice_date::text AS tax_invoice_date,
                  d.tax_invoice_no, d.tax_id, d.vendor_name, d.branch_field, d.item_detail,
                  d.paid_amount::float8 AS paid_amount, d.paid_vat::float8 AS paid_vat,
                  d.claimed_amount::float8 AS claimed_amount, d.claimed_vat::float8 AS claimed_vat,
                  d.claim_percent::float8 * 100 AS claim_percent
           FROM vat_reconcile_simple_header h
           LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
           WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3 AND h.simple_type = $4${branchClause}
           ORDER BY h.branch, d.receive_date, d.running_no`,
          params
        );
        const groups = [];
        const byBranch = new Map();
        for (const r of gq.rows) {
          let g = byBranch.get(r.branch);
          if (!g) {
            g = {
              branch: r.branch,
              header: {
                report_title: r.report_title, report_id: r.report_id, print_date: r.print_date, print_by: r.print_by,
                operator_name: r.operator_name, address_line1: r.address_line1, address_line2: r.address_line2,
                address_line3: r.address_line3, company_tax_id: r.company_tax_id, branch_no: r.branch_no,
              },
              rows: [],
            };
            byBranch.set(r.branch, g);
            groups.push(g);
          }
          if (r.running_no != null || r.receive_date != null) {
            g.rows.push({
              running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date,
              tax_invoice_no: r.tax_invoice_no, tax_id: r.tax_id, vendor_name: r.vendor_name, branch_field: r.branch_field,
              item_detail: r.item_detail, paid_amount: r.paid_amount, paid_vat: r.paid_vat,
              claimed_amount: r.claimed_amount, claimed_vat: r.claimed_vat, claim_percent: r.claim_percent,
            });
          }
        }
        return res.json({ type, view, branch: branchFilter, rows, groups });
"""
src = src.replace(old, new)
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
