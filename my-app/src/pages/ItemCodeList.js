import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';

function ComboBox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => { setInput(value || ''); }, [value]);
  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = [...new Set(options.filter(o => o && o !== '-' && o.toLowerCase().includes(input.toLowerCase())))].slice(0, 20);

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: '8px' }}>
      <input
        value={input}
        onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || ''}
        style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000, maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((opt, i) => (
            <div key={i}
              onMouseDown={() => { setInput(opt); onChange(opt); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' }}
              onMouseEnter={e => e.target.style.background = '#f0f7ff'}
              onMouseLeave={e => e.target.style.background = 'white'}>
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCodeList() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [importing, setImporting] = useState(false);
  const [editId, setEditId] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [nextCode, setNextCode] = useState('');
  const [selected, setSelected] = useState([]);
  const fileInputRef = useRef(null);
  const { currentUser, userName } = useAuth();

  const [form, setForm] = useState({
    '2Itemcode': '', 'bu': '', 'description': '',
    'cpc': '', 'account': '', 'sub': '', 'dis_g': '', 'I & G': '',
    'value': '', 'oth': '', 'SPI-1': '', 'spec_tx': '', 'keyword': ''
  });

  const FIELDS = [
    'Code', '2Itemcode', 'bu', 'description', 'cpc', 'account',
    'sub', 'dis_g', 'I & G', 'value', 'oth', 'SPI-1',
    'spec_tx', 'keyword', 'username', 'last_update'
  ];

  const COMBO_FIELDS = ['bu', 'sub', 'dis_g', 'I & G', 'value', 'oth', 'SPI-1', 'spec_tx'];
  const DASH_FIELDS = ['dis_g', 'I & G', 'value', 'oth', 'SPI-1', 'spec_tx'];

  const EDIT_FIELDS = [
    ['2Itemcode', '2Itemcode'], ['bu', 'BU'], ['description', 'Description'],
    ['cpc', 'CPC'], ['account', 'Account'], ['sub', 'SUB'], ['dis_g', 'Dis-G'],
    ['I & G', 'I&G'], ['value', 'VALUE'], ['oth', 'OTH'], ['SPI-1', 'SPI-1'],
    ['spec_tx', 'SPEC-TX'], ['keyword', 'Keyword'],
  ];

  const COLUMNS = [
    { key: 'Code', label: 'Code', sortable: true },
    { key: '2Itemcode', label: '2Itemcode' },
    { key: 'bu', label: 'BU' },
    { key: 'description', label: 'Description' },
    { key: 'cpc', label: 'CPC' },
    { key: 'account', label: 'Account' },
    { key: 'sub', label: 'SUB' },
    { key: 'dis_g', label: 'Dis-G' },
    { key: 'I & G', label: 'I&G' },
    { key: 'value', label: 'VALUE' },
    { key: 'oth', label: 'OTH' },
    { key: 'SPI-1', label: 'SPI-1' },
    { key: 'spec_tx', label: 'SPEC-TX' },
    { key: 'keyword', label: 'Keyword' },
    { key: 'username', label: 'Username' },
    { key: 'last_update', label: 'Last Update' },
  ];

  const fetchData = async () => {
    const snap = await getDocs(collection(db, 'ItemcodeList'));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setItems(data);
    computeNextCode(data);
  };

  const computeNextCode = (data) => {
    const nums = data
      .map(d => d['Code'] || '')
      .filter(c => /^C\d{7}$/.test(c))
      .map(c => parseInt(c.replace('C', ''), 10))
      .sort((a, b) => a - b);
    if (nums.length === 0) { setNextCode('C0000001'); return; }
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i + 1] - nums[i] > 1) { setNextCode(`C${String(nums[i] + 1).padStart(7, '0')}`); return; }
    }
    setNextCode(`C${String(nums[nums.length - 1] + 1).padStart(7, '0')}`);
  };

  const getCodePool = (data) => {
    const nums = data
      .map(d => d['Code'] || '')
      .filter(c => /^C\d{7}$/.test(c))
      .map(c => parseInt(c.replace('C', ''), 10))
      .sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < nums.length - 1; i++) {
      for (let g = nums[i] + 1; g < nums[i + 1]; g++) gaps.push(g);
    }
    const max = nums.length > 0 ? nums[nums.length - 1] : 0;
    let idx = 0;
    return () => {
      if (idx < gaps.length) return `C${String(gaps[idx++]).padStart(7, '0')}`;
      return `C${String(max + (idx++ - gaps.length + 1)).padStart(7, '0')}`;
    };
  };

  useEffect(() => { fetchData(); }, []);

  const getOptions = (field) => [...new Set(items.map(i => i[field] || '').filter(v => v && v !== '-'))];

  const resetForm = () => setForm({
    '2Itemcode': '', 'bu': '', 'description': '',
    'cpc': '', 'account': '', 'sub': '', 'dis_g': '', 'I & G': '',
    'value': '', 'oth': '', 'SPI-1': '', 'spec_tx': '', 'keyword': ''
  });

  const getTimestamp = () => {
    const now = new Date();
    return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  };

  const handleSave = async () => {
    const updatedForm = { ...form, username: userName || currentUser?.email || '', last_update: getTimestamp() };
    if (editId) {
      await updateDoc(doc(db, 'ItemcodeList', editId), updatedForm);
    } else {
      await addDoc(collection(db, 'ItemcodeList'), { ...updatedForm, 'Code': nextCode });
    }
    setShowForm(false);
    setEditId(null);
    resetForm();
    fetchData();
  };

  const handleEdit = (item) => {
    setForm({
      '2Itemcode': item['2Itemcode'] || '', 'bu': item['bu'] || '',
      'description': item['description'] || '', 'cpc': item['cpc'] || '',
      'account': item['account'] || '', 'sub': item['sub'] || '',
      'dis_g': item['dis_g'] || '', 'I & G': item['I & G'] || '',
      'value': item['value'] || '', 'oth': item['oth'] || '',
      'SPI-1': item['SPI-1'] || '', 'spec_tx': item['spec_tx'] || '',
      'keyword': item['keyword'] || ''
    });
    setEditId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('ต้องการลบรายการนี้?')) {
      await deleteDoc(doc(db, 'ItemcodeList', id));
      setSelected(prev => prev.filter(s => s !== id));
      fetchData();
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${selected.length} รายการที่เลือก?`)) return;
    const batch = writeBatch(db);
    selected.forEach(id => batch.delete(doc(db, 'ItemcodeList', id)));
    await batch.commit();
    setSelected([]);
    fetchData();
  };

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map(i => i.id));

  const formatLastUpdate = (val) => {
    if (!val || val === '-') return '-';
    if (!isNaN(val) && Number(val) > 40000) {
      const d = new Date(Math.round((Number(val) - 25569) * 86400 * 1000));
      return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}`;
    }
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    } catch { }
    return val;
  };

  const handleDownloadTemplate = () => {
    const templateFields = FIELDS.filter(f => !['Code', 'username', 'last_update'].includes(f));
    const ws = XLSX.utils.aoa_to_sheet([templateFields]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ItemcodeList');
    XLSX.writeFile(wb, 'ItemcodeList_Template.xlsx');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      setPreviewData(XLSX.utils.sheet_to_json(ws, { defval: '' }));
      setShowPreview(true);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      const getNextCode = getCodePool(items);
      const BATCH_SIZE = 500;
      for (let i = 0; i < previewData.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        previewData.slice(i, i + BATCH_SIZE).forEach(row => {
          const newDoc = doc(collection(db, 'ItemcodeList'));
          const data = {};
          FIELDS.forEach(k => {
            if (k === 'Code') {
              data[k] = getNextCode();
            } else if (k === 'username') {
              data[k] = userName || currentUser?.email || '';
            } else if (k === 'last_update') {
              data[k] = getTimestamp();
            } else if (DASH_FIELDS.includes(k)) {
              const val = String(row[k] ?? '').trim();
              data[k] = val === '' ? '-' : val;
            } else {
              data[k] = String(row[k] ?? '');
            }
          });
          batch.set(newDoc, data);
        });
        await batch.commit();
      }
      setShowPreview(false);
      setPreviewData([]);
      fetchData();
      alert(`✅ Import สำเร็จ ${previewData.length} รายการ`);
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    }
    setImporting(false);
  };

  const filtered = items
    .filter(i =>
      i['Code']?.toLowerCase().includes(search.toLowerCase()) ||
      i['description']?.toLowerCase().includes(search.toLowerCase()) ||
      i['bu']?.toLowerCase().includes(search.toLowerCase()) ||
      i['account']?.includes(search) ||
      i['cpc']?.includes(search) ||
      i['keyword']?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const ca = a['Code'] || '', cb = b['Code'] || '';
      return sortDir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca);
    });

  const S = {
    container: { padding: '20px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' },
    topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 },
    btn: { padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' },
    wrap: { background: 'white', borderRadius: '8px', overflow: 'auto', flex: 1 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1500px' },
    th: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 },
    thSort: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 2 },
    thCheck: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2, width: '40px' },
    thAction: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 },
    td: { padding: '7px 10px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' },
    tdCenter: { padding: '7px 10px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center', whiteSpace: 'nowrap' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box' },
    inputDisabled: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #eee', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box', background: '#f5f5f5', color: '#999' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '10px', width: '500px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    previewModal: { background: 'white', borderRadius: '10px', padding: '24px', width: '90vw', maxWidth: '1200px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
  };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>🔖 Item Code List</h2>
          {selected.length > 0 && (
            <button style={{ ...S.btn, background: '#c0392b', color: 'white', marginLeft: 0 }} onClick={handleBulkDelete}>
              🗑️ ลบ {selected.length} รายการ
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <input placeholder="Search Code, Description, BU, Account..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, width: '260px', marginBottom: 0 }} />
          <button style={{ ...S.btn, background: '#0F6E56', color: 'white' }} onClick={handleDownloadTemplate}>⬇ Template</button>
          <button style={{ ...S.btn, background: '#5DCAA5', color: 'white' }} onClick={() => fileInputRef.current.click()}>📂 Import</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
          <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setEditId(null); resetForm(); }}>+ New</button>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', flexShrink: 0 }}>
        ทั้งหมด {items.length} รายการ
        {search && ` | ผลการค้นหา ${filtered.length} รายการ`}
        {selected.length > 0 && ` | เลือกอยู่ ${selected.length} รายการ`}
        {nextCode && <span style={{ marginLeft: '12px', color: '#1a3a5c', fontWeight: '500' }}>Next Code: {nextCode}</span>}
      </div>

      <div style={S.wrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thCheck}>
                <input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={toggleSelectAll} />
              </th>
              {COLUMNS.map(c => (
                <th key={c.key} style={c.sortable ? S.thSort : S.th} onClick={c.sortable ? () => setSortDir(d => d === 'asc' ? 'desc' : 'asc') : undefined}>
                  {c.label}{c.sortable ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={S.thAction}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} style={{ background: selected.includes(item.id) ? '#f0f7ff' : 'white' }}>
                <td style={S.tdCenter}>
                  <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelect(item.id)} />
                </td>
                {COLUMNS.map(c => (
                  <td key={c.key} style={S.td} title={item[c.key] || ''}>
                    {c.key === 'last_update' ? formatLastUpdate(item[c.key]) : (item[c.key] || '-')}
                  </td>
                ))}
                <td style={S.tdCenter}>
                  <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0, padding: '4px 8px' }} onClick={() => handleEdit(item)}>✏️</button>
                  <button style={{ ...S.btn, background: '#FCEBEB', color: '#791F1F', padding: '4px 8px' }} onClick={() => handleDelete(item.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New / Edit Modal */}
      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ fontSize: '15px', margin: 0 }}>{editId ? '✏️ Edit Item Code' : '+ New Item Code'}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => setShowForm(false)}>Cancel</button>
                <button style={{ ...S.btn, background: '#1a3a5c', color: 'white', marginLeft: 0 }} onClick={handleSave}>Save</button>
              </div>
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#666' }}>Code</label>
              <input style={S.inputDisabled} value={editId ? (items.find(i => i.id === editId)?.['Code'] || '') : nextCode} disabled />
              {EDIT_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label style={{ fontSize: '12px', color: '#666' }}>{label}</label>
                  {COMBO_FIELDS.includes(key) ? (
                    <ComboBox value={form[key]} onChange={val => setForm({ ...form, [key]: val })} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
                  ) : (
                    <input style={S.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
                  )}
                </div>
              ))}
              <label style={{ fontSize: '12px', color: '#666' }}>Username</label>
              <input style={S.inputDisabled} value={userName || currentUser?.email || ''} disabled />
              <label style={{ fontSize: '12px', color: '#666' }}>Last Update</label>
              <input style={S.inputDisabled} value={getTimestamp()} disabled />
            </div>
          </div>
        </div>
      )}

      {/* Preview Import Modal */}
      {showPreview && (
        <div style={S.overlay}>
          <div style={S.previewModal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px' }}>📋 Preview ข้อมูลที่จะ Import</h3>
              <span style={{ fontSize: '13px', color: '#0F6E56', fontWeight: '500' }}>{previewData.length} รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
              ⚠️ Code จะถูก Auto Running, Username และ Last Update จะถูก Auto ใส่ให้ครับ
            </div>
            <div style={{ overflow: 'auto', flex: 1, marginBottom: '16px' }}>
              <table style={{ ...S.table, minWidth: '1200px' }}>
                <thead>
                  <tr>{FIELDS.filter(f => !['Code', 'username', 'last_update'].includes(f)).map(f => <th key={f} style={S.th}>{f}</th>)}</tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((row, i) => (
                    <tr key={i}>
                      {FIELDS.filter(f => !['Code', 'username', 'last_update'].includes(f)).map(f => (
                        <td key={f} style={S.td} title={String(row[f] ?? '')}>
                          {String(row[f] ?? '') || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.length > 50 && (
                <div style={{ textAlign: 'center', padding: '8px', fontSize: '12px', color: '#888' }}>
                  แสดง 50 แถวแรก จากทั้งหมด {previewData.length} แถว
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={() => { setShowPreview(false); setPreviewData([]); }}>Cancel</button>
              <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={handleConfirmImport} disabled={importing}>
                {importing ? 'กำลัง Import...' : `✅ Confirm Import ${previewData.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ItemCodeList;