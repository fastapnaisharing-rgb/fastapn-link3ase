# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_bucket_fetch_dedupe_v1.py  (Frontend เท่านั้น ผลลัพธ์/ตัวเลขเหมือนเดิม)
1) refreshBucketTax: เดิมยิง vat_backup_tax_invoice (pending) ซ้ำ 2 ครั้งแบบต่อคิว + send_fp (สูงสุด 20000 แถว) ต่อคิวอีก
   -> ยิง send_fp กับ tax_invoice ขนานกัน และใช้ผล tax_invoice ร่วมกัน (เหลือ 2 request ขนาน จากเดิม 3 request ต่อคิว)
2) refreshFpTracked: เดิม pending แล้วค่อย loaded (ต่อคิว) -> ยิงขนานกัน แล้วประมวลผลตามลำดับเดิม (ผลเหมือนเดิม)
3) refreshFpTracked ตอนโหลดครั้งแรก/สลับ BU: รอ secondaryReady (เดิมยิงพร้อมตารางหลัก)
รันที่ my-app:  python patch_vatcontroller_bucket_fetch_dedupe_v1.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
M = "MARKER_BUCKET_FETCH_DEDUPE_V1"
def main():
    base = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if M in txt: print("SKIP already patched"); return
    if "\r\n" in txt: print("ABORT CRLF"); sys.exit(1)
    L = txt.split("\n")
    # --- 1) refreshBucketTax: 2 บรรทัด try ติดกัน
    idx = [i for i, l in enumerate(L) if l.startswith("    try { const fpAll = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(b)}&eq_status=send_fp&select=id,invoice_ref&limit=20000`)")]
    if len(idx) != 1: print("ABORT refreshBucketTax anchor", len(idx)); sys.exit(1)
    i = idx[0]
    if not L[i + 1].startswith("    try { const res = await apiFetch(`/vat_backup_tax_invoice?eq_bu=${encodeURIComponent(b)}&eq_status=pending&select=id,invoice_ref,group_invoice,ref_name&limit=5000`); setBucketTaxCount("):
        print("ABORT refreshBucketTax 2nd line"); sys.exit(1)
    if "vatFpUnpairedRows(fpAll, Array.isArray(taxAll) ? taxAll : [])" not in L[i] or "vatTaxListKey" not in L[i + 1]: print("ABORT body"); sys.exit(1)
    new = [
        "    { /* " + M + " -- ยิง send_fp กับ tax_invoice(pending) ขนานกัน + ใช้ผล tax_invoice ร่วมกัน (เดิมยิงซ้ำ 2 ครั้งต่อคิว) */",
        "      const [fpAll, taxAll] = await Promise.all([",
        "        apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(b)}&eq_status=send_fp&select=id,invoice_ref&limit=20000`).catch(() => null),",
        "        apiFetch(`/vat_backup_tax_invoice?eq_bu=${encodeURIComponent(b)}&eq_status=pending&select=id,invoice_ref,group_invoice,ref_name&limit=5000`).catch(() => null),",
        "      ]);",
        "      try { if (Array.isArray(fpAll)) setBucketCount(vatFpUnpairedRows(fpAll, Array.isArray(taxAll) ? taxAll : []).length); } catch (e) { /* MARKER_BUCKET_INVOICE_TAB_BADGE_V1 ข้าม */ }",
        "      try { if (taxAll !== null) setBucketTaxCount(Array.isArray(taxAll) ? new Set(taxAll.filter((r) => String(r.invoice_ref || r.group_invoice || '').trim()).map(vatTaxListKey)).size : 0); } catch (e) { /* ข้าม */ }",
        "    }",
    ]
    L[i:i + 2] = new
    txt = "\n".join(L)
    # --- 2) refreshFpTracked ขนาน
    O2 = "      for (const st of ['pending', 'loaded']) {\n        const res = await apiFetch(`/vat_backup_tax_invoice?eq_bu=${encodeURIComponent(b)}&eq_status=${st}&limit=5000`);\n"
    N2 = ("      const __fpRes = await Promise.all(['pending', 'loaded'].map((st) => apiFetch(`/vat_backup_tax_invoice?eq_bu=${encodeURIComponent(b)}&eq_status=${st}&limit=5000`))); // " + M + " -- ขนานกัน ประมวลผลลำดับเดิม\n"
          "      for (const [__fi, st] of ['pending', 'loaded'].entries()) {\n        const res = __fpRes[__fi];\n")
    if txt.count(O2) != 1: print("ABORT fpTracked anchor", txt.count(O2)); sys.exit(1)
    txt = txt.replace(O2, N2)
    # --- 3) gate
    O3 = "React.useEffect(() => { refreshFpTracked(); }, [refreshFpTracked, detailReloadKey]);"
    N3 = "React.useEffect(() => { if (!secondaryReady) return; refreshFpTracked(); }, [refreshFpTracked, detailReloadKey, secondaryReady]); // " + M
    if txt.count(O3) != 1: print("ABORT gate anchor", txt.count(O3)); sys.exit(1)
    txt = txt.replace(O3, N3)
    bak = path + ".bak"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)
main()
