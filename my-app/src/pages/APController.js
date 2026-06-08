import React, { useState } from 'react';

// ── Tab IDs ──────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'gr',      label: 'GR Reference',    icon: '📋' },
  { id: 'ocr',     label: 'OCR / สแกน',      icon: '🔍' },
  { id: 'form',    label: 'Invoice Form',     icon: '📝' },
  { id: 'drafts',  label: 'Draft List',       icon: '🗂️' },
];

// ── Mock GR data ─────────────────────────────────────────────────────────────
const MOCK_GRS = [
  {
    id: 'GR-2026-00421', date: '05/06/2026', vendor: 'Thai Komori Co., Ltd.',
    po: 'PO-1089', total: 185000, status: 'ready',
    lines: [
      { desc: 'กระดาษ A4 80g',  qty: 500, unit: 180 },
      { desc: 'หมึกพิมพ์ดำ',    qty: 20,  unit: 2500 },
      { desc: 'ค่าขนส่ง',       qty: 1,   unit: 5000 },
    ],
  },
  {
    id: 'GR-2026-00418', date: '01/06/2026', vendor: 'Siam Printing Ltd.',
    po: 'PO-1082', total: 92500, status: 'used',
    lines: [
      { desc: 'กระดาษถ่ายเอกสาร', qty: 200, unit: 300 },
      { desc: 'ปากกา',            qty: 50,  unit: 85  },
    ],
  },
  {
    id: 'GR-2026-00415', date: '28/05/2026', vendor: 'Bangkok Tech Supply',
    po: 'PO-1077', total: 340000, status: 'ready',
    lines: [
      { desc: 'Laptop Dell XPS',  qty: 2,   unit: 55000 },
      { desc: 'Monitor 27"',      qty: 4,   unit: 12000 },
      { desc: 'Keyboard + Mouse', qty: 10,  unit: 2800  },
    ],
  },
];

// ── Mock drafts ───────────────────────────────────────────────────────────────
const MOCK_DRAFTS_INIT = [
  { id: 'DRAFT-001', invoiceNo: 'INV-2026-0142', vendor: 'Thai Komori Co., Ltd.', grRef: 'GR-2026-00421', total: 197950, date: '08/06/2026', status: 'draft' },
  { id: 'DRAFT-002', invoiceNo: 'INV-2026-0140', vendor: 'Bangkok Tech Supply',   grRef: 'GR-2026-00415', total: 362600, date: '06/06/2026', status: 'submitted' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });

const s = {
  wrap:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f7fa', fontFamily: 'sans-serif', fontSize: '13px', overflow: 'hidden' },
  topbar:  { background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  tabs:    { background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '0 20px', display: 'flex', gap: 0, flexShrink: 0 },
  body:    { flex: 1, overflow: 'hidden', display: 'flex' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }) {
  return (
    <div style={s.tabs}>
      {TABS.map(t => (
        <div key={t.id} onClick={() => onChange(t.id)}
          style={{ padding: '9px 16px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', borderBottom: active === t.id ? '2px solid #1a3a5c' : '2px solid transparent', color: active === t.id ? '#1a3a5c' : '#888', fontWeight: active === t.id ? '500' : '400' }}>
          {t.icon} {t.label}
        </div>
      ))}
    </div>
  );
}

// ── GR Reference Tab ──────────────────────────────────────────────────────────
function GRTab({ onPull }) {
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(null);

  const filtered = MOCK_GRS.filter(g =>
    g.id.toLowerCase().includes(search.toLowerCase()) ||
    g.vendor.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* List */}
      <div style={{ width: '340px', borderRight: '0.5px solid #e8eaf0', background: 'white', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid #e8eaf0' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase', marginBottom: '8px' }}>เลือก GR</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา GR No. / Vendor..."
              style={{ flex: 1, padding: '6px 10px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', outline: 'none' }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filtered.map(gr => (
            <div key={gr.id} onClick={() => setSelected(gr)}
              style={{ marginBottom: '8px', border: selected?.id === gr.id ? '1.5px solid #1a3a5c' : '0.5px solid #e8eaf0', borderRadius: '8px', cursor: 'pointer', overflow: 'hidden', background: selected?.id === gr.id ? '#f0f7ff' : 'white' }}>
              <div style={{ padding: '8px 12px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '500', color: '#1a3a5c', fontSize: '12px' }}>{gr.id}</div>
                  <div style={{ fontSize: '11px', color: '#aaa' }}>รับของ {gr.date}</div>
                </div>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: gr.status === 'ready' ? '#EAF3DE' : '#f0f0f0', color: gr.status === 'ready' ? '#27500A' : '#888', fontWeight: '500' }}>
                  {gr.status === 'ready' ? 'พร้อมใช้' : 'ใช้แล้ว'}
                </span>
              </div>
              <div style={{ padding: '8px 12px', fontSize: '11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}><span style={{ color: '#888' }}>Vendor</span><span style={{ fontWeight: '500' }}>{gr.vendor}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}><span style={{ color: '#888' }}>PO</span><span>{gr.po}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>ยอดรวม</span><span style={{ fontWeight: '500', color: '#1a3a5c' }}>฿{fmt(gr.total)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>📋</div>
            <div style={{ fontSize: '13px' }}>เลือก GR จากรายการด้านซ้าย</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#1a3a5c' }}>{selected.id}</div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>รับของวันที่ {selected.date} · {selected.po}</div>
              </div>
              {selected.status === 'ready' && (
                <button onClick={() => onPull(selected)}
                  style={{ padding: '8px 16px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' }}>
                  ▶ ดึงข้อมูลลง Invoice Form
                </button>
              )}
            </div>

            {/* Header info */}
            <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase', marginBottom: '8px' }}>ข้อมูล Header</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                {[['Vendor', selected.vendor], ['PO อ้างอิง', selected.po], ['วันที่รับของ', selected.date], ['ยอดรวม', `฿${fmt(selected.total)}`]].map(([k, v]) => (
                  <div key={k}><span style={{ color: '#888' }}>{k}: </span><span style={{ fontWeight: '500' }}>{v}</span></div>
                ))}
              </div>
            </div>

            {/* Line items */}
            <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #e8eaf0', fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase' }}>รายการ Line Items</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['รายการ', 'จำนวน', 'ราคา/หน่วย', 'ยอดรวม'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px', fontSize: '12px' }}>{l.desc}</td>
                      <td style={{ padding: '8px 12px', fontSize: '12px' }}>{l.qty}</td>
                      <td style={{ padding: '8px 12px', fontSize: '12px' }}>฿{fmt(l.unit)}</td>
                      <td style={{ padding: '8px 12px', fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>฿{fmt(l.qty * l.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', borderTop: '0.5px solid #e8eaf0' }}>
                <span style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>รวม ฿{fmt(selected.total)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── OCR Tab ───────────────────────────────────────────────────────────────────
function OCRTab({ onExtracted }) {
  const [file, setFile]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
  };

  const handleOCR = () => {
    if (!file) return;
    setLoading(true);
    setTimeout(() => {
      setResult({
        vendor: 'Thai Komori Co., Ltd.', invoiceNo: 'INV-TK-20260601',
        invoiceDate: '01/06/2026', dueDate: '30/06/2026',
        total: 185000, vat: 12950,
        lines: [
          { desc: 'กระดาษ A4 80g',  qty: 500, unit: 180 },
          { desc: 'หมึกพิมพ์ดำ',    qty: 20,  unit: 2500 },
          { desc: 'ค่าขนส่ง',       qty: 1,   unit: 5000 },
        ],
        confidence: 94,
      });
      setLoading(false);
    }, 1800);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
      <div style={{ maxWidth: '720px' }}>
        {/* Upload zone */}
        <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase', marginBottom: '12px' }}>อัปโหลดเอกสาร</div>
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1.5px dashed #d0d5e0', borderRadius: '8px', padding: '32px', cursor: 'pointer', background: '#fafbfc', gap: '8px' }}>
            <div style={{ fontSize: '32px' }}>📄</div>
            <div style={{ fontSize: '13px', color: '#555' }}>{file ? file.name : 'คลิกหรือลากไฟล์มาวาง'}</div>
            <div style={{ fontSize: '11px', color: '#aaa' }}>รองรับ JPG, PNG, PDF</div>
            <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleFile} style={{ display: 'none' }} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <div style={{ flex: 1, fontSize: '11px', color: '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ background: '#e8eaf0', padding: '2px 8px', borderRadius: '4px' }}>Tesseract</span>
              <span style={{ background: '#e8eaf0', padding: '2px 8px', borderRadius: '4px' }}>PaddleOCR</span>
            </div>
            <button onClick={handleOCR} disabled={!file || loading}
              style={{ padding: '7px 18px', background: file && !loading ? '#1a3a5c' : '#ccc', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', cursor: file && !loading ? 'pointer' : 'default', fontWeight: '500' }}>
              {loading ? '⏳ กำลังอ่าน...' : '🔍 อ่านเอกสาร'}
            </button>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase' }}>ผลการอ่าน</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 8px', borderRadius: '20px' }}>ความแม่นยำ {result.confidence}%</span>
                <button onClick={() => onExtracted(result)}
                  style={{ padding: '5px 14px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  ▶ ใช้ข้อมูลนี้
                </button>
              </div>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
              {[['Vendor', result.vendor], ['Invoice No.', result.invoiceNo], ['วันที่ Invoice', result.invoiceDate], ['ครบกำหนด', result.dueDate], ['ยอดก่อน VAT', `฿${fmt(result.total)}`], ['VAT 7%', `฿${fmt(result.vat)}`]].map(([k, v]) => (
                <div key={k} style={{ background: '#f0f7ff', borderRadius: '6px', padding: '7px 10px' }}>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>{k}</div>
                  <div style={{ fontWeight: '500', color: '#1a3a5c' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Line Items</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead><tr style={{ background: '#f8f9fa' }}>
                  {['รายการ','จำนวน','ราคา/หน่วย','ยอดรวม'].map(h => <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'#888', fontWeight:'500', borderBottom:'0.5px solid #e8eaf0' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {result.lines.map((l,i) => (
                    <tr key={i} style={{ borderBottom:'0.5px solid #f0f0f0' }}>
                      <td style={{ padding:'6px 10px' }}>{l.desc}</td>
                      <td style={{ padding:'6px 10px' }}>{l.qty}</td>
                      <td style={{ padding:'6px 10px' }}>฿{fmt(l.unit)}</td>
                      <td style={{ padding:'6px 10px', fontWeight:'500', color:'#1a3a5c' }}>฿{fmt(l.qty*l.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Invoice Form Tab ───────────────────────────────────────────────────────────
function InvoiceFormTab({ prefill, onSubmitted }) {
  const [form, setForm] = useState({
    vendor:      prefill?.vendor      || '',
    po:          prefill?.po          || '',
    invoiceNo:   prefill?.invoiceNo   || '',
    invoiceDate: prefill?.invoiceDate || '',
    dueDate:     prefill?.dueDate     || '',
    glAccount:   '',
    lines: prefill?.lines?.map(l => ({ ...l, amount: l.qty * l.unit })) || [
      { desc: '', qty: '', unit: '', amount: 0 },
    ],
  });
  const [submitted, setSubmitted] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setLine = (i, k, v) => {
    const lines = [...form.lines];
    lines[i] = { ...lines[i], [k]: v };
    if (k === 'qty' || k === 'unit') lines[i].amount = (Number(lines[i].qty) || 0) * (Number(lines[i].unit) || 0);
    setForm(f => ({ ...f, lines }));
  };

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { desc: '', qty: '', unit: '', amount: 0 }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const subtotal = form.lines.reduce((s, l) => s + (l.amount || 0), 0);
  const vat      = Math.round(subtotal * 0.07);
  const wht      = Math.round(subtotal * 0.03);
  const net      = subtotal + vat - wht;

  const fromPrefill = (k) => prefill && prefill[k];
  const inputStyle  = (k) => ({ width: '100%', padding: '6px 8px', fontSize: '12px', border: `0.5px solid ${fromPrefill(k) ? '#5DCAA5' : '#ddd'}`, borderRadius: '6px', background: fromPrefill(k) ? '#f0faf6' : 'white', color: '#1a3a5c', outline: 'none' });

  const handleSubmit = () => {
    setSubmitted(true);
    setTimeout(() => { onSubmitted({ ...form, subtotal, vat, wht, net, status: 'submitted' }); }, 600);
  };

  if (submitted) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#27500A' }}>
      <div style={{ fontSize: '48px' }}>✅</div>
      <div style={{ fontSize: '16px', fontWeight: '500' }}>Submit สำเร็จ!</div>
      <div style={{ fontSize: '12px', color: '#888' }}>Invoice ถูกบันทึกลง Draft List แล้ว</div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ maxWidth: '800px' }}>
        {prefill && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', background: '#f0faf6', color: '#0F6E56', padding: '3px 10px', borderRadius: '20px', marginBottom: '12px', border: '0.5px solid #5DCAA5' }}>
            🔗 ดึงข้อมูลจาก {prefill.id || prefill.invoiceNo || 'OCR'}
          </div>
        )}

        {/* Header */}
        <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase', marginBottom: '12px' }}>Header</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[['vendor','Vendor'],['po','PO อ้างอิง'],['invoiceNo','เลขที่ Invoice'],['invoiceDate','วันที่ Invoice'],['dueDate','วันครบกำหนด'],['glAccount','GL Account']].map(([k, label]) => (
              <div key={k}>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>
                  {label} {fromPrefill(k) && <span style={{ fontSize: '10px', background: '#f0faf6', color: '#0F6E56', padding: '1px 5px', borderRadius: '4px' }}>จาก GR/OCR</span>}
                </label>
                <input value={form[k]} onChange={e => setField(k, e.target.value)}
                  placeholder={k === 'glAccount' ? 'Lookup จาก Master...' : ''}
                  style={inputStyle(k)} />
              </div>
            ))}
          </div>
        </div>

        {/* Lines */}
        <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase' }}>
              Line Items {prefill?.lines && <span style={{ fontSize: '10px', background: '#f0faf6', color: '#0F6E56', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px' }}>จาก GR/OCR</span>}
            </div>
            <button onClick={addLine} style={{ fontSize: '11px', padding: '4px 10px', border: '0.5px solid #ddd', borderRadius: '5px', background: 'white', cursor: 'pointer', color: '#555' }}>+ เพิ่มรายการ</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8f9fa' }}>
              {['รายการ','จำนวน','ราคา/หน่วย','ยอดรวม',''].map((h,i) => <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:'11px', color:'#888', fontWeight:'500', borderBottom:'0.5px solid #e8eaf0' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                  <td style={{ padding: '5px 8px' }}><input value={l.desc} onChange={e => setLine(i,'desc',e.target.value)} style={{ width:'100%', padding:'5px 7px', fontSize:'12px', border:'0.5px solid #ddd', borderRadius:'5px', outline:'none' }} /></td>
                  <td style={{ padding: '5px 8px', width: '70px' }}><input value={l.qty} onChange={e => setLine(i,'qty',e.target.value)} style={{ width:'100%', padding:'5px 7px', fontSize:'12px', border:'0.5px solid #ddd', borderRadius:'5px', outline:'none' }} /></td>
                  <td style={{ padding: '5px 8px', width: '100px' }}><input value={l.unit} onChange={e => setLine(i,'unit',e.target.value)} style={{ width:'100%', padding:'5px 7px', fontSize:'12px', border:'0.5px solid #ddd', borderRadius:'5px', outline:'none' }} /></td>
                  <td style={{ padding: '5px 10px', fontWeight:'500', color:'#1a3a5c', fontSize:'12px', width:'100px' }}>฿{fmt(l.amount||0)}</td>
                  <td style={{ padding: '5px 8px', width: '30px' }}>
                    <button onClick={() => removeLine(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ccc', fontSize:'14px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer totals + submit */}
        <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '24px', fontSize: '12px' }}>
            {[['ยอดก่อน VAT', `฿${fmt(subtotal)}`], ['VAT 7%', `฿${fmt(vat)}`], ['WHT 3%', `-฿${fmt(wht)}`]].map(([k,v]) => (
              <div key={k}><div style={{ color:'#888', marginBottom:'2px' }}>{k}</div><div style={{ fontWeight:'500' }}>{v}</div></div>
            ))}
            <div><div style={{ color:'#888', marginBottom:'2px' }}>ยอดสุทธิ</div><div style={{ fontWeight:'500', fontSize:'15px', color:'#1a3a5c' }}>฿{fmt(net)}</div></div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button style={{ padding:'8px 16px', border:'0.5px solid #ddd', borderRadius:'7px', background:'white', fontSize:'12px', cursor:'pointer', color:'#555' }}>💾 Save Draft</button>
            <button onClick={handleSubmit} style={{ padding:'8px 18px', background:'#1a3a5c', color:'white', border:'none', borderRadius:'7px', fontSize:'12px', cursor:'pointer', fontWeight:'500' }}>✅ Submit Invoice</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Draft List Tab ─────────────────────────────────────────────────────────────
function DraftListTab({ drafts, onEdit }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#999', textTransform: 'uppercase' }}>รายการ Draft / Submitted</div>
          <span style={{ fontSize: '11px', color: '#888' }}>{drafts.length} รายการ</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            {['Invoice No.','Vendor','GR อ้างอิง','วันที่','ยอดสุทธิ','สถานะ',''].map(h => <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:'11px', color:'#888', fontWeight:'500', borderBottom:'0.5px solid #e8eaf0' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {drafts.map(d => (
              <tr key={d.id} style={{ borderBottom:'0.5px solid #f5f5f5' }}>
                <td style={{ padding:'9px 12px', fontWeight:'500', color:'#1a3a5c', fontSize:'12px' }}>{d.invoiceNo}</td>
                <td style={{ padding:'9px 12px', fontSize:'12px' }}>{d.vendor}</td>
                <td style={{ padding:'9px 12px', fontSize:'12px', color:'#888' }}>{d.grRef || '-'}</td>
                <td style={{ padding:'9px 12px', fontSize:'12px', color:'#888' }}>{d.date}</td>
                <td style={{ padding:'9px 12px', fontSize:'12px', fontWeight:'500' }}>฿{fmt(d.total)}</td>
                <td style={{ padding:'9px 12px' }}>
                  <span style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'20px', background: d.status==='submitted' ? '#EAF3DE' : '#FFF3CD', color: d.status==='submitted' ? '#27500A' : '#856404', fontWeight:'500' }}>
                    {d.status === 'submitted' ? '✅ Submitted' : '📝 Draft'}
                  </span>
                </td>
                <td style={{ padding:'9px 12px' }}>
                  {d.status === 'draft' && (
                    <button onClick={() => onEdit(d)} style={{ fontSize:'11px', padding:'4px 10px', border:'0.5px solid #ddd', borderRadius:'5px', background:'white', cursor:'pointer', color:'#1a3a5c' }}>แก้ไข</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main APController ──────────────────────────────────────────────────────────
export default function APController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const [tab, setTab]         = useState(activeSubTab || 'gr');
  const [prefill, setPrefill] = useState(null);
  const [drafts, setDrafts]   = useState(MOCK_DRAFTS_INIT);

  const handleTabChange = (id) => {
    setTab(id);
    onSubTabChange?.(id);
  };

  const handlePullGR = (gr) => {
    setPrefill({ id: gr.id, vendor: gr.vendor, po: gr.po, lines: gr.lines });
    handleTabChange('form');
  };

  const handleOCRExtracted = (data) => {
    setPrefill(data);
    handleTabChange('form');
  };

  const handleSubmitted = (data) => {
    const newDraft = {
      id: `DRAFT-${Date.now()}`,
      invoiceNo: data.invoiceNo || `INV-${Date.now()}`,
      vendor: data.vendor,
      grRef: prefill?.id || '-',
      total: data.net,
      date: data.invoiceDate || new Date().toLocaleDateString('th-TH'),
      status: 'submitted',
    };
    setDrafts(prev => [newDraft, ...prev]);
    setPrefill(null);
    setTimeout(() => handleTabChange('drafts'), 800);
  };

  const handleEdit = (d) => {
    setPrefill({ vendor: d.vendor, invoiceNo: d.invoiceNo });
    handleTabChange('form');
  };

  return (
    <div style={{ ...s.wrap }}>
      <div style={s.topbar}>
        <span style={{ fontSize: '18px' }}>🧾</span>
        <div>
          <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>AP Controller</div>
          <div style={{ fontSize: '11px', color: '#aaa' }}>Accounts Payable Invoice Management</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: '#aaa' }}>Draft auto-saved</span>
          <span style={{ fontSize: '14px' }}>✅</span>
        </div>
      </div>

      <TabBar active={tab} onChange={handleTabChange} />

      <div style={s.body}>
        {tab === 'gr'     && <GRTab onPull={handlePullGR} />}
        {tab === 'ocr'    && <OCRTab onExtracted={handleOCRExtracted} />}
        {tab === 'form'   && <InvoiceFormTab prefill={prefill} onSubmitted={handleSubmitted} />}
        {tab === 'drafts' && <DraftListTab drafts={drafts} onEdit={handleEdit} />}
      </div>
    </div>
  );
}