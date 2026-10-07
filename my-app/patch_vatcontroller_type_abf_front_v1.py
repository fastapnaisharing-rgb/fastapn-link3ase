# -*- coding: utf-8 -*-
"""patch_vatcontroller_type_abf_front_v1  (FRONTEND  src\\pages\\VatController.js)
Popvat A/B/F -> สถานะ Type A / B / F (ไม่หายจาก DB, ไม่ถูกนับใน Report/Dashboard)
 - Quick Action Popvat A/B/F: PUT vat_watchlist_report.status = type_a/type_b/type_f + type_receive_date (วันที่ใช้สิทธิ์)
   Note ยังเขียนตามเดิม (Remark + รายละเอียด + วันที่ใช้สิทธิ์) แต่ไม่ตั้ง accept_with_condition อีก (Aging ไม่ถูกเปลี่ยนเป็น Accept)
 - ปุ่ม Type (n) ต่อจาก All | Show | Hide: ดูรายการ Type A/B/F; คอลัมน์ Popvat Type / Remark / Note แสดงเสมอ + วันที่ใช้สิทธิ์ (Config Columns ได้)
 - ปุ่ม Clear (เลือก Checkbox แล้วกด): คืนรายการเป็น Pending + ลบ Note A/B/F ของรายการนั้น
 - Draft Monitor ยกเลิก Popvat draft: รายการ Type ของใบนั้นกลับเป็น Pending
ต้องใช้คู่กับ patch_vatwatchlist_type_abf_back_v1.py + add_type_receive_date_to_vat_watchlist_report.sql
ต้องรัน patch_vatcontroller_popvat_note_detail_v1.py ก่อน (Note ละเอียด)
รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_TYPE_ABF_STATUS_V1"
E = []
# 1) Config Columns: 2 Field ใหม่ท้ายรายการ
E.append(("  { key: 'sub_type', label: 'Sub Type' },\n", "  { key: 'sub_type', label: 'Sub Type' },\n  { key: 'status', label: 'Popvat Type' }, { key: 'type_receive_date', label: 'วันที่ใช้สิทธิ์' }, // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1\n", 1))
# 2) State
E.append(("  const [showDetailMode, setShowDetailMode] = React.useState('all');", "  const [typeRows, setTypeRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- รายการ Popvat Type A/B/F\n  const [showDetailMode, setShowDetailMode] = React.useState('all');", 1))
# 3) displayDetailRows + โหลด Type rows
E.append(("    if (showDetailMode === 'all') return detailRows;\n", "    if (showDetailMode === 'type') return typeRows; // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1\n    if (showDetailMode === 'all') return detailRows;\n", 1))
E.append(("  }, [detailRows, showDetailMode, noteMap]); // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1\n",
r"""  }, [detailRows, showDetailMode, noteMap, typeRows]); // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- โหลดรายการ Type A/B/F ของ BU นี้ (ไม่อยู่ใน detailRows เพราะ Report ดึงเฉพาะ pending)
    if (!bu?.bu) { setTypeRows([]); return undefined; }
    let active = true;
    (async () => {
      try {
        const res = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&in_status=type_a,type_b,type_f&limit=5000`);
        if (active) setTypeRows(Array.isArray(res) ? res : []);
      } catch (e) { if (active) setTypeRows([]); }
    })();
    return () => { active = false; };
  }, [bu?.bu, detailReloadKey]);
""", 1))
# 4) Active columns ในโหมด Type
E.append(("  const activeCols = VAT_INCOMPLETE_ALL_FIELDS.filter((f) => visibleColumns.includes(f.key));\n",
r"""  const _typeLeadKeys = ['status', 'remark', 'note', 'type_receive_date']; // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- โหมด Type: Popvat Type / Remark / Note แสดงเสมอ (วันที่ใช้สิทธิ์ตาม Config Columns)
  const activeCols = showDetailMode === 'type'
    ? [..._typeLeadKeys.map((k) => VAT_INCOMPLETE_ALL_FIELDS.find((f) => f.key === k)).filter((f) => f && (f.key !== 'type_receive_date' || visibleColumns.includes(f.key))), ...VAT_INCOMPLETE_ALL_FIELDS.filter((f) => visibleColumns.includes(f.key) && !_typeLeadKeys.includes(f.key))]
    : VAT_INCOMPLETE_ALL_FIELDS.filter((f) => visibleColumns.includes(f.key));
""", 1))
# 5) Cell Popvat Type
E.append(("                        else if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) { cellValue = formatVatIncompleteDate(row[c.key]); cellAlign = 'center'; }\n",
"                        else if (c.key === 'status') { cellValue = ({ type_a: 'A', type_b: 'B', type_f: 'F' })[row.status] || ''; cellAlign = 'center'; } // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1\n                        else if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) { cellValue = formatVatIncompleteDate(row[c.key]); cellAlign = 'center'; }\n", 1))
# 6) แถวว่างในโหมด Type
E.append((") : detailTotalCount === 0 ? (", ") : (showDetailMode === 'type' ? displayDetailRows.length === 0 : detailTotalCount === 0) ? (", 1))
# 7) ปุ่ม Type + Clear
E.append(("<div style={{ display: 'flex', marginLeft: 'auto', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', width: '148px' }}>",
r"""{showDetailMode === 'type' && (
          <button type="button" disabled={selectedNoteRows.size === 0} onClick={handleClearTypeRows} title="เลือกรายการ (Checkbox) แล้วกด Clear เพื่อคืนเป็น Pending" style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: '11px', borderRadius: '8px', border: '0.5px solid #e57373', background: selectedNoteRows.size === 0 ? '#fafafa' : '#fdecea', color: selectedNoteRows.size === 0 ? '#bbb' : '#c62828', cursor: selectedNoteRows.size === 0 ? 'default' : 'pointer' }}>Clear{selectedNoteRows.size > 0 ? ` (${selectedNoteRows.size})` : ''}</button>
        )}
        <div style={{ display: 'flex', marginLeft: showDetailMode === 'type' ? '8px' : 'auto', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', minWidth: '148px' }}>""", 1))
E.append(("            { key: 'hide', label: 'Hide' },\n", "            { key: 'hide', label: 'Hide' },\n            { key: 'type', label: typeRows.length > 0 ? `Type (${typeRows.length})` : 'Type' }, // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1\n", 1))
E.append(("                padding: '6px 2px',\n", "                padding: '6px 8px', whiteSpace: 'nowrap',\n", 1))
# 8) Clear handler + ป้องกัน Popvat ซ้ำในโหมด Type
E.append(("  const openQuickAction = async (row) => {\n",
r"""  const handleClearTypeRows = async () => { // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- Clear: คืน Type A/B/F เป็น Pending + ลบ Note A/B/F ของรายการนั้น
    const targets = Array.from(selectedNoteRows.values()).filter((r) => /^type_[abf]$/.test(r.status));
    if (targets.length === 0) return;
    const ok = await confirmDialog.confirm(`Clear ${targets.length} รายการ? รายการจะกลับเป็น Pending ในรายงาน และลบ Note A/B/F ของรายการนั้น`, { title: 'Clear Type', variant: 'danger' });
    if (!ok) return;
    try {
      for (const r of targets) {
        await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'pending', type_receive_date: null }) });
        const ne = noteMap[getNoteKey(r)];
        if (ne && /^[ABF] - /.test(String(ne.remark || ''))) {
          await apiFetch(`/vat_watchlist_notes?eq_bu=${encodeURIComponent(bu.bu)}&eq_invoice_ref=${encodeURIComponent(r.invoice_ref)}&eq_supplier_code=${encodeURIComponent(r.supplier_code)}&hard=true`, { method: 'DELETE' });
          setNoteMap((prev) => { const next = { ...prev }; delete next[getNoteKey(r)]; return next; });
        }
      }
      setSelectedNoteRows(new Map());
      setDetailReloadKey((k) => k + 1);
      broadcastWs('vat_watchlist_draft_updated', { bu: bu?.bu, invoice_refs: targets.map((r) => r.invoice_ref) });
    } catch (err) {
      await confirmDialog.alert(`Clear ไม่สำเร็จ: ${err?.message || err}`, { title: 'Clear Type', variant: 'danger' });
    }
  };
  const openQuickAction = async (row) => {
    if (showDetailMode === 'type') { await confirmDialog.alert('รายการ Type A/B/F ใช้สิทธิ์ไปแล้ว Popvat ซ้ำไม่ได้ ถ้าต้องการทำใหม่ให้กด Clear คืนเป็น Pending ก่อน', { title: 'รายการ Type' }); return; } // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1
""", 1))
# 9) Popvat A/B/F เขียน status type_* + วันที่ใช้สิทธิ์
E.append(("""          for (const r of matchedReport) {
            await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
          }
          // MARKER_VATCONTROLLER_QUICKACTION_PROGRESSIVE_RESUME_V1 -- แถวนี้สำเร็จแล้ว""", """          for (const r of matchedReport) {
            // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- A/B/F = สถานะ type_a/b/f (ไม่หายจาก DB, ไม่นับใน Report/Dashboard) + วันที่ใช้สิทธิ์ ; N = draft เหมือนเดิม
            const typePut = ['A', 'B', 'F'].includes(popCode) ? { status: `type_${popCode.toLowerCase()}`, type_receive_date: formatQuickActionReceiveDateText(quickActionReceiveDate) || null } : { status: 'draft' };
            await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify(typePut) });
          }
          // MARKER_VATCONTROLLER_QUICKACTION_PROGRESSIVE_RESUME_V1 -- แถวนี้สำเร็จแล้ว""", 1))
E.append(("status: popCode === 'A' ? 'accept_with_condition' : 'pending', note_by: username", "status: 'pending', note_by: username", 1))  # ไม่ตั้ง accept_with_condition (Aging ไม่ถูกเปลี่ยนเป็น Accept)
E.append(("              `Draft ID: ${draftId}`,\n", "              `วันที่ใช้สิทธิ์ (Receive Date): ${formatQuickActionReceiveDateText(quickActionReceiveDate) || '-'}`, // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1\n              `Draft ID: ${draftId}`,\n", 1))
# 10) Draft ยกเลิก -> Type กลับ pending
E.append((".filter((r) => r.status === 'draft' && vatSameSupplierName(pr.supplier_name, r.vendor_name))", ".filter((r) => (r.status === 'draft' || /^type_[abf]$/.test(r.status)) && vatSameSupplierName(pr.supplier_name, r.vendor_name))", 2))
E.append(("{ method: 'PUT', body: JSON.stringify({ status: 'pending' }) });", "{ method: 'PUT', body: JSON.stringify({ status: 'pending', type_receive_date: null }) });", 2))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if "VATWATCHLISTOPS_QA_POPVAT_NOTE_DETAIL_V1" not in s:
        print("ERROR: ต้องรัน patch_vatcontroller_popvat_note_detail_v1.py ก่อน"); sys.exit(1)
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
