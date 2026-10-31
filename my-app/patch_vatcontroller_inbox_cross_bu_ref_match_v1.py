# -*- coding: utf-8 -*-
"""
patch_vatcontroller_inbox_cross_bu_ref_match_v1.py
Inbox Excel Matching: ใบกำกับภาษีที่ "มี Invoice Ref. (ItemCode/INV#)" แต่หาไม่เจอใน BU ของผู้ซื้อ
(เช่น ผู้ซื้อในใบ = CRG แต่แถว Incomplete ที่มี Ref เดียวกันอยู่ BU SF)
-> ค้น Incomplete (pending) ของ Supplier เดียวกันใน BU อื่น เทียบ Ref + VAT รวม + วันที่
-> เจอชุดเดียวที่ตรง = ขึ้น "ต้องตรวจสอบ" (Step 1 Invoice Ref.) พร้อมเหตุผล "ผู้ซื้อ != BU ของรายการ" ส่ง Bucket ไม่ Pop เอง
เงื่อนไขเริ่มต้น: ต้องมี Invoice Ref. ในไฟล์ (p.lines inbox) ถ้าไม่มี Ref ไม่เข้ากฎนี้
"""
import sys, shutil, os

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_INBOX_CROSS_BU_REF_V1"
ANCHOR = "  { // MARKER_INBOX_MATCH_STEPS_V1 -- ป้าย Step ของการ Match (Inbox)"

JS = r"""  { // MARKER_INBOX_CROSS_BU_REF_V1 -- ใบที่มี Invoice Ref. (ItemCode/INV#) แต่ไม่พบใน BU ของผู้ซื้อ: ค้น Incomplete (pending) ของ Supplier เดียวกันใน BU อื่น เทียบ Ref + VAT รวม + วันที่ -> เจอชุดเดียว = "ต้องตรวจสอบ" (ผู้ซื้อในใบกำกับภาษี != BU ของรายการ) ไม่ Pop เอง
    try {
      const nz = (s) => String(s || '').trim();
      const supCache = new Map();
      const loadSup = async (code) => { if (supCache.has(code)) return supCache.get(code); let rs = []; try { rs = await apiFetch(`/vat_watchlist_report?eq_status=pending&eq_supplier_code=${encodeURIComponent(code)}&limit=20000`); } catch (e) { rs = []; } rs = Array.isArray(rs) ? rs.filter((r) => isArPendingRow(r)) : []; supCache.set(code, rs); return rs; };
      for (let i = 0; i < pdfRows.length; i++) {
        const p = pdfRows[i]; const m = out[i];
        if (!m || m.status !== 'notfound' || !p || p.supplierKey !== 'INBOX' || p.creditNote || p.vat == null) continue;
        if (!p.supplier || !p.supplier.taxId || !Array.isArray(p.lines) || !p.lines[0] || !p.lines[0].inbox) continue; // ต้องมี Invoice Ref. ในไฟล์เท่านั้น
        const refs = new Set(p.lines.map((l) => nz(l.invoiceNo)).filter(Boolean)); if (refs.size === 0) continue;
        const codes = getInboxSellerCodesMap(vendorCategoryByCode).get(`${p.supplier.taxId}|${nz(p.supplier.branch) || '00000'}`); if (!codes || codes.size === 0) continue;
        const buyerBus = (p.buyer && p.buyer.taxId) ? resolveArCollectionCandidateBus(p.buyer.taxId, p.buyer.branch, branches) : [];
        const payDate = p.paymentDate || p.invoiceDate;
        const cands = [];
        for (const c of codes) { (await loadSup(c)).forEach((r) => { if (ctx.usedIds.has(r.id) || buyerBus.includes(nz(r.bu))) return; if (refsOf(r).some((x) => refs.has(x))) cands.push(r); }); }
        if (cands.length === 0) continue;
        const byBu = new Map(); cands.forEach((r) => { const k = nz(r.bu); const a = byBu.get(k); if (a) a.push(r); else byBu.set(k, [r]); });
        const hits = [];
        byBu.forEach((rs, bu) => {
          const sv = round2(rs.reduce((t, r) => t + (Number(r.exp_vat) || 0), 0)); if (Math.abs(sv - Number(p.vat)) > PDFTAXINV_AMOUNT_TOLERANCE) return;
          let gp = 0; for (const r of rs) { const g = pdfTaxInvDayDiff(pdfTaxInvIso(r.payment_date), payDate); if (g === null) return; if (g > gp) gp = g; } if (gp > PDFTAXINV_DATE_TOLERANCE_DAYS) return;
          hits.push({ bu, rs, sv, gp });
        });
        if (hits.length !== 1) { m.reasons = [...(m.reasons || []), `พบ Invoice Ref. เดียวกันใน BU อื่น (${[...byBu.keys()].join('/')}) แต่ VAT รวม/วันที่ไม่ตรง${hits.length > 1 ? ' หรือตรงหลาย BU (กำกวม)' : ''} -> ไม่เลือกให้`]; continue; }
        const h = hits[0];
        h.rs.forEach((r) => ctx.usedIds.add(r.id));
        out[i] = { ...m, status: 'review', matchCase: 1, bu: h.bu, rowObjs: h.rs, rows: h.rs.map(pdfTaxInvRowBrief), supplierCode: nz(h.rs[0].supplier_code), crossBu: true,
          reasons: [`Invoice Ref. ${[...refs].join(', ')} ตรง · VAT รวม ${h.sv.toLocaleString()} ตรง · วันที่ห่าง ${h.gp} วัน แต่ "ผู้ซื้อในใบกำกับภาษี (${buyerBus.join('/') || nz(p.buyer && p.buyer.taxId)}) ≠ BU ของรายการ (${h.bu})" -> ตรวจสอบก่อน (ใบกำกับภาษีต้องออกในนามผู้ที่ขอเครดิตภาษีซื้อ) เปิดดูที่ Bucket แล้ว Confirm เอง`] };
        out[i].row = out[i].rows[0] || null;
      }
    } catch (e) { console.warn('cross-BU ref match failed', e); }
  }
"""

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    c = txt.count(ANCHOR)
    if c != 1:
        print(f"ABORT: ANCHOR found {c} times (need 1)"); sys.exit(1)
    nl = "\r\n" if "\r\n" in txt else "\n"
    shutil.copy2(path, path + ".bak_cross_bu_ref_v1")
    txt = txt.replace(ANCHOR, JS.replace("\n", nl) + ANCHOR)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
