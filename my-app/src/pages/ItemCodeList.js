import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../lib/db';
import { apiFetch } from '../api';
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
            <div
              key={i}
              onMouseDown={() => { setInput(opt); onChange(opt); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' }}
              onMouseEnter={e => e.target.style.background = '#f0f7ff'}
              onMouseLeave={e => e.target.style.background = 'white'}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ✅ vbModeless-style Drag: ลาก Form ได้อิสระ จับที่แถบหัวข้อแล้วลากได้เลย
function useDraggable() {
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // null = คืนตำแหน่ง Default (กึ่งกลาง)
  const dragState = useRef(null);

  const startDrag = (e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, startLeft: rect.left, startTop: rect.top };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setPos({
        left: Math.max(0, dragState.current.startLeft + dx),
        top: Math.max(0, dragState.current.startTop + dy),
      });
    };
    const onUp = () => { dragState.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return { ref, pos, setPos, startDrag };
}

// ✅ Columns ตรงกับ schema จริง (ตัด itemcode2 ออก)
const COLUMNS = [
  { key: 'code',        label: 'Code',        w: 100, sortable: true },
  { key: 'bu',          label: 'BU',          w: 70 },
  { key: 'description', label: 'Description', w: null },
  { key: 'cpc',         label: 'CPC',         w: 80 },
  { key: 'account',     label: 'Account',     w: 100 },
  { key: 'sub',         label: 'SUB',         w: 70 },
  { key: 'dis_g',       label: 'Dis-G',       w: 70 },
  { key: 'i_and_g',     label: 'I&G',         w: 70 },
  { key: 'value',       label: 'VALUE',       w: 70 },
  { key: 'oth',         label: 'OTH',         w: 70 },
  { key: 'spi1',        label: 'SPI-1',       w: 70 },
  { key: 'spec_tx',     label: 'SPEC-TX',     w: 80 },
];

// ✅ Edit fields ตรงกับ schema จริง (ตัด itemcode2 ออก)
const EDIT_FIELDS = [
  ['bu',       'BU'],
  ['description','Description'],
  ['cpc',      'CPC'],
  ['account',  'Account'],
  ['sub',      'SUB'],
  ['dis_g',    'Dis-G'],
  ['i_and_g',  'I&G'],
  ['value',    'VALUE'],
  ['oth',      'OTH'],
  ['spi1',     'SPI-1'],
  ['spec_tx',  'SPEC-TX'],
  ['keyword',  'Keyword'],
];

const COMBO_FIELDS = ['bu', 'sub', 'dis_g', 'i_and_g', 'value', 'oth', 'spi1', 'spec_tx'];

// ✅ Template columns ตรง schema (ตัด itemcode2 ออก)
const TEMPLATE_COLS = ['bu','description','cpc','account','sub','dis_g','i_and_g','value','oth','spi1','spec_tx','keyword'];

// ✅ Duplicate Check: Field หลักสำหรับเทียบเป็น Record เดียวกัน (Partial Match Key)
const DUP_KEY_FIELDS = ['bu', 'description', 'account', 'cpc'];
// ✅ Field ที่ใช้เทียบเพื่อหา Duplicate/Partial จริงๆ (ตัด keyword ออก — keyword ไม่นับเป็นเงื่อนไขการซ้ำ)
const COMPARE_FIELDS = TEMPLATE_COLS.filter(f => f !== 'keyword');
// Field ที่เคย Default เป็น '-' ตอน Import จริง (ต้องทำตอน Classify ด้วย ไม่งั้นเทียบผิด)
const DASH_DEFAULT_FIELDS = ['dis_g', 'i_and_g', 'value', 'oth', 'spi1', 'spec_tx'];
const ALT_KEYS = { i_and_g: 'I & G', spi1: 'SPI-1' };

function normalizeRawRow(row) {
  const out = {};
  TEMPLATE_COLS.forEach(f => {
    const alt = ALT_KEYS[f];
    let v = String(row[f] ?? (alt ? row[alt] : undefined) ?? '').trim();
    if (!v && DASH_DEFAULT_FIELDS.includes(f)) v = '-';
    out[f] = v;
  });
  return out;
}

// ✅ Classify แต่ละแถวจากไฟล์: new / partial (ซ้ำ Field หลัก แต่ Field อื่นต่าง) / exact (ซ้ำทุก Field หรือซ้ำกันเองในไฟล์)
function classifyImportRows(rawRows, existingItems) {
  const existingMap = new Map();
  existingItems.forEach(item => {
    const key = DUP_KEY_FIELDS.map(f => String(item[f] ?? '').trim().toLowerCase()).join('|');
    if (!existingMap.has(key)) existingMap.set(key, []);
    existingMap.get(key).push(item);
  });
  const seenKeys = new Set();
  return rawRows.map(rawRow => {
    const row = normalizeRawRow(rawRow);
    const dupKey = DUP_KEY_FIELDS.map(f => row[f].toLowerCase()).join('|');
    const candidates = existingMap.get(dupKey) || [];
    let matched = candidates[0] || null;
    let isExact = false;
    for (const item of candidates) {
      const allMatch = COMPARE_FIELDS.every(f => String(item[f] ?? '').trim().toLowerCase() === row[f].toLowerCase());
      if (allMatch) { matched = item; isExact = true; break; }
    }
    const isFileDup = seenKeys.has(dupKey);
    seenKeys.add(dupKey);
    if (isExact || isFileDup) {
      return { ...row, _status: 'exact', _existing: matched, _diffs: [], _imported: false, _junked: false };
    }
    if (matched) {
      const diffs = COMPARE_FIELDS
        .filter(f => String(matched[f] ?? '').trim().toLowerCase() !== row[f].toLowerCase())
        .map(f => ({ field: f, old: matched[f] || '-', new: row[f] || '-' }));
      return { ...row, _status: 'partial', _existing: matched, _diffs: diffs, _imported: false, _junked: false };
    }
    return { ...row, _status: 'new', _existing: null, _diffs: [], _imported: false, _junked: false };
  });
}

function ItemCodeList() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState([]); // classified: new / partial / exact
  const [previewSelected, setPreviewSelected] = useState(new Set()); // index ที่ถูกเลือกเพื่อ Import
  const [previewTab, setPreviewTab] = useState('new'); // 'new' | 'duplicate'
  const [previewOpenDetail, setPreviewOpenDetail] = useState(null);
  const formDrag = useDraggable();
  const previewDrag = useDraggable();
  useEffect(() => { if (showForm) formDrag.setPos(null); }, [showForm]); // eslint-disable-line
  useEffect(() => { if (showPreview) previewDrag.setPos(null); }, [showPreview]); // eslint-disable-line
  const [junkConfirm, setJunkConfirm] = useState(null); // { idx: number[], count } | null
  const [importing, setImporting] = useState(false);
  const [editId, setEditId] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [nextCode, setNextCode] = useState('');
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const fileInputRef = useRef(null);
  const theadRef = useRef(null);
  const tbodyRef = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const { currentUser, userName } = useAuth();
  const { isAdmin, isOwner } = useUserRole();
  const { invalidate } = useDataCache();
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;
  const isTablet = screenWidth >= 768 && screenWidth < 1200;

  const emptyForm = {
    bu: '', description: '', cpc: '', account: '', sub: '',
    dis_g: '', i_and_g: '', value: '', oth: '', spi1: '', spec_tx: '', keyword: ''
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const syncScroll = () => {
    if (theadRef.current && tbodyRef.current)
      theadRef.current.scrollLeft = tbodyRef.current.scrollLeft;
  };

  // ✅ ดึงข้อมูล active ทั้งหมด (loop ข้าม 1000-row limit)
  const fetchData = async () => {
    try {
      const data = await apiFetch('/itemcode_list');
      const active = (data || []).filter(item => item.deleted !== true);
      setItems(active.map(item => ({ ...item, code: item.code || '' })));
    } catch (err) { console.error('fetchData error:', err); }
  };


  // ✅ คำนวณ Next Code จากทุก code รวม deleted เพื่อไม่ให้ซ้ำ
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

  // ✅ รวม fetchData + computeNextCode เป็น fetch เดียว (เดิมยิง apiFetch('/itemcode_list') ซ้ำ 2 รอบ)
  const loadItemsAndNextCode = async () => {
    try {
      const data = await apiFetch('/itemcode_list');
      const all = data || [];

      const active = all.filter(item => item.deleted !== true);
      setItems(active.map(item => ({ ...item, code: item.code || '' })));

      const allCodes = all.map(d => d.code || '');
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
    } catch (err) { console.error('loadItemsAndNextCode error:', err); }
  };



  const getCodePool = (data) => {
    const nums = data
      .map(d => d.code || '')
      .filter(c => /^C\d{7}$/.test(c))
      .map(c => parseInt(c.replace('C', ''), 10))
      .sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < nums.length - 1; i++)
      for (let g = nums[i] + 1; g < nums[i + 1]; g++) gaps.push(g);
    const max = nums.length > 0 ? nums[nums.length - 1] : 0;
    let idx = 0;
    return () => idx < gaps.length
      ? `C${String(gaps[idx++]).padStart(7, '0')}`
      : `C${String(max + (idx++ - gaps.length + 1)).padStart(7, '0')}`;
  };

  useEffect(() => { loadItemsAndNextCode(); }, []);
  useEffect(() => { setPage(1); }, [search]);

  const getOptions = (field) =>
    [...new Set(items.map(i => i[field] || '').filter(v => v && v !== '-'))].sort();

  const resetForm = () => setForm(emptyForm);

  // ✅ Save — ใช้ updated_by / updated_at ตรงกับ schema
  const handleSave = async () => {
    const now = new Date().toISOString();
    const data = {
      ...form,
      updated_by: userName || currentUser?.email || '',
      updated_at: now,
    };
    const wasEdit = !!editId;
    const prevItem = wasEdit ? items.find(i => i.id === editId) : null;
    const tempId = wasEdit ? editId : `temp-${Date.now()}`;
    const optimisticItem = wasEdit
      ? { ...prevItem, ...data }
      : { ...data, id: tempId, code: nextCode };

    // ✅ อัปเดตหน้าจอทันที ไม่ต้องรอ backend
    if (wasEdit) {
      setItems(prev => prev.map(i => (i.id === editId ? optimisticItem : i)));
    } else {
      setItems(prev => [...prev, optimisticItem]);
    }
    setShowForm(false);
    setEditId(null);
    resetForm();

    try {
      if (wasEdit) {
        const updated = await apiFetch(`/itemcode_list/${editId}`, { method: 'PUT', body: JSON.stringify(data) });
        setItems(prev => prev.map(i => (i.id === editId ? { ...i, ...updated } : i)));
      } else {
        const created = await apiFetch('/itemcode_list', { method: 'POST', body: JSON.stringify({ ...data, code: nextCode }) });
        setItems(prev => prev.map(i => (i.id === tempId ? created : i)));
        computeNextCode(); // ดึง next code ใหม่เบื้องหลัง ไม่ block UI
      }
      invalidate('ItemcodeList');
    } catch (err) {
      // ❌ ย้อนกลับถ้า backend พัง
      if (wasEdit) {
        setItems(prev => prev.map(i => (i.id === editId ? prevItem : i)));
      } else {
        setItems(prev => prev.filter(i => i.id !== tempId));
      }
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
  };



  const handleEdit = (item) => {
    setForm({
      bu:          item.bu          || '',
      description: item.description || '',
      cpc:         item.cpc         || '',
      account:     item.account     || '',
      sub:         item.sub         || '',
      dis_g:       item.dis_g       || '',
      i_and_g:     item.i_and_g     || '',
      value:       item.value       || '',
      oth:         item.oth         || '',
      spi1:        item.spi1        || '',
      spec_tx:     item.spec_tx     || '',
      keyword:     item.keyword     || '',
    });
    setEditId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    const item = items.find(i => i.id === id);
    if (!item) return;
    const now = new Date().toISOString();
    const deletedBy = userName || currentUser?.email || '';

    // ✅ เอาออกจากหน้าจอทันที
    setItems(prev => prev.filter(i => i.id !== id));
    setSelected(prev => prev.filter(s => s !== id));

    try {
      await apiFetch('/recycle_bin', { method: 'POST', body: JSON.stringify({
        source_table: 'itemcode_list',
        source_id: id,
        source_key: item.code || id,
        data: item,
        deleted_by: deletedBy,
        deleted_at: now,
      })});
      await apiFetch(`/itemcode_list/${id}`, { method: 'DELETE' });
      invalidate('ItemcodeList');
    } catch (err) {
      // ❌ ใส่กลับเข้าหน้าจอเหมือนเดิม
      setItems(prev => [...prev, item]);
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  };



  const handleBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${selected.length} รายการ?`)) return;
    const now = new Date().toISOString();
    const deletedBy = userName || currentUser?.email || '';
    const selectedSet = new Set(selected);
    const rowsToDelete = items.filter(i => selectedSet.has(i.id));

    // ✅ เอาออกจากหน้าจอทันที
    setItems(prev => prev.filter(i => !selectedSet.has(i.id)));
    setSelected([]);

    try {
      for (const item of rowsToDelete) {
        await apiFetch('/recycle_bin', { method: 'POST', body: JSON.stringify({
          source_table: 'itemcode_list',
          source_id: item.id,
          source_key: item.code || item.id,
          data: item,
          deleted_by: deletedBy,
          deleted_at: now,
        })});
      }
      for (const item of rowsToDelete) {
        await apiFetch(`/itemcode_list/${item.id}`, { method: 'DELETE' });
      }
      invalidate('ItemcodeList');
      alert(`✅ ลบสำเร็จ ${rowsToDelete.length} รายการ`);
    } catch (err) {
      // ❌ ใส่กลับเข้าหน้าจอทั้งหมดเหมือนเดิม
      setItems(prev => [...prev, ...rowsToDelete]);
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  };



  // ✅ Template ตัด itemcode2 ออก
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLS]);
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
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const classified = classifyImportRows(rawRows, items);
      setPreviewRows(classified);
      setPreviewSelected(new Set(classified.map((r, i) => i).filter(i => classified[i]._status === 'new')));
      setPreviewTab('new');
      setPreviewOpenDetail(null);
      setShowPreview(true);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // ✅ Tab views + Selection helpers สำหรับ Preview
  const previewNew = useMemo(
    () => previewRows.map((r, i) => ({ ...r, _idx: i })).filter(r => r._status === 'new' && !r._imported && !r._junked),
    [previewRows]
  );
  const previewDup = useMemo(
    () => previewRows.map((r, i) => ({ ...r, _idx: i })).filter(r => r._status !== 'new' && !r._imported && !r._junked),
    [previewRows]
  );
  // ✅ เฉพาะแถวที่เลือกไว้ ใน Tab ที่กำลังดูอยู่เท่านั้น (แยก Confirm ต่อ Tab)
  const activeSelectedRows = useMemo(() => {
    const activeList = previewTab === 'new' ? previewNew : previewDup;
    return activeList.filter(r => previewSelected.has(r._idx));
  }, [previewTab, previewNew, previewDup, previewSelected]);
  const togglePreviewSelect = (idx) => {
    setPreviewSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  // ✅ Checkbox ที่หัวตาราง: เลือก/ยกเลิกทั้งหมดใน Tab ที่กำลังดูอยู่ (ใช้ได้ทั้ง 2 Tab)
  const activeVisibleList = previewTab === 'new' ? previewNew : previewDup;
  const isAllVisibleSelected = activeVisibleList.length > 0 && activeVisibleList.every(r => previewSelected.has(r._idx));
  const toggleSelectAllVisible = () => setPreviewSelected(prev => {
    const next = new Set(prev);
    if (isAllVisibleSelected) {
      activeVisibleList.forEach(r => next.delete(r._idx));
    } else {
      activeVisibleList.forEach(r => next.add(r._idx));
    }
    return next;
  });
  // ✅ ลบทิ้ง (Junk) แถวที่เลือกออกจาก Preview — ไม่ Import และไม่แสดงอีก (ใช้ Flag เหมือน _imported กัน Index เพี้ยน)
  const handleJunkSelected = () => {
    const idx = activeVisibleList.filter(r => previewSelected.has(r._idx)).map(r => r._idx);
    if (idx.length === 0) return;
    setJunkConfirm({ idx, count: idx.length });
  };
  const confirmJunk = () => {
    if (!junkConfirm) return;
    const idxSet = new Set(junkConfirm.idx);
    setPreviewRows(prev => prev.map((r, i) => idxSet.has(i) ? { ...r, _junked: true } : r));
    setPreviewSelected(prev => {
      const next = new Set(prev);
      idxSet.forEach(i => next.delete(i));
      return next;
    });
    setJunkConfirm(null);
  };

  // ✅ Import — เฉพาะแถวที่เลือกใน Tab ที่กำลังดูอยู่ (แยก Confirm ต่อ Tab ได้)
  const handleConfirmImport = async () => {
    const rowsToImport = activeSelectedRows;
    if (rowsToImport.length === 0) { alert('กรุณาเลือกอย่างน้อย 1 รายการ'); return; }
    setImporting(true);
    try {
      // ✅ Fix Bug เดิม: db.from().range() เวอร์ชันนี้ไม่ Apply Offset จริง ทำให้วนลูปไม่รู้จบ → เปลี่ยนไปใช้ apiFetch แบบเดียวกับ fetchData/loadItemsAndNextCode
      const allCodesData = await apiFetch('/itemcode_list');
      const getNextCode = getCodePool(allCodesData || []);
      const now = new Date().toISOString();

      for (let i = 0; i < rowsToImport.length; i += 500) {
        const batch = rowsToImport.slice(i, i + 500).map(row => ({
          code:        getNextCode(),
          bu:          row.bu,
          description: row.description,
          cpc:         row.cpc,
          account:     row.account,
          sub:         row.sub,
          dis_g:       row.dis_g,
          i_and_g:     row.i_and_g,
          value:       row.value,
          oth:         row.oth,
          spi1:        row.spi1,
          spec_tx:     row.spec_tx,
          keyword:     row.keyword,
          updated_by:  userName || currentUser?.email || '',  // ✅ ตรงกับ schema
          updated_at:  now,                                   // ✅ ตรงกับ schema
        }));
        const { error } = await db.from('itemcode_list').insert(batch);
        if (error) throw error;
      }

      const importedIdx = new Set(rowsToImport.map(r => r._idx));
      const nextPreviewRows = previewRows.map((r, i) => importedIdx.has(i) ? { ...r, _imported: true } : r);
      setPreviewRows(nextPreviewRows);
      setPreviewSelected(prev => {
        const next = new Set(prev);
        importedIdx.forEach(idx => next.delete(idx));
        return next;
      });

      const stillRemaining = nextPreviewRows.some(r => !r._imported && !r._junked);
      if (!stillRemaining) {
        setShowPreview(false);
        setPreviewRows([]);
        setPreviewSelected(new Set());
      }

      loadItemsAndNextCode();
      invalidate('ItemcodeList');
      alert(`✅ Import สำเร็จ ${rowsToImport.length} รายการ`);
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    }
    setImporting(false);
  };

  const filtered = useMemo(() => items
    .filter(i => !search || (
      i.code?.toLowerCase().includes(search.toLowerCase()) ||
      i.bu?.toLowerCase().includes(search.toLowerCase()) ||
      i.description?.toLowerCase().includes(search.toLowerCase()) ||
      i.cpc?.toLowerCase().includes(search.toLowerCase()) ||
      i.account?.includes(search) ||
      i.sub?.toLowerCase().includes(search.toLowerCase()) ||
      i.dis_g?.toLowerCase().includes(search.toLowerCase()) ||
      i.i_and_g?.toLowerCase().includes(search.toLowerCase()) ||
      i.spi1?.toLowerCase().includes(search.toLowerCase()) ||
      i.spec_tx?.toLowerCase().includes(search.toLowerCase()) ||
      i.keyword?.toLowerCase().includes(search.toLowerCase())
    ))
    .sort((a, b) => {
      const ca = a.code || '', cb = b.code || '';
      return sortDir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca);
    }),
    [items, search, sortDir]
  );

  const effectivePageSize = pageSize === 0 ? filtered.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const paginated = pageSize === 0 ? filtered : filtered.slice((page - 1) * effectivePageSize, page * effectivePageSize);

  const getPageWindow = () => {
    const size = isMobile ? 3 : 5;
    let start = Math.max(1, page - Math.floor(size / 2));
    let end = Math.min(totalPages, start + size - 1);
    if (end - start < size - 1) start = Math.max(1, end - size + 1);
    const pages = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const actionW = isAdmin ? (56 * 2) + 20 : 56 + 20;
  const fixedW = 36 + COLUMNS.filter(c => c.w).reduce((s, c) => s + c.w, 0) + actionW;
  const totalW = containerW > 0 ? Math.max(fixedW + 100, containerW) : fixedW + 200;

  const S = {
    container: { padding: isMobile ? '12px' : '20px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' },
    topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexShrink: 0, flexWrap: 'wrap', gap: '8px' },
    btn: { padding: isMobile ? '6px 10px' : '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' },
    outer: { background: 'white', borderRadius: '8px', border: '0.5px solid #e8e8e8', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
    theadWrap: { overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' },
    tbodyWrap: { overflowY: 'auto', overflowX: 'auto', flex: 1, minWidth: 0 },
    table: { borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' },
    th: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    thSort: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis' },
    thCheck: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', width: '36px' },
    thAction: { background: '#1a3a5c', color: 'white', padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: '500' },
    td: { padding: '7px 10px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '0' },
    tdCenter: { padding: '6px 8px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box' },
    inputDisabled: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #eee', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box', background: '#f5f5f5', color: '#999' },
    // ✅ vbModeless: เอา Backdrop ออก (pointerEvents none) กดด้านหลังได้ ส่วน Form เองเปิด pointerEvents auto เฉพาะตัว
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'transparent', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '10px', width: isMobile ? '95vw' : '500px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', pointerEvents: 'auto' },
    dragHeader: { cursor: 'move', userSelect: 'none' },
    iconBtn: (color, bg, border) => ({ background: bg || 'none', border: `0.5px solid ${border || color}`, borderRadius: '4px', cursor: 'pointer', padding: '3px 6px', color, fontSize: '12px', lineHeight: 1 }),
    pageBtn: (active, disabled) => ({ padding: '3px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: disabled ? 'default' : 'pointer', background: active ? '#1a3a5c' : 'white', color: disabled ? '#ccc' : active ? 'white' : '#555', minWidth: '28px', textAlign: 'center' }),
  };

  const renderColGroup = () => (
    <colgroup>
      <col style={{ width: '36px', minWidth: '36px' }} />
      {COLUMNS.map((c, i) => c.w
        ? <col key={i} style={{ width: `${c.w}px`, minWidth: `${c.w}px` }} />
        : <col key={i} />
      )}
      <col style={{ width: `${actionW}px`, minWidth: `${actionW}px` }} />
    </colgroup>
  );

  const renderInfoText = () => {
    if (isMobile) return `${filtered.length} รายการ`;
    const start = (page - 1) * effectivePageSize + 1;
    const end = Math.min(page * effectivePageSize, filtered.length);
    return `แสดง ${start}-${end} จาก ${filtered.length} รายการ${search ? ` | ค้นหา "${search}"` : ''}${selected.length > 0 ? ` | เลือกอยู่ ${selected.length} รายการ` : ''}`;
  };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: '600', margin: 0 }}>🔖 Item Code List</h2>
          {isAdmin && selected.length > 0 && (
            <button style={{ ...S.btn, background: '#c0392b', color: 'white', marginLeft: 0 }} onClick={handleBulkDelete}>
              🗑️{!isMobile && ` ลบ ${selected.length}`}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button style={{ ...S.btn, background: '#0F6E56', color: 'white' }} onClick={handleDownloadTemplate}>
            ⬇{!isMobile && ' Template'}
          </button>
          <button style={{ ...S.btn, background: '#5DCAA5', color: '#1a3a5c' }} onClick={() => fileInputRef.current.click()}>
            📂{!isMobile && ' Import'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
          <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setEditId(null); resetForm(); }}>
            + New
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', margin: '4px 0', flexShrink: 0, gap: '8px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', width: isMobile ? '140px' : isTablet ? '180px' : '240px' }}
          />
          {!isMobile && <span style={{ fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>{renderInfoText()}</span>}
          {nextCode && !isMobile && <span style={{ fontSize: '12px', color: '#1a3a5c', fontWeight: '500', whiteSpace: 'nowrap' }}>Next Code: {nextCode}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            style={{ padding: '3px 6px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white', cursor: 'pointer' }}
          >
            {[25, 50, 100, 200, 0].map(s => <option key={s} value={s}>{s === 0 ? 'ทั้งหมด' : s}</option>)}
          </select>
          {!isMobile && <span style={{ fontSize: '12px', color: '#888' }}>รายการ/หน้า</span>}
          <button style={S.pageBtn(false, page === 1)} disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button style={S.pageBtn(false, page === 1)} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          {getPageWindow().map(p => (
            <button key={p} style={S.pageBtn(p === page, false)} onClick={() => setPage(p)}>{p}</button>
          ))}
          <button style={S.pageBtn(false, page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          <button style={S.pageBtn(false, page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
          <span style={{ fontSize: '12px', color: '#888', marginLeft: '2px', whiteSpace: 'nowrap' }}>{page} / {totalPages}</span>
        </div>
      </div>

      <div ref={containerRef} style={S.outer}>
        <div ref={theadRef} style={{ ...S.theadWrap, msOverflowStyle: 'none' }}>
          <table style={{ ...S.table, width: `${totalW}px` }}>
            {renderColGroup()}
            <thead>
              <tr>
                <th style={S.thCheck}>
                  <input
                    type="checkbox"
                    checked={paginated.length > 0 && paginated.every(i => selected.includes(i.id))}
                    onChange={() => {
                      const ids = paginated.map(i => i.id);
                      const all = ids.every(id => selected.includes(id));
                      setSelected(all ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
                    }}
                  />
                </th>
                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    style={c.sortable ? S.thSort : S.th}
                    onClick={c.sortable ? () => setSortDir(d => d === 'asc' ? 'desc' : 'asc') : undefined}
                  >
                    {c.label}{c.sortable ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th style={S.thAction}>Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div ref={tbodyRef} style={S.tbodyWrap} className="table-scroll" onScroll={syncScroll}>
          <table style={{ ...S.table, width: `${totalW}px` }}>
            {renderColGroup()}
            <tbody>
              {paginated.map(item => (
                <tr key={item.id} style={{ background: selected.includes(item.id) ? '#f0f7ff' : 'white' }}>
                  <td style={S.tdCenter}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => setSelected(prev => prev.includes(item.id) ? prev.filter(s => s !== item.id) : [...prev, item.id])}
                    />
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key} style={S.td} title={item[c.key] || ''}>{item[c.key] || '-'}</td>
                  ))}
                  <td style={S.tdCenter}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <button onClick={() => handleEdit(item)} style={S.iconBtn('#555', '#f5f5f5', '#ddd')}>✏️</button>
                      {isAdmin && <button onClick={() => handleDelete(item.id)} style={S.iconBtn('#791F1F', '#FCEBEB', '#f7c1c1')}>🗑️</button>}
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
          <div ref={formDrag.ref} style={{ ...S.modal, ...(formDrag.pos ? { position: 'fixed', left: formDrag.pos.left, top: formDrag.pos.top, margin: 0 } : {}) }}>
            <div style={{ ...S.dragHeader, padding: '16px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }} onMouseDown={formDrag.startDrag}>
              <h3 style={{ fontSize: '15px', margin: 0 }}>✥ {editId ? '✏️ Edit Item Code' : '+ New Item Code'}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => setShowForm(false)}>Cancel</button>
                <button style={{ ...S.btn, background: '#1a3a5c', color: 'white', marginLeft: 0 }} onClick={handleSave}>Save</button>
              </div>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              <label style={{ fontSize: '11px', color: '#888' }}>Code</label>
              <input style={S.inputDisabled} value={editId ? (items.find(i => i.id === editId)?.code || '') : nextCode} disabled />
              {EDIT_FIELDS.map(([key, label]) => (
                <div key={key} style={{ marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '2px' }}>{label}</label>
                  {COMBO_FIELDS.includes(key)
                    ? <ComboBox value={form[key]} onChange={val => setForm({ ...form, [key]: val })} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
                    : <input style={S.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
                  }
                </div>
              ))}
              <label style={{ fontSize: '11px', color: '#888' }}>Updated By</label>
              <input style={S.inputDisabled} value={userName || currentUser?.email || ''} disabled />
            </div>
          </div>
        </div>
      )}

      {showPreview && (
        <div style={S.overlay}>
          <div ref={previewDrag.ref} style={{ background: 'white', borderRadius: '10px', padding: '20px', width: '95vw', maxWidth: '1500px', height: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', pointerEvents: 'auto', ...(previewDrag.pos ? { position: 'fixed', left: previewDrag.pos.left, top: previewDrag.pos.top, margin: 0 } : {}) }}>
            <div style={{ ...S.dragHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }} onMouseDown={previewDrag.startDrag}>
              <h3 style={{ fontSize: '15px', margin: 0 }}>✥ 📋 Preview ข้อมูลที่จะ Import</h3>
              <span style={{ fontSize: '12px', color: '#0F6E56', fontWeight: '500' }}>{previewRows.length} รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px', background: '#f8f9fa', padding: '8px 12px', borderRadius: '6px' }}>
              ⚠️ Code จะถูก Auto Running, Updated By และ Updated At จะถูก Auto ใส่ให้ครับ
            </div>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', borderBottom: '1px solid #eee' }}>
              <button
                onClick={() => setPreviewTab('new')}
                style={{ padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none', borderBottom: previewTab === 'new' ? '3px solid #0F6E56' : '3px solid transparent', background: previewTab === 'new' ? '#f0f7f5' : 'transparent', fontWeight: previewTab === 'new' ? '600' : '400', fontSize: '13px', cursor: 'pointer', color: '#333' }}
              >
                New ({previewNew.length}{previewRows.length > 0 ? ` · ${Math.round(previewNew.length / previewRows.length * 100)}%` : ''})
              </button>
              <button
                onClick={() => setPreviewTab('duplicate')}
                style={{ padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none', borderBottom: previewTab === 'duplicate' ? '3px solid #B54708' : '3px solid transparent', background: previewTab === 'duplicate' ? '#FFF7ED' : 'transparent', fontWeight: previewTab === 'duplicate' ? '600' : '400', fontSize: '13px', cursor: 'pointer', color: '#333' }}
              >
                Duplicates ({previewDup.length}{previewRows.length > 0 ? ` · ${Math.round(previewDup.length / previewRows.length * 100)}%` : ''})
              </button>
            </div>

            {activeSelectedRows.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <button onClick={handleJunkSelected} style={{ ...S.btn, background: '#FCEBEB', color: '#791F1F', border: '0.5px solid #f7c1c1', fontSize: '12px', padding: '5px 10px', marginLeft: 0 }}>
                  🗑️ ลบทิ้ง {activeSelectedRows.length} รายการ
                </button>
              </div>
            )}

            <div style={{ overflow: 'auto', flex: 1, marginBottom: '16px', border: '0.5px solid #e8e8e8', borderRadius: '6px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '11px', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', position: 'sticky', top: 0, width: '32px', textAlign: 'center' }}>
                      <input type="checkbox" checked={isAllVisibleSelected} onChange={toggleSelectAllVisible} />
                    </th>
                    {previewTab === 'duplicate' && <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>สถานะ</th>}
                    {TEMPLATE_COLS.map(f => (
                      <th key={f} style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{f}</th>
                    ))}
                    {previewTab === 'duplicate' && <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>บันทึกโดย</th>}
                    {previewTab === 'duplicate' && <th style={{ background: '#1a3a5c', color: 'white', padding: '8px 10px', position: 'sticky', top: 0 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {(previewTab === 'new' ? previewNew : previewDup).slice(0, 200).map((row) => (
                    <React.Fragment key={row._idx}>
                      <tr>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <input type="checkbox" checked={previewSelected.has(row._idx)} onChange={() => togglePreviewSelect(row._idx)} />
                        </td>
                        {previewTab === 'duplicate' && (
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                            {row._status === 'exact'
                              ? <span style={{ color: '#B42318', fontWeight: 600 }}>🔴 ซ้ำทั้งหมด</span>
                              : <span style={{ color: '#B54708', fontWeight: 600 }}>🟡 อาจซ้ำ</span>}
                          </td>
                        )}
                        {TEMPLATE_COLS.map(f => (
                          <td key={f} style={{ padding: '7px 10px', fontSize: '11px', borderBottom: '0.5px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {String(row[f] ?? '') || '-'}
                          </td>
                        ))}
                        {previewTab === 'duplicate' && (
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', fontSize: '11px', color: '#666' }}>
                            {row._existing?.updated_by || '-'}
                          </td>
                        )}
                        {previewTab === 'duplicate' && (
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            {row._status === 'partial' && (
                              <button onClick={() => setPreviewOpenDetail(previewOpenDetail === row._idx ? null : row._idx)} style={{ fontSize: '11px', color: '#1a5fb4', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                {previewOpenDetail === row._idx ? 'ซ่อน' : 'ดูรายละเอียด'}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {previewOpenDetail === row._idx && row._diffs && row._diffs.length > 0 && (
                        <tr>
                          <td colSpan={TEMPLATE_COLS.length + 3} style={{ padding: '8px 14px', background: '#FFFBEB', borderBottom: '0.5px solid #f0f0f0' }}>
                            <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                              Record เดิม บันทึกล่าสุดโดย <b>{row._existing?.updated_by || '-'}</b> เมื่อ {row._existing?.updated_at ? new Date(row._existing.updated_at).toLocaleString('th-TH') : '-'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                              {row._diffs.map(d => (
                                <div key={d.field} style={{ fontSize: '11px', background: 'white', border: '0.5px solid #eee', borderRadius: '4px', padding: '4px 8px' }}>
                                  <b>{d.field}</b>: <span style={{ color: '#999', textDecoration: 'line-through' }}>{d.old}</span> → <span style={{ color: '#0F6E56', fontWeight: 600 }}>{d.new}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {(previewTab === 'new' ? previewNew : previewDup).length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', fontSize: '12px', color: '#888' }}>ไม่มีรายการ</div>
              )}
              {(previewTab === 'new' ? previewNew : previewDup).length > 200 && (
                <div style={{ textAlign: 'center', padding: '8px', fontSize: '12px', color: '#888' }}>
                  แสดง 200 แถวแรก
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={() => { setShowPreview(false); setPreviewRows([]); setPreviewSelected(new Set()); }}>Cancel</button>
              <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={handleConfirmImport} disabled={importing || activeSelectedRows.length === 0}>
                {importing ? 'กำลัง Import...' : `✅ Confirm Import ${activeSelectedRows.length} รายการ (${previewTab === 'new' ? 'New' : 'Duplicates'})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {junkConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: 'white', borderRadius: '10px', padding: '20px', width: '360px', boxShadow: '0 8px 28px rgba(0,0,0,0.22)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '22px' }}>🗑️</span>
              <h3 style={{ fontSize: '15px', margin: 0 }}>ยืนยันการลบทิ้ง</h3>
            </div>
            <p style={{ fontSize: '13px', color: '#555', margin: '0 0 20px', lineHeight: 1.6 }}>
              ตัด <b>{junkConfirm.count}</b> รายการนี้ออกจาก Import ใช่ไหม?<br />
              (จะไม่ถูก Import และจะหายจากรายการนี้)
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => setJunkConfirm(null)}>Cancel</button>
              <button style={{ ...S.btn, background: '#c0392b', color: 'white', marginLeft: 0 }} onClick={confirmJunk}>ลบทิ้ง</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ItemCodeList;
