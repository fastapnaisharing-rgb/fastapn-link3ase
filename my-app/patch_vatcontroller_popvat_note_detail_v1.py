# -*- coding: utf-8 -*-
"""patch_vatcontroller_popvat_note_detail_v1
Quick Action Popvat - A / B / F: Note ที่บันทึกให้ละเอียดขึ้น ตามรอยใบกำกับภาษีย้อนหลังได้
เพิ่มลงข้อความ Note: ใช้ไปเมื่อ (วัน-เวลา + ผู้ทำ) / Supplier (ชื่อ + รหัส) / Invoice Ref / Period / GRN ที่ Popvat /
Tax Invoice + วันที่ / ยอดมูลค่า-ภาษี / Draft ID   (match_remark ยังเก็บเฉพาะเหตุผลเดิม ไม่กระทบที่อื่น)
รันที่โฟลเดอร์ my-app:  python patch_vatcontroller_popvat_note_detail_v1.py  แล้ว npm run build
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_QA_POPVAT_NOTE_DETAIL_V1"

A1 = "            const notePayloadA = { bu: bu?.bu, invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, note: popRemark, remark:"
N1 = '''            // MARKER_VATWATCHLISTOPS_QA_POPVAT_NOTE_DETAIL_V1 -- Note ละเอียด: ใช้ไปเมื่อไหร่ / Supplier / GRN / Tax Invoice / ยอด / Draft ID (ตามรอยใบกำกับภาษีได้)
            const labelPopQA = ({ A: 'A - Submit with Condition', B: 'B - Part Used', F: 'F - Expired Balance' })[popCode];
            const grnPopQA = (grtCombined && (popCode === 'A' || popCode === 'B')) ? `${grtCombined}${popCode}` : ((grtCombined && popCode === 'F') ? `${grtCombined}F${String(quickActionVatPeriodMonth || '').slice(2, 4)}` : (grtCombined || '-'));
            const nowPopQA = new Date();
            const p2PopQA = (n) => String(n).padStart(2, '0');
            const usedAtPopQA = `${p2PopQA(nowPopQA.getDate())}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][nowPopQA.getMonth()]}-${String(nowPopQA.getFullYear()).slice(2)} ${p2PopQA(nowPopQA.getHours())}:${p2PopQA(nowPopQA.getMinutes())}`;
            const fmPopQA = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const noteTxtPopQA = [
              `[${labelPopQA}]`,
              `เหตุผล: ${popRemark}`,
              `ใช้ไปเมื่อ (Popvat): ${usedAtPopQA} โดย ${username || '-'}`,
              `Supplier: ${row.vendor_name || '-'} (${row.supplier_code || '-'})`,
              `Invoice Ref.: ${row.invoice_ref || '-'}`,
              `Period ที่ Popvat: ${formatQuickActionPeriodMMYYYY(quickActionPeriodMonth) || '-'}`,
              `GRN ที่ Popvat: ${grnPopQA}`,
              `Tax Invoice: ${quickActionTaxInvoiceNumber || '-'} (ลงวันที่ ${formatQuickActionReceiveDateText(quickActionTaxInvoiceDate) || '-'})`,
              `ยอด: มูลค่า ${fmPopQA(row.exp_amount)} / ภาษี ${fmPopQA(row.exp_vat)}`,
              `Draft ID: ${draftId}`,
            ].join('\\n');
            const notePayloadA = { bu: bu?.bu, invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, note: noteTxtPopQA, remark:'''

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if s.count(A1) != 1:
        print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์" % s.count(A1)); sys.exit(1)
    s = s.replace(A1, N1)
    for a, b in ("{}", "()", "[]"):  # โค้ดที่แทรกต้องมีส่วนต่างวงเล็บเท่ากับ Anchor เดิม (ไฟล์ใหญ่ มี Regex/String จึงเทียบเฉพาะส่วนที่แก้)
        if (N1.count(a) - N1.count(b)) != (A1.count(a) - A1.count(b)):
            print("ERROR: bracket %s%s ในโค้ดที่แทรกไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
