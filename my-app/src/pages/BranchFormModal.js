// BranchFormModal.js
// ============================================================================
// MARKER_BRANCHFORMMODAL_V1
// ฟอร์ม "+ New Branch" / "Edit Branch" แบบเดียวกับ Master Data > Branch (BusinessUnit.js)
// ใช้ซ้ำในหน้า Reconcile (กดไอคอนสาขา) -- Auto-fill ชุดเดียวกับ Master Data / APController:
//   • Branch Code blur  -> เดา Head Office (รหัสตัด 2 ตัวท้าย + "01") แล้วเติม BU / Group-P / BU Tax ID / % / Simple Company
//   • Company blur      -> หาสาขาอื่นที่ Company for Report ตรงกัน เติมค่าเดียวกัน + Simple Brand Code = "BranchCode-Company"
//   • BU Branch blur    -> Pad 5 หลัก + Branch Direct = BU-BU Branch
//   • วาง 1 แถวจาก Excel (มี Tab) ที่ช่อง Branch Code -> เติม Branch Code / Company / BU Branch / Address
// Save: POST/PUT /branch_list (+updated_by/at) -> broadcastWs('branch_list_updated') -> onSaved(form)
// ============================================================================
import React from 'react';
import { apiFetch } from '../api';
import { broadcastWs } from '../wsManager';
import { useAuth } from '../contexts/AuthContext';
import { useDataCache } from '../contexts/DataCacheContext';
import { confirmDialog } from '../confirmDialog';

const BF_FIELDS = [
  ['Branch Code', 'Branch Code'], ['BU Code', 'BU Code'], ['BU-Branch', 'BU Branch'], ['cpc', 'CPC'],
  ['Branch Direct', 'Branch Direct'], ['Branch Allocate', 'Branch Allocate'], ['Group-P', 'Group-P'],
  ['Company for Show in Report Display', 'Company for Report'], ['Simple Company', 'Simple Company'],
  ['BU-TaxID', 'BU Tax ID'], ['Simple Brand Code', 'Simple Brand Code'], ['%', '%'], ['DB(%)', 'DB(%)'],
  ['bu', 'BU'], ['status', 'Status'], ['Inactive Date', 'Inactive Date'], ['Branch Address', 'Branch Address'],
];
const BF_ROWS = [
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
const BF_COLOR = {
  'Branch Code': '#FCF3D5', 'status': '#FCF3D5', 'Company for Show in Report Display': '#FCF3D5', 'bu': '#FCF3D5',
  'Group-P': '#FCF3D5', 'BU-TaxID': '#FCF3D5', 'BU-Branch': '#FCF3D5', '%': '#DCEAF1', 'Branch Direct': '#DCEAF1',
};
const BF_REQUIRED = ['Branch Code', 'status', 'Company for Show in Report Display', 'bu', 'Group-P', 'BU-TaxID', 'BU-Branch'];
const bfNorm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const bfBlank = (v) => !String(v || '').trim();

// เติมค่าจากสาขาต้นแบบ (เฉพาะช่องที่ยังว่าง)
const bfFillFrom = (f, match) => ({
  ...f,
  'bu': bfBlank(f['bu']) ? (match['bu'] || '') : f['bu'],
  'Group-P': bfBlank(f['Group-P']) ? (match['Group-P'] || '') : f['Group-P'],
  'BU-TaxID': bfBlank(f['BU-TaxID']) ? (match['BU-TaxID'] || '') : f['BU-TaxID'],
  '%': bfBlank(f['%']) ? (match['%'] || '') : f['%'],
  'Simple Company': bfBlank(f['Simple Company']) ? (match['Simple Company'] || '') : f['Simple Company'],
});
const bfHoAutofill = (f, branches) => {
  const code = String(f['Branch Code'] || '').trim();
  if (code.length < 3) return f;
  const hoCode = code.slice(0, -2) + '01';
  const match = (branches || []).find((b) => String(b['Branch Code'] || '').trim() === hoCode);
  return match ? bfFillFrom(f, match) : f;
};
const bfCompanyAutofill = (f, branches) => {
  const rawName = String(f['Company for Show in Report Display'] || '').trim();
  const name = bfNorm(rawName);
  const code = String(f['Branch Code'] || '').trim();
  const match = name ? (branches || []).find((b) => bfNorm(b['Company for Show in Report Display']) === name) : null;
  let next = match ? bfFillFrom(f, match) : { ...f };
  if (bfBlank(f['Simple Brand Code']) && code && rawName) next['Simple Brand Code'] = `${code}-${rawName}`;
  return bfHoAutofill(next, branches);
};
const bfBuBranchPad = (f) => {
  const raw = String(f['BU-Branch'] || '').trim();
  if (!raw) return f;
  const padded = raw.padStart(5, '0');
  const buVal = String(f['bu'] || '').trim();
  return { ...f, 'BU-Branch': padded, 'Branch Direct': buVal ? `${buVal}-${padded}` : f['Branch Direct'] };
};

export default function BranchFormModal({ show, onClose, initialForm, onSaved }) {
  const { userName } = useAuth();
  const { fetchCollection, getCached } = useDataCache(); // MARKER_BRANCHFORM_USE_DATACACHE_V1 -- ใช้ BranchList ใน DataCache กลางของระบบ (โหลดไว้แล้ว / Master Data ใช้ชุดเดียวกัน) ไม่ดึงซ้ำ
  const [branches, setBranches] = React.useState([]);
  const [form, setForm] = React.useState({});
  const [editTarget, setEditTarget] = React.useState(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  // MARKER_BRANCHFORM_INSTANT_RENDER_V1 -- เปิดฟอร์มทันที (ไม่รอ /branch_list) แล้วค่อย Auto-fill / สลับเป็น Edit เมื่อโหลดรายการเสร็จ; ใช้ Cache ของรอบก่อนทำให้เปิดครั้งต่อไปเร็วทันที
  React.useEffect(() => {
    if (!show) { setReady(false); return undefined; }
    let alive = true;
    const base = {}; BF_FIELDS.forEach(([k]) => { base[k] = ''; });
    const seed = { ...base, ...(initialForm || {}) };
    const code = String(seed['Branch Code'] || '').trim();
    const apply = (list, touchedByUser) => {
      const existing = code ? list.find((b) => String(b['Branch Code'] || '').trim() === code) : null;
      if (existing) {
        const f = {}; BF_FIELDS.forEach(([k]) => { f[k] = existing[k] || ''; });
        setEditTarget(existing); setForm(f);
      } else {
        setEditTarget(null);
        setForm((cur) => (touchedByUser && cur && Object.keys(cur).some((k) => cur[k] && cur[k] !== seed[k]))
          ? cur : bfBuBranchPad(bfHoAutofill(seed, list)));
      }
    };
    const cached = getCached('BranchList') || [];
    setBranches(cached);
    apply(cached, false);
    setError(''); setReady(true);
    (async () => {
      let list = null;
      try { const res = await fetchCollection('BranchList'); if (Array.isArray(res)) list = res; } catch (e) { /* ใช้ Cache */ }
      if (!alive || !list || list === cached) return; // Cache ยังสด -> ได้ชุดเดิม ไม่ต้องทำซ้ำ
      setBranches(list);
      apply(list, true);
    })();
    return () => { alive = false; };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;
  const isEdit = !!editTarget;
  const setField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setError(''); };

  const handlePasteBranchRow = (e) => {
    const raw = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!raw.includes('\t')) return; // ไม่ใช่หลายคอลัมน์ -> วางปกติ
    e.preventDefault();
    const cols = raw.split('\n')[0].split('\t');
    setForm((f) => {
      const next = { ...f };
      if ((cols[1] || '').trim()) next['Branch Code'] = cols[1].trim();
      if ((cols[2] || '').trim()) next['Company for Show in Report Display'] = cols[2].trim();
      if ((cols[5] || '').trim()) next['BU-Branch'] = cols[5].trim();
      if ((cols[6] || '').trim()) next['Branch Address'] = cols[6].trim();
      return bfBuBranchPad(bfCompanyAutofill(next, branches));
    });
  };

  const validate = () => {
    for (const k of BF_REQUIRED) {
      if (bfBlank(form[k])) { const label = (BF_FIELDS.find(([x]) => x === k) || [null, k])[1]; return `กรุณากรอก ${label}`; }
    }
    if (form['status'] === 'Closed' && !form['Inactive Date']) return 'กรุณากรอก Inactive Date เมื่อ Status เป็น Closed';
    if (form['status'] === 'Relocate' && !form['Branch Allocate']) return 'กรุณากรอก Branch Allocate เมื่อ Status เป็น Relocate';
    return '';
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); confirmDialog.alert(err, { variant: 'danger', title: 'กรอกข้อมูลไม่ครบ' }); return; }
    setSaving(true);
    try {
      if (!isEdit) { // เช็คซ้ำจากข้อมูลล่าสุด (กันมีคนเพิ่มพร้อมกัน)
        let fresh = branches;
        try { const res = await apiFetch('/branch_list'); if (Array.isArray(res)) fresh = res; } catch (e) { /* ใช้ของเดิม */ }
        if (fresh.some((b) => String(b['Branch Code'] || '').trim() === String(form['Branch Code'] || '').trim())) {
          await confirmDialog.alert(`Branch Code "${form['Branch Code']}" มีอยู่แล้วในระบบ`, { variant: 'danger', title: 'ซ้ำในระบบ' });
          setSaving(false); return;
        }
      }
      const payload = { ...form, updated_by: userName, updated_at: new Date().toISOString() };
      if (isEdit && editTarget?.id) await apiFetch(`/branch_list/${editTarget.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await apiFetch('/branch_list', { method: 'POST', body: JSON.stringify(payload) });
      fetchCollection('BranchList', true).catch(() => {}); // รีเฟรช DataCache กลางให้ทุกหน้าเห็นสาขาใหม่
      try { broadcastWs('branch_list_updated', { bu: form['bu'] || '' }); } catch (e) { console.error('[broadcast branch_list_updated]', e); }
      if (onSaved) await onSaved({ ...form, isEdit });
    } catch (e) {
      confirmDialog.alert('บันทึกไม่สำเร็จ: ' + (e?.message || ''), { variant: 'danger' });
    }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: 'white', borderRadius: 14, width: 'min(900px, 94vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>{isEdit ? `Edit Branch — ${editTarget['Branch Code'] || ''}` : '+ New Branch'}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={saving} onClick={onClose} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#f0f0f0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button type="button" disabled={saving || !ready} onClick={handleSave} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#1a3a5c', color: 'white', fontSize: 13, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
        {error && <div style={{ padding: '8px 20px', background: '#FCEBEB', color: '#791F1F', fontSize: 12, borderBottom: '1px solid #f7c1c1', flexShrink: 0 }}>⚠️ {error}</div>}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {!ready ? <div style={{ color: '#888', fontSize: 13 }}>กำลังโหลด…</div> : BF_ROWS.map((rowKeys, ri) => (
            <div key={ri} style={{ display: 'flex', marginBottom: 8, position: 'relative' }}>
              {rowKeys.map((key, ki) => {
                const label = (BF_FIELDS.find(([k]) => k === key) || [null, key])[1];
                const needInactive = key === 'Inactive Date';
                const isDisabled = (needInactive && form['status'] !== 'Closed') || (key === 'Branch Code' && isEdit);
                const isReq = BF_REQUIRED.includes(key) || (needInactive && form['status'] === 'Closed') || (key === 'Branch Allocate' && form['status'] === 'Relocate');
                const hasErr = !!error && isReq && bfBlank(form[key]);
                const isFullRow = rowKeys.length === 1;
                const bg = needInactive ? '#eef1f3' : (BF_COLOR[key] || '#fff');
                const bd = hasErr ? '1px dashed #e74c3c' : '1px dashed #2c5f7c';
                const inputBare = { width: '100%', border: 'none', background: 'transparent', fontSize: 13, color: isDisabled ? '#999' : (BF_COLOR[key] ? '#5c5636' : '#333'), outline: 'none', padding: 0, fontFamily: 'inherit' };
                const onBlur = key === 'BU-Branch' ? () => setForm((f) => bfBuBranchPad(f))
                  : key === 'Branch Code' ? () => setForm((f) => bfHoAutofill(f, branches))
                  : key === 'Company for Show in Report Display' ? () => setForm((f) => bfCompanyAutofill(f, branches))
                  : undefined;
                return (
                  <React.Fragment key={key}>
                    <div style={{ flex: isFullRow || ki === 0 ? '0 0 160px' : '0 0 120px', border: bd, marginLeft: ki === 0 ? 0 : -1, padding: '8px 10px', display: 'flex', alignItems: key === 'Branch Address' ? 'flex-start' : 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: hasErr ? '#e74c3c' : '#123c56' }}>
                        {label}{isReq && <span style={{ color: '#e24b4a' }}> *</span>}
                        {needInactive && <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400 }}> (เฉพาะ Closed)</span>}
                      </span>
                    </div>
                    <div style={{ flex: 1, background: bg, border: bd, marginLeft: -1, padding: '8px 10px', display: 'flex', alignItems: 'center', minHeight: key === 'Branch Address' ? 56 : undefined }}>
                      {key === 'Inactive Date' ? (
                        <input type="date" disabled={isDisabled} value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} style={inputBare} />
                      ) : key === 'Branch Address' ? (
                        <textarea value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} style={{ ...inputBare, height: 36, resize: 'vertical' }} />
                      ) : key === 'status' ? (
                        <select value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} style={{ ...inputBare, fontWeight: 600 }}>
                          <option value="">เลือก Status</option>
                          {['Active', 'Closed', 'Relocate', 'Temporary'].map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : key === 'Branch Direct' ? (
                        <input value={form[key] || ''} readOnly style={{ ...inputBare, color: '#999' }} />
                      ) : (
                        <input value={form[key] || ''} disabled={isDisabled} onChange={(e) => setField(key, e.target.value)} onBlur={onBlur}
                          onPaste={key === 'Branch Code' && !isEdit ? handlePasteBranchRow : undefined} style={inputBare} />
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
