# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_inbox_branch_mismatch_ref_all_v1.py
Inbox Excel: ใบกำกับภาษีมี Invoice Ref (ItemCode) + VAT รวม Payment Doc ตรง + ทุก Ref ใน Payment Doc อยู่ในใบนี้ครบ
แต่สาขาผู้ซื้อ (เช่น 00117) ไม่ตรงสาขา Incomplete (เช่น 057001 = สำนักงานใหญ่) -> ให้ขึ้น Exact Match ด้วย Ref แต่ไม่ Pop อัตโนมัติ -> ส่งเข้า Full Page Bucket ให้ตัดสินใจ
ตามกฎ: ถ้ามี Invoice Ref ต้อง Match ด้วย Ref ให้ได้ ไม่ว่าด้วยวิธีไหน
รันที่ my-app:  python patch_vatcontroller_inbox_branch_mismatch_ref_all_v1.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_INBOX_BRANCH_MISMATCH_REF_ALL_V1"
OLD = "res.status = 'review'; res.matchCase = 2; res.rowObjs = h.rs0; res.rows = h.rs0.map(pdfTaxInvRowBrief); res.row = res.rows[0] || null; res.supplierCode = norm(h.rs0[0].supplier_code); res.reasons.push(`ยอด VAT ตรง Payment Doc"
NEW = ("const __refAll = (() => { try { const lc = new Set((pdf.lines || []).filter((l) => l && l.inbox).map((l) => String(l.invoiceNo))); if (lc.size === 0) return false; const rr = new Set(); h.rs0.forEach((r) => refsOf(r).forEach((x) => rr.add(x))); return rr.size > 0 && [...rr].every((x) => lc.has(x)); } catch (e) { return false; } })(); /* " + MARKER + " -- Ref ทุกตัวใน Payment Doc อยู่ในใบกำกับภาษีครบ + VAT รวมตรง แต่สาขาต่าง (เช่น Incomplete สำนักงานใหญ่) = Match ด้วย Ref */ "
       "res.status = 'review'; res.matchCase = 2; res.rowObjs = h.rs0; res.rows = h.rs0.map(pdfTaxInvRowBrief); res.row = res.rows[0] || null; res.supplierCode = norm(h.rs0[0].supplier_code); if (__refAll) res.reasons.push('Invoice Ref. ครบทุกตัวใน Payment Doc ' + h.k.split('|')[0] + ' และ VAT รวมตรง (สาขา Incomplete ' + ([...new Set(h.rs0.map((r) => norm(r.branch)))].join('/') || '—') + ' ≠ ผู้ซื้อ ' + (norm(pdf.buyer.branch) || '—') + ') -> Exact Match ด้วย Invoice Ref. (Ref ครบ + VAT ตรง) แต่สาขาต่างกัน: ส่งเข้า Full Page Bucket ให้ตัดสินใจ ไม่ Pop อัตโนมัติ'); else res.reasons.push(`ยอด VAT ตรง Payment Doc")
def main():
    base = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(base, TARGET)
    with open(path, "rb") as f: raw = f.read()
    txt = raw.decode("utf-8")
    if MARKER in txt: print("SKIP already patched"); return
    crlf = "\r\n" in txt
    c = txt.count(OLD)
    if c != 1: print(f"ABORT anchor count={c}"); sys.exit(1)
    out = txt.replace(OLD, NEW)
    bak = path + ".bak"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    with open(path, "wb") as f: f.write(out.encode("utf-8"))
    print("OK patched ->", path)
main()
