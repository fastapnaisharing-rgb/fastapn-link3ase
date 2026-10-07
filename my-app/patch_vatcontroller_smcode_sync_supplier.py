# -*- coding: utf-8 -*-
# Patch: เพิ่มปุ่ม Sync ที่หัวคอลัมน์ Supplier Code ของ New/Edit Simple Code (VatSmCodeSearchModal) -- Port จาก APController (MARKER_SMCODE_SYNC_SUPPLIER_V1)
# ดึง supplier_code ของ Invoice ที่เปิด Quick Action อยู่ มาใส่ฟอร์ม แล้วเติม Company/Tax ID/Branch/Type/Sub Type จาก vendor_category
# usage: python patch_vatcontroller_smcode_sync_supplier.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, ('anchor count', txt.count(old), old[:80])
    txt = txt.replace(old, new)

# 1) Props
rep("function VatSmCodeSearchModal({ onClose, onSelect, smCodes = [], branches = [], vendorCategories = [], smLoading = false, embedded = false }) {",
    "function VatSmCodeSearchModal({ onClose, onSelect, smCodes = [], branches = [], vendorCategories = [], smLoading = false, embedded = false, syncSupplierCode = '' }) { // MARKER_SMCODE_SYNC_SUPPLIER_V1 --")

# 2) Handler
rep("""  const handleSmOfinCodeChange = (val) => setSmForm((prev) => ({ ...prev, 'Ofin Code': val }));""",
"""  // MARKER_SMCODE_SYNC_SUPPLIER_V1 -- ปุ่ม Sync: ดึง Supplier Code ของ Invoice ที่เปิดอยู่ มาใส่ฟอร์ม แล้วเติม Detail จาก vendor_category (Match ทั้ง Code และ Supplier Number)
  const handleSmSyncSupplier = () => {
    const code = String(syncSupplierCode || '').trim();
    if (!code) { setSmFormError('ไม่พบ Vendor Code ของรายการนี้'); return; }
    const found = (vendorCategories || []).find((i) => String(i['Code'] || '').trim() === code || String(i['Supplier Number'] || '').trim() === code);
    setSmFormError('');
    setSmForm((prev) => ({
      ...prev,
      'Supplier Code': code,
      ...(found ? {
        'Company Name': found['Supplier Name'] || prev['Company Name'],
        'Tax ID': found['TAX ID'] || prev['Tax ID'],
        'Branch': found['No.'] || prev['Branch'],
        '_type': found['TYPE'] || '',
        '_sub_type': found['SUB TYPE'] || '',
      } : {}),
    }));
  };
  const handleSmOfinCodeChange = (val) => setSmForm((prev) => ({ ...prev, 'Ofin Code': val }));""")

# 3) smGrid header (เฉพาะ smGrid ไม่ใช่ smRowBlue)
rep("""  const smGrid = (cols) => (
    <div style={{ display: 'grid', gridTemplateColumns: cols.map((c) => c.w || '1fr').join(' '), border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
      {cols.map((c, i) => (
        <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < cols.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
      ))}""",
"""  const smGrid = (cols) => (
    <div style={{ display: 'grid', gridTemplateColumns: cols.map((c) => c.w || '1fr').join(' '), border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
      {cols.map((c, i) => (
        <div key={`h${i}`} style={{ position: 'relative', padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < cols.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}
          {c.syncFn && !isViewOnly && ( /* MARKER_SMCODE_SYNC_SUPPLIER_V1 */
            <button type="button" title={`Sync -- ดึง Vendor Code ของรายการนี้ (${syncSupplierCode})`} onClick={c.syncFn}
              style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '18px', padding: 0, borderRadius: '4px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            </button>
          )}
        </div>
      ))}""")

# 4) คอลัมน์ Supplier Code
rep("{ label: 'Supplier Code', key: 'Supplier Code', w: '180px', onChangeFn: handleSmSupplierCodeChange, center: true },",
    "{ label: 'Supplier Code', key: 'Supplier Code', w: '180px', onChangeFn: handleSmSupplierCodeChange, center: true, syncFn: String(syncSupplierCode || '').trim() ? handleSmSyncSupplier : null }, // MARKER_SMCODE_SYNC_SUPPLIER_V1")

# 5) ส่ง Supplier Code ของ Invoice ใน Quick Action เข้า Modal (เฉพาะที่เปิดจาก GL-TransferVat)
rep("""              <VatSmCodeSearchModal
                embedded
                onClose={() => setQaGlShowSmSearch(false)}""",
"""              <VatSmCodeSearchModal
                embedded
                syncSupplierCode={String((quickActionRows.find((qr) => String(qr.supplier_code || '').trim()) || {}).supplier_code || '').trim()} /* MARKER_SMCODE_SYNC_SUPPLIER_V1 */
                onClose={() => setQaGlShowSmSearch(false)}""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
