import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

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

  // scroll active row into view — ต้องอยู่ก่อน early return ทุก Hook
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!show) return null;

  const q = query.trim().toLowerCase();
  const raw = q
    ? infoItems.filter(i =>
        i['bu']?.toLowerCase().includes(q) ||
        i['THAI COMPANY NAME']?.toLowerCase().includes(q) ||
        i['ENGLISH COMPANY NAME']?.toLowerCase().includes(q) ||
        i['TAX ID']?.includes(q)
      )
    : infoItems;

  // deduplicate โดยใช้ TAX ID เป็น key (ถ้า DB มีข้อมูลซ้ำ)
  const seen = new Set();
  const filtered = raw.filter(i => {
    const key = i['TAX ID'] || i['bu'] || i.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active]); }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: '14px', width: '700px', maxWidth: '95vw', height: '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22), 0 4px 16px rgba(0,0,0,0.08)' }}>

        {/* ── Header ── */}
        <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>เลือก Business Unit</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>
              {infoItems.length > 0 ? `${filtered.length} รายการ${query ? ` · ค้นหา "${query}"` : ''}` : 'กำลังโหลด...'}
            </div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
        </div>

        {/* ── Search box ── */}
        <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(-1); }}
              onKeyDown={handleKey}
              placeholder="พิมพ์ BU, ชื่อบริษัท, Tax ID..."
              style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c', transition: 'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor = '#1a3a5c'}
              onBlur={e => e.target.style.borderColor = '#e2e6ed'}
            />
            {query && (
              <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ marginTop: '7px', fontSize: '11px', color: '#bbb', display: 'flex', gap: '12px' }}>
            {[['↑↓','นำทาง'], ['Enter','เลือก'], ['Esc','ปิด']].map(([key, label]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <kbd style={{ background: '#f0f1f3', border: '0.5px solid #dde', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>{key}</kbd>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Result table ── */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '56px', textAlign: 'center', color: '#ccc' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔍</div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>ไม่พบข้อมูล BU {query ? `"${query}"` : ''}</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {[['BU','72px'],['ชื่อบริษัท',''],['Tax ID','132px'],['Book','68px'],['AP GRT','88px']].map(([h, w]) => (
                    <th key={h} style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const isAct = i === active;
                  return (
                    <tr
                      key={item.id}
                      data-row={i}
                      onClick={() => onSelect(item)}
                      onMouseEnter={() => setActive(i)}
                      style={{ background: isAct ? '#eef3fb' : 'white', cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6', transition: 'background 0.08s' }}
                    >
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-block', background: isAct ? '#1a3a5c' : '#f0f3f8', color: isAct ? 'white' : '#1a3a5c', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.03em', transition: 'all 0.1s' }}>
                          {item['bu'] || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '500', color: '#1a2a3a', fontSize: '12px' }}>{item['THAI COMPANY NAME'] || '-'}</div>
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>{item['ENGLISH COMPANY NAME'] || ''}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#778', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                        {item['TAX ID'] || '-'}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', fontWeight: '500' }}>
                          {item['BOOK'] || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {item['AP GRT Control'] ? (
                          <span style={{
                            fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '600',
                            background: item['AP GRT Control'] === 'Auto' ? '#EAF3DE' : '#E6F1FB',
                            color: item['AP GRT Control'] === 'Auto' ? '#27500A' : '#0C447C',
                          }}>{item['AP GRT Control']}</span>
                        ) : <span style={{ color: '#ddd' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {infoItems.length} รายการ</span>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>
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
function BuInfoPanel({ buInfo, apGrt, apGrn, apGrtRunning, apGrnRunning, onApGrtChange, onApGrnChange, onApGrtRunningChange, onApGrnRunningChange }) {
  const rows = [
    ['Company name', buInfo?.['THAI COMPANY NAME']],
    ['Tax ID',       buInfo?.['TAX ID']],
    ['Company code', buInfo?.['COMPANY CODE']],
    ['Book',         buInfo?.['BOOK']],
    ['Segment3',     buInfo?.['SEGMENT3']],
    ['GRT status',   buInfo?.['AP GRT Control']],
  ];

  const infoRowStyle = { display: 'grid', gridTemplateColumns: '110px 1fr' };
  const keyStyle = { fontSize: '11px', color: '#999', padding: '7px 10px', background: '#fafafa', borderRight: '0.5px solid #f0f0f0', display: 'flex', alignItems: 'center' };
  const valStyle = (hasVal) => ({ fontSize: '12px', color: hasVal ? '#1a3a5c' : '#ccc', padding: '7px 10px', background: 'white', display: 'flex', alignItems: 'center', fontStyle: hasVal ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    const numInput = (val, onChange, isRed = false) => (
    <input
        type="number" min="0" value={val}
        onChange={e => onChange(e.target.value)}
        style={{
        width: '100%', height: '28px', padding: '0 8px', fontSize: '12px',
        border: '0.5px solid #ddd', borderRadius: '5px', background: 'white',
        color: isRed ? '#c0392b' : '#1a2a3a',
        outline: 'none', boxSizing: 'border-box', textAlign: 'right'
        }}
    />
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* BU Info rows */}
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.map(([key, val], i) => (
          <div key={key} style={{ ...infoRowStyle, borderBottom: i < rows.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}>
            <div style={keyStyle}>{key}</div>
            <div style={valStyle(!!val)} title={val || ''}>{val || '—'}</div>
          </div>
        ))}
      </div>

      {/* AP-GRT / AP-GRN / IE-GRT / IE-GRN */}
            <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0', padding: '5px 10px' }}>
                <div style={{ fontSize: '10px', fontWeight: '600', color: '#1a3a5c', letterSpacing: '0.05em', textTransform: 'uppercase' }}>AP</div>
            </div>
            {/* 4 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: 'none' }}>
                {/* GRT Amount */}
                <div style={{ padding: '7px 10px', borderRight: '0.5px solid #f0f0f0' }}>
                <div style={{ fontSize: '10px', color: '#1a2a3a', fontWeight: '600', marginBottom: '4px' }}>GRT</div>
                {numInput(apGrt, onApGrtChange)}
                </div>
                {/* GRT Running No. */}
                <div style={{ padding: '7px 10px', borderRight: '0.5px solid #f0f0f0' }}>
                <div style={{ fontSize: '10px', color: '#1a2a3a', fontWeight: '600', marginBottom: '4px' }}>Running No.</div>
                <input
                    type="text"
                    value={apGrtRunning}
                    onChange={e => onApGrtRunningChange(e.target.value)}
                    style={{ width: '100%', height: '28px', padding: '0 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '5px', background: 'white', color: '#1a2a3a', outline: 'none', boxSizing: 'border-box' }}
                />
                </div>
                {/* GRN Amount */}
                <div style={{ padding: '7px 10px', borderRight: '0.5px solid #f0f0f0' }}>
                <div style={{ fontSize: '10px', color: '#c0392b', fontWeight: '600', marginBottom: '4px' }}>GRN</div>
                {numInput(apGrn, onApGrnChange, true)}
                </div>
                {/* GRN Running No. */}
                <div style={{ padding: '7px 10px' }}>
                <div style={{ fontSize: '10px', color: '#c0392b', fontWeight: '600', marginBottom: '4px' }}>Running No.</div>
                <input
                    type="text"
                    value={apGrnRunning}
                    onChange={e => onApGrnRunningChange(e.target.value)}
                    style={{ width: '100%', height: '28px', padding: '0 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '5px', background: 'white', color: '#c0392b', outline: 'none', boxSizing: 'border-box' }}
                />
                </div>
            </div>
            </div>

    </div>
  );
}

// ── Phase 1: Batch Setup ───────────────────────────────────────────────────────
function BatchSetup({ onStart, infoItems = [] }) {
    const today = new Date();
    const pad2  = (n) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
    const [receiveDate, setReceiveDate] = useState(todayStr);
  const { userName, currentUser }   = useAuth();
  const { isOwner, isAdmin }        = useUserRole();

  const [bu, setBu]                   = useState('');
  const [receiveDate, setReceiveDate] = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [period, setPeriod]           = useState('Current');
  const [grt, setGrt]                 = useState('');
  const [grn, setGrn]                 = useState('');
  const [buInfo, setBuInfo]           = useState(null);
  const [showPopup, setShowPopup]     = useState(false);
  const [apGrt, setApGrt]             = useState(0);
  const [apGrn, setApGrn]             = useState(0);
  const [apGrtRunning, setApGrtRunning] = useState('');
  const [apGrnRunning, setApGrnRunning] = useState('');

  // ── Batch History ──────────────────────────────────────────────
  const [historyTab, setHistoryTab]   = useState('mine');   // 'mine' | 'all'
  const [historyMine, setHistoryMine] = useState([]);
  const [historyAll, setHistoryAll]   = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const canSeeAll = isOwner || isAdmin;
  const me = userName || currentUser?.email || '';

  useEffect(() => {
    const load = async () => {
      setHistoryLoading(true);
      try {
        // โหลดของตัวเอง
        const { data: mine } = await supabase
          .from('batch_list')
          .select('*')
          .eq('created_by', me)
          .order('created_at', { ascending: false })
          .limit(100);
        setHistoryMine(mine || []);

        // โหลดทั้งหมด (เฉพาะ Admin/Owner)
        if (canSeeAll) {
          const { data: all } = await supabase
            .from('batch_list')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
          setHistoryAll(all || []);
        }
      } catch (e) { console.error('loadHistory:', e); }
      setHistoryLoading(false);
    };
    if (me) load();
  }, [me, canSeeAll]);

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
                    onClick={() => onStart({
                    bu: bu || '-', receiveDate, dueDate, period,
                    apGrt, apGrn, apGrtRunning, apGrnRunning, buInfo,
                    })}
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
                apGrt={apGrt} apGrn={apGrn}
                onApGrtChange={setApGrt} onApGrnChange={setApGrn}
                />
            </div>

          </div>
        </div>
      </div>

      {/* ── Batch History ── */}
      <div style={card}>
        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '0.5px solid #e8eaf0' }}>
          <div style={{ display: 'flex' }}>
            {[
              { key: 'mine', label: '👤 My Job', count: historyMine.length },
              ...(canSeeAll ? [{ key: 'all', label: '👥 All Jobs', count: historyAll.length }] : []),
            ].map(t => (
              <div key={t.key} onClick={() => setHistoryTab(t.key)}
                style={{ padding: '9px 14px', fontSize: '12px', cursor: 'pointer', borderBottom: historyTab === t.key ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom: '-0.5px', color: historyTab === t.key ? '#1a3a5c' : '#888', fontWeight: historyTab === t.key ? '500' : '400', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {t.label}
                <span style={{ background: historyTab === t.key ? '#1a3a5c' : '#e8e8e8', color: historyTab === t.key ? 'white' : '#888', fontSize: '10px', padding: '1px 5px', borderRadius: '20px' }}>{t.count}</span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: '10px', fontWeight: '600', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Batch History</span>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                <colgroup>
                <col style={{ width: '24%' }} /> {/* Batch Name */}
                <col style={{ width: '10%' }} /> {/* Business Unit */}
                <col style={{ width: '11%' }} /> {/* Receive Date */}
                <col style={{ width: '12%' }} /> {/* ยอดรวม */}
                {historyTab === 'all' && <col style={{ width: '13%' }} />} {/* สร้างโดย */}
                <col style={{ width: historyTab === 'all' ? '20%' : '33%' }} /> {/* ไฟล์แนบ */}
                <col style={{ width: '10%' }} /> {/* Status */}
                </colgroup>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {[
                'Batch Name',
                'Business Unit',
                'Receive Date',
                'ยอดรวม',
                ...(historyTab === 'all' ? ['สร้างโดย'] : []),
                'ไฟล์แนบ',
                'Status',
              ].map(h => (
                <th key={h} style={{ padding: '7px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {historyLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>กำลังโหลด...</td></tr>
            ) : (historyTab === 'mine' ? historyMine : historyAll).length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>
                {historyTab === 'mine' ? 'No jobs yet' : 'No batch history'}
              </td></tr>
            ) : (historyTab === 'mine' ? historyMine : historyAll).map(b => {
              const statusMap = {
                done:       { bg: '#EAF3DE', color: '#27500A', label: 'Done' },
                processing: { bg: '#E6F1FB', color: '#0C447C', label: 'Processing' },
                error:      { bg: '#FCEBEB', color: '#791F1F', label: 'Error' },
                draft:      { bg: '#F1EFE8', color: '#444441', label: 'Draft' },
              };
              const st = statusMap[b.status] || statusMap.draft;

              const receiveAt = b.receive_date ? new Date(b.receive_date) : null;
              const receiveDateStr = receiveAt
                ? `${String(receiveAt.getDate()).padStart(2,'0')}/${String(receiveAt.getMonth()+1).padStart(2,'0')}/${receiveAt.getFullYear()}`
                : '-';

              return (
                <tr key={b.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}>

                  {/* Batch Name */}
                  <td style={{ padding: '8px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1a3a5c', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.batch_id || b.id}</div>
                    {b.note && <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.note}</div>}
                  </td>

                  {/* Business Unit */}
                  <td style={{ padding: '8px 9px', overflow: 'hidden' }}>
                    <span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>
                      {b.bu || '-'}
                    </span>
                  </td>

                  {/* Receive Date */}
                  <td style={{ padding: '8px 9px', color: '#555', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{receiveDateStr}</td>

                  {/* ยอดรวม */}
                  <td style={{ padding: '8px 9px', fontWeight: '500', color: '#1a3a5c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.total_amount ? `฿${Math.round(b.total_amount).toLocaleString('th-TH')}` : '—'}
                  </td>

                  {/* สร้างโดย (all tab only) */}
                  {historyTab === 'all' && (
                    <td style={{ padding: '8px 9px', color: '#666', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.created_by || '-'}
                    </td>
                  )}

                  {/* ไฟล์แนบ — View + Download */}
                  <td style={{ padding: '8px 9px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '5px', alignItems: 'center' }}>
                      {b.file_url ? (
                        <>
                          {/* View */}
                          <a href={b.file_url} target="_blank" rel="noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px 8px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', fontSize: '11px', textDecoration: 'none', fontWeight: '500', cursor: 'pointer' }}>
                            👁 View
                          </a>
                          {/* Download */}
                          <a href={b.file_url} download
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px 8px', borderRadius: '5px', border: '0.5px solid #b7dfc8', background: '#eaf6f0', color: '#0F6E56', fontSize: '11px', textDecoration: 'none', fontWeight: '500', cursor: 'pointer' }}>
                            ⬇ Download
                          </a>
                        </>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#ccc' }}>ไม่มีไฟล์</span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '8px 9px', whiteSpace: 'nowrap' }}>
                    <span style={{ background: st.bg, color: st.color, padding: '2px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: '500' }}>
                      {st.label}
                    </span>
                  </td>

                </tr>
              );
            })}
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

export default function APController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const [step, setStep]               = useState(1);
  const [batchConfig, setBatchConfig] = useState(null);
  const [invoices, setInvoices]       = useState([]);
  const [infoItems, setInfoItems]     = useState([]);

  // โหลด company_list cache ตอน mount
  useEffect(() => {
    const load = async () => {
      let from = 0;
      const size = 1000;
      let all = [];
      while (true) {
        const { data, error } = await supabase
          .from('company_list')
          .select('bu,"THAI COMPANY NAME","ENGLISH COMPANY NAME","TAX ID","COMPANY CODE","BOOK","SEGMENT3","AP GRT Control","AP-GRT","AP-GRN","IE-GRT","IE-GRN"')
          .range(from, from + size - 1);
        if (error || !data) break;
        all = [...all, ...data];
        if (data.length < size) break;
        from += size;
      }
      setInfoItems(all);
    };
    load();
  }, []);

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