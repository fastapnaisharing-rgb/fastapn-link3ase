import React, { useState, useEffect, useRef } from 'react';

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_GRS = [
  {
    id: 'GR-2026-00421', vendor: 'Thai Komori Co., Ltd.', po: 'PO-1089', total: 185000, status: 'ready',
    lines: [
      { desc: 'กระดาษ A4 80g',  qty: 500, unit: 180 },
      { desc: 'หมึกพิมพ์ดำ',    qty: 20,  unit: 2500 },
      { desc: 'ค่าขนส่ง',       qty: 1,   unit: 5000 },
    ],
  },
  {
    id: 'GR-2026-00415', vendor: 'Bangkok Tech Supply', po: 'PO-1077', total: 340000, status: 'ready',
    lines: [
      { desc: 'Laptop Dell XPS',  qty: 2,  unit: 55000 },
      { desc: 'Monitor 27"',      qty: 4,  unit: 12000 },
      { desc: 'Keyboard + Mouse', qty: 10, unit: 2800  },
    ],
  },
  {
    id: 'GR-2026-00418', vendor: 'Siam Printing Ltd.', po: 'PO-1082', total: 92500, status: 'used',
    lines: [
      { desc: 'กระดาษถ่ายเอกสาร', qty: 200, unit: 300 },
      { desc: 'ปากกา',            qty: 50,  unit: 85  },
    ],
  },
];

const PERIOD_OPTIONS = ['Current', 'Pre-Close'];

// ─────────────────────────────────────────────────────────────────────────────
// BUSearchPopup — ค้นหา BU จาก infoItems cache (company_list)
// Props:
//   show        — boolean
//   onClose     — () => void
//   onSelect    — (item) => void   item = row จาก company_list
//   infoItems   — array ที่ BusinessUnit โหลดไว้แล้ว
// ─────────────────────────────────────────────────────────────────────────────
function BUSearchPopup({ show, onClose, onSelect, infoItems = [] }) {
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(-1);
  const inputRef            = useRef(null);
  const listRef             = useRef(null);

  // reset & focus ทุกครั้งที่เปิด
  useEffect(() => {
    if (show) { setQuery(''); setActive(-1); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [show]);

  // Esc ปิด popup
  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose]);

  if (!show) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? infoItems.filter(i =>
        i['bu']?.toLowerCase().includes(q) ||
        i['THAI COMPANY NAME']?.toLowerCase().includes(q) ||
        i['ENGLISH COMPANY NAME']?.toLowerCase().includes(q) ||
        i['TAX ID']?.includes(q)
      )
    : infoItems;

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active]); }
  };

  // scroll active row into view
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: '10px', width: '680px', maxWidth: '95vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(26,58,92,0.18)' }}>

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '15px' }}>🏢</span>
          <span style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c', flex: 1 }}>เลือก Business Unit</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '20px', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        {/* Search box */}
        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #f0f0f0', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: '14px', pointerEvents: 'none' }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(-1); }}
              onKeyDown={handleKey}
              placeholder="พิมพ์ BU, ชื่อบริษัท, Tax ID..."
              style={{ width: '100%', padding: '8px 34px 8px 34px', fontSize: '13px', border: '0.5px solid #ddd', borderRadius: '7px', outline: 'none', boxSizing: 'border-box', background: '#fafafa' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: '16px', lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#aaa' }}>
            {filtered.length} รายการ{query ? ` · ค้นหา "${query}"` : ''}{infoItems.length > 0 ? '' : ' — (ยังโหลดข้อมูลไม่สำเร็จ)'} — ↑↓ นำทาง · Enter เลือก · Esc ปิด
          </div>
        </div>

        {/* Result table */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>🔍</div>
              ไม่พบข้อมูล BU {query ? `"${query}"` : ''}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {[['BU','70px'],['ชื่อบริษัท',''],['Tax ID','130px'],['Book','70px'],['AP GRT','90px']].map(([h, w]) => (
                    <th key={h} style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', width: w || undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const isActive = i === active;
                  return (
                    <tr
                      key={item.id}
                      data-row={i}
                      onClick={() => onSelect(item)}
                      onMouseEnter={() => setActive(i)}
                      style={{ background: isActive ? '#e8f0fb' : 'white', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' }}
                    >
                      <td style={{ padding: '9px 10px', fontWeight: '600', color: '#1a3a5c', whiteSpace: 'nowrap' }}>
                        {item['bu'] || '-'}
                      </td>
                      <td style={{ padding: '9px 10px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: isActive ? '500' : '400', color: '#333' }}>{item['THAI COMPANY NAME'] || '-'}</div>
                        <div style={{ fontSize: '10px', color: '#999', marginTop: '1px' }}>{item['ENGLISH COMPANY NAME'] || ''}</div>
                      </td>
                      <td style={{ padding: '9px 10px', color: '#555', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {item['TAX ID'] || '-'}
                      </td>
                      <td style={{ padding: '9px 10px', color: '#555', whiteSpace: 'nowrap' }}>
                        {item['BOOK'] || '-'}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        {item['AP GRT Control']
                          ? <span style={{ ...bdgBlue, fontSize: '10px' }}>{item['AP GRT Control']}</span>
                          : <span style={{ color: '#ccc' }}>-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => Math.round(n).toLocaleString('th-TH');

// ── Shared styles ─────────────────────────────────────────────────────────────
const card = {
  background: 'white',
  border: '0.5px solid #e8eaf0',
  borderRadius: '10px',
  overflow: 'hidden',
  marginBottom: '10px',
};
const cardHead = {
  padding: '9px 14px',
  borderBottom: '0.5px solid #e8eaf0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const cardLabel = {
  fontSize: '10px',
  fontWeight: '600',
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};
const cardBody = { padding: '12px 14px' };

const fieldWrap = { display: 'flex', flexDirection: 'column', gap: '3px' };
const fieldLabel = { fontSize: '11px', color: '#888' };
const fieldInput = (pre) => ({
  width: '100%',
  padding: '5px 8px',
  fontSize: '12px',
  border: `0.5px solid ${pre ? '#5DCAA5' : '#ddd'}`,
  borderRadius: '6px',
  background: pre ? '#f0faf6' : 'white',
  color: '#1a3a5c',
  outline: 'none',
});
const btnPrimary = {
  padding: '7px 16px',
  background: '#1a3a5c',
  color: 'white',
  border: 'none',
  borderRadius: '7px',
  fontSize: '12px',
  cursor: 'pointer',
  fontWeight: '500',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
};
const btnOutline = {
  padding: '5px 12px',
  background: 'white',
  color: '#555',
  border: '0.5px solid #ddd',
  borderRadius: '6px',
  fontSize: '12px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};
const btnSmall = {
  padding: '3px 9px',
  background: 'transparent',
  color: '#555',
  border: '0.5px solid #ddd',
  borderRadius: '5px',
  fontSize: '11px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
};

const bdgGreen  = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#EAF3DE', color: '#27500A' };
const bdgAmber  = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#FAEEDA', color: '#633806' };
const bdgBlue   = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#E6F1FB', color: '#0C447C' };
const bdgRed    = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#FCEBEB', color: '#791F1F' };
const bdgGray   = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#F1EFE8', color: '#444441' };

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepBar({ step, batchConfig, onGo }) {
  const steps = [
    { n: 1, label: 'Batch setup' },
    { n: 2, label: 'Invoice entry' },
    { n: 3, label: 'Generate & export' },
  ];
  return (
    <div style={{ background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '0 18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {steps.map((s, i) => {
        const isDone   = s.n < step;
        const isActive = s.n === step;
        return (
          <React.Fragment key={s.n}>
            {i > 0 && <span style={{ color: '#ccc', margin: '0 12px', fontSize: '14px', userSelect: 'none' }}>›</span>}
            <div
              onClick={() => s.n < step && onGo(s.n)}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 0', cursor: s.n < step ? 'pointer' : 'default' }}
            >
              <div style={{
                width: '21px', height: '21px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: '500', flexShrink: 0,
                background:   isDone ? '#EAF3DE' : isActive ? '#1a3a5c' : 'transparent',
                border:       isDone ? '1.5px solid #97C459' : isActive ? '1.5px solid #1a3a5c' : '1.5px solid #ddd',
                color:        isDone ? '#27500A' : isActive ? 'white' : '#888',
              }}>
                {isDone ? '✓' : s.n}
              </div>
              <span style={{ fontSize: '12px', fontWeight: isActive ? '500' : '400', color: isActive ? '#1a3a5c' : '#888' }}>{s.label}</span>
            </div>
          </React.Fragment>
        );
      })}

      {step > 1 && batchConfig && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ ...bdgBlue, fontSize: '11px' }}>
            BATCH-2026-0090 · {batchConfig.bu}
          </span>
          <span style={{ fontSize: '11px', color: '#aaa' }}>Auto-saved ✓</span>
        </div>
      )}
    </div>
  );
}

// ── BU Info Panel ─────────────────────────────────────────────────────────────
function BuInfoPanel({ buInfo, grt, grn, onGrtChange, onGrnChange }) {
  const rows = [
    ['Company name', buInfo?.['THAI COMPANY NAME']],
    ['Tax ID',       buInfo?.['TAX ID']],
    ['Company code', buInfo?.['COMPANY CODE']],
    ['Book',         buInfo?.['BOOK']],
    ['Segment3',     buInfo?.['SEGMENT3']],
    ['GRT status',   buInfo?.['AP GRT Control']],
  ];

  const infoRowStyle = {
    display: 'grid',
    gridTemplateColumns: '110px 1fr',
    borderBottom: '0.5px solid #f0f0f0',
  };
  const keyStyle = {
    fontSize: '11px',
    color: '#999',
    padding: '7px 10px',
    background: '#fafafa',
    borderRight: '0.5px solid #f0f0f0',
    display: 'flex',
    alignItems: 'center',
  };
  const valStyle = {
    fontSize: '12px',
    color: buInfo ? '#1a3a5c' : '#ccc',
    padding: '7px 10px',
    background: 'white',
    display: 'flex',
    alignItems: 'center',
    fontStyle: buInfo ? 'normal' : 'italic',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* BU Info box */}
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.map(([key, val], i) => (
          <div key={key} style={{ ...infoRowStyle, borderBottom: i < rows.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}>
            <div style={keyStyle}>{key}</div>
            <div style={valStyle}>{val || '—'}</div>
          </div>
        ))}
      </div>

      {/* GRT / GRN inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={fieldWrap}>
          <label style={fieldLabel}>GRT</label>
          <input
            value={grt}
            onChange={e => onGrtChange(e.target.value)}
            placeholder="—"
            style={{ ...fieldInput(false), height: '30px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={fieldWrap}>
          <label style={fieldLabel}>GRN</label>
          <input
            value={grn}
            onChange={e => onGrnChange(e.target.value)}
            placeholder="—"
            style={{ ...fieldInput(false), height: '30px', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Phase 1: Batch Setup ───────────────────────────────────────────────────────
// infoItems = company_list cache passed from BusinessUnit (หรือ parent component)
function BatchSetup({ onStart, infoItems = [] }) {
  const [bu, setBu]                   = useState('');
  const [receiveDate, setReceiveDate] = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [period, setPeriod]           = useState('Current');
  const [grt, setGrt]                 = useState('');
  const [grn, setGrn]                 = useState('');
  const [buInfo, setBuInfo]           = useState(null);
  const [showPopup, setShowPopup]     = useState(false);

  // เลือก BU จาก popup → populate ฝั่งขวา
  const handleSelectBU = (item) => {
    setBu(item['bu'] || '');
    setBuInfo(item);
    setShowPopup(false);
  };

  // พิมพ์แล้ว Enter → หา exact match จาก cache โดยไม่ต้องเปิด popup
  const handleBuKeyDown = (e) => {
    if (e.key === 'Enter') {
      const match = infoItems.find(i => i['bu']?.toLowerCase() === bu.trim().toLowerCase());
      setBuInfo(match || null);
    }
  };

  const handleBuChange = (val) => { setBu(val); if (!val) setBuInfo(null); };

  const inputBase = {
    width: '100%', height: '32px', padding: '0 8px', fontSize: '12px',
    border: '0.5px solid #ddd', borderRadius: '6px', background: 'white',
    color: '#1a3a5c', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <>
      {/* ── BU Search Popup ── */}
      <BUSearchPopup
        show={showPopup}
        onClose={() => setShowPopup(false)}
        onSelect={handleSelectBU}
        infoItems={infoItems}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

      {/* ── Main Setup Card ── */}
      <div style={card}>
        <div style={cardHead}>
          <span style={cardLabel}>Batch setup</span>
        </div>
        <div style={cardBody}>

          {/* Info banner */}
          <div style={{ background: '#f0f6ff', border: '0.5px solid #cde0f7', borderRadius: '6px', padding: '7px 12px', fontSize: '12px', color: '#4a6fa5', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ fontSize: '13px' }}>ℹ️</span>
            กรอกข้อมูลเพื่อสร้าง Batch — Batch ID จะถูก generate อัตโนมัติรูปแบบ{' '}
            <code style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1a3a5c', background: '#e0eaf8', padding: '1px 5px', borderRadius: '3px' }}>BATCH-YYYY-XXXX</code>
          </div>

          {/* 2-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

            {/* ── LEFT: Setup fields ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* BU */}
              <div style={fieldWrap}>
                <label style={fieldLabel}>BU <span style={{ color: '#e24b4a' }}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={bu}
                    onChange={e => handleBuChange(e.target.value)}
                    onKeyDown={handleBuKeyDown}
                    placeholder="ระบุตัวย่อ BU..."
                    style={{ ...inputBase, paddingRight: '36px' }}
                  />
                  {/* 🔍 ปุ่มเปิด Popup */}
                  <button
                    onClick={() => setShowPopup(true)}
                    style={{
                      position: 'absolute', right: 0, top: 0,
                      height: '32px', width: '32px',
                      background: '#1a3a5c', border: 'none',
                      borderRadius: '0 6px 6px 0',
                      color: 'white', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '13px',
                    }}
                    title="เปิด Popup ค้นหา BU"
                  >
                    🔍
                  </button>
                </div>
                {/* hint แสดงชื่อบริษัทที่เลือก */}
                {buInfo && (
                  <span style={{ fontSize: '10px', color: '#0F6E56', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ✓ {buInfo['THAI COMPANY NAME'] || buInfo['ENGLISH COMPANY NAME']}
                  </span>
                )}
              </div>

              {/* Receive Date / Due Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                <div style={fieldWrap}>
                  <label style={fieldLabel}>Receive date</label>
                  <input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} style={inputBase} />
                </div>
                <div style={fieldWrap}>
                  <label style={fieldLabel}>Due date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputBase} />
                </div>
              </div>

              {/* Period */}
              <div style={fieldWrap}>
                <label style={fieldLabel}>Period</label>
                <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inputBase, appearance: 'auto', cursor: 'pointer' }}>
                  {PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

              {/* Start Batch */}
              <div style={{ marginTop: '4px' }}>
                <button
                  style={{ ...btnPrimary, width: '100%', justifyContent: 'center' }}
                  onClick={() => onStart({ bu: bu || '-', receiveDate, dueDate, period, grt, grn, buInfo })}
                >
                  ▶ Start Batch
                </button>
              </div>
            </div>

            {/* ── RIGHT: BU Info panel ── */}
            <div>
              <div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                BU Info
              </div>
              <BuInfoPanel
                buInfo={buInfo}
                grt={grt}
                grn={grn}
                onGrtChange={setGrt}
                onGrnChange={setGrn}
              />
            </div>

          </div>
        </div>
      </div>

      {/* Batch History */}
      <div style={card}>
        <div style={cardHead}>
          <span style={cardLabel}>Batch history</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {['Batch ID','Business Unit','Period','Inv.','ยอดรวม','สถานะ'].map(h => (
                <th key={h} style={{ padding: '6px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: '18px', fontSize: '12px' }}>ยังไม่มีประวัติ Batch</td></tr>
          </tbody>
        </table>
      </div>

    </div>
    </>
  );
}

// ── Phase 2: Invoice Entry ─────────────────────────────────────────────────────
function InvoiceEntry({ batchConfig, invoices, setInvoices, onNext }) {
  const [grOpen, setGrOpen]     = useState(false);
  const [grSearch, setGrSearch] = useState('');
  const [grSel, setGrSel]       = useState(null);
  const [form, setForm]         = useState({ vendor: '', po: '', invoiceNo: '', invoiceDate: '', dueDate: '', glAccount: '' });
  const [lines, setLines]       = useState([{ desc: '', qty: '', unit: '', amount: 0 }]);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setLine  = (i, k, v) => {
    const ls = [...lines];
    ls[i] = { ...ls[i], [k]: v };
    if (k === 'qty' || k === 'unit') ls[i].amount = (Number(ls[i].qty) || 0) * (Number(ls[i].unit) || 0);
    setLines(ls);
  };

  const filteredGRs = MOCK_GRS.filter(g =>
    g.id.toLowerCase().includes(grSearch.toLowerCase()) ||
    g.vendor.toLowerCase().includes(grSearch.toLowerCase())
  );

  const pickGR = (gr) => {
    setGrSel(gr);
    setForm(f => ({ ...f, vendor: gr.vendor, po: gr.po }));
    setLines(gr.lines.map(l => ({ ...l, amount: l.qty * l.unit })));
    setGrOpen(false);
  };

  const subtotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const vat      = Math.round(subtotal * 0.07);
  const wht      = Math.round(subtotal * 0.03);
  const net      = subtotal + vat - wht;

  const addInvoice = () => {
    const inv = {
      id: `INV-2026-0${141 + invoices.length}`,
      vendor: form.vendor || 'Vendor',
      gr: grSel?.id || '-',
      raw: subtotal,
      net,
    };
    setInvoices(prev => [...prev, inv]);
    setForm({ vendor: '', po: '', invoiceNo: '', invoiceDate: '', dueDate: '', glAccount: '' });
    setLines([{ desc: '', qty: '', unit: '', amount: 0 }]);
    setGrSel(null);
  };

  const batchTotal = invoices.reduce((s, v) => s + v.net, 0);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>

        {/* Left: Invoice Form */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={card}>
            <div style={cardHead}>
              <span style={cardLabel}>Invoice form</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={btnSmall} onClick={() => setGrOpen(v => !v)}>
                  📋 GR Reference {grOpen ? '▲' : '▼'}
                </button>
                <button style={btnSmall}>🔍 OCR</button>
              </div>
            </div>

            {grOpen && (
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid #e8eaf0' }}>
                <input
                  value={grSearch}
                  onChange={e => setGrSearch(e.target.value)}
                  placeholder="ค้นหา GR No. / Vendor..."
                  style={{ width: '100%', padding: '5px 9px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', marginBottom: '8px', outline: 'none' }}
                />
                {filteredGRs.map(gr => (
                  <div
                    key={gr.id}
                    onClick={() => gr.status === 'ready' && pickGR(gr)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '9px',
                      padding: '7px 9px',
                      border: `0.5px solid ${grSel?.id === gr.id ? '#1a3a5c' : '#e8eaf0'}`,
                      borderRadius: '6px', marginBottom: '5px',
                      cursor: gr.status === 'ready' ? 'pointer' : 'default',
                      background: grSel?.id === gr.id ? '#f0f7ff' : 'white',
                      opacity: gr.status === 'used' ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>{gr.id}</div>
                      <div style={{ fontSize: '11px', color: '#888' }}>{gr.vendor} · {gr.po} · ฿{fmt(gr.total)}</div>
                    </div>
                    <span style={gr.status === 'ready' ? bdgGreen : bdgGray}>{gr.status === 'ready' ? 'พร้อมใช้' : 'ใช้แล้ว'}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={cardBody}>
              {grSel && (
                <div style={{ marginBottom: '9px' }}>
                  <span style={{ fontSize: '11px', background: '#f0faf6', color: '#0F6E56', padding: '2px 9px', borderRadius: '20px', border: '0.5px solid #5DCAA5' }}>
                    🔗 ดึงจาก {grSel.id}
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px', marginBottom: '9px' }}>
                {[
                  ['vendor',      'Vendor',         ''],
                  ['po',          'PO อ้างอิง',      'PO-XXXX'],
                  ['invoiceNo',   'เลขที่ Invoice',   'INV-XXXX-XXXX'],
                  ['invoiceDate', 'วันที่ Invoice',   'DD/MM/YYYY'],
                  ['dueDate',     'วันครบกำหนด',     'DD/MM/YYYY'],
                  ['glAccount',   'GL Account',       'Lookup จาก Master...'],
                ].map(([key, label, placeholder]) => (
                  <div key={key} style={fieldWrap}>
                    <label style={fieldLabel}>{label}</label>
                    <input
                      value={form[key]}
                      onChange={e => setField(key, e.target.value)}
                      placeholder={placeholder}
                      style={fieldInput(grSel && (key === 'vendor' || key === 'po'))}
                    />
                  </div>
                ))}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '9px', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {[['รายการ','44%'],['จำนวน','14%'],['ราคา/หน่วย','20%'],['ยอดรวม','18%'],['','4%']].map(([h, w]) => (
                      <th key={h} style={{ padding: '6px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', width: w }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 || (lines.length === 1 && !lines[0].desc) ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: '#aaa', padding: '18px', fontSize: '12px' }}>
                        ยังไม่มีรายการ — ดึงจาก GR หรือกรอกเอง
                      </td>
                    </tr>
                  ) : lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '0.5px solid #f0f0f0', background: grSel ? '#f0faf6' : 'white' }}>
                      <td style={{ padding: '5px 8px' }}>
                        <input value={l.desc} onChange={e => setLine(i, 'desc', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '4px', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <input value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '4px', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <input value={l.unit} onChange={e => setLine(i, 'unit', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '4px', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '5px 9px', fontWeight: '500', color: '#1a3a5c' }}>฿{fmt(l.amount || 0)}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: '14px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button style={btnSmall} onClick={() => setLines(ls => [...ls, { desc: '', qty: '', unit: '', amount: 0 }])}>
                  + เพิ่มบรรทัด
                </button>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '12px' }}>
                  <span style={{ color: '#888' }}>
                    ยอดสุทธิ <strong style={{ color: '#1a3a5c', fontSize: '14px' }}>฿{fmt(net)}</strong>
                  </span>
                  <button style={btnPrimary} onClick={addInvoice}>
                    + เพิ่มใน Batch
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ width: '186px', minWidth: '186px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>Batch info</span></div>
            <div style={{ padding: '10px 13px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {[
                ['Batch ID',   <span style={{ fontWeight: '500', color: '#1a3a5c', fontSize: '11px', fontFamily: 'monospace' }}>2026-0090</span>],
                ['Business',   <span style={{ fontSize: '11px' }}>{batchConfig.bu}</span>],
                ['Period',     <span>{batchConfig.period || '-'}</span>],
                ['สถานะ',      <span style={bdgAmber}>In progress</span>],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#888' }}>{k}</span>{v}
                </div>
              ))}
              <div style={{ borderTop: '0.5px solid #e8eaf0', paddingTop: '8px' }}>
                <button style={{ ...btnSmall, width: '100%', justifyContent: 'center' }}>✏️ แก้ไข setup</button>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={cardHead}>
              <span style={cardLabel}>Invoice ใน Batch</span>
              <span style={invoices.length ? bdgBlue : bdgRed}>{invoices.length}</span>
            </div>
            <div style={{ padding: '8px' }}>
              {invoices.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#aaa', fontSize: '12px', padding: '18px 0' }}>ยังไม่มี Invoice</div>
              ) : invoices.map(v => (
                <div key={v.id} style={{ padding: '5px 7px', border: '0.5px solid #e8eaf0', borderRadius: '6px', marginBottom: '5px', fontSize: '11px' }}>
                  <div style={{ fontWeight: '500', color: '#1a3a5c' }}>{v.id}</div>
                  <div style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                    <span style={{ color: '#aaa' }}>{v.gr}</span>
                    <span style={{ fontWeight: '500' }}>฿{fmt(v.net)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '6px 10px', borderTop: '0.5px solid #e8eaf0', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>รวม</span>
              <span style={{ fontWeight: '500', color: '#1a3a5c' }}>฿{fmt(invoices.reduce((s, v) => s + v.net, 0))}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
        <button style={btnPrimary} onClick={onNext}>
          ถัดไป: Generate &amp; export →
        </button>
      </div>
    </div>
  );
}

// ── Phase 3: Generate & Export ─────────────────────────────────────────────────
function GenerateExport({ invoices, onNewBatch, onBack }) {
  const [opts, setOpts]         = useState({ xlsx: true, txt: true, wht: false, vat: false });
  const [exported, setExported] = useState(false);

  const toggleOpt = (k) => setOpts(o => ({ ...o, [k]: !o[k] }));

  const subtotal = invoices.reduce((s, v) => s + v.raw, 0);
  const vat      = Math.round(subtotal * 0.07);
  const net      = invoices.reduce((s, v) => s + v.net, 0);

  const doExport = () => {
    if (!invoices.length) { alert('ยังไม่มี Invoice ใน Batch'); return; }
    setExported(true);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>สรุป Batch 2026-0090</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {[['Invoice No.','25%'],['Vendor','30%'],['GR อ้างอิง','22%'],['ยอดสุทธิ','23%']].map(([h, w]) => (
                    <th key={h} style={{ padding: '6px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: '18px' }}>ยังไม่มี Invoice ใน Batch</td></tr>
                ) : invoices.map(v => (
                  <tr key={v.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
                    <td style={{ padding: '7px 9px', fontWeight: '500', color: '#1a3a5c' }}>{v.id}</td>
                    <td style={{ padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor}</td>
                    <td style={{ padding: '7px 9px', color: '#888' }}>{v.gr}</td>
                    <td style={{ padding: '7px 9px' }}>
                      {exported
                        ? <span style={bdgGreen}>exported</span>
                        : <span style={{ fontWeight: '500' }}>฿{fmt(v.net)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', borderTop: '0.5px solid #e8eaf0' }}>
              {[
                ['Invoice',       invoices.length],
                ['ยอดก่อน VAT',   `฿${fmt(subtotal)}`],
                ['VAT 7%',        `฿${fmt(vat)}`],
                ['ยอดสุทธิรวม',   `฿${fmt(net)}`],
              ].map(([label, val], i, arr) => (
                <div key={label} style={{ flex: 1, padding: '9px', textAlign: 'center', borderRight: i < arr.length - 1 ? '0.5px solid #e8eaf0' : 'none' }}>
                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>{label}</div>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: '186px', minWidth: '186px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>Export options</span></div>
            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                ['xlsx', 'ไฟล์โหลด (.xlsx)'],
                ['txt',  'AP Interface (.txt)'],
                ['wht',  'WHT Certificate (.pdf)'],
                ['vat',  'VAT Summary (.xlsx)'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts[key]} onChange={() => toggleOpt(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>Actions</span></div>
            <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <button
                style={{ ...btnPrimary, width: '100%', justifyContent: 'center', background: exported ? '#27500A' : '#1a3a5c' }}
                onClick={doExport}
              >
                {exported ? '✓ Exported' : '⬇ Generate & export'}
              </button>
              <button style={{ ...btnOutline, width: '100%', justifyContent: 'center' }} onClick={onBack}>
                ← กลับแก้ไข
              </button>
            </div>
          </div>

          {exported && (
            <div style={card}>
              <div style={cardHead}><span style={cardLabel}>ไฟล์ที่ Generate</span></div>
              <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {opts.xlsx && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}>
                    <span style={{ color: '#27500A' }}>📊</span>
                    <span style={{ flex: 1 }}>AP_LOAD_0090.xlsx</span>
                    <span style={{ color: '#888', cursor: 'pointer' }}>⬇</span>
                  </div>
                )}
                {opts.txt && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}>
                    <span style={{ color: '#0C447C' }}>📄</span>
                    <span style={{ flex: 1 }}>AP_INTERFACE_0090.txt</span>
                    <span style={{ color: '#888', cursor: 'pointer' }}>⬇</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
        <button style={btnOutline} onClick={onNewBatch}>
          + สร้าง Batch ใหม่
        </button>
      </div>
    </div>
  );
}

// ── Main APController ──────────────────────────────────────────────────────────
// infoItems — pass company_list cache from BusinessUnit:
//   <APController infoItems={infoItems} ... />
export default function APController({ activeSubTab, onSubTabChange, flyoutOpen, infoItems = [] }) {
  const [step, setStep]               = useState(1);
  const [batchConfig, setBatchConfig] = useState(null);
  const [invoices, setInvoices]       = useState([]);

  const handleStart = (config) => {
    setBatchConfig(config);
    setStep(2);
  };

  const handleNewBatch = () => {
    setBatchConfig(null);
    setInvoices([]);
    setStep(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f7fa', fontFamily: 'sans-serif', fontSize: '13px', overflow: 'hidden' }}>

      <div style={{ background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '9px 18px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <span style={{ fontSize: '17px' }}>🧾</span>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>AP Controller</div>
          <div style={{ fontSize: '11px', color: '#aaa' }}>Accounts Payable Invoice Management</div>
        </div>
      </div>

      <StepBar step={step} batchConfig={batchConfig} onGo={setStep} />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {step === 1 && <BatchSetup onStart={handleStart} infoItems={infoItems} />}
        {step === 2 && (
          <InvoiceEntry
            batchConfig={batchConfig}
            invoices={invoices}
            setInvoices={setInvoices}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <GenerateExport
            invoices={invoices}
            onNewBatch={handleNewBatch}
            onBack={() => setStep(2)}
          />
        )}
      </div>
    </div>
  );
}