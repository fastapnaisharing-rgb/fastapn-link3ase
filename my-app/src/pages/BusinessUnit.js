import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabase';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

function ComboBox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value || '');
  const ref = useRef(null);
  useEffect(() => { setInput(value || ''); }, [value]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = [...new Set(options.filter(o => o && o !== '-' && o.toLowerCase().includes(input.toLowerCase())))].slice(0, 20);
  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: '8px' }}>
      <input value={input} onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder || ''}
        style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', boxSizing: 'border-box' }} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000, maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((opt, i) => (
            <div key={i} onMouseDown={() => { setInput(opt); onChange(opt); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' }}
              onMouseEnter={e => e.target.style.background = '#f0f7ff'}
              onMouseLeave={e => e.target.style.background = 'white'}>{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportDropdown({ onExportSelected, onExportAll, selectedCount, isMobile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: isMobile ? '6px 10px' : '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: isMobile ? '12px' : '13px', background: '#0F6E56', color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}>
        📊{!isMobile && ' Export'} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '200px', marginTop: '4px', overflow: 'hidden' }}>
          <div onMouseDown={() => { onExportSelected(); setOpen(false); }} style={{ padding: '10px 16px', fontSize: '13px', cursor: 'pointer', borderBottom: '0.5px solid #f0f0f0' }} onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>✅ เฉพาะที่เลือก ({selectedCount} รายการ)</div>
          <div onMouseDown={() => { onExportAll(); setOpen(false); }} style={{ padding: '10px 16px', fontSize: '13px', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>📋 ทั้งหมด</div>
        </div>
      )}
    </div>
  );
}

function ImportPreviewModal({ show, onClose, onConfirm, importing, previewRows, keyField, allFields, isMobile }) {
  if (!show) return null;
  const summary = previewRows.reduce((acc, r) => { acc[r._status] = (acc[r._status] || 0) + 1; return acc; }, {});
  const confirmCount = previewRows.filter(r => r._status === 'new' || r._status === 'update').length;
  const statusTag = (s) => {
    const map = { new: { label: '➕ New', bg: '#EAF3DE', color: '#27500A' }, update: { label: '🔄 Update', bg: '#e8f0fb', color: '#1a3a5c' }, nochange: { label: '✅ No Change', bg: '#f5f5f5', color: '#666' }, duplicate: { label: '⚠️ Duplicate', bg: '#FFF3CD', color: '#856404' } };
    const m = map[s] || { label: s, bg: '#eee', color: '#333' };
    return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: '500', background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>;
  };
  const displayFields = allFields.filter(f => !['updated_by', 'updated_at'].includes(f)).slice(0, 5);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: 'white', borderRadius: '10px', padding: '20px', width: isMobile ? '95vw' : '90vw', maxWidth: '1100px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', margin: 0 }}>📋 Preview ข้อมูลที่จะ Import</h3>
          <span style={{ fontSize: '12px', color: '#0F6E56', fontWeight: '500' }}>{previewRows.length} รายการในไฟล์</span>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: '#666', marginBottom: '12px' }}>
          ℹ️ ระบบตรวจสอบจาก <strong style={{ margin: '0 3px' }}>{keyField}</strong>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {[['new','➕ New','#EAF3DE','#27500A'],['update','🔄 Update','#e8f0fb','#1a3a5c'],['nochange','✅ No Change','#f5f5f5','#666'],['duplicate','⚠️ Duplicate','#FFF3CD','#856404']].map(([key,label,bg,color]) => (
            summary[key] ? <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', background: bg, color }}>{label} <strong>{summary[key]}</strong></span> : null
          ))}
        </div>
        <div style={{ overflow: 'auto', flex: 1, borderRadius: '6px', border: '0.5px solid #e8e8e8', marginBottom: '14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead><tr>
              <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, width: '100px' }}>สถานะ</th>
              {displayFields.map(f => <th key={f} style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{f}</th>)}
              <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, minWidth: '200px' }}>การเปลี่ยนแปลง</th>
            </tr></thead>
            <tbody>
              {previewRows.map((row, i) => {
                const rowBg = { new: '#f9fffe', update: '#f5f8ff', nochange: 'white', duplicate: '#fffdf0' }[row._status] || 'white';
                return (
                  <tr key={i} style={{ background: rowBg, opacity: row._status === 'nochange' ? 0.65 : 1 }}>
                    <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0' }}>{statusTag(row._status)}</td>
                    {displayFields.map(f => <td key={f} style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[f] ?? '') || '-'}</td>)}
                    <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'top' }}>
                      {row._status === 'update' && row._changes?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {row._changes.map((c, ci) => (
                            <div key={ci} style={{ fontSize: '10px', background: '#f0f7ff', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                              <span style={{ color: '#555', fontWeight: '500' }}>{c.field}:</span>
                              <span style={{ color: '#791F1F', textDecoration: 'line-through' }}>{c.old || '-'}</span>
                              <span style={{ color: '#888' }}>→</span>
                              <span style={{ color: '#27500A', fontWeight: '500' }}>{c.new || '-'}</span>
                            </div>
                          ))}
                        </div>
                      ) : row._status === 'new' ? <span style={{ fontSize: '10px', color: '#888' }}>เพิ่มใหม่</span>
                        : row._status === 'duplicate' ? <span style={{ fontSize: '10px', color: '#856404' }}>{keyField} ซ้ำในไฟล์</span>
                        : <span style={{ fontSize: '10px', color: '#aaa' }}>ข้อมูลเหมือนเดิม</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#888' }}>จะ Import <strong style={{ color: '#1a3a5c' }}>{confirmCount} รายการ</strong></span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#f0f0f0', color: '#555' }} onClick={onClose}>Cancel</button>
            <button style={{ padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: confirmCount > 0 ? '#1a3a5c' : '#ccc', color: 'white', fontWeight: '500' }} onClick={onConfirm} disabled={importing || confirmCount === 0}>
              {importing ? 'กำลัง Import...' : `✅ Confirm Import ${confirmCount} รายการ`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessUnit({ activeSubTab, onSubTabChange }) {
  const [tab, setTab] = useState(activeSubTab || 'info');
  const { currentUser, userName } = useAuth();
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;
  const isTablet = screenWidth >= 768 && screenWidth < 1200;
  const pageWindowSize = isMobile ? 1 : isTablet ? 3 : 5;

  const [infoItems, setInfoItems] = useState([]);
  const [infoSearch, setInfoSearch] = useState('');
  const [infoSelected, setInfoSelected] = useState([]);
  const [infoSortField, setInfoSortField] = useState('bu');
  const [infoSortDir, setInfoSortDir] = useState('asc');
  const [showInfoForm, setShowInfoForm] = useState(false);
  const [showInfoPreview, setShowInfoPreview] = useState(false);
  const [infoPreviewRows, setInfoPreviewRows] = useState([]);
  const [infoImporting, setInfoImporting] = useState(false);
  const [infoEditId, setInfoEditId] = useState(null);
  const infoFileRef = useRef(null);

  const [showRateConfirm, setShowRateConfirm] = useState(false);
  const [rateConfirmData, setRateConfirmData] = useState(null);

  const [branches, setBranches] = useState([]);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchSelected, setBranchSelected] = useState([]);
  const [branchSortField, setBranchSortField] = useState('Branch Code');
  const [branchSortDir, setBranchSortDir] = useState('asc');
  const [showBranchDetail, setShowBranchDetail] = useState(false);
  const [branchDetailItem, setBranchDetailItem] = useState(null);
  const [branchDetailEditMode, setBranchDetailEditMode] = useState(false);
  const [branchDetailForm, setBranchDetailForm] = useState({});
  const [branchDetailError, setBranchDetailError] = useState('');
  const [showBranchNew, setShowBranchNew] = useState(false);
  const [branchNewForm, setBranchNewForm] = useState({});
  const [branchNewError, setBranchNewError] = useState('');
  const [showBranchPreview, setShowBranchPreview] = useState(false);
  const [branchPreviewRows, setBranchPreviewRows] = useState([]);
  const [branchImporting, setBranchImporting] = useState(false);
  const branchFileRef = useRef(null);

  const [branchPage, setBranchPage] = useState(1);
  const [branchPageSize, setBranchPageSize] = useState(100);
  const [branchTaxFilter, setBranchTaxFilter] = useState('');

  const theadRef = useRef(null);
  const tbodyRef = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const syncScroll = () => { if (theadRef.current && tbodyRef.current) theadRef.current.scrollLeft = tbodyRef.current.scrollLeft; };

  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const INFO_FIELDS = ['bu','THAI COMPANY NAME','ENGLISH COMPANY NAME','TAX ID','PREPARE BY','DEPARTMENT','COMPANY CODE','VAT %','Last Rate (%)','BOOK','SEGMENT3','AP GRT Control','updated_by','updated_at'];
  const INFO_KEY = 'TAX ID';
  const INFO_COMBO = ['bu','DEPARTMENT','BOOK','AP GRT Control'];
  const INFO_EDIT = [
    ['bu','BU'],['THAI COMPANY NAME','Thai Company Name'],['ENGLISH COMPANY NAME','English Company Name'],
    ['TAX ID','Tax ID'],['PREPARE BY','Prepare By'],['DEPARTMENT','Department'],
    ['COMPANY CODE','Company Code'],['VAT %','VAT %'],['Last Rate (%)','Last Rate (%)'],
    ['BOOK','Book'],['SEGMENT3','Segment3'],['AP GRT Control','AP GRT Control']
  ];
  const INFO_COLUMNS = [
    { key: 'bu', label: 'BU', sortable: true, w: 70 },
    { key: 'THAI COMPANY NAME', label: 'Thai Company Name', sortable: true, w: 220 },
    { key: 'ENGLISH COMPANY NAME', label: 'English Company Name', w: 220 },
    { key: 'TAX ID', label: 'Tax ID', w: 130 },
    { key: 'PREPARE BY', label: 'Prepare By', w: 140 },
    { key: 'DEPARTMENT', label: 'Department', w: 120 },
    { key: 'COMPANY CODE', label: 'Company Code', w: 120 },
    { key: 'VAT %', label: 'VAT %', w: 70 },
    { key: 'Last Rate (%)', label: 'Last Rate (%)', w: 90 },
    { key: 'BOOK', label: 'Book', w: 80 },
    { key: 'SEGMENT3', label: 'Segment3', w: 90 },
    { key: 'AP GRT Control', label: 'AP GRT Control', w: 110 },
  ];
  const emptyInfoForm = () => Object.fromEntries(INFO_EDIT.map(([k]) => [k, '']));
  const [infoForm, setInfoForm] = useState(emptyInfoForm());

  const BRANCH_FIELDS = ['Branch Code','Branch Direct','Branch Allocate','BU Code','Company for Show in Report Display','Simple Company','BU-TaxID','BU-Branch','Simple Brand Code','%','DB(%)','cpc','Branch Address','Group-P','bu','status','Inactive Date','updated_by','updated_at'];
  const BRANCH_KEY = 'Branch Code';
  const BRANCH_COMBO = ['Branch Direct','bu','Group-P','status'];
  const BRANCH_EDIT = [
    ['Branch Code','Branch Code'],['Branch Direct','Branch Direct'],
    ['Branch Allocate','Branch Allocate'],['BU Code','BU Code'],
    ['Company for Show in Report Display','Company for Report'],
    ['Simple Company','Simple Company'],['BU-TaxID','BU Tax ID'],
    ['BU-Branch','BU Branch'],['Simple Brand Code','Simple Brand Code'],
    ['%','%'],['DB(%)','DB(%)'],['cpc','CPC'],
    ['Branch Address','Branch Address'],['Group-P','Group-P'],
    ['bu','BU'],['status','Status'],['Inactive Date','Inactive Date'],
  ];
  const BRANCH_COLUMNS = [
    { key: 'Branch Code', label: 'Branch Code', sortable: true, w: 110 },
    { key: 'Branch Direct', label: 'Branch Direct', sortable: true, w: 120 },
    { key: 'Branch Allocate', label: 'Branch Allocate', w: 120 },
    { key: 'Company for Show in Report Display', label: 'Company Name', w: 200 },
    { key: 'BU-TaxID', label: 'BU Tax ID', w: 130 },
    { key: 'BU-Branch', label: 'BU Branch', w: 80 },
    { key: '%', label: '%', w: 55 },
    { key: 'DB(%)', label: 'DB(%)', w: 65 },
    { key: 'cpc', label: 'CPC', w: 65 },
    { key: 'Group-P', label: 'Group-P', w: 90 },
    { key: 'bu', label: 'BU', sortable: true, w: 65 },
    { key: 'status', label: 'Status', w: 90 },
    { key: 'Inactive Date', label: 'Inactive Date', w: 110 },
  ];

  const branchTaxIds = useMemo(() => new Set(branches.map(b => b['BU-TaxID']).filter(Boolean)), [branches]);

  // ✅ Chunked Loading
  const fetchInfo = useCallback(async () => {
    let from = 0;
    const batchSize = 1000;
    let isFirst = true;
    while (true) {
      const { data, error } = await supabase
        .from('company_list')
        .select('*')
        .or('deleted.is.null,deleted.eq.false')
        .range(from, from + batchSize - 1);
      if (error) { console.error('fetchInfo error:', error); break; }
      if (isFirst) { setInfoItems(data || []); isFirst = false; }
      else { setInfoItems(prev => [...prev, ...(data || [])]); }
      if (!data || data.length < batchSize) break;
      from += batchSize;
    }
  }, []);

  // ✅ Chunked Loading
  const fetchBranch = useCallback(async () => {
    let from = 0;
    const batchSize = 1000;
    let isFirst = true;
    while (true) {
      const { data, error } = await supabase
        .from('branch_list')
        .select('*')
        .or('deleted.is.null,deleted.eq.false')
        .range(from, from + batchSize - 1);
      if (error) { console.error('fetchBranch error:', error); break; }
      if (isFirst) { setBranches(data || []); isFirst = false; }
      else { setBranches(prev => [...prev, ...(data || [])]); }
      if (!data || data.length < batchSize) break;
      from += batchSize;
    }
  }, []);

  useEffect(() => { fetchInfo(); fetchBranch(); }, []);
  useEffect(() => { if (activeSubTab) setTab(activeSubTab); }, [activeSubTab]);
  useEffect(() => { setBranchPage(1); }, [branchSearch, branchSortField, branchSortDir, branchTaxFilter]);

  const handleTabChange = (t) => { setTab(t); if (onSubTabChange) onSubTabChange(t); };
  const handleFilterByTaxId = (taxId) => { setBranchTaxFilter(taxId); setBranchSearch(''); setBranchPage(1); handleTabChange('branch'); };

  const getFileTimestamp = () => { const now = new Date(); return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`; };
  const formatLastUpdate = (val) => {
    if (!val || val === '-') return '-';
    try { const d = new Date(val); if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch {}
    return val;
  };

  const buildPreviewRows = (rawRows, existingItems, keyField, allFields) => {
    const dataFields = allFields.filter(f => !['updated_by','updated_at'].includes(f));
    const existingMap = {};
    existingItems.forEach(item => { if (item[keyField]) existingMap[String(item[keyField]).trim()] = item; });
    const seenKeys = new Set();
    return rawRows.map(row => {
      const keyVal = String(row[keyField] ?? '').trim();
      if (!keyVal || seenKeys.has(keyVal)) return { ...row, _status: 'duplicate', _changes: [] };
      seenKeys.add(keyVal);
      const existing = existingMap[keyVal];
      if (!existing) return { ...row, _status: 'new', _changes: [] };
      const changes = [];
      dataFields.forEach(f => { const n = String(row[f]??'').trim(), o = String(existing[f]??'').trim(); if (n !== o) changes.push({ field: f, old: o, new: n }); });
      return { ...row, _status: changes.length > 0 ? 'update' : 'nochange', _changes: changes, _existingId: existing.id };
    });
  };

  const exportToExcel = (data, fields, sheetName, filePrefix) => {
    const rows = data.map(item => { const row = {}; fields.forEach(f => { row[f] = item[f] || ''; }); return row; });
    const ws = XLSX.utils.json_to_sheet(rows, { header: fields });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${filePrefix}_${getFileTimestamp()}.xlsx`);
  };

  const handleInfoExportSelected = () => exportToExcel(infoItems.filter(i => infoSelected.includes(i.id)), INFO_FIELDS.filter(f => !['updated_by','updated_at'].includes(f)), 'CompanyList', 'CompanyList');
  const handleInfoExportAll = () => exportToExcel(filteredInfo, INFO_FIELDS.filter(f => !['updated_by','updated_at'].includes(f)), 'CompanyList', 'CompanyList');
  const handleBranchExportSelected = () => exportToExcel(branches.filter(b => branchSelected.includes(b.id)), BRANCH_FIELDS.filter(f => !['updated_by','updated_at'].includes(f)), 'BranchList', 'BranchList');
  const handleBranchExportAll = () => exportToExcel(filteredBranch, BRANCH_FIELDS.filter(f => !['updated_by','updated_at'].includes(f)), 'BranchList', 'BranchList');

  const metaFields = { updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString() };

  const doInfoSave = async (form) => {
    const data = { ...form, ...metaFields };
    if (infoEditId) {
      const { data: updated, error } = await supabase.from('company_list').update(data).eq('id', infoEditId).select().single();
      if (error) throw error;
      setInfoItems(prev => prev.map(i => i.id === infoEditId ? { ...i, ...updated } : i));
    } else {
      const { data: inserted, error } = await supabase.from('company_list').insert([data]).select().single();
      if (error) throw error;
      setInfoItems(prev => [...prev, inserted]);
    }
    setShowInfoForm(false); setInfoEditId(null); setInfoForm(emptyInfoForm());
  };

  const handleInfoSave = async () => {
    try {
      const originalItem = infoItems.find(i => i.id === infoEditId);
      if (infoEditId && originalItem && String(infoForm['VAT %']).trim() !== String(originalItem['VAT %']).trim()) {
        const affectedBranches = branches.filter(b => b['BU-TaxID'] === infoForm['TAX ID']);
        setRateConfirmData({ oldRate: originalItem['VAT %'], newRate: infoForm['VAT %'], taxId: infoForm['TAX ID'], branchCount: affectedBranches.length, affectedIds: affectedBranches.map(b => b.id), formWithLastRate: { ...infoForm, 'Last Rate (%)': originalItem['VAT %'] } });
        setShowRateConfirm(true); return;
      }
      await doInfoSave(infoForm);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleRateConfirm = async () => {
    try {
      await doInfoSave(rateConfirmData.formWithLastRate);
      const ids = rateConfirmData.affectedIds;
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { error } = await supabase.from('branch_list').update({ '%': rateConfirmData.newRate, ...metaFields }).in('id', chunk);
        if (error) throw error;
        setBranches(prev => prev.map(b => chunk.includes(b.id) ? { ...b, '%': rateConfirmData.newRate } : b));
      }
      setShowRateConfirm(false); setRateConfirmData(null);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleInfoEdit = (item) => { const f = {}; INFO_EDIT.forEach(([k]) => { f[k] = item[k] || ''; }); setInfoForm(f); setInfoEditId(item.id); setShowInfoForm(true); };

  const handleInfoDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = infoItems.find(i => i.id === id);
      await supabase.from('recycle_bin').insert([{ source_table: 'company_list', source_id: id, source_key: item?.['TAX ID'] || id, data: item, deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString() }]);
      const { error } = await supabase.from('company_list').update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      setInfoItems(prev => prev.filter(i => i.id !== id));
      setInfoSelected(p => p.filter(s => s !== id));
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  // ✅ BulkDelete with Batch (company_list)
  const handleInfoBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${infoSelected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = infoItems
        .filter(i => infoSelected.includes(i.id))
        .map(item => ({
          source_table: 'company_list',
          source_id: item.id,
          source_key: item['TAX ID'] || item.id,
          data: item,
          deleted_by: userName || currentUser?.email || '',
          deleted_at: now,
        }));

      // ✅ Batch insert recycle_bin
      for (let i = 0; i < bins.length; i += 500) {
        const { error } = await supabase.from('recycle_bin').insert(bins.slice(i, i + 500));
        if (error) throw error;
      }

      // ✅ Batch soft delete
      for (let i = 0; i < infoSelected.length; i += 500) {
        const chunk = infoSelected.slice(i, i + 500);
        const { error } = await supabase
          .from('company_list')
          .update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: now })
          .in('id', chunk);
        if (error) throw error;
      }

      setInfoItems(prev => prev.filter(i => !infoSelected.includes(i.id)));
      setInfoSelected([]);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleInfoDownloadTemplate = () => { const ws = XLSX.utils.aoa_to_sheet([INFO_FIELDS.filter(f => !['updated_by','updated_at'].includes(f))]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'CompanyList'); XLSX.writeFile(wb, 'CompanyList_Template.xlsx'); };

  const handleInfoFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { const wb = XLSX.read(evt.target.result, { type: 'binary' }); const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); setInfoPreviewRows(buildPreviewRows(rawRows, infoItems, INFO_KEY, INFO_FIELDS)); setShowInfoPreview(true); };
    reader.readAsBinaryString(file); e.target.value = '';
  };

  const handleInfoConfirmImport = async () => {
    setInfoImporting(true);
    try {
      const toProcess = infoPreviewRows.filter(r => r._status === 'new' || r._status === 'update');
      const newRows = toProcess.filter(r => r._status === 'new');
      const updateRows = toProcess.filter(r => r._status === 'update');
      if (newRows.length > 0) {
        const insertData = newRows.map(row => { const d = {}; INFO_FIELDS.forEach(k => { d[k] = k==='updated_by'?(userName||currentUser?.email||''):k==='updated_at'?new Date().toISOString():String(row[k]??''); }); return d; });
        for (let i = 0; i < insertData.length; i += 500) {
          const { data: ins, error } = await supabase.from('company_list').insert(insertData.slice(i,i+500)).select();
          if (error) throw error;
          setInfoItems(prev => [...prev, ...ins]);
        }
      }
      for (const row of updateRows) {
        const d = {}; INFO_FIELDS.forEach(k => { d[k] = k==='updated_by'?(userName||currentUser?.email||''):k==='updated_at'?new Date().toISOString():String(row[k]??''); });
        const { data: upd, error } = await supabase.from('company_list').update(d).eq('id', row._existingId).select().single();
        if (error) throw error;
        setInfoItems(prev => prev.map(i => i.id === row._existingId ? { ...i, ...upd } : i));
      }
      setShowInfoPreview(false); setInfoPreviewRows([]);
      alert(`✅ Import สำเร็จ — New: ${newRows.length} / Update: ${updateRows.length}`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setInfoImporting(false);
  };

  const handleOpenDetail = (item) => { setBranchDetailItem(item); setBranchDetailForm(Object.fromEntries(BRANCH_EDIT.map(([k]) => [k, item[k] || '']))); setBranchDetailEditMode(false); setBranchDetailError(''); setShowBranchDetail(true); };

  const validateBranchForm = (form) => {
    if (form['status'] === 'Closed' && !form['Inactive Date']) return 'กรุณากรอก Inactive Date เมื่อ Status เป็น Closed';
    if (form['status'] === 'Relocate' && !form['Branch Allocate']) return 'กรุณากรอก Branch Allocate เมื่อ Status เป็น Relocate';
    return '';
  };

  const handleBranchDetailSave = async () => {
    const err = validateBranchForm(branchDetailForm);
    if (err) { setBranchDetailError(err); return; }
    const data = { ...branchDetailForm, ...metaFields };
    const { data: updated, error } = await supabase.from('branch_list').update(data).eq('id', branchDetailItem.id).select().single();
    if (error) { setBranchDetailError('บันทึกไม่สำเร็จ: ' + error.message); return; }
    setBranches(prev => prev.map(b => b.id === branchDetailItem.id ? { ...b, ...updated } : b));
    setShowBranchDetail(false);
  };

  const handleBranchNewSave = async () => {
    const err = validateBranchForm(branchNewForm);
    if (err) { setBranchNewError(err); return; }
    const { data: inserted, error } = await supabase.from('branch_list').insert([{ ...branchNewForm, ...metaFields }]).select().single();
    if (error) { setBranchNewError('บันทึกไม่สำเร็จ: ' + error.message); return; }
    setBranches(prev => [...prev, inserted]);
    setShowBranchNew(false); setBranchNewForm({});
  };

  const handleBranchDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = branches.find(b => b.id === id);
      await supabase.from('recycle_bin').insert([{ source_table: 'branch_list', source_id: id, source_key: item?.['Branch Code'] || id, data: item, deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString() }]);
      const { error } = await supabase.from('branch_list').update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      setBranches(prev => prev.filter(b => b.id !== id));
      setBranchSelected(p => p.filter(s => s !== id));
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  // ✅ BulkDelete with Batch (branch_list)
  const handleBranchBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${branchSelected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = branches
        .filter(b => branchSelected.includes(b.id))
        .map(item => ({
          source_table: 'branch_list',
          source_id: item.id,
          source_key: item['Branch Code'] || item.id,
          data: item,
          deleted_by: userName || currentUser?.email || '',
          deleted_at: now,
        }));

      // ✅ Batch insert recycle_bin
      for (let i = 0; i < bins.length; i += 500) {
        const { error } = await supabase.from('recycle_bin').insert(bins.slice(i, i + 500));
        if (error) throw error;
      }

      // ✅ Batch soft delete
      for (let i = 0; i < branchSelected.length; i += 500) {
        const chunk = branchSelected.slice(i, i + 500);
        const { error } = await supabase
          .from('branch_list')
          .update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: now })
          .in('id', chunk);
        if (error) throw error;
      }

      setBranches(prev => prev.filter(b => !branchSelected.includes(b.id)));
      setBranchSelected([]);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleBranchDownloadTemplate = () => { const ws = XLSX.utils.aoa_to_sheet([BRANCH_FIELDS.filter(f => !['updated_by','updated_at'].includes(f))]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BranchList'); XLSX.writeFile(wb, 'BranchList_Template.xlsx'); };

  const handleBranchFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { const wb = XLSX.read(evt.target.result, { type: 'binary' }); const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); setBranchPreviewRows(buildPreviewRows(rawRows, branches, BRANCH_KEY, BRANCH_FIELDS)); setShowBranchPreview(true); };
    reader.readAsBinaryString(file); e.target.value = '';
  };

  const handleBranchConfirmImport = async () => {
    setBranchImporting(true);
    try {
      const toProcess = branchPreviewRows.filter(r => r._status === 'new' || r._status === 'update');
      const newRows = toProcess.filter(r => r._status === 'new');
      const updateRows = toProcess.filter(r => r._status === 'update');
      if (newRows.length > 0) {
        const insertData = newRows.map(row => { const d = {}; BRANCH_FIELDS.forEach(k => { d[k] = k==='updated_by'?(userName||currentUser?.email||''):k==='updated_at'?new Date().toISOString():String(row[k]??''); }); return d; });
        for (let i = 0; i < insertData.length; i += 500) {
          const { data: ins, error } = await supabase.from('branch_list').insert(insertData.slice(i,i+500)).select();
          if (error) throw error;
          setBranches(prev => [...prev, ...ins]);
        }
      }
      for (const row of updateRows) {
        const d = {}; BRANCH_FIELDS.forEach(k => { d[k] = k==='updated_by'?(userName||currentUser?.email||''):k==='updated_at'?new Date().toISOString():String(row[k]??''); });
        const { data: upd, error } = await supabase.from('branch_list').update(d).eq('id', row._existingId).select().single();
        if (error) throw error;
        setBranches(prev => prev.map(b => b.id === row._existingId ? { ...b, ...upd } : b));
      }
      setShowBranchPreview(false); setBranchPreviewRows([]);
      alert(`✅ Import สำเร็จ — New: ${newRows.length} / Update: ${updateRows.length}`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setBranchImporting(false);
  };

  const filteredInfo = infoItems
    .filter(i => i['bu']?.toLowerCase().includes(infoSearch.toLowerCase()) || i['THAI COMPANY NAME']?.toLowerCase().includes(infoSearch.toLowerCase()) || i['ENGLISH COMPANY NAME']?.toLowerCase().includes(infoSearch.toLowerCase()) || i['TAX ID']?.includes(infoSearch) || i['BOOK']?.toLowerCase().includes(infoSearch.toLowerCase()))
    .sort((a,b) => { const ca=a[infoSortField]||'',cb=b[infoSortField]||''; return infoSortDir==='asc'?ca.localeCompare(cb):cb.localeCompare(ca); });

  const filteredBranch = branches
    .filter(b => {
      const matchTax = branchTaxFilter ? b['BU-TaxID'] === branchTaxFilter : true;
      const matchSearch = branchSearch ? (b['Branch Code']?.toLowerCase().includes(branchSearch.toLowerCase()) || b['Company for Show in Report Display']?.toLowerCase().includes(branchSearch.toLowerCase()) || b['Simple Company']?.toLowerCase().includes(branchSearch.toLowerCase()) || b['bu']?.toLowerCase().includes(branchSearch.toLowerCase()) || b['BU-TaxID']?.includes(branchSearch) || b['Branch Direct']?.toLowerCase().includes(branchSearch.toLowerCase()) || b['Branch Address']?.toLowerCase().includes(branchSearch.toLowerCase())) : true;
      return matchTax && matchSearch;
    })
    .sort((a,b) => { const ca=a[branchSortField]||'',cb=b[branchSortField]||''; return branchSortDir==='asc'?ca.localeCompare(cb):cb.localeCompare(ca); });

  const effectivePageSize = branchPageSize === 0 ? filteredBranch.length || 1 : branchPageSize;
  const totalPages = Math.ceil(filteredBranch.length / effectivePageSize) || 1;
  const pagedBranch = branchPageSize === 0 ? filteredBranch : filteredBranch.slice((branchPage-1)*effectivePageSize, branchPage*effectivePageSize);

  const getPageWindow = () => {
    let start = Math.max(1, branchPage - Math.floor(pageWindowSize/2));
    let end = Math.min(totalPages, start + pageWindowSize - 1);
    if (end - start < pageWindowSize - 1) start = Math.max(1, end - pageWindowSize + 1);
    const pages = []; for (let i = start; i <= end; i++) pages.push(i); return pages;
  };

  const getInfoOptions = (field) => [...new Set(infoItems.map(i => i[field]||'').filter(v=>v))];
  const getBranchOptions = (field) => [...new Set(branches.map(i => i[field]||'').filter(v=>v))];

  const renderColGroup = (columns, hasCheck, actionW) => (
    <colgroup>
      {hasCheck && <col style={{ width:'36px', minWidth:'36px' }}/>}
      {columns.map((c,i) => <col key={i} style={{ width:`${c.w}px`, minWidth:`${c.w}px` }}/>)}
      <col style={{ width:`${actionW}px`, minWidth:`${actionW}px` }}/>
    </colgroup>
  );

  const statusBadge = (val) => {
    const map = { Active:['#EAF3DE','#27500A'], Closed:['#FCEBEB','#791F1F'], Relocate:['#FFF3CD','#856404'] };
    const [bg,color] = map[val]||['#e8e8e8','#555'];
    return <span style={{ background:bg, color, padding:'2px 8px', borderRadius:'20px', fontSize:'10px' }}>{val||'-'}</span>;
  };

  const branchActionW = isAdmin ? (56 * 2) + 20 : 56 + 20;
  const minBranchW = 36 + BRANCH_COLUMNS.reduce((s,c) => s+c.w, 0) + branchActionW;
  const branchTotalW = containerW > 0 ? Math.max(minBranchW, containerW) : minBranchW;

  const infoActionW = isAdmin ? (56 * 3) + 20 : isEditor ? (56 * 2) + 20 : 56 + 20;
  const minInfoW = 36 + INFO_COLUMNS.reduce((s,c) => s+c.w, 0) + infoActionW;
  const infoTotalW = containerW > 0 ? Math.max(minInfoW, containerW) : minInfoW;

  const S = {
    container: { padding:isMobile?'12px':'20px', display:'flex', flexDirection:'column', height:'100vh', boxSizing:'border-box', minWidth: 0, overflow: 'hidden' },
    topbar: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0', flexShrink:0, flexWrap:isMobile?'wrap':'nowrap', gap:'8px' },
    btn: { padding:isMobile?'6px 10px':'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:isMobile?'12px':'13px', marginLeft:isMobile?'4px':'8px' },
    tabBar: { display:'flex', alignItems:'flex-end', padding:'10px 0 0', flexShrink:0, borderBottom:'2px solid #e8e8e8' },
    tab: (active) => ({ padding:isMobile?'6px 12px':'8px 20px', fontSize:isMobile?'12px':'13px', cursor:'pointer', color:active?'#1a3a5c':'#888', borderBottom:active?'2px solid #1a3a5c':'2px solid transparent', marginBottom:'-2px', borderRadius:'6px 6px 0 0', background:active?'white':'transparent', fontWeight:active?'500':'400', display:'flex', alignItems:'center', gap:'4px' }),
    tabBadge: (active) => ({ background:active?'#1a3a5c':'#e8e8e8', color:active?'white':'#888', fontSize:'10px', padding:'1px 5px', borderRadius:'20px' }),
    outer: { background:'white', borderRadius:'8px', border:'0.5px solid #e8e8e8', overflow:'hidden', display:'flex', flexDirection:'column', flex:1, minWidth: 0 },
    theadWrap: { overflowX:'auto', flexShrink:0, scrollbarWidth:'none' },
    tbodyWrap: { overflowY:'auto', overflowX:'auto', flex:1, minWidth: 0 },
    table: { borderCollapse:'collapse', fontSize:'11px', tableLayout:'fixed' },
    th: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'left', fontSize:'11px', fontWeight:'500', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
    thSort: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'left', fontSize:'11px', fontWeight:'500', whiteSpace:'nowrap', cursor:'pointer', userSelect:'none', overflow:'hidden', textOverflow:'ellipsis' },
    thCheck: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'center', fontSize:'11px', width:'36px' },
    thAction: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'center', fontSize:'11px', fontWeight:'500' },
    td: { padding:'7px 10px', fontSize:'11px', borderBottom:'0.5px solid #f0f0f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'0' },
    tdCenter: { padding:'6px 8px', fontSize:'11px', borderBottom:'0.5px solid #f0f0f0', textAlign:'center' },
    input: { padding:'7px 10px', borderRadius:'6px', border:'1px solid #ddd', fontSize:'13px', width:'100%', marginBottom:'8px', boxSizing:'border-box' },
    inputDisabled: { padding:'7px 10px', borderRadius:'6px', border:'1px solid #eee', fontSize:'13px', width:'100%', marginBottom:'8px', boxSizing:'border-box', background:'#f5f5f5', color:'#999' },
    inputReadonly: { padding:'6px 10px', borderRadius:'6px', border:'1px solid #f0f0f0', fontSize:'12px', width:'100%', marginBottom:'6px', boxSizing:'border-box', background:'#fafafa', color:'#333' },
    overlay: { position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 },
    modal: { background:'white', borderRadius:'10px', width:isMobile?'95vw':'520px', maxHeight:'85vh', display:'flex', flexDirection:'column' },
    pageBtn: (active,disabled) => ({ padding:'3px 7px', borderRadius:'5px', border:'0.5px solid #ddd', fontSize:'11px', cursor:disabled?'default':'pointer', background:active?'#1a3a5c':'white', color:disabled?'#ccc':active?'white':'#555', minWidth:'26px', textAlign:'center' }),
    iconBtn: (color,bg,border) => ({ background:bg||'none', border:`0.5px solid ${border||color}`, borderRadius:'4px', cursor:'pointer', padding:'3px 6px', color, fontSize:'12px', lineHeight:1 }),
  };

  const renderInfoText = () => {
    if(tab==='info'){if(isMobile)return`${filteredInfo.length} รายการ`;return`ทั้งหมด ${infoItems.length} รายการ${infoSearch?` | ผลการค้นหา ${filteredInfo.length} รายการ`:''}${infoSelected.length>0?` | เลือกอยู่ ${infoSelected.length} รายการ`:''}` }
    if(isMobile)return`${filteredBranch.length} รายการ`;
    if(isTablet)return`${branches.length} รายการ${branchTaxFilter?' | Filter Tax ID':''}`;
    return`ทั้งหมด ${branches.length} รายการ${branchTaxFilter?` | Filter Tax ID: ${branchTaxFilter} (${filteredBranch.length} รายการ)`:branchSearch?` | ผลการค้นหา ${filteredBranch.length} รายการ`:''}${branchSelected.length>0?` | เลือกอยู่ ${branchSelected.length} รายการ`:''}`;
  };

  const renderBranchFormFields = (form, setForm, error, setError, editMode=true) => (
    <>
      {error && <div style={{ background:'#FCEBEB', color:'#791F1F', padding:'8px 20px', fontSize:'12px', borderBottom:'1px solid #f7c1c1' }}>⚠️ {error}</div>}
      <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
        {BRANCH_EDIT.map(([key,label]) => {
          const isRequired = (key==='Inactive Date'&&form['status']==='Closed')||(key==='Branch Allocate'&&form['status']==='Relocate');
          const hasError = error&&isRequired&&!form[key];
          return (
            <div key={key} style={{ marginBottom:'4px' }}>
              <label style={{ fontSize:'11px', color:hasError?'#e74c3c':'#888', display:'block', marginBottom:'2px' }}>{label}{isRequired&&<span style={{ color:'#e74c3c' }}> *</span>}</label>
              {editMode?(
                key==='Inactive Date'?<input type="date" style={hasError?{...S.input,border:'1px solid #e74c3c'}:S.input} value={form[key]} onChange={e=>{setForm({...form,[key]:e.target.value});setError('');}}/>
                :BRANCH_COMBO.includes(key)?<ComboBox value={form[key]} onChange={val=>{setForm({...form,[key]:val});setError('');}} options={getBranchOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`}/>
                :<input style={hasError?{...S.input,border:'1px solid #e74c3c'}:S.input} value={form[key]} onChange={e=>{setForm({...form,[key]:e.target.value});setError('');}}/>
              ):<div style={S.inputReadonly}>{key==='status'?statusBadge(form[key]):(form[key]||'-')}</div>}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <h2 style={{ fontSize:isMobile?'14px':'16px', fontWeight:'600', margin:0 }}>🏢 Business Unit</h2>
          {isAdmin&&tab==='info'&&infoSelected.length>0&&<button style={{...S.btn,background:'#c0392b',color:'white',marginLeft:0}} onClick={handleInfoBulkDelete}>🗑️{!isMobile&&` ลบ ${infoSelected.length}`}</button>}
          {isAdmin&&tab==='branch'&&branchSelected.length>0&&<button style={{...S.btn,background:'#c0392b',color:'white',marginLeft:0}} onClick={handleBranchBulkDelete}>🗑️{!isMobile&&` ลบ ${branchSelected.length}`}</button>}
          {tab==='info'&&infoSelected.length>0&&<ExportDropdown onExportSelected={handleInfoExportSelected} onExportAll={handleInfoExportAll} selectedCount={infoSelected.length} isMobile={isMobile}/>}
          {tab==='branch'&&branchSelected.length>0&&<ExportDropdown onExportSelected={handleBranchExportSelected} onExportAll={handleBranchExportAll} selectedCount={branchSelected.length} isMobile={isMobile}/>}
        </div>
        {isEditor&&(
          <div style={{ display:'flex', alignItems:'center', gap:isMobile?'4px':'0' }}>
            {tab==='info'?<>
              <button style={{...S.btn,background:'#0F6E56',color:'white'}} onClick={handleInfoDownloadTemplate}>⬇{!isMobile&&' Template'}</button>
              <button style={{...S.btn,background:'#5DCAA5',color:'#1a3a5c'}} onClick={()=>infoFileRef.current.click()}>📂{!isMobile&&' Import'}</button>
              <input ref={infoFileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleInfoFileChange}/>
              <button style={{...S.btn,background:'#1a3a5c',color:'white'}} onClick={()=>{setShowInfoForm(true);setInfoEditId(null);setInfoForm(emptyInfoForm());}}>+ New</button>
            </>:<>
              <button style={{...S.btn,background:'#0F6E56',color:'white'}} onClick={handleBranchDownloadTemplate}>⬇{!isMobile&&' Template'}</button>
              <button style={{...S.btn,background:'#5DCAA5',color:'#1a3a5c'}} onClick={()=>branchFileRef.current.click()}>📂{!isMobile&&' Import'}</button>
              <input ref={branchFileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleBranchFileChange}/>
              <button style={{...S.btn,background:'#1a3a5c',color:'white'}} onClick={()=>{setShowBranchNew(true);setBranchNewForm(Object.fromEntries(BRANCH_EDIT.map(([k])=>[k,''])));setBranchNewError('');}}>+ New</button>
            </>}
          </div>
        )}
      </div>

      <div style={S.tabBar}>
        <div style={S.tab(tab==='info')} onClick={()=>handleTabChange('info')}>📋 Info <span style={S.tabBadge(tab==='info')}>{infoItems.length}</span></div>
        <div style={S.tab(tab==='branch')} onClick={()=>{handleTabChange('branch');setBranchTaxFilter('');}}>🏪 Branch <span style={S.tabBadge(tab==='branch')}>{branches.length}</span></div>
      </div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', margin:'4px 0', flexShrink:0, flexWrap:isMobile?'wrap':'nowrap', gap:isMobile?'6px':'0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:isMobile?'1 1 100%':'1', minWidth:0 }}>
          {tab==='info'?(
            <input placeholder={isMobile?'Search...':'Search...'} value={infoSearch} onChange={e=>setInfoSearch(e.target.value)} style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width:isMobile?'100%':isTablet?'180px':'240px' }}/>
          ):(
            <>
              <input placeholder={isMobile?'Search...':'Search...'} value={branchSearch} onChange={e=>{setBranchSearch(e.target.value);setBranchTaxFilter('');}} style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width:isMobile?'100%':isTablet?'180px':'240px' }}/>
              {branchTaxFilter&&!isMobile&&(<span style={{ fontSize:'11px', background:'#e8f0fb', color:'#1a3a5c', padding:'3px 10px', borderRadius:'20px', display:'flex', alignItems:'center', gap:'4px', whiteSpace:'nowrap' }}>Tax ID: {isTablet?'...':branchTaxFilter}<span style={{ cursor:'pointer', fontWeight:'bold' }} onClick={()=>setBranchTaxFilter('')}>×</span></span>)}
            </>
          )}
          {!isMobile&&<span style={{ fontSize:'12px', color:'#888', whiteSpace:'nowrap' }}>{renderInfoText()}</span>}
        </div>
        {tab==='branch'&&(
          <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
            {!isMobile&&<span style={{ fontSize:'12px', color:'#888' }}>แสดง</span>}
            <select value={branchPageSize} onChange={e=>{setBranchPageSize(Number(e.target.value));setBranchPage(1);}} style={{ padding:'3px 20px 3px 6px', borderRadius:'5px', border:'0.5px solid #ddd', fontSize:'11px', cursor:'pointer', appearance:'none', backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat:'no-repeat', backgroundPosition:'right 4px center' }}>
              <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option><option value={0}>ทั้งหมด</option>
            </select>
            {!isMobile&&<span style={{ fontSize:'12px', color:'#888' }}>รายการ/หน้า</span>}
            <button style={S.pageBtn(false,branchPage===1)} disabled={branchPage===1} onClick={()=>setBranchPage(1)}>«</button>
            <button style={S.pageBtn(false,branchPage===1)} disabled={branchPage===1} onClick={()=>setBranchPage(p=>p-1)}>‹</button>
            {getPageWindow().map(p=><button key={p} style={S.pageBtn(p===branchPage,false)} onClick={()=>setBranchPage(p)}>{p}</button>)}
            <button style={S.pageBtn(false,branchPage>=totalPages)} disabled={branchPage>=totalPages} onClick={()=>setBranchPage(p=>p+1)}>›</button>
            <button style={S.pageBtn(false,branchPage>=totalPages)} disabled={branchPage>=totalPages} onClick={()=>setBranchPage(totalPages)}>»</button>
            <span style={{ fontSize:'11px', color:'#888', paddingLeft:'6px', borderLeft:'0.5px solid #ddd', marginLeft:'3px', whiteSpace:'nowrap' }}>{branchPage} / {totalPages}</span>
          </div>
        )}
      </div>

      {tab==='info'?(
        <div ref={containerRef} style={S.outer}>
          <div ref={theadRef} style={{...S.theadWrap, msOverflowStyle:'none'}}>
            <table style={{...S.table, width:`${infoTotalW}px`}}>
              {renderColGroup(INFO_COLUMNS, true, infoActionW)}
              <thead><tr>
                <th style={S.thCheck}><input type="checkbox" checked={filteredInfo.length>0&&infoSelected.length===filteredInfo.length} onChange={()=>setInfoSelected(infoSelected.length===filteredInfo.length?[]:filteredInfo.map(i=>i.id))}/></th>
                {INFO_COLUMNS.map(c=>(<th key={c.key} style={c.sortable?S.thSort:S.th} onClick={c.sortable?()=>{if(infoSortField===c.key)setInfoSortDir(d=>d==='asc'?'desc':'asc');else{setInfoSortField(c.key);setInfoSortDir('asc');}}:undefined}>{c.label}{c.sortable?(infoSortField===c.key?(infoSortDir==='asc'?' ▲':' ▼'):' ↕'):''}</th>))}
                <th style={S.thAction}>Action</th>
              </tr></thead>
            </table>
          </div>
          <div ref={tbodyRef} style={S.tbodyWrap} onScroll={syncScroll}>
            <table style={{...S.table, width:`${infoTotalW}px`}}>
              {renderColGroup(INFO_COLUMNS, true, infoActionW)}
              <tbody>
                {filteredInfo.map(item=>(
                  <tr key={item.id} style={{ background:infoSelected.includes(item.id)?'#f0f7ff':'white' }}>
                    <td style={S.tdCenter}><input type="checkbox" checked={infoSelected.includes(item.id)} onChange={()=>setInfoSelected(prev=>prev.includes(item.id)?prev.filter(s=>s!==item.id):[...prev,item.id])}/></td>
                    {INFO_COLUMNS.map(c=><td key={c.key} style={S.td} title={item[c.key]||''}>{item[c.key]||'-'}</td>)}
                    <td style={S.tdCenter}>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                        {branchTaxIds.has(item['TAX ID'])&&<button onClick={()=>handleFilterByTaxId(item['TAX ID'])} title="Filter Branch" style={S.iconBtn('#1a3a5c')}>🔍</button>}
                        {isEditor&&<button onClick={()=>handleInfoEdit(item)} style={S.iconBtn('#555','#f5f5f5','#ddd')}>✏️</button>}
                        {isAdmin&&<button onClick={()=>handleInfoDelete(item.id)} style={S.iconBtn('#791F1F','#FCEBEB','#f7c1c1')}>🗑️</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ):(
        <div ref={containerRef} style={S.outer}>
          <div ref={theadRef} style={{...S.theadWrap, msOverflowStyle:'none'}}>
            <table style={{...S.table, width:`${branchTotalW}px`}}>
              {renderColGroup(BRANCH_COLUMNS, true, branchActionW)}
              <thead><tr>
                <th style={S.thCheck}><input type="checkbox" checked={pagedBranch.length>0&&pagedBranch.every(i=>branchSelected.includes(i.id))} onChange={()=>{const ids=pagedBranch.map(i=>i.id);const all=ids.every(id=>branchSelected.includes(id));setBranchSelected(all?branchSelected.filter(id=>!ids.includes(id)):[...new Set([...branchSelected,...ids])]);}} /></th>
                {BRANCH_COLUMNS.map(c=>(<th key={c.key} style={c.sortable?S.thSort:S.th} onClick={c.sortable?()=>{if(branchSortField===c.key)setBranchSortDir(d=>d==='asc'?'desc':'asc');else{setBranchSortField(c.key);setBranchSortDir('asc');}}:undefined}>{c.label}{c.sortable?(branchSortField===c.key?(branchSortDir==='asc'?' ▲':' ▼'):' ↕'):''}</th>))}
                <th style={S.thAction}>Action</th>
              </tr></thead>
            </table>
          </div>
          <div ref={tbodyRef} style={S.tbodyWrap} className="table-scroll" onScroll={syncScroll}>
            <table style={{...S.table, width:`${branchTotalW}px`}}>
              {renderColGroup(BRANCH_COLUMNS, true, branchActionW)}
              <tbody>
                {pagedBranch.map(item=>(
                  <tr key={item.id} style={{ background:branchSelected.includes(item.id)?'#f0f7ff':'white' }}>
                    <td style={S.tdCenter}><input type="checkbox" checked={branchSelected.includes(item.id)} onChange={()=>setBranchSelected(prev=>prev.includes(item.id)?prev.filter(s=>s!==item.id):[...prev,item.id])}/></td>
                    {BRANCH_COLUMNS.map(c=>(<td key={c.key} style={S.td} title={item[c.key]||''}>{c.key==='status'?statusBadge(item[c.key]):(item[c.key]||'-')}</td>))}
                    <td style={S.tdCenter}>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                        <button onClick={()=>handleOpenDetail(item)} title="View / Edit" style={S.iconBtn('#1a3a5c')}>🔍</button>
                        {isAdmin&&<button onClick={()=>handleBranchDelete(item.id)} style={S.iconBtn('#791F1F','#FCEBEB','#f7c1c1')}>🗑️</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showInfoForm&&(<div style={S.overlay}><div style={S.modal}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <h3 style={{ fontSize:'15px', margin:0 }}>{infoEditId?'✏️ Edit Info':'+ New Info'}</h3>
          <div style={{ display:'flex', gap:'8px' }}>
            <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setShowInfoForm(false)}>Cancel</button>
            <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleInfoSave}>Save</button>
          </div>
        </div>
        <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
          {INFO_EDIT.map(([key,label])=>(
            <div key={key}>
              <label style={{ fontSize:'12px', color:'#666' }}>{label}</label>
              {INFO_COMBO.includes(key)
                ? <ComboBox value={infoForm[key]} onChange={val=>setInfoForm({...infoForm,[key]:val})} options={getInfoOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`}/>
                : <input style={S.input} value={infoForm[key]} onChange={e=>setInfoForm({...infoForm,[key]:e.target.value})}/>
              }
            </div>
          ))}
          <label style={{ fontSize:'12px', color:'#666' }}>Updated By</label>
          <input style={S.inputDisabled} value={userName||currentUser?.email||''} disabled/>
        </div>
      </div></div>)}

      {showBranchDetail&&branchDetailItem&&(<div style={S.overlay}><div style={S.modal}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'14px', fontWeight:'500' }}>{branchDetailEditMode?'✏️ Edit Branch':`🔍 ${branchDetailItem['Branch Code']||'Branch Detail'}`}</span>
            {!branchDetailEditMode&&isEditor&&<button onClick={()=>setBranchDetailEditMode(true)} style={{ padding:'3px 10px', borderRadius:'5px', border:'1px solid #1a3a5c', background:'white', color:'#1a3a5c', fontSize:'12px', cursor:'pointer' }}>✏️ Edit</button>}
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            {branchDetailEditMode?(<><button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>{setBranchDetailEditMode(false);setBranchDetailError('');setBranchDetailForm(Object.fromEntries(BRANCH_EDIT.map(([k])=>[k,branchDetailItem[k]||''])));}}>Cancel</button><button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleBranchDetailSave}>Save</button></>)
            :<button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setShowBranchDetail(false)}>Close</button>}
          </div>
        </div>
        {renderBranchFormFields(branchDetailForm,setBranchDetailForm,branchDetailError,setBranchDetailError,branchDetailEditMode)}
        {!branchDetailEditMode&&(<div style={{ padding:'0 20px 16px', borderTop:'0.5px solid #f0f0f0', marginTop:'4px' }}><div style={{ display:'flex', gap:'16px', paddingTop:'12px' }}><div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Updated By</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{branchDetailItem['updated_by']||'-'}</div></div><div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Updated At</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{formatLastUpdate(branchDetailItem['updated_at'])}</div></div></div></div>)}
      </div></div>)}

      {showBranchNew&&(<div style={S.overlay}><div style={S.modal}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <h3 style={{ fontSize:'15px', margin:0 }}>+ New Branch</h3>
          <div style={{ display:'flex', gap:'8px' }}>
            <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>{setShowBranchNew(false);setBranchNewForm({});setBranchNewError('');}}>Cancel</button>
            <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleBranchNewSave}>Save</button>
          </div>
        </div>
        {renderBranchFormFields(branchNewForm,setBranchNewForm,branchNewError,setBranchNewError,true)}
      </div></div>)}

      {showRateConfirm&&rateConfirmData&&(<div style={{...S.overlay,zIndex:1000}}>
        <div style={{ background:'white', borderRadius:'12px', width:isMobile?'90vw':'420px', padding:'24px' }}>
          <div style={{ fontSize:'24px', textAlign:'center', marginBottom:'8px' }}>⚠️</div>
          <h3 style={{ fontSize:'15px', fontWeight:'600', textAlign:'center', marginBottom:'16px' }}>ยืนยันการเปลี่ยน VAT Rate</h3>
          <div style={{ background:'#f8f9fa', borderRadius:'8px', padding:'16px', marginBottom:'16px' }}>
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'20px', marginBottom:'12px' }}>
              <div style={{ textAlign:'center' }}><div style={{ fontSize:'11px', color:'#888', marginBottom:'4px' }}>Rate เดิม → Last Rate (%)</div><div style={{ fontSize:'22px', fontWeight:'600', color:'#791F1F' }}>{rateConfirmData.oldRate}%</div></div>
              <div style={{ fontSize:'22px', color:'#888' }}>→</div>
              <div style={{ textAlign:'center' }}><div style={{ fontSize:'11px', color:'#888', marginBottom:'4px' }}>Rate ใหม่ → VAT %</div><div style={{ fontSize:'22px', fontWeight:'600', color:'#27500A' }}>{rateConfirmData.newRate}%</div></div>
            </div>
            <div style={{ textAlign:'center', fontSize:'12px', color:'#555', borderTop:'0.5px solid #e8e8e8', paddingTop:'12px' }}>จะอัปเดต <strong style={{ color:'#1a3a5c' }}>{rateConfirmData.branchCount} สาขา</strong> ที่มี Tax ID: {rateConfirmData.taxId}</div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={()=>{setShowRateConfirm(false);setRateConfirmData(null);}} style={{ flex:1, padding:'10px', borderRadius:'8px', border:'1px solid #ddd', background:'white', fontSize:'13px', cursor:'pointer', color:'#555' }}>Cancel</button>
            <button onClick={handleRateConfirm} style={{ flex:1, padding:'10px', borderRadius:'8px', border:'none', background:'#1a3a5c', color:'white', fontSize:'13px', cursor:'pointer', fontWeight:'500' }}>✅ ยืนยัน อัปเดต {rateConfirmData.branchCount} สาขา</button>
          </div>
        </div>
      </div>)}

      <ImportPreviewModal show={showInfoPreview} onClose={()=>{setShowInfoPreview(false);setInfoPreviewRows([]);}} onConfirm={handleInfoConfirmImport} importing={infoImporting} previewRows={infoPreviewRows} keyField={INFO_KEY} allFields={INFO_FIELDS} isMobile={isMobile}/>
      <ImportPreviewModal show={showBranchPreview} onClose={()=>{setShowBranchPreview(false);setBranchPreviewRows([]);}} onConfirm={handleBranchConfirmImport} importing={branchImporting} previewRows={branchPreviewRows} keyField={BRANCH_KEY} allFields={BRANCH_FIELDS} isMobile={isMobile}/>
    </div>
  );
}

export default BusinessUnit;