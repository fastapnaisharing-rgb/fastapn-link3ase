# -*- coding: utf-8 -*-
"""patch_vatcontroller_type_abf_front_v2  (FRONTEND  src\\pages\\VatController.js)  -- ต่อจาก v1
Popvat A / B / F:
 - ไม่เขียน Note อีก  -> Remark เก็บที่ vat_watchlist_report.remark, สถานะ Pending -> type_a/b/f, วันที่ใช้สิทธิ์เก็บที่ type_receive_date
 - A: กรอก Remark (เหมือนเดิม) + กล่องสรุป "Remark ที่จะบันทึก / เปลี่ยนสถานะ / วันที่ใช้สิทธิ์" ในหน้าต่าง
 - B: กรอก ใช้ไปเมื่อไหร่ / เดือน / จำนวนเงิน (เหมือนเดิม) + กล่องสรุป ; วันที่ใช้สิทธิ์ = วันที่ที่กรอกใน B
 - F: ไม่ต้องกรอกอะไร (ใช้ใบกำกับภาษีที่มีอยู่) กดแล้วมีหน้าต่างยืนยันสรุป Remark(อัตโนมัติ)/สถานะ/วันที่ใช้สิทธิ์ แล้วบันทึก
 - โหมด Type: คอลัมน์ Popvat Type / Remark / วันที่ใช้สิทธิ์ แสดงเสมอ (Note ตั้งใน Config Columns)
 - Clear / ยกเลิก Draft: ล้าง remark ของรายการ Type ด้วย
ต้องรัน patch_vatcontroller_type_abf_front_v1.py ก่อน   รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_TYPE_ABF_V2"
E = []
E.append(("const VAT_INCOMPLETE_ALL_FIELDS = [\n", "const POPVAT_ABF_WRITE_NOTE = false; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V2 -- Popvat A/B/F ไม่เขียน Note แล้ว (Remark เก็บใน Report)\nconst VAT_INCOMPLETE_ALL_FIELDS = [\n", 1))
E.append(("if (['A', 'B', 'F'].includes(popCode) && popRemark) { // MARKER_VATWATCHLISTOPS_QA_POPVAT_SUBMIT_CONDITION_V1", "if (POPVAT_ABF_WRITE_NOTE && ['A', 'B', 'F'].includes(popCode) && popRemark) { // MARKER_VATWATCHLISTOPS_QA_POPVAT_SUBMIT_CONDITION_V1", 1))
E.append(("async (popCode = 'N', popRemark = '') => {", "async (popCode = 'N', popRemark = '', popUseDate = '') => {", 1))
E.append(("const typePut = ['A', 'B', 'F'].includes(popCode) ? { status: `type_${popCode.toLowerCase()}`, type_receive_date: formatQuickActionReceiveDateText(quickActionReceiveDate) || null } : { status: 'draft' };",
          "const typePut = ['A', 'B', 'F'].includes(popCode) ? { status: `type_${popCode.toLowerCase()}`, remark: popRemark || null, type_receive_date: ((popCode === 'B' && popUseDate) ? formatQuickActionReceiveDateText(popUseDate) : formatQuickActionReceiveDateText(quickActionReceiveDate)) || null } : { status: 'draft' }; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V2", 1))
E.append(("handleAddQuickActionData('B', remarkB);", "handleAddQuickActionData('B', remarkB, qaPopBDate);", 1))
# F: ไม่ต้องกรอก -> ยืนยันสรุปแล้วบันทึก
E.append(("onClick={() => { setQaPopMenuOpen(false); setQaPopCondText(''); setQaPopCondMode('F'); setQaPopCondOpen(true); }}",
r"""onClick={async () => { setQaPopMenuOpen(false); const remarkF = `[F - Expired Balance] ใช้ใบกำกับภาษีเลขที่ ${quickActionTaxInvoiceNumber || '-'} ลงวันที่ ${formatQuickActionReceiveDateText(quickActionTaxInvoiceDate) || '-'}`; const okF = await confirmDialog.confirm(`Popvat - F (Expired Balance)\nRemark ที่จะบันทึก: ${remarkF}\nเปลี่ยนสถานะ: Pending → Type F\nวันที่ใช้สิทธิ์ (Receive Date): ${formatQuickActionReceiveDateText(quickActionReceiveDate) || '-'}`, { title: 'ยืนยัน Popvat - F' }); if (okF) handleAddQuickActionData('F', remarkF); }} /* MARKER_VATWATCHLISTOPS_TYPE_ABF_V2 -- F ไม่ต้องกรอก Remark */""", 1))
# A modal: ข้อความ + กล่องสรุป
E.append(("กรอก Remark อธิบายรายละเอียด (จำเป็นต้องกรอก) -- จะบันทึกลง Match Remark ของ Note", "กรอก Remark อธิบายรายละเอียด (จำเป็นต้องกรอก) -- จะบันทึกเป็น Remark ของรายการ", 1))
E.append(("<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}><button type=\"button\" onClick={() => setQaPopCondOpen(false)}",
r"""<div style={{ marginTop: '10px', padding: '8px 10px', background: '#f5f9ff', border: '0.5px solid #cfe0f5', borderRadius: '8px', fontSize: '12px', color: '#34495e', lineHeight: 1.7 }}><div><b>Remark ที่จะบันทึก:</b> {qaPopCondText.trim() || '-'}</div><div><b>เปลี่ยนสถานะ:</b> Pending → Type {qaPopCondMode}</div><div><b>วันที่ใช้สิทธิ์ (Receive Date):</b> {formatQuickActionReceiveDateText(quickActionReceiveDate) || '-'}</div></div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}><button type="button" onClick={() => setQaPopCondOpen(false)}""", 1))
# B modal: ข้อความ + กล่องสรุป
E.append(("ระบบจะรวมเป็น Match Remark ให้เอง", "ระบบจะรวมเป็น Remark ให้เอง วันที่ใช้สิทธิ์ = วันที่ที่ระบุด้านล่าง", 1))
E.append(("<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}><button type=\"button\" onClick={() => setQaPopBOpen(false)}",
r"""<div style={{ marginTop: '12px', padding: '8px 10px', background: '#f5f9ff', border: '0.5px solid #cfe0f5', borderRadius: '8px', fontSize: '12px', color: '#34495e', lineHeight: 1.7 }}><div><b>Remark ที่จะบันทึก:</b> {(qaPopBDate && qaPopBMonth && Number(qaPopBAmount) > 0) ? `[B - Part Used] ส่วนที่เหลือเคยใช้ไปแล้วเมื่อ ${qaPopBDate} (เดือน ${qaPopBMonth}) จำนวน ${Number(qaPopBAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` + (qaPopBExtra.trim() ? ` | ${qaPopBExtra.trim()}` : '') : '-'}</div><div><b>เปลี่ยนสถานะ:</b> Pending → Type B</div><div><b>วันที่ใช้สิทธิ์:</b> {formatQuickActionReceiveDateText(qaPopBDate) || '-'}</div></div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}><button type="button" onClick={() => setQaPopBOpen(false)}""", 1))
# Remark ในตาราง + Clear/Cancel ล้าง remark
E.append(("if (c.key === 'remark') cellValue = (noteEntry && noteEntry.remark) || '';", "if (c.key === 'remark') cellValue = (noteEntry && noteEntry.remark) || row.remark || ''; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V2", 1))
E.append(("status: 'pending', type_receive_date: null", "status: 'pending', type_receive_date: null, remark: null", 3))
# คอลัมน์ในโหมด Type
E.append(("const _typeLeadKeys = ['status', 'remark', 'note', 'type_receive_date'];", "const _typeLeadKeys = ['status', 'remark', 'type_receive_date']; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V2 -- Note ไม่บังคับแล้ว (ตั้งใน Config Columns)", 1))
E.append((".filter((f) => f && (f.key !== 'type_receive_date' || visibleColumns.includes(f.key)))", ".filter(Boolean)", 1))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if "VATWATCHLISTOPS_TYPE_ABF_STATUS_V1" not in s:
        print("ERROR: ต้องรัน patch_vatcontroller_type_abf_front_v1.py ก่อน"); sys.exit(1)
    for a, _, n in E:
        if s.count(a) != n: print("ERROR: anchor พบ %d ครั้ง (ต้อง %d) - ไม่เขียนไฟล์\n%s" % (s.count(a), n, a[:100])); sys.exit(1)
    for a, b, n in E: s = s.replace(a, b)
    for o, c in ("{}", "()", "[]"):
        da = sum((x.count(o) - x.count(c)) * n for x, _, n in E); dn = sum((y.count(o) - y.count(c)) * n for _, y, n in E)
        if da != dn: print("ERROR: bracket %s%s ไม่สมดุล (ก่อน %d / หลัง %d) - ไม่เขียนไฟล์" % (o, c, da, dn)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
