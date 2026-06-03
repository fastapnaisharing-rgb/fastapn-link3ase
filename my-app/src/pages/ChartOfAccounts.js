import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabase';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';
import { useDataCache } from '../contexts/DataCacheContext';

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
  const filtered = [...new Set(options.filter(o => o && o.toLowerCase().includes(input.toLowerCase())))].slice(0, 20);
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
  const displayFields = allFields.filter(f => !['updated_by','updated_at'].includes(f)).slice(0, 5);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: 'white', borderRadius: '10px', padding: '20px', width: isMobile ? '95vw' : '90vw', maxWidth: '1100px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', margin: 0 }}>📋 Preview ข้อมูลที่จะ Import</h3>
          <span style={{ fontSize: '12px', color: '#0F6E56', fontWeight: '500' }}>{previewRows.length} รายการในไฟล์</span>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: '#666', marginBottom: '12px' }}>
          ℹ️ ระบบตรวจสอบจาก <strong style={{ margin: '0 3px' }}>{keyField}</strong> — เปรียบเทียบกับข้อมูลในระบบ
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {[['new','➕ New','#EAF3DE','#27500A'],['update','🔄 Update','#e8f0fb','#1a3a5c'],['nochange','✅ No Change','#f5f5f5','#666'],['duplicate','⚠️ Duplicate','#FFF3CD','#856404']].map(([key,label,bg,color]) => (
            summary[key] ? <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', background: bg, color }}>{label} <strong>{summary[key]}</strong></span> : null
          ))}
        </div>
        <div style={{ overflow: 'auto', flex: 1, borderRadius: '6px', border: '0.5px solid #e8e8e8', marginBottom: '14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, width: '100px' }}>สถานะ</th>
                {displayFields.map(f => <th key={f} style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{f}</th>)}
                <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, minWidth: '200px' }}>การเปลี่ยนแปลง</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => {
                const rowBg = { new: '#f9fffe', update: '#f5f8ff', nochange: 'white', duplicate: '#fffdf0' }[row._status] || 'white';
                return (
                  <tr key={i} style={{ background: rowBg, opacity: row._status === 'nochange' ? 0.65 : 1 }}>
                    <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'top' }}>{statusTag(row._status)}</td>
                    {displayFields.map(f => <td key={f} style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[f] ?? '') || '-'}</td>)}
                    <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'top' }}>
                      {row._status === 'update' && row._changes?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {row._changes.map((c, ci) => (
                            <div key={ci} style={{ fontSize: '10px', background: '#f0f7ff', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', gap: '4px', alignItems: 'center', maxWidth: '300px' }}>
                              <span style={{ color: '#555', fontWeight: '500' }}>{c.field}:</span>
                              <span style={{ color: '#791F1F', textDecoration: 'line-through' }}>{c.old || '-'}</span>
                              <span style={{ color: '#888' }}>→</span>
                              <span style={{ color: '#27500A', fontWeight: '500' }}>{c.new || '-'}</span>
                            </div>
                          ))}
                        </div>
                      ) : row._status === 'new' ? <span style={{ fontSize: '10px', color: '#888' }}>เพิ่มใหม่</span>
                        : row._status === 'duplicate' ? <span style={{ fontSize: '10px', color: '#856404' }}>{keyField} ซ้ำในไฟล์ — ข้ามแถวนี้</span>
                        : <span style={{ fontSize: '10px', color: '#aaa' }}>ข้อมูลเหมือนเดิม</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#888' }}>จะ Import เฉพาะ ➕ New และ 🔄 Update รวม <strong style={{ color: '#1a3a5c' }}>{confirmCount} รายการ</strong></span>
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

const SUPABASE_TABLE = {
  CpcList:    'cpc_list',
  AccountList:'account_list',
  SubAccList: 'sub_acc_list',
};

const TAB_CONFIG = {
  costcenter: {
    label: 'Cost Center', icon: '🏷️', collection: 'CpcList', key: 'CPC Code',
    fields: ['CPC Code','Description','Type','BU','updated_by','updated_at'],
    combo: ['Type','BU'],
    edit: [['CPC Code','CPC Code'],['Description','Description'],['Type','Type'],['BU','BU']],
    columns: [
      { key: 'CPC Code', label: 'CPC Code', sortable: true, w: 110 },
      { key: 'Description', label: 'Description', w: 280 },
      { key: 'Type', label: 'Type', w: 120 },
      { key: 'BU', label: 'BU', sortable: true, w: 120 },
      { key: 'updated_by', label: 'Updated By', w: 110 },
      { key: 'updated_at', label: 'Updated At', w: 140 },
    ],
  },
  account: {
    label: 'Account', icon: '📒', collection: 'AccountList', key: 'Acccount',
    fields: ['bu','GL Code','Name','Acccount','Account_Name','Remark','Account Type','updated_by','updated_at'],
    combo: ['bu','Account Type'],
    edit: [['bu','BU'],['GL Code','GL Code'],['Name','Name'],['Acccount','Account'],['Account_Name','Account Name'],['Remark','Remark'],['Account Type','Account Type']],
    columns: [
      { key: 'Acccount', label: 'Account', sortable: true, w: 110 },
      { key: 'GL Code', label: 'GL Code', sortable: true, w: 100 },
      { key: 'Account_Name', label: 'Account Name', w: 300, flex: true },
      { key: 'Remark', label: 'Remark', w: 200, flex: true },
    ],
  },
  subaccount: {
    label: 'Sub Account', icon: '🔖', collection: 'SubAccList', key: 'Sub Acc Code',
    fields: ['Sub Acc Code','Description','updated_by','updated_at'],
    combo: [],
    edit: [['Sub Acc Code','Sub Acc Code'],['Description','Description']],
    columns: [
      { key: 'Sub Acc Code', label: 'Sub Acc Code', sortable: true, w: 120 },
      { key: 'Description', label: 'Description', w: 300 },
      { key: 'updated_by', label: 'Updated By', w: 110 },
      { key: 'updated_at', label: 'Updated At', w: 140 },
    ],
  },
};

const isRevAccount = (item) => item['bu'] === 'REV';

function ChartOfAccounts({ activeSubTab, onSubTabChange, flyoutOpen = false }) {
  const [tab, setTab] = useState(activeSubTab || 'costcenter');
  const { currentUser, userName } = useAuth();
  const { fetchCollection, invalidate } = useDataCache();
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;
  const isTablet = screenWidth >= 768 && screenWidth < 1200;

  const cfg = TAB_CONFIG[tab];

  const [dataMap, setDataMap] = useState({ costcenter: [], account: [], subaccount: [] });
  const [searchMap, setSearchMap] = useState({ costcenter: '', account: '', subaccount: '' });
  const [selectedMap, setSelectedMap] = useState({ costcenter: [], account: [], subaccount: [] });
  const [sortMap, setSortMap] = useState({
    costcenter: { field: 'CPC Code', dir: 'asc' },
    account: { field: 'Acccount', dir: 'asc' },
    subaccount: { field: 'Sub Acc Code', dir: 'asc' }
  });
  const [accountFilter, setAccountFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [detailForm, setDetailForm] = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [pageMap, setPageMap] = useState({ costcenter: 1, account: 1, subaccount: 1 });

  const fileRef = useRef(null);
  const theadRef = useRef(null);
  const tbodyRef = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const syncScroll = () => { if (theadRef.current && tbodyRef.current) theadRef.current.scrollLeft = tbodyRef.current.scrollLeft; };

  const items = dataMap[tab] || [];
  const search = searchMap[tab] || '';
  const selected = selectedMap[tab] || [];
  const sort = sortMap[tab] || { field: cfg.key, dir: 'asc' };
  const page = pageMap[tab] || 1;
  const tableName = (t) => SUPABASE_TABLE[TAB_CONFIG[t].collection];

  const fetchTab = useCallback(async (t) => {
    const data = await fetchCollection(TAB_CONFIG[t].collection);
    setDataMap(prev => ({ ...prev, [t]: data }));
  }, [fetchCollection]);

  useEffect(() => {
    fetchTab('costcenter');
    fetchTab('account');
    fetchTab('subaccount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (activeSubTab && activeSubTab !== tab) setTab(activeSubTab); }, [activeSubTab, tab]);
  useEffect(() => { setAccountFilter('ALL'); }, [tab]);
  useEffect(() => { setPageMap(prev => ({ ...prev, [tab]: 1 })); }, [tab, accountFilter, search]);

  // ✅ FIX 1: เพิ่ม flyoutOpen ใน deps → re-measure ทันทีที่ sidebar พับ/ขยาย
  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => {
      setContainerW(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [flyoutOpen]);

  const handleTabChange = (t) => { setTab(t); if (onSubTabChange) onSubTabChange(t); };

  const buList = useMemo(() => {
    if (tab !== 'account') return [];
    return [...new Set(items.map(i => i['bu']).filter(v => v && v !== 'ALL' && v !== 'REV'))].sort();
  }, [items, tab]);

  const filterCounts = useMemo(() => {
    if (tab !== 'account') return {};
    const counts = {};
    items.forEach(i => { const bu = i['bu'] || 'ALL'; counts[bu] = (counts[bu] || 0) + 1; });
    return counts;
  }, [items, tab]);

  const getFileTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  };

  const formatLastUpdate = (val) => {
    if (!val || val === '-') return '-';
    try { const d = new Date(val); if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch { }
    return val;
  };

  const getOptions = (field) => [...new Set(items.map(i => i[field] || '').filter(v => v))];

  const buildPreviewRows = (rawRows, existingItems, keyField, allFields) => {
    const dataFields = allFields.filter(f => !['updated_by','updated_at'].includes(f));
    const existingMap = {};
    existingItems.forEach(item => { if (item[keyField]) existingMap[String(item[keyField]).trim()] = item; });
    const seenKeys = new Set();
    return rawRows.map(row => {
      const keyVal = String(row[keyField] ?? '').trim();
      if (!keyVal) return { ...row, _status: 'duplicate', _changes: [] };
      if (seenKeys.has(keyVal)) return { ...row, _status: 'duplicate', _changes: [] };
      seenKeys.add(keyVal);
      const existing = existingMap[keyVal];
      if (!existing) return { ...row, _status: 'new', _changes: [] };
      const changes = [];
      dataFields.forEach(f => {
        const newVal = String(row[f] ?? '').trim();
        const oldVal = String(existing[f] ?? '').trim();
        if (newVal !== oldVal) changes.push({ field: f, old: oldVal, new: newVal });
      });
      return { ...row, _status: changes.length > 0 ? 'update' : 'nochange', _changes: changes, _existingId: existing.id };
    });
  };

  const exportToExcel = (data, fields, sheetName, filePrefix) => {
    const rows = data.map(item => { const row = {}; fields.forEach(f => { row[f] = item[f] || ''; }); return row; });
    const ws = XLSX.utils.json_to_sheet(rows, { header: fields });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${filePrefix}_${getFileTimestamp()}.xlsx`);
  };

  const handleExportSelected = () => exportToExcel(items.filter(i => selected.includes(i.id)), cfg.fields.filter(f => !['updated_by','updated_at'].includes(f)), cfg.label, cfg.label.replace(/ /g,''));
  const handleExportAll = () => exportToExcel(filtered, cfg.fields.filter(f => !['updated_by','updated_at'].includes(f)), cfg.label, cfg.label.replace(/ /g,''));

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([cfg.fields.filter(f => !['updated_by','updated_at'].includes(f))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label);
    XLSX.writeFile(wb, `${cfg.label.replace(/ /g,'')}_Template.xlsx`);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (tab === 'account') {
        setPreviewRows(rawRows.map(row => ({ ...row, _status: 'new', _changes: [] })));
      } else {
        setPreviewRows(buildPreviewRows(rawRows, items, cfg.key, cfg.fields));
      }
      setShowPreview(true);
    };
    reader.readAsBinaryString(file); e.target.value = '';
  };

  const buildRowData = (row, fields) => {
    const data = {};
    fields.forEach(k => {
      if (k === 'updated_by') data[k] = userName || currentUser?.email || '';
      else if (k === 'updated_at') data[k] = new Date().toISOString();
      else data[k] = String(row[k] ?? '');
    });
    return data;
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      const tbl = tableName(tab);
      if (tab === 'account') {
        const insertData = previewRows.map(row => buildRowData(row, cfg.fields));
        for (let i = 0; i < insertData.length; i += 500) {
          const { error } = await supabase.from(tbl).insert(insertData.slice(i, i + 500));
          if (error) throw error;
        }
        alert(`✅ Import สำเร็จ ${previewRows.length} รายการ`);
      } else {
        const toProcess = previewRows.filter(r => r._status === 'new' || r._status === 'update');
        const newRows = toProcess.filter(r => r._status === 'new');
        const updateRows = toProcess.filter(r => r._status === 'update');
        if (newRows.length > 0) {
          for (let i = 0; i < newRows.length; i += 500) {
            const { error } = await supabase.from(tbl).insert(newRows.slice(i, i + 500).map(row => buildRowData(row, cfg.fields)));
            if (error) throw error;
          }
        }
        for (const row of updateRows) {
          const { error } = await supabase.from(tbl).update(buildRowData(row, cfg.fields)).eq('id', row._existingId);
          if (error) throw error;
        }
        alert(`✅ Import สำเร็จ — New: ${newRows.length} / Update: ${updateRows.length}`);
      }
      setShowPreview(false); setPreviewRows([]);
      invalidate(cfg.collection);
      await fetchTab(tab);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setImporting(false);
  };

  const handleNewSave = async () => {
    try {
      const tbl = tableName(tab);
      const data = buildRowData(form, cfg.fields);
      if (editId) {
        const { error } = await supabase.from(tbl).update(data).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(tbl).insert([data]);
        if (error) throw error;
      }
      setShowForm(false); setEditId(null); setForm({});
      invalidate(cfg.collection);
      await fetchTab(tab);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('ต้องการลบรายการนี้?')) {
      const { error } = await supabase.from(tableName(tab)).delete().eq('id', id);
      if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return; }
      setSelectedMap(prev => ({ ...prev, [tab]: prev[tab].filter(s => s !== id) }));
      invalidate(cfg.collection);
      await fetchTab(tab);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${selected.length} รายการ?`)) return;
    const { error } = await supabase.from(tableName(tab)).delete().in('id', selected);
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return; }
    setSelectedMap(prev => ({ ...prev, [tab]: [] }));
    invalidate(cfg.collection);
    await fetchTab(tab);
  };

  const handleOpenDetail = (item) => {
    setDetailItem(item);
    setDetailForm(Object.fromEntries(cfg.edit.map(([k]) => [k, item[k] || ''])));
    setDetailEditMode(false);
    setShowDetailModal(true);
  };

  const handleDetailSave = async () => {
    try {
      const { error } = await supabase.from(tableName(tab)).update(buildRowData(detailForm, cfg.fields)).eq('id', detailItem.id);
      if (error) throw error;
      setShowDetailModal(false);
      invalidate(cfg.collection);
      await fetchTab(tab);
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
  };

  const filtered = useMemo(() => {
    let result = items;
    if (tab === 'account') {
      if (accountFilter === 'REV') result = result.filter(isRevAccount);
      else if (accountFilter === 'ALL') result = result.filter(i => i['bu'] === 'ALL');
      else result = result.filter(i => i['bu'] === accountFilter);
    }
    return result
      .filter(i => cfg.fields.some(f => String(i[f] || '').toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => { const ca = a[sort.field] || '', cb = b[sort.field] || ''; return sort.dir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca); });
  }, [items, search, sort, tab, accountFilter, cfg.fields]);

  const effectivePageSize = pageSize === 'ทั้งหมด' || pageSize >= filtered.length ? filtered.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const paginated = filtered.slice((page - 1) * effectivePageSize, page * effectivePageSize);

  const typeBadge = (val) => {
    const map = { 'Cost Center': ['#FFF3CD','#856404'], 'Expense': ['#e8f0fb','#1a3a5c'], 'Asset': ['#FCEBEB','#791F1F'] };
    const [bg, color] = map[val] || ['#e8e8e8','#555'];
    return <span style={{ background: bg, color, padding: '2px 8px', borderRadius: '20px', fontSize: '10px' }}>{val || '-'}</span>;
  };

  const renderCell = (c, item) => {
    if (c.key === 'updated_at') return formatLastUpdate(item[c.key]);
    if (c.key === 'Type') return typeBadge(item[c.key]);
    return item[c.key] || '-';
  };

  const actionW = isAdmin ? 120 : 90;
  const minW = 36 + cfg.columns.reduce((s,c) => s+c.w, 0) + actionW;
  const maxScaleW = minW + 600;
  const totalW = containerW > 0 ? Math.min(Math.max(minW, containerW), maxScaleW) : minW;
  const extraW = totalW - minW;
  const COLUMNS_SCALED = cfg.columns.map(c => {
    if (c.key === 'Description') return { ...c, w: c.w + Math.min(extraW * 0.6, 200) };
    if (c.key === 'Account_Name') return { ...c, w: c.w + Math.min(Math.floor(extraW * 0.55), 400) };
    if (c.key === 'Remark') return { ...c, w: c.w + Math.min(Math.floor(extraW * 0.35), 300) };
    return c;
  });

  const S = {
    // ✅ FIX 2: minWidth:0 + overflow:hidden → flex child shrink ได้ถูกต้อง
    container: { padding: isMobile ? '12px' : '20px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' },
    topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: isMobile ? 'wrap' : 'nowrap', gap: '8px' },
    btn: { padding: isMobile ? '6px 10px' : '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: isMobile ? '12px' : '13px', marginLeft: isMobile ? '4px' : '8px' },
    // ✅ FIX 3: minWidth:0 → scrollbar แสดงถูกต้องเมื่อ sidebar พับ
    outer: { background: 'white', borderRadius: '8px', border: '0.5px solid #e8e8e8', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
    theadWrap: { overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' },
    tbodyWrap: { overflowY: 'auto', overflowX: 'auto', flex: 1, minWidth: 0 },
    table: { borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' },
    th: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    thSort: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis' },
    thCheck: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', width: '36px' },
    thAction: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: '500' },
    td: { padding: '7px 10px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    tdCenter: { padding: '6px 8px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box' },
    inputDisabled: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #eee', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box', background: '#f5f5f5', color: '#999' },
    inputReadonly: { padding: '6px 10px', borderRadius: '6px', border: '1px solid #f0f0f0', fontSize: '12px', width: '100%', marginBottom: '6px', boxSizing: 'border-box', background: '#fafafa', color: '#333' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '10px', width: isMobile ? '95vw' : '500px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    iconBtn: (color, bg, border) => ({ background: bg||'none', border: `0.5px solid ${border||color}`, borderRadius: '4px', cursor: 'pointer', padding: '3px 6px', color, fontSize: '12px', lineHeight: 1 }),
  };

  const renderColGroup = (columns) => (
    <colgroup>
      <col style={{ width: '36px', minWidth: '36px' }} />
      {columns.map((c,i) => <col key={i} style={{ width: `${c.w}px`, minWidth: `${c.w}px` }} />)}
      <col style={{ width: `${actionW}px`, minWidth: `${actionW}px` }} />
    </colgroup>
  );

  const renderFormFields = (formData, setFormData, editMode = true) => (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
      {cfg.edit.map(([key, label]) => (
        <div key={key} style={{ marginBottom: '4px' }}>
          <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '2px' }}>{label}</label>
          {editMode ? (
            cfg.combo.includes(key)
              ? <ComboBox value={formData[key] || ''} onChange={val => setFormData({ ...formData, [key]: val })} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
              : <input style={S.input} value={formData[key] || ''} onChange={e => setFormData({ ...formData, [key]: e.target.value })} />
          ) : (
            <div style={S.inputReadonly}>
              {key === 'Type' ? typeBadge(formData[key]) : (formData[key] || '-')}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderInfoText = () => {
    if (isMobile) return `${filtered.length} รายการ`;
    const start = (page - 1) * effectivePageSize + 1;
    const end = Math.min(page * effectivePageSize, filtered.length);
    return `แสดง ${start}-${end} จาก ${filtered.length} รายการ${search ? ` | ค้นหา "${search}"` : ''}${selected.length > 0 ? ` | เลือกอยู่ ${selected.length} รายการ` : ''}`;
  };

  const filterTabs = tab === 'account' ? ['ALL', 'REV', ...buList] : [];

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: '600', margin: 0 }}>
            💰 Chart of Accounts
            <span style={{ color: '#888', fontWeight: '400', fontSize: isMobile ? '12px' : '14px' }}> — {cfg.label}</span>
          </h2>
          {isAdmin && selected.length > 0 && <button style={{ ...S.btn, background: '#c0392b', color: 'white', marginLeft: 0 }} onClick={handleBulkDelete}>🗑️{!isMobile && ` ลบ ${selected.length}`}</button>}
          {selected.length > 0 && <ExportDropdown onExportSelected={handleExportSelected} onExportAll={handleExportAll} selectedCount={selected.length} isMobile={isMobile} />}
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '4px' : '0' }}>
            <button style={{ ...S.btn, background: '#0F6E56', color: 'white' }} onClick={handleDownloadTemplate}>⬇{!isMobile && ' Template'}</button>
            <button style={{ ...S.btn, background: '#5DCAA5', color: '#1a3a5c' }} onClick={() => fileRef.current.click()}>📂{!isMobile && ' Import'}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
            <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setForm(Object.fromEntries(cfg.edit.map(([k]) => [k,'']))); setEditId(null); setShowForm(true); }}>+ New</button>
          </div>
        )}
      </div>

      {filterTabs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '10px 0 0', flexShrink: 0, borderBottom: '2px solid #e8e8e8', overflowX: 'auto' }}>
          {filterTabs.map(f => (
            <div key={f} onClick={() => setAccountFilter(f)}
              style={{ padding: isMobile ? '6px 10px' : '8px 14px', fontSize: isMobile ? '11px' : '12px', cursor: 'pointer', color: accountFilter === f ? '#1a3a5c' : '#888', borderBottom: accountFilter === f ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom: '-2px', background: accountFilter === f ? 'white' : 'transparent', fontWeight: accountFilter === f ? '500' : '400', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {f}
              <span style={{ background: accountFilter === f ? '#1a3a5c' : '#e8e8e8', color: accountFilter === f ? 'white' : '#888', fontSize: '10px', padding: '1px 5px', borderRadius: '20px' }}>
                {filterCounts[f] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', margin: '4px 0', flexShrink: 0, gap: '8px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            placeholder={isMobile ? 'Search...' : `Search ${cfg.label}...`}
            value={search}
            onChange={e => setSearchMap(prev => ({ ...prev, [tab]: e.target.value }))}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', width: isMobile ? '120px' : isTablet ? '160px' : '220px' }}
          />
          {!isMobile && <span style={{ fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>{renderInfoText()}</span>}
        </div>
        {tab === 'account' && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#888', marginRight: '4px' }}>
              <select value={pageSize} onChange={e => { setPageSize(e.target.value === 'ทั้งหมด' ? 'ทั้งหมด' : Number(e.target.value)); setPageMap(prev => ({ ...prev, [tab]: 1 })); }}
                style={{ padding: '3px 6px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white', cursor: 'pointer' }}>
                {[10,25,50,100,'ทั้งหมด'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {!isMobile && <span>รายการ/หน้า</span>}
            </div>
            <button onClick={() => setPageMap(prev => ({ ...prev, [tab]: 1 }))} disabled={page === 1}
              style={{ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', background: page === 1 ? '#f5f5f5' : 'white', cursor: page === 1 ? 'default' : 'pointer', fontSize: '12px', color: page === 1 ? '#ccc' : '#555' }}>«</button>
            <button onClick={() => setPageMap(prev => ({ ...prev, [tab]: prev[tab] - 1 }))} disabled={page === 1}
              style={{ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', background: page === 1 ? '#f5f5f5' : 'white', cursor: page === 1 ? 'default' : 'pointer', fontSize: '12px', color: page === 1 ? '#ccc' : '#555' }}>‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p;
              if (totalPages <= 5) p = i + 1;
              else if (page <= 3) p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else p = page - 2 + i;
              return (
                <button key={p} onClick={() => setPageMap(prev => ({ ...prev, [tab]: p }))}
                  style={{ padding: '3px 9px', borderRadius: '6px', border: '0.5px solid #ddd', background: page === p ? '#1a3a5c' : 'white', color: page === p ? 'white' : '#555', cursor: 'pointer', fontSize: '12px', fontWeight: page === p ? '500' : '400' }}>{p}</button>
              );
            })}
            <button onClick={() => setPageMap(prev => ({ ...prev, [tab]: prev[tab] + 1 }))} disabled={page === totalPages}
              style={{ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', background: page === totalPages ? '#f5f5f5' : 'white', cursor: page === totalPages ? 'default' : 'pointer', fontSize: '12px', color: page === totalPages ? '#ccc' : '#555' }}>›</button>
            <button onClick={() => setPageMap(prev => ({ ...prev, [tab]: totalPages }))} disabled={page === totalPages}
              style={{ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', background: page === totalPages ? '#f5f5f5' : 'white', cursor: page === totalPages ? 'default' : 'pointer', fontSize: '12px', color: page === totalPages ? '#ccc' : '#555' }}>»</button>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: '2px', whiteSpace: 'nowrap' }}>{page} / {totalPages}</span>
          </div>
        )}
      </div>

      <div ref={containerRef} style={S.outer}>
        <div ref={theadRef} style={{ ...S.theadWrap, msOverflowStyle: 'none' }}>
          <table style={{ ...S.table, width: `${totalW}px` }}>
            {renderColGroup(COLUMNS_SCALED)}
            <thead>
              <tr>
                <th style={S.thCheck}>
                  <input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length}
                    onChange={() => setSelectedMap(prev => ({ ...prev, [tab]: prev[tab].length === filtered.length ? [] : filtered.map(i => i.id) }))} />
                </th>
                {COLUMNS_SCALED.map(c => (
                  <th key={c.key} style={c.sortable ? S.thSort : S.th}
                    onClick={c.sortable ? () => setSortMap(prev => ({ ...prev, [tab]: { field: c.key, dir: prev[tab].field === c.key && prev[tab].dir === 'asc' ? 'desc' : 'asc' } })) : undefined}>
                    {c.label}{c.sortable ? (sort.field === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : ''}
                  </th>
                ))}
                <th style={S.thAction}>Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div ref={tbodyRef} style={S.tbodyWrap} className="table-scroll" onScroll={syncScroll}>
          <table style={{ ...S.table, width: `${totalW}px` }}>
            {renderColGroup(COLUMNS_SCALED)}
            <tbody>
              {paginated.map(item => (
                <tr key={item.id} style={{ background: selected.includes(item.id) ? '#f0f7ff' : 'white' }}>
                  <td style={S.tdCenter}>
                    <input type="checkbox" checked={selected.includes(item.id)}
                      onChange={() => setSelectedMap(prev => ({ ...prev, [tab]: prev[tab].includes(item.id) ? prev[tab].filter(s => s !== item.id) : [...prev[tab], item.id] }))} />
                  </td>
                  {COLUMNS_SCALED.map(c => (
                    <td key={c.key} style={S.td} title={item[c.key] || ''}>{renderCell(c, item)}</td>
                  ))}
                  <td style={S.tdCenter}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <button onClick={() => handleOpenDetail(item)} title="View / Edit" style={S.iconBtn('#1a3a5c')}>🔍</button>
                      {isAdmin && <button onClick={() => handleDelete(item.id)} style={S.iconBtn('#791F1F','#FCEBEB','#f7c1c1')}>🗑️</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ fontSize: '15px', margin: 0 }}>{editId ? `✏️ Edit ${cfg.label}` : `+ New ${cfg.label}`}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => setShowForm(false)}>Cancel</button>
                <button style={{ ...S.btn, background: '#1a3a5c', color: 'white', marginLeft: 0 }} onClick={handleNewSave}>Save</button>
              </div>
            </div>
            {renderFormFields(form, setForm, true)}
            <div style={{ padding: '0 20px 16px' }}>
              <label style={{ fontSize: '11px', color: '#888' }}>Updated By</label>
              <input style={S.inputDisabled} value={userName || currentUser?.email || ''} disabled />
            </div>
          </div>
        </div>
      )}

      {showDetailModal && detailItem && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500' }}>{detailEditMode ? `✏️ Edit ${cfg.label}` : `🔍 ${detailItem[cfg.key] || 'Detail'}`}</span>
                {!detailEditMode && <button onClick={() => setDetailEditMode(true)} style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid #1a3a5c', background: 'white', color: '#1a3a5c', fontSize: '12px', cursor: 'pointer' }}>✏️ Edit</button>}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {detailEditMode ? (
                  <>
                    <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => { setDetailEditMode(false); setDetailForm(Object.fromEntries(cfg.edit.map(([k]) => [k, detailItem[k] || '']))); }}>Cancel</button>
                    <button style={{ ...S.btn, background: '#1a3a5c', color: 'white', marginLeft: 0 }} onClick={handleDetailSave}>Save</button>
                  </>
                ) : <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => setShowDetailModal(false)}>Close</button>}
              </div>
            </div>
            {renderFormFields(detailEditMode ? detailForm : Object.fromEntries(cfg.edit.map(([k]) => [k, detailItem[k] || ''])), setDetailForm, detailEditMode)}
            {!detailEditMode && (
              <div style={{ padding: '0 20px 16px', borderTop: '0.5px solid #f0f0f0' }}>
                <div style={{ display: 'flex', gap: '16px', paddingTop: '12px' }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '11px', color: '#888' }}>Updated By</div><div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>{detailItem['updated_by'] || '-'}</div></div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '11px', color: '#888' }}>Updated At</div><div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>{formatLastUpdate(detailItem['updated_at'])}</div></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ImportPreviewModal
        show={showPreview}
        onClose={() => { setShowPreview(false); setPreviewRows([]); }}
        onConfirm={handleConfirmImport}
        importing={importing}
        previewRows={previewRows}
        keyField={cfg.key}
        allFields={cfg.fields}
        isMobile={isMobile}
      />
    </div>
  );
}

export default ChartOfAccounts;