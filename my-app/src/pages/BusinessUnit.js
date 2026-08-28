import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { db } from '../lib/db';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';
import { useDataCache } from '../contexts/DataCacheContext';
import { broadcastWs, subscribeWs } from '../wsManager'; // MARKER_BUSINESSUNIT_COMPANYLIST_BROADCAST_V1
import ReactDOM from 'react-dom'; // MARKER_STATUSDROPDOWN_PORTAL_FIX_V1
// MARKER_BUSINESSUNIT_APPLY_APCONTROLLER_STYLE_V1
import { confirmDialog } from '../confirmDialog';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

// MARKER_STATUS_DROPDOWN_CUSTOM_V1
function StatusDropdown({ value, onChange, options, style }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (listRef.current && listRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setOpen(o => !o);
  };
  return (
    <React.Fragment>
      <div ref={triggerRef} onClick={handleToggle} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}>
        <span>{value || 'เลือก Status'}</span>
        <span style={{ fontSize: '10px', color: '#888', marginLeft: '6px' }}>{open ? '\u25b2' : '\u25bc'}</span>
      </div>
      {open && ReactDOM.createPortal(
        <div ref={listRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, background: 'white', border: '0.5px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.18)', zIndex: 99999, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <div key={i} onMouseDown={() => { onChange(o); setOpen(false); }}
              style={{ padding: '8px 10px', fontSize: '13px', cursor: 'pointer', borderBottom: i < options.length - 1 ? '0.5px solid #f5f5f5' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}>{o}</div>
          ))}
        </div>,
        document.body
      )}
    </React.Fragment>
  );
}

// MARKER_BUSINESSUNIT_FIX_INFOCELL_STYLE_V1
function ComboBox({ value, onChange, options, placeholder, bare }) {
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
  const bareStyle = { height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: 'center' };
  const normalStyle = { padding: '5px 8px', borderRadius: '5px', border: '0.5px solid #d0d0d0', fontSize: '12px', width: '100%', boxSizing: 'border-box', height: '30px' };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input value={input} onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder || ''}
        style={bare ? bareStyle : normalStyle} />
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

// MARKER_BUSINESSUNIT_BU_GROUP_RANGE_SECTION_V1
// ── Section "BU Group Range" — Global Config ไม่ผูกกับ BU ที่กำลังแก้ไขอยู่ ──
// ── BU ไหนไม่ได้กำหนด Range ก็ทำงานตามปกติ ไม่บังคับต้องมีทุก BU ──────────
function VatWatchlistBuGroupRangeSection({ currentBu }) {
  const [ranges, setRanges] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState(null);
  const [formGroupName, setFormGroupName] = React.useState('');
  const [formRangeInput, setFormRangeInput] = React.useState('');
  const [formPrefixLength, setFormPrefixLength] = React.useState('4');
  const [saving, setSaving] = React.useState(false);

  const loadRanges = React.useCallback(async () => {
    try {
      const { data, error } = await db.from('vat_watchlist_bu_group_range').select('*').order('group_name');
      if (error) throw error;
      setRanges(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('VatWatchlistBuGroupRangeSection load error:', err);
      setRanges([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadRanges(); }, [loadRanges]);

  // MARKER_BUSINESSUNIT_BU_GROUP_RANGE_PER_BU_V1
  // ── โชว์เฉพาะ Range ของ BU ที่กำลังเปิดอยู่เท่านั้น (ผูกกับ BU นี้โดยตรง) ──
  const buRanges = React.useMemo(
    () => ranges.filter((r) => r.group_name === currentBu),
    [ranges, currentBu]
  );

  const resetForm = () => {
    setEditingId(null);
    setFormRangeInput('');
    setFormPrefixLength('4');
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setFormRangeInput(`${r.range_start || ''}-${r.range_end || ''}`);
    setFormPrefixLength(r.prefix_length == null ? 'full' : String(r.prefix_length));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบ Range นี้?')) return;
    try {
      const { error } = await db.from('vat_watchlist_bu_group_range').delete().eq('id', id);
      if (error) throw error;
      await loadRanges();
    } catch (err) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  };

  const handleSave = async () => {
    const groupName = (currentBu || '').trim(); // MARKER_BUSINESSUNIT_BU_GROUP_RANGE_PER_BU_V1 — ใช้ BU ปัจจุบันเสมอ
    if (!groupName) { alert('ต้องกรอก BU Code ก่อนถึงจะกำหนด Range ได้'); return; }
    if (!formRangeInput.trim()) { alert('กรุณากรอก Range'); return; }
    const prefixLength = formPrefixLength === 'full' ? null : Number(formPrefixLength);

    setSaving(true);
    try {
      if (editingId) {
        // Edit แถวเดียว (ไม่รองรับ Comma หลาย Range ตอนแก้ไข)
        const [rangeStart, rangeEnd] = formRangeInput.split('-').map((s) => s.trim());
        const { error } = await db.from('vat_watchlist_bu_group_range')
          .update({ group_name: groupName, range_start: rangeStart, range_end: rangeEnd || rangeStart, prefix_length: prefixLength })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        // Add ใหม่ — รองรับ Comma หลาย Range พร้อมกัน เช่น "0401-0401,4360-4363"
        const pairs = formRangeInput.split(',').map((s) => s.trim()).filter(Boolean);
        const rowsToInsert = pairs.map((pair) => {
          const [rangeStart, rangeEnd] = pair.split('-').map((s) => s.trim());
          return { group_name: groupName, range_start: rangeStart, range_end: rangeEnd || rangeStart, prefix_length: prefixLength };
        });
        const { error } = await db.from('vat_watchlist_bu_group_range').insert(rowsToInsert);
        if (error) throw error;
      }
      resetForm();
      await loadRanges();
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    setSaving(false);
  };

  const cellStyle = { padding: '8px 10px', fontSize: '12px', borderRight: '0.5px solid #e8e8e8' };
  const headStyle = { ...cellStyle, fontWeight: '600', color: '#666', background: '#f5f5f3', fontSize: '11px' };
  const inputStyle = { width: '100%', padding: '7px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', boxSizing: 'border-box' };

  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#666' }}>BU GROUP RANGE</div>
        <div style={{ fontSize: '10px', color: '#999' }}>— Config ระดับระบบ ไม่บังคับกำหนดทุก BU (ถ้าไม่มี Range = ทำงานตามปกติ)</div>
      </div>

      {!loading && buRanges.length > 0 && (
        <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 100px' }}>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>Group Name</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>Range</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>อ่านกี่ตำแหน่ง</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8', borderRight: 'none', textAlign: 'center' }}>จัดการ</div>
          </div>
          {buRanges.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 100px', borderTop: '0.5px solid #f0f0f0' }}>
              <div style={{ ...cellStyle, fontWeight: '500' }}>{r.group_name}</div>
              <div style={{ ...cellStyle, color: '#555' }}>{r.range_start}-{r.range_end}</div>
              <div style={{ ...cellStyle, color: '#555' }}>{r.prefix_length == null ? 'Full' : `${r.prefix_length} ตำแหน่ง`}</div>
              <div style={{ padding: '6px 10px', display: 'flex', gap: '6px', justifyContent: 'center' }}>
                <button type="button" onClick={() => startEdit(r)} style={{ padding: '3px 8px', fontSize: '11px', border: '0.5px solid #ccc', background: 'white', borderRadius: '5px', cursor: 'pointer' }}>แก้ไข</button>
                <button type="button" onClick={() => handleDelete(r.id)} style={{ padding: '3px 8px', fontSize: '11px', border: '0.5px solid #c0392b', color: '#c0392b', background: 'white', borderRadius: '5px', cursor: 'pointer' }}>ลบ</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ border: '1px dashed #ccc', borderRadius: '8px', padding: '12px', display: 'grid', gridTemplateColumns: '2fr 1fr 100px', gap: '8px', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10px', color: '#999', marginBottom: '4px' }}>Range {!editingId && '(คั่นด้วย , ได้หลายช่วง)'}</label>
          <input style={inputStyle} placeholder="เช่น 0401-0401,4360-4363" value={formRangeInput} onChange={(e) => setFormRangeInput(e.target.value)} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10px', color: '#999', marginBottom: '4px' }}>อ่านกี่ตำแหน่ง</label>
          <select style={inputStyle} value={formPrefixLength} onChange={(e) => setFormPrefixLength(e.target.value)}>
            <option value="3">3 ตำแหน่ง</option>
            <option value="4">4 ตำแหน่ง</option>
            <option value="full">Full (เทียบเต็ม)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '8px 0', fontSize: '12px', fontWeight: '500', background: saving ? '#ccc' : '#1a3a5c', color: 'white', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {editingId ? 'บันทึก' : '+ เพิ่ม'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} style={{ padding: '8px 10px', fontSize: '12px', border: '0.5px solid #ccc', background: 'white', borderRadius: '6px', cursor: 'pointer' }}>ยกเลิก</button>
          )}
        </div>
      </div>
    </div>
  );
}

function BusinessUnit({ activeSubTab, onSubTabChange }) {
  const [tab, setTab] = useState(activeSubTab || 'info');
  const { currentUser, userName, userPermissions } = useAuth();  // MARKER_BUSINESSUNIT_INFO_FORM_REDESIGN_V1
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const { fetchCollection, invalidate } = useDataCache();
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
  // MARKER_BRANCHPASTE_PREVIEW_POPUP_V1
  // ── เก็บค่าที่ Parse ได้จาก Paste + Reference form/setForm ปัจจุบัน ──────────
  // ── ไว้ Apply ตอนกด "ยืนยัน" ใน Popup (แก้ไขค่าใน Popup ได้ก่อนยืนยัน) ──────
  const [branchPastePreview, setBranchPastePreview] = useState(null);
  const [branchNewForm, setBranchNewForm] = useState({});
  const [branchNewError, setBranchNewError] = useState('');
  const [showBranchPreview, setShowBranchPreview] = useState(false);
  const [branchPreviewRows, setBranchPreviewRows] = useState([]);
  const [branchImporting, setBranchImporting] = useState(false);
  const branchFileRef = useRef(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [recycleBinItems, setRecycleBinItems] = useState([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);
  const [recycleBinSelected, setRecycleBinSelected] = useState([]);
  const [recycleBinProgress, setRecycleBinProgress] = useState(0);
  const [recycleBinLoading2, setRecycleBinLoading2] = useState(false);

  const [branchPage, setBranchPage] = useState(1);
  const [branchPageSize, setBranchPageSize] = useState(100);
  const [branchTaxFilter, setBranchTaxFilter] = useState('');

  const theadRef = useRef(null);
  const tbodyRef = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const syncScroll = () => { if (theadRef.current && tbodyRef.current) theadRef.current.scrollLeft = tbodyRef.current.scrollLeft; };

  // ✅ Guards to prevent duplicate concurrent fetches (e.g. React StrictMode double-invoke)
  const fetchInfoRef = useRef(false);
  const fetchBranchRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const INFO_FIELDS = ['bu','THAI COMPANY NAME','ENGLISH COMPANY NAME','bu_code_name','system_bank','TAX ID','PREPARE BY','DEPARTMENT','COMPANY CODE','VAT %','Last Rate (%)','BOOK','SEGMENT3','AP GRT Control','updated_by','updated_at'];
  const INFO_KEY = 'TAX ID';
  const INFO_COMBO = ['bu','DEPARTMENT','BOOK','AP GRT Control'];
  // MARKER_BUSINESSUNIT_INFO_FORM_REDESIGN_V1
  const INFO_EDIT = [
    ['bu','BU'],['THAI COMPANY NAME','Thai Company Name'],['ENGLISH COMPANY NAME','English Company Name'],
    ['bu_code_name','BU Code Name'],['system_bank','System Bank'],
    ['TAX ID','Tax ID'],['PREPARE BY','Prepare By'],['DEPARTMENT','Department'],
    ['COMPANY CODE','Company Code'],['VAT %','VAT %'],['Last Rate (%)','Last Rate (%)'],
    ['BOOK','Book'],['SEGMENT3','Segment3'],['AP GRT Control','AP GRT Control'],['allowed_tax_type','Tax Type'], // MARKER_BUSINESSUNIT_TAXTYPE_MOVE_VAT_V5
    ['IE GRT Control','IE GRT Control'],['VAT GRT Control','VAT GRT Control'],
    ['AP Prepare By','AP Prepare By'],['AP Department','AP Department'],
    ['IE Prepare By','IE Prepare By'],['IE Department','IE Department'], // MARKER_BUSINESSUNIT_SETTING_CONSOLIDATED_V16
    ['ap_grt_pattern','AP GRT Pattern'],['ap_grt','AP GRT'],['ap_grn_pattern','AP GRN Pattern'],['ap_grn','AP GRN'],['ap_digit','AP Digit'],
    ['ie_grt_pattern','IE GRT Pattern'],['ie_grt','IE GRT'],['ie_grn_pattern','IE GRN Pattern'],['ie_grn','IE GRN'],['ie_digit','IE Digit'],
    ['vat_watchlist_status','VAT Status'],['vat_grn_pattern','VAT GRN Pattern'],['vat_grn','VAT GRN'],['vat_digit','VAT Digit'],
    ['base','Base'] // MARKER_BUSINESSUNIT_ADD_BASE_FIELD_V20
  ];
  // Fields that should span full width in Info form
  const INFO_FULL_WIDTH = ['THAI COMPANY NAME','ENGLISH COMPANY NAME'];

  // MARKER_BUSINESSUNIT_INFO_TABLE_REMOVE_BUCODE_BANK_V1
  // -- ตัด bu_code_name / system_bank ออกจากตารางแสดงผล (UI เท่านั้น) --
  // -- ยังแก้ค่าได้ปกติผ่าน Popup Add/Edit เพราะ INFO_FIELDS/INFO_EDIT ไม่ถูกแตะ --
  const INFO_COLUMNS = [
    // MARKER_BUSINESSUNIT_REMOVE_PREPAREBY_GRTCONTROL_COL_V18
    { key: 'bu', label: 'BU', sortable: true, w: 70 },
    { key: 'THAI COMPANY NAME', label: 'Thai Company Name', sortable: true, w: 220 },
    { key: 'ENGLISH COMPANY NAME', label: 'English Company Name', w: 220 },
    { key: 'TAX ID', label: 'Tax ID', w: 130 },
    { key: 'COMPANY CODE', label: 'Company Code', w: 120 },
    { key: 'VAT %', label: 'VAT %', w: 70 },
    { key: 'Last Rate (%)', label: 'Last Rate (%)', w: 90 },
    { key: 'BOOK', label: 'Book', w: 80 },
    { key: 'SEGMENT3', label: 'Segment3', w: 90 },
  ];
  // MARKER_BUSINESSUNIT_SETTING_CONSOLIDATED_V16
  const emptyInfoForm = () => ({
    ...Object.fromEntries(INFO_EDIT.map(([k]) => [k, ''])),
    'IE GRT Control': 'Auto',
    'VAT GRT Control': 'Auto',
  });
  const [infoForm, setInfoForm] = useState(emptyInfoForm());
  const [infoFormTab, setInfoFormTab] = useState('info');  // MARKER_BUSINESSUNIT_INFO_TABS_V3

  const BRANCH_FIELDS = ['Branch Code','Branch Direct','Branch Allocate','BU Code','Company for Show in Report Display','Simple Company','BU-TaxID','BU-Branch','Simple Brand Code','%','DB(%)','cpc','Branch Address','Group-P','bu','status','Inactive Date','updated_by','updated_at'];
  const BRANCH_KEY = 'Branch Code';
  // MARKER_BUSINESSUNIT_REMOVE_COMBO_MATCH_APCONTROLLER_V1 -- ตรงกับ APController.js (เอา ComboBox ออกหมด)
  const BRANCH_COMBO = [];
  // ── Pattern เดียวกับ APController.js (BRANCH_REQUIRED_KEYS/BRANCH_FIELD_COLOR) ──
  const BRANCH_REQUIRED_KEYS = ['Branch Code','status','Company for Show in Report Display','bu','Group-P','BU-TaxID','BU-Branch'];
  const BRANCH_FIELD_COLOR = {
    'Branch Code': '#FCF3D5', 'status': '#FCF3D5', 'Company for Show in Report Display': '#FCF3D5',
    'bu': '#FCF3D5', 'Group-P': '#FCF3D5', 'BU-TaxID': '#FCF3D5', 'BU-Branch': '#FCF3D5',
    '%': '#DCEAF1', 'Branch Direct': '#DCEAF1',
  };
  // MARKER_BUSINESSUNIT_ROWLAYOUT_PORT_V1 -- Layout Row เดียวกับ APController.js เป๊ะ
  const BRANCH_FORM_ROWS = [
    ['Branch Code', 'status'],
    ['Company for Show in Report Display'],
    ['bu', 'Group-P'],
    ['BU-TaxID', 'BU-Branch'],
    ['%', 'DB(%)'],
    ['Simple Company'],
    ['Simple Brand Code'],
    ['Branch Address'],
    ['BU Code', 'Branch Allocate'],
    ['cpc', 'Branch Direct'],
    ['Inactive Date'],
  ];
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
  // Fields that should span full width in Branch form
  const BRANCH_FULL_WIDTH = ['Branch Address','Company for Show in Report Display'];

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

  // ✅ Chunked Loading (guarded against duplicate concurrent calls)
  const fetchInfo = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && fetchInfoRef.current) return;
    fetchInfoRef.current = true;
    try {
      if (forceRefresh) invalidate('CompanyList');
      const data = await fetchCollection('CompanyList', forceRefresh);
      setInfoItems(data);
    } finally {
      fetchInfoRef.current = false;
    }
  }, [fetchCollection, invalidate]);

  // ✅ Chunked Loading (guarded against duplicate concurrent calls)
  const fetchBranch = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && fetchBranchRef.current) return;
    fetchBranchRef.current = true;
    try {
      if (forceRefresh) invalidate('BranchList');
      const data = await fetchCollection('BranchList', forceRefresh);
      setBranches(data);
    } finally {
      fetchBranchRef.current = false;
    }
  }, [fetchCollection, invalidate]);

  useEffect(() => { fetchInfo(); fetchBranch(); }, []);

  // ---------------- รับ Broadcast Real-time เวลา Company ถูกแก้จาก Tab/User อื่น ----------------
  useEffect(() => {
    const unsubscribe = subscribeWs(['company_list_updated'], () => {
      fetchInfo(true);
    });
    return unsubscribe;
  }, [fetchInfo]);
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
    const dataFields = allFields.filter(f => !['updated_by', 'updated_at'].includes(f));
    const existingMap = {};
    existingItems.forEach(item => {
      if (item[keyField]) existingMap[String(item[keyField]).trim()] = item;
    });
    const seenKeys = new Set();
    return rawRows.map(row => {
      const keyVal = String(row[keyField] ?? '').trim();
      if (!keyVal || seenKeys.has(keyVal)) return { ...row, _status: 'duplicate', _changes: [] };
      seenKeys.add(keyVal);
      const existing = existingMap[keyVal];
      if (!existing) return { ...row, _status: 'new', _changes: [] };
      const changes = [];
      dataFields.forEach(f => {
        const newVal = String(row[f] ?? '').trim();
        const oldVal = String(existing[f] ?? '').trim();
        if (newVal === '') return;
        if (newVal !== oldVal) changes.push({ field: f, old: oldVal, new: newVal });
      });
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
    // Auto-fill bu_code_name จาก SEGMENT3 - bu_name_full (ยกเว้น CHR/CHN)
    let autoForm = { ...form };
    const book = (autoForm['BOOK'] || '').trim().toUpperCase();
    if (!['CHR','CHN'].includes(book)) {
      const seg = (autoForm['SEGMENT3'] || '').trim();
      const nameF = (autoForm['bu_name_full'] || '').trim();
      if (seg && nameF && !autoForm['bu_code_name']?.trim()) {
        autoForm['bu_code_name'] = `${seg} - ${nameF}`;
      }
    }
    // MARKER_BUSINESSUNIT_IE_DEPARTMENT_DEFAULT_SAVE_V1 — ถ้ายังว่างตอน Save เติม "I-Expense" ก่อนส่งจริง
    if (!autoForm['IE Department'] || !autoForm['IE Department'].trim()) {
      autoForm['IE Department'] = 'I-Expense';
    }
    // MARKER_BUSINESSUNIT_INTEGER_FIELD_FIX_V17 — Column เหล่านี้เป็น integer ใน DB ส่ง Empty String ไม่ได้ ต้องเป็น null
    const INTEGER_FIELDS = ['ap_grt','ap_grn','ie_grt','ie_grn','vat_grn'];
    INTEGER_FIELDS.forEach(f => {
      if (autoForm[f] === '' || autoForm[f] === undefined) autoForm[f] = null;
    });
    const data = { ...autoForm, ...metaFields };
    if (infoEditId) {
      const { data: updated, error } = await db.from('company_list').update(data).eq('id', infoEditId).select().single();
      if (error) throw error;
      setInfoItems(prev => prev.map(i => i.id === infoEditId ? { ...i, ...updated } : i));
    } else {
      const { data: inserted, error } = await db.from('company_list').insert([data]).select().single();
      if (error) throw error;
      setInfoItems(prev => [...prev, inserted]);
    }
    broadcastWs('company_list_updated', { action: infoEditId ? 'update' : 'insert' }); // แจ้งทุก Browser ที่เปิดอยู่ให้ Update ทันที
    setShowInfoForm(false); setInfoEditId(null); setInfoForm(emptyInfoForm());
    await fetchInfo(true);
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
        const { error } = await db.from('branch_list').update({ '%': rateConfirmData.newRate, ...metaFields }).in('id', chunk);
        if (error) throw error;
        setBranches(prev => prev.map(b => chunk.includes(b.id) ? { ...b, '%': rateConfirmData.newRate } : b));
      }
      setShowRateConfirm(false); setRateConfirmData(null);
      await fetchInfo(true); await fetchBranch(true);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleInfoEdit = (item) => { const f = {}; INFO_EDIT.forEach(([k]) => { f[k] = item[k] || ''; }); setInfoForm(f); setInfoEditId(item.id); setShowInfoForm(true); setInfoFormTab('info'); };

  const handleInfoDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = infoItems.find(i => i.id === id);
      const { error: binError } = await db.from('recycle_bin').insert([{
        source_table: 'company_list', source_id: id, source_key: item?.['TAX ID'] || id, data: item,
        deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString()
      }]);
      if (binError) throw binError;
      const { error } = await db.from('company_list').delete().eq('id', id);
      if (error) throw error;
      setInfoItems(prev => prev.filter(i => i.id !== id));
      setInfoSelected(p => p.filter(s => s !== id));
      broadcastWs('company_list_updated', { action: 'delete', id }); // แจ้งทุก Browser ที่เปิดอยู่ให้ Update ทันที
      await fetchInfo(true);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleInfoBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${infoSelected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = infoItems.filter(i => infoSelected.includes(i.id)).map(item => ({
        source_table: 'company_list', source_id: item.id, source_key: item['TAX ID'] || item.id,
        data: item, deleted_by: userName || currentUser?.email || '', deleted_at: now,
      }));
      for (let i = 0; i < bins.length; i += 500) {
        const { error } = await db.from('recycle_bin').insert(bins.slice(i, i + 500));
        if (error) throw error;
      }
      for (let i = 0; i < infoSelected.length; i += 500) {
        const chunk = infoSelected.slice(i, i + 500);
        const { error } = await db.from('company_list').delete().in('id', chunk);
        if (error) throw error;
      }
      setInfoItems(prev => prev.filter(i => !infoSelected.includes(i.id)));
      setInfoSelected([]);
      broadcastWs('company_list_updated', { action: 'bulkDelete' }); // แจ้งทุก Browser ที่เปิดอยู่ให้ Update ทันที
      await fetchInfo(true);
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
          const { data: ins, error } = await db.from('company_list').insert(insertData.slice(i,i+500)).select();
          if (error) throw error;
          setInfoItems(prev => [...prev, ...ins]);
        }
      }
      for (const row of updateRows) {
        const existing = infoItems.find(i => i.id === row._existingId);
        const d = { ...existing };
        INFO_FIELDS.forEach(k => {
          if (k === 'updated_by') { d[k] = userName || currentUser?.email || ''; return; }
          if (k === 'updated_at') { d[k] = new Date().toISOString(); return; }
          const newVal = String(row[k] ?? '').trim();
          if (newVal !== '') d[k] = newVal;
        });
        const { data: upd, error } = await db.from('company_list').update(d).eq('id', row._existingId).select().single();
        if (error) throw error;
        setInfoItems(prev => prev.map(i => i.id === row._existingId ? { ...i, ...upd } : i));
      }
      setShowInfoPreview(false); setInfoPreviewRows([]);
      await fetchInfo(true);
      alert(`✅ Import สำเร็จ — New: ${newRows.length} / Update: ${updateRows.length}`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setInfoImporting(false);
  };

  const handleOpenDetail = (item) => { setBranchDetailItem(item); setBranchDetailForm(Object.fromEntries(BRANCH_EDIT.map(([k]) => [k, item[k] || '']))); setBranchDetailEditMode(false); setBranchDetailError(''); setShowBranchDetail(true); };

  const validateBranchForm = (form) => {
    for (const key of BRANCH_REQUIRED_KEYS) {
      if (!String(form[key] || '').trim()) return 'กรุณากรอกข้อมูลให้ครบตาม Required Field';
    }
    if (form['status'] === 'Closed' && !form['Inactive Date']) return 'กรุณากรอก Inactive Date เมื่อ Status เป็น Closed';
    if (form['status'] === 'Relocate' && !form['Branch Allocate']) return 'กรุณากรอก Branch Allocate เมื่อ Status เป็น Relocate';
    return '';
  };

  const handleBranchDetailSave = async () => {
    const err = validateBranchForm(branchDetailForm);
    if (err) { confirmDialog.alert(err, { variant: 'danger', title: 'กรอกข้อมูลไม่ครบ' }); return; }
    const data = { ...branchDetailForm, ...metaFields };
    const { data: updated, error } = await db.from('branch_list').update(data).eq('id', branchDetailItem.id).select().single();
    if (error) { confirmDialog.alert('บันทึกไม่สำเร็จ: ' + error.message, { variant: 'danger' }); return; }
    setBranches(prev => prev.map(b => b.id === branchDetailItem.id ? { ...b, ...updated } : b));
    setShowBranchDetail(false);
    await fetchBranch(true);
  };

  // MARKER_BUSINESSUNIT_APPLY_APCONTROLLER_STYLE_V1
  const handleBranchNewSave = async () => {
    const err = validateBranchForm(branchNewForm);
    if (err) { confirmDialog.alert(err, { variant: 'danger', title: 'กรอกข้อมูลไม่ครบ' }); return; }
    const dupBranch = branches.find(b => String(b['Branch Code'] || '').trim() === String(branchNewForm['Branch Code'] || '').trim());
    if (dupBranch) { confirmDialog.alert(`Branch Code "${branchNewForm['Branch Code']}" มีอยู่แล้วในระบบ`, { variant: 'danger', title: 'ซ้ำในระบบ' }); return; }
    const { data: inserted, error } = await db.from('branch_list').insert([{ ...branchNewForm, ...metaFields }]).select().single();
    if (error) { confirmDialog.alert('บันทึกไม่สำเร็จ: ' + error.message, { variant: 'danger' }); return; }
    setBranches(prev => [...prev, inserted]);
    setShowBranchNew(false); setBranchNewForm({});
    await fetchBranch(true);
  };

  const handleBranchDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = branches.find(b => b.id === id);
      const { error: binError } = await db.from('recycle_bin').insert([{
        source_table: 'branch_list', source_id: id, source_key: item?.['Branch Code'] || id, data: item,
        deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString()
      }]);
      if (binError) throw binError;
      const { error } = await db.from('branch_list').delete().eq('id', id);
      if (error) throw error;
      setBranches(prev => prev.filter(b => b.id !== id));
      setBranchSelected(p => p.filter(s => s !== id));
      await fetchBranch(true);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleBranchBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${branchSelected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = branches.filter(b => branchSelected.includes(b.id)).map(item => ({
        source_table: 'branch_list', source_id: item.id, source_key: item['Branch Code'] || item.id,
        data: item, deleted_by: userName || currentUser?.email || '', deleted_at: now,
      }));
      for (let i = 0; i < bins.length; i += 500) {
        const { error } = await db.from('recycle_bin').insert(bins.slice(i, i + 500));
        if (error) throw error;
      }
      for (let i = 0; i < branchSelected.length; i += 500) {
        const chunk = branchSelected.slice(i, i + 500);
        const { error } = await db.from('branch_list').delete().in('id', chunk);
        if (error) throw error;
      }
      setBranches(prev => prev.filter(b => !branchSelected.includes(b.id)));
      setBranchSelected([]);
      await fetchBranch(true);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const currentTable = () => tab === 'info' ? 'company_list' : 'branch_list';
  const currentLabel = () => tab === 'info' ? 'Info' : 'Branch';

  const handleOpenRecycleBin = async () => {
    setShowRecycleBin(true); setRecycleBinSelected([]); setRecycleBinLoading(true);
    try {
      const { data, error } = await db.from('recycle_bin').select('*').eq('source_table', currentTable()).order('deleted_at', { ascending: false });
      if (error) throw error;
      setRecycleBinItems(data || []);
    } catch (err) { alert('โหลด Recycle Bin ไม่สำเร็จ: ' + err.message); }
    setRecycleBinLoading(false);
  };

  const handleRestore = async (binItem) => {
    try {
      const data = { ...binItem.data }; delete data.id;
      const { error } = await db.from(binItem.source_table).insert([{ ...data, id: binItem.source_id }]);
      if (error) throw error;
      await db.from('recycle_bin').delete().eq('id', binItem.id);
      setRecycleBinItems(prev => prev.filter(i => i.id !== binItem.id));
      if (binItem.source_table === 'company_list') await fetchInfo(true); else await fetchBranch(true);
      alert(`✅ Restore สำเร็จ — ${binItem.source_key}`);
    } catch (err) { alert('Restore ไม่สำเร็จ: ' + err.message); }
  };

  const handlePermanentDelete = async (binItem) => {
    if (!window.confirm(`ลบถาวร "${binItem.source_key}"? ไม่สามารถกู้คืนได้`)) return;
    try {
      if (binItem.source_id) await db.from(binItem.source_table).delete().eq('id', binItem.source_id);
      await db.from('recycle_bin').delete().eq('id', binItem.id);
      setRecycleBinItems(prev => prev.filter(i => i.id !== binItem.id));
    } catch (err) { alert('ลบถาวรไม่สำเร็จ: ' + err.message); }
  };

  const handleBulkRestoreBin = async () => {
    if (!recycleBinSelected.length) return;
    setRecycleBinLoading2(true); setRecycleBinProgress(0);
    try {
      const targets = recycleBinItems.filter(b => recycleBinSelected.includes(b.id));
      const total = targets.length; let done = 0;
      const grouped = {};
      targets.forEach(item => { if (!grouped[item.source_table]) grouped[item.source_table] = []; grouped[item.source_table].push(item); });
      for (const [table, binItems] of Object.entries(grouped)) {
        for (let i = 0; i < binItems.length; i += 500) {
          const chunk = binItems.slice(i, i + 500);
          const rows = chunk.map(item => { const data = { ...item.data }; delete data.id; return { ...data, id: item.source_id }; });
          const { error } = await db.from(table).insert(rows);
          if (error) throw error;
          done += chunk.length; setRecycleBinProgress(Math.round((done / total) * 100));
        }
      }
      const binIds = targets.map(b => b.id);
      for (let i = 0; i < binIds.length; i += 500) {
        const { error } = await db.from('recycle_bin').delete().in('id', binIds.slice(i, i + 500));
        if (error) throw error;
      }
      setRecycleBinSelected([]);
      setRecycleBinItems(prev => prev.filter(b => !recycleBinSelected.includes(b.id)));
      await fetchInfo(true); await fetchBranch(true);
      alert(`✅ Restore สำเร็จ ${total} รายการ`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setRecycleBinLoading2(false); setRecycleBinProgress(0);
  };

  const handleBulkPermanentDeleteBin = async () => {
    if (!window.confirm(`ลบถาวร ${recycleBinSelected.length} รายการ? ไม่สามารถกู้คืนได้`)) return;
    setRecycleBinLoading2(true); setRecycleBinProgress(0);
    try {
      const targets = recycleBinItems.filter(b => recycleBinSelected.includes(b.id));
      const total = targets.length; let done = 0;
      const byTable = {};
      targets.forEach(item => { if (!byTable[item.source_table]) byTable[item.source_table] = []; byTable[item.source_table].push(item.source_id); });
      for (const [table, ids] of Object.entries(byTable)) {
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error } = await db.from(table).delete().in('id', chunk);
          if (error) throw error;
          done += chunk.length; setRecycleBinProgress(Math.round((done / total) * 100));
        }
      }
      const binIds = targets.map(b => b.id);
      for (let i = 0; i < binIds.length; i += 500) {
        const { error } = await db.from('recycle_bin').delete().in('id', binIds.slice(i, i + 500));
        if (error) throw error;
      }
      setRecycleBinSelected([]);
      setRecycleBinItems(prev => prev.filter(b => !recycleBinSelected.includes(b.id)));
      alert(`✅ ลบถาวรสำเร็จ ${total} รายการ`);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    setRecycleBinLoading2(false); setRecycleBinProgress(0);
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
          const { data: ins, error } = await db.from('branch_list').insert(insertData.slice(i,i+500)).select();
          if (error) throw error;
          setBranches(prev => [...prev, ...ins]);
        }
      }
      for (const row of updateRows) {
        const existing = branches.find(b => b.id === row._existingId);
        const d = { ...existing };
        BRANCH_FIELDS.forEach(k => {
          if (k === 'updated_by') { d[k] = userName || currentUser?.email || ''; return; }
          if (k === 'updated_at') { d[k] = new Date().toISOString(); return; }
          const newVal = String(row[k] ?? '').trim();
          if (newVal !== '') d[k] = newVal;
        });
        const { data: upd, error } = await db.from('branch_list').update(d).eq('id', row._existingId).select().single();
        if (error) throw error;
        setBranches(prev => prev.map(b => b.id === row._existingId ? { ...b, ...upd } : b));
      }
      setShowBranchPreview(false); setBranchPreviewRows([]);
      await fetchBranch(true);
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
    input: { padding:'5px 8px', borderRadius:'5px', border:'0.5px solid #d0d0d0', fontSize:'12px', width:'100%', marginBottom:'0', boxSizing:'border-box', height:'30px', background:'white', color:'#222' },
    inputDisabled: { padding:'5px 8px', borderRadius:'5px', border:'0.5px solid #e8e8e8', fontSize:'12px', width:'100%', marginBottom:'0', boxSizing:'border-box', background:'#f5f5f5', color:'#999', height:'30px' },
    inputReadonly: { padding:'5px 8px', borderRadius:'5px', border:'0.5px solid #e8e8e8', fontSize:'12px', width:'100%', marginBottom:'0', boxSizing:'border-box', background:'#fafafa', color:'#333', height:'30px', display:'flex', alignItems:'center' },
    overlay: { position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 },
    // ✅ modal — auto height, no scroll needed with compact layout
    // MARKER_BUSINESSUNIT_MODAL_HEIGHT_MATCH_APCONTROLLER_V1
    modal: { background:'white', borderRadius:'10px', width:isMobile?'95vw':'900px', maxWidth:'96vw', height:isMobile?'92vh':'88vh', display:'flex', flexDirection:'column', overflow:'hidden' },
    modalMd: { background:'white', borderRadius:'10px', width:isMobile?'95vw':'700px', maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column' }, // MARKER_BUSINESSUNIT_INFO_MODAL_HEIGHT_V2
    pageBtn: (active,disabled) => ({ padding:'3px 7px', borderRadius:'5px', border:'0.5px solid #ddd', fontSize:'11px', cursor:disabled?'default':'pointer', background:active?'#1a3a5c':'white', color:disabled?'#ccc':active?'white':'#555', minWidth:'26px', textAlign:'center' }),
    iconBtn: (color,bg,border) => ({ background:bg||'none', border:`0.5px solid ${border||color}`, borderRadius:'4px', cursor:'pointer', padding:'3px 6px', color, fontSize:'12px', lineHeight:1 }),
  };

  const renderInfoText = () => {
    if(tab==='info'){if(isMobile)return`${filteredInfo.length} รายการ`;return`ทั้งหมด ${infoItems.length} รายการ${infoSearch?` | ผลการค้นหา ${filteredInfo.length} รายการ`:''}${infoSelected.length>0?` | เลือกอยู่ ${infoSelected.length} รายการ`:''}` }
    if(isMobile)return`${filteredBranch.length} รายการ`;
    if(isTablet)return`${branches.length} รายการ${branchTaxFilter?' | Filter Tax ID':''}`;
    return`ทั้งหมด ${branches.length} รายการ${branchTaxFilter?` | Filter Tax ID: ${branchTaxFilter} (${filteredBranch.length} รายการ)`:branchSearch?` | ผลการค้นหา ${filteredBranch.length} รายการ`:''}${branchSelected.length>0?` | เลือกอยู่ ${branchSelected.length} รายการ`:''}`;
  };

  // ✅ Branch form — compact 4-col layout, one page no scroll
  // Layout map: [key, label, colSpan]
  const BRANCH_LAYOUT = isMobile ? [
    ['Branch Code','Branch Code *',1],['Branch Direct','Branch Direct',1],
    ['Branch Allocate','Branch Allocate',1],['BU Code','BU Code',1],
    ['Company for Show in Report Display','Company for Report',2],
    ['Simple Company','Simple Company',1],['BU-TaxID','BU Tax ID',1],
    ['BU-Branch','BU Branch',1],['Simple Brand Code','Simple Brand Code',1],
    ['%','%',1],['DB(%)','DB(%)',1],['cpc','CPC',1],
    ['Branch Address','Branch Address',2],
    ['Group-P','Group-P',1],['bu','BU',1],
    ['status','Status',1],['Inactive Date','Inactive Date',1],
  ] : [
    ['Branch Code','Branch Code',1],['BU Code','BU Code',1],['BU-Branch','BU Branch',1],['cpc','CPC',1],
    ['Branch Direct','Branch Direct',1],['Branch Allocate','Branch Allocate',1],['Group-P','Group-P',1],['bu','BU',1],
    ['Company for Show in Report Display','Company for Report',2],['Simple Company','Simple Company',2],
    ['BU-TaxID','BU Tax ID',2],['Simple Brand Code','Simple Brand Code',2],
    ['%','%',1],['DB(%)','DB(%)',1],['status','Status',1],['Inactive Date','Inactive Date',1],
    ['Branch Address','Branch Address',4],
  ];

  const renderBranchFormFields = (form, setForm, error, setError, editMode=true) => {
    // ── Auto-Fill Branch Direct = BU + "-" + BU-Branch (Pad 5 หลัก) ตอน Blur ──
    const handleBuBranchBlur = () => {
      const buVal = String(form['bu'] || '').trim();
      const branchValRaw = String(form['BU-Branch'] || '').trim();
      if (!branchValRaw) return;
      const padded = branchValRaw.padStart(5, '0');
      setForm({
        ...form,
        'BU-Branch': padded,
        'Branch Direct': buVal ? `${buVal}-${padded}` : form['Branch Direct'],
      });
    };
    // MARKER_BUSINESSUNIT_PORT_BLUR_AUTOFILL_DUP_V1
    // ── Port จาก APController.js: Auto-Fill จาก Head Office Lookup ──────────
    const handleBranchCodeBlur = () => {
      const code = String(form['Branch Code'] || '').trim();
      if (code.length < 3) return;
      const hoCode = code.slice(0, -2) + '01';
      const match = branches.find(b => String(b['Branch Code'] || '').trim() === hoCode);
      if (!match) return;
      setForm(f => ({
        ...f,
        'bu': String(f['bu'] || '').trim() ? f['bu'] : (match['bu'] || ''),
        'Group-P': String(f['Group-P'] || '').trim() ? f['Group-P'] : (match['Group-P'] || ''),
        'BU-TaxID': String(f['BU-TaxID'] || '').trim() ? f['BU-TaxID'] : (match['BU-TaxID'] || ''),
        '%': String(f['%'] || '').trim() ? f['%'] : (match['%'] || ''),
        'Simple Company': String(f['Simple Company'] || '').trim() ? f['Simple Company'] : (match['Simple Company'] || ''),
      }));
    };
    // ── Port จาก APController.js: Auto-Fill จาก Company Name ที่ตรงกัน ───────
    const handleCompanyBlur = () => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const rawName = String(form['Company for Show in Report Display'] || '').trim();
      const name = norm(rawName);
      const branchCodeVal = String(form['Branch Code'] || '').trim();
      const match = name ? branches.find(b => norm(b['Company for Show in Report Display']) === name) : null;
      setForm(f => {
        const next = { ...f };
        if (match) {
          next['bu'] = String(f['bu'] || '').trim() ? f['bu'] : (match['bu'] || '');
          next['Group-P'] = String(f['Group-P'] || '').trim() ? f['Group-P'] : (match['Group-P'] || '');
          next['BU-TaxID'] = String(f['BU-TaxID'] || '').trim() ? f['BU-TaxID'] : (match['BU-TaxID'] || '');
          next['%'] = String(f['%'] || '').trim() ? f['%'] : (match['%'] || '');
          next['Simple Company'] = String(f['Simple Company'] || '').trim() ? f['Simple Company'] : (match['Simple Company'] || '');
        }
        if (!String(f['Simple Brand Code'] || '').trim() && branchCodeVal && rawName) {
          next['Simple Brand Code'] = `${branchCodeVal}-${rawName}`;
        }
        return next;
      });
      handleBranchCodeBlur();
    };
    // MARKER_BRANCHCODE_PASTE_EXCEL_AUTOFILL_V1
    // ── วาง 1 แถวที่ Copy มาจาก Excel (Copy_of_Seg4_All_BU.xlsx Format) ──────
    // ── ที่ช่อง Branch Code -> Detect ว่ามี Tab คั่น (Multi-Column) หรือไม่ ──
    // ── ถ้าใช่ Auto-Fill Branch Code/Company/BU Branch/Address ให้ทันที ──────
    const handlePasteBranchRow = (e) => {
      const clip = e.clipboardData || window.clipboardData;
      const raw = clip ? clip.getData('text') : '';
      if (!raw || !raw.includes('\t')) return; // ไม่ใช่ Multi-Column -> Paste ปกติ
      e.preventDefault();
      const cols = raw.split('\n')[0].split('\t');
      const branchCode = (cols[1] || '').trim();
      const company = (cols[2] || '').trim();
      const buBranchRaw = (cols[5] || '').trim();
      const address = (cols[6] || '').trim();
      // MARKER_BRANCHPASTE_PREVIEW_POPUP_V1
      // ── เปิด Popup Preview ให้แก้ไขได้ก่อน แทนที่จะ setForm เข้าฟอร์มตรงๆ ──────
      setBranchPastePreview({
        branchCode, company, buBranch: buBranchRaw, address,
        applyTo: setForm, currentForm: form,
      });
    };
    return (
      <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
        {BRANCH_FORM_ROWS.map((rowKeys, ri) => (
          <div key={ri} style={{ display: 'flex', marginBottom: '8px', position: 'relative' }} /* MARKER_BRANCHFORM_FIX_ROW_ZINDEX_TRAP_V1 */>
            {rowKeys.map((key, ki) => {
              const label = (BRANCH_LAYOUT.find(([k]) => k === key) || [null, key])[1];
              const needInactive = key === 'Inactive Date';
              const isDisabled = needInactive && form['status'] !== 'Closed';
              const isReq = BRANCH_REQUIRED_KEYS.includes(key) || (key === 'Inactive Date' && form['status'] === 'Closed') || (key === 'Branch Allocate' && form['status'] === 'Relocate');
              const hasErr = !!(error && isReq && !form[key]);
              const isFullRow = rowKeys.length === 1;
              const bg = needInactive ? '#eef1f3' : (BRANCH_FIELD_COLOR[key] || '#fff');
              const valueColor = BRANCH_FIELD_COLOR[key] ? '#5c5636' : '#333';
              const labelCellStyle = { flex: isFullRow ? '0 0 160px' : (ki === 0 ? '0 0 160px' : '0 0 120px'), border: hasErr ? '1px dashed #e74c3c' : '1px dashed #2c5f7c', marginLeft: ki === 0 ? 0 : '-1px', padding: '8px 10px', display: 'flex', alignItems: key === 'Branch Address' ? 'flex-start' : 'center', paddingTop: key === 'Branch Address' ? '10px' : '8px', opacity: isDisabled ? 0.6 : 1, boxSizing: 'border-box', position: 'relative', zIndex: ki * 2 };
              const valueCellStyle = { flex: 1, background: editMode ? bg : '#fafbfc', border: hasErr ? '1px dashed #e74c3c' : '1px dashed #2c5f7c', marginLeft: '-1px', padding: '8px 10px', display: 'flex', alignItems: 'center', minHeight: key === 'Branch Address' ? '56px' : undefined, opacity: isDisabled ? 0.7 : 1, boxSizing: 'border-box', position: 'relative', zIndex: ki * 2 + 1 };
              const inputBare = { width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: isDisabled ? '#999' : valueColor, outline: 'none', padding: 0, fontFamily: 'inherit' };
              return (
                <React.Fragment key={key}>
                  <div style={labelCellStyle}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: hasErr ? '#e74c3c' : '#123c56' }}>
                      {label}{isReq && <span style={{ color: '#e24b4a' }}> *</span>}
                      {needInactive && <span style={{ fontSize: '10px', color: '#bbb', fontWeight: 400 }}> (เฉพาะ Closed)</span>}
                    </span>
                  </div>
                  <div style={valueCellStyle}>
                    {editMode ? (
                      key === 'Inactive Date' ? (
                        <input type="date" disabled={isDisabled} value={form[key] || ''} onChange={e => { setForm({ ...form, [key]: e.target.value }); setError(''); }} style={inputBare} />
                      ) : key === 'Branch Address' ? (
                        <textarea value={form[key] || ''} onChange={e => { setForm({ ...form, [key]: e.target.value }); setError(''); }} style={{ ...inputBare, height: '36px', resize: 'vertical' }} />
                      ) : key === 'status' ? (
                        <StatusDropdown value={form[key] || ''} onChange={val => { setForm({ ...form, [key]: val }); setError(''); }} options={['Active', 'Closed', 'Relocate', 'Temporary']} style={{ ...inputBare, fontWeight: 600 }} />
                      ) : key === 'Branch Direct' ? (
                        <input value={form[key] || ''} readOnly style={{ ...inputBare, color: '#999' }} />
                      ) : BRANCH_COMBO.includes(key) ? (
                        <ComboBox value={form[key] || ''} onChange={val => { setForm({ ...form, [key]: val }); setError(''); }} options={getBranchOptions(key)} placeholder={`เลือก ${label}`} />
                      ) : (
                        <input value={form[key] || ''} onChange={e => { setForm({ ...form, [key]: e.target.value }); setError(''); }} onBlur={key === 'BU-Branch' ? handleBuBranchBlur : key === 'Branch Code' ? handleBranchCodeBlur : key === 'Company for Show in Report Display' ? handleCompanyBlur : undefined} onPaste={key === 'Branch Code' ? handlePasteBranchRow : undefined} style={inputBare} />
                      )
                    ) : (
                      <span style={{ ...inputBare, color: '#333' }}>{key === 'status' ? statusBadge(form[key]) : (form[key] || '-')}</span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // MARKER_BUSINESSUNIT_INFO_FORM_REDESIGN_V1
  const VAT_STATUS_OPTIONS = [
    { label: 'Active', bg: '#EAF3DE', color: '#27500A' },
    { label: 'Inactive', bg: '#F1EFE8', color: '#444441' },
    { label: 'Unclaim', bg: '#FAEEDA', color: '#854F0B' },
    { label: 'Out of Scope', bg: '#E6F1FB', color: '#0C447C' },
  ];

  const INFO_ROWS = isMobile ? [
    [['bu','BU'],['TAX ID','Tax ID']],
    [['COMPANY CODE','Company Code'],['BOOK','Book']],
    [['THAI COMPANY NAME','Thai Company Name']],
    [['ENGLISH COMPANY NAME','English Company Name']],
    // MARKER_BUSINESSUNIT_ADD_BASE_FIELD_V20
    [['bu_code_name','BU Code Name'],['system_bank','System Bank']],
    [['VAT %','VAT %'],['Last Rate (%)','Last Rate (%)']],
    [['SEGMENT3','Segment3'],['base','Base']],
  ] : [
    [['bu','BU'],['TAX ID','Tax ID'],['COMPANY CODE','Company Code'],['BOOK','Book']],
    [['THAI COMPANY NAME','Thai Company Name']],
    [['ENGLISH COMPANY NAME','English Company Name']],
    [['bu_code_name','BU Code Name'],['system_bank','System Bank']],
    [['VAT %','VAT %'],['Last Rate (%)','Last Rate (%)'],['SEGMENT3','Segment3'],['base','Base']],
  ];

  const renderInfoFormFields = () => {
    const boxWrap = { border:'0.5px solid #e8eaf0', borderRadius:'6px', overflow:'hidden', marginBottom:'6px' };
    const headCell = (isLast) => ({ padding:'3px 8px', fontSize:'11px', color:'#888', background:'#f8f9fa', fontWeight:'600', textAlign:'center', borderRight: isLast?'none':'0.5px solid #e8eaf0', borderBottom:'0.5px solid #e8eaf0' });
    const inputCell = (isLast) => ({ padding:'3px 6px', display:'flex', alignItems:'center', minHeight:'28px', borderRight: isLast?'none':'0.5px solid #e8eaf0' });

    const renderFieldInput = (key, label) => (
      key === 'bu_code_name' ? (
        <input style={{ height:'28px', padding:'0 8px', fontSize:'12px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box', textAlign:'center' }}
          value={infoForm[key]||''}
          placeholder={`${infoForm['SEGMENT3']||'Segment3'} - ${infoForm['ENGLISH COMPANY NAME']||'English Company Name'}`}
          onChange={e=>setInfoForm({...infoForm,[key]:e.target.value})}
          onBlur={e=>{
            if(!e.target.value.trim()){
              const seg=(infoForm['SEGMENT3']||'').trim();
              const eng=(infoForm['ENGLISH COMPANY NAME']||'').trim();
              if(seg||eng) setInfoForm(f=>({...f,[key]:[seg,eng].filter(Boolean).join(' - ')}));
            }
          }}
        />
      ) : INFO_COMBO.includes(key) ? (
        <ComboBox value={infoForm[key]||''} onChange={val=>setInfoForm({...infoForm,[key]:val})} options={getInfoOptions(key)} placeholder={`เลือก ${label}`} bare/>
      ) : (
        // MARKER_BUSINESSUNIT_IE_DEPARTMENT_DEFAULT_V1 — IE Department ว่างเปล่า -> โชว์ "I-Expense" แทน
        <input style={{ height:'28px', padding:'0 8px', fontSize:'12px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box', textAlign:'center' }} value={infoForm[key] || (key === 'IE Department' ? 'I-Expense' : '')} onChange={e=>setInfoForm({...infoForm,[key]:e.target.value})}/>
      )
    );

    const renderRowBox = (fields) => (
      <div style={{ ...boxWrap, display:'grid', gridTemplateColumns:`repeat(${fields.length}, 1fr)` }}>
        {fields.map(([key,label], i) => <div key={key+'_h'} style={headCell(i===fields.length-1)}>{label}</div>)}
        {fields.map(([key,label], i) => <div key={key+'_i'} style={inputCell(i===fields.length-1)}>{renderFieldInput(key,label)}</div>)}
      </div>
    );

    const miniInputStyle = { height:'26px', padding:'0 6px', fontSize:'11px', border:'none', outline:'none', background:'transparent', color:'#1a3a5c', width:'100%', boxSizing:'border-box' };

    // MARKER_BUSINESSUNIT_GRT_GRN_DEFAULT_ZERO_V1
    // ── Default "0" เมื่อไม่มีข้อมูล เฉพาะ Field ตัวเลข Counter ──────────────
    // ── ใช้ != null แทน || กัน Bug ค่า 0 จริงโดนเบลอเป็นค่าว่าง (0 || '' = '') ──
    // MARKER_BUSINESSUNIT_INTEGERFIELDS_SCOPE_FIX_V1
    // ── ประกาศแยก เพราะตัวเดิม (ใน doInfoSave) อยู่คนละ Scope เข้าไม่ถึงจากตรงนี้ ──
    const RENDER_INTEGER_FIELDS = ['ap_grt', 'ap_grn', 'ie_grt', 'ie_grn', 'vat_grn'];
    const renderPairBox = (patKey, patLabel, valKey, valLabel) => {
      const valDefault = RENDER_INTEGER_FIELDS.includes(valKey) ? 0 : '';
      const valDisplay = infoForm[valKey] != null && infoForm[valKey] !== '' ? infoForm[valKey] : valDefault;
      return (
      <div style={{ ...boxWrap, marginBottom:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
          <div style={headCell(false)}>{patLabel}</div>
          <div style={headCell(true)}>{valLabel}</div>
          <div style={inputCell(false)}><input style={miniInputStyle} value={infoForm[patKey]||''} onChange={e=>setInfoForm({...infoForm,[patKey]:e.target.value})}/></div>
          <div style={inputCell(true)}><input style={miniInputStyle} value={valDisplay} onChange={e=>setInfoForm({...infoForm,[valKey]:e.target.value})}/></div>
        </div>
      </div>
      );
    };

    const renderDigitBox = (key, label) => (
      <div style={{ ...boxWrap, marginBottom:0 }}>
        <div style={headCell(true)}>{label}</div>
        <div style={inputCell(true)}><input style={miniInputStyle} value={infoForm[key]||''} onChange={e=>setInfoForm({...infoForm,[key]:e.target.value})}/></div>
      </div>
    );

    // MARKER_BUSINESSUNIT_TAXTYPE_MOVE_VAT_V5
    // MARKER_BUSINESSUNIT_STATUS_NORMALIZE_V1
    // ── Normalize ก่อนเทียบ รองรับทั้ง "Out of Scope" และ "out_of_scope" (จาก VatController.js) ──
    const normalizeVatWatchlistStatus = (s) => (s || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
    const renderStatusBox = () => {
      const current = infoForm['vat_watchlist_status'] || 'Active';
      const idx = VAT_STATUS_OPTIONS.findIndex(s => normalizeVatWatchlistStatus(s.label) === normalizeVatWatchlistStatus(current));
      const opt = VAT_STATUS_OPTIONS[idx >= 0 ? idx : 0];
      const cycleStatus = () => {
        const next = VAT_STATUS_OPTIONS[((idx >= 0 ? idx : 0) + 1) % VAT_STATUS_OPTIONS.length];
        setInfoForm({ ...infoForm, vat_watchlist_status: next.label });
      };
      return (
        <div style={{ ...boxWrap, marginBottom:0 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
            <div style={headCell(false)}>Status</div>
            <div style={headCell(true)}>Tax Type</div>
            <div style={{ padding:'4px 5px', display:'flex', alignItems:'center', justifyContent:'center', borderRight:'0.5px solid #e8eaf0' }}>
              <button type="button" onClick={cycleStatus} style={{ border:'none', cursor:'pointer', fontSize:'11px', fontWeight:'600', padding:'4px 10px', borderRadius:'20px', width:'100%', textAlign:'center', background:opt.bg, color:opt.color }}>{opt.label}</button>
            </div>
            <div style={inputCell(true)}>
              <input style={miniInputStyle} value={infoForm['allowed_tax_type']||''} onChange={e=>setInfoForm({...infoForm, allowed_tax_type:e.target.value})}/>
            </div>
          </div>
        </div>
      );
    };

    // MARKER_BUSINESSUNIT_GRTCONTROL_BADGE_V6
    const settingSection = (title, permNote, borderColor, titleColor, children, gridCols) => (
      <React.Fragment>
        <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 0 6px 4px', borderLeft:`3px solid ${borderColor}`, marginBottom:'6px' }}>
          <span style={{ fontSize:'12px', fontWeight:'600', color:titleColor }}>{title}</span>
          <span style={{ fontSize:'10px', color:'#999' }}>— {permNote}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : (gridCols || '1.4fr 1.4fr 1fr'), gap:'8px', marginBottom:'12px' }}>
          {children}
        </div>
      </React.Fragment>
    );

    // MARKER_BUSINESSUNIT_SETTING_CONSOLIDATED_V16
    const renderGrtControlBox = (fieldKey, label, defaultValue = '') => {
      const grtOptions = ['Manual','Semi-Auto','Auto'];
      const current = infoForm[fieldKey] || defaultValue;
      return (
        <div style={{ ...boxWrap, marginBottom:0 }}>
          <div style={headCell(true)}>{label}</div>
          <div style={{ padding:'4px 5px', display:'flex', gap:'3px', justifyContent:'center' }}>
            {grtOptions.map(opt => (
              <button key={opt} type="button" onClick={()=>setInfoForm({...infoForm, [fieldKey]: opt})}
                style={{ border:'none', cursor:'pointer', fontSize:'9.5px', fontWeight:'600', padding:'4px 4px', borderRadius:'12px', flex:1, background: current===opt ? '#1a3a5c' : '#f0f0f0', color: current===opt ? '#fff' : '#888' }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    };

    // MARKER_BUSINESSUNIT_GRTCONTROL_BADGE_V6
    // MARKER_BUSINESSUNIT_INFO_TABS_V3
    const hasSettingPerm = userPermissions?.Manual || userPermissions?.IE || userPermissions?.VAT || isOwner;
    const tabBtn = (key, label) => (
      <button type="button" onClick={()=>setInfoFormTab(key)} style={{ padding:'9px 14px', fontSize:'12px', fontWeight:'600', border:'none', background:'transparent', cursor:'pointer', borderBottom: infoFormTab===key ? '2px solid #1a3a5c' : '2px solid transparent', color: infoFormTab===key ? '#1a3a5c' : '#999' }}>{label}</button>
    );
    return (
      <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
        <div style={{ padding:'10px 16px 0', display:'flex', gap:'4px', borderBottom:'1px solid #f0f0f0', flexShrink:0 }}>
          {tabBtn('info','Company info')}
          {hasSettingPerm && tabBtn('setting','Setting')}
        </div>
        <div style={{ padding:'14px 16px 16px', overflowY:'auto', flex:1, minHeight:'420px' }}>
          {infoFormTab === 'info' && (
            <div>
              {INFO_ROWS.map((row, ri) => <div key={ri}>{renderRowBox(row)}</div>)}
              <VatWatchlistBuGroupRangeSection currentBu={infoForm.bu} />
            </div>
          )}

          {infoFormTab === 'setting' && (
            <div>
              {/* MARKER_BUSINESSUNIT_SETTING_CONSOLIDATED_V16 */}
              {(userPermissions?.Manual || isOwner) && (
                <React.Fragment>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 0 6px 4px', borderLeft:'3px solid #378ADD', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', fontWeight:'600', color:'#0c447c' }}>AP Setting</span>
                    <span style={{ fontSize:'10px', color:'#999' }}>— Manual permission</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'8px' }}>
                    {renderGrtControlBox('AP GRT Control', 'GRT Control')}
                    {renderRowBox([['AP Prepare By','Prepare By']])}
                    {renderRowBox([['AP Department','Department']])}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'12px' }}>
                    {renderPairBox('ap_grt_pattern','GRT Pattern','ap_grt','GRT')}
                    {renderPairBox('ap_grn_pattern','GRN Pattern','ap_grn','GRN')}
                    {renderDigitBox('ap_digit','Digit')}
                  </div>
                </React.Fragment>
              )}

              {(userPermissions?.IE || isOwner) && (
                <React.Fragment>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 0 6px 4px', borderLeft:'3px solid #7F77DD', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', fontWeight:'600', color:'#3c3489' }}>IE Setting</span>
                    <span style={{ fontSize:'10px', color:'#999' }}>— IE permission</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'8px' }}>
                    {renderGrtControlBox('IE GRT Control', 'GRT Control', 'Auto')}
                    {renderRowBox([['IE Prepare By','Prepare By']])}
                    {renderRowBox([['IE Department','Department']])}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'12px' }}>
                    {renderPairBox('ie_grt_pattern','GRT Pattern','ie_grt','GRT')}
                    {renderPairBox('ie_grn_pattern','GRN Pattern','ie_grn','GRN')}
                    {renderDigitBox('ie_digit','Digit')}
                  </div>
                </React.Fragment>
              )}

              {/* MARKER_BUSINESSUNIT_VAT_ROW_REORG_V7 */}
              {(userPermissions?.VAT || isOwner) && (
                <React.Fragment>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 0 6px 4px', borderLeft:'3px solid #1D9E75', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', fontWeight:'600', color:'#085041' }}>VAT Setting</span>
                    <span style={{ fontSize:'10px', color:'#999' }}>— VAT permission</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'8px' }}> {/* MARKER_BUSINESSUNIT_VAT_TOPROW_RATIO_V10 */}
                    {renderGrtControlBox('VAT GRT Control', 'GRT Control', 'Auto')}
                    {renderRowBox([['PREPARE BY','Prepare By']])}
                    {renderRowBox([['DEPARTMENT','Department']])}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1.4fr 1fr', gap:'8px', marginBottom:'12px' }}>
                    {renderStatusBox()}
                    {renderPairBox('vat_grn_pattern','GRN Pattern','vat_grn','GRN')}
                    {renderDigitBox('vat_digit','Digit')}
                  </div>
                </React.Fragment>
              )}
            </div>
          )}

          <div style={{ marginTop:'4px' }}>
            <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'3px' }}>Updated By</label>
            <input style={S.inputDisabled} value={userName||currentUser?.email||''} disabled/>
          </div>
        </div>
      </div>
    );
  };

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
        {isEditor && (
          <div style={{ display:'flex', alignItems:'center', gap: isMobile?'4px':'0' }}>
            {isAdmin && <button style={{...S.btn, background:'#f5f5f5', color:'#555', border:'0.5px solid #ddd'}} onClick={handleOpenRecycleBin}>🗑️{!isMobile && ' Recycle Bin'}</button>}
            {tab === 'info' ? <>
              <button style={{...S.btn, background:'#0F6E56', color:'white'}} onClick={handleInfoDownloadTemplate}>⬇{!isMobile && ' Template'}</button>
              <button style={{...S.btn, background:'#5DCAA5', color:'#1a3a5c'}} onClick={() => infoFileRef.current.click()}>📂{!isMobile && ' Import'}</button>
              <input ref={infoFileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleInfoFileChange} />
              <button style={{...S.btn, background:'#1a3a5c', color:'white'}} onClick={() => { setShowInfoForm(true); setInfoEditId(null); setInfoForm(emptyInfoForm()); setInfoFormTab('info'); }}>+ New</button>
            </> : <>
              <button style={{...S.btn, background:'#0F6E56', color:'white'}} onClick={handleBranchDownloadTemplate}>⬇{!isMobile && ' Template'}</button>
              <button style={{...S.btn, background:'#5DCAA5', color:'#1a3a5c'}} onClick={() => branchFileRef.current.click()}>📂{!isMobile && ' Import'}</button>
              <input ref={branchFileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleBranchFileChange} />
              <button style={{...S.btn, background:'#1a3a5c', color:'white'}} onClick={() => { setShowBranchNew(true); setBranchNewForm(Object.fromEntries(BRANCH_EDIT.map(([k]) => [k, '']))); setBranchNewError(''); }}>+ New</button>
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
            <input placeholder='Search...' value={infoSearch} onChange={e=>setInfoSearch(e.target.value)} style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width:isMobile?'100%':isTablet?'180px':'240px' }}/>
          ):(
            <>
              <input placeholder='Search...' value={branchSearch} onChange={e=>{setBranchSearch(e.target.value);setBranchTaxFilter('');}} style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width:isMobile?'100%':isTablet?'180px':'240px' }}/>
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
          <div ref={tbodyRef} style={S.tbodyWrap} className="table-scroll" onScroll={syncScroll}>
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

      {/* ─── Info Form Modal ─── */}
      {showInfoForm&&(
        <div style={S.overlay}>
          <div style={S.modalMd}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <h3 style={{ fontSize:'15px', margin:0 }}>{infoEditId?'✏️ Edit Info':'+ New Info'}</h3>
              <div style={{ display:'flex', gap:'8px' }}>
                <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setShowInfoForm(false)}>Cancel</button>
                <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleInfoSave}>Save</button>
              </div>
            </div>
            {renderInfoFormFields()}
          </div>
        </div>
      )}

      {/* ─── Branch Detail Modal ─── */}
      {showBranchDetail&&branchDetailItem&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={{ fontSize:'14px', fontWeight:'500' }}>{branchDetailEditMode?'✏️ Edit Branch':`🔍 ${branchDetailItem['Branch Code']||'Branch Detail'}`}</span>
                {!branchDetailEditMode&&isEditor&&<button onClick={()=>setBranchDetailEditMode(true)} style={{ padding:'3px 10px', borderRadius:'5px', border:'1px solid #1a3a5c', background:'white', color:'#1a3a5c', fontSize:'12px', cursor:'pointer' }}>✏️ Edit</button>}
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                {branchDetailEditMode?(
                  <>
                    <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>{setBranchDetailEditMode(false);setBranchDetailError('');setBranchDetailForm(Object.fromEntries(BRANCH_EDIT.map(([k])=>[k,branchDetailItem[k]||''])));}}>Cancel</button>
                    <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleBranchDetailSave}>Save</button>
                  </>
                ):(
                  <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setShowBranchDetail(false)}>Close</button>
                )}
              </div>
            </div>
            {renderBranchFormFields(branchDetailForm,setBranchDetailForm,branchDetailError,setBranchDetailError,branchDetailEditMode)}
            {!branchDetailEditMode&&(
              <div style={{ padding:'8px 16px 14px', borderTop:'0.5px solid #f0f0f0', flexShrink:0 }}>
                <div style={{ display:'flex', gap:'16px', paddingTop:'8px' }}>
                  <div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Updated By</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{branchDetailItem['updated_by']||'-'}</div></div>
                  <div style={{ flex:1 }}><div style={{ fontSize:'11px', color:'#888' }}>Updated At</div><div style={{ fontSize:'12px', color:'#555', marginTop:'2px' }}>{formatLastUpdate(branchDetailItem['updated_at'])}</div></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── New Branch Modal ─── */}
      {showBranchNew&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <h3 style={{ fontSize:'15px', margin:0 }}>+ New Branch</h3>
              <div style={{ display:'flex', gap:'8px' }}>
                <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>{setShowBranchNew(false);setBranchNewForm({});setBranchNewError('');}}>Cancel</button>
                <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleBranchNewSave}>Save</button>
              </div>
            </div>
            {renderBranchFormFields(branchNewForm,setBranchNewForm,branchNewError,setBranchNewError,true)}
          </div>
        </div>
      )}

      {/* MARKER_BRANCHPASTE_PREVIEW_POPUP_V1 */}
      {branchPastePreview&&(
        <div style={{...S.overlay,zIndex:1100}}>
          <div style={{ background:'white', borderRadius:'12px', width:isMobile?'92vw':'440px', padding:'22px' }}>
            <h3 style={{ fontSize:'15px', margin:'0 0 4px' }}>ตรวจสอบข้อมูลก่อนนำเข้า</h3>
            <div style={{ fontSize:'11px', color:'#888', marginBottom:'16px' }}>แก้ไขค่าได้ก่อนกด "ยืนยัน"</div>
            {[
              ['branchCode', 'Branch Code'],
              ['company', 'Company for Report'],
              ['buBranch', 'BU Branch'],
              ['address', 'Branch Address'],
            ].map(([k, label]) => (
              <div key={k} style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>{label}</label>
                {k === 'address' ? (
                  <textarea value={branchPastePreview[k] || ''} onChange={e => setBranchPastePreview(p => ({ ...p, [k]: e.target.value }))} style={{ ...S.input, height: '60px', resize: 'vertical' }} />
                ) : (
                  <input value={branchPastePreview[k] || ''} onChange={e => setBranchPastePreview(p => ({ ...p, [k]: e.target.value }))} style={S.input} />
                )}
              </div>
            ))}
            <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end', marginTop:'8px' }}>
              <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setBranchPastePreview(null)}>ยกเลิก</button>
              <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={()=>{
                const p = branchPastePreview;
                const buVal = String(p.currentForm['bu'] || '').trim();
                const buBranchPadded = p.buBranch ? String(p.buBranch).trim().padStart(5, '0') : p.currentForm['BU-Branch'];
                p.applyTo({
                  ...p.currentForm,
                  'Branch Code': p.branchCode || p.currentForm['Branch Code'],
                  'Company for Show in Report Display': p.company || p.currentForm['Company for Show in Report Display'],
                  'BU-Branch': buBranchPadded,
                  'Branch Address': p.address || p.currentForm['Branch Address'],
                  'Branch Direct': (buVal && buBranchPadded) ? `${buVal}-${buBranchPadded}` : p.currentForm['Branch Direct'],
                });
                setBranchPastePreview(null);
              }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Rate Confirm Modal ─── */}
      {showRateConfirm&&rateConfirmData&&(
        <div style={{...S.overlay,zIndex:1000}}>
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
        </div>
      )}

      {/* ─── Recycle Bin Modal ─── */}
      {showRecycleBin && (
        <div style={S.overlay}>
          <div style={{ background:'white', borderRadius:'10px', width: isMobile?'95vw':'860px', maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={{ fontSize:'15px', fontWeight:'500' }}>🗑️ Recycle Bin — {currentLabel()}</span>
                <span style={{ fontSize:'11px', background:'#f5f5f5', color:'#888', padding:'2px 8px', borderRadius:'20px' }}>{recycleBinItems.length} รายการ</span>
              </div>
              <button onClick={()=>setShowRecycleBin(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:'20px', lineHeight:1 }}>×</button>
            </div>
            {recycleBinSelected.length > 0 && (
              <div style={{ padding:'8px 16px', background:'#f8f9fa', borderBottom:'0.5px solid #e8e8e8', display:'flex', alignItems:'center', gap:'8px', flexShrink:0, flexWrap:'wrap' }}>
                <span style={{ fontSize:'12px', color:'#555' }}>เลือก {recycleBinSelected.length} รายการ</span>
                {!recycleBinLoading2 ? (
                  <>
                    <button onClick={handleBulkRestoreBin} style={{ padding:'4px 12px', borderRadius:'6px', border:'0.5px solid #97C459', fontSize:'12px', cursor:'pointer', background:'#EAF3DE', color:'#27500A', fontWeight:'500' }}>♻️ Restore ทั้งหมด</button>
                    <button onClick={handleBulkPermanentDeleteBin} style={{ padding:'4px 12px', borderRadius:'6px', border:'0.5px solid #f7c1c1', fontSize:'12px', cursor:'pointer', background:'#FCEBEB', color:'#791F1F', fontWeight:'500' }}>🗑️ ลบถาวรทั้งหมด</button>
                    <button onClick={() => setRecycleBinSelected([])} style={{ padding:'4px 8px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', cursor:'pointer', background:'#f5f5f5', color:'#555' }}>✕ ยกเลิก</button>
                  </>
                ) : (
                  <div style={{ flex:1, maxWidth:'300px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                      <span style={{ fontSize:'11px', color:'#555' }}>กำลังดำเนินการ...</span>
                      <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>{recycleBinProgress}%</span>
                    </div>
                    <div style={{ background:'#f0f0f0', borderRadius:'20px', height:'6px', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:'20px', background:'linear-gradient(90deg, #5DCAA5, #1a3a5c)', width:`${recycleBinProgress}%`, transition:'width 0.3s ease' }}/>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ overflowY:'auto', flex:1, minHeight:0 }}>
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
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'center', width:'36px' }}>
                        <input type="checkbox" checked={recycleBinItems.length > 0 && recycleBinSelected.length === recycleBinItems.length} onChange={() => setRecycleBinSelected(recycleBinSelected.length === recycleBinItems.length ? [] : recycleBinItems.map(i => i.id))}/>
                      </th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px' }}>Key</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px' }}>ลบโดย</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'left', fontWeight:'500', fontSize:'11px', whiteSpace:'nowrap' }}>วันที่ลบ</th>
                      <th style={{ background:'#1a3a5c', color:'white', padding:'9px 12px', textAlign:'center', fontWeight:'500', fontSize:'11px', width:'120px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recycleBinItems.map(item => {
                      const isChecked = recycleBinSelected.includes(item.id);
                      const deletedAt = item.deleted_at ? new Date(item.deleted_at) : null;
                      const deletedAtStr = deletedAt ? `${String(deletedAt.getDate()).padStart(2,'0')}/${String(deletedAt.getMonth()+1).padStart(2,'0')}/${deletedAt.getFullYear()} ${String(deletedAt.getHours()).padStart(2,'0')}:${String(deletedAt.getMinutes()).padStart(2,'0')}` : '-';
                      return (
                        <tr key={item.id} style={{ background: isChecked?'#f0f7ff':'white', borderBottom:'0.5px solid #f0f0f0' }}>
                          <td style={{ padding:'8px 12px', textAlign:'center' }}>
                            <input type="checkbox" checked={isChecked} onChange={() => setRecycleBinSelected(prev => prev.includes(item.id) ? prev.filter(s => s !== item.id) : [...prev, item.id])}/>
                          </td>
                          <td style={{ padding:'9px 12px', fontWeight:'500', color:'#1a3a5c', fontSize:'12px' }}>{item.source_key}</td>
                          <td style={{ padding:'9px 12px', color:'#555', fontSize:'11px' }}>{item.deleted_by || '-'}</td>
                          <td style={{ padding:'9px 12px', color:'#888', fontSize:'11px', whiteSpace:'nowrap' }}>{deletedAtStr}</td>
                          <td style={{ padding:'9px 12px', textAlign:'center' }}>
                            <div style={{ display:'inline-flex', gap:'6px' }}>
                              <button onClick={()=>handleRestore(item)} disabled={recycleBinLoading2} style={{ padding:'4px 12px', borderRadius:'5px', border:'none', background: recycleBinLoading2?'#f5f5f5':'#EAF3DE', color: recycleBinLoading2?'#aaa':'#27500A', fontSize:'11px', cursor: recycleBinLoading2?'default':'pointer', fontWeight:'500' }}>♻️</button>
                              <button onClick={()=>handlePermanentDelete(item)} disabled={recycleBinLoading2} style={{ padding:'4px 10px', borderRadius:'5px', border:'0.5px solid #f7c1c1', background: recycleBinLoading2?'#f5f5f5':'#FCEBEB', color: recycleBinLoading2?'#aaa':'#791F1F', fontSize:'11px', cursor: recycleBinLoading2?'default':'pointer' }}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ padding:'10px 20px', borderTop:'0.5px solid #f0f0f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
              <button onClick={()=>setShowRecycleBin(false)} style={{ padding:'6px 16px', borderRadius:'6px', border:'0.5px solid #ddd', background:'white', color:'#555', fontSize:'12px', cursor:'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <ImportPreviewModal show={showInfoPreview} onClose={()=>{setShowInfoPreview(false);setInfoPreviewRows([]);}} onConfirm={handleInfoConfirmImport} importing={infoImporting} previewRows={infoPreviewRows} keyField={INFO_KEY} allFields={INFO_FIELDS} isMobile={isMobile}/>
      <ImportPreviewModal show={showBranchPreview} onClose={()=>{setShowBranchPreview(false);setBranchPreviewRows([]);}} onConfirm={handleBranchConfirmImport} importing={branchImporting} previewRows={branchPreviewRows} keyField={BRANCH_KEY} allFields={BRANCH_FIELDS} isMobile={isMobile}/>
    </div>
  );
}

export default BusinessUnit;