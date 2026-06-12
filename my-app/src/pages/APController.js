import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { useDataCache } from '../contexts/DataCacheContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

const PERIOD_OPTIONS = ['Current', 'Pre-Close'];

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

// ─────────────────────────────────────────────────────────────────────────────
// ItemCodeSearchPopup
// ─────────────────────────────────────────────────────────────────────────────
const ITEM_COMBO_FIELDS = ['dis_g', 'i_and_g', 'value', 'oth', 'spi1', 'spec_tx'];

function ItemCodeSearchPopup({ show, onClose, onSelect, itemcodeItems = [], fetchCollection, userName = '', currentUser, bu = '' }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [view, setView] = useState('search');
  const [saving, setSaving] = useState(false);
  const [nextCode, setNextCode] = useState('');
  const emptyForm = { bu: '', description: '', cpc: '', account: '', sub: '', dis_g: '', i_and_g: '', value: '', oth: '', spi1: '', spec_tx: '', keyword: '' };
  const [form, setForm] = useState(emptyForm);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => { if (show) { setQuery(''); setActive(-1); setView('search'); setTimeout(() => inputRef.current?.focus(), 60); } }, [show]);
  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') { if (view === 'search') onClose(); else setView('search'); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [show, onClose, view]);
  useEffect(() => { if (active < 0 || !listRef.current) return; listRef.current.querySelectorAll('tr[data-row]')[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useEffect(() => { if (show && view === 'new') { computeNextCode(); setForm(f => ({ ...f, bu: bu || '' })); } }, [show, view, bu]);

  const computeNextCode = async () => {
    let allCodes = [], from = 0;
    while (true) {
      const { data } = await supabase.from('itemcode_list').select('code').range(from, from + 999);
      if (!data || data.length === 0) break;
      allCodes = [...allCodes, ...data.map(d => d.code || '')];
      if (data.length < 1000) break;
      from += 1000;
    }
    const nums = allCodes.filter(c => /^C\d{7}$/.test(c)).map(c => parseInt(c.replace('C', ''), 10)).sort((a, b) => a - b);
    if (!nums.length) { setNextCode('C0000001'); return; }
    for (let i = 0; i < nums.length - 1; i++) { if (nums[i + 1] - nums[i] > 1) { setNextCode(`C${String(nums[i] + 1).padStart(7, '0')}`); return; } }
    setNextCode(`C${String(nums[nums.length - 1] + 1).padStart(7, '0')}`);
  };

  const handleSave = async () => {
    if (!form.description?.trim()) { alert('กรุณากรอก Description'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('itemcode_list').insert([{ ...form, code: nextCode, updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString() }]);
      if (error) throw error;
      if (fetchCollection) await fetchCollection('ItemcodeList', true);
      setView('search'); setForm(emptyForm);
    } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  if (!show) return null;

  const buLower = String(bu ?? '').toLowerCase();
  const buFiltered = itemcodeItems.filter(i => { const ib = String(i['bu'] ?? '').toLowerCase(); return ib === 'free' || (buLower && ib === buLower); });
  const q = query.trim().toLowerCase();
  const filtered0 = q ? buFiltered.filter(i => i['code']?.toLowerCase().includes(q) || i['description']?.toLowerCase().includes(q) || i['keyword']?.toLowerCase().includes(q) || i['cpc']?.toLowerCase().includes(q) || i['account']?.includes(q)) : buFiltered;
  const filtered = [...filtered0].sort((a, b) => String(a['code'] ?? '').localeCompare(String(b['code'] ?? ''), undefined, { numeric: true, sensitivity: 'base' }));

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0 && filtered[active]) { onSelect(filtered[active]); }
  };

  const COLS = [['code','Code','100px'],['bu','BU','60px'],['description','Description',''],['cpc','CPC','75px'],['account','Account','95px'],['sub','SUB','70px'],['spec_tx','SPEC-TX','80px']];
  const FIELD_OPTIONS = {};
  ITEM_COMBO_FIELDS.forEach(key => { FIELD_OPTIONS[key] = [...new Set(itemcodeItems.map(i => i[key]).filter(v => v !== undefined && v !== null && String(v).trim() !== ''))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })); });

  const fldStyle = { height: '28px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', width: '100%' };
  const taStyle  = { padding: '6px 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.4' };
  const NEW_FIELDS = [['description','Description *',3,'textarea2'],['cpc','CPC',1,'text'],['account','Account',1,'text'],['sub','SUB',1,'text'],['dis_g','Dis-G',1,'text'],['i_and_g','I&G',1,'text'],['value','VALUE',1,'text'],['oth','OTH',1,'text'],['spi1','SPI-1',1,'text'],['spec_tx','SPEC-TX',1,'text'],['keyword','Keyword',3,'textarea3']];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: view === 'new' ? '94vw' : '95vw', maxWidth: view === 'new' ? '720px' : '900px', height: '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.22)' }}>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, borderBottom: '1px solid #f0f2f5' }}>
          {view === 'new' && <button onClick={() => setView('search')} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f5f7fa', border: '0.5px solid #dde', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', color: '#555', fontSize: '12px', fontWeight: '500', flexShrink: 0 }}>← Back</button>}
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🔖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c' }}>{view === 'new' ? 'New Item Code' : 'Select Item Code'}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>{view === 'new' ? `Code: ${nextCode}` : `${filtered.length} รายการ${query ? ` · ค้นหา "${query}"` : ''} · BU: FREE${bu ? `, ${bu}` : ''}`}</div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        {view === 'search' ? (
          <>
            <div style={{ padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f0f2f5', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aab', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={handleKey} placeholder="ค้นหา Code, Description, CPC, Account, Keyword..."
                    style={{ width: '100%', padding: '9px 36px 9px 36px', fontSize: '13px', border: '1.5px solid #e2e6ed', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: 'white', color: '#1a3a5c' }}
                    onFocus={e => e.target.style.borderColor = '#1a3a5c'} onBlur={e => e.target.style.borderColor = '#e2e6ed'} />
                  {query && <button onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#e8eaf0', border: 'none', cursor: 'pointer', color: '#888', fontSize: '13px', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
                </div>
                <button onClick={() => { setView('new'); setForm({ ...emptyForm, bu: bu || '' }); }} style={{ height: '36px', padding: '0 16px', borderRadius: '8px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Item
                </button>
              </div>
            </div>
            <div ref={listRef} style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed', minWidth: '640px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>{COLS.map(([key, label, w]) => (<th key={key} style={{ background: '#1a3a5c', color: 'rgba(255,255,255,0.75)', padding: '9px 10px', textAlign: 'left', fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', width: w || undefined }}>{label}</th>))}</tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (<tr><td colSpan={COLS.length} style={{ textAlign: 'center', color: '#aaa', padding: '48px', fontSize: '13px' }}>ไม่พบ Item Code{query ? ` "${query}"` : ''}</td></tr>)
                  : filtered.map((item, i) => { const isAct = i === active; return (
                    <tr key={item.id || i} data-row={i} onClick={() => onSelect(item)} onMouseEnter={() => setActive(i)} style={{ background: isAct ? '#eef3fb' : 'white', cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6' }}>
                      {COLS.map(([key]) => (<td key={key} style={{ padding: '7px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key === 'code' ? <span style={{ background: isAct ? '#1a3a5c' : '#f0f3f8', color: isAct ? 'white' : '#1a3a5c', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', fontWeight: '600' }}>{item[key] || '-'}</span> : <span style={{ color: '#333' }}>{item[key] || '-'}</span>}</td>))}
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
              <span style={{ fontSize: '11px', color: '#bbb' }}>{filtered.length} / {buFiltered.length} รายการ</span>
              <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
              <div style={{ maxWidth: '520px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 12px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Code (Auto)</label><input value={nextCode} disabled style={{ ...fldStyle, background: '#f5f5f5', color: '#999' }} /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>BU</label><input value={form['bu'] || ''} onChange={e => setForm(f => ({ ...f, bu: e.target.value }))} style={fldStyle} /></div>
                </div>
                {NEW_FIELDS.map(([key, label, span, type]) => {
                  const isCombo = ITEM_COMBO_FIELDS.includes(key);
                  return (
                    <div key={key} style={{ gridColumn: `span ${span}` }}>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>{label}</label>
                      {type === 'textarea2' || type === 'textarea3' ? (
                        <textarea rows={type === 'textarea3' ? 3 : 2} value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={taStyle} />
                      ) : isCombo ? (
                        <><input list={`combo-itemcode-${key}`} value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder="เลือกหรือพิมพ์ใหม่" style={fldStyle} /><datalist id={`combo-itemcode-${key}`}>{FIELD_OPTIONS[key].map((o, i) => <option key={i} value={o} />)}</datalist></>
                      ) : (
                        <input value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={fldStyle} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0, background: '#fafbfc' }}>
              <button onClick={() => setView('search')} style={{ padding: '7px 16px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: '7px', border: 'none', background: saving ? '#aaa' : '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: '500', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : '💾 Save'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InvoiceDetailPopup ✅ PATCHED — flex body, minHeight:0, no coming-soon
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceDetailPopup({ show, onClose, form, setField, vendorInfo, itemcodeItems = [], fetchCollection, userName = '', currentUser, bu = '' }) {
  const { width: winW } = useWindowSize();
  const isMobile = winW < 768;
  const isTablet = winW >= 768 && winW < 1200;

  const [line1, setLine1] = useState({ hl: 'H', itemCode: '', amount: '', tax: '', taxCode: '', whtCode: '', account: '', desc: '', vat: '', wht: '', total: '' });
  const setLine1Field = (key, val) => setLine1(l => ({ ...l, [key]: val }));
  const [showItemCodePopup, setShowItemCodePopup] = useState(false);

  const MONEY_FIELDS = ['amount', 'vat', 'wht', 'total'];
  const handleMoneyChange = (key, val) => { let v = val.replace(/[^0-9.]/g, ''); const fd = v.indexOf('.'); if (fd !== -1) v = v.slice(0, fd + 1) + v.slice(fd + 1).replace(/\./g, ''); setLine1Field(key, v); };
  const handleMoneyBlur  = (key, val) => { if (val === '' || val === '.') { setLine1Field(key, ''); return; } const num = Math.round(parseFloat(val) * 100) / 100; setLine1Field(key, num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
  const handleMoneyFocus = (key, val) => { setLine1Field(key, val.replace(/,/g, '')); };

  useEffect(() => {
    if (!show) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
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
              {' · '}Invoice no.: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.invoiceNum || '-'}</span>
              {' · '}Branch: <span style={{ color: '#1a3a5c', fontWeight: '500' }}>{form?.branchNo || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f5f5f5', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ✅ PATCHED: overflow:hidden + flex column ── */}
        <div style={{ flex: 1, overflow: 'hidden', padding: isMobile ? '12px 14px' : '18px 22px', display: 'flex', flexDirection: 'column' }}>

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
              <div style={cardHead}><span style={cardLabel}>Header Detail 2</span></div>
              <div style={cardBody}><div style={{ fontSize: '11px', color: '#bbb', fontStyle: 'italic' }}>— coming soon —</div></div>
            </div>
          </div>

          {/* Fields row */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', alignItems: 'flex-end', overflowX: 'auto', marginBottom: '14px', flexShrink: 0 }}>
            {[['Inv date','invDate','date','130px'],['Invoice num','invoiceNum','text','150px'],['Period','period','text','160px'],['Vat','vat','text','75px'],['WHT','wht','text','75px'],['GRT','grtNum','text','75px'],['GRN','grn','text','75px']].map(([label, key, type, w]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={fieldLabel}>{label}</label>
                <input type={type} value={form?.[key] || ''} onChange={e => setField(key, e.target.value)} style={inputStyle(w)} />
              </div>
            ))}
            {[['Back Description 1','backDesc1'],['Back Description 2','backDesc2'],['Back Description 3','backDesc3']].map(([label, key]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 120px', minWidth: '120px' }}>
                <label style={fieldLabel}>{label}</label>
                <input type="text" value={form?.[key] || ''} onChange={e => setField(key, e.target.value)} style={inputStyle('100%')} />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
              <label style={fieldLabel}>&nbsp;</label>
              <button title="Contract" style={{ height: '30px', width: '56px', borderRadius: '6px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} onClick={() => {}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
              </button>
            </div>
          </div>

          {/* ✅ Invoice lines table — flex:1 minHeight:0 เต็มพื้นที่ */}
          <div style={{ border: '0.5px solid #e8eaf0', borderRadius: '10px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                <colgroup>{[3,8,9,4,8,8,13,21,8,8,10].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['H/L','Item Code','Amount','Tax','Tax Code','Wht Code','Account','Description','Vat Amount','Wht Amount','Total'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[['hl','fixed'],['itemCode','text'],['amount','text'],['tax','text'],['taxCode','text'],['whtCode','text'],['account','text'],['desc','text'],['vat','text'],['wht','text'],['total','text']].map(([key, type]) => (
                      <td key={key} style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>
                        {type === 'fixed' ? (
                          <div style={{ width: '100%', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', border: '0.5px solid #e8e8e8', borderRadius: '5px', background: '#f5f5f5', color: '#888', boxSizing: 'border-box' }}>{line1[key]}</div>
                        ) : key === 'itemCode' ? (
                          <div style={{ position: 'relative' }}>
                            <input type="text" maxLength={8} value={line1[key]} onChange={e => setLine1Field(key, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                              style={{ width: '100%', height: '28px', padding: '0 24px 0 6px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box' }} />
                            <button type="button" title="Search item code" onClick={() => setShowItemCodePopup(true)}
                              style={{ position: 'absolute', right: 0, top: 0, height: '28px', width: '22px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                            </button>
                          </div>
                        ) : (
                          <input type="text" inputMode={MONEY_FIELDS.includes(key) ? 'decimal' : 'text'} value={line1[key]}
                            onChange={e => MONEY_FIELDS.includes(key) ? handleMoneyChange(key, e.target.value) : setLine1Field(key, e.target.value)}
                            onFocus={MONEY_FIELDS.includes(key) ? () => handleMoneyFocus(key, line1[key]) : undefined}
                            onBlur={MONEY_FIELDS.includes(key) ? () => handleMoneyBlur(key, line1[key]) : undefined}
                            style={{ width: '100%', height: '28px', padding: '0 6px', fontSize: '11px', border: '0.5px solid #ddd', borderRadius: '5px', outline: 'none', background: 'white', color: '#1a3a5c', boxSizing: 'border-box', textAlign: MONEY_FIELDS.includes(key) ? 'right' : 'left' }} />
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <ItemCodeSearchPopup
          show={showItemCodePopup} onClose={() => setShowItemCodePopup(false)}
          onSelect={(item) => { setLine1Field('itemCode', item.code || ''); setShowItemCodePopup(false); }}
          itemcodeItems={itemcodeItems} fetchCollection={fetchCollection} userName={userName} currentUser={currentUser} bu={bu}
        />

        {/* ── Footer ── */}
        <div style={{ padding: isMobile ? '10px 14px' : '12px 22px', borderTop: '1px solid #f0f2f5', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexShrink: 0, background: '#fafbfc' }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: '7px', border: '1px solid #dde', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Close</button>
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
  const steps = [{ n: 1, label: 'Batch setup' }, { n: 2, label: 'Invoice entry' }, { n: 3, label: 'Generate & export' }];
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

  const getPrefix = (type) => {
    const d = receiveDate ? new Date(receiveDate) : new Date();
    const y = String(d.getFullYear()).slice(-1), mm = pad2(d.getMonth() + 1);
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
        if (canSeeAll) { const { data: all } = await supabase.from('batch_list').select('*').order('created_at', { ascending: false }).limit(500); setHistoryAll(all || []); }
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
                        placeholder="BU code..." style={{ ...inputBase, paddingRight: '36px' }} />
                      <button onClick={() => setShowPopup(true)} title="Open BU search popup"
                        style={{ position: 'absolute', right: 0, top: 0, height: '32px', width: '32px', background: '#1a3a5c', border: 'none', borderRadius: '0 6px 6px 0', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>🔍</button>
                    </div>
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
    </>
  );
}

// ── InvoiceHeader ─────────────────────────────────────────────────────────────
function InvoiceHeader({ form, setField, onSupplierBlur, vendorInfo, vendorLoading, matchedRule, onBranchSearch, onBranchNoChange, onBranchNoBlur, onInvoiceDetail }) {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Supplier code <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="text" value={form.supplierCode} onChange={e => setField('supplierCode', e.target.value)} onBlur={() => onSupplierBlur(form.supplierCode)} onKeyDown={e => { if (e.key === 'Enter') onSupplierBlur(form.supplierCode); }}
            style={{ height: '30px', padding: '0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
          <label style={{ fontSize: '11px', color: '#888' }}>Branch no.</label>
          <div style={{ position: 'relative' }}>
            <input type="text" value={form.branchNo} onChange={e => onBranchNoChange(e.target.value)} onBlur={e => onBranchNoBlur(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onBranchNoBlur(e.target.value); }}
              style={{ height: '30px', padding: '0 28px 0 8px', fontSize: '12px', borderRadius: '6px', outline: 'none', border: '0.5px solid #ddd', background: 'white', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
            <button onClick={onBranchSearch} style={{ position: 'absolute', right: 0, top: 0, height: '30px', width: '28px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
          </div>
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
function InvoiceEntry({ batchConfig, invoices, setInvoices, onNext, supplierItems = [], branchItems = [], accountItems = [], subAccItems = [], cpcItems = [], itemcodeItems = [], categoryItems = [], noticeItems = [], vendorRuleItems = [], fetchCollection, userName = '', currentUser }) {
  const [form, setFormState] = useState({ supplierCode: '', invDate: '', invoiceNum: '', branchNo: '', branchDirectLabel: '', branchIBLabel: '', grt: batchConfig?.buInfo?.['AP GRT Control'] || '', dueDate: batchConfig?.dueDate || '', period: '', vat: '', wht: '', grtNum: '', grn: '', backDesc1: '', backDesc2: '', backDesc3: '' });
  const [vendorInfo, setVendorInfo]               = useState(null);
  const [showBranchPopup, setShowBranchPopup]     = useState(false);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false);

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
    const bu = batchConfig?.bu || '', search = code.trim().toLowerCase();
    let found = supplierItems.find(s => String(s['Code'] ?? '').trim().toLowerCase() === search);
    if (found) { const codePrefix = String(found['Code'] ?? '').split('-')[0].toLowerCase(); if (bu && codePrefix !== bu.toLowerCase()) { setVendorInfo(null); return; } }
    if (!found && bu) { const withPrefix = `${bu.toLowerCase()}-${search}`; found = supplierItems.find(s => String(s['Code'] ?? '').trim().toLowerCase() === withPrefix); }
    setVendorInfo(found || null);
  };

  const handleSaveBranch = async ({ form: branchForm, isEdit, editTarget }) => {
    const meta = { updated_by: userName, updated_at: new Date().toISOString() };
    if (isEdit) { const { error } = await supabase.from('branch_list').update({ ...branchForm, ...meta }).eq('id', editTarget.id); if (error) throw error; }
    else { const { error } = await supabase.from('branch_list').insert([{ ...branchForm, ...meta }]); if (error) throw error; }
    await fetchCollection('BranchList', true);
  };

  const matchedRule = getMatchedRule(vendorInfo);

  const handleSelectBranch = (item, meta = {}) => {
    const ownLabel = formatBranchLabel(item);
    if (meta.isIB) { const ho = findHOBranch(branchItems, item['bu']); setFormState(f => ({ ...f, branchNo: item['Branch Code'] || '', branchIBLabel: ownLabel, branchDirectLabel: ho ? formatBranchLabel(ho) : '-' })); }
    else { setFormState(f => ({ ...f, branchNo: item['Branch Code'] || '', branchDirectLabel: ownLabel, branchIBLabel: '-' })); }
    setShowBranchPopup(false);
  };

  const handleBranchNoChange = (val) => { setFormState(f => ({ ...f, branchNo: val, ...(val.trim() === '' ? { branchDirectLabel: '', branchIBLabel: '' } : {}) })); };
  const handleBranchNoBlur = (code) => {
    const trimmed = code?.trim();
    if (!trimmed) { setFormState(f => ({ ...f, branchDirectLabel: '', branchIBLabel: '' })); return; }
    const found = branchItems.find(b => String(b['Branch Code'] ?? '').trim().toLowerCase() === trimmed.toLowerCase());
    if (found) { setFormState(f => ({ ...f, branchNo: found['Branch Code'] || trimmed, branchDirectLabel: formatBranchLabel(found), branchIBLabel: '-' })); }
    else { setFormState(f => ({ ...f, branchDirectLabel: '', branchIBLabel: '' })); }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      <BranchSearchPopup show={showBranchPopup} onClose={() => setShowBranchPopup(false)} onSelect={handleSelectBranch} branchItems={branchItems} bu={batchConfig?.bu || ''} onSaveBranch={handleSaveBranch} branchOptions={branchOptions} />
      <div style={{ ...card, overflow: 'visible' }}>
        <InvoiceHeader form={form} setField={setField} onSupplierBlur={lookupVendor} vendorInfo={vendorInfo} vendorLoading={false} matchedRule={matchedRule} onBranchSearch={() => setShowBranchPopup(true)} onBranchNoChange={handleBranchNoChange} onBranchNoBlur={handleBranchNoBlur} onInvoiceDetail={() => setShowInvoiceDetail(true)} />
        <InvoiceDetailPopup show={showInvoiceDetail} onClose={() => setShowInvoiceDetail(false)} form={form} setField={setField} vendorInfo={vendorInfo} itemcodeItems={itemcodeItems} fetchCollection={fetchCollection} userName={userName} currentUser={currentUser} bu={batchConfig?.bu || ''} />
      </div>
    </div>
  );
}

// ── GenerateExport ────────────────────────────────────────────────────────────
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
            <div style={cardHead}><span style={cardLabel}>Summary</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
              <thead><tr style={{ background: '#f8f9fa' }}>{[['Invoice No.','25%'],['Vendor','30%'],['GR Reference','22%'],['Net Amount','23%']].map(([h, w]) => (<th key={h} style={{ padding: '6px 9px', textAlign: 'left', fontSize: '11px', color: '#888', fontWeight: '500', borderBottom: '0.5px solid #e8eaf0', width: w }}>{h}</th>))}</tr></thead>
              <tbody>
                {invoices.length === 0 ? (<tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: '18px' }}>No invoices in batch</td></tr>)
                : invoices.map(v => (<tr key={v.id} style={{ borderBottom: '0.5px solid #f5f5f5' }}><td style={{ padding: '7px 9px', fontWeight: '500', color: '#1a3a5c' }}>{v.id}</td><td style={{ padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor}</td><td style={{ padding: '7px 9px', color: '#888' }}>{v.gr}</td><td style={{ padding: '7px 9px' }}>{exported ? <span style={bdgGreen}>Exported</span> : <span style={{ fontWeight: '500' }}>฿{fmt(v.net)}</span>}</td></tr>))}
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
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}><input type="checkbox" checked={opts[key]} onChange={() => toggleOpt(key)} />{label}</label>
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
                {opts.xlsx && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}><span style={{ color: '#27500A' }}>📊</span><span style={{ flex: 1 }}>AP_LOAD.xlsx</span><span style={{ color: '#888', cursor: 'pointer' }}>⬇</span></div>}
                {opts.txt  && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 8px', border: '0.5px solid #e8eaf0', borderRadius: '6px' }}><span style={{ color: '#0C447C' }}>📄</span><span style={{ flex: 1 }}>AP_INTERFACE.txt</span><span style={{ color: '#888', cursor: 'pointer' }}>⬇</span></div>}
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
  const { fetchCollection, getCached } = useDataCache();
  const { userName, currentUser }      = useAuth();
  const [step, setStep]               = useState(1);
  const [batchConfig, setBatchConfig] = useState(null);
  const [invoices, setInvoices]       = useState([]);

  useEffect(() => {
    fetchCollection('CompanyList'); fetchCollection('SupplierList'); fetchCollection('BranchList');
    fetchCollection('AccountList'); fetchCollection('SubAccList');   fetchCollection('CpcList');
    fetchCollection('ItemcodeList'); fetchCollection('VendorCategory'); fetchCollection('NoticeList'); fetchCollection('VendorRule');
  }, []);

  const infoItems       = getCached('CompanyList');
  const supplierItems   = getCached('SupplierList');
  const branchItems     = getCached('BranchList');
  const accountItems    = getCached('AccountList');
  const subAccItems     = getCached('SubAccList');
  const cpcItems        = getCached('CpcList');
  const itemcodeItems   = getCached('ItemcodeList');
  const categoryItems   = getCached('VendorCategory');
  const noticeItems     = getCached('NoticeList');
  const vendorRuleItems = getCached('VendorRule');

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
      <StepBar step={step} onGo={setStep} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {step === 1 && <BatchSetup onStart={handleStart} infoItems={infoItems} />}
        {step === 2 && (
          <InvoiceEntry batchConfig={batchConfig} invoices={invoices} setInvoices={setInvoices} onNext={() => setStep(3)}
            supplierItems={supplierItems} branchItems={branchItems} accountItems={accountItems} subAccItems={subAccItems}
            cpcItems={cpcItems} itemcodeItems={itemcodeItems} categoryItems={categoryItems} noticeItems={noticeItems}
            vendorRuleItems={vendorRuleItems} fetchCollection={fetchCollection}
            userName={userName || currentUser?.email || ''} currentUser={currentUser} />
        )}
        {step === 3 && <GenerateExport invoices={invoices} onNewBatch={handleNewBatch} onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}