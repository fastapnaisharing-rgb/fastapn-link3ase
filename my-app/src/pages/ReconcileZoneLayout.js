import React, { useState, useRef, useEffect, useMemo } from 'react';
import VatReconcileSystem from './VatReconcileSystem';

// ══════════════════════════════════════════════════════════════════════════
// ReconcileZoneLayout.js — Shared Component สำหรับหน้า Reconcile ทุกโมดูล
// ══════════════════════════════════════════════════════════════════════════
// MARKER_RECONCILE_ZONE_LAYOUT_V4 — ปรับตาม Mockup ที่ Confirm แล้ว (2026-09-27):
//   - ตาราง Dashboard: ตัด Columns "กลุ่ม" / "พร้อม Reconcile" ออก ตัด Letter
//     Filter (All/B/C) ออก — แสดงเป็น BU + Account แต่ละตัวตรงๆ (Flatten จาก
//     accountGroups) ทุก Cell มี "จำนวน AP Cutting" (หรือ No Data) + Badge TB
//     สีเขียว/แดง ในกล่องเดียวกัน แบ่งเส้นถาวรระหว่างกลุ่ม (border-left ที่
//     Column แรกของกลุ่มถัดไป) — ไม่มีปุ่มสลับกลุ่ม กลุ่มไหนมีข้อมูลก็แสดงปกติ
//   - Cell ที่เคย Export ไปแล้ว มี Badge ✓ (exported) มุมขวาบน
//   - Reconcile Control Zone: ตัด Field "REPORT" ออก, Field "ACCOUNT" เหลือ
//     Dropdown เดียว (ไม่ใช่ปุ่ม Toggle) แต่แบ่ง 2 กลุ่มด้วย <optgroup>:
//     "By Group" (เลือกทั้งกลุ่ม AP Reconcile / IE Reconcile) กับ "By Account"
//     (เลือกทีละรหัสบัญชี) — ใช้ Dropdown เดียวกัน ไม่ใช่ 2 Field แยก
//   - ปุ่ม: แถวบน Preview (Outline) + Clear, แถวล่าง Export เต็มความกว้าง
//     (แทนที่ปุ่ม Preview สีเขียวเดิม + ไม่มี Zone Preview ด้านล่างอีกต่อไป —
//     Preview เปลี่ยนเป็น Popup แทน)
//   - Grid บนสุด ปรับสัดส่วนจาก 1.3fr/1fr เป็น 2.3fr/1fr (ให้ตารางกว้างขึ้น)
//
// สิ่งที่ยังไม่ทำ (ตั้งใจ รอของจริงจากผู้ใช้ก่อน):
//   - Preview Popup / Export ยังเป็น Placeholder ล้วนๆ — รอไฟล์ VBA Source
//     ของ Macro "A_Reconcile" (ใน Master Macro A_SystemAll_UI.xlam) และไฟล์
//     Template Excel "Master Reconcile" จริง ถึงจะออกแบบ Logic/Format จริงได้
//   - BUSINESS UNIT Dropdown ตอนนี้ยังคำนวณจาก buRows ที่ส่งเข้ามา (Mock) —
//     ของจริงต้อง Filter เฉพาะ BU ที่มีข้อมูลใน Period ที่เลือก (รอ Backend
//     Endpoint GET /ap-reconcile/dashboard/status)
//
// รับ Config ผ่าน Props เพื่อให้โมดูลอื่นใช้ซ้ำได้ ไม่ผูกกับ AP โดยเฉพาะ
// ══════════════════════════════════════════════════════════════════════════

const FIELD_GRAD = 'linear-gradient(180deg, #eef4ff, #e3ecfb)';
const SUCCESS = '#1a7f37';
const SUCCESS_SOFT = '#e6f4ea';
const DANGER = '#cf222e';
const DANGER_SOFT = '#fdedee';
const BORDER = '#ddd';

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '10px 20px', fontSize: 14, fontWeight: 500,
      background: active ? '#fff' : 'transparent', color: active ? '#0969da' : '#666',
      border: 'none', borderBottom: active ? '2px solid #0969da' : '2px solid transparent',
      cursor: 'pointer', whiteSpace: 'nowrap',
    }}>
      {children}
    </button>
  );
}

// MARKER_ACCTCELL_DUAL_STATUS_V1 — ทั้ง AP Cutting และ TB แสดงเป็น Badge แบบเดียวกัน
// ทั้งคู่: มีข้อมูล = เขียว + ค่าที่เจอ, ไม่มีข้อมูล = แดง + "No Data" — เห็นชัดว่า
// ตัวเลขที่ขึ้นเป็นของฝั่งไหน ไม่ปนกันเหมือนก่อนหน้านี้
function StatusBadge({ label, ready, display }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20,
      fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
      background: ready ? SUCCESS_SOFT : DANGER_SOFT, color: ready ? SUCCESS : DANGER,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', flexShrink: 0 }} />
      {label} {display}
    </span>
  );
}

function AcctCell({ cell }) {
  const count = cell?.count;
  const hasAp = count != null;
  const tbActive = !!cell?.tbActive;
  const exported = !!cell?.exported;
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      {exported && (
        <span style={{
          position: 'absolute', top: -8, right: -6, width: 15, height: 15, borderRadius: '50%',
          background: SUCCESS, color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: '15px',
          textAlign: 'center', boxShadow: '0 0 0 2px #fff',
        }}>✓</span>
      )}
      <StatusBadge label="AP" ready={hasAp} display={hasAp ? count.toLocaleString() : 'No Data'} />
      <StatusBadge label="TB" ready={tbActive} display={tbActive ? 'Ready' : 'No Data'} />
    </div>
  );
}

function FieldLabelBox({ label }) {
  return (
    <div style={{
      flex: '0 0 42%', background: FIELD_GRAD, border: '1px solid #d0d7de', borderRadius: 8,
      padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span style={{ color: '#334155', fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span style={{ color: '#334155', fontWeight: 600 }}>›</span>
    </div>
  );
}

// MARKER_PERIOD_FIELD_DEFAULT_BLANK_V2 — Field "PERIOD" กลับมามี Option ว่าง "-" เป็น Default
// อีกครั้ง (ตามที่ Confirm ใหม่) แต่คราวนี้แก้ Root Cause ของปัญหา "ค้างข้อมูล Period เก่า" ที่
// เจอตอน V1 แล้วจริงๆ ที่ GLFunctionalController.js — พอ Period ว่าง จะ Clear buRows ทิ้งด้วย
// (ไม่ใช่แค่ Skip การ Fetch เหมือนเดิมที่ทำให้ตาราง Bug ค้าง Rows ของ Period ก่อนหน้าไว้)
// allowBlank ใช้เฉพาะ Field ที่ยอมให้ไม่เลือกอะไรได้ (ตอนนี้คือ PERIOD เท่านั้น)
function ReconcileFieldRow({ label, value, onChange, options, formatLabel, allowBlank = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <FieldLabelBox label={label} />
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        flex: 1, background: '#fff', color: '#24292f', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '9px 10px', fontSize: 13, cursor: 'pointer',
      }}>
        {allowBlank && <option value="">-</option>}
        {options.map(opt => <option key={opt} value={opt}>{formatLabel ? formatLabel(opt) : opt}</option>)}
      </select>
    </div>
  );
}

// Field "ACCOUNT" — Dropdown เดียว แบ่ง 2 Optgroup: เลือกทั้งกลุ่ม (By Group) หรือทีละรหัส (By Account)
function AccountSelectField({ label, value, onChange, accountGroups }) {
  const flatAccounts = useMemo(() => accountGroups.flatMap(g => g.accounts), [accountGroups]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <FieldLabelBox label={label} />
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        flex: 1, background: '#fff', color: '#24292f', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '9px 10px', fontSize: 13, cursor: 'pointer',
      }}>
        <option value="">—</option>
        <optgroup label="By Group">
          {accountGroups.map(g => (
            <option key={`grp:${g.key}`} value={`grp:${g.key}`}>{g.label}</option>
          ))}
        </optgroup>
        <optgroup label="By Account">
          {flatAccounts.map(a => (
            <option key={`acc:${a.code}`} value={`acc:${a.code}`}>{a.code}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

// แปลงค่าจาก AccountSelectField ("grp:ap" / "acc:21930052") ให้เป็นข้อความอ่านง่าย สำหรับใช้ใน Popup
function describeAccountSelection(selection, accountGroups) {
  if (!selection) return null;
  if (selection.startsWith('grp:')) {
    const key = selection.slice(4);
    const g = accountGroups.find(g => g.key === key);
    return g ? { mode: 'group', label: `${g.label} (${g.accounts.map(a => a.code).join(' / ')})`, accounts: g.accounts } : null;
  }
  if (selection.startsWith('acc:')) {
    const code = selection.slice(4);
    for (const g of accountGroups) {
      const a = g.accounts.find(a => a.code === code);
      if (a) return { mode: 'account', label: `${a.code} — ${a.label}`, accounts: [a] };
    }
  }
  return null;
}

// Combobox (input + datalist แบบ Browser เอง) สำหรับ Business Unit — พิมพ์กรองได้ ไม่ใช่แค่เลือกจาก List ยาวๆ
function ReconcileCombobox({ label, value, onChange, options }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const wrapperRef = useRef(null);
  const blurTimerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = filterQuery ? options.filter(o => o.toLowerCase().includes(filterQuery.toLowerCase())) : options;

  const handlePick = (opt) => { onChange(opt); setIsOpen(false); setFilterQuery(''); };
  const handleFocus = () => { if (blurTimerRef.current) clearTimeout(blurTimerRef.current); setFilterQuery(''); setIsOpen(true); };
  const handleBlur = () => { blurTimerRef.current = setTimeout(() => setIsOpen(false), 120); };

  return (
    <div ref={wrapperRef} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, position: 'relative' }}>
      <FieldLabelBox label={label} />
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          value={value}
          onChange={e => { setFilterQuery(e.target.value); onChange(e.target.value); }}
          onFocus={handleFocus} onClick={handleFocus} onBlur={handleBlur}
          placeholder="พิมพ์หรือเลือก..."
          style={{ width: '100%', boxSizing: 'border-box', background: '#fff', color: '#24292f', border: '1px solid #d0d7de', borderRadius: 8, padding: '9px 26px 9px 10px', fontSize: 13 }}
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#57606a', fontSize: 11 }}>▼</span>
        {isOpen && filtered.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20, background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 160, overflowY: 'auto' }}>
            {filtered.map(opt => (
              <div key={opt} onMouseDown={() => handlePick(opt)} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: '#24292f' }}>
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── File Storage Zone — โซนเก็บไฟล์ที่ Export ไว้ (ตาม Mockup ที่ Confirm แล้ว) ──
// My Job / All Job toggle + ตาราง BU/Filename/Report Type/Generated By/Expire Date/Download
// Download เป็น Icon แยกตาม Account จริงของ Job นั้น (เช่น AP: 52 54 84 85 All, IE: 100 220 All)
// หมายเหตุ: ทำ "เหมือน" Pattern IE Macrologic My Job/All Job แต่ไม่ได้ผูก/เรียกใช้ Code ของ IE เลย
// MARKER_FILESTORAGEZONE_LIVE_DATA_V1 — scope เป็น Controlled Prop แล้ว (Parent
// เป็นคนยิง Fetch จริงไปที่ GET /file-storage/ap-reconcile-jobs?scope=mine|all
// ตอน scope เปลี่ยน ไม่ Filter เอง Client-side อีกต่อไป เพราะกฎ All Job ของ Admin
// ต้องเช็ค Permission ฝั่ง Backend เท่านั้น — ตาราง file_storage ตอนนี้ยังไม่มี
// Column บอก "Report Type"/"Account ไหนบ้าง"/"Expire Date" ตรงๆ (รอ /generate
// จริงของ ap-reconcile ที่ยังเป็น Placeholder) จึง Derive reportLabel จากชื่อไฟล์
// แบบคร่าวๆ และซ่อน Icon แยก Account ถ้าไม่รู้ (โชว์ปุ่ม Download เดียวแทน)
function deriveJobDisplay(job) {
  const name = job.fileName || job.file_name || '';
  const reportLabel = /IE ?Reconcile/i.test(name) ? 'IE Reconcile' : /AP ?Reconcile/i.test(name) ? 'AP Reconcile' : job.reportLabel || '—';
  return {
    id: job.id,
    bu: job.bu,
    fileName: name,
    reportLabel,
    accounts: job.accounts || null,
    generatedBy: job.generatedBy || job.owner_username || '—',
    expireDate: job.expireDate || '—',
  };
}

function FileStorageZone({ jobs = [], scope = 'mine', onScopeChange, loading = false, onDownload, onPreview }) {
  const visibleJobs = jobs.map(deriveJobDisplay);

  return (
    <div style={{ marginTop: 16, border: '0.5px solid #ddd', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '0.5px solid #ddd', background: '#f7f7f7' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['mine', 'all'].map(s => (
            <button key={s} type="button" onClick={() => onScopeChange && onScopeChange(s)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
              border: `1px solid ${scope === s ? '#1e2a3a' : '#d0d7de'}`,
              background: scope === s ? '#1e2a3a' : '#fff', color: scope === s ? '#fff' : '#57606a',
            }}>
              <span aria-hidden="true">{s === 'mine' ? '👤' : '👥'}</span>
              {s === 'mine' ? 'My Job' : 'All Job'}
            </button>
          ))}
          <span style={{ fontSize: 12, color: '#8b95a1', alignSelf: 'center', marginLeft: 4 }}>
            {loading ? 'กำลังโหลด…' : `${visibleJobs.length} ไฟล์`}
          </span>
        </div>
      </div>

      {/* MARKER_FILESTORAGEZONE_FIXED_HEIGHT_HEADER_V1 — Header ของตาราง (BU/Filename/...)
          ต้องค้างอยู่เสมอไม่ว่าจะมีไฟล์หรือไม่ (ไม่ใช่หายไปทั้ง Table ตอน Rows ว่างแบบก่อนหน้า)
          และ Zone ต้องมีความสูง Default ที่คงที่ (minHeight) ไม่ยุบตามเนื้อหา ตาม Reference */}
      <div style={{ padding: 0, overflowX: 'auto', minHeight: 420 }}>
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'separate', borderSpacing: 0, minWidth: 720 }}>
          <thead>
            <tr style={{ background: FIELD_GRAD }}>
              {['BU', 'Filename', 'Report Type', 'Generated By', 'Expire Date', 'Preview', 'Download'].map(h => (
                <th key={h} style={{ textAlign: h === 'Filename' ? 'left' : 'center', padding: '8px 10px', color: '#334155', fontWeight: 700, fontSize: 11.5, boxShadow: `0 1px 0 ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleJobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: '#8b95a1', fontSize: 13 }}>
                  {loading ? 'กำลังโหลด…' : 'ยังไม่มีไฟล์ที่ Generate ไว้'}
                </td>
              </tr>
            ) : visibleJobs.map((j, i) => (
                <tr key={j.fileName + i} style={{ borderBottom: '0.5px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>{j.bu}</td>
                  <td style={{ padding: '8px 10px' }}>{j.fileName}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{j.reportLabel}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{j.generatedBy}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{j.expireDate}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button type="button" title="Preview" onClick={() => onPreview && onPreview(j)} style={{
                      padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                      border: '1px solid #d0d7de', background: '#fff', color: '#57606a', cursor: 'pointer',
                    }}>Preview</button>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {j.accounts && j.accounts.length > 0 ? (
                        <>
                          {j.accounts.map(code => (
                            <button key={code} type="button" title={`Download ${code}`} onClick={() => onDownload && onDownload(j.id, code)} style={{
                              padding: '3px 7px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                              border: '1px solid #d0d7de', background: '#fff', color: '#0969da', cursor: 'pointer',
                            }}>{code}</button>
                          ))}
                          <button type="button" title="Download All" onClick={() => onDownload && onDownload(j.id, 'all')} style={{
                            padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                            border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: 'pointer',
                          }}>All</button>
                        </>
                      ) : (
                        <button type="button" title="Download" onClick={() => onDownload && onDownload(j.id, 'all')} style={{
                          padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                          border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: 'pointer',
                        }}>Download</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReconcileZoneLayout({
  accountGroups = [],   // [{ key, label, accounts: [{ code, label }] }] — กลุ่ม Account (เช่น AP Reconcile / IE Reconcile)
  periodOptions = [],
  period, onPeriodChange,
  buRows = [],          // [{ bu, cells: { [accountCode]: { count, tbActive, exported } } }]
  fileJobs = [],        // ผลจริงจาก GET /file-storage/ap-reconcile-jobs?scope=mine|all
  fileJobsLoading = false,
  fileJobsScope = 'mine',
  onFileJobsScopeChange,
  onFileDownload,
}) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [ccBusinessUnit, setCcBusinessUnit] = useState('');
  const [ccAccountSelection, setCcAccountSelection] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewFileJob, setPreviewFileJob] = useState(null); // Preview จากแถวไฟล์ใน File Storage Zone (คนละอันกับ Preview ของ Control Zone)

  const flatAccounts = useMemo(() => accountGroups.flatMap(g => g.accounts.map(a => ({ ...a, groupKey: g.key }))), [accountGroups]);
  const businessUnitOptions = useMemo(() => buRows.map(r => r.bu).sort(), [buRows]);
  const canAct = !!ccBusinessUnit && !!ccAccountSelection;
  const selectionInfo = useMemo(() => describeAccountSelection(ccAccountSelection, accountGroups), [ccAccountSelection, accountGroups]);
  // MARKER_DASHBOARD_CONTROLZONE_LINK_V1 — เชื่อม Dashboard กับ Reconcile Control Zone
  // 2 ทาง: (1) คลิกแถว BU / Header Account ในตาราง → Set ค่าใน Control Zone ให้เลย
  // (2) ค่าที่เลือกอยู่ใน Control Zone (BU/Account) → Highlight แถว/Column ที่ตรงกันในตาราง
  const selectedAccountCodes = useMemo(() => new Set((selectionInfo?.accounts || []).map(a => a.code)), [selectionInfo]);

  // เลือก BU ใน Control Zone (ไม่ว่าจะพิมพ์เอง หรือคลิกจากตาราง) แล้ว ถ้าแถวนั้นอยู่นอกจอ
  // ให้ Scroll ตารางไปหาให้อัตโนมัติ — กันปัญหา "เลือกแล้วดูเหมือนไม่มีอะไรเกิดขึ้น" เพราะแถว
  // ที่ Highlight อยู่นอก Viewport ของพื้นที่ Scroll ตาราง
  const rowRefs = useRef({});
  useEffect(() => {
    if (!ccBusinessUnit) return;
    const el = rowRefs.current[ccBusinessUnit];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ccBusinessUnit, buRows]);

  const handlePreview = () => { if (canAct) setShowPreview(true); };
  const handleClear = () => { setCcBusinessUnit(''); setCcAccountSelection(''); setShowPreview(false); };
  const handleExport = () => { /* Placeholder — รอ Macro "A_Reconcile" + Template Master Reconcile ของจริง */ };

  return (
    <div style={{ padding: '24px', boxSizing: 'border-box', minHeight: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2.3fr 1fr', gap: 16, height: '35vh' }}>

        {/* โซนซ้าย: 2 Tab -- Dashboard / Upload File */}
        <div style={{ background: '#f7f7f7', border: '0.5px solid #ddd', borderRadius: 12, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '0.5px solid #ddd', background: '#fff', flexShrink: 0 }}>
            <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>Dashboard</TabButton>
            <TabButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')}>Upload File</TabButton>
          </div>

          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
            {activeTab === 'dashboard' && (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'separate', borderSpacing: 0, minWidth: 640 }}>
                  <thead>
                    {/* MARKER_DASHBOARD_TABLE_SPLIT_TB_AP_V2 — เอา Label Account (เช่น "Trade Payable")
                        ออกทั้งหมด แล้วเอาพื้นที่ที่ว่างนั้นมาใส่ TB | AP แทนในแถว Header เดียวกันเลย
                        (ไม่ต้องมี Row ที่ 2 ซ้อนอีกชั้น ประหยัดพื้นที่ความสูงตามที่ Confirm) */}
                    <tr style={{ borderBottom: `0.5px solid ${BORDER}` }}>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: FIELD_GRAD, textAlign: 'left', padding: '8px 10px', color: '#334155', fontWeight: 700, fontSize: 11.5, boxShadow: `0 1px 0 ${BORDER}`, verticalAlign: 'middle' }}>BU</th>
                      {accountGroups.map((g, gi) => g.accounts.map((a, ai) => {
                        const isSelected = selectedAccountCodes.has(a.code);
                        return (
                          <th key={a.code} colSpan={2} onClick={() => setCcAccountSelection(`acc:${a.code}`)} title="คลิกเพื่อเลือกใน Reconcile Control Zone" style={{
                            position: 'sticky', top: 0, zIndex: 2, background: isSelected ? '#cfe3fc' : FIELD_GRAD, textAlign: 'center', padding: '6px 6px 4px',
                            color: '#334155', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', cursor: 'pointer', boxShadow: `0 1px 0 ${BORDER}`,
                            borderLeft: (ai === 0 && gi > 0) ? `2px solid ${BORDER}` : undefined,
                          }}>
                            <div>{a.code}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 2 }}>
                              <span style={{ fontWeight: 700, color: '#8b95a1', fontSize: 10 }}>TB</span>
                              <span style={{ fontWeight: 700, color: '#8b95a1', fontSize: 10 }}>AP</span>
                            </div>
                          </th>
                        );
                      }))}
                    </tr>
                  </thead>
                  <tbody>
                    {buRows.length === 0 && (
                      <tr><td colSpan={1 + flatAccounts.length * 2} style={{ padding: '24px 4px', textAlign: 'center', color: '#999' }}>
                        {period ? 'ไม่พบข้อมูลใน Period นี้' : 'กรุณาเลือก Period ก่อน'}
                      </td></tr>
                    )}
                    {buRows.map((r, i) => {
                      const isRowSelected = r.bu === ccBusinessUnit;
                      return (
                        <tr key={r.bu} ref={el => { rowRefs.current[r.bu] = el; }} onClick={() => setCcBusinessUnit(r.bu)} title="คลิกเพื่อเลือกใน Reconcile Control Zone" style={{
                          borderBottom: '0.5px solid #eee', cursor: 'pointer',
                          background: isRowSelected ? '#eaf2ff' : (i % 2 === 0 ? '#fff' : '#fafbfc'),
                        }}>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: isRowSelected ? '#0969da' : '#24292f' }}>{r.bu}</td>
                          {accountGroups.map((g, gi) => g.accounts.map((a, ai) => {
                            const isColSelected = selectedAccountCodes.has(a.code);
                            const cell = r.cells?.[a.code];
                            const hasAp = cell?.count != null;
                            const cellBg = isColSelected ? '#f0f6ff' : undefined;
                            const borderLeft = (ai === 0 && gi > 0) ? `2px solid ${BORDER}` : undefined;
                            return (
                              <React.Fragment key={a.code}>
                                <td style={{ padding: '8px 4px', textAlign: 'center', background: cellBg, borderLeft, color: cell?.tbActive ? SUCCESS : '#c5cad2', fontWeight: cell?.tbActive ? 700 : 400 }}>
                                  {cell?.tbActive ? '✓' : '-'}
                                </td>
                                <td style={{ padding: '8px 4px', textAlign: 'center', background: cellBg, color: hasAp ? '#24292f' : '#c5cad2', fontWeight: hasAp ? 700 : 400 }}>
                                  {hasAp ? cell.count.toLocaleString() : '-'}
                                </td>
                              </React.Fragment>
                            );
                          }))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'upload' && (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <VatReconcileSystem
                  apiModule="ap-reconcile" // MARKER_RECONCILEZONELAYOUT_APIMODULE_V1
                  onCommitSuccess={() => setActiveTab('dashboard')}
                />
              </div>
            )}
          </div>
        </div>

        {/* โซนขวา: Reconcile Control Zone */}
        <div style={{ border: '0.5px solid #ddd', borderRadius: 12, height: '100%', background: '#fff', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#334155', margin: '0 0 12px' }}>Reconcile Control Zone</p>
              <ReconcileFieldRow label="PERIOD" value={period} onChange={onPeriodChange} options={periodOptions} allowBlank />
              <ReconcileCombobox label="BUSINESS UNIT" value={ccBusinessUnit} onChange={setCcBusinessUnit} options={businessUnitOptions} />
              {ccBusinessUnit && !businessUnitOptions.includes(ccBusinessUnit) && (
                <p style={{ margin: '-6px 0 10px', fontSize: 11, color: DANGER, paddingLeft: '46%' }}>
                  BU "{ccBusinessUnit}" ไม่มีข้อมูลใน Dashboard ของ Period นี้ (จึงไม่มีแถวให้ Sync/Highlight)
                </p>
              )}
              <AccountSelectField label="ACCOUNT" value={ccAccountSelection} onChange={setCcAccountSelection} accountGroups={accountGroups} />
            </div>
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button type="button" disabled={!canAct} onClick={handlePreview} style={{
                  flex: 1, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                  background: '#fff', color: canAct ? '#0969da' : '#9aa4b2',
                  border: `1px solid ${canAct ? '#0969da' : '#d0d7de'}`, cursor: canAct ? 'pointer' : 'not-allowed',
                }}>
                  Preview
                </button>
                <button type="button" onClick={handleClear} style={{
                  flex: 1, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                  background: '#fff', color: '#cf222e', border: '1px solid #cf222e', cursor: 'pointer',
                }}>
                  Clear
                </button>
              </div>
              <button type="button" disabled={!canAct} onClick={handleExport} style={{
                width: '100%', padding: '12px', fontSize: 14, fontWeight: 700, borderRadius: 8, border: 'none',
                color: '#fff', cursor: canAct ? 'pointer' : 'not-allowed',
                background: canAct ? 'linear-gradient(135deg, #2ea043, #1a7f37)' : 'linear-gradient(135deg, #b8bfc7, #9aa2ab)',
              }}>
                Export
              </button>
            </div>
          </div>
        </div>
      </div>

      <FileStorageZone
        jobs={fileJobs}
        scope={fileJobsScope}
        onScopeChange={onFileJobsScopeChange}
        loading={fileJobsLoading}
        onDownload={onFileDownload}
        onPreview={setPreviewFileJob}
      />

      {/* Preview Popup — ไฟล์จาก File Storage Zone */}
      {previewFileJob && (
        <div onClick={() => setPreviewFileJob(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', border: '1px solid #d0d7de', borderRadius: 12, width: '100%', maxWidth: 640,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: 0, fontSize: 14.5, color: '#24292f' }}>Preview — {previewFileJob.fileName}</h3>
              <button type="button" aria-label="ปิด" onClick={() => setPreviewFileJob(null)} style={{ background: 'none', border: 'none', fontSize: 16, color: '#666', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto', fontSize: 12.5, color: '#57606a', lineHeight: 1.7 }}>
              <p>
                <b>BU:</b> {previewFileJob.bu || '—'} &nbsp;·&nbsp; <b>Report Type:</b> {previewFileJob.reportLabel || '—'} &nbsp;·&nbsp; <b>Generated By:</b> {previewFileJob.generatedBy || '—'}
              </p>
              <p>ยังเป็น Placeholder อยู่ — รอไฟล์ Macro/Template จริงมาแสดงเนื้อหาไฟล์ที่นี่</p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Popup — Control Zone */}
      {showPreview && (
        <div onClick={() => setShowPreview(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', border: '1px solid #d0d7de', borderRadius: 12, width: '100%', maxWidth: 640,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: 0, fontSize: 14.5, color: '#24292f' }}>Preview — Master Reconcile (Report DOA)</h3>
              <button type="button" aria-label="ปิด" onClick={() => setShowPreview(false)} style={{ background: 'none', border: 'none', fontSize: 16, color: '#666', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto', fontSize: 12.5, color: '#57606a', lineHeight: 1.7 }}>
              <p>
                <b>Period:</b> {period || '—'} &nbsp;·&nbsp; <b>BU:</b> {ccBusinessUnit || '—'} &nbsp;·&nbsp; <b>Account:</b> {selectionInfo?.label || '—'}
              </p>
              {/* ── ข้อมูลจริงจาก Dashboard ตาม BU/Account ที่เลือกใน Control Zone (เชื่อมกับตารางด้านบนแล้ว) ── */}
              {selectionInfo?.accounts?.length > 0 && (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', margin: '10px 0' }}>
                  <thead>
                    <tr style={{ background: FIELD_GRAD }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Account</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px' }}>AP Cutting</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px' }}>TB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectionInfo.accounts.map(a => {
                      const cell = buRows.find(r => r.bu === ccBusinessUnit)?.cells?.[a.code];
                      const hasAp = cell?.count != null;
                      return (
                        <tr key={a.code} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '6px 8px' }}>{a.code} — {a.label}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: hasAp ? SUCCESS : DANGER, fontWeight: 700 }}>
                            {hasAp ? cell.count.toLocaleString() : 'No Data'}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: cell?.tbActive ? SUCCESS : DANGER, fontWeight: 700 }}>
                            {cell?.tbActive ? 'Ready' : 'No Data'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p>
                รูปแบบตาม Master Reconcile Template — โครงสร้าง Column/การคำนวณอ้างอิงจาก Logic Macro <b>A_Reconcile</b> —
                ยังเป็น Placeholder อยู่ รอไฟล์ Macro/Template จริงมา Validate ก่อนถึงจะแสดงผลลัพธ์จริงที่นี่ได้
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
