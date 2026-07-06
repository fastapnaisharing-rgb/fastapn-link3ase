import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { apiFetch } from '../api';
import * as XLSX from 'xlsx';
import { useDataCache } from '../contexts/DataCacheContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';
import { registerSyncFlush } from '../contexts/syncRegistry';

const PERIOD_OPTIONS = ['Current', 'Pre-Close'];

const buildDisGDesc = (disG, bd1, bd2, bd3) => {
  const bParts = [bd1 || '', bd2 || '', bd3 || ''];
  if (!disG?.trim()) return bParts.filter(Boolean).join(' ');
  const cParts = disG.split('|');
  const parts = cParts
    .map((c, i) => {
      const cVal = c.trim();
      const bVal = bParts[i]?.trim() || '';
      if (!cVal || cVal === '-' || cVal === '—') return null;
      if (!bVal) return null; // ← เพิ่มบรรทัดนี้: BDes ว่าง → skip ทั้ง pair
      return `${cVal} ${bVal}`;
    })
    .filter(Boolean);
  return parts.join(' ');
};

const BRANCH_EDIT = [
  ['Branch Code',                           'Branch Code',        3],
  ['BU Code',                               'BU Code',            3],
  ['BU-Branch',                             'BU Branch',          3],
  ['cpc',                                   'CPC',                3],
  ['Branch Direct',                         'Branch Direct',      4],
  ['Branch Allocate',                       'Branch Allocate',    4],
  ['Group-P',                               'Group-P',            4],
  ['Company for Show in Report Display',    'Company for Report', 7],
  ['Simple Company',                        'Simple Company',     5],
  ['BU-TaxID',                              'BU Tax ID',          4],
  ['Simple Brand Code',                     'Simple Brand Code',  4],
  ['%',                                     '%',                  2],
  ['DB(%)',                                 'DB(%)',              2],
  ['bu',                                    'BU',                 3],
  ['status',                                'Status',             4],
  ['Inactive Date',                         'Inactive Date',      5],
  ['Branch Address',                        'Branch Address',     12],
];
const BRANCH_COMBO = ['Branch Direct', 'bu', 'Group-P', 'status'];

const formatBranchLabel = (item) =>
  `${item?.['Branch Code'] ?? ''}-${item?.['Company for Show in Report Display'] ?? ''}`;

const isHeadOffice = (companyName) => {
  const n = String(companyName ?? '').toLowerCase();
  return n.includes('head office') || n.includes('สำนักงานใหญ่') || n.includes('สนญ');
};

const findHOBranch = (branchItems, bu) =>
  branchItems.find(b =>
    String(b['bu'] ?? '').toLowerCase() === String(bu ?? '').toLowerCase() &&
    isHeadOffice(b['Company for Show in Report Display'])
  );

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handler = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return size;
}

// ─────────────────────────────────────────────────────────────────────────────
// ComboInput — text input + custom dropdown (แทน <input list>+<datalist> ที่
// ความกว้างของ dropdown ไม่ตรงกับ cell เพราะเป็น native browser behavior)
// ─────────────────────────────────────────────────────────────────────────────
function ComboInput({ value, onChange, options = [], placeholder = '' }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const q = String(value || '').trim().toLowerCase();
  const filtered = q ? options.filter(o => o.toLowerCase().includes(q)) : options;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onFocus={(e) => { const r = e.target.getBoundingClientRect(); setDropPos({ top: r.bottom + 2, left: r.left, width: r.width }); setOpen(true); }}
        placeholder={placeholder}
        style={{ height: '28px', padding: '0 20px 0 8px', fontSize: '12px', outline: 'none', border: 'none', background: 'transparent', color: '#1a3a5c', boxSizing: 'border-box', width: '100%' }}
      />
      <svg style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', color: '#bbb', pointerEvents: 'none' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        {open && options.length > 0 && (
          <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((o, i) => (
            <div key={i} onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
              style={{ padding: '6px 10px', fontSize: '12px', color: '#1a3a5c', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: o === value ? '#eef3fb' : 'white' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eef3fb'; }}
              onMouseLeave={e => { e.currentTarget.style.background = o === value ? '#eef3fb' : 'white'; }}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}

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
            <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey}
              placeholder="Type BU, company name, Tax ID..."
              style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
              onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>}
          </div>
          <div style={{ marginTop: '7px', fontSize: '11px', color: '#bbb', display: 'flex', gap: '12px' }}>
            {[['↑↓','Navigate'],['Enter','Select'],['Esc','Close']].map(([key, label]) => (
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
                  {[['Branch Code','100px'],['Branch Direct','110px'],['Company Name',''],['BU Branch','80px'],['Status','70px']].map(([h, w]) => (
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

// ─────────────────────────────────────────────────────────────────────────────
// BranchSearchPopup
// ─────────────────────────────────────────────────────────────────────────────
function BranchSearchPopup({ show, onClose, onSelect, branchItems = [], bu = '', onSaveBranch, branchOptions = {} }) {
  const [query, setQuery]         = useState('');
  const [active, setActive]       = useState(-1);
  const [view, setView]           = useState('search');
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]           = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving]       = useState(false);
  const [sortField, setSortField] = useState('BU-Branch');
  const [sortDir, setSortDir]     = useState('asc');
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => {
    if (show) { setQuery(''); setActive(-1); setView('search'); setEditTarget(null); setForm({}); setFormError(''); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') { if (view === 'search') onClose(); else handleBack(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose, view]);

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!show) return null;

  const buFiltered = bu ? branchItems.filter(i => String(i['bu'] ?? '').toLowerCase() === bu.toLowerCase()) : branchItems;
  const q = query.trim().toLowerCase();
  const filtered0 = q
    ? buFiltered.filter(i =>
        String(i['Branch Code'] ?? '').toLowerCase().includes(q) ||
        String(i['Branch Direct'] ?? '').toLowerCase().includes(q) ||
        String(i['Company for Show in Report Display'] ?? '').toLowerCase().includes(q) ||
        String(i['BU-Branch'] ?? '').toLowerCase().includes(q))
    : buFiltered;

  const filtered = [...filtered0].sort((a, b) => {
    const va = String(a[sortField] ?? ''), vb = String(b[sortField] ?? '');
    const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (field) => { setActive(-1); if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(field); setSortDir('asc'); } };
  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active], { isIB: false }); }
  };
  const handleOpenEdit = (item) => { const f = {}; BRANCH_EDIT.forEach(([k]) => { f[k] = item[k] || ''; }); setEditTarget(item); setForm(f); setFormError(''); setView('edit'); };
  const handleOpenNew  = () => { const f = {}; BRANCH_EDIT.forEach(([k]) => { f[k] = ''; }); if (bu) f['bu'] = bu; setEditTarget(null); setForm(f); setFormError(''); setView('new'); };
  const handleBack = () => { setView('search'); setEditTarget(null); setForm({}); setFormError(''); setTimeout(() => inputRef.current?.focus(), 60); };
  const validateForm = (f) => {
    if (!f['Branch Code']?.trim()) return 'กรุณากรอก Branch Code';
    if (f['status'] === 'Closed' && !f['Inactive Date']) return 'กรุณากรอก Inactive Date เมื่อ Status เป็น Closed';
    if (f['status'] === 'Relocate' && !f['Branch Allocate']) return 'กรุณากรอก Branch Allocate เมื่อ Status เป็น Relocate';
    return '';
  };
  const handleSave = async () => {
    const err = validateForm(form); if (err) { setFormError(err); return; }
    setSaving(true);
    try { await onSaveBranch({ form, isEdit: view === 'edit', editTarget }); handleBack(); }
    catch (e) { setFormError('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };
  const setField = (key, val) => { setForm(f => ({ ...f, [key]: val })); setFormError(''); };

  const IconIB = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m8 0h3a2 2 0 002-2v-3"/><circle cx="12" cy="12" r="3"/></svg>);
  const IconEdit = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);

  const renderFormView = () => {
    const isEdit = view === 'edit';
    const isViewOnly = view === 'view';
    return (
      <>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <button onClick={handleBack} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f5f7fa', border: '0.5px solid #dde', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', color: '#555', fontSize: '12px', fontWeight: '500', flexShrink: 0 }}>← Back</button>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: isEdit ? '#1a3a5c' : '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{isEdit ? '✏️' : '➕'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>{isEdit ? `Edit branch — ${editTarget?.['Branch Code'] || ''}` : 'New branch'}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>BU: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{bu || '-'}</span></div>
          </div>
        </div>
        {formError && <div style={{ padding: '8px 20px', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', borderBottom: '1px solid #f7c1c1', flexShrink: 0 }}>⚠️ {formError}</div>}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '10px 12px' }}>
            {BRANCH_EDIT.map(([key, label, span]) => {
              const isReadOnly = key === 'Branch Code' && isEdit;
              const needInactive = key === 'Inactive Date';
              const isDisabled = needInactive && form['status'] !== 'Closed';
              const isRequired = (key === 'Branch Code') || (key === 'Inactive Date' && form['status'] === 'Closed') || (key === 'Branch Allocate' && form['status'] === 'Relocate');
              const hasErr = !!formError && isRequired && !form[key]?.trim();
              const baseInput = { height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', width: '100%', border: hasErr ? '1px solid #e74c3c' : '0.5px solid #ddd', background: (isReadOnly || isDisabled) ? '#f5f5f5' : 'white', color: (isReadOnly || isDisabled) ? '#999' : '#1a3a5c' };
              const opts = branchOptions[key] || [];
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', gridColumn: `span ${span}` }}>
                  <label style={{ fontSize: '11px', color: hasErr ? '#e74c3c' : '#888' }}>
                    {label}{isRequired && <span style={{ color: '#e24b4a' }}> *</span>}
                    {needInactive && <span style={{ fontSize: '10px', color: '#bbb' }}> (เฉพาะ Closed)</span>}
                  </label>
                  {key === 'Inactive Date' ? (
                    <input type="date" disabled={isDisabled} value={form[key] || ''} onChange={e => setField(key, e.target.value)} style={baseInput} />
                  ) : BRANCH_COMBO.includes(key) ? (
                    <><input list={`combo-branch-${key}`} value={form[key] || ''} onChange={e => setField(key, e.target.value)} placeholder={`เลือก ${label}`} style={baseInput} /><datalist id={`combo-branch-${key}`}>{opts.map((o, i) => <option key={i} value={o} />)}</datalist></>
                  ) : (
                    <input value={form[key] || ''} readOnly={isReadOnly} onChange={e => !isReadOnly && setField(key, e.target.value)} style={baseInput} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          {isEdit && editTarget?.['updated_by'] ? (
            <span style={{ fontSize: '11px', color: '#bbb' }}>Updated by <strong style={{ color: '#888' }}>{editTarget['updated_by']}</strong>{editTarget['updated_at'] ? ` · ${new Date(editTarget['updated_at']).toLocaleString('th-TH')}` : ''}</span>
          ) : <span />}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleBack} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>← Back to search</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : '💾 Save'}</button>
          </div>
        </div>
      </>
    );
  };

  const renderSearchView = () => (
    <>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🏪</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Select Branch</div>
          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>BU: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{bu || 'ทั้งหมด'}</span>{' · '}{filtered.length} สาขา</div>
        </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      </div>
      <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '7px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey} placeholder="Branch code, ชื่อสาขา..."
              style={{ width: '100%', padding: '9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
              onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
          </div>
          <button onClick={handleOpenNew} style={{ height: '36px', padding: '0 16px', borderRadius: '8px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#bbb', display: 'flex', gap: '12px' }}>
          {[['↑↓','Navigate'],['Enter','Select'],['Esc','Close']].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: '#f0f1f3', border: '0.5px solid #dde', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>
      <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#ccc' }}><div style={{ fontSize: '32px', marginBottom: '8px' }}>🏪</div><div style={{ fontSize: '13px', color: '#aaa' }}>ไม่พบสาขา{query ? ` "${query}"` : ''}</div></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {[['Branch Code','110px','Branch Code'],['Direct','120px','Branch Direct'],['Company Name','','Company for Show in Report Display'],['BU Branch','90px','BU-Branch'],['Status','80px','status'],['Action','128px',null]].map(([h, w, field]) => (
                  <th key={h} onClick={field ? () => handleSort(field) : undefined}
                    style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', textAlign: h === 'Action' ? 'center' : 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined, cursor: field ? 'pointer' : 'default', userSelect: 'none' }}>
                    {h}{field ? (sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const isAct = i === active, isClosed = item['status'] === 'Closed';
                return (
                  <tr key={item.id || i} data-row={i} onClick={() => !isClosed && onSelect(item, { isIB: false })} onMouseEnter={() => !isClosed && setActive(i)}
                    style={{ background: isAct ? '#eef3fb' : 'white', cursor: isClosed ? 'not-allowed' : 'pointer', borderBottom: '0.5px solid #f3f4f6', opacity: isClosed ? 0.5 : 1 }}>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}><span style={{ background: isAct ? '#1a3a5c' : '#f0f3f8', color: isAct ? 'white' : '#1a3a5c', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>{item['Branch Code'] || '-'}</span></td>
                    <td style={{ padding: '9px 12px', color: '#555', fontSize: '11px' }}>{item['Branch Direct'] || '-'}</td>
                    <td style={{ padding: '9px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{item['Company for Show in Report Display'] || '-'}</td>
                    <td style={{ padding: '9px 12px', color: '#778', fontSize: '11px' }}>{item['BU-Branch'] || '-'}</td>
                    <td style={{ padding: '9px 12px' }}><span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: isClosed ? '#FCEBEB' : '#EAF3DE', color: isClosed ? '#791F1F' : '#27500A' }}>{item['status'] || 'Active'}</span></td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <button title="Interbranch" onClick={e => { e.stopPropagation(); !isClosed && onSelect(item, { isIB: true }); }} style={{ width: '56px', height: '28px', borderRadius: '6px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', fontSize: '10px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', flexShrink: 0 }}><IconIB /> IB</button>
                        <button title="Edit" onClick={e => { e.stopPropagation(); handleOpenEdit(item); }} style={{ width: '56px', height: '28px', borderRadius: '6px', border: '0.5px solid #ddd', background: '#f5f5f5', color: '#444', fontSize: '10px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', flexShrink: 0 }}><IconEdit /> Edit</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
        <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {buFiltered.length} สาขา</span>
        <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && view === 'search') onClose(); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: '900px', maxWidth: '96vw', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>
        {view === 'search' ? renderSearchView() : renderFormView()}
      </div>
    </div>
  );
}

// ICCombo — custom dropdown กว้างเท่าช่องตัวเอง
function ICCombo({ value, options, readOnly, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 0 });
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const q = String(value || '').trim().toLowerCase();
  const filtered = q ? options.filter(o => String(o).toLowerCase().includes(q)) : options;
  return (
    <div ref={ref} style={{ position: 'relative', border: '0.5px solid #e8eaf0', borderRadius: '4px', background: 'white', overflow: 'visible' }}>
      <input
        value={value || ''} readOnly={readOnly} placeholder="-"
        onChange={e => !readOnly && onChange(e.target.value)}
        onFocus={e => { if (readOnly) return; const r = e.target.getBoundingClientRect(); setPos({ top: r.bottom + 1, left: r.left, width: r.width }); setOpen(true); }}
        style={{ height: '30px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((o, i) => (
            <div key={i} onMouseDown={e => { e.preventDefault(); onChange(String(o)); setOpen(false); }}
              style={{ padding: '5px 8px', fontSize: '12px', color: '#1a3a5c', cursor: 'pointer', background: String(o) === value ? '#eef3fb' : 'white', whiteSpace: 'nowrap' }}
              onMouseEnter={e => e.currentTarget.style.background = '#eef3fb'}
              onMouseLeave={e => e.currentTarget.style.background = String(o) === value ? '#eef3fb' : 'white'}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemCodeSearchPopup
// ─────────────────────────────────────────────────────────────────────────────
const ITEM_COMBO_FIELDS = ['dis_g', 'i_and_g', 'value', 'oth', 'spi1', 'spec_tx'];

function ItemCodeSearchPopup({ show, onClose, onSelect, itemcodeItems = [], fetchCollection, userName = '', currentUser, bu = '', vendorTaxId = '' }) {
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const canEdit = isOwner || isAdmin || isEditor;
  const canDelete = isOwner || isAdmin;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [view, setView] = useState('search'); // 'search' | 'new' | 'view' | 'edit'
  const [saving, setSaving] = useState(false);
  const [nextCode, setNextCode] = useState('');
  const [viewTarget, setViewTarget] = useState(null);
  const emptyForm = { bu: '', description: '', cpc: '', account: '', sub: '', dis_g: '', i_and_g: '', value: '', oth: '', spi1: '', spec_tx: '', keyword: '',
    item: '',
    dis_g_desc: '', i_and_g_desc: '', value_desc: '', oth_desc: '', spi1_desc: '', spec_tx_desc: '' };
  const [form, setForm] = useState(emptyForm);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const [favUpdating, setFavUpdating] = useState(null); // code ที่กำลัง update

  const isReadOnly = view === 'view';

  const isFav = (item) => {
    const favs = Array.isArray(item.favorite_taxids) ? item.favorite_taxids : [];
    return !!vendorTaxId && favs.includes(vendorTaxId);
  };

  const toggleFav = async (e, item) => {
    e.stopPropagation();
    if (!vendorTaxId) return;
    setFavUpdating(item.code);
    try {
      const favs = Array.isArray(item.favorite_taxids) ? [...item.favorite_taxids] : [];
      const already = favs.includes(vendorTaxId);
      const newFavs = already ? favs.filter(t => t !== vendorTaxId) : [...favs, vendorTaxId];
      const { error } = await db.from('itemcode_list').update({ favorite_taxids: newFavs }).eq('id', item.id);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('ItemcodeList', true);
    } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
    setFavUpdating(null);
  };

  useEffect(() => { if (show) { setQuery(''); setActive(-1); setView('search'); setViewTarget(null); setTimeout(() => inputRef.current?.focus(), 60); } }, [show]);
  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') { if (view === 'search') onClose(); else { setView('search'); setViewTarget(null); } } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose, view]);
  useEffect(() => { if (active < 0 || !listRef.current) return; listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useEffect(() => {
    if (show && view === 'new') { computeNextCode(); setForm({ ...emptyForm, bu: bu || '' }); }
    if (show && (view === 'view' || view === 'edit') && viewTarget) {
      const f = { ...emptyForm };
      Object.keys(f).forEach(k => { if (viewTarget[k] !== undefined) f[k] = viewTarget[k] || ''; });
      setForm(f);
    }
  }, [show, view, bu, viewTarget]);




  const computeNextCode = async () => {
    try {
      const data = await apiFetch('/itemcode_list');
      const allCodes = (data || []).map(d => d.code || '');
      const nums = allCodes
        .filter(c => /^C\d{7}$/.test(c))
        .map(c => parseInt(c.replace('C', ''), 10))
        .sort((a, b) => a - b);
      if (!nums.length) { setNextCode('C0000001'); return; }
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] - nums[i] > 1) {
          setNextCode(`C${String(nums[i] + 1).padStart(7, '0')}`);
          return;
        }
      }
      setNextCode(`C${String(nums[nums.length - 1] + 1).padStart(7, '0')}`);
    } catch (err) { console.error('computeNextCode error:', err); }
  };

  const handleSave = async () => {
    if (!form.description?.trim()) { alert('กรุณากรอก Description'); return; }
    setSaving(true);
    try {
      const payload = { ...form, updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString() };
      if (view === 'edit' && viewTarget?.id) {
        const { error } = await db.from('itemcode_list').update(payload).eq('id', viewTarget.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('itemcode_list').insert([{ ...payload, code: nextCode }]);
        if (error) throw error;
      }
      if (fetchCollection) await fetchCollection('ItemcodeList', true);
      setView('search'); setForm(emptyForm); setViewTarget(null);
    } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`ต้องการลบ "${item.code} — ${item.description || ''}" ใช่หรือไม่?`)) return;
    try {
      const { error } = await db.from('itemcode_list').delete().eq('id', item.id);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('ItemcodeList', true);
    } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); }
  };

  const openForm = (item, mode) => {
    setViewTarget(item);
    setView(mode);
  };

  if (!show) return null;

  const buLower = String(bu ?? '').toLowerCase();
  const buFiltered = itemcodeItems.filter(i => { const ib = String(i['bu'] ?? '').toLowerCase(); return ib === 'free' || (buLower && ib === buLower); });
  const q = query.trim().toLowerCase();
  const filtered0 = q ? buFiltered.filter(i => i['code']?.toLowerCase().includes(q) || i['description']?.toLowerCase().includes(q) || i['keyword']?.toLowerCase().includes(q) || i['cpc']?.toLowerCase().includes(q) || i['account']?.includes(q)) : buFiltered;
  const sortedAll = [...filtered0].sort((a, b) => String(a['code'] ?? '').localeCompare(String(b['code'] ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
  const favItems  = vendorTaxId ? sortedAll.filter(i => (Array.isArray(i.favorite_taxids) ? i.favorite_taxids : []).includes(vendorTaxId)) : [];
  const restItems = vendorTaxId ? sortedAll.filter(i => !(Array.isArray(i.favorite_taxids) ? i.favorite_taxids : []).includes(vendorTaxId)) : sortedAll;
  const filtered  = [...favItems, ...restItems];

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active]); }
  };

  const COLS = [['code','Code','100px'],['bu','BU','45px'],['description','Description','200px'],['cpc','CPC','55px'],['account','Account','80px'],['sub','SUB','55px'],['spec_tx','TX','55px'],['_fav','★','20px'],['_action','Action','126px']];
  const FIELD_OPTIONS = {};
  ITEM_COMBO_FIELDS.forEach(key => { FIELD_OPTIONS[key] = [...new Set(itemcodeItems.map(i => i[key]).filter(v => v !== undefined && v !== null && String(v).trim() !== ''))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })); });

  // ── shared styles (light-blue panel ตาม mockup) ─────────────────────────────
  const LBL  = { padding: '8px 10px', fontSize: '11px', fontWeight: '600', color: '#1a3a5c', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0', background: '#f8f9fa', whiteSpace: 'nowrap' };
  const HEAD = { padding: '7px 8px', fontSize: '11px', fontWeight: '600', color: '#1a3a5c', textAlign: 'center', background: '#f8f9fa', borderRight: '0.5px solid #e8eaf0' };
  const cellY = { background: '#FFF3CD' }; // เหลือง
  const inputBase = { height: '30px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', boxSizing: 'border-box', width: '100%' };
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // input cell helper
  const inp = (key, opts = {}) => (
    <input value={form[key] ?? ''} readOnly={isReadOnly} onChange={e => setF(key, e.target.value)}
      placeholder={opts.placeholder || ''} style={{ ...inputBase, ...(opts.style || {}) }} />
  );
  // description box (textarea) — Row 6-8 (dis_g_desc ฯลฯ)
  const descBox = (key) => (
    <textarea value={form[key] ?? ''} readOnly={isReadOnly} onChange={e => setF(key, e.target.value)}
      placeholder="N/A"
      style={{ width: '100%', minHeight: '52px', padding: '8px 10px', fontSize: '12px', border: 'none', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.4' }} />
  );

  const renderForm = () => {
    const title = view === 'new' ? 'New Item Code' : view === 'edit' ? `Edit — ${viewTarget?.code || ''}` : `View — ${viewTarget?.code || ''}`;
    const codeDisplay = view === 'new' ? nextCode : (viewTarget?.code || '');
    const icon = view === 'view' ? '👁' : view === 'edit' ? '✏️' : '🔖';
    const iconBg = view === 'new' ? '#27500A' : '#1a3a5c';
    return (
      <>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <button onClick={() => { setView('search'); setViewTarget(null); }} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f5f7fa', border: '0.5px solid #dde', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', color: '#555', fontSize: '12px', fontWeight: '500', flexShrink: 0 }}>← Back</button>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>{title}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>Code: {codeDisplay}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'white', display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Row 1: Item Code | BU */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={LBL}>Item Code</div>
            <div style={{ background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '0.5px solid #e8eaf0', fontSize: '13px', fontWeight: '600', color: '#1a3a5c' }}>{codeDisplay}</div>
            <div style={LBL}>BU</div>
            <div style={cellY}>{inp('bu', { style: { textAlign: 'center', fontWeight: '600' } })}</div>
          </div>

          {/* Row 2: Description | Cpc | Account | Sub Acc */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px 120px 80px 120px 80px 120px', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={LBL}>Description</div>
            <div style={{ ...cellY, borderRight: '0.5px solid #e8eaf0' }}>{inp('description')}</div>
            <div style={LBL}>Cpc</div>
            <div style={{ ...cellY, borderRight: '0.5px solid #e8eaf0' }}>{inp('cpc')}</div>
            <div style={LBL}>Account</div>
            <div style={{ ...cellY, borderRight: '0.5px solid #e8eaf0' }}>{inp('account')}</div>
            <div style={LBL}>Sub Acc</div>
            <div style={cellY}>{inp('sub')}</div>
          </div>

          {/* Row 3: heads Dis-G..SPEC-TX */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
            {['Dis-G','I & G','Value','OTH','SPI-1','SPEC-TX'].map((h, i) => (
              <div key={h} style={{ ...HEAD, borderRight: i < 5 ? '0.5px solid #e8eaf0' : 'none' }}>{h}</div>
            ))}
          </div>

          {/* Row 4: combo 6 ช่อง */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            {ITEM_COMBO_FIELDS.map((key) => (
              <ICCombo key={key} value={form[key] ?? ''} options={FIELD_OPTIONS[key] || []} readOnly={isReadOnly} onChange={v => setF(key, v)} />
            ))}
          </div>

          {/* Row 5: Custom Item | Black Cell */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={LBL}>Custom Item</div>
            <div style={{ background: 'white' }}>{inp('item', { style: { background: 'white' } })}</div>
          </div>

          {/* Row 6-8: Description boxes (dis_g_desc ฯลฯ) */}
          {[
            ['Dis-G Description', 'dis_g_desc', 'I & G Description', 'i_and_g_desc'],
            ['VALUE Description', 'value_desc', 'OTH Description', 'oth_desc'],
            ['SPI-1 Description', 'spi1_desc', 'SPEC-TX Description', 'spec_tx_desc'],
          ].map(([l1, k1, l2, k2], ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 140px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ ...LBL, alignItems: 'flex-start', paddingTop: '10px' }}>{l1}</div>
              <div style={{ background: 'white', borderRight: '0.5px solid #e8eaf0' }}>{descBox(k1)}</div>
              <div style={{ ...LBL, alignItems: 'flex-start', paddingTop: '10px' }}>{l2}</div>
              <div style={{ background: 'white' }}>{descBox(k2)}</div>
            </div>
          ))}

          {/* Row 9: Keyword */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={LBL}>Keyword</div>
            <div style={{ background: 'white' }}>{inp('keyword', { style: { background: 'white' } })}</div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0, background: '#fafbfc' }}>
          <button onClick={() => { setView('search'); setViewTarget(null); }} style={{ padding: '7px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>{isReadOnly ? 'Close' : 'Cancel'}</button>
          {!isReadOnly && (
            <button onClick={handleSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : '💾 Save'}</button>
          )}
        </div>
      </>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: view === 'search' ? '95vw' : '94vw', maxWidth: view === 'search' ? '900px' : '980px', height: view === 'search' ? '84vh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>
        {view === 'search' ? (
          <>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🔖</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Select Item Code</div>
                <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>{filtered.length} รายการ{query ? ` · ค้นหา "${query}"` : ''} · BU: FREE{bu ? `, ${bu}` : ''}</div>
              </div>
              <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey} placeholder="ค้นหา Code, Description, CPC, Account, Keyword..."
                    style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                    onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
                  {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
                </div>
                {canEdit && (
                  <button onClick={() => { setView('new'); setForm({ ...emptyForm, bu: bu || '' }); }} style={{ height: '36px', padding: '0 16px', borderRadius: '8px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Item
                  </button>
                )}
              </div>
            </div>
            <div ref={listRef} style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed', minWidth: '720px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>{COLS.map(([key, label, w]) => (<th key={key} style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 10px', textAlign: key === '_action' ? 'center' : 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined }}>{label}</th>))}</tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (<tr><td colSpan={COLS.length} style={{ textAlign: 'center', color: '#aaa', padding: '48px', fontSize: '13px' }}>ไม่พบ Item Code{query ? ` "${query}"` : ''}</td></tr>)
                  : filtered.map((item, i) => {
                    const isAct = i === active;
                    const showFavHeader = i === 0 && favItems.length > 0;
                    const showAllHeader = i === favItems.length && favItems.length > 0;
                    return (
                    <React.Fragment key={item.id || i}>
                    {showFavHeader && <tr><td colSpan={COLS.length} style={{ padding: '5px 10px', fontSize: '10px', fontWeight: '600', color: '#e6a800', background: '#fffbf0', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '0.5px solid #f3e6a0' }}>★ Favorites ({favItems.length})</td></tr>}
                    {showAllHeader && <tr><td colSpan={COLS.length} style={{ padding: '5px 10px', fontSize: '10px', fontWeight: '600', color: '#888', background: '#f8f9fa', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '0.5px solid #e8eaf0' }}>All Items ({restItems.length})</td></tr>}
                    <tr data-row={i} onClick={() => onSelect(item)} onMouseEnter={() => setActive(i)} style={{ background: isAct ? '#eef3fb' : (favItems.includes(item) ? '#fffbf0' : 'white'), cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6' }}>
                      {COLS.map(([key, , w]) => (
                        <td key={key} style={{ padding: '7px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: w || undefined, textAlign: key === '_action' ? 'center' : 'left' }} onClick={key === '_action' || key === '_fav' ? (e) => e.stopPropagation() : undefined}>
                          {key === '_fav' ? (
                            <button
                              onClick={e => toggleFav(e, item)}
                              disabled={favUpdating === item.code}
                              title={isFav(item) ? 'เอาออกจาก Favorite' : 'เพิ่มใน Favorite'}
                              style={{ width: '26px', height: '22px', borderRadius: '5px', border: 'none', background: 'transparent', cursor: favUpdating === item.code ? 'wait' : 'pointer', fontSize: '14px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFav(item) ? '#e6a800' : '#ccc' }}>
                              {isFav(item) ? '★' : '☆'}
                            </button>
                          ) : key === '_action' ? (
                            <div style={{ display: 'inline-flex', gap: '5px' }}>
                              <button title="View" onClick={(e) => { e.stopPropagation(); openForm(item, 'view'); }}
                                style={{ width: '28px', height: '24px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                              </button>
                              {canEdit && (
                                <button title="Edit" onClick={(e) => { e.stopPropagation(); openForm(item, 'edit'); }}
                                  style={{ width: '28px', height: '24px', borderRadius: '5px', border: '0.5px solid #ddd', background: '#f5f5f5', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                              )}
                              {canDelete && (
                                <button title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                                  style={{ width: '28px', height: '24px', borderRadius: '5px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                </button>
                              )}
                            </div>
                          ) : key === 'code' ? (
                            <span style={{ background: isAct ? '#1a3a5c' : (favItems.includes(item) ? '#fff3cd' : '#f0f3f8'), color: isAct ? 'white' : '#1a3a5c', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', fontWeight: '600' }}>{item[key] || '-'}</span>
                          ) : (
                            <span style={{ color: '#333' }}>{item[key] || '-'}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                    </React.Fragment>);
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
              <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {buFiltered.length} รายการ</span>
              <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </>
        ) : renderForm()}
      </div>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// SupplierSearchPopup — with Add/Edit form (Editor+ only)
// ─────────────────────────────────────────────────────────────────────────────
// field layout ตรงกับ VendorMaster apcode tab
// [key, label, gridSpan, type]  span คือ 3-column grid (max 3)
// SUPPLIER_FIELDS ตรงกับ apcode tab ใน VendorMaster
// [key, label, gridSpan(max3), type]  — section แบ่งด้วย 'section' type
const SUPPLIER_FIELDS = [
  // ── ข้อมูลหลัก ──────────────────────────────────────────────────────────
  ['Code',            'Code *',                1, 'code'],
  ['BU Code',         'BU',                    1, 'readonly'],
  ['Supplier Site',   'Supplier Site',          1, 'combo'],
  ['Supplier Name',   'Supplier Name *',        3, 'text'],
  ['Supplier Number', 'Supplier No.',           1, 'text'],
  ['Supplier Ref.',   'Supplier Ref.',          1, 'text'],
  ['Tax-Type',        'Tax-Type',               1, 'combo'],
  ['Notice',          'Notice',                 1, 'combo'],
  ['Sub Acc',         'Sub Acc',                1, 'text'],
  // ── ข้อมูลติดต่อ ─────────────────────────────────────────────────────────
  ['Tax ID',          'Tax ID',                 1, 'text'],
  ['No.',             'No.',                    1, 'text'],
  ['Contact',         'Contact',                1, 'text'],
  ['Email',           'Email',                  1, 'text'],
  ['Address',         'Address',                3, 'textarea'],
  // ── Coding ───────────────────────────────────────────────────────────────
  ['First Part',      'First Part',             1, 'text'],
  ['Mid Part',        'Mid Part',               1, 'text'],
  ['Last Part',       'Last Part',              1, 'text'],
  ['Invoice No.',     'Invoice No.',            1, 'combo'],
  ['Digit',           'Digit',                  1, 'text'],
  ['Due',             'Due',                    1, 'text'],
  // ── คำอธิบาย ─────────────────────────────────────────────────────────────
  ['NoticeDescrip',   'Notice Description',     3, 'textarea'],
  ['RuleDescrip',     'Rule Description',       3, 'textarea'],
];

const fmt2Val = (n) => n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const buildTaxCodeVal = (vatChar, branchDirectCode) => {
  const v = String(vatChar ?? '').trim().toUpperCase();
  if (v === 'V') return `${branchDirectCode}-N VAT7%`;
  if (v === 'S') return `${branchDirectCode}-N SVAT7%`;
  return '';
};
const buildWhtCodeVal = (whtChar, branchDirectCode) => {
  const w = String(whtChar ?? '').trim().toUpperCase();
  if (w === 'N' || w === '') return '';
  return `${branchDirectCode}-WHT${w}%`;
};

const calcInvoiceLine = (line, itemcodeItems, vendorInfo, form) => {
  if (!line.itemCode?.trim()) return { ...line, desc: '', account: '', taxCode: '', whtCode: '', vat: '', wht: '', total: '' };
  const itemData = itemcodeItems.find(i => String(i.code ?? '').trim().toUpperCase() === line.itemCode.trim().toUpperCase());
  if (!itemData) return line;
  const rawSub = String(itemData.sub ?? '').trim();
  const subVal = rawSub.toUpperCase() === 'SUB' ? String(vendorInfo?.['Sub Acc'] ?? '').trim() : rawSub;
  const rawCpc = String(itemData.cpc ?? '').trim();
  const spi1 = String(itemData.spi1 ?? '').trim().toUpperCase();
  const effectiveCpc = form?.branchCpc?.trim()? form.branchCpc.trim(): (spi1 === 'C-CPC' && form?.headerCpc?.trim())? form.headerCpc.trim(): rawCpc;
  const accountVal = [effectiveCpc, String(itemData.account ?? '').trim(), subVal].filter(Boolean).join('-');
  const hasIB = form?.branchIBLabel && form.branchIBLabel !== '-';
  const isIBAll = form?.branchIBLabel === 'IB-ALL';
  const ibPrefix = isIBAll ? 'IB-ALL' : hasIB ? `${form?.branchNo ?? ''}-IB` : '';
  const ibLabel = hasIB && !isIBAll ? `สาขา ${String(form?.branchIBLabel ?? '').split('-').slice(1).join('-').trim()}` : '';
  const disGDesc = buildDisGDesc(itemData?.dis_g, form?.backDesc1, form?.backDesc2, form?.backDesc3);
  const descVal = [ibPrefix, form?.period ?? '', String(itemData.description ?? '').trim(), disGDesc, ibLabel].filter(Boolean).join(' ');
  const notices = String(vendorInfo?.['Notice'] ?? '').split('|').map(n => n.trim().toUpperCase());
  const hasITC = notices.includes('ITC');
  const hasVITEM = notices.some(n => n === 'V-ITEM' || n === 'TC V-ITEM');
  const hasTC = notices.some(n => n === 'TC' || n === 'TC V-ITEM');
  let sourceStr = String(vendorInfo?.['Tax-Type'] ?? '').trim().toUpperCase();
  if (hasTC || hasVITEM) sourceStr = String(itemData?.spec_tx ?? '').trim().toUpperCase();
  if (form?.invTax?.trim()) sourceStr = String(form.invTax).trim().toUpperCase();
  if (line.tax?.trim()) sourceStr = String(line.tax).trim().toUpperCase();
  const vatChar = sourceStr[0] ?? '';
  const whtChar = sourceStr[1] ?? '';
  const branchDirectCode = String(form?.branchDirectLabel ?? '').split('-')[0].trim();
  const taxCodeVal = buildTaxCodeVal(vatChar, branchDirectCode);
  const whtCodeVal = hasITC ? '' : buildWhtCodeVal(whtChar, branchDirectCode);
  const amountNum = parseFloat(String(line.amount).replace(/,/g, '')) || 0;
  const vatNum = (vatChar === 'V' || vatChar === 'S') ? Math.round(amountNum * 0.07 * 100) / 100 : 0;
  const whtPct = hasITC ? 0 : (parseFloat(whtChar) || 0);
  const whtNum = -Math.round(amountNum * (whtPct / 100) * 100) / 100;
  const totalNum = Math.round((amountNum + vatNum) * 100) / 100;
  return { ...line, desc: descVal, account: accountVal, taxCode: taxCodeVal, whtCode: whtCodeVal, vat: fmt2Val(vatNum), wht: fmt2Val(whtNum), total: fmt2Val(totalNum), _taxCodeRaw: taxCodeVal, _accountRaw: String(itemData.account ?? '').trim() };
};

const recalcLines = (lines, itemcodeItems, vendorInfo, form) => {
  const calculated = lines.map(l => calcInvoiceLine(l, itemcodeItems, vendorInfo, form));
  const hasT = calculated.some(l => String(l._accountRaw || '').startsWith('116301'));
  return calculated.map(l => ({ ...l, taxCode: l._taxCodeRaw ? (hasT ? 'T' + l._taxCodeRaw : l._taxCodeRaw) : l.taxCode }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Invoice No. auto-generate — ประกอบเลข Invoice เต็มจาก running number ที่กรอก
// ตาม Invoice Rule / First-Mid-Last Part / Digit ของ supplier
// (อ้างอิง macro Option_InvoiceCal เดิม)
// ─────────────────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const invFmtYY       = (d) => pad2(d.getFullYear() % 100);
const invFmtYYYY     = (d) => String(d.getFullYear());
const invFmtMM       = (d) => pad2(d.getMonth() + 1);
const invFmtDD       = (d) => pad2(d.getDate());
const invFmtYYMM     = (d) => invFmtYY(d) + invFmtMM(d);
const invFmtYYYYMM   = (d) => invFmtYYYY(d) + invFmtMM(d);
const invFmtDDMMYYYY = (d) => invFmtDD(d) + invFmtMM(d) + invFmtYYYY(d);
const invFmtYYMMDD   = (d) => invFmtYY(d) + invFmtMM(d) + invFmtDD(d);

// pattern builders: (Fp, Mp, Lp, d, result) => string — ตาม Invoice No. rule code ของ supplier
const INVOICE_PATTERN_BUILDERS = {
  'AF-2Y2M':     (Fp, Mp, Lp, d, r) => `${Fp}${invFmtYYMM(d)}${Mp}${r}`,
  'AF-T2Y2M':    (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYY(d), 10) + 43}${invFmtMM(d)}${Mp}${r}`,
  'AF-TFY2M':    (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYY(d), 10) + 543}${invFmtMM(d)}${Mp}${r}`,
  'FY2M':        (Fp, Mp, Lp, d, r) => `${invFmtYYYYMM(d)}${Mp}${r}`,
  '2D2MFY':      (Fp, Mp, Lp, d, r) => `${invFmtDDMMYYYY(d)}${Mp}${r}`,
  'FY':          (Fp, Mp, Lp, d, r) => `${invFmtYYYY(d)}${Mp}${r}`,
  'T2Y':         (Fp, Mp, Lp, d, r) => `${parseInt(invFmtYY(d), 10) + 43}${Mp}${r}`,
  'AF-2M':       (Fp, Mp, Lp, d, r) => `${invFmtMM(d)}${Mp}${r}`,
  'AF-T2Y':      (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYY(d), 10) + 43}${Mp}${r}`,
  'AF-TFY':      (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYYYY(d), 10) + 543}${Mp}${r}`,
  'TFY':         (Fp, Mp, Lp, d, r) => `${parseInt(invFmtYYYY(d), 10) + 543}${Mp}${r}`,
  'AF-FY2M':     (Fp, Mp, Lp, d, r) => `${Fp}${invFmtYYYYMM(d)}${Mp}${r}`,
  'AF-2Y':       (Fp, Mp, Lp, d, r) => `${Fp}${invFmtYY(d)}${Mp}${r}`,
  'AF-TFY|2M':   (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYYYY(d), 10) + 543}${Mp}${invFmtMM(d)}${Lp}${r}`,
  'AF-FY|2M':    (Fp, Mp, Lp, d, r) => `${Fp}${invFmtYYYY(d)}${Mp}${invFmtMM(d)}${Lp}${r}`,
  'AF-2Y|2M':    (Fp, Mp, Lp, d, r) => `${Fp}${invFmtYY(d)}${Mp}${invFmtMM(d)}${Lp}${r}`,
  'AF-T2Y|2M':   (Fp, Mp, Lp, d, r) => `${Fp}${parseInt(invFmtYY(d), 10) + 43}${Mp}${invFmtMM(d)}${Lp}${r}`,
  'AF-YYMMDD-1': (Fp, Mp, Lp, d, r) => { const d2 = new Date(d); d2.setDate(d2.getDate() - 1); return `${Fp}${invFmtYYMMDD(d2)}${Lp}${r}`; },
  'AF-2YMM-1':   (Fp, Mp, Lp, d, r) => { const d2 = new Date(d); d2.setMonth(d2.getMonth() - 1); return `${Fp}${invFmtYYMM(d2)}${Lp}${r}`; },
};

// typedNum   = เลขรันที่ user กรอกในช่อง Invoice num (กรอบแดง)
// invDateStr = ค่าจาก input[type=date] ("YYYY-MM-DD")
// vendorInfo = record จาก supplier_list (มี 'Invoice No.', 'First Part', 'Mid Part', 'Last Part', 'Digit')
const buildInvoiceNumber = (typedNum, invDateStr, vendorInfo) => {
  const raw = String(typedNum ?? '').trim();
  if (!raw) return '';

  const Fp = String(vendorInfo?.['First Part'] ?? '').trim();
  const Mp = String(vendorInfo?.['Mid Part'] ?? '').trim();
  const Lp = String(vendorInfo?.['Last Part'] ?? '').trim();
  const ruleCode = String(vendorInfo?.['Invoice No.'] ?? '').trim();
  const digitRule = String(vendorInfo?.['Digit'] ?? '').trim().toUpperCase();

  // "NDB" -> n หลัก ที่ supplier กำหนด (เช่น "4DB" -> 4)
  const dm = digitRule.match(/^(\d{1,2})DB$/);
  const n = dm ? parseInt(dm[1], 10) : 0;

  // ── กรอกเกินจำนวนหลักที่กำหนด -> ใช้ค่าที่กรอกเป็น Invoice No. ตรงๆ ทั้งหมด ──
  if (n > 0 && raw.length > n) return raw;

  // ── pad เลขรันด้วย 0 ให้ครบ n หลัก (เฉพาะกรณีกรอกเป็นตัวเลขล้วน) ──────────
  const result = (n > 0 && /^\d+$/.test(raw)) ? raw.padStart(n, '0') : raw;

  const d = invDateStr ? new Date(`${invDateStr}T00:00:00`) : null;
  const builder = INVOICE_PATTERN_BUILDERS[ruleCode];
  if (!builder || !d || isNaN(d.getTime())) return `${Fp}${result}`;
  return builder(Fp, Mp, Lp, d, result);
};

const TAX_TYPE_OPTS = ['VN','SN','NN','V1','V2','V3','V5','S1','S2','S3','S5','N1','N2','N3','N5'];

const VRV_MAPPING = {
  'C0001474': { h: 'C0001564', l: 'C0001631' },
  'C0001565': { h: 'C0001497', l: 'C0000674' },
};

const SUPPLIER_SITE_OPTS_DEFAULT = ['สำนักงานใหญ่','HQ','MAIN'];
const DIGIT_OPTS_DEFAULT = ['4DB','5DB','6DB','7DB','8DB'];
const INVOICE_NO_OPTS_DEFAULT = Object.keys(INVOICE_PATTERN_BUILDERS);


function SupplierSearchPopup({ show, onClose, onSelect, supplierItems = [], bu = '', bookFilter = '', fetchCollection, userName = '' }) {
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const canEdit = isOwner || isAdmin || isEditor;
  const canDelete = isOwner || isAdmin;

  const [query, setQuery]         = useState('');
  const [active, setActive]       = useState(-1);
  const [sortField, setSortField] = useState('Code');
  const [sortDir, setSortDir]     = useState('asc');
  const [view, setView]           = useState('search');
  const [editTarget, setEditTarget] = useState(null);
  const [form, setFormState]      = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving]       = useState(false);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const emptyForm = () => {
    const f = {};
    SUPPLIER_FIELDS.forEach(([key]) => { f[key] = ''; });
    f['BU Code'] = bu || '';
    return f;
  };

  useEffect(() => {
    if (show) { setQuery(''); setActive(-1); setView('search'); setEditTarget(null); setFormState({}); setFormError(''); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') { if (view === 'search') onClose(); else handleBack(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose, view]);

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!show) return null;

  const buLower = String(bu ?? '').toLowerCase();
  // ── ตรวจสอบจากข้อมูลจริงก่อนว่า BU นี้มี supplier code ของตัวเองอยู่แล้วหรือไม่ ──
  // (เช่น "LKS-xxxx") ถ้ามี -> ใช้ bu กรองตามปกติ ไม่สนใจ bookFilter ที่ส่งมา
  // ถ้าไม่มีเลยสักรายการ -> ถือว่า BU นี้พึ่ง book ของ BU อื่นจริง -> fallback ไปใช้ bookFilter
  const buHasOwnCodes = buLower
    ? supplierItems.some(i => String(i['Code'] ?? '').toLowerCase().startsWith(buLower + '-'))
    : false;
  const effectiveBookFilter = (bookFilter && !buHasOwnCodes) ? bookFilter : '';

  const buFiltered = effectiveBookFilter
    ? supplierItems.filter(i => {
        const prefix = String(i['Code'] ?? '').split('-')[0].toUpperCase();
        return prefix === effectiveBookFilter.toUpperCase();
      })
    : buLower
      ? supplierItems.filter(i => String(i['Code'] ?? '').toLowerCase().startsWith(buLower + '-'))
      : supplierItems;

  const q = query.trim().toLowerCase();
  const filtered0 = q
    ? buFiltered.filter(i =>
        String(i['Code'] ?? '').toLowerCase().includes(q) ||
        String(i['Supplier Name'] ?? '').toLowerCase().includes(q) ||
        String(i['Supplier Number'] ?? '').toLowerCase().includes(q) ||
        String(i['Tax ID'] ?? '').toLowerCase().includes(q)
      )
    : buFiltered;

  const filtered = [...filtered0].sort((a, b) => {
    const va = String(a[sortField] ?? ''), vb = String(b[sortField] ?? '');
    const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (field) => { setActive(-1); if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(field); setSortDir('asc'); } };
  const handleKey  = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active]); }
  };

  const handleOpenNew = () => {
    if (!canEdit) return;
    setEditTarget(null); setFormState(emptyForm()); setFormError(''); setView('new');
  };
  const handleOpenEdit = (item, viewOnly = false) => {
    if (!viewOnly && !canEdit) return;
    const f = emptyForm();
    SUPPLIER_FIELDS.forEach(([key]) => { f[key] = item[key] || ''; });
    f['BU Code'] = item['BU Code'] || String(item['Code'] ?? '').split('-')[0] || bu || '';
    setEditTarget(item); setFormState(f); setFormError(''); setView(viewOnly ? 'view' : 'edit');
  };
  const handleBack = () => { setView('search'); setEditTarget(null); setFormState({}); setFormError(''); setTimeout(() => inputRef.current?.focus(), 60); };

  const setField = (key, val) => { setFormState(f => ({ ...f, [key]: val })); setFormError(''); };

  const validate = (f) => {
    if (!f['Code']?.trim()) return 'กรุณากรอก Code';
    if (!f['Supplier Name']?.trim()) return 'กรุณากรอก Supplier Name (TH)';
    if (!f['Supplier Number']?.trim()) return 'กรุณากรอก Supplier No.';
    if (!f['Supplier Site']?.trim()) return 'กรุณากรอก Supplier Site';
    if (!f['BU Code']?.trim()) return 'กรุณากรอก BU Code';
    return '';
  };

  const handleSave = async () => {
    if (!canEdit) return;
    const err = validate(form); if (err) { setFormError(err); return; }
    setSaving(true);
    try {
      const meta = { updated_by: userName, updated_at: new Date().toISOString() };
      const payload = { ...form, ...meta };
      if (view === 'edit' && editTarget?.id) {
        const { error } = await db.from('supplier_list').update(payload).eq('id', editTarget.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('supplier_list').insert([payload]);
        if (error) throw error;
      }
      if (fetchCollection) await fetchCollection('SupplierList', true);
      handleBack();
    } catch (e) { setFormError('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const handleDeleteSupplier = async (item) => {
    if (!window.confirm(`ต้องการลบ "${item['Code']} — ${item['Supplier Name'] || ''}" ใช่หรือไม่?`)) return;
    try {
      const { error } = await db.from('supplier_list').delete().eq('id', item.id);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('SupplierList', true);
    } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); }
  };

  const COLS = [
    ['Code',            'Code',          '110px'],
    ['bu',              'BU',            '55px'],
    ['Supplier Name',   'Supplier Name', ''],
    ['Supplier Number', 'Supplier No.',  '110px'],
    ['Supplier Site',   'Site',          '100px'],
    ['Tax-Type',        'Tax-Type',      '75px'],
    ['Notice',          'Notice',        '75px'],
  ];

  const baseInput = { height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', width: '100%', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c' };
  const isEdit = view === 'edit';

  // ── getOpts: ดึง unique non-empty values จาก supplierItems ทั้งหมด (ไม่ filter BU) ──
  // ── merge กับ hardcoded defaults สำหรับ field ที่มี master list คงที่ ──────────────
  const getOpts = (key) => {
    const allSuppliers = supplierItems.length > 0 ? supplierItems : (() => { try { return JSON.parse(sessionStorage.getItem('fastapn_cache'))?.SupplierList || []; } catch { return []; } })();
    const fromCache = allSuppliers.map(i => String(i[key] ?? '').trim()).filter(Boolean);
    let defaults = [];
    if (key === 'Tax-Type')   defaults = TAX_TYPE_OPTS;
    if (key === 'Digit')      defaults = DIGIT_OPTS_DEFAULT;
    if (key === 'Invoice No.') defaults = INVOICE_NO_OPTS_DEFAULT;
    if (key === 'Supplier Site') defaults = SUPPLIER_SITE_OPTS_DEFAULT;
    return [...new Set([...fromCache, ...defaults])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  };

  const renderFormView = () => (
    <>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
        <button onClick={handleBack} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f5f7fa', border: '0.5px solid #dde', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', color: '#555', fontSize: '12px', fontWeight: '500', flexShrink: 0 }}>← Back</button>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: view === 'view' ? '#1a3a5c' : isEdit ? '#0C447C' : '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>
          {view === 'view' ? '👁' : isEdit ? '✏️' : '➕'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>
            {view === 'view' ? `View supplier — ${editTarget?.['Code'] || ''}` : isEdit ? `Edit supplier — ${editTarget?.['Code'] || ''}` : 'New supplier'}
          </div>
          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>BU: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{bu || '-'}</span></div>
        </div>
        {view === 'view' && canEdit && (
          <button onClick={() => setView('edit')} style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: '#0C447C', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>✏️ Edit</button>
        )}
        {isEdit && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#FCEBEB', color: '#791F1F', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Editor+ only
          </span>
        )}
      </div>
      {formError && <div style={{ padding: '8px 20px', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', borderBottom: '1px solid #f7c1c1', flexShrink: 0 }}>⚠️ {formError}</div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {formError && false}
        {(() => {
          const lbl = (text, extra = {}) => (
            <div style={{ padding: '6px 10px', fontSize: '11px', color: '#888', display: 'flex', alignItems: 'center', background: '#f8f9fa', whiteSpace: 'nowrap', borderRight: '0.5px solid #e8eaf0', ...extra }}>{text}</div>
          );
          const cell = (key, readOnly = false, opts = {}) => {
            const isCodeRO = key === 'Code' && isEdit;
            const ro = readOnly || isCodeRO;
            const isRequired = SUPPLIER_FIELDS.find(([k]) => k === key)?.[1]?.includes('*');
            const hasErr = !!formError && isRequired && !form[key]?.trim();
            const s = { ...baseInput, background: 'transparent', border: hasErr ? '1px solid #e74c3c' : 'none', outline: 'none', width: '100%', height: '28px', color: ro ? '#999' : '#1a3a5c', ...opts };
            return <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0' }}><input value={form[key] || ''} readOnly={ro} onChange={e => !ro && setField(key, e.target.value)} style={s} /></div>;
          };
          const combo = (key, extra = {}) => {
            const opts = getOpts(key);
            return (
              <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0', ...extra }}>
                <ComboInput value={form[key] || ''} onChange={v => setField(key, v)} options={opts} placeholder="เลือก" />
              </div>
            );
          };
          // ── yCell/yCombo/yStatic: เซลล์พื้นเหลือง สำหรับ Row 1-2 ──────────
          // ── (Code, Supplier Name, Supplier Number, Supplier Site, BU Code) ─
          const yCell = (key, opts = {}) => {
            const ro = (key === 'Code' && isEdit) || opts.readOnly;
            const isRequired = SUPPLIER_FIELDS.find(([k]) => k === key)?.[1]?.includes('*');
            const hasErr = !!formError && isRequired && !form[key]?.trim();
            return (
              <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', background: '#FFF3CD', borderRight: '0.5px solid #e8eaf0', ...opts.cellStyle }}>
                <input value={form[key] || ''} readOnly={ro} onChange={e => !ro && setField(key, e.target.value)} style={{ ...baseInput, background: 'transparent', border: hasErr ? '1px solid #e74c3c' : 'none', outline: 'none', width: '100%', height: '28px', color: ro ? '#999' : '#1a3a5c' }} />
              </div>
            );
          };
          const yCombo = (key, opts = {}) => {
            const cOpts = getOpts(key);
            return (
              <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', background: '#FFF3CD', borderRight: '0.5px solid #e8eaf0', ...opts.cellStyle }}>
                <ComboInput value={form[key] || ''} onChange={v => setField(key, v)} options={cOpts} placeholder="เลือก" />
              </div>
            );
          };
          const yStatic = (val, opts = {}) => (
            <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', background: '#FFF3CD', borderRight: '0.5px solid #e8eaf0', ...opts.cellStyle }}>
              <input value={val} readOnly style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px', color: '#999' }} />
            </div>
          );
          // ── invoiceRuleMatch: true เมื่อ 'Invoice No.' ที่กรอก ตรงกับ supplier ──
          // ── รายอื่นใน BU นี้ (มีอยู่ใน cache SupplierList แล้ว) ──────────────────
          const invoiceRuleMatch = !!form['Invoice No.']?.trim() && buFiltered.some(i => String(i['Invoice No.'] ?? '').trim().toLowerCase() === form['Invoice No.'].trim().toLowerCase());
          const row = (cols, extra = {}) => (
            <div style={{ display: 'grid', gridTemplateColumns: cols, border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden', ...extra }} />
          );
          const ROW = (cols, children, extra = {}) => (
            <div style={{ display: 'grid', gridTemplateColumns: cols, border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden', ...extra }}>
              {children}
            </div>
          );
          return (
            <>
              {/* ── Row 1-3: ใช้ grid columns เดียวกัน '110px 1fr 110px 1fr 110px 1fr' ──── */}
              {/* ── ทำให้คอลัมน์ของทั้ง 3 แถวตรงกันเหมือนตาราง — Code / Supplier   ──── */}
              {/* ── Name / Supplier Number / Supplier Site / BU Code = พื้นเหลือง  ──── */}

              {/* Row 1: Code + Supplier Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr 110px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Code' + (isEdit ? '' : ' *'))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px', borderRight: '0.5px solid #e8eaf0' }}>
                  {yCell('Code', { cellStyle: { borderRight: 'none' } })}
                  <div style={{ background: '#FFF3CD' }} />
                </div>
                {lbl('Supplier Name *')}
                {yCell('Supplier Name', { cellStyle: { gridColumn: 'span 3' } })}
              </div>

              {/* Row 2: Supplier No. + Supplier Site + BU Code */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr 110px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Supplier No.')}
                {yCell('Supplier Number')}
                {lbl('Supplier Site')}
                {yCombo('Supplier Site')}
                {lbl('BU Code')}
                {yStatic(form['BU Code'] || '')}
              </div>

              {/* Row 3: Tax ID + Branch No. + Tax-Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr 110px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Tax ID')}
                {cell('Tax ID')}
                {lbl('Branch No.')}
                {cell('No.')}
                {lbl('Tax-Type')}
                {combo('Tax-Type')}
              </div>

              {/* Row 4+5: Invoice Rule section — headers + values (Format เดียวกับ Contact) */}
              {/* ── 6 คอลัมน์เท่ากัน — Digit + Due Date รวมอยู่ในคอลัมน์เดียวกัน (แบ่งซ้าย-ขวา) ── */}
              <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderBottom: '0.5px solid #e8eaf0' }}>
                  {['Invoice Rule','First Part','Mid Part','Last Part'].map((h) => (
                    <div key={h} style={{ padding: '6px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', borderRight: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{h}</div>
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderRight: '0.5px solid #e8eaf0' }}>
                    <div style={{ padding: '6px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', borderRight: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>Digit</div>
                    <div style={{ padding: '6px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', whiteSpace: 'nowrap' }}>Due Date</div>
                  </div>
                  <div style={{ padding: '6px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', whiteSpace: 'nowrap' }}>Notice</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                  {(() => { const opts = getOpts('Invoice No.'); return <div key="invno" style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><ComboInput value={form['Invoice No.'] || ''} onChange={v => setField('Invoice No.', v)} options={opts} /></div>; })()}
                  <div key="fp" style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><input value={form['First Part'] || ''} onChange={e => setField('First Part', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
                  <div key="mp" style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><input value={form['Mid Part'] || ''} onChange={e => setField('Mid Part', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
                  <div key="lp" style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><input value={form['Last Part'] || ''} onChange={e => setField('Last Part', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
                  <div key="digdue" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderRight: '0.5px solid #e8eaf0' }}>
                    <div style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><ComboInput value={form['Digit'] || ''} onChange={v => setField('Digit', v)} options={getOpts('Digit')} placeholder="-" /></div>
                    <div style={{ padding: '4px 6px' }}><input value={form['Due'] || ''} onChange={e => setField('Due', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
                  </div>
                  {(() => { const opts = getOpts('Notice'); return <div key="notice" style={{ padding: '4px 6px' }}><ComboInput value={form['Notice'] || ''} onChange={v => setField('Notice', v)} options={opts} /></div>; })()}
                </div>
              </div>

              {/* Row 6: Contact + Email */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Contact')}
                {cell('Contact')}
                {lbl('Email')}
                <div style={{ padding: '4px 6px' }}><input value={form['Email'] || ''} onChange={e => setField('Email', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
              </div>

              {/* Row 7: Sub Acc + Supplier Ref. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Sub Acc')}
                {cell('Sub Acc')}
                {lbl('Supplier Ref.')}
                <div style={{ padding: '4px 6px' }}><input value={form['Supplier Ref.'] || ''} onChange={e => setField('Supplier Ref.', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', height: '28px' }} /></div>
              </div>

              {/* Row 8: Address */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 5fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Address', { alignItems: 'flex-start', paddingTop: '8px' })}
                <div style={{ padding: '4px 6px' }}><textarea rows={3} value={form['Address'] || ''} onChange={e => setField('Address', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5', height: 'auto' }} /></div>
              </div>

              {/* Row 9: Rule Description + Notice Description */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden' }}>
                {lbl('Rule Description', { alignItems: 'flex-start', paddingTop: '8px' })}
                <div style={{ padding: '4px 6px', borderRight: '0.5px solid #e8eaf0' }}><textarea rows={3} value={form['RuleDescrip'] || ''} onChange={e => setField('RuleDescrip', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5', height: 'auto' }} /></div>
                {lbl('Notice Description', { alignItems: 'flex-start', paddingTop: '8px' })}
                <div style={{ padding: '4px 6px' }}><textarea rows={3} value={form['NoticeDescrip'] || ''} onChange={e => setField('NoticeDescrip', e.target.value)} style={{ ...baseInput, background: 'transparent', border: 'none', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5', height: 'auto' }} /></div>
              </div>
            </>
          );
        })()}
      </div>
      <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
        {isEdit && editTarget?.updated_by ? (
          <span style={{ fontSize: '11px', color: '#bbb' }}>Updated by <strong style={{ color: '#888' }}>{editTarget.updated_by}</strong>{editTarget.updated_at ? ` · ${new Date(editTarget.updated_at).toLocaleString('th-TH')}` : ''}</span>
        ) : <span />}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleBack} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>← Back</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : '💾 Save'}</button>
        </div>
      </div>
    </>
  );

  const renderSearchView = () => (
    <>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🏭</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Select Supplier</div>
          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>
            {filtered.length} รายการ{query ? ` · ค้นหา "${query}"` : ''}{bu ? ` · BU: ${bu.toUpperCase()}` : ''}
          </div>
        </div>
        {canEdit && (
          <button onClick={handleOpenNew} style={{ height: '32px', padding: '0 14px', borderRadius: '8px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add supplier
          </button>
        )}
        <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      </div>
      <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey}
            placeholder="ค้นหา Code, Supplier Name, Supplier No., Tax ID..."
            style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
            onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
          {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}
            style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
        </div>
        <div style={{ marginTop: '7px', fontSize: '11px', color: '#bbb', display: 'flex', gap: '12px' }}>
          {[['↑↓','Navigate'],['Enter','Select'],['Esc','Close']].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: '#f0f1f3', border: '0.5px solid #dde', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#ccc' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏭</div>
            <div style={{ fontSize: '13px', color: '#aaa' }}>ไม่พบ Supplier{query ? ` "${query}"` : ''}</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed', minWidth: '800px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {COLS.map(([field, label, w]) => (
                  <th key={field} onClick={() => handleSort(field)}
                    style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined, cursor: 'pointer', userSelect: 'none' }}>
                    {label}{sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
                  </th>
                ))}
                <th style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: '100px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const isAct = i === active;
                return (
                  <tr key={item.id || i} data-row={i}
                    onClick={() => onSelect(item)}
                    onMouseEnter={() => setActive(i)}
                    style={{ background: isAct ? '#eef3fb' : 'white', cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6' }}>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{ background: isAct ? '#1a3a5c' : '#f0f3f8', color: isAct ? 'white' : '#1a3a5c', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>{item['Code'] || '-'}</span>
                    </td>
                    <td style={{ padding: '9px 12px', color: '#778', fontSize: '11px' }}>
                      <span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: '500' }}>{String(item['Code'] ?? '').split('-')[0] || '-'}</span>
                    </td>
                    <td style={{ padding: '9px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: '500', color: '#1a3a5c', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item['Supplier Name'] || '-'}</div>
                    </td>
                    <td style={{ padding: '9px 12px', color: '#555', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{item['Supplier Number'] || '-'}</td>
                    <td style={{ padding: '9px 12px', color: '#555', fontSize: '11px', whiteSpace: 'nowrap' }}>{item['Supplier Site'] || '-'}</td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      {item['Tax-Type'] ? (
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '600', background: '#E6F1FB', color: '#0C447C' }}>{item['Tax-Type']}</span>
                      ) : <span style={{ color: '#ddd' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      {item['Notice'] ? (
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#FFF3CD', color: '#856404' }}>{item['Notice']}</span>
                      ) : <span style={{ color: '#ddd' }}>—</span>}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button title="View" onClick={e => { e.stopPropagation(); handleOpenEdit(item, true); }}
                          style={{ width: '28px', height: '26px', borderRadius: '6px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        {canEdit && (
                          <button title="Edit" onClick={e => { e.stopPropagation(); handleOpenEdit(item); }}
                            style={{ width: '28px', height: '26px', borderRadius: '6px', border: '0.5px solid #ddd', background: '#f5f5f5', color: '#444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                        {canDelete && (
                          <button title="Delete" onClick={e => { e.stopPropagation(); handleDeleteSupplier(item); }}
                            style={{ width: '28px', height: '26px', borderRadius: '6px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
        <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {buFiltered.length} รายการ</span>
        <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250, backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && view === 'search') onClose(); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: '96vw', maxWidth: '1100px', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>
        {view === 'search' ? renderSearchView() : renderFormView()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PeriodPicker
// ─────────────────────────────────────────────────────────────────────────────
const MO_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const DW_TH = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const fmtDt = (dt) => {
  const d = String(dt.getDate()).padStart(2,'0');
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
};
const fmtMo = (y, m) => {
  const from = new Date(y, m, 1);
  const to   = new Date(y, m+1, 0);
  const pd = (n) => String(n).padStart(2,'0');
  return `${pd(from.getDate())}/${pd(from.getMonth()+1)}/${from.getFullYear()} - ${pd(to.getDate())}/${pd(to.getMonth()+1)}/${to.getFullYear()}`;
};

function PeriodPicker({ value, onChange }) {
  const [open, setOpen]     = useState(false);
  const [vy, setVy]         = useState(new Date().getFullYear());
  const [vm, setVm]         = useState(new Date().getMonth());
  const [d1, setD1]         = useState(null);
  const [d2, setD2]         = useState(null);
  const [hov, setHov]       = useState(null);
  const [moMode, setMoMode] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const nav = (dir) => {
    if (moMode) { setVy(y => y + dir); }
    else {
      let nm = vm + dir, ny = vy;
      if (nm < 0) { nm = 11; ny--; }
      if (nm > 11) { nm = 0; ny++; }
      setVm(nm); setVy(ny);
    }
  };

  const pickDay = (d) => {
    const dt = new Date(vy, vm, d);
    if (!d1 || d1.mo || (d1 && d2)) { setD1({ dt, mo: false }); setD2(null); setHov(null); }
    else { if (dt < d1.dt) { setD2(d1); setD1({ dt, mo: false }); } else setD2({ dt, mo: false }); setHov(null); }
  };

  const pickMo = (m) => { setD1({ mo: true, y: vy, m }); setD2(null); setHov(null); };

  const fromLabel = () => {
    if (!d1) return 'From';
    if (d1.mo) return fmtMo(d1.y, d1.m);
    return fmtDt(d1.dt);
  };
  const toLabel = () => {
    if (!d2 || d1?.mo) return null;
    const [a, b] = d1.dt <= d2.dt ? [d1.dt, d2.dt] : [d2.dt, d1.dt];
    return fmtDt(b);
  };

  const applyVal = () => {
    if (!d1) return;
    const f = fromLabel(), t = toLabel();
    onChange(t ? `${f} - ${t}` : f);
    setOpen(false);
  };

  const clearVal = () => { setD1(null); setD2(null); setHov(null); onChange(''); };

  const today = new Date();
  const first = new Date(vy, vm, 1).getDay();
  const dim   = new Date(vy, vm + 1, 0).getDate();
  const dipm  = new Date(vy, vm, 0).getDate();

  const getDayCls = (d) => {
    const dt = new Date(vy, vm, d);
    let cls = '';
    if (dt.toDateString() === today.toDateString()) cls += ' cal-today';
    if (d1 && !d1.mo) {
      const a = d1.dt, b = d2 ? d2.dt : hov;
      const lo = b ? (a <= b ? a : b) : a, hi = b ? (a <= b ? b : a) : null;
      const same = hi && lo.toDateString() === hi.toDateString();
      if (lo && dt.toDateString() === lo.toDateString()) cls += same || !hi ? ' cal-single' : ' cal-start';
      else if (hi && dt.toDateString() === hi.toDateString()) cls += ' cal-end';
      else if (hi && dt > lo && dt < hi) cls += ' cal-range';
    }
    return cls;
  };

  const dayStyle = (cls) => {
    const base = { width:'32px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', cursor:'pointer', borderRadius:'5px', userSelect:'none', flexShrink:0 };
    if (cls.includes('cal-single')) return { ...base, background:'#1a3a5c', color:'white' };
    if (cls.includes('cal-start'))  return { ...base, background:'#1a3a5c', color:'white', borderRadius:'5px 0 0 5px' };
    if (cls.includes('cal-end'))    return { ...base, background:'#1a3a5c', color:'white', borderRadius:'0 5px 5px 0' };
    if (cls.includes('cal-range'))  return { ...base, background:'#E6F1FB', color:'#0C447C', borderRadius:'0' };
    if (cls.includes('cal-today'))  return { ...base, fontWeight:'500', color:'#1a3a5c' };
    return base;
  };

  const pillStyle = (empty) => ({ flex:1, height:'26px', display:'flex', alignItems:'center', padding:'0 8px', borderRadius:'5px', border:'0.5px solid #dde', fontSize:'11px', background: empty ? '#fafbfc' : 'white', color: empty ? '#bbb' : '#1a3a5c', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' });

  return (
    <div ref={ref} style={{ position:'relative', display:'flex', flexDirection:'column', gap:'3px', flexShrink:0 }}>
      <label style={{ fontSize:'11px', color:'#888' }}>Period</label>
      <div style={{ display:'flex', alignItems:'center' }}>
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          style={{ height:'30px', padding:'0 8px', fontSize:'12px', borderRadius:'6px 0 0 6px', outline:'none', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', width:'190px', boxSizing:'border-box' }} />
        <button onClick={() => setOpen(o => !o)} title="เลือกช่วงเวลา"
          style={{ height:'30px', width:'28px', borderRadius:'0 6px 6px 0', border:'0.5px solid #ddd', borderLeft:'none', background:'#f5f7fa', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#888', flexShrink:0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </button>
      </div>

      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:9999, background:'white', borderRadius:'10px', border:'0.5px solid #dde', boxShadow:'0 8px 24px rgba(26,58,92,0.12)', width:'270px', overflow:'visible' }}>
          <div style={{ padding:'8px 12px 4px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <button onClick={() => nav(-1)} style={{ width:'24px', height:'24px', borderRadius:'50%', border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#888' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span onClick={() => setMoMode(m => !m)}
              style={{ fontSize:'12px', fontWeight:'500', color: moMode ? '#0C447C' : '#1a3a5c', cursor:'pointer', padding:'2px 8px', borderRadius:'5px', background: moMode ? '#E6F1FB' : 'transparent' }}>
              {moMode ? String(vy) : `${MO_TH[vm]} ${vy}`}
            </span>
            <button onClick={() => nav(1)} style={{ width:'24px', height:'24px', borderRadius:'50%', border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#888' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {moMode ? (
            <div style={{ padding:'6px 12px 10px', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'5px' }}>
              {MO_TH.map((m, i) => {
                const isSel = d1?.mo && d1.y === vy && d1.m === i;
                return <div key={i} onClick={() => pickMo(i)}
                  style={{ padding:'5px 4px', borderRadius:'5px', cursor:'pointer', fontSize:'11px', textAlign:'center', background: isSel ? '#1a3a5c' : 'transparent', color: isSel ? 'white' : '#1a3a5c' }}>{m}</div>;
              })}
            </div>
          ) : (
            <div style={{ padding:'0 10px 6px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 32px)', gap:'1px', justifyContent:'center' }}>
                {DW_TH.map(d => <div key={d} style={{ width:'32px', height:'20px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', color:'#bbb' }}>{d}</div>)}
                {Array.from({length: first}, (_, i) => <div key={'p'+i} style={{ width:'32px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', color:'#ddd' }}>{dipm - first + 1 + i}</div>)}
                {Array.from({length: dim}, (_, i) => {
                  const d = i + 1, cls = getDayCls(d);
                  return <div key={d} onClick={() => pickDay(d)} onMouseEnter={() => { if (d1 && !d1.mo && !d2) setHov(new Date(vy, vm, d)); }}
                    style={{ ...dayStyle(cls) }}>{d}</div>;
                })}
              </div>
            </div>
          )}

          <div style={{ padding:'6px 12px', borderTop:'0.5px solid #f0f2f5', display:'flex', alignItems:'center', gap:'6px' }}>
            <div style={pillStyle(!d1)}>{fromLabel()}</div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
            <div style={pillStyle(!toLabel())}>{toLabel() || 'To'}</div>
          </div>

          <div style={{ padding:'6px 12px 10px', display:'flex', justifyContent:'flex-end', gap:'6px' }}>
            <button onClick={clearVal} style={{ padding:'3px 10px', borderRadius:'5px', border:'0.5px solid #dde', background:'white', color:'#888', fontSize:'11px', cursor:'pointer' }}>Clear</button>
            <button onClick={applyVal} style={{ padding:'3px 10px', borderRadius:'5px', border:'none', background:'#1a3a5c', color:'white', fontSize:'11px', cursor:'pointer', fontWeight:'500' }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContractPopup — Search / Add / Edit / Import contract_list
// ─────────────────────────────────────────────────────────────────────────────
const CONTRACT_FIELDS = [
  ['vendor_code',   'Vendor Code *',      2, 'text'],
  ['serial_code',   'Serial Code *',      2, 'text'],
  ['cdes1',         'Label 1',            1, 'text'],
  ['bdes1',         'Value 1',            1, 'text'],
  ['cdes2',         'Label 2',            1, 'text'],
  ['bdes2',         'Value 2',            1, 'text'],
  ['cdes3',         'Label 3',            1, 'text'],
  ['bdes3',         'Value 3',            1, 'text'],
  ['contract_run',  'Contract Run *',     1, 'select'],
  ['auto_ib',       'Auto IB',            1, 'text'],
];
const CONTRACT_RUN_OPTS = ['SC','D1','D2','D3','D4'];

function ContractPopup({ show, onClose, onSelect, vendorCode = '', bu = '', fetchCollection, userName = '' }) {
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const canEdit = isOwner || isAdmin || isEditor;

  const [view, setView]           = useState('search');
  const [query, setQuery]         = useState('');
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setFormState]      = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving]       = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  const emptyForm = () => {
    const f = {};
    CONTRACT_FIELDS.forEach(([k]) => { f[k] = ''; });
    const vc = String(vendorCode || '').trim();
    const buPrefix = String(bu || '').trim();
    f['vendor_code'] = (vc && buPrefix && !vc.toUpperCase().startsWith(buPrefix.toUpperCase() + '-'))
      ? `${buPrefix}-${vc}`
      : vc;
    return f;
  };

  useEffect(() => {
    if (show) { setQuery(''); setView('search'); setEditTarget(null); setFormState({}); setFormError(''); loadItems(); }
  }, [show, vendorCode]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ order: 'vendor_code.asc,serial_code.asc', limit: '500' });
      if (vendorCode) params.set('ilike_vendor_code', vendorCode);
      else if (bu) params.set('eq_bu', bu);
      const data = await apiFetch(`/contract_list?${params.toString()}`);
      setItems(data || []);
    } catch (e) { console.error('loadItems:', e); }
    setLoading(false);
  };

  const filtered = query.trim()
    ? items.filter(i =>
        String(i.vendor_code || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.serial_code || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.bdes1 || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.bdes2 || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.bdes3 || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.cdes3 || '').toLowerCase().includes(query.toLowerCase()) ||
        String(i.auto_ib || '').toLowerCase().includes(query.toLowerCase())
      )
    : items;

  const setField = (k, v) => { setFormState(f => ({ ...f, [k]: v })); setFormError(''); };

  const validate = (f) => {
    if (!f.vendor_code?.trim()) return 'กรุณากรอก Vendor Code';
    if (!f.serial_code?.trim()) return 'กรุณากรอก Serial Code';
    if (!f.contract_run?.trim()) return 'กรุณาเลือก Contract Run';
    return '';
  };

  const handleSave = async () => {
    if (!canEdit) return;
    const err = validate(form); if (err) { setFormError(err); return; }
    setSaving(true);
    try {
      const { bu: _bu, ...formWithoutBu } = form;
      const payload = { ...formWithoutBu, updated_by: userName, updated_at: new Date().toISOString() };
      if (view === 'edit' && editTarget?.id) {
        await apiFetch(`/contract_list/${editTarget.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/contract_list`, { method: 'POST', body: JSON.stringify(payload) });
      }
      await loadItems();
      setView('search');
    } catch (e) { setFormError('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    await apiFetch(`/contract_list/${id}`, { method: 'DELETE' });
    await loadItems();
  };

  const handleDownloadTemplate = () => {
    const cols = ['vendor_code','serial_code','cdes1','bdes1','cdes2','bdes2','cdes3','bdes3','contract_run','auto_ib'];
    const ws = XLSX.utils.aoa_to_sheet([cols]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'contract_template');
    XLSX.writeFile(wb, 'contract_template.xlsx');
  };

  const handleImport = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setImporting(true); setImportMsg('');
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      let rawRows = [];

      if (!isExcel) {
        setImportMsg('❌ รองรับเฉพาะไฟล์ .xlsx / .xls เท่านั้น — กรุณาบันทึกไฟล์เป็น Excel ก่อน import (ป้องกันปัญหาภาษาไทยเพี้ยน)');
        setImporting(false);
        e.target.value = '';
        return;
      }

      // ── Excel ── (Excel เก็บ string เป็น Unicode อยู่แล้ว ไม่มีปัญหา encoding ภาษาไทย)
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      rawRows   = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

      const now  = new Date().toISOString();
      const rows = rawRows
        .map(obj => {
          const clean = {};
          ['vendor_code','serial_code','cdes1','bdes1','cdes2','bdes2','cdes3','bdes3','contract_run','auto_ib'].forEach(k => {
            clean[k] = String(obj[k] ?? '').trim();
          });
          clean.updated_by = userName;
          clean.updated_at = now;
          return clean;
        })
        .filter(r => r.vendor_code && r.serial_code);

      if (!rows.length) { setImportMsg('ไม่พบข้อมูล'); setImporting(false); return; }

      // deduplicate — เก็บแถวสุดท้ายในกรณี key ซ้ำในไฟล์
      const seen = new Map();
      rows.forEach(r => { seen.set(`${r.vendor_code}||${r.serial_code}`, r); });
      const unique = Array.from(seen.values());

      for (let i = 0; i < unique.length; i += 100) {
        await apiFetch(`/contract_list/upsert?onConflict=vendor_code,serial_code`, {
          method: 'POST',
          body: JSON.stringify(unique.slice(i, i + 100)),
        });
      }
      const dupCount = rows.length - unique.length;
      setImportMsg(`✅ Import สำเร็จ ${unique.length} รายการ${dupCount > 0 ? ` (ข้ามซ้ำ ${dupCount} รายการ)` : ''}`);
      await loadItems();
    } catch (e) { setImportMsg('❌ ' + e.message); }
    setImporting(false);
    e.target.value = '';
  };

  const renderForm = () => {
    const isEdit = view === 'edit';
    const inp = { height:'30px', padding:'0 8px', fontSize:'12px', borderRadius:'6px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', boxSizing:'border-box', width:'100%' };
    return (
      <>
        <div style={{ padding:'12px 18px', display:'flex', alignItems:'center', gap:'8px', borderBottom:'0.5px solid #f0f2f5', flexShrink:0 }}>
          <button onClick={() => setView('search')} style={{ padding:'4px 10px', borderRadius:'6px', border:'0.5px solid #dde', background:'#f5f7fa', color:'#555', fontSize:'12px', cursor:'pointer' }}>← Back</button>
          <div style={{ width:'28px', height:'28px', borderRadius:'7px', background: isEdit ? '#1a3a5c' : '#27500A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px' }}>{isEdit ? '✏️' : '➕'}</div>
          <div style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>{isEdit ? `Edit — ${editTarget?.serial_code || ''}` : 'New contract'}</div>
          <div style={{ fontSize:'11px', color:'#aaa', marginTop:'1px' }}>{form['vendor_code'] || vendorCode}</div>
          {isEdit && <span style={{ marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:'4px', background:'#FCEBEB', color:'#791F1F', borderRadius:'5px', padding:'3px 8px', fontSize:'11px' }}>🔒 Editor+ only</span>}
        </div>
        {formError && <div style={{ padding:'6px 18px', background:'#FCEBEB', color:'#791F1F', fontSize:'11px', flexShrink:0 }}>⚠️ {formError}</div>}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:'14px' }}>
          {/* Vendor Code + Serial Code */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color: formError && !form['vendor_code']?.trim() ? '#e74c3c' : '#888', fontWeight:'500' }}>Vendor Code <span style={{ color:'#e24b4a' }}>*</span></label>
              <input value={form['vendor_code']||''} onChange={e => setField('vendor_code', e.target.value)} readOnly={isEdit}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border: formError && !form['vendor_code']?.trim() ? '1px solid #e74c3c' : '0.5px solid #ddd', background: isEdit ? '#f5f5f5' : 'white', color: isEdit ? '#999' : '#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color: formError && !form['serial_code']?.trim() ? '#e74c3c' : '#888', fontWeight:'500' }}>Serial Code <span style={{ color:'#e24b4a' }}>*</span></label>
              <input value={form['serial_code']||''} onChange={e => setField('serial_code', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border: formError && !form['serial_code']?.trim() ? '1px solid #e74c3c' : '0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
          </div>

          {/* CDes1 + BDes1 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>CDes1</label>
              <input value={form['cdes1']||''} onChange={e => setField('cdes1', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>BDes1</label>
              <input value={form['bdes1']||''} onChange={e => setField('bdes1', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
          </div>

          {/* CDes2 + BDes2 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>CDes2</label>
              <input value={form['cdes2']||''} onChange={e => setField('cdes2', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>BDes2</label>
              <input value={form['bdes2']||''} onChange={e => setField('bdes2', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
          </div>

          {/* CDes3 + BDes3 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>CDes3</label>
              <input value={form['cdes3']||''} onChange={e => setField('cdes3', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>BDes3</label>
              <input value={form['bdes3']||''} onChange={e => setField('bdes3', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
          </div>

          {/* Contract Run + Auto IB */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color: formError && !form['contract_run']?.trim() ? '#e74c3c' : '#888', fontWeight:'500' }}>Contract Run <span style={{ color:'#e24b4a' }}>*</span></label>
              <select value={form['contract_run']||''} onChange={e => setField('contract_run', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border: formError && !form['contract_run']?.trim() ? '1px solid #e74c3c' : '0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', cursor:'pointer' }}>
                <option value="">— เลือก —</option>
                {CONTRACT_RUN_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <label style={{ fontSize:'11px', color:'#888', fontWeight:'500' }}>Auto IB</label>
              <input value={form['auto_ib']||''} onChange={e => setField('auto_ib', e.target.value)}
                style={{ height:'34px', padding:'0 10px', fontSize:'13px', borderRadius:'7px', border:'0.5px solid #ddd', background:'white', color:'#1a3a5c', outline:'none', width:'100%', boxSizing:'border-box' }} />
            </div>
          </div>
        </div>
        <div style={{ padding:'10px 18px', borderTop:'0.5px solid #f0f2f5', display:'flex', justifyContent:'flex-end', gap:'8px', flexShrink:0, background:'#fafbfc' }}>
          <button onClick={() => setView('search')} style={{ padding:'6px 14px', borderRadius:'6px', border:'0.5px solid #dde', background:'white', color:'#666', fontSize:'12px', cursor:'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:'6px 16px', borderRadius:'6px', border:'none', background: saving ? '#aaa' : '#1a3a5c', color:'white', fontSize:'12px', fontWeight:'500', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : '💾 Save'}</button>
        </div>
      </>
    );
  };

  const renderSearch = () => (
    <>
      <div style={{ padding:'12px 18px', display:'flex', alignItems:'center', gap:'8px', borderBottom:'0.5px solid #f0f2f5', flexShrink:0 }}>
        <div style={{ width:'28px', height:'28px', borderRadius:'7px', background:'#1a3a5c', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>Contract / Serial Code</div>
          <div style={{ fontSize:'11px', color:'#aaa' }}>{filtered.length} รายการ{vendorCode ? ` · ${vendorCode}` : bu ? ` · BU: ${bu}` : ''}</div>
        </div>
        {canEdit && (
          <>
            <button onClick={handleDownloadTemplate} style={{ height:'28px', padding:'0 10px', borderRadius:'6px', border:'0.5px solid #dde', background:'white', color:'#555', fontSize:'11px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px' }}>
              ⬇ Template
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={importing} title="รองรับเฉพาะไฟล์ .xlsx / .xls" style={{ height:'28px', padding:'0 10px', borderRadius:'6px', border:'0.5px solid #5DCAA5', background:'#E1F5EE', color:'#085041', fontSize:'11px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px' }}>
              📂 Import (.xlsx)
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleImport} />
            <button onClick={() => { setEditTarget(null); setFormState(emptyForm()); setFormError(''); setView('new'); }} style={{ height:'28px', padding:'0 12px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', fontSize:'11px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add
            </button>
          </>
        )}
        <button onClick={onClose} style={{ width:'26px', height:'26px', borderRadius:'50%', background:'#f5f5f5', border:'none', cursor:'pointer', color:'#888', fontSize:'15px', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
      </div>
      {importMsg && <div style={{ padding:'6px 18px', background: importMsg.startsWith('✅') ? '#EAF3DE' : '#FCEBEB', color: importMsg.startsWith('✅') ? '#27500A' : '#791F1F', fontSize:'11px', flexShrink:0 }}>{importMsg}</div>}
      <div style={{ padding:'8px 18px', borderBottom:'0.5px solid #f0f2f5', flexShrink:0 }}>
        <div style={{ position:'relative' }}>
          <svg style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#aab', pointerEvents:'none' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหา Vendor Code, Serial Code, ค่า..."
            style={{ width:'100%', padding:'7px 32px', fontSize:'12px', border:'1px solid #e2e6ed', borderRadius:'7px', outline:'none', boxSizing:'border-box', color:'#1a3a5c' }}
            onFocus={e => e.target.style.borderColor='#1a3a5c'} onBlur={e => e.target.style.borderColor='#e2e6ed'} />
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', overflowX:'auto' }}>
        {loading ? (
          <div style={{ padding:'40px', textAlign:'center', color:'#aaa', fontSize:'12px' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:'40px', textAlign:'center', color:'#aaa', fontSize:'12px' }}>ไม่พบข้อมูล{query ? ` "${query}"` : ''}</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px', tableLayout:'fixed' }}>
            <colgroup>
              <col style={{ width:'8%' }}/><col style={{ width:'19%' }}/><col style={{ width:'8%' }}/><col style={{ width:'19%' }}/><col style={{ width:'8%' }}/><col style={{ width:'19%' }}/><col style={{ width:'11%' }}/>{canEdit && <col style={{ width:'8%' }}/>}
            </colgroup>
            <thead style={{ position:'sticky', top:0, zIndex:1 }}>
              <tr>
                {['CDes1','BDes1','CDes2','BDes2','CDes3','BDes3','Auto IB',...(canEdit?['Action']:[])].map(h => (
                  <th key={h} style={{ background:'#1a3a5c', color:'rgba(255,255,255,0.8)', padding:'8px 10px', textAlign: h==='Action'||h==='Auto IB'?'center':'left', fontSize:'10px', fontWeight:'600', letterSpacing:'0.04em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={item.id||i} onClick={() => onSelect && onSelect(item)}
                  style={{ borderBottom:'0.5px solid #f3f4f6', background: i%2===0?'white':'#fafbfc', cursor: onSelect ? 'pointer' : 'default' }}>
                  <td style={{ padding:'7px 10px', fontSize:'11px', color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.cdes1||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.bdes1||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.cdes2||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.bdes2||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.cdes3||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.bdes3||'—'}</td>
                  <td style={{ padding:'7px 10px', fontSize:'11px', textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.auto_ib||'—'}</td>
                  {canEdit && (
                    <td style={{ padding:'6px 10px', textAlign:'center' }}>
                      <div style={{ display:'inline-flex', gap:'4px' }}>
                        <button onClick={(e) => { e.stopPropagation(); const f = emptyForm(); CONTRACT_FIELDS.forEach(([k]) => { f[k] = item[k] || ''; }); setEditTarget(item); setFormState(f); setFormError(''); setView('edit'); }}
                          style={{ width:'24px', height:'24px', borderRadius:'5px', border:'0.5px solid #ddd', background:'#f5f5f5', color:'#555', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                          style={{ width:'24px', height:'24px', borderRadius:'5px', border:'0.5px solid #f7c1c1', background:'#FCEBEB', color:'#791F1F', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ padding:'8px 18px', borderTop:'0.5px solid #f0f2f5', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0, background:'#fafbfc' }}>
        <span style={{ fontSize:'11px', color:'#bbb' }}>{filtered.length} / {items.length} รายการ</span>
        <button onClick={onClose} style={{ padding:'5px 14px', borderRadius:'6px', border:'0.5px solid #dde', background:'white', color:'#666', fontSize:'11px', cursor:'pointer' }}>Close</button>
      </div>
    </>
  );

  if (!show) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,30,50,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1400, backdropFilter:'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && view === 'search') onClose(); }}>
      <div style={{ background:'white', borderRadius:'12px', width:'96vw', maxWidth:'1180px', height:'85vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 20px 60px rgba(26,58,92,0.22)' }}>
        {view === 'search' ? renderSearch() : renderForm()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RealVendorPopup — เลือก Real Vendor จาก sm_code_list + กรอก Real Invoice No.
// ─────────────────────────────────────────────────────────────────────────────
// SmComboBox — custom dropdown มี maxHeight + scroll (ใช้ใน RealVendorPopup smGrid)
function SmComboBox({ value, onChange, options = [], center = false }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value || '');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const ref = useRef(null);
  useEffect(() => { setInput(value || ''); }, [value]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const handleFocus = (e) => {
    const r = e.target.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: r.width });
    setInput('');  // เคลียร์ตอน focus เพื่อโชว์ list เต็มเสมอ — ไม่ต้องลบ text เองก่อน
    setOpen(true);
  };
  const filtered = [...new Set(options.filter(o => String(o).toLowerCase().includes(input.toLowerCase())))];
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <input
        value={input}
        onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={handleFocus}
        placeholder="เลือก"
        style={{ height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: center ? 'center' : 'left' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((o, i) => (
            <div key={i} onMouseDown={e => { e.preventDefault(); setInput(String(o)); onChange(String(o)); setOpen(false); }}
              style={{ padding: '6px 10px', fontSize: '12px', color: '#1a3a5c', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: String(o) === value ? '#eef3fb' : 'white' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eef3fb'; }}
              onMouseLeave={e => { e.currentTarget.style.background = String(o) === value ? '#eef3fb' : 'white'; }}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function RealVendorPopup({ show, onClose, onSelect, smCodeItems = [], vendorTaxId = '', fetchCollection, branchItems = [], userName = '', categoryItems = [] }) {
  const [query, setQuery]                 = useState('');
  const [active, setActive]               = useState(-1);
  const [realInvoiceNo, setRealInvoiceNo] = useState('');
  const [manualVendor, setManualVendor] = useState({ realInvoiceNo: '', taxInvoiceDate: '', companyName: '', taxId: '', branch: '' });
  const handleManualSubmit = () => {
    if (!manualVendor.companyName?.trim() && !manualVendor.taxId?.trim() && !manualVendor.branch?.trim()) return;
    onSelect({
      vendor: {
        'SM-Code': '',
        'Company Name': manualVendor.companyName || '',
        'Tax ID': manualVendor.taxId || '',
        'Branch': manualVendor.branch || '',
      },
      realInvoiceNo: manualVendor.realInvoiceNo || '',
      taxInvoiceDate: manualVendor.taxInvoiceDate || '',
    });
  };
  const [view, setView]                   = useState('search');
  const [editTarget, setEditTarget]       = useState(null);
  const [smForm, setSmForm]               = useState({});
  const [smFormError, setSmFormError]     = useState('');
  const [saving, setSaving]               = useState(false);
  const [favUpdating, setFavUpdating]     = useState(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const isFav = (item) => {
    const favs = Array.isArray(item.favorite_taxids) ? item.favorite_taxids : [];
    return !!vendorTaxId && favs.includes(vendorTaxId);
  };

  const toggleFav = async (e, item) => {
    e.stopPropagation();
    if (!vendorTaxId) return;
    setFavUpdating(item['SM-Code']);
    try {
      const favs = Array.isArray(item.favorite_taxids) ? [...item.favorite_taxids] : [];
      const already = favs.includes(vendorTaxId);
      const newFavs = already ? favs.filter(t => t !== vendorTaxId) : [...favs, vendorTaxId];
      const { error } = await db.from('sm_code_list').update({ favorite_taxids: newFavs }).eq('id', item.id);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('SmCodeList', true);
    } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
    setFavUpdating(null);
  };

  useEffect(() => {
    if (show) {
      setQuery(''); setActive(-1); setRealInvoiceNo('');
      setView('search'); setEditTarget(null); setSmForm({}); setSmFormError('');
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') { if (view === 'search') onClose(); else { setView('search'); setEditTarget(null); setSmForm({}); setSmFormError(''); } } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose, view]);

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // ── SM-Code Form helpers ──────────────────────────────────────────────────
  const smEmptyForm = () => ({
    'SM-Code': '', 'Ofin Code': '', 'Supplier Code': '', '_type': '', '_sub_type': '',
    'Company Name': '', 'Tax ID': '', 'Branch': '', 'Short Name': '',
    'CPC_Dr': '', 'Account_Dr': '', 'Sub Acc_Dr': '', 'CPC_Cr': '', 'Account_Dr2': '', 'Sub Acc_Cr': '',
    'Expense Type': '', 'Special Rule1': '', 'Special Rule2': '', 'Simple Rule3': '', 'Special Rule4': '', 'Special Rule5': '',
    'First Part': '', 'Mid Part': '', 'Last Part': '', 'Digit': '', 'Remark': '', 'BlankCell': '',
    '_ofinSimpleName': '', 'Short Branch': '', 'BU': '', '_buCompanySimple': '', '_taxIdBu': '',
    '_comPct': '', '_specPct': '', '_buBranch': '', '_branchCode': '', '_groupP': '', '_branchStatus': '',
  });

  const getSmOptions = (field) => [...new Set((smCodeItems || []).map(i => String(i[field] ?? '').trim()).filter(Boolean))].sort();

  const handleSmSupplierCodeChange = (val) => {
    // ดึงข้อมูลจาก categoryItems (vendor_category) เหมือน VendorMaster
    const found = (categoryItems || []).find(i => String(i['Code'] || '').trim() === val.trim());
    if (found) {
      setSmForm(prev => ({
        ...prev,
        'Supplier Code': val,
        'Company Name':  found['Supplier Name'] || prev['Company Name'],
        'Tax ID':        found['TAX ID']        || prev['Tax ID'],
        'Branch':        found['No.']           || prev['Branch'],
        '_type':         found['TYPE']          || '',
        '_sub_type':     found['SUB TYPE']      || '',
      }));
    } else {
      setSmForm(prev => ({ ...prev, 'Supplier Code': val }));
    }
  };

  // ── พิมพ์ระหว่างกรอก: เก็บค่าดิบตรงๆ ไม่ pad (ป้องกัน padding ระหว่างพิมพ์ก่อนพิมพ์เสร็จ) ──
  const handleSmOfinCodeChange = (val) => {
    setSmForm(prev => ({ ...prev, 'Ofin Code': val }));
  };

  // ── lookup + normalize เป็น 6 หลัก: เรียกตอน blur/Tab หรือตอนโหลด record เก่าเข้าฟอร์ม ──
  const lookupOfinCode = (val) => {
    const raw = String(val || '').trim();
    const normalized = /^\d+$/.test(raw) ? raw.padStart(6, '0') : raw;
    const found = branchItems.find(b => String(b['Branch Code'] || '').trim() === normalized);
    setSmForm(prev => ({
      ...prev,
      'Ofin Code':        normalized,
      '_ofinSimpleName':  found ? (found['Simple Brand Code'] || '') : '',
      'Short Branch':     found ? (found['BU-Branch'] || '') : '',
      'BU':               found ? (found['bu'] || '') : '',
      '_buCompanySimple': found ? (found['Simple Company'] || '') : '',
      '_taxIdBu':         found ? (found['BU-TaxID'] || '') : '',
      '_comPct':          found ? (found['%'] || '') : '',
      '_specPct':         found ? (found['DB(%)'] || '') : '',
      '_buBranch':        found ? (found['BU-Branch'] || '') : '',
      '_branchCode':      found ? (found['Branch Code'] || '') : '',
      '_groupP':          found ? (found['Group-P'] || '') : '',
      '_branchStatus':    found ? (found['status'] || '') : '',
    }));
  };
  const handleSmOfinCodeBlur = (val) => { if (val?.trim()) lookupOfinCode(val); };

  const handleSmATMatchChange = (val) => {
    const found = (smCodeItems || []).find(i => String(i['Short Name'] || '').trim() === val.trim());
    const isInput = val.trim().toUpperCase() === 'INPUT' || val.trim().toUpperCase() === 'IST36';
    const isT36   = val.trim().toUpperCase() === 'T36';
    const comPct  = String(smForm['_comPct'] || '').trim();
    const isNotFull = comPct !== '' && comPct !== '100';
    const subDr   = found ? (found['Sub Acc_Dr'] || '') : '';
    const isNot999 = subDr !== '' && subDr !== '999999';
    setSmForm(prev => ({
      ...prev,
      'Short Name':  val,
      'Expense Type': isNotFull
        ? (getSmOptions('Expense Type').find(o => String(o).startsWith('63050000')) || '')
        : (isInput || isT36)
          ? (getSmOptions('Expense Type').find(o => String(o).startsWith('63047000')) || '')
          : isNot999
            ? (getSmOptions('Expense Type').find(o => String(o).startsWith('61200201')) || '')
            : prev['Expense Type'],
      'CPC_Dr':      found ? (found['CPC_Dr'] || '')      : prev['CPC_Dr'],
      'Account_Dr':  found ? (found['Account_Dr'] || '')  : prev['Account_Dr'],
      'Sub Acc_Dr':  found ? (found['Sub Acc_Dr'] || '')  : prev['Sub Acc_Dr'],
      'CPC_Cr':      found ? (found['CPC_Cr'] || '')      : prev['CPC_Cr'],
      'Account_Dr2': found ? (found['Account_Dr2'] || '') : prev['Account_Dr2'],
      'Sub Acc_Cr':  found ? (found['Sub Acc_Cr'] || '')  : prev['Sub Acc_Cr'],
    }));
  };

  const handleSmSave = async () => {
    const f = smForm;
    const missing = [];
    if (!f['SM-Code']?.trim())      missing.push('Simple Code');
    if (!f['Ofin Code']?.trim())    missing.push('OFIN CODE');
    if (!f['Company Name']?.trim()) missing.push('Vendor Name');
    if (!f['Tax ID']?.trim())       missing.push('Tax ID');
    if (!f['Branch']?.trim())       missing.push('Branch No.');
    if (!f['Short Name']?.trim())   missing.push('AT-Match');
    if (!f['CPC_Dr']?.trim())       missing.push('CPC Dr');
    if (!f['Account_Dr']?.trim())   missing.push('Account Dr');
    if (!f['Sub Acc_Dr']?.trim())   missing.push('Sub Acc Dr');
    if (!f['CPC_Cr']?.trim())       missing.push('CPC Cr');
    if (!f['Account_Dr2']?.trim())  missing.push('Account Cr');
    if (!f['Sub Acc_Cr']?.trim())   missing.push('Sub Acc Cr');
    if (missing.length) { setSmFormError('กรุณากรอกข้อมูลให้ครบถ้วนตาม Required Field'); return; }

    if (!editTarget) {
      const dup = (smCodeItems || []).find(i => String(i['SM-Code'] || '').trim().toLowerCase() === f['SM-Code'].trim().toLowerCase());
      if (dup) { setSmFormError(`❌ Simple Code "${f['SM-Code']}" มีอยู่แล้วใน SM-Code List`); return; }
    }

    setSaving(true);
    try {
      // ── กรอง internal/UI-only fields ออก (ไม่ใช่ column จริงใน sm_code_list table) ──
      // ── _type, _sub_type ฯลฯ = ขึ้นต้นด้วย _ (helper fields สำหรับ dropdown ภายใน) ──
      // ── BlankCell = placeholder field เปล่าๆ ไว้จัด layout เฉยๆ ──────────────────
      const EXCLUDE_FIELDS = ['BlankCell'];
      const cleanedF = Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_') && !EXCLUDE_FIELDS.includes(k)));
      // sm_code_list table ใช้ column ชื่อ username/last_update (ไม่ใช่ updated_by/updated_at เหมือน table อื่น)
      const payload = { ...cleanedF, username: userName, last_update: new Date().toISOString() };
      if (editTarget?.id) {
        const { error } = await db.from('sm_code_list').update(payload).eq('id', editTarget.id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from('sm_code_list').insert([payload]).select().single();
        if (error) throw error;
        if (fetchCollection) await fetchCollection('SmCodeList', true);
        // auto-select record ใหม่
        setSaving(false);
        onSelect({ vendor: data, realInvoiceNo: '' });
        return;
      }
      if (fetchCollection) await fetchCollection('SmCodeList', true);
      setView('search'); setEditTarget(null); setSmForm({}); setSmFormError('');
    } catch (e) { setSmFormError('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const handleSmDelete = async (item) => {
    if (!window.confirm(`ต้องการลบ "${item['SM-Code']} — ${item['Company Name'] || ''}" ใช่หรือไม่?`)) return;
    try {
      const { error } = await db.from('sm_code_list').delete().eq('id', item.id);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('SmCodeList', true);
    } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); }
  };

  const handleSmBack = () => { setView('search'); setEditTarget(null); setSmForm({}); setSmFormError(''); setTimeout(() => inputRef.current?.focus(), 60); };

  const LBL = { padding: '6px 10px', fontSize: '11px', fontWeight: '600', color: '#1a3a5c', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0', background: '#f8f9fa', whiteSpace: 'nowrap' };
  const cellY = { background: '#FFF9C4' };
  const inpBase = { height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' };
  const isViewOnly = view === 'view';

  const smInp = (key, ro = false) => (
    <input value={smForm[key] || ''} readOnly={ro || isViewOnly}
      onChange={e => !ro && !isViewOnly && setSmForm(f => ({ ...f, [key]: e.target.value }))}
      style={inpBase} />
  );
  const smCombo = (key) => {
    const opts = getSmOptions(key);
    return (
      <select value={smForm[key] || ''} disabled={isViewOnly}
        onChange={e => setSmForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ ...inpBase, cursor: isViewOnly ? 'default' : 'pointer' }}>
        <option value="">เลือก</option>
        {opts.map((o, i) => <option key={i} value={o}>{o}</option>)}
      </select>
    );
  };

  // ── smGrid: header-over-input grid helper เหมือนกับ VendorMaster.js ──────
  const smGrid = (cols) => (
    <div style={{ display: 'grid', gridTemplateColumns: cols.map(c => c.w || '1fr').join(' '), border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
      {cols.map((c, i) => {
        const isLast = i === cols.length - 1;
        const br = isLast ? 'none' : '0.5px solid #e8eaf0';
        return (
          <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: br, borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
        );
      })}
      {cols.map((c, i) => {
        const isLast = i === cols.length - 1;
        const br = isLast ? 'none' : '0.5px solid #e8eaf0';
        if (c.blank) return <div key={`c${i}`} style={{ borderRight: br, minHeight: '28px' }} />;
        const key = c.key;
        const isCombo = c.combo;
        const opts = c.opts || [];
        return (
          <div key={`c${i}`} style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: c.center ? 'center' : 'flex-start', borderRight: br, overflow: 'visible', background: c.bg || 'transparent' }}>
            {isViewOnly
              ? <div style={{ fontSize: '12px', color: '#1a3a5c', padding: '0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: c.center ? 'center' : 'left' }}>{smForm[key] || '—'}</div>
              : isCombo
                ? <SmComboBox value={smForm[key] || ''} onChange={val => c.onChangeFn ? c.onChangeFn(val) : setSmForm(f => ({ ...f, [key]: val }))}
                    options={opts} center={c.center} />
                : <input value={smForm[key] || ''} onChange={e => c.onChangeFn ? c.onChangeFn(e.target.value) : setSmForm(f => ({ ...f, [key]: e.target.value }))}
                    onBlur={e => c.onBlurFn && c.onBlurFn(e.target.value)}
                    style={{ ...inpBase, textAlign: c.center ? 'center' : 'left' }} />
            }
          </div>
        );
      })}
    </div>
  );

  const renderSmForm = () => {
    const isEdit = view === 'edit';
    const titleMap = { new: '+ New SM-Code', edit: `Edit SM-Code — ${editTarget?.['SM-Code'] || ''}`, view: `View SM-Code — ${editTarget?.['SM-Code'] || ''}` };
    const iconMap  = { new: '➕', edit: '✏️', view: '👁' };
    const iconBgMap = { new: '#27500A', edit: '#0C447C', view: '#1a3a5c' };
    const row = (cols, children) => (
      <div style={{ display: 'grid', gridTemplateColumns: cols, border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'visible', marginBottom: '6px' }}>{children}</div>
    );
    return (
      <>
        {/* Header */}
        <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <button onClick={handleSmBack} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f5f7fa', border: '0.5px solid #dde', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', color: '#555', fontSize: '12px', fontWeight: '500', flexShrink: 0 }}>← Back</button>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: iconBgMap[view], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{iconMap[view]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>{titleMap[view]}</div>
          </div>
          {view === 'view' && (
            <button onClick={() => setView('edit')} style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', background: '#0C447C', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>✏️ Edit</button>
          )}
        </div>
        {smFormError && <div style={{ padding: '8px 20px', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', borderBottom: '1px solid #f7c1c1', flexShrink: 0 }}>⚠️ {smFormError}</div>}

        {/* Form Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {/* Row 1: Simple Code | OFIN CODE | Supplier Code | Type | Sub Type — VendorMaster smGrid style */}
          {smGrid([
            { label: 'Simple Code',   key: 'SM-Code',       w: '1fr',   bg: '#FFF9C4' },
            { label: 'OFIN CODE',     key: 'Ofin Code',     w: '160px', bg: '#FFF9C4', center: true, onChangeFn: handleSmOfinCodeChange, onBlurFn: handleSmOfinCodeBlur },
            { label: 'Supplier Code', key: 'Supplier Code', w: '180px', onChangeFn: handleSmSupplierCodeChange, center: true },
            { label: 'Type',          key: '_type',         w: '170px', combo: true, opts: [...new Set((categoryItems || []).map(i => i['TYPE']).filter(Boolean))], center: true },
            { label: 'Sub Type',      key: '_sub_type',     w: '180px', combo: true, opts: [...new Set((categoryItems || []).filter(i => !smForm['_type'] || i['TYPE'] === smForm['_type']).map(i => i['SUB TYPE']).filter(Boolean))], center: true },
          ])}
          {/* Supplier Code + Simple Code badges — เหมือน VendorMaster */}
          {(smForm['SM-Code']?.trim() || smForm['Supplier Code']?.trim()) && (
            <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {smForm['SM-Code']?.trim() && (
                (smCodeItems || []).find(i => String(i['SM-Code'] || '').trim().toLowerCase() === smForm['SM-Code'].trim().toLowerCase() && i.id !== editTarget?.id)
                  ? <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>✅ Simple Code found!!!</span>
                  : <span style={{ fontSize: '11px', background: '#FCEBEB', color: '#791F1F', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>❌ Simple Code Notfound!!!</span>
              )}
              {smForm['Supplier Code']?.trim() && (() => {
                const found = (categoryItems || []).find(i => String(i['Code'] || '').trim() === smForm['Supplier Code'].trim());
                return found
                  ? <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>✅ Suppliercode found!!! — {found['TYPE']} / {found['SUB TYPE']}</span>
                  : <span style={{ fontSize: '11px', background: '#FCEBEB', color: '#791F1F', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>❌ Suppliercode Notfound!!!</span>;
              })()}
            </div>
          )}

          {/* Row 2: Vendor Name | Tax ID | Branch No. | AT-Match — VendorMaster smGrid style */}
          {smGrid([
            { label: 'Vendor Name', key: 'Company Name', w: '1fr',   bg: '#FFF9C4' },
            { label: 'Tax ID',      key: 'Tax ID',       w: '240px', bg: '#FFF9C4' },
            { label: 'Branch No.',  key: 'Branch',       w: '180px', bg: '#FFF9C4' },
            { label: 'AT-Match',    key: 'Short Name',   w: '110px', combo: true, bg: '#FFF9C4', opts: [...new Set((smCodeItems || []).map(i => i['Short Name']).filter(Boolean))], onChangeFn: handleSmATMatchChange },
          ])}
          {/* Row 3: Debit / Credit Account — เหมือน VendorMaster.js เป๊ะ */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
            <div style={{ borderRight: '0.5px solid #e8eaf0' }}>
              <div style={{ padding: '6px 10px', fontSize: '11px', color: 'white', background: '#1a3a5c', fontWeight: '600', textAlign: 'center', borderBottom: '0.5px solid #e8eaf0' }}>Debit Account</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                {[['CPC_Dr', 'CPC Dr'], ['Account_Dr', 'Account Dr'], ['Sub Acc_Dr', 'Sub Acc Dr']].map(([key, lbl], fi) => (
                  <div key={key}>
                    <div style={{ padding: '4px 8px', fontSize: '10px', color: '#888', background: '#f8f9fa', borderBottom: '0.5px solid #e8eaf0', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none', textAlign: 'center', fontWeight: '500' }}>{lbl}</div>
                    <div style={{ padding: '3px 6px', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none' }}>
                      {isViewOnly
                        ? <div style={{ fontSize: '12px', color: '#1a3a5c', padding: '4px 2px', textAlign: 'center' }}>{smForm[key] || '—'}</div>
                        : <input value={smForm[key] || ''} onChange={e => setSmForm(f => ({ ...f, [key]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ padding: '6px 10px', fontSize: '11px', color: 'white', background: '#1a3a5c', fontWeight: '600', textAlign: 'center', borderBottom: '0.5px solid #e8eaf0' }}>Credit Account</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                {[['CPC_Cr', 'CPC Cr'], ['Account_Dr2', 'Account Cr'], ['Sub Acc_Cr', 'Sub Acc Cr']].map(([key, lbl], fi) => (
                  <div key={key}>
                    <div style={{ padding: '4px 8px', fontSize: '10px', color: '#888', background: '#f8f9fa', borderBottom: '0.5px solid #e8eaf0', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none', textAlign: 'center', fontWeight: '500' }}>{lbl}</div>
                    <div style={{ padding: '3px 6px', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none' }}>
                      {isViewOnly
                        ? <div style={{ fontSize: '12px', color: '#1a3a5c', padding: '4px 2px', textAlign: 'center' }}>{smForm[key] || '—'}</div>
                        : <input value={smForm[key] || ''} onChange={e => setSmForm(f => ({ ...f, [key]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Rows 4-8: Rule pairs — label-left layout เหมือน VendorMaster.js เป๊ะ */}
          {[
            ['Expense Type','Expense Type','Special Rule1','Special Rule1'],
            ['First Part',  'First Part',  'Special Rule2','Special Rule2'],
            ['Mid Part',    'Mid Part',    'Simple Rule3', 'Simple Rule3' ],
            ['Last Part',   'Last Part',   'Special Rule4','Special Rule4'],
            ['Digit',       'Digit',       'Special Rule5','Special Rule5'],
          ].map(([lbl1,key1,lbl2,key2]) => (
            <div key={key1} style={{ display:'grid', gridTemplateColumns:'110px 1fr 110px 1fr', border:'0.5px solid #e8eaf0', borderRadius:'6px', overflow:'visible', marginBottom:'6px' }}>
              <div style={{ padding:'5px 10px', fontSize:'11px', color:'#888', background:'#f8f9fa', display:'flex', alignItems:'center', whiteSpace:'nowrap', borderRight:'0.5px solid #e8eaf0', fontWeight:'500' }}>{lbl1}</div>
              <div style={{ padding:'3px 6px', display:'flex', alignItems:'center', borderRight:'0.5px solid #e8eaf0', overflow:'visible' }}>
                {isViewOnly
                  ? <div style={{ fontSize:'12px', color:'#1a3a5c', padding:'0 2px' }}>{smForm[key1]||'—'}</div>
                  : ['Expense Type','Digit','Simple Rule3'].includes(key1)
                    ? smCombo(key1)
                    : <input value={smForm[key1]||''} onChange={e=>setSmForm(f=>({...f,[key1]:e.target.value}))} style={{ height:'28px', padding:'0 8px', fontSize:'12px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box' }} />
                }
              </div>
              <div style={{ padding:'5px 10px', fontSize:'11px', color:'#888', background:'#f8f9fa', display:'flex', alignItems:'center', whiteSpace:'nowrap', borderRight:'0.5px solid #e8eaf0', fontWeight:'500' }}>{lbl2}</div>
              <div style={{ padding:'3px 6px', display:'flex', alignItems:'center', overflow:'visible' }}>
                {isViewOnly
                  ? <div style={{ fontSize:'12px', color:'#1a3a5c', padding:'0 2px' }}>{smForm[key2]||'—'}</div>
                  : ['Special Rule1','Special Rule2','Simple Rule3','Special Rule4','Special Rule5'].includes(key2)
                    ? smCombo(key2)
                    : <input value={smForm[key2]||''} onChange={e=>setSmForm(f=>({...f,[key2]:e.target.value}))} style={{ height:'28px', padding:'0 8px', fontSize:'12px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box' }} />
                }
              </div>
            </div>
          ))}

          {/* Row 9: Remark | BlankCell — label-left layout เหมือน VendorMaster.js เป๊ะ */}
          <div style={{ display:'grid', gridTemplateColumns:'110px 1fr 110px 1fr', border:'0.5px solid #e8eaf0', borderRadius:'6px', overflow:'visible', marginBottom:'6px' }}>
            <div style={{ padding:'5px 10px', fontSize:'11px', color:'#888', background:'#f8f9fa', display:'flex', alignItems:'center', whiteSpace:'nowrap', borderRight:'0.5px solid #e8eaf0', fontWeight:'500' }}>Remark</div>
            <div style={{ padding:'3px 6px', display:'flex', alignItems:'center', borderRight:'0.5px solid #e8eaf0', overflow:'visible' }}>
              {isViewOnly
                ? <div style={{ fontSize:'12px', color:'#1a3a5c', padding:'0 2px' }}>{smForm['Remark']||'—'}</div>
                : <input value={smForm['Remark']||''} onChange={e=>setSmForm(f=>({...f,'Remark':e.target.value}))} style={{ height:'28px', padding:'0 8px', fontSize:'12px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box' }} />
              }
            </div>
            <div style={{ padding:'5px 10px', fontSize:'11px', color:'#888', background:'#f8f9fa', display:'flex', alignItems:'center', whiteSpace:'nowrap', borderRight:'0.5px solid #e8eaf0', fontWeight:'500' }}>BlankCell</div>
            <div style={{ padding:'3px 6px' }} />
          </div>
        </div>

        {/* Row M1: BU Company Simple | Tax ID BU | BU Branch | Com% | Spec% */}
        <div style={{ padding: '0 20px 0' }}>
          {(() => {
            const smRowBlue = (cols) => (
              <div style={{ display: 'grid', gridTemplateColumns: cols.map(c => c.w || '1fr').join(' '), border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                {cols.map((c, i) => (
                  <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < cols.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
                ))}
                {cols.map((c, i) => {
                  const isLast = i === cols.length - 1;
                  if (c.check) {
                    const ofinCode = (smForm['Ofin Code'] || '').trim();
                    const foundBranch = ofinCode ? branchItems.find(b => String(b['Branch Code'] || '').trim() === ofinCode) : null;
                    return <div key={`c${i}`} style={{ borderRight: isLast ? 'none' : '0.5px solid #e8eaf0', background: ofinCode ? (foundBranch ? '#27AE60' : '#E74C3C') : '#E6F1FB', minHeight: '28px' }} />;
                  }
                  return (
                    <div key={`c${i}`} style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: isLast ? 'none' : '0.5px solid #e8eaf0', background: '#E6F1FB' }}>
                      <input value={smForm[c.key] || ''} readOnly style={{ ...inpBase, textAlign: 'center', color: '#0C447C', fontWeight: '500' }} />
                    </div>
                  );
                })}
              </div>
            );
            return (
              <>
                {smRowBlue([
                  { label: 'BU Company Simple', key: '_buCompanySimple', w: '1fr' },
                  { label: 'Tax ID BU',         key: '_taxIdBu',         w: '180px' },
                  { label: 'BU Branch',         key: 'Short Branch',     w: '180px' },
                  { label: 'Com%',              key: '_comPct',          w: '90px' },
                  { label: 'Spec%',             key: '_specPct',         w: '80px' },
                ])}
                {smRowBlue([
                  { label: 'BU',               key: 'BU',              w: '100px' },
                  { label: 'Group-P',          key: '_groupP',         w: '100px' },
                  { label: 'OFIN SIMPLE NAME', key: '_ofinSimpleName', w: '1fr' },
                  { label: 'Branch Code',      key: '_branchCode',     w: '200px' },
                  { label: 'Status',           key: '_branchStatus',   w: '180px' },
                  { label: 'Check Data',       check: true,            w: '150px' },
                ])}
              </>
            );
          })()}
        </div>

        {/* Username / Last Update */}
        {(editTarget?.updated_by || editTarget?.updated_at) && (
          <div style={{ padding: '6px 20px', borderTop: '0.5px solid #f0f2f5', display: 'flex', gap: '16px', flexShrink: 0, background: '#fafbfc' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: '#aaa' }}>Username</div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '1px' }}>{editTarget?.updated_by || '-'}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: '#aaa' }}>Last Update</div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '1px' }}>
                {editTarget?.updated_at ? new Date(editTarget.updated_at).toLocaleString('th-TH') : '-'}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0, background: '#fafbfc' }}>
          <button onClick={handleSmBack} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>
            {isViewOnly ? 'Close' : 'Cancel'}
          </button>
          {!isViewOnly && (
            <button onClick={handleSmSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving...' : '💾 Save'}
            </button>
          )}
        </div>
      </>
    );
  };

  const isFormView = view === 'new' || view === 'edit' || view === 'view';

  if (!show) return null;
  const inputOnly = smCodeItems.filter(i =>
    String(i['Short Name'] ?? '').trim().toUpperCase() === 'INPUT'
  );
  const q = query.trim().toLowerCase();
  const filtered0 = q
    ? inputOnly.filter(i =>
        String(i['Company Name'] ?? '').toLowerCase().includes(q) ||
        String(i['SM-Code'] ?? '').toLowerCase().includes(q)
      )
    : inputOnly;
  const favItems  = vendorTaxId ? filtered0.filter(i => isFav(i)) : [];
  const restItems = vendorTaxId ? filtered0.filter(i => !isFav(i)) : filtered0;
  const filtered  = [...favItems, ...restItems];

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) {
      onSelect({ vendor: filtered[active], realInvoiceNo });
    }
  };

  const handleSelect = (item) => { onSelect({ vendor: item, realInvoiceNo }); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1600, backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isFormView) onClose(); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: '96vw', maxWidth: '1100px', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)', transition: 'width 0.2s, max-width 0.2s' }}>

        {isFormView ? renderSmForm() : (<>
        {/* Header */}
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Real Vendor</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>{filtered.length} รายการ{query ? ` · ค้นหา "${query}"` : ''}</div>
          </div>
          <button onClick={() => { setView('new'); setEditTarget(null); setSmForm(smEmptyForm()); setSmFormError(''); }}
            style={{ height: '32px', padding: '0 14px', borderRadius: '8px', border: 'none', background: '#27500A', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add
          </button>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Search + Manual Entry */}
        <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey}
              placeholder="AT-Match, Company Name, SM-Code..."
              style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
              onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
          </div>

          {/* เส้นคั่น "หรือกรอกเอง" */}
          <div style={{ borderTop: '0.5px dashed #ddd', position: 'relative', margin: '10px 0' }}>
            <span style={{ position: 'absolute', top: '-8px', left: 0, background: '#fafbfc', paddingRight: '8px', fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>หรือกรอกเอง</span>
          </div>

          {/* Manual entry: Real Tax Invoice No. | Company Name | Tax ID | Branch */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr 1.1fr 0.7fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#555', display: 'block', marginBottom: '4px' }}>Real tax invoice no.</label>
              <input value={manualVendor.realInvoiceNo} onChange={e => setManualVendor(m => ({ ...m, realInvoiceNo: e.target.value }))}
                placeholder="กรอกเลข Invoice"
                style={{ width: '100%', height: '32px', padding: '0 10px', fontSize: '12px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#555', display: 'block', marginBottom: '4px' }}>Tax Invoice Date</label>
              <input type="date" value={manualVendor.taxInvoiceDate} onChange={e => setManualVendor(m => ({ ...m, taxInvoiceDate: e.target.value }))}
                style={{ width: '100%', height: '32px', padding: '0 10px', fontSize: '12px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#555', display: 'block', marginBottom: '4px' }}>Company name</label>
              <input value={manualVendor.companyName} onChange={e => setManualVendor(m => ({ ...m, companyName: e.target.value }))}
                placeholder="กรอกชื่อบริษัท"
                style={{ width: '100%', height: '32px', padding: '0 10px', fontSize: '12px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#555', display: 'block', marginBottom: '4px' }}>Tax ID</label>
              <input value={manualVendor.taxId} onChange={e => setManualVendor(m => ({ ...m, taxId: e.target.value }))}
                placeholder="กรอกเลข Tax ID"
                style={{ width: '100%', height: '32px', padding: '0 10px', fontSize: '12px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#555', display: 'block', marginBottom: '4px' }}>Branch</label>
              <input value={manualVendor.branch} onChange={e => setManualVendor(m => ({ ...m, branch: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit(); }}
                placeholder="กรอกเลขสาขา"
                style={{ width: '100%', height: '32px', padding: '0 10px', fontSize: '12px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#ccc' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>ไม่พบ Vendor{query ? ` "${query}"` : ''}</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {[['★','36px'],['SM-Code','100px'],['Company Name',''],['Tax ID','130px'],['Branch','70px'],['Supplier Code','130px'],['Action','100px']].map(([h, w]) => (
                    <th key={h} style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 12px', textAlign: (h === 'Action' || h === '★') ? 'center' : 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const isAct = i === active;
                  const showFavHeader = i === 0 && favItems.length > 0;
                  const showAllHeader = i === favItems.length && favItems.length > 0;
                  return (
                    <React.Fragment key={item.id || i}>
                      {showFavHeader && <tr><td colSpan={7} style={{ padding: '5px 12px', fontSize: '10px', fontWeight: '600', color: '#e6a800', background: '#fffbf0', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '0.5px solid #f3e6a0' }}>★ Favorites ({favItems.length})</td></tr>}
                      {showAllHeader && <tr><td colSpan={7} style={{ padding: '5px 12px', fontSize: '10px', fontWeight: '600', color: '#888', background: '#f8f9fa', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '0.5px solid #e8eaf0' }}>All Vendors ({restItems.length})</td></tr>}
                      <tr data-row={i}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setActive(i)}
                        style={{ background: isAct ? '#eef3fb' : (favItems.includes(item) ? '#fffbf0' : 'white'), cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6' }}>
                        <td style={{ padding: '7px 12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button onClick={e => toggleFav(e, item)} disabled={favUpdating === item['SM-Code']}
                            title={isFav(item) ? 'เอาออกจาก Favorite' : 'เพิ่มใน Favorite'}
                            style={{ width: '22px', height: '22px', borderRadius: '5px', border: 'none', background: 'transparent', cursor: favUpdating === item['SM-Code'] ? 'wait' : 'pointer', fontSize: '14px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFav(item) ? '#e6a800' : '#ccc' }}>
                            {isFav(item) ? '★' : '☆'}
                          </button>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ background: isAct ? '#1a3a5c' : (favItems.includes(item) ? '#fff3cd' : '#f0f3f8'), color: isAct ? 'white' : '#1a3a5c', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>{item['SM-Code'] || '-'}</span>
                        </td>
                        <td style={{ padding: '9px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{item['Company Name'] || '-'}</td>
                        <td style={{ padding: '9px 12px', color: '#778', fontFamily: 'monospace', fontSize: '11px' }}>{item['Tax ID'] || '-'}</td>
                        <td style={{ padding: '9px 12px', color: '#555', fontSize: '11px', textAlign: 'center' }}>{item['Branch'] || '-'}</td>
                        <td style={{ padding: '9px 12px', color: '#555', fontSize: '11px' }}>{item['Supplier Code'] || '-'}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: '4px' }}>
                            <button title="View" onClick={e => { e.stopPropagation(); setView('view'); setEditTarget(item); const _ofin = String(item['Ofin Code'] || '').trim(); const _ofinNorm = /^\d+$/.test(_ofin) ? _ofin.padStart(6, '0') : _ofin; setSmForm({ ...smEmptyForm(), ...item, 'Ofin Code': _ofinNorm }); setSmFormError(''); }}
                              style={{ width: '26px', height: '24px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            <button title="Edit" onClick={e => { e.stopPropagation(); setView('edit'); setEditTarget(item); const _ofin = String(item['Ofin Code'] || '').trim(); const _ofinNorm = /^\d+$/.test(_ofin) ? _ofin.padStart(6, '0') : _ofin; setSmForm({ ...smEmptyForm(), ...item, 'Ofin Code': _ofinNorm }); setSmFormError(''); }}
                              style={{ width: '26px', height: '24px', borderRadius: '5px', border: '0.5px solid #ddd', background: '#f5f5f5', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button title="Delete" onClick={e => { e.stopPropagation(); handleSmDelete(item); }}
                              style={{ width: '26px', height: '24px', borderRadius: '5px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleManualSubmit} style={{ padding: '6px 16px', borderRadius: '7px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Submit</button>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CalcPopup — mini calculator popup สำหรับ Amount field
// ─────────────────────────────────────────────────────────────────────────────
function CalcPopup({ show, anchorPos, initValue = '', onApply, onClose }) {
  
  
  const [display, setDisplay] = useState('0');
  const [history, setHistory] = useState('');
  const [operand, setOperand] = useState(null);
  const [operator, setOperator] = useState(null);
  const [fresh, setFresh] = useState(false);
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const displayRef = useRef('0');

  const safeSetDisplay = (val) => {
    displayRef.current = val;
    setDisplay(val);
  };

useEffect(() => {
    if (show) {
      const raw = parseFloat(String(initValue).replace(/,/g, ''));
      const initDisplay = !isNaN(raw) && raw !== 0 ? String(raw) : '0';
      displayRef.current = initDisplay;
      setDisplay(initDisplay);
      setHistory('');
      setOperand(null);
      setOperator(null);
      setFresh(false);
      if (anchorPos) setPos(anchorPos);
      requestAnimationFrame(() => {
        ref.current?.focus();  // ← เพิ่มบรรทัดนี้
      });
    }
  }, [show, initValue, anchorPos]);

  const round = (n) => Math.round(n * 1e10) / 1e10;

  const calcResult = (a, op, b) => {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b !== 0 ? a / b : 0;
    return b;
  };

  const pushDigit = (d) => {
    if (fresh) { safeSetDisplay(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && displayRef.current.includes('.')) return;
    if (displayRef.current === '0' && d !== '.') safeSetDisplay(d);
    else safeSetDisplay(displayRef.current + d);
  };

  const pushOp = (op) => {
    const cur = parseFloat(displayRef.current) || 0;
    if (operator && !fresh) {
      const result = round(calcResult(operand, operator, cur));
      safeSetDisplay(String(result));
      setOperand(result);
      setHistory(String(result) + ' ' + op);
    } else {
      setOperand(cur);
      setHistory(String(cur) + ' ' + op);
    }
    setOperator(op);
    setFresh(true);
  };

  const doEqual = () => {
    const cur = parseFloat(displayRef.current) || 0;
    const result = operator ? round(calcResult(operand, operator, cur)) : cur;
    onApply(String(result));
    onClose();
  };

  const handleBtn = (action) => {
    const cur = parseFloat(displayRef.current) || 0;
    if (action === 'CE') { safeSetDisplay('0'); }
    else if (action === 'C') { safeSetDisplay('0'); setOperand(null); setOperator(null); setHistory(''); setFresh(false); }
    else if (action === 'BS') { safeSetDisplay(displayRef.current.length > 1 ? displayRef.current.slice(0, -1) : '0'); }
    else if (action === 'PCT') { safeSetDisplay(String(round(cur / 100))); }
    else if (action === 'PM') { safeSetDisplay(displayRef.current.startsWith('-') ? displayRef.current.slice(1) : (displayRef.current === '0' ? '0' : '-' + displayRef.current)); }
    else if (action === 'INV') { safeSetDisplay(String(round(cur !== 0 ? 1 / cur : 0))); }
    else if (action === 'SQ') { safeSetDisplay(String(round(cur * cur))); }
    else if (action === 'OPadd') pushOp('+');
    else if (action === 'OPsub') pushOp('-');
    else if (action === 'OPmul') pushOp('*');
    else if (action === 'OPdiv') pushOp('/');
    else if (action === 'EQ') doEqual();
    else if (action === 'DOT') pushDigit('.');
    else if (action.startsWith('D')) pushDigit(action.slice(1));
  };

  const handleBtnRef = useRef(handleBtn);
  useEffect(() => { handleBtnRef.current = handleBtn; });

  useEffect(() => {
    if (!show) return;
    const h = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); handleBtnRef.current('D' + e.key); return; }
      if (e.key === '.') { e.preventDefault(); handleBtnRef.current('DOT'); return; }
      if (e.key === '+') { e.preventDefault(); handleBtnRef.current('OPadd'); return; }
      if (e.key === '-') { e.preventDefault(); handleBtnRef.current('OPsub'); return; }
      if (e.key === '*') { e.preventDefault(); handleBtnRef.current('OPmul'); return; }
      if (e.key === '/') { e.preventDefault(); handleBtnRef.current('OPdiv'); return; }
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); handleBtnRef.current('EQ'); return; }
      if (e.key === 'Backspace') { e.preventDefault(); handleBtnRef.current('BS'); return; }
      if (e.key === 'Delete') { e.preventDefault(); handleBtnRef.current('C'); return; }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose]);

  if (!show) return null;

  const BTNS = [
    { label:'CE',   action:'CE',   cls:'fn', span:true },
    { label:'C',    action:'C',    cls:'fn' },
    { label:'⌫', action:'BS', cls:'fn' },
    { label:'%',    action:'PCT',  cls:'fn' },
    { label:'1/x',  action:'INV',  cls:'fn' },
    { label:'x²', action:'SQ', cls:'fn' },
    { label:'÷', action:'OPdiv', cls:'op' },
    { label:'7', action:'D7', cls:'num' }, { label:'8', action:'D8', cls:'num' }, { label:'9', action:'D9', cls:'num' },
    { label:'×', action:'OPmul', cls:'op' },
    { label:'4', action:'D4', cls:'num' }, { label:'5', action:'D5', cls:'num' }, { label:'6', action:'D6', cls:'num' },
    { label:'−', action:'OPsub', cls:'op' },
    { label:'1', action:'D1', cls:'num' }, { label:'2', action:'D2', cls:'num' }, { label:'3', action:'D3', cls:'num' },
    { label:'+',  action:'OPadd', cls:'op' },
    { label:'+/−', action:'PM', cls:'fn' },
    { label:'0', action:'D0', cls:'num' },
    { label:'.', action:'DOT', cls:'num' },
    { label:'=', action:'EQ', cls:'eq' },
  ];

return (
    <div
      ref={ref}
      tabIndex={0}          // ← เพิ่ม
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{ 
        position:'fixed', 
        top:pos.top, 
        left:pos.left, 
        zIndex:99999, 
        width:'220px', 
        background:'white', 
        border:'0.5px solid #dde', 
        borderRadius:'10px', 
        overflow:'hidden', 
        boxShadow:'0 8px 24px rgba(26,58,92,0.18)',
        outline: 'none'     // ← เพิ่ม
      }}
    >
      <div style={{ background:'#f5f7fa', padding:'10px 14px 8px', userSelect:'none' }}>
        <div style={{ fontSize:'10px', color:'#aaa', textAlign:'right', minHeight:'14px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{history || ' '}</div>
        <div style={{ fontSize:'22px', fontWeight:'500', color:'#1a3a5c', textAlign:'right', letterSpacing:'-0.5px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{display}</div>
      </div>
      <div style={{ padding:'8px', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'5px' }}>
        {BTNS.map((b, i) => (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
            onClick={e => { e.stopPropagation(); handleBtn(b.action); }}
            style={{
              height:'30px', borderRadius:'6px', cursor:'pointer', userSelect:'none',
              fontSize: b.cls === 'fn' ? '11px' : b.cls === 'op' || b.cls === 'eq' ? '15px' : '13px',
              gridColumn: b.span ? 'span 2' : undefined,
              border: b.cls === 'eq' ? 'none' : '0.5px solid #ddd',
              background: b.cls === 'eq' ? '#1a3a5c' : b.cls === 'op' || b.cls === 'fn' ? '#f5f7fa' : 'white',
              color: b.cls === 'eq' ? 'white' : b.cls === 'op' ? '#1a3a5c' : b.cls === 'fn' ? '#555' : '#1a3a5c',
              fontWeight: b.cls === 'num' || b.cls === 'eq' ? '500' : '400',
            }}
          >{b.label}</button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InvoiceDetailPopup ✅ PATCHED — flex body, minHeight:0, no coming-soon
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceDetailPopup({ show, onClose, form, setField, vendorInfo, itemcodeItems = [], smCodeItems = [], fetchCollection, userName = '', currentUser, bu = '', onResolveBranch = () => {}, onSubmitInvoice = async () => false, isAutoGrt = false, grtPreview = '', grnPreview = '', categoryItems = [], branchItems = [] }) {
  const { width: winW } = useWindowSize();
  const isMobile = winW < 768;
  const isTablet = winW >= 768 && winW < 1200;

  const emptyLine = (hl = 'L') => ({ hl, itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' });
  const [lines, setLines] = useState([{ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }]);
  const line1 = lines[0];
  const setLine1 = (fn) => setLines(prev => { const next = [...prev]; next[0] = typeof fn === 'function' ? fn(prev[0]) : fn; return next; });
  const setLine1Field = (key, val) => setLine1(l => ({ ...l, [key]: val }));
  const setLineField = (idx, key, val) => setLines(prev => { const next = [...prev]; next[idx] = { ...next[idx], [key]: val }; return next; });
  const addLine = () => setLines(prev => [...prev, emptyLine('L')]);
  const [showItemCodePopup, setShowItemCodePopup] = useState(false);
  const [showContractPopup, setShowContractPopup]     = useState(false);
  const [showRealVendorPopup, setShowRealVendorPopup] = useState(false);
  const [realVendorLineIdx, setRealVendorLineIdx]     = useState(-1); // index ของ line ที่กด Real Vendor
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [taxDropdownIdx, setTaxDropdownIdx] = useState(null);
  const [taxHdrOpen, setTaxHdrOpen] = useState(false);
  const [calcOpen, setCalcOpen]     = useState(false);
  const [calcLineIdx, setCalcLineIdx] = useState(-1);
  const [calcInitValue, setCalcInitValue] = useState('');
  const [calcAnchorPos, setCalcAnchorPos] = useState({ top: 0, left: 0 });
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const amountRef   = useRef(null);
  const itemCodeRef = useRef(null);
  const lineItemCodeRefs = useRef([]);
  const lineAmountRefs   = useRef([]);
  const lineRealInvoiceRefs = useRef([]);
  const addLineAndFocus = () => {
    setLines(prev => {
      const next = [...prev, { hl: 'L', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }];
      const newIdx = next.length - 1;
      setTimeout(() => {
        lineItemCodeRefs.current[newIdx]?.focus();
        lineItemCodeRefs.current[newIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 30);
      return next;
    });
  };

  const MONEY_FIELDS = ['amount', 'vat', 'wht', 'total'];
  const handleMoneyChange = (idx, key, val) => { let v = val.replace(/[^0-9.-]/g, ''); const fd = v.indexOf('.'); if (fd !== -1) v = v.slice(0, fd + 1) + v.slice(fd + 1).replace(/\./g, ''); setLineField(idx, key, v); };
  const handleMoneyBlur = (idx, key, val) => {
    if (val === '' || val === '.') { setLineField(idx, key, ''); return; }
    if (key === 'amount') {
      const itemCode = lines[idx]?.itemCode?.trim();
      const itemData = itemcodeItems.find(i => String(i.code ?? '').trim().toUpperCase() === itemCode?.toUpperCase());
      const isVRV = String(itemData?.value ?? '').trim().toUpperCase() === 'V-RV';
      if (isVRV) {
        const vatAmount = parseFloat(val) || 0;
        const amountExVat = Math.round(vatAmount * 100 / 7 * 100) / 100;
        const taxCode0 = lines[idx]?.taxCode || '';
        const isVatLine = taxCode0.includes('VAT7%') && !taxCode0.includes('SVAT7%');
        const autoGrn = (isVatLine && isAutoGrt) ? grnPreview : '';
        setLines(prev => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            hl: 'H', 
            amount: amountExVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            realVendorName: 'กรมศุลกากร',
            realVendorTaxid: '0',
            realVendorBranch: '0',
            realInvoiceNo: '',
            realVendorCode: '',
            realGrn: autoGrn,
            isVat: isVatLine ? 'Yes' : 'No',
          };
          return next;
          });
          setTimeout(() => lineRealInvoiceRefs.current[idx]?.focus(), 150);  // ← ตรงนี้
          return;
      }
    }
    const num = Math.round(parseFloat(val) * 100) / 100;
    setLineField(idx, key, num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };
  const handleMoneyFocus = (idx, key, val) => { setLineField(idx, key, val.replace(/,/g, '')); };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const buildTaxCode = (vatChar, branchDirectCode) => {
    const v = String(vatChar ?? '').trim().toUpperCase();
    if (v === 'V') return `${branchDirectCode}-N VAT7%`;
    if (v === 'S') return `${branchDirectCode}-N SVAT7%`;
    return '';
  };
  const buildWhtCode = (whtChar, branchDirectCode) => {
    const w = String(whtChar ?? '').trim().toUpperCase();
    if (w === 'N' || w === '') return '';
    return `${branchDirectCode}-WHT${w}%`;
  };
  const fmt2 = (n) => n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── CT: ถ้า Item Code มี SPI-1 = CT แปลว่าต้องผูก Contract ────────────────
  const currentItemData = itemcodeItems.find(
    i => String(i.code ?? '').trim().toUpperCase() === String(line1.itemCode ?? '').trim().toUpperCase()
  );
  const requiresContract = String(currentItemData?.spi1 ?? '').toUpperCase().includes('CT');

  // ── เลือกสัญญาจาก ContractPopup → ดึง CDes+BDes ใส่ Back Description 1/2/3 ─
  // (อันไหนไม่มีข้อมูล ไม่ต้องใส่/ไม่แก้ของเดิม)
  const handleSelectContract = (item) => {
    const pairs = [
      ['backDesc1', item?.cdes1, item?.bdes1],
      ['backDesc2', item?.cdes2, item?.bdes2],
      ['backDesc3', item?.cdes3, item?.bdes3],
    ];
    pairs.forEach(([key, c, b]) => {
      const cc = String(c ?? '').trim();
      const bb = String(b ?? '').trim();
      if (cc || bb) setField(key, [cc, bb].filter(Boolean).join(' '));
    });
    setShowContractPopup(false);
    if (item?.auto_ib?.trim()) onResolveBranch(`${item.auto_ib.trim()}+`);
  };

  // ── Back Description 1: ถ้าพิมพ์ตรงกับ Serial Code หรือ BDes1 ของสัญญาที่มี ──
  // ── ของ vendor นี้อยู่แล้ว ให้ดึงสัญญามาใส่ทันที (เหมือนกดเลือกใน Contract popup)
  // ── ถ้า vendor นี้ไม่มีสัญญาในระบบ จะไม่มีอะไร match จึงไม่เกิดผลใดๆ
  const handleBackDesc1Blur = async (val) => {
    if (!val?.trim()) return;
    const fullVendorCode = `${bu}-${form?.supplierCode || ''}`.toUpperCase();
    if (!bu || !form?.supplierCode) return;
    try {
      const { data, error } = await db
        .from('contract_list')
        .select('*')
        .ilike('vendor_code', fullVendorCode)
        .limit(100);
      if (error || !data?.length) return;
      const search = val.trim().toLowerCase();
      const match = data.find(item =>
        String(item.serial_code || '').toLowerCase().includes(search) ||
        String(item.bdes1 || '').toLowerCase().includes(search)
      );
      if (match) handleSelectContract(match);
    } catch (e) {
      console.error('handleBackDesc1Blur:', e);
    }
  };

  // ── Auto-calculate ALL line fields (every row) ───────────────────────────
  const calcLine = (line, itemcodeItems, vendorInfo, form) => {
    if (!line.itemCode?.trim()) return { ...line, desc: '', account: '', taxCode: '', whtCode: '', vat: '', wht: '', total: '' };
    const itemData = itemcodeItems.find(i => String(i.code ?? '').trim().toUpperCase() === line.itemCode.trim().toUpperCase());
    if (!itemData) return line;
    const rawSub = String(itemData.sub ?? '').trim();
    const subVal = rawSub.toUpperCase() === 'SUB' ? String(vendorInfo?.['Sub Acc'] ?? '').trim() : rawSub;
    const rawCpc = String(itemData.cpc ?? '').trim();
    const spi1 = String(itemData.spi1 ?? '').trim().toUpperCase();
    const effectiveCpc = form?.branchCpc?.trim() ? form.branchCpc.trim(): (spi1 === 'C-CPC' && form?.headerCpc?.trim()) ? form.headerCpc.trim() : rawCpc;
    const accountVal = [effectiveCpc, String(itemData.account ?? '').trim(), subVal].filter(Boolean).join('-');
    const hasIB = form?.branchIBLabel && form.branchIBLabel !== '-';
    const isIBAll = form?.branchIBLabel === 'IB-ALL';
    const ibPrefix = isIBAll ? 'IB-ALL' : hasIB ? `${form?.branchNo ?? ''}-IB` : '';
    const ibLabel = hasIB && !isIBAll ? `สาขา ${String(form?.branchIBLabel ?? '').split('-').slice(1).join('-').trim()}` : '';
    const disGDesc = buildDisGDesc(itemData?.dis_g, form?.backDesc1, form?.backDesc2, form?.backDesc3);
    const descVal = [ibPrefix, form?.period ?? '', String(itemData.description ?? '').trim(), disGDesc, ibLabel].filter(Boolean).join(' ');
    const notices = String(vendorInfo?.['Notice'] ?? '').split('|').map(n => n.trim().toUpperCase());
    const hasITC   = notices.includes('ITC');
    const hasVITEM = notices.some(n => n === 'V-ITEM' || n === 'TC V-ITEM');
    const hasTC    = notices.some(n => n === 'TC' || n === 'TC V-ITEM');
    let sourceStr = String(vendorInfo?.['Tax-Type'] ?? '').trim().toUpperCase();
    if (hasTC || hasVITEM || hasITC) sourceStr = String(itemData?.spec_tx ?? '').trim().toUpperCase()
    if (form?.invTax?.trim()) sourceStr = String(form.invTax).trim().toUpperCase();
    if (line.tax?.trim()) sourceStr = String(line.tax).trim().toUpperCase();
    const vatChar = sourceStr[0] ?? '';
    const whtChar = sourceStr[1] ?? '';
    const branchDirectCode = String(form?.branchDirectLabel ?? '').split('-')[0].trim();
    const taxCodeVal = buildTaxCode(vatChar, branchDirectCode);
    const whtCodeVal = hasITC ? '' : buildWhtCode(whtChar, branchDirectCode);
    const amountNum = parseFloat(String(line.amount).replace(/,/g, '')) || 0;
    const vatNum = (vatChar === 'V' || vatChar === 'S') ? Math.round(amountNum * 0.07 * 100) / 100 : 0;
    const whtPct = hasITC ? 0 : (parseFloat(whtChar) || 0);
    const whtNum = -Math.round(amountNum * (whtPct / 100) * 100) / 100;
    const totalNum = Math.round((amountNum + vatNum) * 100) / 100;
    return { ...line, desc: descVal, account: accountVal, taxCode: taxCodeVal, whtCode: whtCodeVal, vat: fmt2(vatNum), wht: fmt2(whtNum), total: fmt2(totalNum), _taxCodeRaw: taxCodeVal, _accountRaw: String(itemData.account ?? '').trim() };
  };

  useEffect(() => {
    setLines(prev => {
      const calculated = prev.map(line => calcLine(line, itemcodeItems, vendorInfo, form));
      const hasT = calculated.some(l => String(l._accountRaw || '').startsWith('116301'));
      return calculated.map(l => ({
        ...l,
        taxCode: l._taxCodeRaw ? (hasT ? 'T' + l._taxCodeRaw : l._taxCodeRaw) : l.taxCode,
      }));
    });
  }, [
    lines.map(l => l.itemCode).join(','),
    lines.map(l => l.amount).join(','),
    lines.map(l => l.tax).join(','),
    form?.period, form?.invTax,
    form?.backDesc1, form?.backDesc2, form?.backDesc3,
    form?.branchNo, form?.branchDirectLabel, form?.branchIBLabel,
    form?.headerCpc, form?.branchCpc,
    vendorInfo, itemcodeItems?.length,
  ]);

  const handleSubmit = async () => {
    if (!lines[0]?.itemCode?.trim() || !lines[0]?.amount?.trim()) {
      alert('กรุณากรอก Item Code และ Amount อย่างน้อย 1 บรรทัด');
      return;
    }
    const ok = await onSubmitInvoice(lines);
    if (ok) {
      setLines([{ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }]);
      onClose();
    }
  };

  useEffect(() => {
    if (!show) return;
    const h = (e) => {
      if (e.key === 'Escape') { if (calcOpen) { setCalcOpen(false); return; } onClose(); }
      if (e.key === 'Enter'  && e.ctrlKey) handleSubmit();
      // Ctrl+Delete → Clear form (lines + header fields)
      if (e.key === 'Delete' && e.ctrlKey) {
        e.preventDefault();
        setLines([{ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }]);
        setField('invDate',    '');
        setField('invoiceNum', '');
        setField('invTax',     '');
        setField('grtNum',     '');
        setField('grn',        '');
        setField('period',     '');
        setField('backDesc1',  '');
        setField('backDesc2',  '');
        setField('backDesc3',  '');
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose]);

  if (!show) return null;

  const popupStyle = isMobile
    ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 }
    : isTablet
      ? { width: '96vw', maxWidth: '1200px', height: '92vh', maxHeight: '92vh', borderRadius: '14px' }
      : { width: '98vw', maxWidth: '1400px', height: '95vh', maxHeight: '95vh', borderRadius: '14px' };

  const inputStyle = (w) => ({ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', width: w || '100%' });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', ...popupStyle, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>

        {/* ── Header ── */}
        <div style={{ padding: isMobile ? '12px 14px' : '14px 22px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5', flexWrap: 'wrap' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>📋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Invoice Detail</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap' }}>
              Supplier: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.supplierCode || '-'}</span>
              {' · '}Invoice no.: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{(buildInvoiceNumber(form?.invoiceNum, form?.invDate, vendorInfo) || '-') + (form?.invoiceSuffix || '')}</span>
              {' · '}Branch: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.branchNo || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ✅ PATCHED: overflow:hidden + flex column ── */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: isMobile ? '12px 14px' : '18px 22px', display: 'flex', flexDirection: 'column' }}>

          {/* Header Detail boxes */}
          <div style={{ display: 'flex', gap: '2%', marginBottom: '14px', flexShrink: 0 }}>
            <div style={{ ...card, width: '49%', marginBottom: 0 }}>
              <div style={{ ...cardHead, background: vendorInfo?.['Supplier Name'] ? '#f8f9fa' : '#fafbfc' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: vendorInfo?.['Supplier Name'] ? '#1a3a5c' : '#ccc', fontStyle: vendorInfo?.['Supplier Name'] ? 'normal' : 'italic' }}>
                  {vendorInfo?.['Supplier Name'] || '— ยังไม่ได้เลือก Supplier —'}
                </span>
              </div>
              <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[['Vendor Code', vendorInfo?.['Supplier Number']], ['Vendor Site', vendorInfo?.['Supplier Site']]].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#999', width: '72px', flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: '12px', color: val ? '#1a3a5c' : '#ccc', fontStyle: val ? 'normal' : 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val || '—'}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[['Tax ID', vendorInfo?.['Tax ID']], ['No.', vendorInfo?.['No.']]].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#999', width: '72px', flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: '12px', color: val ? '#1a3a5c' : '#ccc', fontStyle: val ? 'normal' : 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val || '—'}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#999', width: '72px', flexShrink: 0, paddingTop: '1px' }}>Address</span>
                  <span style={{ fontSize: '12px', color: vendorInfo?.['Address'] ? '#1a3a5c' : '#ccc', fontStyle: vendorInfo?.['Address'] ? 'normal' : 'italic', flex: 1, lineHeight: '1.6', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {vendorInfo?.['Address'] || '—'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ ...card, width: '49%', marginBottom: 0 }}>
              <div style={cardHead}><span style={cardLabel}>Document Number</span></div>
              <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: '0' }}>
                {(() => {
                  const genInvoiceNo = buildInvoiceNumber(form?.invoiceNum, form?.invDate, vendorInfo);
                  return (
                    <div style={{ fontSize: '14px', fontWeight: '600', color: genInvoiceNo ? '#1a3a5c' : '#ccc', fontStyle: genInvoiceNo ? 'normal' : 'italic', marginBottom: '10px' }}>
                      {genInvoiceNo || '— ยังไม่ได้กรอก Invoice No. —'}
                    </div>
                  );
                })()}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '0.5px solid #e8eaf0', borderRadius: '7px', overflow: 'hidden' }}>
                  <div style={{ padding: '7px 12px', borderRight: '0.5px solid #e8eaf0' }}>
                    <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>GRT</div>
                    {(() => {
                      const val = isAutoGrt ? grtPreview : (form?.grtNum || '—');
                      return <div style={{ fontSize: '12px', fontWeight: '500', color: val !== '—' ? '#1a3a5c' : '#ccc', fontFamily: 'monospace' }}>{val}</div>;
                    })()}
                  </div>
                  <div style={{ padding: '7px 12px' }}>
                    <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>GRN</div>
                    {(() => {
                      const taxCode0 = String(lines[0]?.taxCode || '');
                      const isVat = taxCode0.includes('VAT7%') && !taxCode0.includes('SVAT7%');
                      const val = isAutoGrt ? (isVat ? grnPreview : '-') : (form?.grn || '—');
                      return <div style={{ fontSize: '12px', fontWeight: '500', color: (val !== '—' && val !== '-') ? '#1a3a5c' : '#ccc', fontFamily: 'monospace' }}>{val}</div>;
                    })()}
                  </div>
                  <div style={{ padding: '7px 12px', borderTop: '0.5px solid #e8eaf0', borderRight: '0.5px solid #e8eaf0' }}>
                    <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>Branch Direct</div>
                    <div style={{ fontSize: '11px', fontWeight: '500', color: form?.branchDirectLabel ? '#1a3a5c' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form?.branchDirectLabel || '—'}</div>
                  </div>
                  <div style={{ padding: '7px 12px', borderTop: '0.5px solid #e8eaf0' }}>
                    <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>Branch IB</div>
                    <div style={{ fontSize: '11px', fontWeight: '500', color: form?.branchIBLabel && form.branchIBLabel !== '-' ? '#1a3a5c' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(form?.branchIBLabel && form.branchIBLabel !== '-') ? form.branchIBLabel : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fields row */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', alignItems: 'flex-end', overflowX: 'visible', overflowY: 'visible', marginBottom: '14px', flexShrink: 0, position: 'relative' }}>
            {[['Inv date','invDate','date','130px'],['Invoice num','invoiceNum','text','150px'],['GRT','grtNum','text','75px'],['GRN','grn','text','75px']].map(([label, key, type, w]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={fieldLabel}>{label}</label>
                <input type={type} value={form?.[key] || ''} onChange={e => setField(key, e.target.value)} style={inputStyle(w)} />
              </div>
            ))}
            {/* Tax header dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, position: 'relative' }}>
              <label style={fieldLabel}>Tax</label>
              <input
                type="text"
                value={form?.invTax || ''}
                onChange={e => setField('invTax', e.target.value.toUpperCase())}
                onFocus={() => setTaxHdrOpen(true)}
                onBlur={() => setTimeout(() => setTaxHdrOpen(false), 120)}
                style={inputStyle('60px')}
              />
              {taxHdrOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, width: '60px', zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '5px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', maxHeight: '170px', overflowY: 'auto' }}>
                  {TAX_TYPE_OPTS.map(o => (
                    <div key={o}
                      onMouseDown={e => { e.preventDefault(); setField('invTax', o); setTaxHdrOpen(false); }}
                      style={{ padding: '4px 8px', fontSize: '11px', color: '#1a3a5c', cursor: 'pointer', background: (form?.invTax || '') === o ? '#eef3fb' : 'white', whiteSpace: 'nowrap' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#eef3fb'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = (form?.invTax || '') === o ? '#eef3fb' : 'white'; }}
                    >{o}</div>
                  ))}
                </div>
              )}
            </div>
            <PeriodPicker value={form?.period || ''} onChange={v => setField('period', v)} />
            {[['Back Description 1','backDesc1'],['Back Description 2','backDesc2'],['Back Description 3','backDesc3']].map(([label, key]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 120px', minWidth: '120px' }}>
                <label style={fieldLabel}>{label}</label>
                <input type="text" value={form?.[key] || ''} onChange={e => setField(key, e.target.value)}
                  onBlur={key === 'backDesc1' ? (e) => handleBackDesc1Blur(e.target.value) : undefined}
                  onKeyDown={key === 'backDesc3' ? (e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      setTimeout(() => itemCodeRef.current?.focus(), 20);
                    }
                  } : undefined}
                  style={inputStyle('100%')} />
              </div>
            ))}
            {/* ── Contract button ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, position: 'relative' }}>
              <label style={fieldLabel}>&nbsp;</label>
              <button title={requiresContract ? 'Contract — Item นี้กำหนด SPI-1 = CT ต้องผูกสัญญา' : 'Contract'}
                style={{ height: '30px', width: '56px', borderRadius: '6px', border: requiresContract ? '1px solid #e67e22' : '0.5px solid #c5d8f0', background: requiresContract ? '#FFF3E0' : '#eef4fb', color: requiresContract ? '#a35a00' : '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}
                onClick={() => setShowContractPopup(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
                {requiresContract && (
                  <span style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#e67e22', color: 'white', fontSize: '8px', fontWeight: '700', borderRadius: '8px', padding: '1px 4px', lineHeight: '1.2' }}>CT</span>
                )}
              </button>
            </div>
          </div>

          {/* ✅ Invoice lines table */}
          <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                <colgroup>{[3,7,9,5,18,9,9,11,8,8,9,4].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['H/L','Item Code','Amount','Tax','Description','Tax Code','Wht Code','Account','Vat Amount','Wht Amount','Total',''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <React.Fragment key={idx}>
                    <tr>
                      {[['hl','hl'],['itemCode','text'],['amount','text'],['tax','text'],['desc','text'],['taxCode','text'],['whtCode','text'],['account','text'],['vat','text'],['wht','text'],['total','text']].map(([key, type]) => (
                        <td key={key} style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>
                          {key === 'hl' ? (
                            idx === 0 ? (
                              <div style={{ width: '100%', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', border: '0.5px solid #e8e8e8', borderRadius: '5px', background: '#f5f5f5', color: '#888', boxSizing: 'border-box' }}>{line.hl}</div>
                            ) : (
                              <input type="text" value={line.hl} onChange={e => setLineField(idx, 'hl', e.target.value.slice(0,1).toUpperCase())} maxLength={1}
                                style={{ width: '100%', height: '28px', padding: '0 4px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', textAlign: 'center' }} />
                            )
                          ) : key === 'itemCode' ? (
                            <div style={{ position: 'relative' }}>
                              <input type="text" maxLength={8}
                                ref={el => { lineItemCodeRefs.current[idx] = el; if (idx === 0) itemCodeRef.current = el; }}
                                value={line[key]}
                                onFocus={() => setActiveLineIdx(idx)}
                                onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); idx === 0 ? setLine1Field(key, v) : setLineField(idx, key, v); }}
                                onBlur={e => {
                                  // auto-pad: "787" → "C0000787" (กรอกตัวเลข 1-7 หลัก ไม่มีตัวอักษรปน)
                                  const raw = e.target.value.trim();
                                  if (raw && /^\d{1,7}$/.test(raw)) {
                                    const padded = 'C' + raw.padStart(7, '0');
                                    idx === 0 ? setLine1Field(key, padded) : setLineField(idx, key, padded);
                                  }
                                }}
                                style={{ width: '100%', height: '28px', padding: '0 24px 0 6px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box' }} />
                              <button type="button" title="Search item code" onClick={() => { setActiveLineIdx(idx); setShowItemCodePopup(true); }}
                                style={{ position: 'absolute', right: 0, top: 0, height: '28px', width: '22px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                              </button>
                            </div>
                          ) : key === 'tax' ? (
                            <div style={{ position: 'relative' }}>
                              <input
                                type="text" value={line[key]}
                                onChange={e => { const v = e.target.value.toUpperCase(); idx === 0 ? setLine1Field(key, v) : setLineField(idx, key, v); }}
                                onFocus={() => setTaxDropdownIdx(idx)}
                                onBlur={() => setTimeout(() => setTaxDropdownIdx(null), 120)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const l = lines[idx];
                                    if (l.itemCode?.trim() && l.amount?.trim() && l.desc?.trim() && l.account?.trim()) addLineAndFocus();
                                  }
                                }}
                                style={{ width: '100%', height: '28px', padding: '0 6px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box' }} />
                              {taxDropdownIdx === idx && (
                                <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, width: '50px', minWidth: '50px', zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '5px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', maxHeight: '170px', maxWidth: '50px', overflowY: 'auto' }}>
                                  {TAX_TYPE_OPTS.map(o => (
                                    <div key={o}
                                      onMouseDown={(e) => { e.preventDefault(); idx === 0 ? setLine1Field('tax', o) : setLineField(idx, 'tax', o); setTaxDropdownIdx(null); }}
                                      style={{ padding: '4px 8px', fontSize: '11px', color: '#1a3a5c', cursor: 'pointer', background: line[key] === o ? '#eef3fb' : 'white', whiteSpace: 'nowrap' }}
                                      onMouseEnter={e => { e.currentTarget.style.background = '#eef3fb'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = line[key] === o ? '#eef3fb' : 'white'; }}
                                    >{o}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : key === 'amount' ? (
                            <div style={{ position: 'relative', width: '100%' }}>
                              <button type="button"
                                title="Calculator"
                                onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect();
                                  const rawVal = String(lines[idx]?.amount ?? '').replace(/,/g, '') || '0';
                                  setCalcOpen(false);  // ✅ ปิดก่อนเสมอ
                                  setCalcAnchorPos({ top: r.bottom + 4, left: Math.max(0, Math.min(r.left, window.innerWidth - 228)) });
                                  setCalcInitValue(rawVal);
                                  setCalcLineIdx(idx);
                                  requestAnimationFrame(() => setCalcOpen(true));  // ✅ เปิดใหม่รอบถัดไป
                                }}
                                style={{ position:'absolute', left:0, top:0, height:'28px', width:'24px', background:'transparent', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#aaa', zIndex:1 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>
                              </button>
                              <input
                                type="text" inputMode="decimal" value={line[key]}
                                ref={el => { lineAmountRefs.current[idx] = el; if (idx === 0) amountRef.current = el; }}
                                onChange={e => { handleMoneyChange(idx, key, e.target.value); }}
                                onFocus={() => handleMoneyFocus(idx, key, line[key])}
                                onBlur={() => handleMoneyBlur(idx, key, line[key])}
                                onKeyDown={e => { if (e.key === 'Enter') { const l = lines[idx]; if (l.itemCode?.trim() && l.amount?.trim() && l.desc?.trim() && l.account?.trim()) addLineAndFocus(); } }}
                                style={{ width: '100%', height: '28px', padding: '0 6px 0 26px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', textAlign: 'right' }} />
                            </div>
                          ) : (
                          <input
                              type="text" inputMode={MONEY_FIELDS.includes(key) ? 'decimal' : 'text'} value={line[key]}
                              ref={key === 'amount' ? (el => { lineAmountRefs.current[idx] = el; if (idx === 0) amountRef.current = el; }) : undefined}
                              onChange={e => { const v = e.target.value; MONEY_FIELDS.includes(key) ? handleMoneyChange(idx, key, v) : (idx === 0 ? setLine1Field(key, v) : setLineField(idx, key, v)); }}
                              onFocus={MONEY_FIELDS.includes(key) ? () => handleMoneyFocus(idx, key, line[key]) : undefined}
                              onBlur={MONEY_FIELDS.includes(key) ? () => handleMoneyBlur(idx, key, line[key]) : undefined}
                              onKeyDown={['total','amount','desc'].includes(key) ? (e) => {
                                if (e.key === 'Enter') {
                                  const l = lines[idx];
                                  if (l.itemCode?.trim() && l.amount?.trim() && l.desc?.trim() && l.account?.trim()) addLineAndFocus();
                                }
                              } : undefined}
                              style={{ width: '100%', height: '28px', padding: '0 6px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: key === 'wht' && line[key] ? '#A32D2D' : '#1a3a5c', boxSizing: 'border-box', textAlign: MONEY_FIELDS.includes(key) ? 'right' : 'left' }} />
                          )}
                        </td>
                      ))}
                      {/* ── คอลัมน์ Real Vendor + Delete ── */}
                      <td style={{ padding: '4px 2px 4px 0', borderBottom: '0.5px solid #f0f0f0', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px' }}>
                          <button
                            title="Real Vendor"
                            onClick={() => {
                              if (line.hl !== 'H') {
                                idx === 0 ? setLine1Field('hl', 'H') : setLineField(idx, 'hl', 'H');
                              }
                              setRealVendorLineIdx(idx);
                              setShowRealVendorPopup(true);
                            }}
                            style={{
                              height: '26px', width: '26px', borderRadius: '6px',
                              border: line.realVendorName ? '1px solid #97C459' : '0.5px solid #c5d8f0',
                              background: line.realVendorName ? '#EAF3DE' : '#eef4fb',
                              color: line.realVendorName ? '#27500A' : '#1a3a5c',
                              cursor: (realVendorLineIdx >= 0 && realVendorLineIdx !== idx) ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              opacity: (realVendorLineIdx >= 0 && realVendorLineIdx !== idx) ? 0.35 : 1,
                              pointerEvents: (realVendorLineIdx >= 0 && realVendorLineIdx !== idx) ? 'none' : 'auto',
                              flexShrink: 0,
                            }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          </button>
                          <button
                            title="Delete row"
                            disabled={lines.length <= 1}
                            onClick={() => {
                              if (lines.length <= 1) return;
                              setLines(prev => {
                                const next = prev.filter((_, i) => i !== idx);
                                if (idx === 0 && next.length > 0) {
                                  next[0] = { ...next[0], hl: 'H' };
                                }
                                return next;
                              });
                              if (realVendorLineIdx === idx) setRealVendorLineIdx(-1);
                            }}
                            style={{
                              height: '26px', width: '26px', borderRadius: '6px',
                              border: lines.length <= 1 ? '0.5px solid #e8eaf0' : '0.5px solid #f7c1c1',
                              background: lines.length <= 1 ? '#f5f5f5' : '#FCEBEB',
                              color: lines.length <= 1 ? '#ccc' : '#791F1F',
                              cursor: lines.length <= 1 ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* sub-row Real Vendor */}
                    {line.realVendorName && (
                      <tr style={{ background: '#f0faf5' }}>
                        <td colSpan={12} style={{ padding: 0, borderBottom: '0.5px solid #97C459' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 2fr 1.2fr 0.5fr 0.8fr auto', gap: '8px', alignItems: 'end', padding: '6px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>Real Tax Invoice No.</span>
                              <input type="text" value={line.realInvoiceNo || ''}
                                ref={el => lineRealInvoiceRefs.current[idx] = el}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realInvoiceNo', v) : setLineField(idx, 'realInvoiceNo', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>Tax Invoice Date</span>
                              <input type="date" value={line.realVendorTaxDate || ''}
                                onKeyDown={e => {
                                if (e.key === 'Tab' && line.realInvoiceNo?.trim()) {
                                  const itemCodeVrv = line.itemCode?.trim();
                                  const itemDataVrv = itemcodeItems.find(i => String(i.code ?? '').trim().toUpperCase() === itemCodeVrv?.toUpperCase());
                                  const isVRV = String(itemDataVrv?.value ?? '').trim().toUpperCase() === 'V-RV';
                                  if (isVRV) {
                                    e.preventDefault();
                                    const vatNum = parseFloat(String(line.vat || '0').replace(/,/g, '')) || 0;
                                    const negAmount = -(Math.round(vatNum * 100 / 7 * 100) / 100);
                                    const negFormatted = negAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    const mapping = VRV_MAPPING[line.itemCode] || {};
                                    setLines(prev => {
                                      const next = [...prev, {
                                        hl: 'H',
                                        itemCode: mapping.h || '',
                                        amount: negFormatted,
                                        tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: ''
                                      }, {
                                        hl: 'L',
                                        itemCode: mapping.l || '',
                                        amount: '',
                                        tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: ''
                                      }];
                                      const newIdx = next.length - 1;
                                      setTimeout(() => lineAmountRefs.current[newIdx]?.focus(), 30);
                                      return next;
                                    });
                                  }
                                }
                                }}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realVendorTaxDate', v) : setLineField(idx, 'realVendorTaxDate', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>Company Name</span>
                              <input type="text" value={line.realVendorName || ''}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realVendorName', v) : setLineField(idx, 'realVendorName', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>Tax ID</span>
                              <input type="text" value={line.realVendorTaxid || ''}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realVendorTaxid', v) : setLineField(idx, 'realVendorTaxid', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>Branch</span>
                              <input type="text" value={line.realVendorBranch || ''}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realVendorBranch', v) : setLineField(idx, 'realVendorBranch', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: '#999' }}>GRN</span>
                              <input type="text" value={line.realGrn || ''}
                                onChange={e => { const v = e.target.value; idx === 0 ? setLine1Field('realGrn', v) : setLineField(idx, 'realGrn', v); }}
                                style={{ height: '26px', padding: '0 8px', fontSize: '11px', border: '0.5px solid #97C459', borderRadius: '5px', background: 'white', color: '#1a3a5c', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span style={{ fontSize: '10px', color: 'transparent' }}>_</span>
                              <button
                                onClick={() => {
                                  const clear = { realVendorCode: '', realVendorName: '', realVendorTaxid: '', realVendorBranch: '', realInvoiceNo: '', realVendorTaxDate: '', realGrn: '', isVat: '' };
                                  if (idx === 0) { Object.entries(clear).forEach(([k, v]) => setLine1Field(k, v)); }
                                  else { setLines(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...clear }; return next; }); }
                                  setRealVendorLineIdx(-1);
                                }}
                                style={{ width: '26px', height: '26px', borderRadius: '50%', border: '0.5px solid #e8eaf0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                title="ล้างค่า">×</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <CalcPopup
          show={calcOpen}
          anchorPos={calcAnchorPos}
          initValue={calcInitValue}
          onApply={(val) => {
            const num = parseFloat(String(val).replace(/,/g, '')) || 0;
            const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (calcLineIdx === 0) setLine1Field('amount', formatted);
            else setLineField(calcLineIdx, 'amount', formatted);
          }}
          onClose={() => setCalcOpen(false)}
        />
        <RealVendorPopup
          show={showRealVendorPopup}
          onClose={() => { setShowRealVendorPopup(false); }}
          fetchCollection={fetchCollection}
          vendorTaxId={vendorInfo?.['Tax ID'] || ''}
          onSelect={({ vendor, realInvoiceNo, taxInvoiceDate }) => {
            const taxCode0 = String(lines[realVendorLineIdx]?.taxCode || '');
            const isVatBool = taxCode0.includes('VAT7%') && !taxCode0.includes('SVAT7%');
            const isVat = isVatBool ? 'Yes' : 'No';
            const lineHl = lines[realVendorLineIdx]?.hl || 'L';
            // Auto GRN: ใช้ grnPreview prop ที่ส่งมาจาก InvoiceEntry
            const autoGrn = (isVatBool && lineHl === 'H' && isAutoGrt) ? grnPreview : '';
            const rv = {
              realVendorCode:   vendor['SM-Code'] || '',
              realVendorName:   vendor['Company Name'] || '',
              realVendorTaxid:  vendor['Tax ID'] || '',
              realVendorBranch: vendor['Branch'] || '',
              realInvoiceNo:    realInvoiceNo || '',
              realVendorTaxDate: taxInvoiceDate || '',
              realGrn:          autoGrn,
              isVat,
            };
            if (realVendorLineIdx === 0) {
              Object.entries(rv).forEach(([k, v]) => setLine1Field(k, v));
              // ── sync เข้า form ด้วย ให้ Real vendor card (header) อัปเดตทันที ไม่ต้องรอ save แล้วเปิดใหม่ ──
              setField('realVendorName', rv.realVendorName);
              setField('realVendorTaxid', rv.realVendorTaxid);
              setField('realVendorBranch', rv.realVendorBranch);
              setField('realInvoiceNo', rv.realInvoiceNo);
              setField('realVendorTaxDate', rv.realVendorTaxDate);
            } else {
              setLines(prev => {
                const next = [...prev];
                next[realVendorLineIdx] = { ...next[realVendorLineIdx], ...rv };
                return next;
              });
            }
            setShowRealVendorPopup(false);
          
          }}
          smCodeItems={smCodeItems}
          categoryItems={categoryItems}
          branchItems={branchItems}
          userName={userName}
        />
        <ContractPopup
          show={showContractPopup}
          onClose={() => setShowContractPopup(false)}
          onSelect={handleSelectContract}
          vendorCode={form?.supplierCode || ''}
          bu={bu}
          fetchCollection={fetchCollection}
          userName={userName}
        />
        <ItemCodeSearchPopup
          show={showItemCodePopup} onClose={() => setShowItemCodePopup(false)}
          onSelect={(item) => {
            if (activeLineIdx === 0) { setLine1Field('itemCode', item.code || ''); }
            else { setLineField(activeLineIdx, 'itemCode', item.code || ''); }
            setShowItemCodePopup(false);
            setTimeout(() => lineAmountRefs.current[activeLineIdx]?.focus(), 50);
          }}
          itemcodeItems={itemcodeItems} fetchCollection={fetchCollection} userName={userName} currentUser={currentUser} bu={bu}
          vendorTaxId={vendorInfo?.['Tax ID'] || ''}
        />

        {/* ── Footer: summary + Close ── */}
        {(() => {
          const totalVat = lines.reduce((s, l) => s + (parseFloat(String(l.vat).replace(/,/g,'')) || 0), 0);
          const totalWht = lines.reduce((s, l) => s + (parseFloat(String(l.wht).replace(/,/g,'')) || 0), 0);
          const totalNet = lines.reduce((s, l) => s + (parseFloat(String(l.total).replace(/,/g,'')) || 0), 0);
          const fmt2 = (n) => n === 0 ? '0.00' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
            <div style={{ borderTop: '1px solid #f0f2f5', display: 'flex', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
              <div style={{ padding: isMobile ? '8px 14px' : '8px 22px', flexShrink: 0 }}>
                <button onClick={handleSubmit} title="Submit (Ctrl+Enter)" style={{ padding: '6px 18px', borderRadius: '7px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Submit
                  <span style={{ fontSize: '10px', opacity: 0.7, background: 'rgba(255,255,255,0.15)', borderRadius: '4px', padding: '1px 5px', fontFamily: 'monospace' }}>Ctrl+↵</span>
                </button>
              </div>
              <div style={{ flex: 1 }} />
              {/* ── Clear form button — dark red, same size as Submit, gap 5px from VAT block ── */}
              <button
                onClick={() => {
                  setLines([{ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }]);
                }}
                style={{ alignSelf: 'center', marginRight: '5px', padding: '6px 18px', borderRadius: '7px', border: 'none', background: '#7B1A1A', color: 'white', fontSize: '12px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                🗑 Clear
              </button>
              <div style={{ display: 'flex', borderLeft: '0.5px solid #f0f2f5' }}>
                {[['VAT', fmt2(totalVat), false], ['WHT', fmt2(totalWht), totalWht < 0], ['NET TOTAL', fmt2(totalNet), false]].map(([label, val, isDanger], i, arr) => (
                  <div key={label} style={{ padding: '8px 24px', borderRight: i < arr.length - 1 ? '0.5px solid #f0f2f5' : 'none', textAlign: 'right', minWidth: '100px' }}>
                    <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontSize: i === arr.length - 1 ? '14px' : '13px', fontWeight: '500', color: isDanger ? '#A32D2D' : '#1a3a5c' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BucketItemPopup — View / Edit ของรายการใน Batch Bucket
// ─────────────────────────────────────────────────────────────────────────────
function BucketItemPopup({ show, onClose, invoice, mode = 'view', itemcodeItems = [], supplierItems = [], vendorRuleItems = [], bu = '', fetchCollection, userName = '', currentUser, onSave }) {
  const isView = mode === 'view';
  const emptyLine = () => ({ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' });

  const [form, setForm]     = useState({});
  const [lines, setLines]   = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [showItemCodePopup, setShowItemCodePopup] = useState(false);
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [taxDropdownIdx, setTaxDropdownIdx] = useState(null);

  useEffect(() => {
    if (show && invoice) {
      const fd = { ...(invoice.form_data || {}) };
      const ls = (invoice.lines && invoice.lines.length) ? invoice.lines.map(l => ({ ...l })) : [emptyLine()];
      // ── sync GRN จาก realGrn ที่มีอยู่แล้วในบาง line มาเติม form.grn ──
      // ── ถ้า form.grn ว่างเปล่า (ไม่สร้างเลขใหม่ ใช้ค่าที่มีอยู่แล้วเท่านั้น) ──
      if (!fd.grn) {
        const lineWithGrn = ls.find(l => String(l.realGrn || '').trim() !== '');
        if (lineWithGrn) fd.grn = lineWithGrn.realGrn;
      }
      setForm(fd);
      setLines(ls);
    }
  }, [show, invoice]);

  const vendorInfo = supplierItems.find(s => {
    const code = String(s['Code'] ?? '').trim().toLowerCase();
    const sup  = String(form.supplierCode ?? '').trim().toLowerCase();
    return code === sup || code === `${(bu || '').toLowerCase()}-${sup}`;
  });

  const matchedRule = (() => {
    if (!vendorInfo?.['Notice']) return null;
    const notices = vendorInfo['Notice'].split('|').map(n => n.trim()).filter(Boolean);
    for (const notice of notices) {
      const rule = (vendorRuleItems || []).find(r => String(r['item'] ?? '').trim().toLowerCase() === notice.toLowerCase());
      if (rule) return rule;
    }
    return null;
  })();

  const derivedIsVat = lines.some(l => {
    const tc = String(l.taxCode || '');
    return tc.includes('VAT7%') && !tc.includes('SVAT7%');
  }) ? 'Yes' : lines.some(l => String(l.taxCode || '').includes('SVAT7%')) ? 'SVAT' : 'No';

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setLineField = (idx, key, val) => setLines(prev => { const next = [...prev]; next[idx] = { ...next[idx], [key]: val }; return next; });
  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (idx) => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const MONEY_FIELDS = ['amount', 'vat', 'wht', 'total'];
  const handleMoneyChange = (idx, key, val) => { let v = val.replace(/[^0-9.-]/g, ''); const fd = v.indexOf('.'); if (fd !== -1) v = v.slice(0, fd + 1) + v.slice(fd + 1).replace(/\./g, ''); setLineField(idx, key, v); };
  const handleMoneyBlur = (idx, key, val) => {
    if (val === '' || val === '.') { setLineField(idx, key, ''); return; }
    if (key === 'amount') {
      const itemCode = lines[idx]?.itemCode?.trim();
      const itemData = itemcodeItems.find(i => String(i.code ?? '').trim().toUpperCase() === itemCode?.toUpperCase());
      const isVRV = String(itemData?.value ?? '').trim().toUpperCase() === 'V-RV';
      if (isVRV) {
        const vatAmount = parseFloat(val) || 0;
        const amountExVat = Math.round(vatAmount * 100 / 7 * 100) / 100;
        const taxCode0 = lines[idx]?.taxCode || '';
        const isVatLine = taxCode0.includes('VAT7%') && !taxCode0.includes('SVAT7%');
        const autoGrn = '';
        setLines(prev => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            hl: 'H', 
            amount: amountExVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            realVendorName: 'กรมศุลกากร',
            realVendorTaxid: '0',
            realVendorBranch: '0',
            realInvoiceNo: '',
            realVendorCode: '',
            realGrn: autoGrn,
            isVat: isVatLine ? 'Yes' : 'No',
          };
          return next;
        });
        return;
      }
    }
    const num = Math.round(parseFloat(val) * 100) / 100;
    setLineField(idx, key, num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };
  const handleMoneyFocus = (idx, key, val) => { setLineField(idx, key, val.replace(/,/g, '')); };

  // recalc ทุกครั้งที่ itemCode/amount/tax/header เปลี่ยน (เฉพาะตอน edit)
  useEffect(() => {
    if (isView) return;
    setLines(prev => recalcLines(prev, itemcodeItems, vendorInfo, form));
  }, [
    lines.map(l => l.itemCode).join(','),
    lines.map(l => l.amount).join(','),
    lines.map(l => l.tax).join(','),
    form.period, form.invTax, form.backDesc1, form.backDesc2, form.backDesc3,
    form.branchNo, form.branchDirectLabel, form.branchIBLabel,
  ]);

  if (!show || !invoice) return null;

  const inputStyle = (w, disabled) => ({ height: '28px', padding: '0 8px', fontSize: '11px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: disabled ? '#f5f5f5' : 'white', color: disabled ? '#999' : '#1a3a5c', boxSizing: 'border-box', width: w || '100%' });

  const handleSave = async () => {
    if (!lines[0]?.itemCode?.trim() || !lines[0]?.amount?.trim()) { alert('กรุณากรอก Item Code และ Amount อย่างน้อย 1 บรรทัด'); return; }
    setSaving(true);
    const invoiceNo = buildInvoiceNumber(form.invoiceNum, form.invDate, vendorInfo) + (form.invoiceSuffix || '');
    const ok = await onSave({ form_data: form, lines, invoiceNo });
    setSaving(false);
    if (ok) onClose();
  };

  const totalVat = lines.reduce((s, l) => s + (parseFloat(String(l.vat).replace(/,/g, '')) || 0), 0);
  const totalWht = lines.reduce((s, l) => s + (parseFloat(String(l.wht).replace(/,/g, '')) || 0), 0);
  const totalNet = lines.reduce((s, l) => s + (parseFloat(String(l.total).replace(/,/g, '')) || 0), 0);
  const fmtMoney = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500, backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', width: '98vw', maxWidth: '1400px', height: '92vh', borderRadius: '14px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>

        <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: isView ? '#1a3a5c' : '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{isView ? '👁' : '✏️'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>{isView ? 'View Invoice' : 'Edit Invoice'}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Supplier: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.supplierCode || '-'}</span>
              {' · '}Invoice no.: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{(buildInvoiceNumber(form?.invoiceNum, form?.invDate, vendorInfo) || '-') + (form?.invoiceSuffix || '')}</span>
              {' · '}Branch: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.branchNo || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', padding: '18px 22px', display: 'flex', flexDirection: 'column' }}>

          {/* Vendor + Document */}
          <div style={{ display: 'flex', gap: '2%', marginBottom: '14px', flexShrink: 0 }}>
            <div style={{ ...card, width: '49%', marginBottom: 0 }}>
              <div style={cardHead}><span style={{ fontSize: '12px', fontWeight: '600', color: '#1a3a5c' }}>{vendorInfo?.['Supplier Name'] || form.supplierCode || '—'}</span></div>
              <div style={{ ...cardBody, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[['Vendor Code', vendorInfo?.['Supplier Number']], ['Vendor Site', vendorInfo?.['Supplier Site']], ['Tax ID', vendorInfo?.['Tax ID']], ['No.', vendorInfo?.['No.']]].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', gap: '6px' }}><span style={{ fontSize: '11px', color: '#999', width: '72px', flexShrink: 0 }}>{label}</span><span style={{ fontSize: '12px', color: val ? '#1a3a5c' : '#ccc' }}>{val || '—'}</span></div>
                ))}
              </div>
            </div>
            <div style={{ ...card, width: '49%', marginBottom: 0 }}>
              <div style={cardHead}><span style={cardLabel}>Document Number</span></div>
              <div style={{ ...cardBody, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[['GRT', form.grtNum], ['GRN', form.grn], ['Branch Direct', form.branchDirectLabel], ['Branch IB', form.branchIBLabel && form.branchIBLabel !== '-' ? form.branchIBLabel : '']].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', gap: '6px' }}><span style={{ fontSize: '11px', color: '#999', width: '88px', flexShrink: 0 }}>{label}</span><span style={{ fontSize: '12px', color: val ? '#1a3a5c' : '#ccc', fontFamily: 'monospace' }}>{val || '—'}</span></div>
                ))}
              </div>
              <div style={{ borderTop: '0.5px solid #e8eaf0', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {[['Method', matchedRule?.Method], ['Paygroup', matchedRule?.Paygroup], ['Par', matchedRule?.Par]].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1 }}>
                    <span style={{ fontSize: '11px', color: '#999' }}>{label}</span>
                    <span style={{ fontSize: '12px', fontWeight: '500', color: val ? '#1a3a5c' : '#ccc' }}>{val || '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1 }}>
                  <span style={{ fontSize: '11px', color: '#999' }}>Due Date</span>
                  <input type="date" value={form.dueDate || ''} disabled={isView} onChange={e => setField('dueDate', e.target.value)}
                    style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', border: 'none', outline: 'none', background: 'transparent', padding: 0, width: '112px', cursor: isView ? 'default' : 'pointer' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Real vendor card */}
          {(form.realVendorName || form.realVendorTaxid || form.realInvoiceNo) && (
            <div style={{ background: '#EAF3DE', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', flexShrink: 0 }}>
              <div style={{ fontSize: '11px', color: '#27500A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '600' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Real vendor
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '11px', color: '#27500A', opacity: 0.8 }}>Company name</label>
                  <input type="text" value={form.realVendorName || ''} disabled={isView} onChange={e => setField('realVendorName', e.target.value)} style={inputStyle('100%', isView)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '11px', color: '#27500A', opacity: 0.8 }}>Tax ID</label>
                  <input type="text" value={form.realVendorTaxid || ''} disabled={isView} onChange={e => setField('realVendorTaxid', e.target.value)} style={inputStyle('100%', isView)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '11px', color: '#27500A', opacity: 0.8 }}>Branch</label>
                  <input type="text" value={form.realVendorBranch || ''} disabled={isView} onChange={e => setField('realVendorBranch', e.target.value)} style={inputStyle('100%', isView)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '11px', color: '#27500A', opacity: 0.8 }}>Real invoice no.</label>
                  <input type="text" value={form.realInvoiceNo || ''} disabled={isView} onChange={e => setField('realInvoiceNo', e.target.value)} style={inputStyle('100%', isView)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '11px', color: '#27500A', opacity: 0.8 }}>Tax Invoice Date</label>
                  <input type="date" value={form.realVendorTaxDate || ''} disabled={isView} onChange={e => setField('realVendorTaxDate', e.target.value)} style={inputStyle('100%', isView)} />
                </div>
              </div>
            </div>
          )}

          {/* Editable header fields */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', alignItems: 'flex-end', marginBottom: '14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 110px' }}>
              <label style={fieldLabel}>Inv date</label>
              <input type="date" value={form.invDate || ''} disabled={isView} onChange={e => setField('invDate', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 130px' }}>
              <label style={fieldLabel}>Invoice num</label>
              <input type="text" value={form.invoiceNum || ''} disabled={isView} onChange={e => setField('invoiceNum', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 90px' }}>
              <label style={fieldLabel}>GRT</label>
              <input type="text" value={form.grtNum || ''} disabled={isView} onChange={e => setField('grtNum', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 90px' }}>
              <label style={fieldLabel}>GRN</label>
              <input type="text" value={form.grn || ''} disabled={isView} onChange={e => setField('grn', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 60px' }}>
              <label style={fieldLabel}>Tax</label>
              <input type="text" value={form.invTax || ''} disabled={isView} onChange={e => setField('invTax', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 120px' }}>
              <label style={fieldLabel}>Period</label>
              <input type="text" value={form.period || ''} disabled={isView} onChange={e => setField('period', e.target.value)} style={inputStyle('100%', isView)} />
            </div>
            {[['Back Description 1','backDesc1'],['Back Description 2','backDesc2'],['Back Description 3','backDesc3']].map(([label, key]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 120px' }}>
                <label style={fieldLabel}>{label}</label>
                <input type="text" value={form[key] || ''} disabled={isView} onChange={e => setField(key, e.target.value)} style={inputStyle('100%', isView)} />
              </div>
            ))}
            {derivedIsVat && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 60px' }}>
                <label style={fieldLabel}>VAT</label>
                <div style={{ height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', fontSize: '11px', fontWeight: '600', background: derivedIsVat === 'Yes' ? '#EAF3DE' : '#f0f0f0', color: derivedIsVat === 'Yes' ? '#27500A' : '#888', border: '0.5px solid #e8eaf0' }}>{derivedIsVat}</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '0 0 36px' }}>
              <label style={{ ...fieldLabel, color: 'transparent' }}>_</label>
              <button title="Contract" disabled={isView}
                style={{ height: '28px', width: '36px', borderRadius: '6px', border: '0.5px solid #c5d8f0', background: isView ? '#f5f5f5' : '#eef4fb', color: isView ? '#ccc' : '#1a3a5c', cursor: isView ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Lines table */}
          <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                <colgroup>{(isView ? [3,7,9,5,21,10,9,12,8,8,8] : [3,7,9,5,19,10,9,11,8,8,8,4]).map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['H/L','Item Code','Amount','Tax','Description','Tax Code','Wht Code','Account','Vat Amount','Wht Amount','Total', ...(isView ? [] : [''])].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      {[['hl'],['itemCode'],['amount'],['tax'],['desc'],['taxCode'],['whtCode'],['account'],['vat'],['wht'],['total']].map(([key]) => (
                        <td key={key} style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>
                          {key === 'hl' ? (
                            <input type="text" value={line.hl} disabled={isView} maxLength={1} onChange={e => setLineField(idx, 'hl', e.target.value.slice(0,1).toUpperCase())}
                              style={{ ...inputStyle('100%', isView), textAlign: 'center' }} />
                          ) : key === 'itemCode' ? (
                            <div style={{ position: 'relative' }}>
                              <input type="text" maxLength={8} value={line[key]} disabled={isView}
                                onChange={e => setLineField(idx, key, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                                style={{ ...inputStyle('100%', isView), paddingRight: isView ? '8px' : '24px' }} />
                              {!isView && (
                                <button type="button" onClick={() => { setActiveLineIdx(idx); setShowItemCodePopup(true); }}
                                  style={{ position: 'absolute', right: 0, top: 0, height: '28px', width: '22px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                                </button>
                              )}
                            </div>
                          ) : key === 'tax' ? (
                            <div style={{ position: 'relative' }}>
                              <input type="text" value={line[key]} disabled={isView}
                                onChange={e => setLineField(idx, 'tax', e.target.value.toUpperCase())}
                                onFocus={() => !isView && setTaxDropdownIdx(idx)}
                                onBlur={() => setTimeout(() => setTaxDropdownIdx(null), 120)}
                                style={inputStyle('100%', isView)} />
                              {taxDropdownIdx === idx && (
                                <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, zIndex: 9999, background: 'white', border: '0.5px solid #ddd', borderRadius: '5px', boxShadow: '0 4px 12px rgba(26,58,92,0.15)', minWidth: '100%', maxHeight: '170px', overflowY: 'auto' }}>
                                  {TAX_TYPE_OPTS.map(o => (
                                    <div key={o} onMouseDown={(e) => { e.preventDefault(); setLineField(idx, 'tax', o); setTaxDropdownIdx(null); }}
                                      style={{ padding: '4px 8px', fontSize: '11px', color: '#1a3a5c', cursor: 'pointer', background: line[key] === o ? '#eef3fb' : 'white', whiteSpace: 'nowrap' }}>{o}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <input type="text" inputMode={MONEY_FIELDS.includes(key) ? 'decimal' : 'text'} value={line[key]} disabled={isView}
                              onChange={e => { const v = e.target.value; MONEY_FIELDS.includes(key) ? handleMoneyChange(idx, key, v) : setLineField(idx, key, v); }}
                              onFocus={MONEY_FIELDS.includes(key) ? () => handleMoneyFocus(idx, key, line[key]) : undefined}
                              onBlur={MONEY_FIELDS.includes(key) ? () => handleMoneyBlur(idx, key, line[key]) : undefined}
                              style={{ ...inputStyle('100%', isView), color: key === 'wht' && line[key] ? '#A32D2D' : (isView ? '#999' : '#1a3a5c'), textAlign: MONEY_FIELDS.includes(key) ? 'right' : 'left' }} />
                          )}
                        </td>
                      ))}
                      {!isView && (
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center' }}>
                          <button onClick={() => removeLine(idx)} disabled={lines.length <= 1}
                            style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #f7c1c1', background: lines.length <= 1 ? '#f5f5f5' : '#FCEBEB', color: lines.length <= 1 ? '#ccc' : '#791F1F', cursor: lines.length <= 1 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isView && (
              <div style={{ padding: '8px 10px', borderTop: '0.5px solid #f0f0f0' }}>
                <button onClick={addLine} style={{ ...btnOutline, fontSize: '11px' }}>+ Add line</button>
              </div>
            )}
          </div>
        </div>

        {!isView && (
          <ItemCodeSearchPopup
            show={showItemCodePopup} onClose={() => setShowItemCodePopup(false)}
            onSelect={(item) => { setLineField(activeLineIdx, 'itemCode', item.code || ''); setShowItemCodePopup(false); }}
            itemcodeItems={itemcodeItems} fetchCollection={fetchCollection} userName={userName} currentUser={currentUser} bu={bu}
          />
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #f0f2f5', display: 'flex', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          <div style={{ padding: '8px 22px' }}>
            {isView ? (
              <button onClick={onClose} style={btnOutline}>Close</button>
            ) : (
              <button onClick={handleSave} disabled={saving} style={{ padding: '6px 18px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', cursor: saving ? 'default' : 'pointer', fontWeight: '500' }}>{saving ? 'Saving...' : '💾 Save'}</button>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {/* ── Clear form button — Ctrl+Del shortcut ── */}
          <button
            onClick={() => {
            setLines([{ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' }]);
            setField('invDate',    '');
            setField('invoiceNum', '');
            setField('invTax',     '');
            setField('grtNum',     '');
            setField('grn',        '');
            setField('period',     '');
            setField('backDesc1',  '');
            setField('backDesc2',  '');
            setField('backDesc3',  '');
            }}
            title="Clear form (Ctrl+Delete)"
            style={{ alignSelf: 'center', marginRight: '5px', padding: '6px 18px', borderRadius: '7px', border: 'none', background: '#7B1A1A', color: 'white', fontSize: '12px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            🗑 Clear
            <span style={{ fontSize: '10px', opacity: 0.7, background: 'rgba(255,255,255,0.15)', borderRadius: '4px', padding: '1px 5px', fontFamily: 'monospace' }}>Ctrl+Del</span>
          </button>
          <div style={{ display: 'flex', borderLeft: '0.5px solid #f0f2f5' }}>
            {[['VAT', fmtMoney(totalVat), false], ['WHT', fmtMoney(totalWht), totalWht < 0], ['NET TOTAL', fmtMoney(totalNet), false]].map(([label, val, isDanger], i, arr) => (
              <div key={label} style={{ padding: '8px 24px', borderRight: i < arr.length - 1 ? '0.5px solid #f0f2f5' : 'none', textAlign: 'right', minWidth: '100px' }}>
                <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: i === arr.length - 1 ? '14px' : '13px', fontWeight: '500', color: isDanger ? '#A32D2D' : '#1a3a5c' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers & Shared styles ───────────────────────────────────────────────────
const fmt = (n) => Math.round(n).toLocaleString('th-TH');
const card      = { background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', marginBottom: '10px' };
const cardHead  = { padding: '9px 14px', borderBottom: '0.5px solid #e8eaf0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const cardLabel = { fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' };
const cardBody  = { padding: '12px 14px' };
const fieldWrap  = { display: 'flex', flexDirection: 'column', gap: '3px' };
const fieldLabel = { fontSize: '11px', color: '#888' };
const btnPrimary = { padding: '7px 16px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '5px' };
const btnOutline = { padding: '5px 12px', background: 'white', color: '#555', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' };
const bdgGreen   = { fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: '500', background: '#EAF3DE', color: '#27500A' };

// ── StepBar ───────────────────────────────────────────────────────────────────
function StepBar({ step, onGo }) {
  const steps = [{ n: 1, label: 'Batch setup' }, { n: 2, label: 'Invoice entry' }, { n: 3, label: 'Batch Preview' }];
  return (
    <div style={{ background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '0 18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {steps.map((s, i) => {
        const isDone = s.n < step, isActive = s.n === step;
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
    </div>
  );
}

// ── BuInfoPanel ───────────────────────────────────────────────────────────────
function BuInfoPanel({ buInfo, apGrtRunning, apGrnRunning, grtPrefix, grnPrefix, onApGrtRunningChange, onApGrnRunningChange }) {
  const rows = [['Company name', buInfo?.['THAI COMPANY NAME']], ['Tax ID', buInfo?.['TAX ID']], ['Company code', buInfo?.['COMPANY CODE']], ['Book', buInfo?.['BOOK']], ['Segment3', buInfo?.['SEGMENT3']], ['GRT status', buInfo?.['AP GRT Control']]];
  const infoRowStyle = { display: 'grid', gridTemplateColumns: '110px 1fr' };
  const keyStyle = { fontSize: '11px', color: '#999', padding: '7px 10px', background: '#fafafa', borderRight: '0.5px solid #f0f0f0', display: 'flex', alignItems: 'center' };
  const valStyle = (hasVal) => ({ fontSize: '12px', color: hasVal ? '#1a3a5c' : '#ccc', padding: '7px 10px', background: 'white', display: 'flex', alignItems: 'center', fontStyle: hasVal ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.map(([key, val], i) => (<div key={key} style={{ ...infoRowStyle, borderBottom: i < rows.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}><div style={keyStyle}>{key}</div><div style={valStyle(!!val)} title={val || ''}>{val || '—'}</div></div>))}
      </div>
      <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0', padding: '5px 10px' }}><div style={{ fontSize: '10px', fontWeight: '600', color: '#1a3a5c', letterSpacing: '0.05em', textTransform: 'uppercase' }}>AP</div></div>
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

// ── VendorInfoPanel ───────────────────────────────────────────────────────────
function VendorInfoPanel({ vendorInfo, vendorLoading, matchedRule, branchDirectLabel, branchIBLabel }) {
  const v = vendorLoading ? null : vendorInfo;
  const r = matchedRule;
  const keyStyle = { fontSize: '10px', color: '#999', width: '72px', flexShrink: 0 };
  const valStyle = (hasVal) => ({ fontSize: '11px', color: hasVal ? '#1a3a5c' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 });
  const rowStyle = { display: 'flex', alignItems: 'center', padding: '4px 8px' };
  const divider  = { borderBottom: '0.5px solid #f0f0f0' };
  return (
    <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
      {vendorLoading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, fontSize: '11px', color: '#888' }}>Loading...</div>}
      <div style={{ background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0', padding: '4px 8px' }}><div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor Info</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', ...divider }}>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={keyStyle}>Vendor Name</span><span style={valStyle(!!v?.['Supplier Name'])} title={v?.['Supplier Name'] || ''}>{v?.['Supplier Name'] || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={keyStyle}>Vendor Code</span><span style={valStyle(!!v?.['Supplier Number'])}>{v?.['Supplier Number'] || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={keyStyle}>Vendor Site</span><span style={valStyle(!!v?.['Supplier Site'])}>{v?.['Supplier Site'] || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={keyStyle}>Tax ID</span><span style={{ ...valStyle(!!v?.['Tax ID']), fontFamily: 'monospace' }}>{v?.['Tax ID'] || '—'}</span></div>
        <div style={rowStyle}><span style={keyStyle}>No.</span><span style={valStyle(!!v?.['No.'])}>{v?.['No.'] || '—'}</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', ...divider }}>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '52px' }}>Method</span><span style={valStyle(!!r?.Method)}>{r?.Method || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '62px' }}>Paygroup</span><span style={valStyle(!!r?.Paygroup)}>{r?.Paygroup || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '26px' }}>Par</span><span style={valStyle(!!r?.Par)}>{r?.Par || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '60px' }}>Tax-Type</span><span style={valStyle(!!v?.['Tax-Type'])}>{v?.['Tax-Type'] || '—'}</span></div>
        <div style={{ ...rowStyle, borderRight: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '52px' }}>Notice</span><span style={valStyle(!!v?.['Notice'])}>{v?.['Notice'] || '—'}</span></div>
        <div style={rowStyle}><span style={{ ...keyStyle, width: '52px' }}>Sub Acc</span><span style={valStyle(!!v?.['Sub Acc'])}>{v?.['Sub Acc'] || '—'}</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ ...rowStyle, alignItems: 'flex-start', borderRight: '0.5px solid #f0f0f0' }}>
          <span style={keyStyle}>Address</span>
          <span style={{ fontSize: '11px', color: v?.['Address'] ? '#1a3a5c' : '#ccc', flex: 1, lineHeight: '1.5', whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={v?.['Address'] || ''}>{v?.['Address'] || '—'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...rowStyle, flex: 1, borderBottom: '0.5px solid #f0f0f0' }}><span style={{ ...keyStyle, width: '88px' }}>Branch Direct</span><span style={valStyle(!!branchDirectLabel)}>{branchDirectLabel || '—'}</span></div>
          <div style={{ ...rowStyle, flex: 1 }}><span style={{ ...keyStyle, width: '88px' }}>Branch IB</span><span style={valStyle(!!branchIBLabel)}>{branchIBLabel || '—'}</span></div>
        </div>
      </div>
    </div>
  );
}

// ── BatchSetup ────────────────────────────────────────────────────────────────
function BatchSetup({ onStart, infoItems = [] }) {
  const today = new Date();
  const pad2  = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
  const [receiveDate, setReceiveDate] = useState(todayStr);

  const isOverride = (val) => val?.ap_period_mode === 'prev';

  // ── คำนวณเดือน Current จาก ap_bu_period_month (Mirror ของ system_settings.ap_period_month) ──
  // ── หมายเหตุ: ap_prev_month เป็นคนละ Field กัน ใช้เฉพาะตอน Override เท่านั้น (ดูใน getPrefix) ──
  const getCurrentMonthStr = (bi) => {
    const periodMonth = bi?.ap_bu_period_month;
    if (!periodMonth) return null;
    const [yy, mm] = periodMonth.split('-').map(Number);
    const d = new Date(yy, mm, 1); // เดือนถัดจาก ap_bu_period_month (M-1) = Current
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  const endOfMonth = (ymStr) => {
    if (!ymStr) return null;
    const [yy, mm] = ymStr.split('-').map(Number);
    const d = new Date(yy, mm, 0);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  // ── คำนวณ Deadline (2 วันทำการหลังสิ้นเดือน Current) — Logic เดียวกับ apPeriod.js ฝั่ง Backend ──
  const getDeadline = (bi) => {
    const periodMonth = bi?.ap_bu_period_month;
    if (!periodMonth) return null;
    const [yy, mm] = periodMonth.split('-').map(Number);
    let d = new Date(yy, mm + 1, 1), cnt = 0, dl = null;
    while (cnt < 2) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) { cnt++; if (cnt === 2) dl = new Date(d); }
      if (cnt < 2) d.setDate(d.getDate() + 1);
    }
    return dl;
  };

  const getPrefix = (type, biArg) => {
    const bi = biArg;
    const override = isOverride(bi);
    const patternKey = type === 'GRT' ? 'ap_grt_pattern' : 'ap_grn_pattern';
    const pattern = bi?.[patternKey] || (type === 'GRT' ? 'Y92MM0' : 'Y91MM0');
    const refMonthStr = override ? bi?.ap_prev_month : getCurrentMonthStr(bi);
    const d = refMonthStr ? new Date(refMonthStr + '-01') : (receiveDate ? new Date(receiveDate) : new Date());
    const y = String(d.getFullYear()).slice(-1), mm = pad2(d.getMonth() + 1);
    return pattern.replace('Y', y).replace('MM', mm);
  };

  const { userName, currentUser } = useAuth();
  const { isOwner, isAdmin }      = useUserRole();
  const [bu, setBu]                     = useState('');
  const [dueDate, setDueDate]           = useState('');
  const [buInfo, setBuInfo]             = useState(null);
  const [showPopup, setShowPopup]       = useState(false);
  const [apGrtRunning, setApGrtRunning] = useState('0000');
  const [apGrnRunning, setApGrnRunning] = useState('0000');

  // ── pre-fill running number ตาม Mode (Current ใช้ ap_grt/ap_grn, Override ใช้ ap_grt_prev/ap_grn_prev) ──
  useEffect(() => {
    if (buInfo) {
      const override = isOverride(buInfo);
      setApGrtRunning(String((override ? buInfo.ap_grt_prev : buInfo.ap_grt) ?? 0).padStart(4, '0'));
      setApGrnRunning(String((override ? buInfo.ap_grn_prev : buInfo.ap_grn) ?? 0).padStart(4, '0'));
    }
  }, [buInfo]);

  // ── กัน Popup Blocked เด้งซ้ำ — ดึงจาก Endpoint เล็กๆ แยก ใช้ได้ทุก User ไม่ต้องมี Permission Manual ──
  const [hasPendingCloseRequest, setHasPendingCloseRequest] = useState(false);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await apiFetch('/ap/period/pending-close');
        setHasPendingCloseRequest(!!r?.hasPendingCloseRequest);
      } catch (e) { console.error('load pending-close:', e); }
    };
    load();
  }, []);

  // ── Force Refresh CompanyList ทันทีที่เปิดหน้านี้ — ไม่พึ่ง Cache TTL เลย ──
  // ── Pattern เดียวกับ BusinessUnit.js/ChartOfAccounts.js เพราะ ap_bu_period_status ──
  // ── เปลี่ยนได้จาก Cron ทุก 5 นาที ต้องมั่นใจว่าเห็นสถานะล่าสุดทุกครั้งที่เข้าหน้า Batch Setup ──
  const { fetchCollection } = useDataCache();
  useEffect(() => {
    fetchCollection('CompanyList', true).catch(e => console.error('force refresh CompanyList:', e));
  }, []);

  // ── Global Representative: ใช้ตอนยังไม่กรอก BU เพื่อโชว์ Period/Receive Date ที่ถูกต้อง ──
  // ── ทุก BU ที่ไม่ได้ Override จะมี ap_bu_period_status เดียวกันหมด (Cron Sync พร้อมกันทีเดียว) ──
  const globalRepresentative = infoItems.find(i => i.ap_period_mode !== 'prev') || infoItems[0] || null;
  const effectiveBuInfo = buInfo || globalRepresentative;

  // ── สถานะ Blocked + Popup ขอปิด Period — อ่านจาก ap_bu_period_status ตรงๆ ไม่ต้องพึ่ง Global API ──
  const buStatus = effectiveBuInfo?.ap_bu_period_status || 'Current';
  const deadline = getDeadline(effectiveBuInfo);
  const daysSinceDeadline = deadline ? Math.floor((new Date() - deadline) / (1000 * 60 * 60 * 24)) : null;
  const canSelfOverride = daysSinceDeadline !== null && daysSinceDeadline >= 0 && daysSinceDeadline <= 7;
  const isBlocked = buStatus === 'Blocked';
  const [showBlockedPopup, setShowBlockedPopup] = useState(false);
  const [requestCloseLoading, setRequestCloseLoading] = useState(false);
  const [selfOverrideLoading, setSelfOverrideLoading] = useState(false);

  // ── Pre-Close/Blocked: ล็อกตายตัวเป็นสิ้นเดือน Current เสมอ (แก้ไขไม่ได้) ──
  const lockedReceiveDate = (buStatus === 'Pre-close' || buStatus === 'Blocked')
    ? endOfMonth(getCurrentMonthStr(effectiveBuInfo))
    : null;

  // ── Period Dropdown: แก้ไขเองได้ปกติ แค่ Default ค่าเริ่มต้นตามสถานะจริง ──
  const [period, setPeriod] = useState('Current');
  useEffect(() => {
    setPeriod((buStatus === 'Pre-close' || buStatus === 'Blocked') ? 'Pre-Close' : 'Current');
  }, [buStatus]);

  // ── Receive Date: ไม่ล็อก แก้ไขได้อิสระเสมอ แค่ Default ตามสถานะจริง ──
  // ── Pre-close/Blocked = สิ้นเดือน Current, Current/Open = วันนี้ ──
  useEffect(() => {
    if (isOverride(buInfo)) return; // Override มี useEffect ของตัวเองจัดการอยู่แล้ว
    setReceiveDate(lockedReceiveDate || todayStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buStatus, effectiveBuInfo]);

  // ── Override: แก้ไขได้อิสระ แต่ Default ค่าตั้งต้นเป็นสิ้นเดือน Prev ให้เผื่อไว้ ──
  useEffect(() => {
    if (isOverride(buInfo)) {
      const defaultOverrideDate = endOfMonth(buInfo?.ap_prev_month);
      if (defaultOverrideDate) setReceiveDate(defaultOverrideDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buInfo?.ap_period_mode]);
  const canToggleOverride = !!buInfo && (isOverride(buInfo) || canSelfOverride);

  useEffect(() => {
    if (buInfo && isBlocked && !hasPendingCloseRequest) setShowBlockedPopup(true);
  }, [buInfo, isBlocked, hasPendingCloseRequest]);

  const handleRequestClose = async () => {
    setRequestCloseLoading(true);
    try { await apiFetch('/ap/period/request-close', { method: 'POST' }); setShowBlockedPopup(false); }
    catch (e) { console.error('request-close:', e); }
    setRequestCloseLoading(false);
  };
  // ── Owner/Admin ปิด Period ได้เองทันที ไม่ต้องส่ง Request ขอใคร ──
  const handleCloseDirectly = async () => {
    setRequestCloseLoading(true);
    try {
      const res = await apiFetch('/ap/period/close', { method: 'POST' });
      if (res?.error) throw new Error(res.error);
      await fetchCollection('CompanyList', true);
      setShowBlockedPopup(false);
    } catch (e) {
      console.error('close-period:', e);
      alert('ปิด Period ไม่สำเร็จ: ' + e.message);
    }
    setRequestCloseLoading(false);
  };
  const handleSelfOverride = async () => {
    if (!bu) return;
    setSelfOverrideLoading(true);
    try {
      await apiFetch('/ap/period/self-override', { method: 'POST', body: JSON.stringify({ bu }) });
      const exact = infoItems.find(i => i['bu']?.toLowerCase() === bu.trim().toLowerCase());
      if (exact) setBuInfo({ ...exact, ap_period_mode: 'prev' });
    } catch (e) { console.error('self-override:', e); }
    setSelfOverrideLoading(false);
  };
  const handleReopen = async () => {
    if (!bu) return;
    setSelfOverrideLoading(true);
    try {
      await apiFetch(`/ap/period/self-override/${bu}/reopen`, { method: 'POST' });
      const exact = infoItems.find(i => i['bu']?.toLowerCase() === bu.trim().toLowerCase());
      if (exact) setBuInfo({ ...exact, ap_period_mode: 'current' });
      setReceiveDate(todayStr); // ── กลับเป็น Current แล้ว Default Receive Date ต้องเป็นวันนี้ ──
    } catch (e) { console.error('reopen:', e); }
    setSelfOverrideLoading(false);
  };

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
        const { data: mine } = await db.from('batch_list').select('*').eq('created_by', me).order('created_at', { ascending: false }).limit(100);
        setHistoryMine(mine || []);
        if (canSeeAll) { const { data: all } = await db.from('batch_list').select('*').order('created_at', { ascending: false }).limit(500); setHistoryAll(all || []); }
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
    const val = e.target.value; // FIX: use event value, not stale `bu` closure
    const match = infoItems.find(i => i['bu']?.toLowerCase() === val.trim().toLowerCase());
    setBuInfo(match || infoItems.find(i => i['bu']?.toLowerCase().startsWith(val.trim().toLowerCase())) || null);
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
                        placeholder="BU code..." style={{ ...inputBase, paddingRight: '36px' }} />
                      <button onClick={() => setShowPopup(true)} title="Open BU search popup"
                        style={{ position: 'absolute', right: 0, top: 0, height: '32px', width: '32px', background: '#1a3a5c', border: 'none', borderRadius: '0 6px 6px 0', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>🔍</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                    <div style={fieldWrap}>
                      <label style={fieldLabel}>Receive date</label>
                      <input type="date" value={receiveDate}
                        onChange={e => setReceiveDate(e.target.value)} style={{ ...inputBase }} />
                    </div>
                    <div style={fieldWrap}><label style={fieldLabel}>Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputBase} /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                    <div style={fieldWrap}>
                      <label style={fieldLabel}>Period</label>
                      <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inputBase, appearance: 'auto', cursor: 'pointer' }}>{PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
                    </div>
                    <div style={fieldWrap}>
                      <div style={{ display: 'flex', border: '0.5px solid #ddd', borderRadius: '6px', overflow: 'hidden', height: '32px', marginTop: '18px', opacity: canToggleOverride ? 1 : 0.45 }}>
                        <button onClick={handleReopen} disabled={!canToggleOverride || selfOverrideLoading || !isOverride(buInfo)}
                          style={{ flex: 1, border: 'none', borderRadius: 0, fontSize: '12px', fontWeight: '500', cursor: (canToggleOverride && isOverride(buInfo) && !selfOverrideLoading) ? 'pointer' : 'not-allowed', background: 'transparent', color: '#1a3a5c' }}>
                          Reopen
                        </button>
                        <button onClick={handleSelfOverride} disabled={!canToggleOverride || selfOverrideLoading || isOverride(buInfo)}
                          style={{ flex: 1, border: 'none', borderLeft: '0.5px solid #ddd', borderRadius: 0, fontSize: '12px', fontWeight: '500', cursor: (canToggleOverride && !isOverride(buInfo) && !selfOverrideLoading) ? 'pointer' : 'not-allowed', background: isOverride(buInfo) ? '#eda100' : 'transparent', color: isOverride(buInfo) ? '#4a2f00' : '#1a3a5c' }}>
                          {selfOverrideLoading ? '...' : 'Override'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <button style={{ ...btnPrimary, width: '100%', justifyContent: 'center', ...(isBlocked ? { background: '#ccc', cursor: 'not-allowed' } : {}) }}
                  onClick={() => {
                    if (isBlocked) { setShowBlockedPopup(true); return; }
                    onStart({ bu: bu || '-', receiveDate, dueDate, period: isOverride(buInfo) ? 'Override' : 'Current', apGrtRunning, apGrnRunning, grtPrefix: getPrefix('GRT', buInfo), grnPrefix: getPrefix('GRN', buInfo), buInfo });
                  }}>▶ Start Batch</button>
              </div>
              <div>
                <div style={{ fontSize: '10px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>BU Info</div>
                <BuInfoPanel buInfo={buInfo} apGrtRunning={apGrtRunning} apGrnRunning={apGrnRunning} grtPrefix={getPrefix('GRT', buInfo)} grnPrefix={getPrefix('GRN', buInfo)} onApGrtRunningChange={v => handleRunningChange(v, setApGrtRunning)} onApGrnRunningChange={v => handleRunningChange(v, setApGrnRunning)} />
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
                  {t.label}<span style={{ background: historyTab === t.key ? '#1a3a5c' : '#e8e8e8', color: historyTab === t.key ? 'white' : '#888', fontSize: '10px', padding: '1px 5px', borderRadius: '20px' }}>{t.count}</span>
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
                const p2 = (n) => String(n).padStart(2, '0');
                const rds = ra ? `${p2(ra.getDate())}/${p2(ra.getMonth()+1)}/${ra.getFullYear()}` : '-';
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
      {showBlockedPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div style={{ background: 'white', borderRadius: '10px', padding: '24px', width: '420px' }}>
            <h3 style={{ fontSize: '15px', marginBottom: '12px', color: '#791F1F' }}>⚠️ ไม่สามารถเริ่ม Batch ได้</h3>
            <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px', lineHeight: 1.6 }}>
              {(isOwner || isAdmin)
                ? <>ตอนนี้เกิน Deadline ไปแล้ว คุณมีสิทธิ์ปิด Period ได้เลย</>
                : <>ตอนนี้เกิน Deadline ไปแล้ว และยังไม่มีการปิด Period<br/>คุณสามารถส่ง Request to Close Period ไปที่ผู้ดูแลระบบได้</>}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowBlockedPopup(false)} style={{ padding: '7px 14px', borderRadius: '6px', border: 'none', background: '#f0f0f0', color: '#555', fontSize: '13px', cursor: 'pointer' }}>ปิด</button>
              {(isOwner || isAdmin) ? (
                <button onClick={handleCloseDirectly} disabled={requestCloseLoading} style={{ padding: '7px 14px', borderRadius: '6px', border: 'none', background: requestCloseLoading ? '#ccc' : '#1a3a5c', color: 'white', fontSize: '13px', fontWeight: '500', cursor: requestCloseLoading ? 'default' : 'pointer' }}>
                  {requestCloseLoading ? 'กำลังปิด...' : 'Close Period'}
                </button>
              ) : (
                <button onClick={handleRequestClose} disabled={requestCloseLoading} style={{ padding: '7px 14px', borderRadius: '6px', border: 'none', background: requestCloseLoading ? '#ccc' : '#791F1F', color: 'white', fontSize: '13px', fontWeight: '500', cursor: requestCloseLoading ? 'default' : 'pointer' }}>
                  {requestCloseLoading ? 'กำลังส่ง...' : 'Request to Close Period'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── InvoiceHeader ─────────────────────────────────────────────────────────────
function InvoiceHeader({ form, setField, onSupplierBlur, onSupplierSearch, vendorInfo, vendorLoading, matchedRule, onBranchSearch, onBranchNoChange, onBranchNoBlur, onBranchNoKeyDown, onInvoiceDetail }) {
  const { width: winW } = useWindowSize();
  const isMobile = winW < 768;

  const fld = (label, key, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: opts.width || 'auto' }}>
      <label style={{ fontSize: '11px', color: '#888', textAlign: 'center', whiteSpace: 'nowrap' }}>{label}{opts.required && <span style={{ color: '#e24b4a' }}> *</span>}</label>
      {opts.type === 'select' ? (
        <select value={form[key]} onChange={e => setField(key, e.target.value)} style={{ height: '30px', padding: '0 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', outline: 'none', background: 'white', color: '#1a3a5c' }}>
          <option value="">— select —</option>{(opts.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={opts.type || 'text'} value={form[key]} onChange={e => setField(key, e.target.value)} readOnly={opts.readOnly}
          style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: opts.readOnly ? '0.5px solid #5DCAA5' : '0.5px solid #ddd', background: opts.readOnly ? '#E1F5EE' : 'white', color: opts.readOnly ? '#085041' : '#1a3a5c', textAlign: opts.readOnly ? 'center' : 'left' }} />
      )}
    </div>
  );

  return (
    <div style={{ padding: '12px 14px', borderBottom: '0.5px solid #e8eaf0' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '130px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Supplier code <span style={{ color: '#e24b4a' }}>*</span></label>
          <div style={{ position: 'relative' }}>
            <input type="text" value={form.supplierCode}
              onChange={e => setField('supplierCode', e.target.value)}
              onBlur={() => onSupplierBlur(form.supplierCode)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Tab') onSupplierBlur(form.supplierCode);
              }}
              style={{ height: '30px', padding: '0 28px 0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
            <button onClick={onSupplierSearch} title="Search Supplier"
              style={{ position: 'absolute', right: 0, top: 0, height: '30px', width: '28px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Branch no.</label>
          <div style={{ position: 'relative' }}>
            <input type="text" value={form.branchNo}
              onChange={e => onBranchNoChange(e.target.value)}
              onBlur={e => onBranchNoBlur(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onBranchNoBlur(e.target.value); }
                if (e.key === 'Tab') onBranchNoKeyDown(e);
              }}
              style={{ height: '30px', padding: '0 28px 0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
            <button onClick={onBranchSearch} style={{ position: 'absolute', right: 0, top: 0, height: '30px', width: '28px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '90px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>CPC</label>
          <input type="text" value={form.headerCpc || ''} onChange={e => setField('headerCpc', e.target.value)}
            style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Account</label>
          <input type="text" value={form.headerAccount || ''} onChange={e => setField('headerAccount', e.target.value)}
            style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '90px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>SubAcc</label>
          <input type="text" value={form.headerSubAcc || ''} onChange={e => setField('headerSubAcc', e.target.value)}
            style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
        </div>



        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginLeft: isMobile ? 0 : 'auto', width: isMobile ? '100%' : 'auto', flexWrap: 'wrap' }}>
          {fld('GRT Status', 'grt',     { readOnly: true, width: '80px'  })}
          {fld('Due date',   'dueDate', { type: 'date',  width: '130px' })}
          <button onClick={onInvoiceDetail} style={{ width: isMobile ? '100%' : 'auto', justifyContent: 'center', height: '30px', padding: '0 16px', borderRadius: '6px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Invoice Detail<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
      <div style={{ marginTop: '10px' }}>
        <VendorInfoPanel vendorInfo={vendorInfo} vendorLoading={vendorLoading} matchedRule={matchedRule} branchDirectLabel={form.branchDirectLabel} branchIBLabel={form.branchIBLabel} />
      </div>
    </div>
  );
}

// ── InvoiceEntry ──────────────────────────────────────────────────────────────
function InvoiceEntry({ batchConfig, invoices, setInvoices, onNext, supplierItems = [], branchItems = [], accountItems = [], subAccItems = [], cpcItems = [], itemcodeItems = [], smCodeItems = [], categoryItems = [], noticeItems = [], vendorRuleItems = [], fetchCollection, userName = '', currentUser, onRunningChange }) {
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const [form, setFormState] = useState({ supplierCode: '', invDate: '', invoiceNum: '', branchNo: '', branchDirectLabel: '', branchIBLabel: '', grt: batchConfig?.buInfo?.['AP GRT Control'] || '', dueDate: batchConfig?.dueDate || '', period: '', invTax: '', grtNum: '', grn: '', backDesc1: '', backDesc2: '', backDesc3: '' });

  // ── GRT/GRN running number — gen อัตโนมัติเมื่อ GRT Status = Auto ──────────
  // GRT: รันทุก invoice / GRN: รันเฉพาะ invoice ที่ Tax code เป็น VAT7% (ไม่ใช่ SVAT7%)
  const isAutoGrt = (batchConfig?.buInfo?.['AP GRT Control'] || '') === 'Auto';
  const [nextGrtRunning, setNextGrtRunning] = useState(() => parseInt(batchConfig?.apGrtRunning || '0', 10) || 0);
  const [nextGrnRunning, setNextGrnRunning] = useState(() => parseInt(batchConfig?.apGrnRunning || '0', 10) || 0);
  const [vendorInfo, setVendorInfo]               = useState(null);
  const [showBranchPopup, setShowBranchPopup]     = useState(false);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false);
  const [showSupplierPopup, setShowSupplierPopup] = useState(false); // ✅ supplier search
  const [bucketPopup, setBucketPopup] = useState({ show: false, mode: 'view', rowKey: null });
  const [selectedRows, setSelectedRows] = useState(new Set()); // ✅ Batch Bucket: เลือกแถวสำหรับ bulk delete
  const [showSendToModal, setShowSendToModal] = useState(false); // ✅ Send To modal
  const branchJustResolved = useRef(false); // ✅ ป้องกัน blur ยิงซ้ำหลัง resolveBranch

  const setField = (key, val) => { setFormState(f => ({ ...f, [key]: val })); if (key === 'supplierCode' && !val) setVendorInfo(null); };

  const branchOptions = {
    'Branch Direct': [...new Set(branchItems.map(b => b['Branch Direct']).filter(Boolean))],
    'bu':            [...new Set(branchItems.map(b => b['bu']).filter(Boolean))],
    'Group-P':       [...new Set(branchItems.map(b => b['Group-P']).filter(Boolean))],
    'status':        ['Active', 'Closed', 'Relocate'],
  };

  const getMatchedRule = (vendor) => {
    if (!vendor?.['Notice']) return null;
    const notices = vendor['Notice'].split('|').map(n => n.trim()).filter(Boolean);
    for (const notice of notices) { const rule = vendorRuleItems.find(r => String(r['item'] ?? '').trim().toLowerCase() === notice.toLowerCase()); if (rule) return rule; }
    return null;
  };

  const lookupVendor = (code) => {
    if (!code?.trim()) { setVendorInfo(null); return; }
    const bu = batchConfig?.bu || '';
    const book = String(batchConfig?.buInfo?.['BOOK'] ?? '').trim().toUpperCase();
    const isGroupBook = !!book && book !== bu.toUpperCase();
    const search = code.trim().toLowerCase();
    let found = supplierItems.find(s => String(s['Code'] ?? '').trim().toLowerCase() === search);
    if (found) {
      const codePrefix = String(found['Code'] ?? '').split('-')[0].toUpperCase();
      const validPrefix = isGroupBook ? codePrefix === book : (bu && codePrefix.toLowerCase() === bu.toLowerCase());
      if (!validPrefix) { setVendorInfo(null); return; }
    }
    if (!found) {
      if (isGroupBook) {
        found = supplierItems.find(s => String(s['Code'] ?? '').trim().toLowerCase() === `${book.toLowerCase()}-${search}`);
      } else if (bu) {
        found = supplierItems.find(s => String(s['Code'] ?? '').trim().toLowerCase() === `${bu.toLowerCase()}-${search}`);
      }
    }
    setVendorInfo(found || null);
  };

  const handleSaveBranch = async ({ form: branchForm, isEdit, editTarget }) => {
    const meta = { updated_by: userName, updated_at: new Date().toISOString() };
    if (isEdit) { const { error } = await db.from('branch_list').update({ ...branchForm, ...meta }).eq('id', editTarget.id); if (error) throw error; }
    else { const { error } = await db.from('branch_list').insert([{ ...branchForm, ...meta }]); if (error) throw error; }
    await fetchCollection('BranchList', true);
  };

  const matchedRule = getMatchedRule(vendorInfo);

  // ── localStorage helpers — buffer ระหว่างยังไม่ sync ขึ้น Backend ──────
  // key ผูกกับ bu + user (ไม่ใช่ batchId) เพราะ Bucket คือ "งานค้างของ user คนนี้ใน BU นี้"
  const me = userName || currentUser?.email || '';
  const bu = batchConfig?.bu || '';
  const bucketStorageKey = (bu && me) ? `ap_bucket_${bu}_${me}` : null;
  const loadLocalBucket = () => {
    if (!bucketStorageKey) return [];
    try { return JSON.parse(localStorage.getItem(bucketStorageKey) || '[]'); } catch { return []; }
  };
  const [bucketRefreshTick, setBucketRefreshTick] = useState(0);
  const saveLocalBucket = (list) => {
    if (!bucketStorageKey) return;
    try { localStorage.setItem(bucketStorageKey, JSON.stringify(list)); } catch (e) { console.error('saveLocalBucket:', e); }
  };

  // ── โหลด Bucket: pending ทั้งหมดของ BU + user นี้ จาก bucket_list ────────
  // (ไม่ filter ด้วย batch_id แล้ว ครอบคลุมของค้างจาก session ก่อนหน้าด้วย)
  useEffect(() => {
    if (!bu || !me) return;
    let active = true;
    (async () => {
      const local = loadLocalBucket();
      if (active && local.length) setInvoices(local);
      try {
        const { data, error } = await db
          .from('bucket_list')
          .select('*')
          .eq('bu', bu)
          .eq('created_by', me)
          .in('status', ['pending', 'sent', 'rejected'])
          .order('created_at', { ascending: true });
        if (error || !active) return;
        const synced = (data || []).map(r => ({ ...r, _synced: true }));
        const pendingOnly = local.filter(l => !l._synced);
        const merged = [...synced, ...pendingOnly];
        setInvoices(merged);
        saveLocalBucket(merged);
        // ── กู้เลข running GRT/GRN ต่อจากที่ใช้ไปแล้วในตะกร้านี้ (เผื่อ refresh) ──
        if (isAutoGrt) {
          const extractRunning = (val, prefix) => {
            if (!val || !prefix || !String(val).startsWith(prefix)) return null;
            const n = parseInt(String(val).slice(prefix.length), 10);
            return isNaN(n) ? null : n;
          };
          const grtNums = merged.map(inv => extractRunning(inv.form_data?.grtNum, batchConfig.grtPrefix)).filter(n => n !== null);
          const grnNums = merged.map(inv => extractRunning(inv.form_data?.grn, batchConfig.grnPrefix)).filter(n => n !== null);
          if (grtNums.length) setNextGrtRunning(Math.max(...grtNums));
          if (grnNums.length) setNextGrnRunning(Math.max(...grnNums));
        }
      } catch (e) { console.error('loadBucketList:', e); }
    })();
    return () => { active = false; };
  }, [bu, me, bucketRefreshTick]);
  // -- ฟัง event เมื่อมี batch ถูก Accept จาก Toast เพื่อ refresh bucket list --
  useEffect(() => {
    const handler = () => setBucketRefreshTick(t => t + 1);
    window.addEventListener('bucketAccepted', handler);
    return () => window.removeEventListener('bucketAccepted', handler);
  }, []);

  // ── ref เก็บ invoices ล่าสุด ให้ syncPendingToBucket อ่านได้โดยไม่ต้อง re-create interval ──
  const invoicesRef = useRef(invoices);
  useEffect(() => { invoicesRef.current = invoices; }, [invoices]);

  // ── ref เก็บ nextGrtRunning/nextGrnRunning ล่าสุด + ค่าที่เขียนลง DB ครั้งล่าสุด ──
  const grtGrnRef = useRef({ grt: nextGrtRunning, grn: nextGrnRunning });
  useEffect(() => { grtGrnRef.current = { grt: nextGrtRunning, grn: nextGrnRunning }; }, [nextGrtRunning, nextGrnRunning]);
  const lastSyncedGrtGrnRef = useRef({ grt: nextGrtRunning, grn: nextGrnRunning });

  // ✅ แจ้ง running number ปัจจุบัน (optimistic) ขึ้นไปที่ APController
  // เพื่อให้หน้า Batch Setup เห็นค่าล่าสุดทันทีหลัง Submit โดยไม่ต้องรอ DB sync
  useEffect(() => {
    if (onRunningChange && bu) onRunningChange(bu, { ap_grt: nextGrtRunning, ap_grn: nextGrnRunning });
  }, [nextGrtRunning, nextGrnRunning, bu]);

  // ── presence: ตรวจว่ามี user อื่นทำงาน BU เดียวกันอยู่ไหม (ap_active_sessions) ──
  // มี -> sync GRT/GRN ทุก submit (real-time) / ไม่มี -> รอ sync รวดเดียวตอนออกจากหน้านี้
  const realtimeSyncRef = useRef(false);

  // ── Sync รายการที่ยังไม่ขึ้น Backend (bulk insert ครั้งเดียว) ────────────
  const syncingRef = useRef(false);
  const syncPendingToBucket = async () => {
    if (syncingRef.current) return;
    const pending = invoicesRef.current.filter(inv => !inv._synced);
    if (!pending.length) return;
    syncingRef.current = true;
    try {
      // Send local_id with each row and upsert on it instead of plain insert.
      // This makes syncing idempotent - safe to call more than once for the
      // same item - which fixes duplicate rows caused by a race condition
      // where the page unloads/refreshes before the previous sync result
      // (the _synced flag) is saved back to localStorage.
      const payloads = pending.map(({ _localId, _synced, id, ...rest }) => ({
        ...rest,
        local_id: _localId,
      }));
      const { data, error } = await db
        .from('bucket_list')
        .upsert(payloads, { onConflict: 'local_id' })
        .select();
      if (error) throw error;
      setInvoices(prev => {
        // Match results back by local_id instead of array index - safer if
        // the backend ever returns rows in a different order than sent.
        const byLocalId = new Map((data || []).map(r => [r.local_id, r]));
        const next = prev.map(inv => {
          if (inv._synced) return inv;
          const row = byLocalId.get(inv._localId);
          return row ? { ...row, _synced: true } : inv;
        });
        saveLocalBucket(next);
        return next;
      });
    } catch (e) {
      console.error('syncPendingToBucket:', e);
    } finally {
      syncingRef.current = false;
    }
  };

  // ── เขียนเลข running ล่าสุดที่ใช้ไปแล้วกลับ company_list.ap_grt/ap_grn (เฉพาะตอน GRT Status = Auto) ──
  // partial update — ส่งเฉพาะ ap_grt/ap_grn ที่ "เปลี่ยนจริง" เท่านั้น กันทับค่าของ
  // session อื่น (BU เดียวกัน) ที่อาจ update อีกตัวไปแล้วก่อนหน้า
  const syncGrtGrnCounter = async (override = null) => {
    const buVal = String(batchConfig?.bu || '').trim();
    if (!isAutoGrt || !buVal) return;
    const { grt, grn } = override || grtGrnRef.current;
    const last = lastSyncedGrtGrnRef.current;
    const grtChanged = grt !== last.grt;
    const grnChanged = grn !== last.grn;
    if (!grtChanged && !grnChanged) return;
    const payload = {};
    if (grtChanged) payload.ap_grt = grt;
    if (grnChanged) payload.ap_grn = grn;
    try {
      const buId = batchConfig?.buInfo?.id;
      const { error } = buId
        ? await db.from('company_list').update(payload).eq('id', buId)
        : await db.from('company_list').update(payload).eq('bu', buVal);
      if (error) throw error;
      lastSyncedGrtGrnRef.current = { grt, grn };
      if (fetchCollection) await fetchCollection('CompanyList', true);
    } catch (e) {
      console.error('syncGrtGrnCounter:', e);
    }
  };

  // ── presence heartbeat: แจ้งตัวเอง + เช็คว่ามี session อื่นของ BU เดียวกันไหม ──
  const heartbeat = async () => {
    if (!batchConfig?.batchId || !batchConfig?.bu) return;
    try {
      await db.from('ap_active_sessions').upsert(
        { bu: batchConfig.bu, batch_id: batchConfig.batchId, user_name: userName || currentUser?.email || '', last_seen: new Date().toISOString() },
        { onConflict: 'batch_id' }
      );
      const cutoff = new Date(Date.now() - 60000).toISOString();
      const { data, error } = await db.from('ap_active_sessions').select('batch_id').eq('bu', batchConfig.bu).neq('batch_id', batchConfig.batchId).gte('last_seen', cutoff);
      if (error) throw error;
      const wasRealtime = realtimeSyncRef.current;
      realtimeSyncRef.current = !!(data && data.length);
      if (isAutoGrt && !wasRealtime && realtimeSyncRef.current) {
        // เพิ่งตรวจพบ user อื่นเข้ามาทำ BU เดียวกัน -> sync ค่าปัจจุบัน catch-up ทันที
        syncGrtGrnCounter();
      }
    } catch (e) {
      console.error('heartbeat:', e);
    }
  };

  // ── ลบ session ของตัวเองตอนออกจากหน้านี้ ────────────────────────────────
  const cleanupPresence = async () => {
    if (!batchConfig?.batchId) return;
    try { await db.from('ap_active_sessions').delete().eq('batch_id', batchConfig.batchId); }
    catch (e) { console.error('cleanupPresence:', e); }
  };

  // ── sync ทุก 30 วิ + ตอนซ่อนแท็บ + ครั้งสุดท้ายตอนออกจากหน้านี้ ───────────
  // ── Auto Backup: sync Batch Bucket + GRT/GRN counter ────────────────────
  const autoBackup = () => { syncPendingToBucket(); if (isAutoGrt && batchConfig?.bu) syncGrtGrnCounter(); };

  useEffect(() => {
    if (!bu || !me) return;
    heartbeat(); // เช็ค presence ทันทีตอนเข้าหน้านี้ ไม่ต้องรอ 30 วิแรก
    const interval = setInterval(() => { autoBackup(); heartbeat(); }, 30000);

    // ── Auto Backup ทุก 15 นาที (เพิ่มเติมจาก interval 30 วิ ด้านบน) ──────
    const backupInterval = setInterval(autoBackup, 15 * 60 * 1000);

    const onVisibility = () => { if (document.hidden) autoBackup(); };
    document.addEventListener('visibilitychange', onVisibility);

    // ── ปิดแท็บ/เบราว์เซอร์ — pagehide fire ก่อนปิดเสมอ (รวม mobile) ──────
    window.addEventListener('pagehide', autoBackup);

    // ── ลงทะเบียน flush สำหรับตอน logout (เรียกจาก AuthContext.logout) ───
    const unregisterFlush = registerSyncFlush(async () => {
      await syncPendingToBucket();
      await syncGrtGrnCounter();
    });

    return () => {
      clearInterval(interval);
      clearInterval(backupInterval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', autoBackup);
      unregisterFlush();
      syncPendingToBucket();
      if (batchConfig?.bu) syncGrtGrnCounter();
      cleanupPresence();
    };
  }, [bu, me]);

  // ── Submit invoice ปัจจุบัน -> เก็บ local + localStorage ทันที (ไม่ยิง API) ──
  // sync ขึ้น bucket_list รวมเป็นชุดตาม interval/trigger ด้านบน
  // เก็บ supplier/branch ไว้ (มักเป็น vendor เดียวกันหลายใบ) แต่ reset
  // invoice-specific fields เพื่อกรอกใบถัดไป
  // ── บันทึกการแก้ไข invoice ใน Batch Bucket (เรียกจาก BucketItemPopup) ──
  const handleSaveBucketItem = async ({ form_data, lines, invoiceNo }) => {
    const target = invoices.find((inv, i) => (inv.id || inv._localId || i) === bucketPopup.rowKey);
    if (!target) return false;
    const sumField = (key) => lines.reduce((s, l) => s + (parseFloat(String(l[key] ?? '').replace(/,/g, '')) || 0), 0);
    const updated = {
      ...target,
      branch_no:    form_data.branchNo || '',
      branch_label: form_data.branchDirectLabel || '',
      invoice_no:   invoiceNo || form_data.invoiceNum || '',
      inv_date:     form_data.invDate || null,
      period:       form_data.period || '',
      description:  lines[0]?.desc || '',
      amount: sumField('amount'), vat: sumField('vat'), wht: sumField('wht'), net: sumField('total'),
      form_data, lines,
    };
    if (target._synced && target.id) {
      const { error } = await db.from('bucket_list').update({
        branch_no: updated.branch_no, branch_label: updated.branch_label, invoice_no: updated.invoice_no,
        inv_date: updated.inv_date, period: updated.period, description: updated.description,
        amount: updated.amount, vat: updated.vat, wht: updated.wht, net: updated.net,
        form_data: updated.form_data, lines: updated.lines,
      }).eq('id', target.id);
      if (error) {
        console.error('[SAVE-BUCKET-ERROR] full error object:', error, 'updated.form_data=', updated.form_data);
        alert('บันทึกไม่สำเร็จ: ' + (error.message || error.hint || error.code || JSON.stringify(error)));
        return false;
      }
    }
    setInvoices(prev => {
      const next = prev.map((it, i) => (it.id || it._localId || i) === bucketPopup.rowKey ? updated : it);
      saveLocalBucket(next);
      return next;
    });
    return true;
  };

  // ✅ ลบรายการที่เลือกไว้ใน Batch Bucket (bulk delete) ────────────────────
  const handleDeleteSelected = async () => {
    if (!selectedRows.size) return;
    if (!window.confirm(`ต้องการลบ ${selectedRows.size} รายการที่เลือก?`)) return;
    const toDelete = invoices.filter((inv, i) => selectedRows.has(inv.id || inv._localId || i));
    const syncedIds = toDelete.filter(inv => inv._synced && inv.id).map(inv => inv.id);
    if (syncedIds.length) {
      await db.from('bucket_list').delete().in('id', syncedIds);
    }
    setInvoices(list => {
      const next = list.filter((inv, i) => !selectedRows.has(inv.id || inv._localId || i));
      saveLocalBucket(next);
      return next;
    });
    setSelectedRows(new Set());
  };

  // ── ส่ง Batch Bucket ให้ user อื่น ──────────────────────────────────────────
  const handleSendTo = async ({ toUserId, toUsername, note }) => {
    const toSend = invoices.filter((inv, i) => selectedRows.has(inv.id || inv._localId || i));
    if (!toSend.length) return;
    const syncedIds = toSend.filter(inv => inv._synced && inv.id).map(inv => inv.id);

    // 1. sync pending ก่อนส่ง
    await syncPendingToBucket();

    // 2. update status = 'sent' + บันทึก sent_to ใน bucket_list
    if (syncedIds.length) {
      const { error } = await db.from('bucket_list').update({
        status: 'sent',
        sent_to_user_id: toUserId,
        sent_to_username: toUsername,
        sent_note: note || '',
        sent_at: new Date().toISOString(),
      }).in('id', syncedIds);
      if (error) throw error;
    }

    // 3. บันทึก activity_log (BATCH_SEND)
    const invCount = toSend.length;
    const token = sessionStorage.getItem('fastapn_token');
    const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      await fetch(`${apiBase}/api/activity_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        username: userName || currentUser?.email || '',
        module: 'AP',
        action: 'BATCH_SEND',
        detail: JSON.stringify({
          count: invCount,
          ids: syncedIds,
          note: note || '',
          batch_id: batchConfig?.batchId || '',
        }),
        received_by: toUsername,
        target: toUserId,
      }),
    });

    // 4. update local state
    setInvoices(prev => {
      const next = prev.map((inv, i) => {
        const key = inv.id || inv._localId || i;
        if (!selectedRows.has(key)) return inv;
        return { ...inv, status: 'sent', sent_to_username: toUsername };
      });
      saveLocalBucket(next);
      return next;
    });
    setSelectedRows(new Set());
  };

  // ── Recall selected sent invoices ──────────────────────────────────────────
  const handleRecallSelected = async () => {
    const toRecall = invoices.filter((inv, i) => {
      const key = inv.id || inv._localId || i;
      return selectedRows.has(key) && inv.status === 'sent';
    });
    if (!toRecall.length) return;
    const syncedIds = toRecall.filter(inv => inv._synced && inv.id).map(inv => inv.id);
    if (syncedIds.length) {
      await db.from('bucket_list').update({
        status: 'pending', sent_to_user_id: null, sent_to_username: null,
      }).in('id', syncedIds);
    }
    setInvoices(prev => {
      const next = prev.map((inv, i) => {
        const key = inv.id || inv._localId || i;
        if (!selectedRows.has(key) || inv.status !== 'sent') return inv;
        return { ...inv, status: 'pending', sent_to_username: null };
      });
      saveLocalBucket(next);
      return next;
    });
    setSelectedRows(new Set());
  };

  // ── ขอเลข GRT/GRN ที่การันตีไม่ซ้ำจาก backend (transaction lock + เช็คซ้ำจริง) ──
  // ── ถ้าเรียกไม่สำเร็จ fallback กลับไปคำนวณ local (กัน submit ล้มเหลวไปเลย) ────
  const requestUniqueNumber = async (field, prefix, fallbackRunning) => {
    const buId = batchConfig?.buInfo?.id;
    if (!buId) {
      console.warn('[GRT-GRN] ไม่มี buId — ใช้เลข local (ไม่ atomic, เสี่ยงซ้ำถ้ามีคนอื่นทำงาน BU เดียวกัน)');
      const running = fallbackRunning + 1;
      return { value: running, formatted: `${prefix}${String(running).padStart(4, '0')}` };
    }
    try {
      const result = await apiFetch(`/company_list/${buId}/reserve-unique-number`, {
        method: 'POST',
        body: JSON.stringify({ field, prefix, bu: batchConfig?.bu || '', padLength: 4 }),
      });
      return result;
    } catch (e) {
      console.error('[GRT-GRN] reserve-unique-number ล้มเหลว, fallback เป็น local:', e);
      const running = fallbackRunning + 1;
      return { value: running, formatted: `${prefix}${String(running).padStart(4, '0')}` };
    }
  };

  const handleSubmitInvoice = async (lines) => {
    const sumField = (ls, key) => ls.reduce((s, l) => s + (parseFloat(String(l[key] ?? '').replace(/,/g, '')) || 0), 0);
    const roleLabel = isOwner ? 'Owner' : isAdmin ? 'Admin' : isEditor ? 'Editor' : 'Viewer';

    // ── แบ่ง lines เป็น Invoice แยกตาม H/L ────────────────────────────────────
    // ทุกครั้งที่เจอ hl === 'H' = เริ่ม Invoice ใหม่ 1 ใบ
    // L ที่ตามมาจะรวมเข้า Invoice ของ H ตัวล่าสุด จนกว่าจะเจอ H ตัวถัดไป
    const groups = [];
    lines.forEach(line => {
      if (line.hl === 'H' || groups.length === 0) groups.push([line]);
      else groups[groups.length - 1].push(line);
    });

    // ── GRT: ขอ 1 เลขจาก backend (การันตีไม่ซ้ำ) ใช้ร่วมทุก Invoice ที่ split จาก submit นี้ ──
    let grtNumVal = form.grtNum;
    let bumpGrt = false;
    let grtRunningActual = nextGrtRunning;
    if (isAutoGrt) {
      const res = await requestUniqueNumber('ap_grt', batchConfig?.grtPrefix || '', nextGrtRunning);
      grtNumVal = res.formatted;
      grtRunningActual = res.value;
      bumpGrt = true;
    }

    // ── GRN: ขอเลขแยกทีละครั้งจาก backend เฉพาะ Invoice ที่ Tax Code = VAT7% ──────
    const baseInvoiceNo = buildInvoiceNumber(form.invoiceNum, form.invDate, vendorInfo) || '';
    let grnRunningActual = nextGrnRunning;
    let grnBumpCount = 0;

    const newItems = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const groupLines = groups[gi];
      const taxCode0 = String(groupLines[0]?.taxCode || '');
      const isVat = taxCode0.includes('VAT7%') && !taxCode0.includes('SVAT7%');
      let grnVal = '';
      if (isAutoGrt && isVat) {
        const res = await requestUniqueNumber('ap_grn', batchConfig?.grnPrefix || '', grnRunningActual);
        grnVal = res.formatted;
        grnRunningActual = res.value;
        grnBumpCount += 1;
      }
      // group 0 = Invoice หลัก (invoice_no = base) / group 1,2,... = Invoice แยก (base + '/1','/2',...)
      const invoiceSuffix = gi === 0 ? '' : `/${gi}`;
      const invoiceNo = `${baseInvoiceNo}${invoiceSuffix}`;
      newItems.push({
        batch_id:        batchConfig?.batchId || '',
        bu:              batchConfig?.bu || '',
        receive_date:    batchConfig?.receiveDate || null,
        supplier_code:   form.supplierCode || '',
        vendor_name:     vendorInfo?.['Supplier Name'] || '',
        branch_no:       form.branchNo || '',
        branch_label:    form.branchDirectLabel || '',
        invoice_no:      invoiceNo,
        inv_date:        form.invDate || null,
        period:          form.period || '',
        description:     groupLines[0]?.desc || '',
        amount:          sumField(groupLines, 'amount'),
        vat:             sumField(groupLines, 'vat'),
        wht:             sumField(groupLines, 'wht'),
        net:             sumField(groupLines, 'total'),
        form_data:       {
          ...form,
          grtNum: grtNumVal,
          grn: grnVal,
          invoiceSuffix,
          // Real Vendor — ดึงจาก H line (groupLines[0]) ที่เลือกไว้
          realVendorCode:   groupLines[0]?.realVendorCode   || '',
          realVendorName:   groupLines[0]?.realVendorName   || '',
          realVendorTaxid:  groupLines[0]?.realVendorTaxid  || '',
          realVendorBranch: groupLines[0]?.realVendorBranch || '',
          realInvoiceNo:    groupLines[0]?.realInvoiceNo    || '',
          realVendorTaxDate: groupLines[0]?.realVendorTaxDate || '',
          isVat:            groupLines[0]?.isVat            || '',
        },
        lines:           groupLines,
        status:          'pending',
        created_by:      userName || currentUser?.email || '',
        created_by_role: roleLabel,
        _localId: `local-${Date.now()}-${Math.random().toString(36).slice(2)}-${gi}`,
        id: null,
        _synced: false,
      });
    }

    setInvoices(prev => {
      // ── Dedup guard: ป้องกัน user กด Submit ซ้ำเร็ว ๆ ─────────────────
      // เปรียบ invoice_no + branch_no + amount ของ item ใหม่กับที่มีอยู่แล้ว
      const existingKeys = new Set(
        prev.map(inv => `${inv.invoice_no}|${inv.branch_no}|${inv.amount}`)
      );
      const deduped = newItems.filter(
        item => !existingKeys.has(`${item.invoice_no}|${item.branch_no}|${item.amount}`)
      );
      if (!deduped.length) return prev;
      const next = [...prev, ...deduped];
      saveLocalBucket(next);
      return next;
    });
    if (bumpGrt) setNextGrtRunning(grtRunningActual);
    if (grnBumpCount > 0) setNextGrnRunning(grnRunningActual);
    // ✅ ตอน Submit: update แค่ State (nextGrtRunning/nextGrnRunning) เท่านั้น
    // ไม่เขียนกลับ company_list.ap_grt/ap_grn ที่นี่อีกต่อไป —
    // การ sync เลข running (4 หลักล่าสุด) กลับ DB จะทำ "ตอนจบ Batch" เท่านั้น
    // ผ่าน syncGrtGrnCounter() ที่ถูกเรียกจาก useEffect cleanup ด้านล่าง
    // (เมื่อออกจากหน้า InvoiceEntry / เปลี่ยน step) และ interval 30s (safety-net)
    setFormState(f => ({
      ...f,
      invoiceNum: '', invDate: '', invTax: '', grtNum: '', grn: '',
      backDesc1: '', backDesc2: '', backDesc3: '',
    }));
    return true;
  };

const handleSelectBranch = (item, meta = {}) => {
  const ownLabel = formatBranchLabel(item);
  const branchCpc = String(item['cpc'] ?? '').trim();
  if (meta.isIB) {
    const ho = findHOBranch(branchItems, item['bu']);
    setFormState(f => ({ ...f, branchNo: item['Branch Code'] || '', branchIBLabel: ownLabel, branchDirectLabel: ho ? formatBranchLabel(ho) : '-', branchCpc, headerCpc: branchCpc }));
  } else {
    setFormState(f => ({ ...f, branchNo: item['Branch Code'] || '', branchDirectLabel: ownLabel, branchIBLabel: '-', branchCpc, headerCpc: branchCpc }));
  }
  setShowBranchPopup(false);
};

  // ── Branch No. Smart Lookup ───────────────────────────────────────────────
  const resolveBranch = (input) => {
    if (!input?.trim()) {
      setFormState(f => ({ ...f, branchDirectLabel: '', branchIBLabel: '' }));
      branchJustResolved.current = false;
      return;
    }

    const raw     = input.trim();
    const bu      = batchConfig?.bu || '';
    const hasPlus = raw.includes('+');

    // ── Special case: พิมพ์ "IB" → HO + IB-ALL ──────────────────────────
    if (raw.trim().toUpperCase() === 'IB') {
      const ho = findHOBranch(branchItems, bu);
      setFormState(f => ({
        ...f,
        branchNo:          'IB',
        branchDirectLabel: ho ? formatBranchLabel(ho) : '',
        branchIBLabel:     'IB-ALL',
      }));
      branchJustResolved.current = true;
      return;
    }
    branchJustResolved.current = false;

    // ดึง search term — ลบ + ออก แล้วลบ BU prefix ถ้ามี
    // รองรับ: "MPS+00002" "MPS-00002" "+2" "2" "056802" "056802+"
    const _noPlus = raw.replace(/\+/g, '').trim();
    const _buLow  = bu.toLowerCase();
    const cleaned = (_noPlus.toLowerCase().startsWith(_buLow + '-'))
      ? _noPlus.slice(bu.length + 1).trim()
      : (_noPlus.toLowerCase().startsWith(_buLow))
        ? _noPlus.slice(bu.length).trim()
        : _noPlus;

    // กรอง branchItems เฉพาะ BU ของ batch ก่อนเสมอ
    const buBranches = bu
      ? branchItems.filter(b => String(b['bu'] ?? '').toLowerCase() === bu.toLowerCase())
      : branchItems;

    // ── findBranch: lookup ตามลำดับ เฉพาะ BU ──────────────────────────
    // โครงสร้าง Branch จริง:
    //   Branch Code = '056802'   (ตัวเลขล้วน)
    //   BU-Branch   = '00001'    (5 หลัก ไม่มี BU prefix)
    //   bu          = 'MPS'
    const findBranch = (term) => {
      const t = term.trim().toLowerCase();
      if (!t) return null;

      // 1. match Branch Code ตรงๆ เช่น "056802"
      let found = buBranches.find(b =>
        String(b['Branch Code'] ?? '').toLowerCase() === t
      );
      if (found) return found;

      // 2. ตัวเลขล้วน → pad 5 หลัก → match BU-Branch
      //    เช่น "2" → "00002", "00002" → "00002"
      if (/^\d+$/.test(t)) {
        const padded = t.padStart(5, '0');
        found = buBranches.find(b =>
          String(b['BU-Branch'] ?? '').toLowerCase() === padded
        );
        if (found) return found;
      }

      // 3. match BU-Branch ตรงๆ (กรณีใส่ครบ เช่น "00002")
      found = buBranches.find(b =>
        String(b['BU-Branch'] ?? '').toLowerCase() === t
      );
      if (found) return found;

      // 4. contains ใน Branch Code หรือ Company Name (term >= 3 ตัว)
      if (t.length >= 3) {
        found = buBranches.find(b =>
          String(b['Branch Code'] ?? '').toLowerCase().includes(t) ||
          String(b['Company for Show in Report Display'] ?? '').toLowerCase().includes(t)
        );
        return found || null;
      }

      return null;
    };

    const branch = findBranch(cleaned);

    if (!branch) {
      setFormState(f => ({ ...f, branchDirectLabel: '', branchIBLabel: '' }));
      branchJustResolved.current = false;
      return;
    }

    const branchCode = branch['Branch Code'] || raw.replace(/\+/g, '');
    const label = formatBranchLabel(branch);

    branchJustResolved.current = true;
    if (hasPlus) {
      // ── IB mode: branchIB = branch ที่ match, branchDirect = HO ──────────
      const ho      = findHOBranch(branchItems, branch['bu'] || bu);
      const hoLabel = ho ? formatBranchLabel(ho) : '';
      setFormState(f => ({
        ...f,
        branchNo:          branchCode,
        branchIBLabel:     label,
        branchDirectLabel: hoLabel,
      }));
    } else {
      // ── Direct mode ──────────────────────────────────────────────────────
      setFormState(f => ({
        ...f,
        branchNo:          branchCode,
        branchDirectLabel: label,
        branchIBLabel:     '-',
      }));
    }
  };

  const handleBranchNoChange = (val) => {
    setFormState(f => ({
      ...f,
      branchNo: val,
      ...(val.trim() === '' ? { branchDirectLabel: '', branchIBLabel: '' } : {}),
    }));
  };

  // trigger: Blur, Enter, Tab
  const handleBranchNoBlur = (val) => {
    if (branchJustResolved.current) {
      branchJustResolved.current = false;
      return;
    }
    resolveBranch(val);
  };
  const handleBranchNoKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') resolveBranch(e.target.value);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <SupplierSearchPopup
        show={showSupplierPopup}
        onClose={() => setShowSupplierPopup(false)}
        onSelect={(item) => {
          setField('supplierCode', item['Code'] || '');
          setShowSupplierPopup(false);
          lookupVendor(item['Code'] || '');
        }}
        supplierItems={supplierItems}
        bu={batchConfig?.bu || ''}
        bookFilter={(() => { const b = String(batchConfig?.buInfo?.['BOOK'] ?? '').trim().toUpperCase(); return (b && b !== (batchConfig?.bu || '').toUpperCase()) ? b : ''; })()}
        fetchCollection={fetchCollection}
        userName={userName || currentUser?.email || ''}
      />
      <BranchSearchPopup show={showBranchPopup} onClose={() => setShowBranchPopup(false)} onSelect={handleSelectBranch} branchItems={branchItems} bu={batchConfig?.bu || ''} onSaveBranch={handleSaveBranch} branchOptions={branchOptions} />

      <BucketItemPopup
        show={bucketPopup.show}
        mode={bucketPopup.mode}
        invoice={bucketPopup.rowKey != null ? invoices.find((inv, i) => (inv.id || inv._localId || i) === bucketPopup.rowKey) : null}
        onClose={() => setBucketPopup({ show: false, mode: 'view', rowKey: null })}
        itemcodeItems={itemcodeItems}
        supplierItems={supplierItems}
        vendorRuleItems={vendorRuleItems}
        bu={batchConfig?.bu || ''}
        fetchCollection={fetchCollection}
        userName={userName || currentUser?.email || ''}
        currentUser={currentUser}
        onSave={handleSaveBucketItem}
      />
      <SendToModal
        show={showSendToModal}
        onClose={() => setShowSendToModal(false)}
        onSend={handleSendTo}
        selectedCount={selectedRows.size}
        totalAmount={invoices.filter((inv, i) => selectedRows.has(inv.id || inv._localId || i)).reduce((s, inv) => s + (parseFloat(inv.net) || 0), 0)}
        currentUserId={currentUser?.id || ''}
      />
      
      <div style={{ ...card, overflow: 'visible' }}>
        <InvoiceHeader form={form} setField={setField} onSupplierBlur={lookupVendor} onSupplierSearch={() => setShowSupplierPopup(true)} vendorInfo={vendorInfo} vendorLoading={false} matchedRule={matchedRule} onBranchSearch={() => setShowBranchPopup(true)} onBranchNoChange={handleBranchNoChange} onBranchNoBlur={handleBranchNoBlur} onBranchNoKeyDown={handleBranchNoKeyDown} onInvoiceDetail={() => setShowInvoiceDetail(true)} />
        <InvoiceDetailPopup show={showInvoiceDetail} onClose={() => setShowInvoiceDetail(false)} form={form} setField={setField} vendorInfo={vendorInfo} itemcodeItems={itemcodeItems} fetchCollection={fetchCollection} userName={userName} currentUser={currentUser} bu={batchConfig?.bu || ''} onResolveBranch={resolveBranch} onSubmitInvoice={handleSubmitInvoice} isAutoGrt={isAutoGrt} grtPreview={isAutoGrt ? `${batchConfig?.grtPrefix || ''}${String(nextGrtRunning + 1).padStart(4,'0')}` : ''} grnPreview={isAutoGrt ? `${batchConfig?.grnPrefix || ''}${String(nextGrnRunning + 1).padStart(4,'0')}` : ''} smCodeItems={smCodeItems} categoryItems={categoryItems} branchItems={branchItems} />
      </div>

      {/* ── Batch Bucket (โครง — ยังไม่มี data จริง ใช้ invoices state) ──────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '0.5px solid #e8eaf0' }}>
          <div style={{ display: 'flex' }}>
            <div style={{ padding: '9px 14px', fontSize: '12px', cursor: 'default', borderBottom: '2px solid #1a3a5c', marginBottom: '-0.5px', color: '#1a3a5c', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🧺 Batch Bucket
              <span style={{ background: '#1a3a5c', color: 'white', fontSize: '10px', padding: '1px 5px', borderRadius: '20px' }}>{invoices.length}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {selectedRows.size > 0 && (
              <>
                <button onClick={handleDeleteSelected}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minWidth: '90px', height: '30px', padding: '0 12px', borderRadius: '6px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  Delete
                </button>
                <button onClick={() => setShowSendToModal(true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minWidth: '90px', height: '30px', padding: '0 12px', borderRadius: '6px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Send to
                </button>
                {invoices.some((inv, i) => selectedRows.has(inv.id || inv._localId || i) && inv.status === 'sent') && (
                  <button onClick={handleRecallSelected}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minWidth: '90px', height: '30px', padding: '0 12px', borderRadius: '6px', border: '0.5px solid #e8eaf0', background: 'white', color: '#555', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
                    Recall
                  </button>
                )}
                <div style={{ width: '0.5px', height: '18px', background: '#e8eaf0', margin: '0 2px' }}></div>
              </>
            )}
            <button onClick={onNext} disabled={invoices.length === 0}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '30px', padding: '0 16px', borderRadius: '6px', border: 'none', background: invoices.length === 0 ? '#e0e0e0' : '#27500A', color: 'white', fontSize: '12px', fontWeight: '500', cursor: invoices.length === 0 ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Batch Preview
            </button>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '3%' }} />
            <col style={{ width: '12%' }} /><col style={{ width: '17%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '7px 9px', borderBottom: '0.5px solid #e8eaf0', textAlign: 'center' }}>
                <input type="checkbox" checked={invoices.length > 0 && selectedRows.size === invoices.length}
                  onChange={() => setSelectedRows(prev => prev.size === invoices.length ? new Set() : new Set(invoices.map((inv, i) => inv.id || inv._localId || i)))} />
              </th>
              {['Invoice No.','Vendor','Branch','Amount','Vat','Wht','Total','Status','Action'].map(h => (
                <th key={h} style={{ padding: '7px 9px', textAlign: 'center', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>ยังไม่มี Invoice ในตะกร้า</td></tr>
            ) : [...invoices].sort((a, b) => {
              const getCreatedTime = (inv) => {
                if (inv.created_at) return new Date(inv.created_at).getTime();
                const m = String(inv._localId || '').match(/^local-(\d+)-/);
                return m ? parseInt(m[1], 10) : 0;
              };
              // ── แยก base invoice no. ออกจาก suffix (/1, /2, ...) ──
              // ── ไม่มี suffix ให้ถือเป็น 0 (มาก่อน /1, /2 เสมอ) ──────
              const parseInvSuffix = (invNo) => {
                const s = String(invNo || '');
                const m = s.match(/^(.+)\/(\d+)$/);
                if (m) return { base: m[1], suf: parseInt(m[2], 10) };
                return { base: s, suf: 0 };
              };
              const pa = parseInvSuffix(a.invoice_no), pb = parseInvSuffix(b.invoice_no);
              if (pa.base !== pb.base) return getCreatedTime(a) - getCreatedTime(b);
              return pa.suf - pb.suf;
            }).map((inv, i) => {
              const rowKey = inv.id || inv._localId || i;
              return (
              <tr key={rowKey} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
                <td style={{ padding: '8px 9px', textAlign: 'center' }}>
                  <input type="checkbox" checked={selectedRows.has(rowKey)}
                    onChange={() => setSelectedRows(prev => { const next = new Set(prev); next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey); return next; })} />
                </td>
                <td style={{ padding: '8px 9px', fontFamily: 'monospace', fontSize: '11px', color: '#1a3a5c', fontWeight: '600' }}>{inv.invoice_no || '-'}</td>
                <td style={{ padding: '8px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.vendor_name || '-'}</td>
                <td style={{ padding: '8px 9px', color: '#555', fontSize: '11px' }}>{inv.branch_no || '-'}</td>
                <td style={{ padding: '8px 9px', fontWeight: '500', color: '#1a3a5c', textAlign: 'right' }}>{inv.amount != null && inv.amount !== '' ? Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                <td style={{ padding: '8px 9px', color: '#555', textAlign: 'right' }}>{inv.vat != null && inv.vat !== '' ? Number(inv.vat).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                <td style={{ padding: '8px 9px', color: inv.wht < 0 ? '#A32D2D' : '#555', textAlign: 'right' }}>{inv.wht != null && inv.wht !== '' ? Number(inv.wht).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                <td style={{ padding: '8px 9px', fontWeight: '600', color: '#1a3a5c', textAlign: 'right' }}>{inv.net != null && inv.net !== '' ? Number(inv.net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                <td style={{ padding: '8px 9px', textAlign: 'center' }}>
                  {inv.status === 'sent' ? (
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#FFF3CD', color: '#856404', fontWeight: '500', whiteSpace: 'nowrap' }}>
                      📤 {inv.sent_to_username ? `→ ${inv.sent_to_username}` : 'Sent'}
                    </span>
                  ) : inv.status === 'rejected' ? (
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#FCEBEB', color: '#791F1F', fontWeight: '500', whiteSpace: 'nowrap' }}>
                      ❌ Rejected
                    </span>
                  ) : inv.status === 'pending' ? (
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#E8EAF0', color: '#555', fontWeight: '500', whiteSpace: 'nowrap' }}>
                      ⏳ Pending
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: '6px 9px' }}>
                  {inv.status === 'sent' ? (
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button title="View" onClick={() => setBucketPopup({ show: true, mode: 'view', rowKey })}
                        style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                      <button title="Recall — ดึงกลับ" onClick={async () => {
                          if (window.confirm('ดึง invoice กลับจาก ' + (inv.sent_to_username || 'ผู้รับ') + ' ใช่ไหม?')) {
                            if (inv._synced && inv.id) {
                              await db.from('bucket_list').update({ status: 'pending', sent_to_user_id: null, sent_to_username: null }).eq('id', inv.id);
                            }
                            setInvoices(prev => { const next = prev.map((x, idx) => idx === i ? { ...x, status: 'pending', sent_to_username: null } : x); saveLocalBucket(next); return next; });
                          }
                        }}
                        style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}> 
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button title="View" onClick={() => setBucketPopup({ show: true, mode: 'view', rowKey })}
                        style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                      <button title="Edit" onClick={() => setBucketPopup({ show: true, mode: 'edit', rowKey })}
                        style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #ddd', background: '#f5f5f5', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={async () => {
                          if (inv._synced && inv.id) { await db.from('bucket_list').delete().eq('id', inv.id); }
                          setInvoices(list => { const next = list.filter((_, idx2) => idx2 !== i); saveLocalBucket(next); return next; });
                          setSelectedRows(prev => { const next = new Set(prev); next.delete(rowKey); return next; });
                        }}
                        style={{ width: '24px', height: '24px', borderRadius: '5px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      </button>
                    </div>
                  )}
                </td>

              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── GenerateExport (Batch Preview) ───────────────────────────────────────────
function GenerateExport({ invoices, onNewBatch, onBack, batchConfig = {}, supplierItems = [], vendorRuleItems = [] }) {
  const [exported, setExported]   = useState(false);
  const [exporting, setExporting] = useState(false);

  const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

  const fmtDate = (d) => { if (!d) return ''; const s = String(d).replace(/-/g, ''); return s.length === 8 ? s.slice(2) : s; };
  // ── เฉพาะ column O (Due Date) / P (Tax Invoice Date) ต้องเป็น DDMMYY ──
  const fmtDateDMY = (d) => {
    if (!d) return '';
    const s = String(d).replace(/-/g, '');
    if (s.length !== 8) return s;
    const y = s.slice(0, 4), m = s.slice(4, 6), day = s.slice(6, 8);
    return day + m + y.slice(2);
  };

  const getMatchedRule = (supplierCode) => {
    const vendorInfo = supplierItems.find(s => {
      const code = String(s['Code'] ?? '').trim().toLowerCase();
      const sup  = String(supplierCode ?? '').trim().toLowerCase();
      const bu   = String(batchConfig?.bu ?? '').toLowerCase();
      return code === sup || code === `${bu}-${sup}`;
    });
    if (!vendorInfo?.['Notice']) return null;
    const notices = vendorInfo['Notice'].split('|').map(n => n.trim()).filter(Boolean);
    for (const notice of notices) {
      const rule = vendorRuleItems.find(r => String(r['item'] ?? '').trim().toLowerCase() === notice.toLowerCase());
      if (rule) return rule;
    }
    return null;
  };

  // build rows: H row + L rows สำหรับแต่ละ invoice
  const buildRows = () => {
    const rows = [];
    // ── เรียง invoices ให้ตรงกับลำดับใน Batch Bucket (patch46+48) ──────────
    // ── กลุ่ม invoice เดียวกัน: ไม่มี suffix ก่อน แล้ว /1 /2 ตามลำดับ ────────
    // ── ระหว่าง invoice คนละใบ: เรียงตามเวลาที่สร้าง ────────────────────────
    const getCreatedTimeForSort = (inv) => {
      if (inv.created_at) return new Date(inv.created_at).getTime();
      const m = String(inv._localId || '').match(/^local-(\d+)-/);
      return m ? parseInt(m[1], 10) : 0;
    };
    const parseInvSuffixForSort = (invNo) => {
      const s = String(invNo || '');
      const m = s.match(/^(.+)\/(\d+)$/);
      if (m) return { base: m[1], suf: parseInt(m[2], 10) };
      return { base: s, suf: 0 };
    };
    const sortedInvoices = [...invoices].sort((a, b) => {
      const pa = parseInvSuffixForSort(a.invoice_no), pb = parseInvSuffixForSort(b.invoice_no);
      if (pa.base !== pb.base) return getCreatedTimeForSort(a) - getCreatedTimeForSort(b);
      return pa.suf - pb.suf;
    });
    sortedInvoices.forEach((inv, idx) => {
      const fd    = inv.form_data || {};
      const lines = inv.lines || [];
      const rule  = getMatchedRule(fd.supplierCode);

      const bu = String(batchConfig?.bu ?? '').toLowerCase();
      const vi = supplierItems.find(s => {
        const c  = String(s['Code'] ?? '').trim().toLowerCase();
        const sc = String(fd.supplierCode ?? '').trim().toLowerCase();
        return c === sc || c === `${bu}-${sc}`;
      });
      const vendorSite = vi?.['Supplier Site'] || '';
      const vendorCode = vi?.['Supplier Number'] || fd.supplierCode || '';
      const branchCode = String(fd.branchDirectLabel || '').split('-')[0].trim();
      const derivedVat = lines.some(l => {
        const tc = String(l.taxCode || '');
        return tc.includes('VAT7%') && !tc.includes('SVAT7%');
      }) ? 'Yes' : 'No';
      const totalAmt = lines.reduce((s, l) => s + (parseFloat(String(l.total || '').replace(/,/g, '')) || 0), 0);

      const dueDateCol = fd.dueDate ? fmtDateDMY(fd.dueDate) : '';
      const taxInvoiceDateCol = derivedVat === 'Yes'
        ? (fd.realVendorTaxDate ? fmtDateDMY(fd.realVendorTaxDate) : fmtDateDMY(fd.invDate))
        : '';

      rows.push({ type: 'H', idx, data: [
        'H',
        'APN',
        vendorCode,
        vendorSite,
        fmtDate(inv.receive_date || fd.invDate),
        inv.invoice_no || fd.invoiceNum || '',
        totalAmt !== 0 ? totalAmt : '',
        fd.grtNum || '',
        branchCode,
        lines.find(l => l.hl === 'H')?.desc || lines[0]?.desc || '',
        derivedVat,
        rule?.Method || '',
        rule?.Paygroup || '',
        rule?.Par || '',
        dueDateCol, taxInvoiceDateCol,
        fd.grn || '',
        fd.realInvoiceNo || '',
        '', '', '', '', '', '', '',
        'AP Manual', '',
        fd.realVendorName || '',
        fd.realVendorTaxid || '',
        fd.realVendorBranch || '',
      ]});

      lines.forEach(line => {
        const acct = String(line.account || '').split('-');
        const lAmt = parseFloat(String(line.amount || '').replace(/,/g, '')) || '';
        rows.push({ type: 'L', idx, data: [
          'L',
          line.desc || '',
          lAmt,
          line.taxCode || '',
          '',
          acct[0] || '',
          acct[1] || '',
          acct[2] || '',
          '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        ]});
      });
    });
    return rows;
  };

  const rows = buildRows();

  const COL_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD'];
  const [colWidths, setColWidths] = useState(() => Object.fromEntries(COL_LABELS.map((c,i) => [c, i === 0 ? 36 : i < 2 ? 180 : i < 5 ? 70 : 90])));

  // ── Column Auto-fit: กว้างตามข้อมูลจริง, คอลัมน์ไม่มีข้อมูลเลยให้ width=5 ──
  React.useEffect(() => {
    const CHAR_W = 6.5, PAD = 16, MIN = 40, MAX = 220;
    const widths = {};
    COL_LABELS.forEach((c, ci) => {
      let hasData = false, maxLen = c.length;
      rows.forEach(r => {
        const v = r.data?.[ci];
        const s = (v === null || v === undefined) ? '' : String(v);
        if (s.trim() !== '') { hasData = true; if (s.length > maxLen) maxLen = s.length; }
      });
      widths[c] = hasData ? Math.min(MAX, Math.max(MIN, Math.round(maxLen * CHAR_W + PAD))) : 5;
    });
    setColWidths(widths);
  }, [invoices]);
  const [resizing, setResizing] = useState(null);
  const [copied, setCopied] = useState(false);
  const resizeRef = React.useRef(null);
  const [sel, setSel] = useState({ r1: -1, c1: -1, r2: -1, c2: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const mousePosRef = React.useRef({ x: 0, y: 0 });

  const isSel = (ri, ci) => {
    if (sel.r1 < 0) return false;
    const r1=Math.min(sel.r1,sel.r2),r2=Math.max(sel.r1,sel.r2),c1=Math.min(sel.c1,sel.c2),c2=Math.max(sel.c1,sel.c2);
    return ri>=r1&&ri<=r2&&ci>=c1&&ci<=c2;
  };

  const bookLabel = (() => {
    const bookCode = String(batchConfig?.buInfo?.['BOOK'] ?? '').trim() || batchConfig?.bu || '';
    return bookCode ? `${bookCode} BOOK` : 'BOOK';
  })();
  const cellStyle = {
    padding: '3px 5px', borderRight: '0.5px solid #e8eaf0', borderBottom: '0.5px solid #e8eaf0',
    whiteSpace: 'nowrap', fontSize: '11px', fontFamily: 'monospace', maxWidth: '160px',
    overflow: 'hidden', textOverflow: 'ellipsis',
  };

  const copySelection = React.useCallback(() => {
    if (sel.r1 < 0) return;
    const allRows = [{ data: [bookLabel, ...Array(29).fill('')] }, ...rows];
    const r1=Math.min(sel.r1,sel.r2),r2=Math.max(sel.r1,sel.r2),c1=Math.min(sel.c1,sel.c2),c2=Math.max(sel.c1,sel.c2);
    const lines=[];
    for(let r=r1;r<=r2;r++){const row=allRows[r];if(!row)continue;const cells=[];for(let c=c1;c<=c2;c++)cells.push(String(row.data?.[c]??''));lines.push(cells.join(String.fromCharCode(9)));}
    const text = lines.join(String.fromCharCode(13,10));
    fallbackCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [sel, rows, bookLabel]);

  const fallbackCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0;z-index:-1';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch(e) { console.warn('copy failed', e); }
    document.body.removeChild(ta);
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
    return ok;
  };

  const scrollRef = React.useRef(null);
  const [ctxMenu, setCtxMenu] = useState({ show: false, x: 0, y: 0 });

  const totalRowCount = rows.length + 1;
  const totalColCount = 30;

  // ── DIAGNOSTIC: capture-phase probe ติดครั้งเดียวตลอด session ──────────
  React.useEffect(() => {
    const probe = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        console.log('[CAPTURE-PROBE] Ctrl+A detected at', new Date().toISOString(), 'defaultPrevented(before)=', e.defaultPrevented, 'activeEl=', document.activeElement?.tagName, document.activeElement?.className, 'hasFocus=', document.hasFocus());
      }
    };
    window.addEventListener('keydown', probe, true);
    return () => window.removeEventListener('keydown', probe, true);
  }, []);

  // ── เก็บค่าล่าสุดไว้ใน ref เพื่อให้ useEffect ด้านล่าง attach listener ──
  // ── ได้ "ครั้งเดียว" จริงๆ (deps ว่าง) ไม่ churn ทุกครั้งที่ sel เปลี่ยน ──
  // ── (root cause ของ Ctrl+A ที่หายเป็นพักๆ แล้วกลับมาติดตอน remount) ──
  const keyHandlerLatestRef = React.useRef({});
  keyHandlerLatestRef.current = { copySelection, totalRowCount, totalColCount };

  React.useEffect(() => {
    const onKey = (e) => {
      const { copySelection, totalRowCount, totalColCount } = keyHandlerLatestRef.current;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); e.stopPropagation(); copySelection(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault(); e.stopPropagation();
        setSel({ r1: 0, c1: 0, r2: totalRowCount - 1, c2: totalColCount - 1 });
        return;
      }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
        setSel(s => {
          if (s.r1 < 0) return s;
          let r = s.r1, c = s.c1;
          if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
          if (e.key === 'ArrowDown') r = Math.min(totalRowCount - 1, r + 1);
          if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
          if (e.key === 'ArrowRight') c = Math.min(totalColCount - 1, c + 1);
          return { r1: r, c1: c, r2: r, c2: c };
        });
        setTimeout(() => {
          if (!scrollRef.current) return;
          const cont = scrollRef.current;
          const activeCell = cont.querySelector('[data-active="true"]');
          if (activeCell) {
            const cr = activeCell.getBoundingClientRect();
            const pr = cont.getBoundingClientRect();
            if (cr.right > pr.right - 10) cont.scrollLeft += cr.right - pr.right + 10;
            else if (cr.left < pr.left + 46) cont.scrollLeft -= pr.left + 46 - cr.left;
            if (cr.bottom > pr.bottom - 10) cont.scrollTop += cr.bottom - pr.bottom + 10;
            else if (cr.top < pr.top + 10) cont.scrollTop -= pr.top + 10 - cr.top;
          }
        }, 0);
      }
      if (e.key === 'Escape') { setSel({ r1: -1, c1: -1, r2: -1, c2: -1 }); setCtxMenu(m => ({ ...m, show: false })); }
    };
    const onUp = (e) => {
      if (e.button !== 2) setIsDragging(false);
      if (resizeRef.current) { resizeRef.current = null; setResizing(null); }
    };
    const onResizeMove = (e) => {
      if (!resizeRef.current) return;
      const { col, startX, startW } = resizeRef.current;
      const newW = Math.max(40, startW + e.clientX - startX);
      setColWidths(w => ({ ...w, [col]: newW }));
    };
    window.addEventListener('mousemove', onResizeMove);
    const onCtxClose = (e) => { if (e.button !== 2) setCtxMenu(m => ({ ...m, show: false })); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('click', onCtxClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('click', onCtxClose);
      window.removeEventListener('mousemove', onResizeMove);
    };
  }, []); // ← deps ว่าง: attach ครั้งเดียวตลอด lifetime ของ component

  const handleMouseOver = React.useCallback((ri, ci) => {
    if (!isDragging) return;
    setSel(s => ({ ...s, r2: ri, c2: ci }));
  }, [isDragging]);

  React.useEffect(() => {
    if (!isDragging) return;
    const ZONE = 40, SPEED = 12;
    const tick = () => {
      const cont = scrollRef.current;
      if (!cont) return;
      const rect = cont.getBoundingClientRect();
      const { x, y } = mousePosRef.current;
      let scrolled = false;
      if (x > rect.right - ZONE) { cont.scrollLeft += SPEED; scrolled = true; }
      else if (x < rect.left + ZONE) { cont.scrollLeft -= SPEED; scrolled = true; }
      if (y > rect.bottom - ZONE) { cont.scrollTop += SPEED; scrolled = true; }
      else if (y < rect.top + ZONE) { cont.scrollTop -= SPEED; scrolled = true; }
      // ── เนื้อหาเลื่อนใต้เมาส์ที่นิ่ง จะไม่มี onMouseOver ยิงเอง ──
      // ── ต้องเช็คเองว่าใต้เมาส์ตอนนี้เป็นเซลล์ไหน แล้วขยาย selection ตาม ──
      if (scrolled) {
        const el = document.elementFromPoint(x, y);
        const td = el?.closest('[data-r]');
        if (td) {
          const r = parseInt(td.getAttribute('data-r'), 10);
          const c = parseInt(td.getAttribute('data-c'), 10);
          if (!isNaN(r) && !isNaN(c)) setSel(s => (s.r2 === r && s.c2 === c) ? s : { ...s, r2: r, c2: c });
        }
      }
    };
    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [isDragging]);

  const doExport = async () => {
    if (!invoices.length) { alert('No invoices in batch'); return; }
    setExporting(true);
    try {
      const ids = invoices.filter(inv => inv.id).map(inv => inv.id);
      if (ids.length) {
        const { error } = await db.from('bucket_list').update({ status: 'done', exported_at: new Date().toISOString() }).in('id', ids);
        if (error) throw error;
      }
      setExported(true);
    } catch (e) { alert('Export failed: ' + e.message); }
    setExporting(false);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '14px 18px', outline: 'none' }}
      tabIndex={-1}
      onMouseLeave={() => setIsDragging(false)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexShrink: 0 }}>
        <button style={btnOutline} onClick={onBack}>&#8592; Back to edit</button>
        <button disabled={exporting || exported} onClick={doExport}
          style={{ ...btnPrimary, background: exported ? '#27500A' : '#1a3a5c', opacity: exporting ? 0.6 : 1, cursor: exporting || exported ? 'default' : 'pointer' }}>
          {exported ? 'Exported' : exporting ? 'Exporting...' : 'Generate & Export'}
        </button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', border: '0.5px solid #e8eaf0', borderRadius: '8px', userSelect: 'none', position: 'relative' }}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ show: true, x: e.clientX, y: e.clientY }); }}
        onMouseMove={(e) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '11px', width: '100%', minWidth: '2400px' }}>
          <thead>
            <tr>
              <th onClick={() => setSel({ r1: 0, c1: 0, r2: rows.length + 50, c2: 29 })}
                style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.4)', padding: '2px 5px', textAlign: 'center', fontSize: '9px', borderRight: '0.5px solid rgba(255,255,255,0.15)', position: 'sticky', top: 0, left: 0, zIndex: 3, cursor: 'pointer', minWidth: '36px', width: '36px' }} title="Select all">
                #
              </th>
              {COL_LABELS.map((c, ci) => (
                <th key={c}
                  onClick={(e) => { if(e.shiftKey && sel.c1>=0){ setSel(s=>({...s,c2:ci,r1:0,r2:totalRowCount-1})); } else { setSel({r1:0,c1:ci,r2:totalRowCount-1,c2:ci}); } }}
                  style={{ background: sel.c1 <= ci && ci <= sel.c2 && sel.r1 === 0 && sel.r2 >= totalRowCount-1 ? '#1a3a5c' : '#2c4a6e', color: 'rgba(255,255,255,0.8)', padding: '2px 0 2px 5px', textAlign: 'center', fontSize: '9px', fontWeight: '400', borderRight: '0.5px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1, cursor: 'pointer', userSelect: 'none', width: colWidths[c] || 90, minWidth: colWidths[c] || 90 }}>
                  {c}
                  <div onMouseDown={(e) => { e.stopPropagation(); resizeRef.current = { col: c, startX: e.clientX, startW: colWidths[c] || 90 }; setResizing(c); }}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px', cursor: 'col-resize', background: resizing === c ? 'rgba(255,255,255,0.5)' : 'transparent', zIndex: 2 }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-r={0} data-c={0} style={{ ...cellStyle, background: '#f0f0f0', color: '#aaa', textAlign: 'center', position: 'sticky', left: 0, zIndex: 1, fontFamily: 'var(--font-sans)', width: '36px' }}>1</td>
              {COL_LABELS.map((c, ci) => (
                <td key={c}
                  data-r={0} data-c={ci}
                  onMouseDown={(e) => { if (e.button === 2) return; setSel({ r1: 0, c1: ci, r2: 0, c2: ci }); setIsDragging(true); }}
                  onMouseOver={(e) => handleMouseOver(0, ci, e)}
                  style={{ ...cellStyle, background: isSel(0, ci) ? '#c8dffe' : '#f8f9fa', color: '#aaa', outline: isSel(0, ci) ? '1px solid #378ADD' : 'none', outlineOffset: '-1px', cursor: 'cell' }}>
                  {ci === 0 ? bookLabel : ''}
                </td>
              ))}
            </tr>
            {rows.map((row, ri) => {
              const isH = row.type === 'H';
              const isFirstH = isH && (ri === 0 || rows[ri - 1]?.idx !== row.idx);
              const rowNum = ri + 2;
              return (
                <React.Fragment key={ri}>
                  {isFirstH && ri > 0 && (
                    <tr>
                      <td style={{ padding: 0, height: '2px', background: '#1a3a5c', border: 'none', position: 'sticky', left: 0 }}></td>
                      {COL_LABELS.map(c => <td key={c} style={{ padding: 0, height: '2px', background: '#1a3a5c', border: 'none' }}></td>)}
                    </tr>
                  )}
                  <tr style={{ background: isH ? '#E6F1FB' : 'white' }}>
                    <td onClick={() => setSel({r1:ri+1,c1:0,r2:ri+1,c2:totalColCount-1})}
                      data-r={ri + 1} data-c={0}
                      style={{ ...cellStyle, background: isH ? '#dbeafa' : '#f5f5f5', color: isH ? '#0C447C' : '#aaa', textAlign: 'center', position: 'sticky', left: 0, zIndex: 1, fontFamily: 'var(--font-sans)', width: '36px', cursor: 'pointer' }}>{rowNum}</td>
                    {row.data.slice(0, 30).map((val, ci) => (
                      <td key={ci}
                        onMouseDown={(e) => { if (e.button === 2) return; e.currentTarget.closest('[tabindex]')?.focus(); if(e.shiftKey&&sel.r1>=0){setSel(s=>({...s,r2:ri+1,c2:ci}));}else{setSel({r1:ri+1,c1:ci,r2:ri+1,c2:ci});setIsDragging(true);} }}
                        onMouseOver={(e) => handleMouseOver(ri + 1, ci, e)}
                        data-r={ri + 1} data-c={ci}
                        data-active={sel.r1 === ri + 1 && sel.r2 === ri + 1 && sel.c1 === ci && sel.c2 === ci ? 'true' : undefined}
                        style={{ ...cellStyle, width: colWidths[COL_LABELS[ci]] || 90, minWidth: colWidths[COL_LABELS[ci]] || 90, color: isH ? '#0C447C' : '#333', background: isSel(ri + 1, ci) ? '#c8dffe' : undefined, outline: copied && isSel(ri + 1, ci) ? '2px dashed #1a7a1a' : isSel(ri + 1, ci) ? '1px solid #378ADD' : 'none', outlineOffset: '-1px', cursor: 'cell' }}>
                        {val === '' || val === null || val === undefined ? '' : String(val)}
                      </td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
            {invoices.length === 0 && (
              <tr><td colSpan={31} style={{ textAlign: 'center', color: '#aaa', padding: '24px', fontSize: '12px' }}>No invoices</td></tr>
            )}
            {Array.from({ length: Math.max(0, 100 - rows.length - 1) }).map((_, i) => {
              const rNum = rows.length + i + 2;
              return (
                <tr key={`pad-${i}`}>
                  <td data-r={rows.length + i + 1} data-c={0} style={{ ...cellStyle, background: '#f5f5f5', color: '#aaa', textAlign: 'center', position: 'sticky', left: 0, fontFamily: 'var(--font-sans)', width: '36px' }}>{rNum}</td>
                  {COL_LABELS.map((c, ci) => (
                    <td key={c}
                      data-r={rows.length + i + 1} data-c={ci}
                      onMouseDown={(e) => { if (e.button === 2) return; e.currentTarget.closest('[tabindex]')?.focus(); setSel({ r1: rows.length + i + 1, c1: ci, r2: rows.length + i + 1, c2: ci }); setIsDragging(true); }}
                      onMouseOver={(e) => handleMouseOver(rows.length + i + 1, ci, e)}
                      style={{ ...cellStyle, background: isSel(rows.length + i + 1, ci) ? '#c8dffe' : 'white', height: '22px', cursor: 'cell', outline: isSel(rows.length + i + 1, ci) ? '1px solid #378ADD' : 'none', outlineOffset: '-1px' }}></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ctxMenu.show && (
        <div style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, background: 'white', border: '0.5px solid #e8eaf0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 999, minWidth: '160px', padding: '4px 0', fontSize: '12px' }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <div onClick={() => { copySelection(); setCtxMenu(m=>({...m,show:false})); }}
            style={{ padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: '#333' }}
            onMouseEnter={e=>e.currentTarget.style.background='#f5f5f5'}
            onMouseLeave={e=>e.currentTarget.style.background='white'}>
            Copy (Ctrl+C)
          </div>
          <div onClick={() => { setSel({ r1: 0, c1: 0, r2: rows.length + 50, c2: 29 }); setCtxMenu(m=>({...m,show:false})); }}
            style={{ padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: '#333' }}
            onMouseEnter={e=>e.currentTarget.style.background='#f5f5f5'}
            onMouseLeave={e=>e.currentTarget.style.background='white'}>
            Select All
          </div>
        </div>
      )}
      {exported && (
        <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button style={btnOutline} onClick={onNewBatch}>+ New Batch</button>
        </div>
      )}
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// SendToModal — ส่ง Batch Bucket ให้ user อื่นในระบบ
// ─────────────────────────────────────────────────────────────────────────────
function SendToModal({ show, onClose, onSend, selectedCount, totalAmount, currentUserId }) {
  const [users, setUsers]       = useState([]);
  const [toUserId, setToUserId] = useState('');
  const [note, setNote]         = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!show) return;
    setToUserId(''); setNote(''); setError('');
    const load = async () => {
      try {
        const { data } = await db.from('user_roles').select('id, username, email, role').order('username');
        setUsers((data || []).filter(u => u.id !== currentUserId));
      } catch (e) { console.error('SendToModal load users:', e); }
    };
    load();
  }, [show, currentUserId]);

  if (!show) return null;

  const handleSend = async () => {
    if (!toUserId) { setError('กรุณาเลือกผู้รับ'); return; }
    setSending(true);
    setError('');
    try {
      await onSend({ toUserId, toUsername: users.find(u => u.id === toUserId)?.username || '', note });
      onClose();
    } catch (e) { setError('ส่งไม่สำเร็จ: ' + e.message); }
    setSending(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '360px', boxShadow: '0 20px 60px rgba(26,58,92,0.22)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid #f0f2f5', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>📤</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>Send Batch To</div>
            <div style={{ fontSize: '11px', color: '#aaa' }}>Invoice ที่เลือกจะย้ายไปยัง bucket ของผู้รับ</div>
          </div>
          <button onClick={onClose} style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {error && <div style={{ padding: '8px 12px', background: '#FCEBEB', color: '#791F1F', borderRadius: '6px', fontSize: '12px' }}>⚠️ {error}</div>}
          <div>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '5px' }}>ส่งให้ <span style={{ color: '#e24b4a' }}>*</span></label>
            <select value={toUserId} onChange={e => { setToUserId(e.target.value); setError(''); }}
              style={{ width: '100%', height: '34px', padding: '0 10px', fontSize: '13px', border: '0.5px solid #ddd', borderRadius: '7px', background: 'white', color: '#1a3a5c', outline: 'none', cursor: 'pointer' }}>
              <option value="">— เลือก user —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.username || u.email} ({u.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '5px' }}>หมายเหตุ (ถ้ามี)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ช่วยทำต่อด้วยนะครับ ติดประชุมอยู่"
              style={{ width: '100%', height: '68px', padding: '8px 10px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '7px', background: 'white', color: '#1a3a5c', outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ background: '#f8f9fa', borderRadius: '7px', padding: '10px 14px', fontSize: '12px', color: '#555' }}>
            <strong style={{ color: '#1a3a5c' }}>{selectedCount} invoice{selectedCount > 1 ? 's' : ''}</strong> ที่เลือก
            {totalAmount > 0 && <> · รวม <strong style={{ color: '#1a3a5c' }}>{totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</strong></>}
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '0.5px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#fafbfc' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: '7px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '12px', cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={handleSend} disabled={sending || !toUserId}
            style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', background: (sending || !toUserId) ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: (sending || !toUserId) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            📤 {sending ? 'กำลังส่ง...' : 'ส่ง'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice History — สำหรับหน้า "Draft List" (เปลี่ยนเป็น Invoice History) ──
// ── ดึงจาก bucket_list (status='done') กรองตาม Receive Date + My/All ──────────
export function InvoiceHistoryPage({ currentUser, userName = '', isOwner = false, isAdmin = false }) {
  const canSeeAll = isOwner || isAdmin;
  // ── mainTab: 'myjob' (≤7 วัน ของตัวเอง) / 'myhistory' (>7 วัน ของตัวเอง) ──
  // ── / 'invoicehistory' (Admin·Owner เท่านั้น เห็นของทุกคน) ────────────────
  const [mainTab, setMainTab] = React.useState('myjob');
  const [subTab, setSubTab] = React.useState('recent'); // 'recent' | 'history' — ใช้เมื่อ mainTab==='invoicehistory'
  const [rowsData, setRowsData] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [search, setSearch] = React.useState('');

  const fetchHistory = React.useCallback(async () => {
    setLoading(true);
    try {
      // ── คำนวณสดตอนเรียกจริงแต่ละครั้ง (ไม่ใช่ตัวแปรนอกที่ทำ dependency ──
      // ── เปลี่ยนทุก render จนวนลูปไม่มีที่สิ้นสุด — เคยเป็นบั๊กมาก่อน) ──────
      const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let query = `/bucket_list?eq_status=done`;
      const isAllUsers = mainTab === 'invoicehistory';
      if (!isAllUsers) {
        query += `&eq_created_by=${encodeURIComponent(userName || currentUser?.email || '')}`;
      }
      // ── ตัดสินว่า "เร็ว" (≤7 วัน) หรือ "เก่า" (>7 วัน) จาก mainTab/subTab ──
      const isRecent = isAllUsers ? subTab === 'recent' : mainTab === 'myjob';
      if (isRecent) query += `&gte_exported_at=${sevenDaysAgoISO}`;
      else query += `&lt_exported_at=${sevenDaysAgoISO}`;
      if (dateFrom) query += `&gte_receive_date=${dateFrom}`;
      if (dateTo) query += `&lte_receive_date=${dateTo}`;
      query += `&order=receive_date.desc`;
      const data = await apiFetch(query);
      setRowsData(Array.isArray(data) ? data : []);
    } catch (e) { console.error('fetch invoice history:', e); }
    setLoading(false);
  }, [mainTab, subTab, dateFrom, dateTo, userName, currentUser]);

  React.useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const [restoringId, setRestoringId] = React.useState(null);
  const handleRestore = async (inv) => {
    if (!window.confirm(`ต้องการ Restore invoice "${inv.invoice_no || '-'}" กลับไปที่ Batch Bucket ใช่ไหม?`)) return;
    setRestoringId(inv.id);
    try {
      const { error } = await db.from('bucket_list')
        .update({ status: 'pending', restored_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) throw error;
      setRowsData(prev => prev.filter(r => r.id !== inv.id));
    } catch (e) {
      console.error('restore invoice:', e);
      alert('Restore ไม่สำเร็จ: ' + e.message);
    }
    setRestoringId(null);
  };

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  React.useEffect(() => { setPage(1); }, [mainTab, subTab, dateFrom, dateTo, search]);

  const filtered = search.trim()
    ? rowsData.filter(r =>
        String(r.invoice_no || '').toLowerCase().includes(search.toLowerCase()) ||
        String(r.vendor_name || '').toLowerCase().includes(search.toLowerCase()))
    : rowsData;

  const effectivePageSize = pageSize === 0 ? (filtered.length || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const paginated = pageSize === 0 ? filtered : filtered.slice((page - 1) * effectivePageSize, page * effectivePageSize);
  const getPageWindow = () => {
    const size = 5;
    let start = Math.max(1, page - Math.floor(size / 2));
    let end = Math.min(totalPages, start + size - 1);
    if (end - start < size - 1) start = Math.max(1, end - size + 1);
    const pages = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };
  const pageBtnStyle = (active, disabled) => ({ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: disabled ? 'default' : 'pointer', background: active ? '#1a3a5c' : 'white', color: disabled ? '#ccc' : active ? 'white' : '#555', minWidth: '28px', textAlign: 'center' });

  const p2 = (n) => String(n).padStart(2, '0');
  const fmtD = (d) => d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : '—';
  const fmtDT = (d) => d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—';
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', color: '#1a3a5c' }}>📄 Invoice History</h2>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>รายการ Invoice ที่ Export ออกจากระบบแล้ว</div>

      {/* ── แถว: Tab เท่านั้น ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '0.5px solid #ddd', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => setMainTab('myjob')} style={{ padding: '6px 14px', fontSize: '12px', border: 'none', background: mainTab === 'myjob' ? '#1a3a5c' : 'white', color: mainTab === 'myjob' ? 'white' : '#555', cursor: 'pointer' }}>👤 My Job</button>
          <button onClick={() => setMainTab('myhistory')} style={{ padding: '6px 14px', fontSize: '12px', border: 'none', borderLeft: '0.5px solid #ddd', background: mainTab === 'myhistory' ? '#1a3a5c' : 'white', color: mainTab === 'myhistory' ? 'white' : '#555', cursor: 'pointer' }}>🕓 My History</button>
          {canSeeAll && (
            <button onClick={() => setMainTab('invoicehistory')} style={{ padding: '6px 14px', fontSize: '12px', border: 'none', borderLeft: '0.5px solid #ddd', background: mainTab === 'invoicehistory' ? '#1a3a5c' : 'white', color: mainTab === 'invoicehistory' ? 'white' : '#555', cursor: 'pointer' }}>👥 Invoice History</button>
          )}
        </div>
      </div>

      {/* ── sub-tab ขีดเส้นใต้: Recent / History — โผล่แค่ตอนอยู่ tab Invoice History ── */}
      {mainTab === 'invoicehistory' && (
        <div style={{ display: 'flex', gap: '18px', marginBottom: '12px', borderBottom: '0.5px solid #e8eaf0' }}>
          {[{ key: 'recent', label: 'Recent (≤7 วัน)' }, { key: 'history', label: 'History (>7 วัน)' }].map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              style={{ padding: '8px 2px', fontSize: '12px', cursor: 'pointer', border: 'none', background: 'transparent', borderBottom: subTab === t.key ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom: '-0.5px', color: subTab === t.key ? '#1a3a5c' : '#888', fontWeight: subTab === t.key ? '500' : '400' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" placeholder="ค้นหา Invoice No. / Vendor" value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '6px 10px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', width: '260px', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: '#888' }}>Receive Date</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 10px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px' }} />
          <span style={{ fontSize: '12px', color: '#888' }}>ถึง</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 10px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ padding: '4px 6px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white', cursor: 'pointer' }}>
            {[25, 50, 100, 200, 0].map(s => <option key={s} value={s}>{s === 0 ? 'ทั้งหมด' : s}</option>)}
          </select>
          <span style={{ fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>รายการ/หน้า</span>
          <button style={pageBtnStyle(false, page === 1)} disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button style={pageBtnStyle(false, page === 1)} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          {getPageWindow().map(p => (
            <button key={p} style={pageBtnStyle(p === page, false)} onClick={() => setPage(p)}>{p}</button>
          ))}
          <button style={pageBtnStyle(false, page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          <button style={pageBtnStyle(false, page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
          <span style={{ fontSize: '12px', color: '#888', marginLeft: '2px', whiteSpace: 'nowrap' }}>{page} / {totalPages}</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '0.5px solid #e8eaf0', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {['Invoice No.', 'BU', 'Vendor', 'Branch', 'Receive Date', 'Exported At', 'Amount', 'Vat', 'Total', ...(mainTab === 'invoicehistory' ? ['Created By'] : []), 'Action'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Amount', 'Vat', 'Total'].includes(h) ? 'right' : h === 'Action' ? 'center' : 'left', fontWeight: 500, color: '#888', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', color: '#aaa', padding: '24px' }}>Loading...</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', color: '#aaa', padding: '24px' }}>ไม่มี Invoice ใน History</td></tr>
            ) : paginated.map(inv => {
              const rd = inv.receive_date ? new Date(inv.receive_date) : null;
              const ea = inv.exported_at ? new Date(inv.exported_at) : null;
              return (
                <tr key={inv.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#1a3a5c', fontWeight: 600 }}>{inv.invoice_no || '-'}</td>
                  <td style={{ padding: '8px 10px' }}><span style={{ background: '#f0f3f8', color: '#1a3a5c', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>{inv.bu || '-'}</span></td>
                  <td style={{ padding: '8px 10px' }}>{inv.vendor_name || '-'}</td>
                  <td style={{ padding: '8px 10px' }}>{inv.branch_no || '-'}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtD(rd)}</td>
                  <td style={{ padding: '8px 10px', color: '#888' }}>{fmtDT(ea)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNum(inv.amount)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNum(inv.vat)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtNum(inv.net)}</td>
                  {mainTab === 'invoicehistory' && <td style={{ padding: '8px 10px', color: '#666' }}>{inv.created_by || '-'}</td>}
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button onClick={() => handleRestore(inv)} disabled={restoringId === inv.id}
                      style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '5px', border: '0.5px solid #c5d8f0', background: restoringId === inv.id ? '#f0f0f0' : '#eef4fb', color: '#1a3a5c', cursor: restoringId === inv.id ? 'default' : 'pointer' }}>
                      {restoringId === inv.id ? '...' : '↩ Restore'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function APController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const { fetchCollection, getCached } = useDataCache();
  const { userName, currentUser }      = useAuth();
  const [step, setStep]               = useState(1);
  const [batchConfig, setBatchConfig] = useState(null);
  const [invoices, setInvoices]       = useState([]);
  // ✅ optimistic override ของเลข running GRT/GRN ล่าสุด (อัปเดตจาก InvoiceEntry ทุกครั้งที่ submit)
  const [runningOverride, setRunningOverride] = useState(null); // { bu, ap_grt, ap_grn }

  useEffect(() => {
    fetchCollection('CompanyList'); fetchCollection('SupplierList'); fetchCollection('BranchList');
    fetchCollection('AccountList'); fetchCollection('SubAccList');   fetchCollection('CpcList');
    fetchCollection('ItemcodeList'); fetchCollection('VendorCategory'); fetchCollection('NoticeList'); fetchCollection('VendorRule');
    fetchCollection('SmCodeList');
  }, []);

  const infoItemsRaw    = getCached('CompanyList') || [];
  // ✅ merge ค่า ap_grt/ap_grn ล่าสุด (optimistic) เข้ากับ CompanyList ก่อนส่งให้ BatchSetup
  const infoItems       = runningOverride
    ? infoItemsRaw.map(i => (
        String(i['bu'] ?? '').toLowerCase() === String(runningOverride.bu ?? '').toLowerCase()
          ? { ...i, ap_grt: runningOverride.ap_grt, ap_grn: runningOverride.ap_grn }
          : i
      ))
    : infoItemsRaw;
  const supplierItems   = getCached('SupplierList') || [];
  const branchItems     = getCached('BranchList');
  const accountItems    = getCached('AccountList');
  const subAccItems     = getCached('SubAccList');
  const cpcItems        = getCached('CpcList');
  const itemcodeItems   = getCached('ItemcodeList');
  const categoryItems   = getCached('VendorCategory');
  const noticeItems     = getCached('NoticeList');
  const vendorRuleItems = getCached('VendorRule');
  const smCodeItems     = getCached('SmCodeList') || [];

  const handleStart    = (config) => { setBatchConfig({ ...config, batchId: `${config.bu}-${config.receiveDate}-${Date.now()}` }); setStep(2); };
  const handleNewBatch = () => { setBatchConfig(null); setInvoices([]); setStep(1); };
  const handleRunningChange = (bu, vals) => { if (!bu) return; setRunningOverride({ bu, ...vals }); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f7fa', fontFamily: 'sans-serif', fontSize: '13px', overflow: 'hidden' }}>
      <div style={{ background: 'white', borderBottom: '0.5px solid #e8eaf0', padding: '9px 18px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <span style={{ fontSize: '17px' }}>🧾</span>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>AP Controller</div>
          <div style={{ fontSize: '11px', color: '#aaa' }}>Accounts Payable Invoice Management</div>
        </div>
      </div>
      <StepBar step={step} onGo={setStep} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {step === 1 && <BatchSetup onStart={handleStart} infoItems={infoItems} />}
        {step === 2 && (
          <InvoiceEntry batchConfig={batchConfig} invoices={invoices} setInvoices={setInvoices} onNext={() => setStep(3)}
            supplierItems={supplierItems} branchItems={branchItems} accountItems={accountItems} subAccItems={subAccItems}
            cpcItems={cpcItems} itemcodeItems={itemcodeItems} categoryItems={categoryItems} noticeItems={noticeItems}
            vendorRuleItems={vendorRuleItems} smCodeItems={smCodeItems} fetchCollection={fetchCollection}
            userName={userName || currentUser?.email || ''} currentUser={currentUser}
            onRunningChange={handleRunningChange} />
        )}
        {step === 3 && <GenerateExport invoices={invoices} onNewBatch={handleNewBatch} onBack={() => setStep(2)} batchConfig={batchConfig} supplierItems={supplierItems} vendorRuleItems={vendorRuleItems} />}
      </div>
    </div>
  );
}


