import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function UploadGen() {
  const [images, setImages] = useState([]);
  const [invoiceData, setInvoiceData] = useState({
    invoiceNo: '', supplierCode: '', supplierSite: '', receiveDate: '',
    dueDate: '', totalAmt: '', vatAmt: '', description: '', account: '', branch: ''
  });
  const [saved, setSaved] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    const urls = files.map(f => URL.createObjectURL(f));
    setImages(prev => [...prev, ...urls]);
  };

  const handleBrowse = (e) => {
    const files = Array.from(e.target.files);
    const urls = files.map(f => URL.createObjectURL(f));
    setImages(prev => [...prev, ...urls]);
  };

  const handleRemove = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const exportExcel = () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `UL${dateStr}-${timeStr}LKS.xls`;

    const wsData = [
      ['CRG BOOK'],
      [],
      ['H', 'APN', invoiceData.supplierCode, invoiceData.supplierSite,
       invoiceData.receiveDate, invoiceData.invoiceNo, invoiceData.totalAmt,
       '', invoiceData.branch, invoiceData.description, 'Yes', '', '', '', invoiceData.dueDate],
      ['L', invoiceData.description, invoiceData.vatAmt ? (parseFloat(invoiceData.totalAmt) - parseFloat(invoiceData.vatAmt)).toFixed(2) : invoiceData.totalAmt,
       '', '', '', invoiceData.account, '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const S = {
    container: { padding: '20px' },
    card: { background: 'white', borderRadius: '10px', padding: '20px', marginBottom: '16px' },
    dropzone: { border: '2px dashed #ccc', borderRadius: '10px', padding: '32px', textAlign: 'center', background: '#fafafa', cursor: 'pointer' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px' },
    label: { fontSize: '12px', color: '#666', display: 'block', marginBottom: '3px' },
    btn: { padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px' },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }
  };

  return (
    <div style={S.container}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>📤 Upload & Gen Excel</h2>

      <div style={S.card}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', color: '#1a3a5c' }}>Drop Image / รูปเอกสาร</div>
        <div style={S.dropzone} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📎</div>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>ลากรูปมาวางที่นี่ หรือ</div>
          <label style={{ ...S.btn, background: '#1a3a5c', color: 'white', display: 'inline-block' }}>
            Browse File
            <input type="file" accept="image/*" multiple onChange={handleBrowse} style={{ display: 'none' }} />
          </label>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>รองรับ JPG, PNG</div>
        </div>

        {images.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {images.map((url, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #ddd' }} />
                <button onClick={() => handleRemove(idx)} style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', color: '#1a3a5c' }}>ข้อมูล Invoice</div>
        <div style={S.grid}>
          {[['invoiceNo','Invoice No.'],['supplierCode','Supplier Code'],['supplierSite','Supplier Site'],['branch','Branch (Buyer)'],['receiveDate','Receive Date (DDMMYY)'],['dueDate','Due Date (DDMMYY)'],['totalAmt','Total (รวม VAT)'],['vatAmt','VAT Amount']].map(([key, label]) => (
            <div key={key}>
              <label style={S.label}>{label}</label>
              <input style={S.input} value={invoiceData[key]} onChange={e => setInvoiceData({...invoiceData, [key]: e.target.value})} />
            </div>
          ))}
        </div>
        <div>
          <label style={S.label}>Description</label>
          <input style={S.input} value={invoiceData.description} onChange={e => setInvoiceData({...invoiceData, description: e.target.value})} />
        </div>
        <div>
          <label style={S.label}>Account</label>
          <input style={S.input} value={invoiceData.account} onChange={e => setInvoiceData({...invoiceData, account: e.target.value})} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        {saved && <span style={{ color: '#0F6E56', fontSize: '13px', alignSelf: 'center' }}>✅ Export สำเร็จแล้วครับ!</span>}
        <button style={{ ...S.btn, background: '#0F6E56', color: 'white', fontSize: '14px', padding: '10px 24px' }} onClick={exportExcel}>
          📥 Export Excel (.xls)
        </button>
      </div>
    </div>
  );
}

export default UploadGen;