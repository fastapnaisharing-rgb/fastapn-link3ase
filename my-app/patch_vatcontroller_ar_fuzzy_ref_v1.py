# -*- coding: utf-8 -*-
"""
patch_vatcontroller_ar_fuzzy_ref_v1.py

ปัญหา: Invoice Ref. ใน Incomplete กรอกผิด/ตกหล่น -> Tier 1/2 (Key ตรงตัว) ไม่ติด, Tier 3 ต้องยอดเท่ากัน (ไฟล์ Partial ยอดไม่เท่า)
วิธีแก้: เพิ่ม Tier 4 "Fuzzy Ref" ใน AR_Collection Matching (src/pages/VatController.js)
  - ต้องเป็น BU เดียวกัน (Incomplete ของ BU ที่ผูกกับลูกค้า AR อยู่แล้ว) + แถว Pending + Supplier ตรง (Tax ID + สาขาผู้ขาย)
  - Ref ของ AR (TRX_NUMBER) เทียบกับ Original Invoice Ref. ของ Incomplete (รวมรูปแบบตัด Prefix/ท่อน) ความเหมือน >= 80% (1 - Levenshtein/ความยาวสูงสุด)
  - ต้องยืนยันด้วยยอดเงินด้วย: ยอดรวม (Amount+VAT) หรือ VAT ของ Incomplete ตรงกับฝั่ง AR ภายใน Tolerance ไม่ตรง = ไม่จับคู่
  - ต้องยืนยันด้วยวันที่ชำระด้วย: payment_date ของ Incomplete ห่างจาก Document Date ของ AR ไม่เกิน 7 วัน (ไม่มีวันที่ = ไม่ยืนยัน) -- ปรับที่ AR_FUZZY_DATE_DAYS
  - ถ้ามีหลายแถวคะแนนเท่ากัน = กำกวม -> ไม่เลือก
  - ผลลัพธ์เป็น "ต้องตรวจสอบ" (matched_needs_review -> Backup) เสมอ ไม่ขึ้น Match/Draft เอง
  - ข้าม Fuzzy ใน Flow CRG ข้าม BU (skipTier3) -> BU-first ยังเหมือนเดิม
วิธีใช้: วางไว้ที่ my-app (ระดับเดียวกับ src) แล้วรัน  python patch_vatcontroller_ar_fuzzy_ref_v1.py
"""
import os
import shutil
import sys

MARKER = 'MARKER_ARCOLLECTION_FUZZY_REF_V1'
BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'src', 'pages', 'VatController.js')

HELPER = r"""// MARKER_ARCOLLECTION_FUZZY_REF_V1 -- Tier 4: Ref ใน Incomplete พิมพ์ผิด/ตกหล่น -> เทียบความเหมือน >= 80% (ต้อง BU + Supplier ตรง) -> ต้องตรวจสอบเสมอ
const AR_FUZZY_REF_MIN_SIM = 0.8;
const AR_FUZZY_DATE_DAYS = 7; // วันที่ชำระของ Incomplete ต้องห่างจาก Document Date ของ AR ไม่เกินกี่วัน (เท่า Inbox/PDF)
const __arTaxCodesCache = new WeakMap();
function arLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  let prev = new Array(n + 1); let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
function arRefSimilarity(a, b) {
  if (!a || !b) return 0;
  const mx = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / mx > 0.2) return 0;
  return 1 - arLevenshtein(a, b) / mx;
}
function arFuzzyRefMatch(arInvoice, targetRef, index, vendorCategoryByCode, mo) {
  const norm = (s) => String(s || '').trim();
  const N = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const taxId = norm(arInvoice.sellerTaxId);
  if (!taxId) return null;
  let byTax = __arTaxCodesCache.get(vendorCategoryByCode);
  if (!byTax) {
    byTax = new Map();
    Object.entries(vendorCategoryByCode || {}).forEach(([code, v]) => { const t = norm(v && v['TAX ID']); if (!t) return; if (!byTax.has(t)) byTax.set(t, []); byTax.get(t).push(code); });
    __arTaxCodesCache.set(vendorCategoryByCode, byTax);
  }
  const target = N(targetRef);
  if (target.length < 8) return null;
  const targetAmount = round2(arInvoice.netAfterSc != null ? arInvoice.netAfterSc : arInvoice.gross);
  const cands = [];
  for (const code of (byTax.get(taxId) || [])) {
    for (const row of (index.bySupplier.get(norm(code)) || [])) {
      if (!isArPendingRow(row)) continue;
      if (mo && mo.usedIds && row.id != null && mo.usedIds.has(row.id)) continue;
      if (!arVendorMatchOk({ incompleteRow: row, sellerTaxId: arInvoice.sellerTaxId, sellerBranchId: arInvoice.sellerBranchId }, vendorCategoryByCode)) continue;
      const __rv = refVariantsOfStr(row.invoice_ref, row.bu);
      if (mo && mo.exactKeys && __rv.some((v) => v.length >= 8 && mo.exactKeys.has(v))) continue; // MARKER_ARCOLLECTION_FUZZY_REF_V1 -- แถว Incomplete ที่มีคู่ Ref ตรงตัวอยู่ในไฟล์ AR นี้แล้ว = เป็นของใบนั้น ห้าม Fuzzy ของใบอื่นแย่งไป
      let best = 0;
      for (const v of __rv) { const s = arRefSimilarity(target, N(v)); if (s > best) best = s; }
      if (best < AR_FUZZY_REF_MIN_SIM) continue;
      const rowTotal = round2((Number(row.exp_amount) || 0) + (Number(row.exp_vat) || 0));
      const totalOk = Math.abs((rowTotal || 0) - (targetAmount || 0)) <= AR_MATCH_AMOUNT_TOLERANCE;
      const rowVatAbs = Math.abs(round2(Number(row.exp_vat) || 0) || 0);
      const arVatAbs = Math.abs(computeArCollectionAmounts(arInvoice).vatValue || 0);
      const vatOk = Math.abs(rowVatAbs - arVatAbs) <= AR_MATCH_AMOUNT_TOLERANCE;
      const amtOk = totalOk || vatOk;
      if (!amtOk) continue; // MARKER_ARCOLLECTION_FUZZY_REF_V1 -- ต้องยืนยันด้วยยอดเงินด้วย (ยอดรวม หรือ VAT ตรงภายใน Tolerance) ไม่งั้นไม่จับคู่
      const dateGap = pdfTaxInvDayDiff(pdfTaxInvIso(row.payment_date), pdfTaxInvIso(arInvoice.docDateIso)); // วันที่ชำระของ Incomplete เทียบกับ Document Date ของ AR
      if (dateGap === null || dateGap > AR_FUZZY_DATE_DAYS) continue; // MARKER_ARCOLLECTION_FUZZY_REF_V1 -- ต้องยืนยันด้วยวันที่ชำระด้วย (ไม่มีวันที่ = ไม่ยืนยัน)
      cands.push({ row, sim: best, amtOk, totalOk, vatOk, dateGap, score: best + (totalOk ? 0.05 : 0) - dateGap * 0.001 });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((x, y) => y.score - x.score);
  if (cands.length > 1 && cands[1].score === cands[0].score) return null; // กำกวม -> ไม่เลือกให้
  const b = cands[0];
  return { tier: 4, fuzzy: true, fuzzySim: Math.round(b.sim * 100), incompleteRow: b.row, reason: `Ref คล้ายกัน ${Math.round(b.sim * 100)}% (>= 80%) · BU + Supplier ตรง · ${b.totalOk ? 'ยอดรวมตรง' : 'VAT ตรง'} · วันที่ชำระห่าง ${b.dateGap} วัน -> ต้องตรวจสอบ (Ref ใน Incomplete อาจพิมพ์ผิด)` };
}
"""

FUNC_ANCHOR = "function matchArInvoiceToIncomplete(arInvoice, incompleteRows, vendorCategoryByCode, opts) {"

CALL_OLD = "  if (weakKeyHit) return { tier: weakKeyHit.tier, incompleteRow: weakKeyHit.incompleteRow,"
CALL_NEW = (
    "  if (!weakKeyHit && !mo.skipTier3 && targetRef) { const fzHit = arFuzzyRefMatch(arInvoice, targetRef, index, vendorCategoryByCode, mo); if (fzHit) return fzHit; } // " + MARKER + " -- Tier 4\n"
    + CALL_OLD
)

PAIRS = [
    ('helper', FUNC_ANCHOR, HELPER + FUNC_ANCHOR),
    ('call Tier 4', CALL_OLD, CALL_NEW),
    ('exact key set',
     "  const skippedZeroGrossCount = withGross.length - exportableRows.length;\n",
     "  const skippedZeroGrossCount = withGross.length - exportableRows.length;\n  const arExactKeySet = new Set(); exportableRows.forEach((r) => { [r.trxNumber, r.docNum, r.groupInvoice].forEach((k) => { const kk = norm(k); if (kk) arExactKeySet.add(kk); }); }); // " + MARKER + " -- ทุก Key ตรงตัวของไฟล์ AR นี้ (กัน Fuzzy แย่งแถวที่มีคู่ตรงตัวแล้ว)\n"),
    ('m3opts exactKeys',
     "const m3opts = { usedIds: usedTier3Ids, preferBranchCodes: candCodes, groupRanges };",
     "const m3opts = { usedIds: usedTier3Ids, preferBranchCodes: candCodes, groupRanges, exactKeys: arExactKeySet }; // " + MARKER),
    ('used ids add',
     "if (matchResult && matchResult.tier === 3 && matchResult.incompleteRow && matchResult.incompleteRow.id != null) usedTier3Ids.add(",
     "if (matchResult && (matchResult.tier === 3 || matchResult.tier === 4) && matchResult.incompleteRow && matchResult.incompleteRow.id != null) usedTier3Ids.add("),
    ('used ids delete',
     "if (matchResult.tier === 3 && matchResult.incompleteRow && matchResult.incompleteRow.id != null) usedTier3Ids.delete(",
     "if ((matchResult.tier === 3 || matchResult.tier === 4) && matchResult.incompleteRow && matchResult.incompleteRow.id != null) usedTier3Ids.delete("),
    ('ready flag',
     "const ready = leg2Ok && branchOk !== false && leg1Status !== 'mismatch';",
     "const ready = leg2Ok && branchOk !== false && leg1Status !== 'mismatch' && !matchResult.fuzzy; // " + MARKER + " -- Fuzzy Ref = ต้องตรวจสอบเสมอ"),
    ('review reason',
     "if (leg1Status === 'mismatch') reviewReasons.push('Gross ใน Backup ไม่ตรง');",
     "if (leg1Status === 'mismatch') reviewReasons.push('Gross ใน Backup ไม่ตรง');\n    if (matchResult.fuzzy) reviewReasons.unshift(`Ref คล้ายกัน ${matchResult.fuzzySim}% (Incomplete: ${norm(matchResult.incompleteRow.invoice_ref)} ≠ AR: ${norm(inv.trxNumber || inv.docNum)})`); // " + MARKER),
]


def main():
    if not os.path.isfile(TARGET):
        print('ไม่พบไฟล์:', TARGET); sys.exit(1)
    with open(TARGET, 'r', encoding='utf-8', newline='') as f:
        src = f.read()
    if MARKER in src:
        print('ข้าม: Patch ไปแล้ว (%s)' % MARKER); return
    crlf = '\r\n' in src
    out = src
    for name, old, new in PAIRS:
        if crlf:
            old = old.replace('\r\n', '\n').replace('\n', '\r\n'); new = new.replace('\r\n', '\n').replace('\n', '\r\n')
        n = out.count(old)
        if n != 1:
            print('หยุด: จุด "%s" พบ Anchor %d ที่ (ต้องเจอ 1 ที่) -> ไม่เขียนไฟล์' % (name, n)); sys.exit(2)
        out = out.replace(old, new, 1)
        print('OK  :', name)
    for o, c in ('()', '{}', '[]'):
        if (out.count(o) - src.count(o)) != (out.count(c) - src.count(c)):
            print('หยุด: Bracket %s%s ไม่สมดุลหลังแก้ -> ไม่เขียนไฟล์' % (o, c)); sys.exit(3)
    bak = TARGET + '.bak_fuzzyref_v1'
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak); print('สำรองไว้ที่:', bak)
    with open(TARGET, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('เสร็จ: แก้ %d จุด' % len(PAIRS))


if __name__ == '__main__':
    main()
