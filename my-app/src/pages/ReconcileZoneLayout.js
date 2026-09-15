import React, { useState, useRef, useEffect, useMemo } from 'react';
import VatReconcileSystem from './VatReconcileSystem';

// ══════════════════════════════════════════════════════════════════════════
// ReconcileZoneLayout.js — Shared Component สำหรับหน้า Reconcile ทุกโมดูล
// ══════════════════════════════════════════════════════════════════════════
// MARKER_RECONCILE_ZONE_LAYOUT_V3 — เขียนใหม่ทั้งไฟล์ โดย "ก๊อป" Layout/CSS
// มาจาก VatReconcileDashboard.js (ไฟล์จริงที่ใช้งานอยู่) ตรงๆ แทนที่จะกะสัดส่วน
// เอง — จุดที่ก๊อปมาเป๊ะ: Grid 1.3fr/1fr, height 35vh ของแถวบน, สี/Gradient,
// TabButton, LetterFilterButton, CommandCenter Field/Combobox, StatusDot,
// ReadyBadge, GroupBadge, โครง Preview Zone ด้านล่าง
//
// สิ่งที่ยังไม่ก๊อปมา (ตั้งใจ เพราะ AP ยังไม่มี Backend ของตัวเอง):
//   - Logic Merge แถวที่ไม่มีข้อมูลเลย (buildDisplayRows), Filter ตาราง Dashboard
//     ตาม Account Code ที่เลือกใน Control Zone, Report Options ที่คำนวณสด
//     จาก Row จริง — พวกนี้ผูกกับรูปร่างข้อมูล Backend ของ VAT โดยเฉพาะ
//     รอ Endpoint ฝั่ง AP (ap_cutting_staging) ค่อยออกแบบให้ตรงจริงทีหลัง
//
// รับ Config ผ่าน Props เพื่อให้โมดูลอื่นใช้ซ้ำได้ ไม่ผูกกับ AP โดยเฉพาะ
// ══════════════════════════════════════════════════════════════════════════

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

function LetterFilterButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      minWidth: 28, padding: '4px 8px', fontSize: 12, fontWeight: active ? 700 : 500,
      background: active ? '#0969da' : '#fff', color: active ? '#fff' : '#57606a',
      border: `1px solid ${active ? '#0969da' : '#d0d7de'}`, borderRadius: 6, cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: active ? 'radial-gradient(circle at 30% 30%, #4ac26b, #1a7f37)' : '#e1e4e8',
      boxShadow: active ? '0 0 6px rgba(26,127,55,0.5)' : 'none',
    }} aria-label={active ? 'Active' : 'Inactive'} />
  );
}

function ReadyBadge({ ready }) {
  if (ready) {
    return (
      <span style={{ background: 'linear-gradient(135deg, #2ea043, #1a7f37)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
        ✓ พร้อม
      </span>
    );
  }
  return (
    <span style={{ background: '#fff1e0', color: '#bc4c00', border: '1px solid #ffd8a8', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20 }}>
      ยังไม่พร้อม
    </span>
  );
}

function GroupChip({ group }) {
  if (!group) {
    return (
      <span style={{ fontSize: 11, color: '#57606a', background: '#eaeef2', padding: '3px 10px', borderRadius: 20 }}>
        ทุกกลุ่ม
      </span>
    );
  }
  return (
    <span style={{ background: 'linear-gradient(135deg, #54aeff, #0969da)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
      {group}
    </span>
  );
}

function ReconcileFieldRow({ label, value, onChange, options, formatLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{
        flex: '0 0 42%', background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: '#334155', fontWeight: 600, fontSize: 12 }}>{label}</span>
        <span style={{ color: '#334155', fontWeight: 600 }}>›</span>
      </div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        flex: 1, background: '#fff', color: '#24292f', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '9px 10px', fontSize: 13, cursor: 'pointer',
      }}>
        <option value="">—</option>
        {options.map(opt => <option key={opt} value={opt}>{formatLabel ? formatLabel(opt) : opt}</option>)}
      </select>
    </div>
  );
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
      <div style={{
        flex: '0 0 42%', background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: '#334155', fontWeight: 600, fontSize: 12 }}>{label}</span>
        <span style={{ color: '#334155', fontWeight: 600 }}>›</span>
      </div>
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

export default function ReconcileZoneLayout({
  statusColumns = [],   // [{ key, label }] — คอลัมน์สถานะใน BU-Grid เช่น AP Cutting / TB
  accountOptions = [],  // [string] — รหัสบัญชีล้วนๆ (ตรงกับที่ Dropdown จริงใช้ ไม่มี Label แยก)
  reportOptions = [],   // [string]
  periodOptions = [],
  period, onPeriodChange,
  buRows = [],          // [{ bu, group, statuses: { [key]: boolean }, ready: boolean }]
}) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [letterFilter, setLetterFilter] = useState('All');
  const [ccBusinessUnit, setCcBusinessUnit] = useState('');
  const [ccAccountCode, setCcAccountCode] = useState('');
  const [ccReport, setCcReport] = useState('');
  const [previewData, setPreviewData] = useState(null);

  const availableLetters = useMemo(
    () => [...new Set(buRows.map(r => (r.bu || '').charAt(0).toUpperCase()))].filter(Boolean).sort(),
    [buRows]
  );

  const filteredRows = useMemo(() => {
    return buRows.filter(r => {
      if (letterFilter !== 'All' && !(r.bu || '').toUpperCase().startsWith(letterFilter)) return false;
      return true;
    });
  }, [buRows, letterFilter]);

  const businessUnitOptions = useMemo(() => buRows.map(r => r.bu).sort(), [buRows]);

  const handlePreview = () => {
    if (!ccReport) return;
    setPreviewData({ bu: ccBusinessUnit, period, account: ccAccountCode, report: ccReport });
  };
  const handleClear = () => {
    setCcBusinessUnit(''); setCcAccountCode(''); setCcReport(''); setPreviewData(null);
  };

  return (
    <div style={{ padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, height: '35vh', flexShrink: 0 }}>

        {/* โซนซ้าย: 2 Tab -- Dashboard / Upload File */}
        <div style={{ background: '#f7f7f7', border: '0.5px solid #ddd', borderRadius: 12, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '0.5px solid #ddd', background: '#fff', flexShrink: 0 }}>
            <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>Dashboard</TabButton>
            <TabButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')}>Upload File</TabButton>
          </div>

          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
            {activeTab === 'dashboard' && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, flexShrink: 0 }}>
                  <LetterFilterButton active={letterFilter === 'All'} onClick={() => setLetterFilter('All')}>All</LetterFilterButton>
                  {availableLetters.map(letter => (
                    <LetterFilterButton key={letter} active={letterFilter === letter} onClick={() => setLetterFilter(letter)}>{letter}</LetterFilterButton>
                  ))}
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                        <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'left', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>BU</th>
                        <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>กลุ่ม</th>
                        {statusColumns.map(c => (
                          <th key={c.key} style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>{c.label}</th>
                        ))}
                        <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>พร้อม<br />Reconcile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.length === 0 && (
                        <tr><td colSpan={3 + statusColumns.length} style={{ padding: '16px 4px', textAlign: 'center', color: '#999' }}>ไม่พบ BU ที่ตรงกับตัวกรอง</td></tr>
                      )}
                      {filteredRows.map((r, i) => (
                        <tr key={r.bu} style={{ borderBottom: '0.5px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                          <td style={{ padding: '8px 4px', fontWeight: 600, color: '#24292f' }}>{r.bu}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}><GroupChip group={r.group} /></td>
                          {statusColumns.map(c => (
                            <td key={c.key} style={{ padding: '8px 4px', textAlign: 'center' }}><StatusDot active={r.statuses?.[c.key]} /></td>
                          ))}
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}><ReadyBadge ready={r.ready} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'upload' && (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <VatReconcileSystem onCommitSuccess={() => setActiveTab('dashboard')} />
              </div>
            )}
          </div>
        </div>

        {/* โซนขวา: Reconcile Control Zone */}
        <div style={{ border: '0.5px solid #ddd', borderRadius: 12, height: '100%', background: '#fff', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#334155', margin: '0 0 12px' }}>Reconcile Control Zone</p>
              <ReconcileFieldRow label="PERIOD" value={period} onChange={onPeriodChange} options={periodOptions} />
              <ReconcileCombobox label="BUSINESS UNIT" value={ccBusinessUnit} onChange={setCcBusinessUnit} options={businessUnitOptions} />
              <ReconcileFieldRow label="ACCOUNT CODE" value={ccAccountCode} onChange={setCcAccountCode} options={accountOptions} />
              <ReconcileFieldRow label="REPORT" value={ccReport} onChange={setCcReport} options={reportOptions} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={!ccReport} onClick={handlePreview} style={{
                flex: 1, padding: '11px', fontSize: 14, fontWeight: 700,
                background: ccReport ? 'linear-gradient(135deg, #2ea043, #1a7f37)' : 'linear-gradient(135deg, #b8bfc7, #9aa2ab)',
                color: '#fff', border: 'none', borderRadius: 8, cursor: ccReport ? 'pointer' : 'not-allowed', flexShrink: 0,
              }}>
                Preview
              </button>
              <button type="button" onClick={handleClear} style={{
                flex: '0 0 30%', padding: '11px', fontSize: 14, fontWeight: 600,
                background: '#fff', color: '#cf222e', border: '1px solid #ff9d9d', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
              }}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Zone Preview */}
      <div style={{ marginTop: 16, border: '0.5px solid #ddd', borderRadius: 12, background: '#fff', padding: '1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: 0 }}>
            {previewData ? `${previewData.report} · ${previewData.bu} · ${previewData.period || '—'}` : 'Preview'}
          </p>
          {previewData && (
            <button type="button" aria-label="ปิด" onClick={() => setPreviewData(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666' }}>✕</button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {previewData ? (
            <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '40px 0' }}>
              (Mockup — ยังไม่ได้ต่อ API จริง รอ Backend Endpoint ฝั่ง AP)
            </p>
          ) : (
            <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '40px 0' }}>
              เลือก Business Unit, Account Code และ Report แล้วกด Preview เพื่อดูผลลัพธ์ที่นี่
            </p>
          )}
        </div>
      </div>
    </div>
  );
}