# -*- coding: utf-8 -*-
# MARKER_ARCOLLECTION_MATCHED_TABLE_V2
# modal "AR_Collection Matching" (VatController.js):
#  1) กล่องสีฟ้ายาว -> แถบสรุป "ใบกำกับภาษีที่ Match ได้ N รายการ" + ปุ่ม "ดูรายละเอียดการ Match" (กดจึงขยาย) / กล่อง error แสดงเสมอ
#  2) ตาราง -> คอลัมน์ตาม Macro Export: INVOICE REF., BU TAX ID, BU BRANCH, DATE, TAX INVOICE, GROSS, VAT, TOTAL,
#     DOC TYPE, TAX ID SUPPLIER, BRANCH SUPPLIER, GROUP INVOICE (+BU, สถานะ) หัวตารางสีดำ
#  3) คลิกแถว -> ขยาย Detail (Supplier / Match กับ Invoice Ref. / Tier-เหตุผล / Branch / เหตุผลที่ต้องตรวจสอบ)
#  4) ซ่อนชื่อไฟล์ (แถบกรอง "ไฟล์:" และคอลัมน์ไฟล์)
# ใช้แทน patch_arcollection_info_collapsible_v1.py (ถ้ายังไม่ได้รัน v1 ไม่ต้องรัน)
# วิธีใช้: วางไว้ที่ my-app\  แล้วรัน  python patch_arcollection_matched_table_v2.py
import os, sys, shutil
BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(BASE, 'src', 'pages', 'VatController.js')
MARK = 'MARKER_ARCOLLECTION_MATCHED_TABLE_V2'

def main():
    if not os.path.exists(TARGET):
        print('ไม่พบไฟล์', TARGET); sys.exit(1)
    s = open(TARGET, 'r', encoding='utf-8', newline='').read()
    if MARK in s:
        print('ติดตั้งแล้ว -- ข้าม'); return
    if 'MARKER_ARCOLLECTION_INFO_COLLAPSIBLE_V1' in s:
        print('พบ v1 ติดตั้งอยู่แล้ว -- กรุณา restore จาก VatController.js.bak_ar_info_collapsible_v1 ก่อน'); sys.exit(1)
    nl = '\r\n' if '\r\n' in s else '\n'
    N = lambda t: t.replace('\n', nl)
    sp = lambda n: ' ' * n

    def once(a):
        c = s.count(a)
        if c != 1:
            print('anchor พบ %d (ต้อง=1): %r -- ยกเลิก ไม่แก้ไฟล์' % (c, a[:70])); sys.exit(1)
        return a

    # --- state ---
    a_state = once(N("  const [sourceTab, setSourceTab] = React.useState('all'); // MARKER_VATWATCHLISTOPS_ARCOLLECTION_FILTER_SOURCE_V1\n"))
    n_state = a_state + N("  const [showArInfo, setShowArInfo] = React.useState(false); // " + MARK + "\n"
                          "  const [openKeys, setOpenKeys] = React.useState(() => new Set()); // " + MARK + " -- แถวที่ขยาย Detail\n")

    # --- banner ---
    a_b1 = once("{result.grossFilteredBeforePrefilterCount > 0 && <>แถวหลัง Gross Filter")
    n_b1 = ("<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>"
            "<span>ใบกำกับภาษีที่ Match ได้ <b>{rows.length.toLocaleString()}</b> รายการ (พร้อม Pop VAT {readyRows.length.toLocaleString()} · ต้องตรวจสอบ {reviewRows.length.toLocaleString()})</span>"
            "<button type=\"button\" onClick={() => setShowArInfo((v) => !v)} style={{ padding: '2px 10px', fontSize: '11px', borderRadius: '10px', border: '0.5px solid #B7CBE3', background: 'white', color: '#1a3a5c', cursor: 'pointer', flexShrink: 0 }}>{showArInfo ? 'ซ่อนรายละเอียดการ Match ▴' : 'ดูรายละเอียดการ Match ▾'}</button>"
            "</div>" + nl + sp(12) + "{showArInfo && <div style={{ marginTop: '6px' }}>" + a_b1)
    a_b2 = once("{result.diagLines.join(' | ')}</div>}{/* MARKER_ARCOLLECTION_REVIEW_REASON_DIAG_V1 */}")
    n_b2 = a_b2 + "</div>}"

    # --- ซ่อนแถบกรองไฟล์ ---
    a_src = once("{sources.length > 1 && ( // MARKER_VATWATCHLISTOPS_ARCOLLECTION_FILTER_SOURCE_V1")
    n_src = "{false && sources.length > 1 && ( // MARKER_VATWATCHLISTOPS_ARCOLLECTION_FILTER_SOURCE_V1"

    # --- ตาราง: แทนที่ช่วง <tr thead ...> ถึงก่อน {displayRows.length === 0 ---
    a_start = once(N("<tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>\n" + sp(16) +
                     "<th style={{ padding: '8px', textAlign: 'center' }}><input type=\"checkbox\" checked={allDisplaySelected}"))
    a_end = once(N("{displayRows.length === 0 && (\n" + sp(16) + "<tr><td colSpan={14}"))
    i0, i1 = s.index(a_start), s.index(a_end)
    if i1 <= i0:
        print('ลำดับ anchor ผิด -- ยกเลิก'); sys.exit(1)
    NEW_TABLE = N(r"""<tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '6px 8px', textAlign: 'center', background: '#000', color: '#fff' }}><input type="checkbox" checked={allDisplaySelected} onChange={toggleSelectAll} /></th>
                {[['BU', 'left'], ['INVOICE REF.', 'left'], ['BU TAX ID', 'left'], ['BU BRANCH', 'left'], ['DATE', 'left'], ['TAX INVOICE', 'left'], ['GROSS VALUE', 'right'], ['VAT VALUE', 'right'], ['TOTAL VALUE', 'right'], ['DOC TYPE', 'left'], ['TAX ID SUPPLIER', 'left'], ['BRANCH SUPPLIER', 'left'], ['GROUP INVOICE', 'left'], ['สถานะ', 'left']].map(([t, al]) => (
                  <th key={t} style={{ textAlign: al, padding: '6px 8px', background: '#000', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', borderRight: '1px solid #444' }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => (
                <React.Fragment key={r.__key}>
                  <tr onClick={() => setOpenKeys((prev) => { const n = new Set(prev); if (n.has(r.__key)) n.delete(r.__key); else n.add(r.__key); return n; })} style={{ borderTop: '0.5px solid #eee', cursor: 'pointer' }}>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedKeys.has(r.__key)} onChange={() => toggleRow(r.__key)} /></td>
                    <td style={{ padding: '6px 8px', fontWeight: '500', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: '14px', color: '#888' }}>{openKeys.has(r.__key) ? '▾' : '▸'}</span>{r.bu}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.trxNumber || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.custTaxId || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.companyBranch || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.docDateIso || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.docNum || '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.grossValue)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.vatValue)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.totalValue)}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.docType || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.sellerTaxId || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.sellerBranchId || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.groupInvoice || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {r.status === 'ready_for_popvat' ? (
                        <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }}>พร้อม Pop VAT</span>
                      ) : (
                        <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }} title={`leg2Diff=${r.leg2Diff ?? '—'}, leg1Status=${r.leg1Status ?? '—'}`}>ต้องตรวจสอบ</span>
                      )}
                    </td>
                  </tr>
                  {openKeys.has(r.__key) && (
                    <tr>
                      <td colSpan={15} style={{ background: '#fafbfd', padding: '8px 14px 10px 40px', fontSize: '11.5px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '3px 12px' }}>
                          <span style={{ color: '#888' }}>Supplier</span><span>{r.sellerName || '—'}</span>
                          <span style={{ color: '#888' }}>Match กับ Invoice Ref.</span><span>{(r.incompleteRow && r.incompleteRow.invoice_ref) || '—'}{r.vatMatchStage === 'incomplete_group' && Array.isArray(r.incompleteGroupRows) ? ` (รวม ${r.incompleteGroupRows.length} แถว Incomplete)` : ''}</span>
                          <span style={{ color: '#888' }}>Tier / เหตุผล</span><span>Tier {r.matchTier ?? '—'}{r.matchReason ? ` — ${r.matchReason}` : ''}</span>
                          <span style={{ color: '#888' }}>ตรวจ Branch</span><span>{r.branchOk === true ? '✓ ตรง' : r.branchOk === false ? '✗ ไม่ตรง' : '—'}</span>
                          {r.status !== 'ready_for_popvat' && r.reviewReason ? (<><span style={{ color: '#92400E' }}>เหตุผลที่ต้องตรวจสอบ</span><span style={{ color: '#92400E' }}>{r.reviewReason}</span></>) : null}{/* MARKER_ARCOLLECTION_REVIEW_REASON_DIAG_V1 */}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              """)
    # --- footer / empty row colSpan ---
    a_c14 = once(N("{displayRows.length === 0 && (\n" + sp(16) + "<tr><td colSpan={14}"))
    a_f6 = once("<td colSpan={6} style={{ padding: '8px', textAlign: 'right' }}>รวมทั้งหมด")

    # ทำการแทนที่ (ตาราง ก่อน เพราะอิง index)
    s = s[:i0] + NEW_TABLE + s[i1:]
    s = s.replace(a_c14, a_c14.replace('colSpan={14}', 'colSpan={15}'))
    s = s.replace(a_f6, a_f6.replace('colSpan={6}', 'colSpan={7}'))
    s = s.replace(a_state, n_state).replace(a_b1, n_b1).replace(a_b2, n_b2).replace(a_src, n_src)
    shutil.copy2(TARGET, TARGET + '.bak_ar_matched_table_v2')
    open(TARGET, 'w', encoding='utf-8', newline='').write(s)
    print('OK (backup: VatController.js.bak_ar_matched_table_v2)')
main()
