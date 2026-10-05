# -*- coding: utf-8 -*-
# MARKER_VATWATCHLISTOPS_QA_GLTRANSFER_ACCEPT_REMARK_V1
# Patch: GL-TransferVat -> ปุ่ม "Accept With Remark" (ยอดไม่ครบ แต่บันทึกได้ + Note ถาวรใน vat_watchlist_notes)
import sys, shutil
M = 'MARKER_VATWATCHLISTOPS_QA_GLTRANSFER_ACCEPT_REMARK_V1'
path = sys.argv[1]
raw = open(path, 'rb').read()
bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s:
    print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_acceptremark')

def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, f'anchor count={n}: {old[:70]}'
    s = s.replace(old, new)

# 1) State
rep("  const [qaGlAdi, setQaGlAdi] = React.useState('auto'); // auto / yes / no\n",
    "  const [qaGlAdi, setQaGlAdi] = React.useState('auto'); // auto / yes / no\n"
    f"  const [qaGlRemarkOpen, setQaGlRemarkOpen] = React.useState(false); // {M}\n"
    "  const [qaGlRemarkText, setQaGlRemarkText] = React.useState('');\n"
    "  const [qaGlRemarkPayDoc, setQaGlRemarkPayDoc] = React.useState('');\n")

# 2) Handler signature
rep("  const handleQuickActionGlTransfer = async () => {\n    if (quickActionRows.length === 0) return;\n",
    f"  const handleQuickActionGlTransfer = async (acceptOpts) => {{ // {M} -- acceptOpts = {{ acceptRemark, remark, payDoc }} (onClick ปกติส่ง Event มา -> acceptRemark เป็น undefined)\n"
    "    if (quickActionRows.length === 0) return;\n"
    "    const acceptRemarkMode = !!(acceptOpts && acceptOpts.acceptRemark === true);\n"
    "    const acceptRemarkText = acceptRemarkMode ? String(acceptOpts.remark || '').trim() : '';\n"
    "    const acceptPayDoc = acceptRemarkMode ? String(acceptOpts.payDoc || '').trim() : '';\n")

# 3) Validate: ยอดไม่ตรงผ่านได้เมื่อ Accept With Remark (ต้องมี Remark / ห้ามยอดเกิน Invoice)
rep("    if (!qaGlTotals.ok) {\n",
    "    if (acceptRemarkMode) {\n"
    "      if (!acceptRemarkText) { await confirmDialog.alert('กรุณากรอก Remark (เหตุผลที่ยอดไม่เต็ม) ก่อน Accept With Remark', { title: 'ต้องกรอก Remark', variant: 'danger' }); return; }\n"
    "      if (qaGlTotals.dg < -1 || qaGlTotals.dv < -1) { await confirmDialog.alert('ยอดใบกำกับเกิน Invoice — Accept With Remark ใช้ได้เฉพาะกรณีบันทึกขาดเท่านั้น', { title: 'ยอดเกิน Invoice', variant: 'danger' }); return; }\n"
    "    }\n"
    "    if (!qaGlTotals.ok && !acceptRemarkMode) {\n")

# 4) ตัวแปรเก็บ Note ที่เขียน (ไว้ Rollback)
rep("    const reportDoneFP = []; // เปลี่ยนแล้ว (เก็บสถานะเดิมไว้ Revert)\n",
    "    const reportDoneFP = []; // เปลี่ยนแล้ว (เก็บสถานะเดิมไว้ Revert)\n"
    f"    const noteWrittenFP = []; // {M} -- Note ที่สร้างใหม่ในรอบนี้ (ลบทิ้งถ้า Error)\n")

# 5) เขียน Note ก่อนเปลี่ยนสถานะ Watchlist เป็น draft
rep("      for (const u of reportPendingFP) { // เขียนครบทุกตารางแล้วค่อยเปลี่ยนสถานะรายการเป็น draft\n",
    f"      if (acceptRemarkMode) {{ // {M} -- Note ถาวร: Invoice Ref ที่ Popvat / ยอดที่บันทึกขาด / Payment Doc / Remark (ล็อกยอดตามจริง ณ ตอนบันทึก)\n"
    "        const fmN = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\n"
    "        const refsTxt = quickActionRows.map((r) => r.invoice_ref).join(', ');\n"
    "        const noteTxtAR = [\n"
    "          '[Accept With Remark - GL-TransferVat]',\n"
    "          `Invoice Ref. ที่ Popvat: ${refsTxt}`,\n"
    "          `ยอดที่บันทึกขาด: Gross ${fmN(qaGlTotals.dg)} / Vat ${fmN(qaGlTotals.dv)} (Invoice ${fmN(qaGlTotals.invG)} / ${fmN(qaGlTotals.invV)} - บันทึกแล้ว ${fmN(qaGlTotals.sg)} / ${fmN(qaGlTotals.sv)})`,\n"
    "          `Payment Doc: ${acceptPayDoc || '-'}`,\n"
    "          `Remark: ${acceptRemarkText}`,\n"
    "        ].join('\\n');\n"
    "        const nowIsoAR = new Date().toISOString();\n"
    "        const mapAddAR = {};\n"
    "        for (const row of quickActionRows) {\n"
    "          const keyAR = getNoteKey(row);\n"
    "          const hadNoteAR = !!noteMap[keyAR];\n"
    "          const payloadAR = { bu: bu?.bu, invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, note: noteTxtAR, remark: acceptRemarkText, check_no: acceptPayDoc || row.check_no || '', status: 'accept_with_condition', note_by: username, note_at: nowIsoAR };\n"
    "          await apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', { method: 'POST', body: JSON.stringify({ ...payloadAR, image_ids: JSON.stringify([]) }) });\n"
    "          if (!hadNoteAR) noteWrittenFP.push(row);\n"
    "          mapAddAR[keyAR] = { ...payloadAR, image_ids: [] };\n"
    "        }\n"
    "        setNoteMap((prev) => ({ ...prev, ...mapAddAR }));\n"
    "      }\n"
    "      for (const u of reportPendingFP) { // เขียนครบทุกตารางแล้วค่อยเปลี่ยนสถานะรายการเป็น draft\n")

# 6) Rollback Note เมื่อ Error
rep("      for (const u of reportDoneFP) { await apiFetch(`/vat_watchlist_report/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: u.prev }) }).catch(() => {}); } // คืนสถานะเดิมของรายการที่เปลี่ยนไปแล้ว\n",
    "      for (const u of reportDoneFP) { await apiFetch(`/vat_watchlist_report/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: u.prev }) }).catch(() => {}); } // คืนสถานะเดิมของรายการที่เปลี่ยนไปแล้ว\n"
    f"      for (const row of noteWrittenFP) {{ await apiFetch(`/vat_watchlist_notes?eq_bu=${{encodeURIComponent(bu?.bu || '')}}&eq_invoice_ref=${{encodeURIComponent(row.invoice_ref)}}&eq_supplier_code=${{encodeURIComponent(row.supplier_code)}}&hard=true`, {{ method: 'DELETE' }}).catch(() => {{}}); }} // {M} -- ลบ Note ที่เพิ่งสร้างถ้าบันทึกไม่สำเร็จ\n")

# 7) UI: ปุ่ม + Modal Remark ใน Footer
OLD_BTN = "              <button type=\"button\" disabled={quickActionSaving || !tGl.ok || qaGlPendingMissing.length > 0} onClick={handleQuickActionGlTransfer}"
rep(OLD_BTN,
    "              {(() => { const canAcceptGl = hasGl && !tGl.ok && !overGl && qaGlPendingMissing.length === 0; return canAcceptGl ? (\n"
    f"                <button type=\"button\" disabled={{quickActionSaving}} title=\"ยอดไม่เต็ม แต่ต้อง Popvat จริง -> บันทึกพร้อม Remark เป็น Note\" onClick={{() => {{ setQaGlRemarkText(''); setQaGlRemarkPayDoc(rowsGl[0]?.check_no || ''); setQaGlRemarkOpen(true); }}}} style={{{{ padding: '8px 16px', border: '1px solid #b26a00', borderRadius: '8px', background: '#fff8e1', color: '#b26a00', fontWeight: 600, cursor: quickActionSaving ? 'default' : 'pointer', opacity: quickActionSaving ? 0.45 : 1 }}}}>Accept With Remark</button>\n"
    "              ) : null; })()}\n"
    "              {qaGlRemarkOpen && (\n"
    "                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250 }}>\n"
    "                  <div style={{ background: 'white', borderRadius: '12px', width: '560px', maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: '18px 20px', fontSize: '13px' }}>\n"
    "                    <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Accept With Remark</div>\n"
    "                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>ยอดใบกำกับไม่เต็มยอด Invoice — ระบบจะ Popvat Cancel + Simple Input ตามยอดที่กรอก และบันทึก Note ถาวร (ไม่หายแม้รายการออกจาก Watchlist)</div>\n"
    "                    <label style={lblS}>1. Invoice Ref. ที่ Popvat (ล็อก)</label>\n"
    "                    <textarea readOnly rows={Math.min(4, Math.max(1, rowsGl.length))} value={rowsGl.map((r) => r.invoice_ref).join('\\n')} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', border: '0.5px solid #ddd', borderRadius: '8px', background: '#f6f8fa', fontSize: '12px', marginBottom: '10px' }} />\n"
    "                    <label style={lblS}>2. ยอดที่บันทึกขาด (ล็อก)</label>\n"
    "                    <div style={{ padding: '8px 10px', border: '0.5px solid #f3c6c8', borderRadius: '8px', background: '#fff5f5', color: '#c0392b', fontWeight: 600, marginBottom: '10px' }}>Gross {fm2(tGl.dg)} / Vat {fm2(tGl.dv)} <span style={{ fontWeight: 400, color: '#888', fontSize: '11px' }}>(Invoice {fm2(tGl.invG)} / {fm2(tGl.invV)} · บันทึก {fm2(tGl.sg)} / {fm2(tGl.sv)})</span></div>\n"
    "                    <label style={lblS}>3. Payment Doc (แก้ได้)</label>\n"
    "                    <input type=\"text\" value={qaGlRemarkPayDoc} onChange={(e) => setQaGlRemarkPayDoc(e.target.value)} style={{ ...yInS, marginBottom: '10px' }} />\n"
    "                    <label style={lblS}>4. Remark / เหตุผล <span style={{ color: '#e5484d' }}>* บังคับกรอก</span></label>\n"
    "                    <textarea rows={4} autoFocus value={qaGlRemarkText} onChange={(e) => setQaGlRemarkText(e.target.value)} placeholder=\"ระบุเหตุผลที่ยอดไม่เต็ม เช่น ผู้ขายออกใบกำกับขาด / รอใบกำกับส่วนที่เหลือ\" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '8px', fontSize: '13px', outline: 'none' }} />\n"
    "                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>\n"
    "                      <button type=\"button\" onClick={() => setQaGlRemarkOpen(false)} style={{ padding: '8px 16px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>\n"
    "                      <button type=\"button\" disabled={!qaGlRemarkText.trim() || quickActionSaving} onClick={() => { setQaGlRemarkOpen(false); handleQuickActionGlTransfer({ acceptRemark: true, remark: qaGlRemarkText, payDoc: qaGlRemarkPayDoc }); }} style={{ padding: '8px 16px', border: 'none', borderRadius: '8px', background: '#b26a00', color: 'white', cursor: (!qaGlRemarkText.trim() || quickActionSaving) ? 'default' : 'pointer', opacity: (!qaGlRemarkText.trim() || quickActionSaving) ? 0.45 : 1 }}>ยืนยัน Accept &amp; บันทึก</button>\n"
    "                    </div>\n"
    "                  </div>\n"
    "                </div>\n"
    "              )}\n"
    + OLD_BTN)

open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK', M, 'BOM' if bom else 'noBOM')
