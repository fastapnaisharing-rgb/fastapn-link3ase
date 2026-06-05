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

// ─── Tax ID helpers ───────────────────────────────────────────────────────────
const normalizeTaxId = (val) => { let str = String(val ?? '').trim().replace(/[^0-9]/g, ''); if (str.length === 12) str = '0' + str; return str; };
const normalizeNo = (val) => { const str = String(val ?? '').trim().replace(/[^0-9]/g, ''); return str ? str.padStart(5, '0') : ''; };
const getEntityType = (taxId) => { const str = String(taxId || '').replace(/[^0-9]/g, ''); if (str.length !== 13) return null; if (str[0] === '0') return 'นิติบุคคล'; if (str[0] === '9') return 'องค์กรพิเศษ'; return 'บุคคลธรรมดา'; };
const entityBadge = (taxId) => {
  const type = getEntityType(taxId);
  if (!type) return <span style={{ background:'#FCEBEB', color:'#791F1F', padding:'2px 7px', borderRadius:'20px', fontSize:'10px' }}>ตรวจสอบด้วยตนเอง</span>;
  const map = { 'นิติบุคคล': ['#E6F1FB','#0C447C'], 'บุคคลธรรมดา': ['#EAF3DE','#27500A'], 'องค์กรพิเศษ': ['#EEEDFE','#3C3489'] };
  const [bg, color] = map[type];
  return <span style={{ background: bg, color, padding:'2px 7px', borderRadius:'20px', fontSize:'10px' }}>{type}</span>;
};

// ─── Import Preview Modal ─────────────────────────────────────────────────────
function ImportPreviewModal({ show, onClose, onConfirm, importing, previewRows, keyField, allFields, isMobile, isCategory }) {
  const [filterStatus, setFilterStatus] = React.useState(null);
  const summary = (previewRows || []).reduce((acc, r) => { acc[r._status] = (acc[r._status] || 0) + 1; return acc; }, {});
  const confirmCount = (previewRows || []).filter(r => r._status === 'new' || r._status === 'update').length;
  const displayRows = filterStatus ? (previewRows || []).filter(r => r._status === filterStatus) : (previewRows || []);
  if (!show) return null;
  const statusTag = (s) => {
    const map = { new: { label: '➕ New', bg: '#EAF3DE', color: '#27500A' }, update: { label: '🔄 Update', bg: '#e8f0fb', color: '#1a3a5c' }, nochange: { label: '✅ No Change', bg: '#f5f5f5', color: '#666' }, duplicate: { label: '⚠️ Duplicate', bg: '#FFF3CD', color: '#856404' } };
    const m = map[s] || { label: s, bg: '#eee', color: '#333' };
    return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: '500', background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>;
  };
  const displayFields = allFields.filter(f => !['username', 'last_update'].includes(f)).slice(0, 5);
  const BADGE_CONFIG = [['new','➕ New','#EAF3DE','#27500A','#c0dda0'],['update','🔄 Update','#e8f0fb','#1a3a5c','#aac4e8'],['nochange','✅ No Change','#f5f5f5','#666','#ccc'],['duplicate','⚠️ Duplicate','#FFF3CD','#856404','#f5d87a']];
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: 'white', borderRadius: '10px', padding: '20px', width: isMobile ? '95vw' : '90vw', maxWidth: '1100px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', margin: 0 }}>📋 Preview ข้อมูลที่จะ Import</h3>
          <span style={{ fontSize: '12px', color: '#0F6E56', fontWeight: '500' }}>{(previewRows||[]).length} รายการในไฟล์</span>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: '#666', marginBottom: '12px' }}>
          ℹ️ ระบบตรวจสอบจาก <strong style={{ margin: '0 3px' }}>{keyField}</strong>{isCategory && ' · TAX ID และ No. จะถูก normalize อัตโนมัติ'} Username และ Last Update จะถูก Auto ใส่ให้
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {BADGE_CONFIG.map(([key, label, bg, color, border]) => {
            if (!summary[key]) return null;
            const isActive = filterStatus === key;
            return <span key={key} onClick={() => setFilterStatus(isActive ? null : key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', background: isActive ? bg : '#f5f5f5', color: isActive ? color : '#888', border: `1.5px solid ${isActive ? border : '#ddd'}`, cursor: 'pointer', userSelect: 'none' }}>
              {label} <strong>{summary[key]}</strong>
              {isActive && <span style={{ fontSize: '10px', marginLeft: '2px', opacity: 0.7 }}>✕</span>}
            </span>;
          })}
          {filterStatus && <span style={{ fontSize: '11px', color: '#888' }}>แสดง {displayRows.length} รายการ</span>}
        </div>
        <div style={{ overflow: 'auto', flex: 1, borderRadius: '6px', border: '0.5px solid #e8e8e8', marginBottom: '14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, width: '100px' }}>สถานะ</th>
                {displayFields.map(f => <th key={f} style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{f}</th>)}
                {isCategory && <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>ประเภท</th>}
                <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, minWidth: '200px' }}>การเปลี่ยนแปลง</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => {
                const rowBg = { new: '#f9fffe', update: '#f5f8ff', nochange: 'white', duplicate: '#fffdf0' }[row._status] || 'white';
                return (
                  <tr key={i} style={{ background: rowBg, opacity: row._status === 'nochange' ? 0.65 : 1 }}>
                    <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'top' }}>{statusTag(row._status)}</td>
                    {displayFields.map(f => <td key={f} style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[f] ?? '') || '-'}</td>)}
                    {isCategory && <td style={{ padding: '7px 10px', borderBottom: '0.5px solid #f0f0f0' }}>{entityBadge(row['TAX ID'])}</td>}
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
                        : row._status === 'duplicate' ? <span style={{ fontSize: '10px', color: '#856404' }}>{keyField} ซ้ำในไฟล์</span>
                          : <span style={{ fontSize: '10px', color: '#aaa' }}>ข้อมูลเหมือนเดิม</span>}
                    </td>
                  </tr>
                );
              })}
              {displayRows.length === 0 && <tr><td colSpan={displayFields.length + (isCategory ? 3 : 2)} style={{ padding: '30px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>ไม่มีรายการ</td></tr>}
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

// ─── Tab Config ───────────────────────────────────────────────────────────────
const TAB_CONFIG = {
  apcode: {
    label: 'AP-Code', icon: '🏭', table: 'supplier_list', key: 'Supplier Code',
    fields: ['Supplier Code', 'Name', 'Tax ID', 'Branch', 'Site', 'BU', 'Notice', 'Sub Acc', 'Status', 'username', 'last_update'],
    combo: ['Site', 'BU', 'Notice', 'Status'],
    edit: [['Supplier Code','Supplier Code'],['Name','Name'],['Tax ID','Tax ID'],['Branch','Branch'],['Site','Site'],['BU','BU'],['Notice','Notice'],['Sub Acc','Sub Acc'],['Status','Status']],
    columns: [
      { key: 'Supplier Code', label: 'Supplier Code', sortable: true, w: 130 },
      { key: 'Name',          label: 'Name',           w: 220 },
      { key: 'Tax ID',        label: 'Tax ID',         w: 130 },
      { key: 'Branch',        label: 'Branch',         w: 80  },
      { key: 'Site',          label: 'Site',           w: 140 },
      { key: 'BU',            label: 'BU', sortable: true, w: 80 },
      { key: 'Notice',        label: 'Notice',         w: 100 },
      { key: 'Sub Acc',       label: 'Sub Acc',        w: 90  },
      { key: 'Status',        label: 'Status',         w: 90  },
    ],
  },
  smcode: {
    label: 'SM-Code', icon: '🔖', table: 'sm_code_list', key: 'SM-Code',
    fields: ['SM-Code', 'Company Name', 'Tax ID', 'Branch', 'Short Name', 'CPC_Dr', 'Account_Dr', 'Sub Acc_Dr', 'Expense Type', 'First Part', 'Mid Part', 'Last Part', 'Special Rule1', 'Special Rule2', 'Simple Rule3', 'Special Rule4', 'Special Rule5', 'Digit', 'CPC_Cr', 'Account_Dr2', 'Sub Acc_Cr', 'BU', 'Ofin Code', 'Simple Brand Code', 'Short Branch', 'Remark', 'Supplier Code', 'username', 'last_update'],
    combo: ['BU', 'Short Name'],
    edit: [
      ['SM-Code','SM-Code'],['Company Name','Company Name'],['Tax ID','Tax ID'],['Branch','Branch'],['Short Name','AT-Match (Short Name)'],
      ['CPC_Dr','CPC Dr'],['Account_Dr','Account Dr'],['Sub Acc_Dr','Sub Acc Dr'],
      ['CPC_Cr','CPC Cr'],['Account_Dr2','Account Cr'],['Sub Acc_Cr','Sub Acc Cr'],
      ['Expense Type','Expense Type'],['First Part','First Part'],['Mid Part','Mid Part'],['Last Part','Last Part'],
      ['Special Rule1','Rule1'],['Special Rule2','Rule2'],['Simple Rule3','Rule3'],['Special Rule4','Rule4'],['Special Rule5','Rule5'],
      ['Digit','Digit'],['BU','BU'],['Ofin Code','Ofin Code'],['Simple Brand Code','Brand Code'],['Short Branch','Short Branch'],['Remark','Remark'],['Supplier Code','Supplier Code'],
    ],
    columns: [
      { key: 'SM-Code',        label: 'SM-Code',        sortable: true, w: 110 },
      { key: 'Company Name',   label: 'Company Name',   w: 200 },
      { key: 'Tax ID',         label: 'Tax ID',         w: 120 },
      { key: 'Branch',         label: 'Branch',         w: 65  },
      { key: '_debitAccount',  label: 'Debit Account',  w: 150 },
      { key: '_creditAccount', label: 'Credit Account', w: 150 },
      { key: 'Short Name',     label: 'AT-Match',       w: 90  },
      { key: 'Special Rule1',  label: 'Rule1',          w: 60  },
      { key: 'Special Rule2',  label: 'Rule2',          w: 60  },
      { key: 'Simple Rule3',   label: 'Rule3',          w: 60  },
      { key: 'Special Rule4',  label: 'Rule4',          w: 60  },
      { key: 'Special Rule5',  label: 'Rule5',          w: 60  },
      { key: 'BU',             label: 'BU', sortable: true, w: 80 },
    ],
  },
  category: {
    label: 'Category', icon: '🗂️', table: 'vendor_category', key: 'Code',
    fields: ['Code', 'Supplier Name', 'TAX ID', 'No.', 'BU', 'TYPE', 'SUB TYPE', 'REMARK', 'username', 'last_update'],
    combo: ['BU', 'TYPE', 'SUB TYPE'],
    edit: [['Code','Code'],['Supplier Name','Supplier Name'],['TAX ID','TAX ID'],['No.','No.'],['BU','BU'],['TYPE','TYPE'],['SUB TYPE','SUB TYPE'],['REMARK','REMARK']],
    columns: [
      { key: 'Code',          label: 'Code',          sortable: true, w: 130 },
      { key: 'Supplier Name', label: 'Supplier Name', w: 320 },
      { key: 'TAX ID',        label: 'TAX ID',        w: 130 },
      { key: '_entityType',   label: 'ประเภท',        w: 110 },
      { key: 'No.',           label: 'No.',           w: 70  },
      { key: 'BU',            label: 'BU', sortable: true, w: 80 },
      { key: 'TYPE',          label: 'TYPE',          w: 100 },
      { key: 'SUB TYPE',      label: 'SUB TYPE',      w: 100 },
      { key: 'REMARK',        label: 'REMARK',        w: 120 },
    ],
  },
};

function VendorMaster({ activeSubTab, onSubTabChange, flyoutOpen = false }) {
  const [tab, setTab] = useState(activeSubTab || 'apcode');
  const { currentUser, userName } = useAuth();
  const { isAdmin } = useUserRole();
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;
  const isTablet = screenWidth >= 768 && screenWidth < 1200;
  const cfg = TAB_CONFIG[tab];

  const [dataMap, setDataMap]         = useState({ apcode: [], smcode: [], category: [] });
  const [searchMap, setSearchMap]     = useState({ apcode: '', smcode: '', category: '' });
  const [selectedMap, setSelectedMap] = useState({ apcode: [], smcode: [], category: [] });
  const [sortMap, setSortMap]         = useState({ apcode: { field: 'Supplier Code', dir: 'asc' }, smcode: { field: 'SM-Code', dir: 'asc' }, category: { field: 'Code', dir: 'asc' } });
  const [pageSize, setPageSize]       = useState(50);
  const [pageMap, setPageMap]         = useState({ apcode: 1, smcode: 1, category: 1 });
  const [showForm, setShowForm]       = useState(false);
  const [editId, setEditId]           = useState(null);
  const [form, setForm]               = useState({});
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailItem, setDetailItem]   = useState(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [detailForm, setDetailForm]   = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [importing, setImporting]     = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [recycleBinItems, setRecycleBinItems] = useState([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);

  const fileRef      = useRef(null);
  const theadRef     = useRef(null);
  const tbodyRef     = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const obs = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [flyoutOpen]);
  const syncScroll = () => { if (theadRef.current && tbodyRef.current) theadRef.current.scrollLeft = tbodyRef.current.scrollLeft; };

  const items    = dataMap[tab]     || [];
  const search   = searchMap[tab]   || '';
  const selected = selectedMap[tab] || [];
  const sort     = sortMap[tab]     || { field: cfg.key, dir: 'asc' };

  const getTimestamp = () => { const n = new Date(); return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`; };
  const getFileTimestamp = () => { const n = new Date(); return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`; };
  const formatLastUpdate = (val) => {
    if (!val || val === '-') return '-';
    if (!isNaN(val) && Number(val) > 40000) { const d = new Date(Math.round((Number(val)-25569)*86400*1000)); return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; }
    try { const d = new Date(val); if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch {}
    return val;
  };

  const fetchTab = useCallback(async (t) => {
    const { data, error } = await supabase
      .from(TAB_CONFIG[t].table)
      .select('*')
      .or('deleted.is.null,deleted.eq.false');
    if (!error) setDataMap(prev => ({ ...prev, [t]: data || [] }));
  }, []);

  useEffect(() => { fetchTab('apcode'); fetchTab('smcode'); fetchTab('category'); }, []);
  useEffect(() => { if (activeSubTab && activeSubTab !== tab) setTab(activeSubTab); }, [activeSubTab, tab]);
  useEffect(() => { setPageMap(prev => ({ ...prev, [tab]: 1 })); }, [tab, search]);

  const handleTabChange = (t) => { setTab(t); if (onSubTabChange) onSubTabChange(t); };
  const getOptions = (field) => [...new Set(items.map(i => i[field] || '').filter(v => v))];

  const buildPreviewRows = (rawRows, existingItems, keyField, allFields) => {
    const dataFields = allFields.filter(f => !['username', 'last_update'].includes(f));
    const existingMap = {};
    existingItems.forEach(item => { if (item[keyField]) existingMap[String(item[keyField]).trim()] = item; });
    const seenKeys = new Set();
    return rawRows.map(row => {
      const normalizedRow = { ...row };
      if (tab === 'category') { normalizedRow['TAX ID'] = normalizeTaxId(row['TAX ID']); normalizedRow['No.'] = normalizeNo(row['No.']); }
      const keyVal = String(normalizedRow[keyField] ?? '').trim();
      if (!keyVal) return { ...normalizedRow, _status: 'duplicate', _changes: [] };
      if (seenKeys.has(keyVal)) return { ...normalizedRow, _status: 'duplicate', _changes: [] };
      seenKeys.add(keyVal);
      const existing = existingMap[keyVal];
      if (!existing) return { ...normalizedRow, _status: 'new', _changes: [] };
      const changes = [];
      dataFields.forEach(f => { const nv = String(normalizedRow[f] ?? '').trim(); const ov = String(existing[f] ?? '').trim(); if (nv !== ov) changes.push({ field: f, old: ov, new: nv }); });
      return { ...normalizedRow, _status: changes.length > 0 ? 'update' : 'nochange', _changes: changes, _existingId: existing.id };
    });
  };

  const exportToExcel = (data, fields, sheetName, filePrefix) => {
    const rows = data.map(item => { const row = {}; fields.forEach(f => { row[f] = item[f] || ''; }); return row; });
    const ws = XLSX.utils.json_to_sheet(rows, { header: fields });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${filePrefix}_${getFileTimestamp()}.xlsx`);
  };
  const handleExportSelected = () => exportToExcel(items.filter(i => selected.includes(i.id)), cfg.fields.filter(f => !['username','last_update'].includes(f)), cfg.label, cfg.label.replace(/ /g,''));
  const handleExportAll      = () => exportToExcel(filtered, cfg.fields.filter(f => !['username','last_update'].includes(f)), cfg.label, cfg.label.replace(/ /g,''));
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([cfg.fields.filter(f => !['username','last_update'].includes(f))]);
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
      setPreviewRows(buildPreviewRows(rawRows, items, cfg.key, cfg.fields));
      setShowPreview(true);
    };
    reader.readAsBinaryString(file); e.target.value = '';
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      const toProcess = previewRows.filter(r => r._status === 'new' || r._status === 'update');
      const newRows = toProcess.filter(r => r._status === 'new');
      const updateRows = toProcess.filter(r => r._status === 'update');
      const ts = getTimestamp(); const cu = userName || currentUser?.email || '';
      if (newRows.length > 0) { for (let i = 0; i < newRows.length; i += 500) { const payload = newRows.slice(i,i+500).map(row => { const d = {}; cfg.fields.forEach(k => { if (k==='username') d[k]=cu; else if (k==='last_update') d[k]=ts; else d[k]=String(row[k]??''); }); return d; }); const { error } = await supabase.from(cfg.table).insert(payload); if (error) throw new Error(error.message); } }
      if (updateRows.length > 0) { for (let i = 0; i < updateRows.length; i += 500) { const payload = updateRows.slice(i,i+500).map(row => { const d = { id: row._existingId }; cfg.fields.forEach(k => { if (k==='username') d[k]=cu; else if (k==='last_update') d[k]=ts; else d[k]=String(row[k]??''); }); return d; }); const { error } = await supabase.from(cfg.table).upsert(payload, { onConflict: 'id' }); if (error) throw new Error(error.message); } }
      setShowPreview(false); setPreviewRows([]); await fetchTab(tab);
      alert(`✅ Import สำเร็จ — New: ${newRows.length} / Update: ${updateRows.length}`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setImporting(false);
  };

  const handleNewSave = async () => {
    const data = { ...form, username: userName || currentUser?.email || '', last_update: getTimestamp() };
    if (editId) { const { error } = await supabase.from(cfg.table).update(data).eq('id', editId); if (error) { alert('เกิดข้อผิดพลาด: ' + error.message); return; } }
    else { const { error } = await supabase.from(cfg.table).insert([data]); if (error) { alert('เกิดข้อผิดพลาด: ' + error.message); return; } }
    setShowForm(false); setEditId(null); setForm({}); await fetchTab(tab);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = items.find(i => i.id === id);
      await supabase.from('recycle_bin').insert([{ source_table: cfg.table, source_id: id, source_key: item?.[cfg.key]||id, data: item, deleted_by: userName||currentUser?.email||'', deleted_at: new Date().toISOString() }]);
      const { error } = await supabase.from(cfg.table).update({ deleted: true, deleted_by: userName||currentUser?.email||'', deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      setSelectedMap(prev => ({ ...prev, [tab]: prev[tab].filter(s => s !== id) })); await fetchTab(tab);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${selected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = items.filter(i => selected.includes(i.id)).map(item => ({ source_table: cfg.table, source_id: item.id, source_key: item[cfg.key]||item.id, data: item, deleted_by: userName||currentUser?.email||'', deleted_at: now }));
      if (bins.length) await supabase.from('recycle_bin').insert(bins);
      const { error } = await supabase.from(cfg.table).update({ deleted: true, deleted_by: userName||currentUser?.email||'', deleted_at: now }).in('id', selected);
      if (error) throw error;
      setSelectedMap(prev => ({ ...prev, [tab]: [] })); await fetchTab(tab);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleOpenDetail = (item) => {
    setDetailItem(item); setDetailForm(Object.fromEntries(cfg.edit.map(([k]) => [k, item[k] || '']))); setDetailEditMode(false); setShowDetailModal(true);
  };

  const handleDetailSave = async () => {
    const data = { ...detailForm, username: userName||currentUser?.email||'', last_update: getTimestamp() };
    const { error } = await supabase.from(cfg.table).update(data).eq('id', detailItem.id);
    if (error) { alert('เกิดข้อผิดพลาด: ' + error.message); return; }
    setShowDetailModal(false); await fetchTab(tab);
  };

  const handleOpenRecycleBin = async () => {
    setShowRecycleBin(true);
    setRecycleBinLoading(true);
    try {
      const tables = Object.values(TAB_CONFIG).map(c => c.table);
      const { data, error } = await supabase
        .from('recycle_bin')
        .select('*')
        .in('source_table', tables)
        .order('deleted_at', { ascending: false });
      if (error) throw error;
      setRecycleBinItems(data || []);
    } catch (err) { alert('โหลด Recycle Bin ไม่สำเร็จ: ' + err.message); }
    setRecycleBinLoading(false);
  };

  const handleRestore = async (binItem) => {
    try {
      const { error } = await supabase
        .from(binItem.source_table)
        .update({ deleted: false, deleted_by: null, deleted_at: null })
        .eq('id', binItem.source_id);
      if (error) throw error;
      await supabase.from('recycle_bin').delete().eq('id', binItem.id);
      setRecycleBinItems(prev => prev.filter(i => i.id !== binItem.id));
      const tabKey = Object.entries(TAB_CONFIG).find(([, c]) => c.table === binItem.source_table)?.[0];
      if (tabKey) { await fetchTab(tabKey); }
      alert(`✅ Restore สำเร็จ — ${binItem.source_key}`);
    } catch (err) { alert('Restore ไม่สำเร็จ: ' + err.message); }
  };

  const handlePermanentDelete = async (binItem) => {
    if (!window.confirm(`ลบถาวร "${binItem.source_key}" ออกจากระบบ? ไม่สามารถกู้คืนได้`)) return;
    try {
      await supabase.from(binItem.source_table).delete().eq('id', binItem.source_id);
      await supabase.from('recycle_bin').delete().eq('id', binItem.id);
      setRecycleBinItems(prev => prev.filter(i => i.id !== binItem.id));
    } catch (err) { alert('ลบถาวรไม่สำเร็จ: ' + err.message); }
  };

  const filtered = useMemo(() => items
    .filter(i => cfg.fields.some(f => String(i[f] || '').toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => { const ca = a[sort.field]||'', cb = b[sort.field]||''; return sort.dir==='asc' ? ca.localeCompare(cb) : cb.localeCompare(ca); }),
    [items, search, sort, cfg.fields]
  );
  const page = pageMap[tab] || 1;
  const effectivePageSize = pageSize === 'ทั้งหมด' || pageSize >= filtered.length ? filtered.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const paginated  = filtered.slice((page - 1) * effectivePageSize, page * effectivePageSize);

  const statusBadge = (val) => { const map = { Active: ['#EAF3DE','#27500A'], Inactive: ['#FCEBEB','#791F1F'] }; const [bg, color] = map[val]||['#e8e8e8','#555']; return <span style={{ background: bg, color, padding:'2px 8px', borderRadius:'20px', fontSize:'10px' }}>{val||'-'}</span>; };
  const noticeBadge = (val) => { const map = { ITC: ['#e8f0fb','#1a3a5c'], 'LUK-APN|ITC': ['#EAF3DE','#27500A'], EFT: ['#f0f7ff','#0F6E56'], CPN: ['#f5f5f5','#555'], MER: ['#FFF3CD','#856404'] }; const [bg, color] = map[val]||['#f5f5f5','#555']; return val ? <span style={{ background: bg, color, padding:'2px 7px', borderRadius:'20px', fontSize:'10px' }}>{val}</span> : '-'; };
  const ruleBadge = (val) => { if (!val || val === '-' || val === '') return <span style={{ color: '#ccc' }}>-</span>; const colors = ['#e8f0fb','#1a3a5c']; return <span style={{ background: colors[0], color: colors[1], padding:'2px 6px', borderRadius:'20px', fontSize:'10px' }}>{val}</span>; };

  const renderCell = (c, item) => {
    if (c.key === 'last_update')     return formatLastUpdate(item[c.key]);
    if (c.key === 'Status')          return statusBadge(item[c.key]);
    if (c.key === 'Notice')          return noticeBadge(item[c.key]);
    if (c.key === 'TYPE' || c.key === 'SUB TYPE') return noticeBadge(item[c.key]);
    if (c.key === '_entityType')     return entityBadge(item['TAX ID']);
    if (c.key === '_debitAccount')   return <span style={{ fontSize:'10px', color:'#555' }}>{[item['CPC_Dr'], item['Account_Dr'], item['Sub Acc_Dr']].filter(Boolean).join(' · ') || '-'}</span>;
    if (c.key === '_creditAccount')  return <span style={{ fontSize:'10px', color:'#555' }}>{[item['CPC_Cr'], item['Account_Dr2'], item['Sub Acc_Cr']].filter(Boolean).join(' · ') || '-'}</span>;
    if (['Special Rule1','Special Rule2','Simple Rule3','Special Rule4','Special Rule5'].includes(c.key)) return ruleBadge(item[c.key]);
    if (c.key === 'Short Name')      return item[c.key] ? <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 7px', borderRadius:'20px', fontSize:'10px' }}>{item[c.key]}</span> : '-';
    return item[c.key] || '-';
  };

  const actionW = isAdmin ? (56 * 2) + 20 : 56 + 20;
  const minW    = 36 + cfg.columns.reduce((s, c) => s + c.w, 0) + actionW;
  const totalW  = containerW > 0 ? Math.max(minW, containerW) : minW + 200;
  const extraW  = Math.max(0, totalW - minW);
  const stretchMap = { apcode: 'Name', smcode: 'Company Name', category: 'REMARK' };
  const stretchKey = stretchMap[tab] || 'Name';
  const COLUMNS_SCALED = cfg.columns.map(c => c.key === stretchKey ? { ...c, w: c.w + Math.min(extraW, 300) } : c);

  const S = {
    container: { padding: isMobile?'12px':'20px', display:'flex', flexDirection:'column', height:'100vh', boxSizing:'border-box', minWidth:0, overflow:'hidden' },
    topbar: { display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0, flexWrap: isMobile?'wrap':'nowrap', gap:'8px' },
    btn: { padding: isMobile?'6px 10px':'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize: isMobile?'12px':'13px', marginLeft: isMobile?'4px':'8px' },
    tabBar: { display:'flex', alignItems:'flex-end', padding:'10px 0 0', flexShrink:0, borderBottom:'2px solid #e8e8e8' },
    tab: (active) => ({ padding: isMobile?'6px 12px':'8px 18px', fontSize: isMobile?'12px':'13px', cursor:'pointer', color: active?'#1a3a5c':'#888', borderBottom: active?'2px solid #1a3a5c':'2px solid transparent', marginBottom:'-2px', borderRadius:'6px 6px 0 0', background: active?'white':'transparent', fontWeight: active?'500':'400', display:'flex', alignItems:'center', gap:'4px' }),
    tabBadge: (active) => ({ background: active?'#1a3a5c':'#e8e8e8', color: active?'white':'#888', fontSize:'10px', padding:'1px 5px', borderRadius:'20px' }),
    outer: { background:'white', borderRadius:'8px', border:'0.5px solid #e8e8e8', display:'flex', flexDirection:'column', flex:1, minWidth:0, overflow:'hidden' },
    theadWrap: { overflowX:'hidden', flexShrink:0 },
    tbodyWrap: { overflowY:'auto', overflowX:'auto', flex:1, minWidth:0 },
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
    modal: { background:'white', borderRadius:'10px', width: isMobile?'95vw': tab==='smcode'?'700px':'500px', maxHeight:'85vh', display:'flex', flexDirection:'column' },
    iconBtn: (color, bg, border) => ({ background: bg||'none', border:`0.5px solid ${border||color}`, borderRadius:'4px', cursor:'pointer', padding:'3px 6px', color, fontSize:'12px', lineHeight:1 }),
  };

  const renderColGroup = (columns) => (
    <colgroup>
      <col style={{ width:'36px', minWidth:'36px' }} />
      {columns.map((c, i) => <col key={i} style={{ width:`${c.w}px`, minWidth:`${c.w}px` }} />)}
      <col style={{ width:`${actionW}px`, minWidth:`${actionW}px` }} />
    </colgroup>
  );

  const renderFormFields = (formData, setFormData, editMode = true) => {
    if (tab === 'smcode') {
      const sections = [
        { label: 'ข้อมูลทั่วไป', keys: ['SM-Code','Company Name','Tax ID','Branch','Short Name','BU','Supplier Code','Remark'] },
        { label: 'Debit', keys: ['CPC_Dr','Account_Dr','Sub Acc_Dr'] },
        { label: 'Credit', keys: ['CPC_Cr','Account_Dr2','Sub Acc_Cr'] },
        { label: 'Rules & Config', keys: ['Expense Type','First Part','Mid Part','Last Part','Special Rule1','Special Rule2','Simple Rule3','Special Rule4','Special Rule5','Digit','Ofin Code','Simple Brand Code','Short Branch'] },
      ];
      return (
        <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
          {sections.map(sec => (
            <div key={sec.label} style={{ marginBottom:'16px' }}>
              <div style={{ fontSize:'10px', fontWeight:'600', color:'#888', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'8px', borderBottom:'0.5px solid #f0f0f0', paddingBottom:'4px' }}>{sec.label}</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
                {sec.keys.map(key => {
                  const label = cfg.edit.find(([k]) => k === key)?.[1] || key;
                  return (
                    <div key={key} style={{ marginBottom:'4px' }}>
                      <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'2px' }}>{label}</label>
                      {editMode
                        ? cfg.combo.includes(key)
                          ? <ComboBox value={formData[key]||''} onChange={val=>setFormData({...formData,[key]:val})} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
                          : <input style={S.input} value={formData[key]||''} onChange={e=>setFormData({...formData,[key]:e.target.value})} />
                        : <div style={S.inputReadonly}>{formData[key]||'-'}</div>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
        {cfg.edit.map(([key, label]) => (
          <div key={key} style={{ marginBottom:'4px' }}>
            <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'2px' }}>{label}</label>
            {editMode ? (
              cfg.combo.includes(key)
                ? <ComboBox value={formData[key]||''} onChange={val=>setFormData({...formData,[key]:val})} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
                : <input style={S.input} value={formData[key]||''} onChange={e=>setFormData({...formData,[key]:e.target.value})} />
            ) : (
              <div style={S.inputReadonly}>
                {key==='Status' ? statusBadge(formData[key]) : key==='TYPE'||key==='SUB TYPE' ? noticeBadge(formData[key]) : (formData[key]||'-')}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <h2 style={{ fontSize: isMobile?'14px':'16px', fontWeight:'600', margin:0 }}>👥 Vendor Master</h2>
          {isAdmin && selected.length > 0 && <button style={{...S.btn, background:'#c0392b', color:'white', marginLeft:0}} onClick={handleBulkDelete}>🗑️{!isMobile&&` ลบ ${selected.length}`}</button>}
          {selected.length > 0 && <ExportDropdown onExportSelected={handleExportSelected} onExportAll={handleExportAll} selectedCount={selected.length} isMobile={isMobile} />}
        </div>
        {isAdmin && (
          <div style={{ display:'flex', alignItems:'center', gap: isMobile?'4px':'0' }}>
            <button style={{...S.btn, background:'#f5f5f5', color:'#555', border:'0.5px solid #ddd'}} onClick={handleOpenRecycleBin}>🗑️{!isMobile&&' Recycle Bin'}</button>
            <button style={{...S.btn, background:'#0F6E56', color:'white'}} onClick={handleDownloadTemplate}>⬇{!isMobile&&' Template'}</button>
            <button style={{...S.btn, background:'#5DCAA5', color:'#1a3a5c'}} onClick={()=>fileRef.current.click()}>📂{!isMobile&&' Import'}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleFileChange} />
            <button style={{...S.btn, background:'#1a3a5c', color:'white'}} onClick={()=>{setForm(Object.fromEntries(cfg.edit.map(([k])=>[k,'']))); setEditId(null); setShowForm(true);}}>+ New</button>
          </div>
        )}
      </div>

      <div style={S.tabBar}>
        {Object.entries(TAB_CONFIG).map(([key, c]) => (
          <div key={key} style={S.tab(tab===key)} onClick={()=>handleTabChange(key)}>
            {c.icon} {!isMobile && c.label}
            <span style={S.tabBadge(tab===key)}>{(dataMap[key]||[]).length}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', alignItems:'center', padding:'6px 0', margin:'4px 0', flexShrink:0, gap:'8px', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <input placeholder={isMobile?'Search...':`Search ${cfg.label}...`} value={search}
            onChange={e=>setSearchMap(prev=>({...prev,[tab]:e.target.value}))}
            style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width: isMobile?'120px':isTablet?'160px':'220px' }} />
          {!isMobile && <span style={{ fontSize:'12px', color:'#888', whiteSpace:'nowrap' }}>
            {filtered.length > 0 ? `แสดง ${(page-1)*effectivePageSize+1}-${Math.min(page*effectivePageSize, filtered.length)} จาก ${filtered.length} รายการ` : '0 รายการ'}
            {selected.length>0?` | เลือกอยู่ ${selected.length} รายการ`:''}
          </span>}
        </div>
        {filtered.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'12px', color:'#888', marginRight:'4px' }}>
              <select value={pageSize} onChange={e => { setPageSize(e.target.value === 'ทั้งหมด' ? 'ทั้งหมด' : Number(e.target.value)); setPageMap(prev=>({...prev,[tab]:1})); }}
                style={{ padding:'3px 6px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', background:'white', cursor:'pointer' }}>
                {[25,50,100,'ทั้งหมด'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {!isMobile && <span>รายการ/หน้า</span>}
            </div>
            <button onClick={()=>setPageMap(prev=>({...prev,[tab]:1}))} disabled={page===1} style={{ padding:'3px 8px', borderRadius:'6px', border:'0.5px solid #ddd', background:page===1?'#f5f5f5':'white', cursor:page===1?'default':'pointer', fontSize:'12px', color:page===1?'#ccc':'#555' }}>«</button>
            <button onClick={()=>setPageMap(prev=>({...prev,[tab]:prev[tab]-1}))} disabled={page===1} style={{ padding:'3px 8px', borderRadius:'6px', border:'0.5px solid #ddd', background:page===1?'#f5f5f5':'white', cursor:page===1?'default':'pointer', fontSize:'12px', color:page===1?'#ccc':'#555' }}>‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => { let p; if (totalPages<=5) p=i+1; else if (page<=3) p=i+1; else if (page>=totalPages-2) p=totalPages-4+i; else p=page-2+i; return <button key={p} onClick={()=>setPageMap(prev=>({...prev,[tab]:p}))} style={{ padding:'3px 9px', borderRadius:'6px', border:'0.5px solid #ddd', background:page===p?'#1a3a5c':'white', color:page===p?'white':'#555', cursor:'pointer', fontSize:'12px', fontWeight:page===p?'500':'400' }}>{p}</button>; })}
            <button onClick={()=>setPageMap(prev=>({...prev,[tab]:prev[tab]+1}))} disabled={page===totalPages} style={{ padding:'3px 8px', borderRadius:'6px', border:'0.5px solid #ddd', background:page===totalPages?'#f5f5f5':'white', cursor:page===totalPages?'default':'pointer', fontSize:'12px', color:page===totalPages?'#ccc':'#555' }}>›</button>
            <button onClick={()=>setPageMap(prev=>({...prev,[tab]:totalPages}))} disabled={page===totalPages} style={{ padding:'3px 8px', borderRadius:'6px', border:'0.5px solid #ddd', background:page===totalPages?'#f5f5f5':'white', cursor:page===totalPages?'default':'pointer', fontSize:'12px', color:page===totalPages?'#ccc':'#555' }}>»</button>
            <span style={{ fontSize:'12px', color:'#888', marginLeft:'2px', whiteSpace:'nowrap' }}>{page} / {totalPages}</span>
          </div>
        )}
      </div>

      <div ref={containerRef} style={S.outer}>
        <div ref={theadRef} style={{...S.theadWrap, msOverflowStyle:'none'}}>
          <table style={{...S.table, width:`${totalW}px`}}>
            {renderColGroup(COLUMNS_SCALED)}
            <thead>
              <tr>
                <th style={S.thCheck}><input type="checkbox" checked={filtered.length>0 && selected.length===filtered.length} onChange={()=>setSelectedMap(prev=>({...prev,[tab]: prev[tab].length===filtered.length?[]:filtered.map(i=>i.id)}))} /></th>
                {COLUMNS_SCALED.map(c => (
                  <th key={c.key} style={c.sortable?S.thSort:S.th} onClick={c.sortable?()=>setSortMap(prev=>({...prev,[tab]:{field:c.key,dir:prev[tab].field===c.key&&prev[tab].dir==='asc'?'desc':'asc'}})):undefined}>
                    {c.label}{c.sortable?(sort.field===c.key?(sort.dir==='asc'?' ▲':' ▼'):' ↕'):''}
                  </th>
                ))}
                <th style={S.thAction}>Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div ref={tbodyRef} style={S.tbodyWrap} onScroll={syncScroll}>
          <table style={{...S.table, width:`${totalW}px`}}>
            {renderColGroup(COLUMNS_SCALED)}
            <tbody>
              {paginated.map(item => (
                <tr key={item.id} style={{ background: selected.includes(item.id)?'#f0f7ff':'white' }}>
                  <td style={S.tdCenter}><input type="checkbox" checked={selected.includes(item.id)} onChange={()=>setSelectedMap(prev=>({...prev,[tab]:prev[tab].includes(item.id)?prev[tab].filter(s=>s!==item.id):[...prev[tab],item.id]}))} /></td>
                  {COLUMNS_SCALED.map(c => (<td key={c.key} style={S.td} title={String(item[c.key]||'')}>{renderCell(c, item)}</td>))}
                  <td style={S.tdCenter}>
                    <div style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                      <button onClick={()=>handleOpenDetail(item)} style={S.iconBtn('#1a3a5c')}>🔍</button>
                      {isAdmin && <button onClick={()=>handleDelete(item.id)} style={S.iconBtn('#791F1F','#FCEBEB','#f7c1c1')}>🗑️</button>}
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
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <h3 style={{ fontSize:'15px', margin:0 }}>{editId?`✏️ Edit ${cfg.label}`:`+ New ${cfg.label}`}</h3>
              <div style={{ display:'flex', gap:'8px' }}>
                <button style={{...S.btn, background:'#f0f0f0', marginLeft:0}} onClick={()=>setShowForm(false)}>Cancel</button>
                <button style={{...S.btn, background:'#1a3a5c', color:'white', marginLeft:0}} onClick={handleNewSave}>Save</button>
              </div>
            </div>
            {renderFormFields(form, setForm, true)}
            <div style={{ padding:'0 20px 16px' }}>
              <label style={{ fontSize:'11px', color:'#888' }}>Username</label>
              <input style={S.inputDisabled} value={userName||currentUser?.email||''} disabled />
              <label style={{ fontSize:'11px', color:'#888' }}>Last Update</label>
              <input style={S.inputDisabled} value={getTimestamp()} disabled />
            </div>
          </div>
        </div>
      )}

      {showDetailModal && detailItem && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={{ fontSize:'14px', fontWeight:'500' }}>{detailEditMode?`✏️ Edit ${cfg.label}`:`🔍 ${detailItem[cfg.key]||'Detail'}`}</span>
                {!detailEditMode && <button onClick={()=>setDetailEditMode(true)} style={{ padding:'3px 10px', borderRadius:'5px', border:'1px solid #1a3a5c', background:'white', color:'#1a3a5c', fontSize:'12px', cursor:'pointer' }}>✏️ Edit</button>}
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                {detailEditMode ? (
                  <>
                    <button style={{...S.btn, background:'#f0f0f0', marginLeft:0}} onClick={()=>{setDetailEditMode(false); setDetailForm(Object.fromEntries(cfg.edit.map(([k])=>[k,detailItem[k]||''])));}}>Cancel</button>
                    <button style={{...S.btn, background:'#1a3a5c', color:'white', marginLeft:0}} onClick={handleDetailSave}>Save</button>
                  </>
                ) : <button style={{...S.btn, background:'#f0f0f0', marginLeft:0}} onClick={()=>setShowDetailModal(false)}>Close</button>}
              </div>
            </div>
            {renderFormFields(detailEditMode ? detailForm : Object.fromEntries(cfg.edit.map(([k])=>[k,detailItem[k]||''])), setDetailForm, detailEditMode)}
            {!detailEditMode && (
              <div style={{ padding:'0 20px 16px', borderTop:'0.5px solid #f0f0f0' }}>
                <div style={{ display:'flex', gap:'16px', paddingTop:'12px' }}>
                  <div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Username</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{detailItem['username']||'-'}</div></div>
                  <div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Last Update</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{formatLastUpdate(detailItem['last_update'])}</div></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ImportPreviewModal show={showPreview} onClose={()=>{setShowPreview(false); setPreviewRows([]);}} onConfirm={handleConfirmImport} importing={importing} previewRows={previewRows} keyField={cfg.key} allFields={cfg.fields} isMobile={isMobile} isCategory={tab === 'category'} />

      {/* ─── Recycle Bin Modal ─── */}
      {showRecycleBin && (
        <div style={S.overlay}>
          <div style={{ background:'white', borderRadius:'10px', width: isMobile?'95vw':'860px', maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
            {/* Header */}
            <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={{ fontSize:'15px', fontWeight:'500' }}>🗑️ Recycle Bin</span>
                <span style={{ fontSize:'11px', background:'#f5f5f5', color:'#888', padding:'2px 8px', borderRadius:'20px' }}>{recycleBinItems.length} รายการ</span>
              </div>
              <button onClick={()=>setShowRecycleBin(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:'20px', lineHeight:1 }}>×</button>
            </div>
            {/* Body */}
            <div style={{ overflowY:'auto', flex:1 }}>
              {recycleBinLoading ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#aaa', fontSize:'13px' }}>กำลังโหลด...</div>
              ) : recycleBinItems.length === 0 ? (
                <div style={{ padding:'48px', textAlign:'center', color:'#aaa', fontSize:'13px' }}>
                  <div style={{ fontSize:'32px', marginBottom:'8px' }}>🗑️</div>
                  Recycle Bin ว่างเปล่า
                </div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px' }}>
                  <thead>
                    <tr>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px', whiteSpace:'nowrap' }}>Source</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px', whiteSpace:'nowrap' }}>Key</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px', whiteSpace:'nowrap' }}>ลบโดย</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px', whiteSpace:'nowrap' }}>วันที่ลบ</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'center', fontWeight:'500', fontSize:'11px', width:'140px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recycleBinItems.map(item => {
                      const tabLabel = Object.values(TAB_CONFIG).find(c => c.table === item.source_table)?.label || item.source_table;
                      const deletedAt = item.deleted_at ? new Date(item.deleted_at) : null;
                      const deletedAtStr = deletedAt ? `${String(deletedAt.getDate()).padStart(2,'0')}/${String(deletedAt.getMonth()+1).padStart(2,'0')}/${deletedAt.getFullYear()} ${String(deletedAt.getHours()).padStart(2,'0')}:${String(deletedAt.getMinutes()).padStart(2,'0')}` : '-';
                      return (
                        <tr key={item.id} style={{ borderBottom:'0.5px solid #f0f0f0' }}>
                          <td style={{ padding:'9px 12px' }}>
                            <span style={{ background:'#e8f0fb', color:'#1a3a5c', padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:'500' }}>{tabLabel}</span>
                          </td>
                          <td style={{ padding:'9px 12px', fontWeight:'500', color:'#1a3a5c', fontSize:'12px' }}>{item.source_key}</td>
                          <td style={{ padding:'9px 12px', color:'#555', fontSize:'11px' }}>{item.deleted_by || '-'}</td>
                          <td style={{ padding:'9px 12px', color:'#888', fontSize:'11px', whiteSpace:'nowrap' }}>{deletedAtStr}</td>
                          <td style={{ padding:'9px 12px', textAlign:'center' }}>
                            <div style={{ display:'inline-flex', gap:'6px' }}>
                              <button onClick={()=>handleRestore(item)}
                                style={{ padding:'4px 12px', borderRadius:'5px', border:'none', background:'#EAF3DE', color:'#27500A', fontSize:'11px', cursor:'pointer', fontWeight:'500' }}>
                                ♻️ Restore
                              </button>
                              <button onClick={()=>handlePermanentDelete(item)}
                                style={{ padding:'4px 10px', borderRadius:'5px', border:'0.5px solid #f7c1c1', background:'#FCEBEB', color:'#791F1F', fontSize:'11px', cursor:'pointer' }}>
                                🗑️ ลบถาวร
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding:'10px 20px', borderTop:'0.5px solid #f0f0f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
              <button onClick={()=>setShowRecycleBin(false)} style={{ padding:'6px 16px', borderRadius:'6px', border:'0.5px solid #ddd', background:'white', color:'#555', fontSize:'12px', cursor:'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VendorMaster;