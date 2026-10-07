# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_FLAT_BACK_V11
# Simple Excel BU ให้ตรง Original: ส่ง simple_type ใน groups, Tax ID/Branch ศูนย์ล้วน -> "0", หัวตารางสูง 2 บรรทัด, แถวรวมสุทธิไม่มีเส้นคู่
import sys, shutil, os
M = "MARKER_VATRECONCILE_SIMPLE_FLAT_BACK_V11"
def rd(p):
    b = open(p, "rb").read(); return b.decode("utf-8").replace("\r\n", "\n"), b"\r\n" in b
def wr(p, s, crlf): open(p, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
def bak(p):
    n = 1
    while os.path.exists("%s.bak%02d" % (p, n)): n += 1
    shutil.copy2(p, "%s.bak%02d" % (p, n))
def rep(s, old, new):
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    return s.replace(old, new)

p = "vatReconcileOriginalWorkbook.js"; s, c = rd(p)
if M not in s:
    bak(p)
    s = rep(s, """    sw.addRow(sh).eachCell(""", """    const zn = (v) => (/^0+$/.test(String(v == null ? "" : v).trim()) ? "0" : v); // """ + M + """
    sw.addRow(sh).eachCell(""")
    s = rep(s, "d.tax_id, d.branch_field, d.item_detail, d.paid_amount, d.paid_vat, d.claimed_amount, d.claimed_vat, d.claim_percent != null", "zn(d.tax_id), zn(d.branch_field), d.item_detail, d.paid_amount, d.paid_vat, d.claimed_amount, d.claimed_vat, d.claim_percent != null")
    s = rep(s, """c.border = bd("thin", "thin", "double", "thin"); if (i >= 11 && i <= 14) c.numFmt = NUM2; });
    }""", """c.border = ALL_THIN; if (i >= 11 && i <= 14) c.numFmt = NUM2; });
    }
    sw.getRow(1).height = 30;""")
    wr(p, s, c); print("OK", p)
else: print("skip", p)

p = "vatReconcile.js"; s, c = rd(p)
if M not in s:
    bak(p)
    s = rep(s, "SELECT h.branch, h.report_title, h.report_id,", "SELECT h.branch, h.simple_type, h.report_title, h.report_id,")
    s = rep(s, "id: r.id, running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date,\n              tax_invoice_no:", "id: r.id, simple_type: r.simple_type, running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date, // " + M + "\n              tax_invoice_no:")
    wr(p, s, c); print("OK", p)
else: print("skip", p)
