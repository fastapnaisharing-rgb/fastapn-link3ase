import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

const PERIOD_OPTIONS = ['Current', 'Pre-Close'];

// ─────────────────────────────────────────────────────────────────────────────
// BUSearchPopup
// ─────────────────────────────────────────────────────────────────────────────
function BUSearchPopup({ show, onClose, onSelect, infoItems = [] }) {
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(-1);
  const inputRef            = useRef(null);
  const listRef             = useRef(null);

  useEffect(() => {
    if (show) { setQuery(''); setActive(-1); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose]);

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
        <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Select Business Unit</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>
              {infoItems.length > 0 ? `${filtered.length} records${query ? ` · Search "${query}"` : ''}` : 'Loading...'}
            </div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(-1); }}
              onKeyDown={handleKey}
              placeholder="Type BU, company name, Tax ID..."
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
            {[['↑↓','Navigate'], ['Enter','Select'], ['Esc','Close']].map(([key, label]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <kbd style={{ background: '#f0f1f3', border: '0.5px solid #dde', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>{key}</kbd>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '56px', textAlign: 'center', color: '#ccc' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔍</div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>No BU found {query ? `"${query}"` : ''}</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {[['BU','72px'],['Company Name',''],['Tax ID','132px'],['Book','68px'],['AP GRT','88px']].map(([h, w]) => (
                    <th key={h} style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const isAct = i === active;
                  return (
                    <tr key={item.id} data-row={i} onClick={() => onSelect(item)} onMouseEnter={() => setActive(i)}
                      style={{ background: isAct ? '#eef3fb' : 'white', cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6', transition: 'background 0.08s' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-block', background: isAct ? '#1a3a5c' : '#f0f3f8', color: isAct ? 'white' : '#1a3a5c', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.03em', transition: 'all 0.1s' }}>{item['bu'] || '-'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '500', color: '#1a2a3a', fontSize: '12px' }}>{item['THAI COMPANY NAME'] || '-'}</div>
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>{item['ENGLISH COMPANY NAME'] || ''}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#778', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>{item['TAX ID'] || '-'}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', fontWeight: '500' }}>{item['BOOK'] || '-'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {item['AP GRT Control'] ? (
                          <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '600', background: item['AP GRT Control'] === 'Auto' ? '#EAF3DE' : '#E6F1FB', color: item['AP GRT Control'] === 'Auto' ? '#27500A' : '#0C447C' }}>{item['AP GRT Control']}</span>
                        ) : <span style={{ color: '#ddd' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {infoItems.length} records</span>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => Math.round(n).toLocaleString('th-TH');

// ── Shared styles ─────────────────────────────────────────────────────────────
const card      = { background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', marginBottom: '10px' };
const cardHead  = { padding: '9px 14px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const cardLabel = { fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' };
const cardBody  = { padding: '12px 14px' };

const fieldWrap  = { display: 'flex', flexDirection: 'column', gap: '3px' };
const fieldLabel = { fontSize: '11px', color: '#888' };
const fieldInput = (pre) => ({ width: '100%', padding: '5px 8px', fontSize: '12px', border: `0.5px solid ${pre ? '#5DCAA5' : '#ddd'}`, borderRadius: '6px', background: pre ? '#f0faf6' : 'white', color: '#1a3a5c', outline: 'none' });

const btnPrimary = { padding: '7px 16px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '5px' };
const btnOutline = { padding: '5px 12px', background: 'white', color: '#555', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' };
const btnSmall   = { padding: '3px 9px', background: 'transparent', color: '#555', border: '0.5px solid #ddd', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px' };

const bdgGreen = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#EAF3DE', color: '#27500A' };
const bdgAmber = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#FAEEDA', color: '#633806' };
const bdgBlue  = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#E6F1FB', color: '#0C447C' };
const bdgRed   = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#FCEBEB', color: '#791F1F' };
const bdgGray  = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#F1EFE8', color: '#444441' };

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step, batchConfig, onGo }) {
  const steps = [{ n: 1, label: 'Batch setup' }, { n: 2, label: 'Invoice entry' }, { n: 3, label: 'Generate & export' }];
  return (
    <div style={{ background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '0 18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {steps.map((s, i) => {
        const isDone = s.n < step; const isActive = s.n === step;
        return (
          <React.Fragment key={s.n}>
            {i > 0 && <span style={{ color: '#ccc', margin: '0 12px', fontSize: '14px', userSelect: 'none' }}>›</span>}
            <div onClick={() => s.n < step && onGo(s.n)} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 0', cursor: s.n < step ? 'pointer' : 'default' }}>
              <div style={{ width: '21px', height: '21px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '500', flexShrink: 0, background: isDone ? '#EAF3DE' : isActive ? '#1a3a5c' : 'transparent', border: isDone ? '1.5px solid #97C459' : isActive ? '1.5px solid #1a3a5c' : '1.5px solid #ddd', color: isDone ? '#27500A' : isActive ? 'white' : '#888' }}>
                {isDone ? '✓' : s.n}
              </div>
              <span style={{ fontSize: '12px', fontWeight: isActive ? '500' : '400', color: isActive ? '#1a3a5c' : '#888' }}>{s.label}</span>
            </div>
          </React.Fragment>
        );
      })}
      {step > 1 && batchConfig && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ ...bdgBlue, fontSize: '11px' }}>BATCH-2026-0090 · {batchConfig.bu}</span>
          <span style={{ fontSize: '11px', color: '#aaa' }}>Auto-saved ✓</span>
        </div>
      )}
    </div>
  );
}

// ── BU Info Panel ─────────────────────────────────────────────────────────────
function BuInfoPanel({ buInfo, apGrtRunning, apGrnRunning, grtPrefix, grnPrefix, onApGrtRunningChange, onApGrnRunningChange }) {
  const rows = [['Company name', buInfo?.['THAI COMPANY NAME']], ['Tax ID', buInfo?.['TAX ID']], ['Company code', buInfo?.['COMPANY CODE']], ['Book', buInfo?.['BOOK']], ['Segment3', buInfo?.['SEGMENT3']], ['GRT status', buInfo?.['AP GRT Control']]];
  const infoRowStyle = { display: 'grid', gridTemplateColumns: '110px 1fr' };
  const keyStyle = { fontSize: '11px', color: '#999', padding: '7px 10px', background: '#fafafa', borderRight: '0.5px solid #f0f0f0', display: 'flex', alignItems: 'center' };
  const valStyle = (hasVal) => ({ fontSize: '12px', color: hasVal ? '#1a3a5c' : '#ccc', padding: '7px 10px', background: 'white', display: 'flex', alignItems: 'center', fontStyle: hasVal ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.map(([key, val], i) => (
          <div key={key} style={{ ...infoRowStyle, borderBottom: i < rows.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}>
            <div style={keyStyle}>{key}</div>
            <div style={valStyle(!!val)} title={val || ''}>{val || '—'}</div>
          </div>
        ))}
      </div>
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0', padding: '5px 10px' }}>
          <div style={{ fontSize: '10px', fontWeight: '600', color: '#1a3a5c', letterSpacing: '0.05em', textTransform: 'uppercase' }}>AP</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
          {[['GRT', grtPrefix, apGrtRunning, onApGrtRunningChange, '#1a3a5c', '#f0f3f8'], ['GRN', grnPrefix, apGrnRunning, onApGrnRunningChange, '#c0392b', '#fdf0f0']].map(([label, prefix, val, onChange, color, bg], idx) => (
            <div key={label} style={{ padding: '7px 10px', borderRight: idx === 0 ? '0.5px solid #f0f0f0' : 'none' }}>
              <div style={{ fontSize: '10px', color, fontWeight: '600', marginBottom: '4px', textAlign: 'center' }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', height: '28px', border: '0.5px solid #ddd', borderRadius: '5px', overflow: 'hidden', background: 'white' }}>
                <span style={{ padding: '0 7px', fontSize: '11px', color, background: bg, borderRight: '0.5px solid #ddd', height: '100%', display: 'flex', alignItems: 'center', fontWeight: '600', whiteSpace: 'nowrap', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{prefix}</span>
                <input type="text" inputMode="numeric" value={val} onChange={e => onChange(e.target.value)} maxLength={4} placeholder="0000"
                  style={{ flex: 1, height: '100%', padding: '0 6px', fontSize: '12px', border: 'none', outline: 'none', color, textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.15em' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Vendor Info Panel ─────────────────────────────────────────────────────────
function VendorInfoPanel({ vendorInfo, vendorLoading }) {
  const v = vendorLoading ? null : vendorInfo;

  const keyStyle = { fontSize: '10px', color: '#999', width: '72px', flexShrink: 0 };
  const valStyle = (hasVal) => ({ fontSize: '11px', color: hasVal ? '#1a3a5c' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 });
  const rowStyle = { display: 'flex', alignItems: 'center', padding: '4px 8px' };
  const divider  = { borderBottom: '0.5px solid #f0f0f0' };

  return (
    <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
      {vendorLoading && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, fontSize: '11px', color: '#888' }}>Loading...</div>
      )}
      <div style={{ background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0', padding: '4px 8px' }}>
        <div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor Info</div>
      </div>

      {/* Row 1: Vendor Name | Vendor Code | Vendor Site | Tax ID | No. */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', ...divider }}>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={keyStyle}>Vendor Name</span>
          <span style={valStyle(!!v?.['Supplier Name'])} title={v?.['Supplier Name'] || ''}>{v?.['Supplier Name'] || '—'}</span>
        </div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={keyStyle}>Vendor Code</span>
          <span style={valStyle(!!v?.['Code'])}>{v?.['Code'] || '—'}</span>
        </div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={keyStyle}>Vendor Site</span>
          <span style={valStyle(!!v?.['Supplier Site'])}>{v?.['Supplier Site'] || '—'}</span>
        </div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={keyStyle}>Tax ID</span>
          <span style={{ ...valStyle(!!v?.['Tax ID']), fontFamily: 'monospace' }}>{v?.['Tax ID'] || '—'}</span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>No.</span>
          <span style={valStyle(!!v?.['Supplier Number'])}>{v?.['Supplier Number'] || '—'}</span>
        </div>
      </div>

      {/* Row 3: Method | Paygroup | Par */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.5fr', ...divider }}>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={{ ...keyStyle, width: '52px' }}>Method</span>
          <span style={valStyle(!!v?.['Tax-Type'])}>{v?.['Tax-Type'] || '—'}</span>
        </div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}>
          <span style={{ ...keyStyle, width: '62px' }}>Paygroup</span>
          <span style={valStyle(!!v?.['Notice'])}>{v?.['Notice'] || '—'}</span>
        </div>
        <div style={{ ...rowStyle }}>
          <span style={{ ...keyStyle, width: '26px' }}>Par</span>
          <span style={valStyle(!!v?.['Sub Acc'])}>{v?.['Sub Acc'] || '—'}</span>
        </div>
      </div>

      {/* Row 4: Address full width */}
      <div style={rowStyle}>
        <span style={keyStyle}>Address</span>
        <span style={{ fontSize: '11px', color: v?.['Address'] ? '#1a3a5c' : '#ccc', flex: 1, whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{v?.['Address'] || '—'}</span>
      </div>
    </div>
  );
}

// ── Phase 1: Batch Setup ──────────────────────────────────────────────────────
function BatchSetup({ onStart, infoItems = [] }) {
  const today = new Date();
  const pad2  = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
  const [receiveDate, setReceiveDate] = useState(todayStr);

  const getPrefix = (type) => {
    const d = receiveDate ? new Date(receiveDate) : new Date();
    const y = String(d.getFullYear()).slice(-1);
    const mm = pad2(d.getMonth() + 1);
    if (type === 'GRT') return `${y}92${mm}0`;
    if (type === 'GRN') return `${y}91${mm}0`;
    return '';
  };

  const { userName, currentUser } = useAuth();
  const { isOwner, isAdmin }      = useUserRole();

  const [bu, setBu]                     = useState('');
  const [dueDate, setDueDate]           = useState('');
  const [period, setPeriod]             = useState('Current');
  const [buInfo, setBuInfo]             = useState(null);
  const [showPopup, setShowPopup]       = useState(false);
  const [apGrtRunning, setApGrtRunning] = useState('0000');
  const [apGrnRunning, setApGrnRunning] = useState('0000');
  const [historyTab, setHistoryTab]     = useState('mine');
  const [historyMine, setHistoryMine]   = useState([]);
  const [historyAll, setHistoryAll]     = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const canSeeAll = isOwner || isAdmin;
  const me = userName || currentUser?.email || '';

  const handleRunningChange = (val, setter) => { const num = val.replace(/\D/g, '').slice(0, 4); setter(num.padStart(4, '0')); };

  useEffect(() => {
    const load = async () => {
      setHistoryLoading(true);
      try {
        const { data: mine } = await supabase.from('batch_list').select('*').eq('created_by', me).order('created_at', { ascending: false }).limit(100);
        setHistoryMine(mine || []);
        if (canSeeAll) {
          const { data: all } = await supabase.from('batch_list').select('*').order('created_at', { ascending: false }).limit(500);
          setHistoryAll(all || []);
        }
      } catch (e) { console.error('loadHistory:', e); }
      setHistoryLoading(false);
    };
    if (me) load();
  }, [me, canSeeAll]);

  const handleSelectBU = (item) => { setBu(item['bu'] || ''); setBuInfo(item); setShowPopup(false); };

  const handleBuChange = (val) => {
    setBu(val);
    if (!val) { setBuInfo(null); return; }
    const exact = infoItems.find(i => i['bu']?.toLowerCase() === val.trim().toLowerCase());
    if (exact) { setBuInfo(exact); return; }
    const partials = infoItems.filter(i => i['bu']?.toLowerCase().startsWith(val.trim().toLowerCase()));
    setBuInfo(partials.length === 1 ? partials[0] : null);
  };

  const handleBuKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const match = infoItems.find(i => i['bu']?.toLowerCase() === bu.trim().toLowerCase());
    setBuInfo(match || infoItems.find(i => i['bu']?.toLowerCase().startsWith(bu.trim().toLowerCase())) || null);
  };

  const inputBase = { width: '100%', height: '32px', padding: '0 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', background: 'white', color: '#1a3a5c', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      <BUSearchPopup show={showPopup} onClose={() => setShowPopup(false)} onSelect={handleSelectBU} infoItems={infoItems} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        <div style={card}>
          <div style={cardHead}><span style={cardLabel}>Batch setup</span></div>
          <div style={cardBody}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={fieldWrap}>
                    <label style={fieldLabel}>BU <span style={{ color: '#e24b4a' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input value={bu} onChange={e => handleBuChange(e.target.value)} onKeyDown={handleBuKeyDown}
                        onBlur={() => { if (!bu.trim()) return; const m = infoItems.find(i => i['bu']?.toLowerCase() === bu.trim().toLowerCase()); setBuInfo(m || infoItems.find(i => i['bu']?.toLowerCase().startsWith(bu.trim().toLowerCase())) || null); }}
                        placeholder="Enter BU code..." style={{ ...inputBase, paddingRight: '36px' }} />
                      <button onClick={() => setShowPopup(true)} title="Open BU search popup"
                        style={{ position: 'absolute', right: 0, top: 0, height: '32px', width: '32px', background: '#1a3a5c', border: 'none', borderRadius: '0 6px 6px 0', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>🔍</button>
                    </div>
                    {buInfo && <span style={{ fontSize: '10px', color: '#0F6E56', display: 'flex', alignItems: 'center', gap: '4px' }}>✓ {buInfo['THAI COMPANY NAME'] || buInfo['ENGLISH COMPANY NAME']}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                    <div style={fieldWrap}><label style={fieldLabel}>Receive date</label><input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} style={inputBase} /></div>
                    <div style={fieldWrap}><label style={fieldLabel}>Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputBase} /></div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={fieldLabel}>Period</label>
                    <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inputBase, appearance: 'auto', cursor: 'pointer' }}>{PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
                  </div>
                </div>
                <button style={{ ...btnPrimary, width: '100%', justifyContent: 'center' }} onClick={() => onStart({ bu: bu || '-', receiveDate, dueDate, period, apGrtRunning, apGrnRunning, buInfo })}>▶ Start Batch</button>
              </div>
              <div>
                <div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>BU Info</div>
                <BuInfoPanel buInfo={buInfo} apGrtRunning={apGrtRunning} apGrnRunning={apGrnRunning} grtPrefix={getPrefix('GRT')} grnPrefix={getPrefix('GRN')} onApGrtRunningChange={v => handleRunningChange(v, setApGrtRunning)} onApGrnRunningChange={v => handleRunningChange(v, setApGrnRunning)} />
              </div>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '0.5px solid #e8eaf0' }}>
            <div style={{ display: 'flex' }}>
              {[{ key: 'mine', label: '👤 My Jobs', count: historyMine.length }, ...(canSeeAll ? [{ key: 'all', label: '👥 All Jobs', count: historyAll.length }] : [])].map(t => (
                <div key={t.key} onClick={() => setHistoryTab(t.key)}
                  style={{ padding: '9px 14px', fontSize: '12px', cursor: 'pointer', borderBottom: historyTab === t.key ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom: '-0.5px', color: historyTab === t.key ? '#1a3a5c' : '#888', fontWeight: historyTab === t.key ? '500' : '400', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {t.label}
                  <span style={{ background: historyTab === t.key ? '#1a3a5c' : '#e8e8e8', color: historyTab === t.key ? 'white' : '#888', fontSize: '10px', padding: '1px 5px', borderRadius: '20px' }}>{t.count}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Batch History</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '24%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} /><col style={{ width: historyTab === 'all' ? '20%' : '33%' }} />
              <col style={{ width: '10%' }} />{historyTab === 'all' && <col style={{ width: '13%' }} />}
            </colgroup>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                {['Batch Name','Business Unit','Receive Date','Total Amount','Attachment','Status',...(historyTab === 'all' ? ['Created By'] : [])].map(h => (
                  <th key={h} style={{ padding: '7px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>Loading...</td></tr>
              ) : (historyTab === 'mine' ? historyMine : historyAll).length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>{historyTab === 'mine' ? 'No jobs yet' : 'No batch history'}</td></tr>
              ) : (historyTab === 'mine' ? historyMine : historyAll).map(b => {
                const statusMap = { done: { bg: '#EAF3DE', color: '#27500A', label: 'Done' }, processing: { bg: '#E6F1FB', color: '#0C447C', label: 'Processing' }, error: { bg: '#FCEBEB', color: '#791F1F', label: 'Error' }, draft: { bg: '#F1EFE8', color: '#444441', label: 'Draft' } };
                const st = statusMap[b.status] || statusMap.draft;
                const ra = b.receive_date ? new Date(b.receive_date) : null;
                const pad2 = (n) => String(n).padStart(2, '0');
                const rds = ra ? `${pad2(ra.getDate())}/${pad2(ra.getMonth()+1)}/${ra.getFullYear()}` : '-';
                return (
                  <tr key={b.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
                    <td style={{ padding: '8px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1a3a5c', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.batch_id || b.id}</div>
                      {b.note && <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.note}</div>}
                    </td>
                    <td style={{ padding: '8px 9px', overflow: 'hidden' }}><span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>{b.bu || '-'}</span></td>
                    <td style={{ padding: '8px 9px', color: '#555', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rds}</td>
                    <td style={{ padding: '8px 9px', fontWeight: '500', color: '#1a3a5c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.total_amount ? `฿${Math.round(b.total_amount).toLocaleString('th-TH')}` : '—'}</td>
                    <td style={{ padding: '8px 9px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '5px', alignItems: 'center' }}>
                        {b.file_url ? (
                          <><a href={b.file_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px 8px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', fontSize: '11px', textDecoration: 'none', fontWeight: '500' }}>👁 View</a>
                          <a href={b.file_url} download style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px 8px', borderRadius: '5px', border: '0.5px solid #b7dfc8', background: '#eaf6f0', color: '#0F6E56', fontSize: '11px', textDecoration: 'none', fontWeight: '500' }}>⬇ Download</a></>
                        ) : <span style={{ fontSize: '11px', color: '#ccc' }}>No file</span>}
                      </div>
                    </td>
                    <td style={{ padding: '8px 9px', whiteSpace: 'nowrap' }}><span style={{ background: st.bg, color: st.color, padding: '2px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: '500' }}>{st.label}</span></td>
                    {historyTab === 'all' && <td style={{ padding: '8px 9px', color: '#666', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.created_by || '-'}</td>}
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

// ── Invoice Header ────────────────────────────────────────────────────────────
function InvoiceHeader({ form, setField, onSupplierBlur, vendorInfo, vendorLoading }) {
  const fld = (label, key, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: opts.width || 'auto' }}>
      <label style={{ fontSize: '11px', color: '#888' }}>
        {label}{opts.required && <span style={{ color: '#e24b4a' }}> *</span>}
      </label>
      {opts.type === 'select' ? (
        <select value={form[key]} onChange={e => setField(key, e.target.value)}
          style={{ height: '30px', padding: '0 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', outline: 'none', background: 'white', color: '#1a3a5c' }}>
          <option value="">— select —</option>
          {(opts.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={opts.type || 'text'}
          value={form[key]}
          onChange={e => setField(key, e.target.value)}
          readOnly={opts.readOnly}
          style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: opts.readOnly ? '0.5px solid #5DCAA5' : '0.5px solid #ddd', background: opts.readOnly ? '#E1F5EE' : 'white', color: opts.readOnly ? '#085041' : '#1a3a5c' }}
        />
      )}
    </div>
  );

  return (
    <div style={{ padding: '12px 14px', borderBottom: '0.5px solid #e8eaf0' }}>
      <div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Header</div>

      {/* Fields แถวบน */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '90px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Supplier code <span style={{ color: '#e24b4a' }}>*</span></label>
          <input
            type="text"
            value={form.supplierCode}
            onChange={e => setField('supplierCode', e.target.value)}
            onBlur={() => onSupplierBlur(form.supplierCode)}
            onKeyDown={e => { if (e.key === 'Enter') onSupplierBlur(form.supplierCode); }}
            style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c' }}
          />
        </div>
        {fld('Inv date',   'invDate',  { type: 'date',   width: '130px' })}
        {fld('Invoice num','invoiceNum',{                  width: '110px' })}
        {fld('CPC',        'cpc',       {                  width: '60px'  })}
        {fld('Branch no.', 'branchNo',  { type: 'select', width: '100px' })}
        {fld('GRT',        'grt',       { readOnly: true,  width: '80px'  })}
        {fld('GRN',        'grn',       {                  width: '80px'  })}
        {fld('Due date',   'dueDate',   { type: 'select', width: '100px' })}
      </div>

      {/* Vendor Info ด้านล่าง เต็มความกว้าง */}
      <div style={{ marginTop: '10px' }}>
        <VendorInfoPanel vendorInfo={vendorInfo} vendorLoading={vendorLoading} />
      </div>
    </div>
  );
}

// ── Phase 2: Invoice Entry ────────────────────────────────────────────────────
function InvoiceEntry({ batchConfig, invoices, setInvoices, onNext, supplierItems = [] }) {
  const [form, setFormState] = useState({
    supplierCode: '',
    invDate:      '',
    invoiceNum:   '',
    cpc:          '',
    branchNo:     '',
    grt:          '',
    grn:          '',
    dueDate:      '',
  });
  const [vendorInfo, setVendorInfo] = useState(null);

  const setField = (key, val) => {
    setFormState(f => ({ ...f, [key]: val }));
    if (key === 'supplierCode' && !val) setVendorInfo(null);
  };

  // Lookup in-memory from supplierItems (already loaded at app startup)
  const lookupVendor = (code) => {
    if (!code?.trim()) { setVendorInfo(null); return; }
    const found = supplierItems.find(
      s => String(s['Code'] ?? '').trim().toLowerCase() === code.trim().toLowerCase()
    );
    setVendorInfo(found || null);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <div style={card}>
        <InvoiceHeader
          form={form}
          setField={setField}
          onSupplierBlur={lookupVendor}
          vendorInfo={vendorInfo}
          vendorLoading={false}
        />
        {/* TODO: Invoice lines section */}
      </div>
    </div>
  );
}

// ── Phase 3: Generate & Export ────────────────────────────────────────────────
function GenerateExport({ invoices, onNewBatch, onBack }) {
  const [opts, setOpts]         = useState({ xlsx: true, txt: true, wht: false, vat: false });
  const [exported, setExported] = useState(false);
  const toggleOpt = (k) => setOpts(o => ({ ...o, [k]: !o[k] }));
  const subtotal = invoices.reduce((s, v) => s + v.raw, 0);
  const vat      = Math.round(subtotal * 0.07);
  const net      = invoices.reduce((s, v) => s + v.net, 0);
  const doExport = () => { if (!invoices.length) { alert('No invoices in batch'); return; } setExported(true); };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>Batch 2026-0090 Summary</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {[['Invoice No.','25%'],['Vendor','30%'],['GR Reference','22%'],['Net Amount','23%']].map(([h, w]) => (
                    <th key={h} style={{ padding: '6px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: '18px' }}>No invoices in batch</td></tr>
                ) : invoices.map(v => (
                  <tr key={v.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
                    <td style={{ padding: '7px 9px', fontWeight: '500', color: '#1a3a5c' }}>{v.id}</td>
                    <td style={{ padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor}</td>
                    <td style={{ padding: '7px 9px', color: '#888' }}>{v.gr}</td>
                    <td style={{ padding: '7px 9px' }}>{exported ? <span style={bdgGreen}>Exported</span> : <span style={{ fontWeight: '500' }}>฿{fmt(v.net)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', borderTop: '0.5px solid #e8eaf0' }}>
              {[['Invoices', invoices.length],['Subtotal', `฿${fmt(subtotal)}`],['VAT 7%', `฿${fmt(vat)}`],['Net Total', `฿${fmt(net)}`]].map(([label, val], i, arr) => (
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
              {[['xlsx','Load file (.xlsx)'],['txt','AP Interface (.txt)'],['wht','WHT Certificate (.pdf)'],['vat','VAT Summary (.xlsx)']].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts[key]} onChange={() => toggleOpt(key)} />{label}
                </label>
              ))}
            </div>
          </div>
          <div style={card}>
            <div style={cardHead}><span style={cardLabel}>Actions</span></div>
            <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <button style={{ ...btnPrimary, width: '100%', justifyContent: 'center', background: exported ? '#27500A' : '#1a3a5c' }} onClick={doExport}>{exported ? '✓ Exported' : '⬇ Generate & export'}</button>
              <button style={{ ...btnOutline, width: '100%', justifyContent: 'center' }} onClick={onBack}>← Back to edit</button>
            </div>
          </div>
          {exported && (
            <div style={card}>
              <div style={cardHead}><span style={cardLabel}>Generated files</span></div>
              <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {opts.xlsx && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}><span style={{ color: '#27500A' }}>📊</span><span style={{ flex: 1 }}>AP_LOAD_0090.xlsx</span><span style={{ color: '#888', cursor: 'pointer' }}>⬇</span></div>}
                {opts.txt  && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}><span style={{ color: '#0C447C' }}>📄</span><span style={{ flex: 1 }}>AP_INTERFACE_0090.txt</span><span style={{ color: '#888', cursor: 'pointer' }}>⬇</span></div>}
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
        <button style={btnOutline} onClick={onNewBatch}>+ New Batch</button>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function APController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const [step, setStep]               = useState(1);
  const [batchConfig, setBatchConfig] = useState(null);
  const [invoices, setInvoices]       = useState([]);
  const [infoItems, setInfoItems]     = useState([]);
  const [supplierItems, setSupplierItems] = useState([]);

  useEffect(() => {
    const loadAll = async () => {
      // company_list — for BU Info panel
      const loadTable = async (table, selectCols, setter) => {
        let from = 0; const size = 1000; let all = [];
        while (true) {
          const { data, error } = await supabase.from(table).select(selectCols).range(from, from + size - 1);
          if (error) { console.error(`❌ ${table}:`, error); break; }
          if (!data) break;
          all = [...all, ...data];
          if (data.length < size) break;
          from += size;
        }
        setter(all);
      };
      await Promise.all([
        loadTable('company_list', 'bu,"THAI COMPANY NAME","ENGLISH COMPANY NAME","TAX ID","COMPANY CODE","BOOK","SEGMENT3","AP GRT Control"', setInfoItems),
        loadTable('supplier_list', '*', setSupplierItems),
      ]);
    };
    loadAll();
  }, []);

  const handleStart    = (config) => { setBatchConfig(config); setStep(2); };
  const handleNewBatch = () => { setBatchConfig(null); setInvoices([]); setStep(1); };

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
        {step === 2 && <InvoiceEntry batchConfig={batchConfig} invoices={invoices} setInvoices={setInvoices} onNext={() => setStep(3)} supplierItems={supplierItems} />}
        {step === 3 && <GenerateExport invoices={invoices} onNewBatch={handleNewBatch} onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}