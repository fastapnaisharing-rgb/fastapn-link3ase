# -*- coding: utf-8 -*-
"""patch_vatcontroller_type_abf_front_v3  (FRONTEND  src\\pages\\VatController.js)  -- ต่อจาก v1, v2
โหมด Type (ตามที่ผู้ใช้กำหนด):
 - คอลัมน์ตายตัว 14 ช่อง + Status: Popvat Type, Remark, Note, Branch, ใบแจ้งหนี้, Supplier Code, ชื่อผู้ค้า, ชำระเงิน, เช็ค, เลขที่เช็ค,
   Receive Doc., เลขที่ GRT, มูลค่าสินค้า, เงินภาษี, Status (ท้ายสุด: ป้าย Type A/B/F + ปุ่ม Clear ทุกบรรทัด)
 - ไม่ใช้ Config Columns (ซ่อนปุ่มในโหมด Type) / เอาปุ่ม Clear ด้านบนออก
รันที่โฟลเดอร์ my-app แล้ว npm run build   (ต้องรัน v1, v2 ก่อน)
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_TYPE_ABF_V3"
E = []
E.append(("async () => { // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- Clear", "async (rowsArg) => { // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- Clear", 1))
E.append(("const targets = Array.from(selectedNoteRows.values()).filter((r) => /^type_[abf]$/.test(r.status));", "const targets = (Array.isArray(rowsArg) ? rowsArg : Array.from(selectedNoteRows.values())).filter((r) => /^type_[abf]$/.test(r.status)); // MARKER_VATWATCHLISTOPS_TYPE_ABF_V3", 1))
E.append(("marginLeft: showDetailMode === 'type' ? '8px' : 'auto'", "marginLeft: 'auto'", 1))
E.append(("setShowConfigModal(true)} style={{ padding: '6px 12px',", "setShowConfigModal(true)} style={{ display: showDetailMode === 'type' ? 'none' : undefined, padding: '6px 12px',", 1))
E.append(("                        const isVendorNameColFP = c.key === 'vendor_name'; // MARKER_VATWATCHLISTOPS_INCOMPLETE_VENDORNAME_FIXED_WIDTH_V1\n",
r"""                        if (c.key === 'type_action') { // MARKER_VATWATCHLISTOPS_TYPE_ABF_V3 -- คอลัมน์ Status ท้ายสุดของโหมด Type: ป้าย Type + ปุ่ม Clear ทุกบรรทัด
                          return (
                            <td key={c.key} style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#1a3a5c', background: '#e8f0fb', borderRadius: '10px', padding: '2px 9px', marginRight: '8px' }}>{({ type_a: 'Type A', type_b: 'Type B', type_f: 'Type F' })[row.status] || row.status || ''}</span>
                              <button type="button" onClick={() => handleClearTypeRows([row])} style={{ padding: '2px 10px', fontSize: '11px', border: '0.5px solid #e57373', borderRadius: '6px', background: '#fdecea', color: '#c62828', cursor: 'pointer' }}>Clear</button>
                            </td>
                          );
                        }
                        const isVendorNameColFP = c.key === 'vendor_name'; // MARKER_VATWATCHLISTOPS_INCOMPLETE_VENDORNAME_FIXED_WIDTH_V1
""", 1))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if "VATWATCHLISTOPS_TYPE_ABF_V2" not in s:
        print("ERROR: ต้องรัน patch_vatcontroller_type_abf_front_v1.py และ v2 ก่อน"); sys.exit(1)
    for a, _, n in E:
        if s.count(a) != n: print("ERROR: anchor พบ %d ครั้ง (ต้อง %d) - ไม่เขียนไฟล์\n%s" % (s.count(a), n, a[:100])); sys.exit(1)
    for a, b, n in E: s = s.replace(a, b)
    # 1) เอาปุ่ม Clear ด้านบนออก
    m = re.search(r"        \{showDetailMode === 'type' && \(\n          <button type=\"button\" disabled=\{selectedNoteRows\.size === 0\} onClick=\{handleClearTypeRows\}.*?</button>\n        \)\}\n", s, re.S)
    if not m or s.count("onClick={handleClearTypeRows}") != 1: print("ERROR: ไม่พบปุ่ม Clear ด้านบนตามที่คาด - ไม่เขียนไฟล์"); sys.exit(1)
    s = s[:m.start()] + "        {/* MARKER_VATWATCHLISTOPS_TYPE_ABF_V3 -- เอาปุ่ม Clear ด้านบนออก ใช้ปุ่ม Clear ทุกบรรทัดแทน */}\n" + s[m.end():]
    # 2) คอลัมน์ตายตัวของโหมด Type
    i = s.find("  const _typeLeadKeys = ['status', 'remark', 'type_receive_date']")
    tail = "    : VAT_INCOMPLETE_ALL_FIELDS.filter((f) => visibleColumns.includes(f.key));\n"
    j = s.find(tail, i)
    if i < 0 or j < 0 or j - i > 1500: print("ERROR: ไม่พบ activeCols ตามที่คาด - ไม่เขียนไฟล์"); sys.exit(1)
    newcols = ("  const TYPE_VIEW_COL_KEYS = ['status', 'remark', 'note', 'branch', 'invoice_ref', 'supplier_code', 'vendor_name', 'payment_date', 'check_date', 'check_no', 'receive_doc_date', 'receive_doc_no', 'exp_amount', 'exp_vat', 'type_action']; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V3 -- โหมด Type: คอลัมน์ตายตัว ไม่ใช้ Config Columns\n"
               "  const activeCols = showDetailMode === 'type'\n"
               "    ? TYPE_VIEW_COL_KEYS.map((k) => (k === 'type_action' ? { key: 'type_action', label: 'Status' } : VAT_INCOMPLETE_ALL_FIELDS.find((f) => f.key === k))).filter(Boolean)\n")
    s = s[:i] + newcols + s[j:]
    for o, c in ("{}", "()", "[]"):
        pass
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
