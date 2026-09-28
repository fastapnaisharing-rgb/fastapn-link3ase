// VatReconcileDashboard.js
// ============================================================================
// FASTAPN Link3ase — หน้า Dashboard ของ Feature Reconcile รายงานภาษีซื้อ
//
// ใช้งาน:
//   import VatReconcileDashboard from './VatReconcileDashboard';
//   <VatReconcileDashboard defaultPeriod="2026-08" />
//
// โครงสร้าง:
//   - โซนซ้าย (ใหญ่กว่า): 2 Tab -- "Dashboard" (ตารางสถานะ) / "Upload File" (VatReconcileSystem)
//   - โซนขวา (เล็กกว่า): ว่างไว้ก่อน รอ Confirm Content (ตาม Mockup)
//   - ตาราง Sort จาก Upload ล่าสุดขึ้นก่อนเสมอ (BU ที่ยังไม่มีข้อมูลเลย อยู่ท้ายสุด เรียงชื่อ)
//   - แสดง List เต็มทุก BU (ไม่ Limit จำนวนแถวแล้ว)
//
// ⚠️ TODO:
//   - Column Simple 100 / Simple AVG จะโชว์ Inactive เสมอ (ยังไม่มี Feature นี้)
//   - Period ตอนนี้เป็น Month Picker ธรรมดา ยังไม่ผูกกับ Period ปัจจุบันของระบบจริง
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import VatReconcileSystem from './VatReconcileSystem';

const VAT_RECONCILE_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

async function fetchDashboardStatus(period) {
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/status?period=${encodeURIComponent(period)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
  }
  return data;
}

async function fetchAvailablePeriods() {
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/periods`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return data.periods || [];
}

// แปลง "2026-08" (Format ที่ใช้เก็บจริงทั่วทั้ง Component) -> "AUG-26" (Format ที่โชว์ให้ User เห็นเฉยๆ)
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function formatPeriodLabel(period) {
  const m = (period || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return period;
  const monthIndex = parseInt(m[2], 10) - 1;
  const yy = m[1].slice(2);
  return `${MONTH_ABBR[monthIndex] || m[2]}-${yy}`;
}

// แปลงชื่อ Report ที่โชว์ใน Dropdown -> type Query String ที่ Backend ต้องการ
const REPORT_LABEL_TO_TYPE = {
  'Trial Balance Report': 'tb',
  'Input Summary Report': 'input_summary',
  'Input Reconcile Report': 'reconcile',
  'Simple 100 Report': 'simple_100',
  'Simple AVG Report': 'simple_avg',
};

async function fetchReportPreview({ type, bu, account, period, view, branch }) {
  const token = sessionStorage.getItem('fastapn_token');
  const params = new URLSearchParams({ type, bu, account, period });
  if (view) params.set('view', view);
  if (branch) params.set('branch', branch); // DASHBOARD_SIMPLE_HEADER_AND_BRANCH_DETAIL_PATCH_APPLIED -- กรอง Detail เฉพาะสาขา
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
  }
  return data;
}

function StatusDot({ active }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: active ? 'radial-gradient(circle at 30% 30%, #4ac26b, #1a7f37)' : '#e1e4e8',
        boxShadow: active ? '0 0 6px rgba(26,127,55,0.5)' : 'none',
      }}
      aria-label={active ? 'Active' : 'Inactive'}
    />
  );
}

function ReadyBadge({ ready }) {
  if (ready) {
    return (
      <span style={{
        background: 'linear-gradient(135deg, #2ea043, #1a7f37)', color: '#fff',
        fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
      }}>
        ✓ พร้อม
      </span>
    );
  }
  return (
    <span style={{
      background: '#fff1e0', color: '#bc4c00', border: '1px solid #ffd8a8',
      fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
    }}>
      ยังไม่พร้อม
    </span>
  );
}

function GroupBadge({ group }) {
  const isAsset = group === 'Asset';
  const bg = isAsset ? 'linear-gradient(135deg, #54aeff, #0969da)' : 'linear-gradient(135deg, #f0c000, #bf8700)';
  return (
    <span style={{ background: bg, color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
      {group}
    </span>
  );
}

function StatusRow({ r, index }) {
  return (
    <tr style={{ borderBottom: '0.5px solid #eee', background: index % 2 === 0 ? '#fff' : '#fafbfc' }}>
      <td style={{ padding: '8px 4px', fontWeight: 600, color: '#24292f' }}>{r.label}</td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
        {r.merged ? (
          <span style={{
            fontSize: 11, color: '#57606a', background: '#eaeef2',
            padding: '3px 10px', borderRadius: 20,
          }}>
            ทุกกลุ่ม
          </span>
        ) : (
          <GroupBadge group={r.group} />
        )}
      </td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}><StatusDot active={r.tb_active} /></td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}><StatusDot active={r.input_summary_active} /></td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}><StatusDot active={r.simple_100_active} /></td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}><StatusDot active={r.simple_avg_active} /></td>
      <td style={{ padding: '8px 4px', textAlign: 'center' }}><ReadyBadge ready={r.ready} /></td>
    </tr>
  );
}

/**
 * ถ้า BU ไหนไม่มีข้อมูลเลยสักกลุ่ม (Asset และ Expense Inactive ทั้งคู่) -> รวมเป็น 1 แถว (merged:true)
 * ถ้ามีข้อมูลอย่างน้อย 1 กลุ่ม -> คงแยกแสดงตามกลุ่มปกติ (ไม่แตะ)
 * กันดูรกตาตอนที่ BU ส่วนใหญ่ยังไม่มีข้อมูลอะไรเลย (ตามที่คุยกันในแชท)
 */
function buildDisplayRows(rows) {
  const byLabel = new Map();
  for (const r of rows) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label).push(r);
  }

  const result = [];
  for (const [label, group] of byLabel) {
    const anyActive = group.some(
      (r) => r.tb_active || r.input_summary_active || r.simple_100_active || r.simple_avg_active
    );
    if (anyActive) {
      result.push(...group);
    } else {
      const first = group[0];
      result.push({
        ...first,
        merged: true,
        group: null,
        tb_active: false,
        input_summary_active: false,
        simple_100_active: false,
        simple_avg_active: false,
        ready: false,
      });
    }
  }
  return result;
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 20px',
        fontSize: 14,
        fontWeight: 500,
        background: active ? '#fff' : 'transparent',
        color: active ? '#0969da' : '#666',
        border: 'none',
        borderBottom: active ? '2px solid #0969da' : '2px solid transparent',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function LetterFilterButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 28,
        padding: '4px 8px',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        background: active ? '#0969da' : '#fff',
        color: active ? '#fff' : '#57606a',
        border: `1px solid ${active ? '#0969da' : '#d0d7de'}`,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function CommandCenterField({ label, value, onChange, options, formatLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{
        flex: '0 0 42%', background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', border: '1px solid #d0d7de', borderRadius: 8,
        padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: '#334155', fontWeight: 600, fontSize: 12 }}>{label}</span>
        <span style={{ color: '#334155', fontWeight: 600 }}>›</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1, background: '#fff', color: '#24292f', border: '1px solid #d0d7de', borderRadius: 8,
          padding: '9px 10px', fontSize: 13, cursor: 'pointer',
        }}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{formatLabel ? formatLabel(opt) : opt}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * เหมือน CommandCenterField แต่ใช้ <input list> + <datalist> (Combobox ของ Browser เอง)
 * แทน <select> ธรรมดา -- แก้ปัญหา List ยาวเกินไปตอนมี Option เยอะ (Browser จะจำกัดความสูงเอง)
 * และรองรับพิมพ์ค่าที่ไม่อยู่ใน List ได้ (ใช้กับ resolveFn แปลงค่าอัตโนมัติ เช่น เลข BU -> ชื่อย่อ)
 */
function CommandCenterCombobox({ label, value, onChange, options, resolveFn }) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  // filterQuery แยกจาก value จริง -- รีเซ็ตเป็นค่าว่างทุกครั้งที่เปิด List ใหม่ (Focus/Click)
  // กันปัญหา List ถูกกรองด้วยค่าที่เลือกไว้เดิมทันทีที่เปิด (ต้องพิมพ์ใหม่จริงๆ ถึงจะกรอง)
  const [filterQuery, setFilterQuery] = useState('');
  const wrapperRef = useRef(null);
  const blurTimerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = filterQuery
    ? options.filter((opt) => opt.toLowerCase().includes(filterQuery.toLowerCase()))
    : options;

  const handleInputChange = (raw) => {
    setHighlightIndex(-1);
    setFilterQuery(raw); // เริ่มพิมพ์จริง -> เริ่มกรองจากตรงนี้
    if (resolveFn) {
      const resolved = resolveFn(raw);
      onChange(resolved !== null ? resolved : raw);
      return;
    }
    onChange(raw);
  };

  const handlePick = (opt) => {
    onChange(opt);
    setIsOpen(false);
    setHighlightIndex(-1);
    setFilterQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightIndex >= 0 && filtered[highlightIndex]) {
        e.preventDefault();
        handlePick(filtered[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    // หน่วงเล็กน้อยกัน onMouseDown ของ Option ไม่ทันทำงานก่อนปิด (Blur ยิงก่อน Click เสมอถ้าไม่หน่วง)
    blurTimerRef.current = setTimeout(() => setIsOpen(false), 120);
  };
  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setFilterQuery(''); // เปิด List ใหม่ -> โชว์ครบทุกตัวก่อนเสมอ ไม่กรองด้วยค่าที่เลือกไว้เดิม
    setIsOpen(true);
  };

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
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onClick={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์หรือเลือก..."
          style={{
            width: '100%', boxSizing: 'border-box', background: '#fff', color: '#24292f',
            border: '1px solid #d0d7de', borderRadius: 8, padding: '9px 26px 9px 10px', fontSize: 13,
          }}
        />
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: '#57606a', fontSize: 11,
        }}>
          ▼
        </span>
        {isOpen && filtered.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
            background: '#fff', border: '1px solid #d0d7de', borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 160, overflowY: 'auto',
          }}>
            {filtered.map((opt, i) => (
              <div
                key={opt}
                onMouseDown={() => handlePick(opt)}
                onMouseEnter={() => setHighlightIndex(i)}
                style={{
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: '#24292f',
                  background: i === highlightIndex ? '#f0f6ff' : '#fff',
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export default function VatReconcileDashboard({ defaultPeriod }) {
  const [period, setPeriod] = useState(defaultPeriod || new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'upload'
  const [letterFilter, setLetterFilter] = useState('All');

  // ── Command Center (Zone ขวา) -- Period ใช้ State เดียวกับ Date Picker บนสุด (Sync กัน)
  //    Account Code / Business Unit ควบคุมตัวกรองของตาราง Dashboard จริง
  //    Mode (ตอนนี้คือ Report ที่จะเลือกดู Preview)
  const [ccAccountCode, setCcAccountCode] = useState('');
  const [ccBusinessUnit, setCcBusinessUnit] = useState('');
  const [ccMode, setCcMode] = useState('');
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewView] = useState('detail'); // Input Summary Report โชว์ Detail เสมอ (ตัด Summary ออกแล้ว)

  // DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- Modal ดู Detail เต็มจอ ของ Simple 100/AVG (แยก State จาก previewData หลัก)
  const [simpleDetailModal, setSimpleDetailModal] = useState(null); // null | { loading, error, data }
  const SIMPLE_REPORT_TYPES = new Set(['simple_100', 'simple_avg']);

  const loadStatus = useCallback(async (p) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const data = await fetchDashboardStatus(p);
      setRows(data.rows || []);
    } catch (err) {
      console.error('VatReconcileDashboard load error:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดระหว่างโหลดสถานะ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Period ว่างเปล่าด้วยเหตุผลใดก็ตาม -> Default กลับเป็นเดือนปัจจุบันอัตโนมัติ กันยิง Request ว่างไป Backend
    if (!period) {
      setPeriod(new Date().toISOString().slice(0, 7));
      return;
    }
    loadStatus(period);
    setCcBusinessUnit(''); // Period เปลี่ยน -> เคลียร์ Business Unit ที่เลือกไว้ กัน BU ค้างที่ไม่มีข้อมูลใน Period ใหม่
  }, [period, loadStatus]);

  // โหลดรายการ Period ที่มีข้อมูลจริง (จาก TB/Input Summary) ครั้งเดียวตอนเปิดหน้า
  useEffect(() => {
    fetchAvailablePeriods().then(setAvailablePeriods);
  }, []);

  const handleCommitSuccess = useCallback(() => {
    setActiveTab('dashboard'); // Commit สำเร็จ -> สลับกลับไป Tab Dashboard
    loadStatus(period); // Refresh ตารางให้เห็นข้อมูลใหม่ (จะขึ้นบนสุดเพราะ Sort จาก Upload ล่าสุด)
    fetchAvailablePeriods().then(setAvailablePeriods); // เผื่อ Commit เข้า Period ใหม่ที่ยังไม่เคยมีข้อมูลมาก่อน
  }, [period, loadStatus]);

  // รีเซ็ต Command Center กลับเป็นค่า Default ทั้งหมด (Period กลับไปเดือนปัจจุบัน, Field อื่นว่างหมด)
  const handleClearCommandCenter = useCallback(() => {
    setPeriod(defaultPeriod || new Date().toISOString().slice(0, 7));
    setCcAccountCode('');
    setCcBusinessUnit('');
    setCcMode('');
    setPreviewData(null);
    setPreviewError('');
    setSimpleDetailModal(null);
  }, [defaultPeriod]);

  // DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- เปิด Popup เต็มจอ ดึง Detail ราย Invoice ของ Simple 100/AVG
  const handleViewSimpleDetail = useCallback(async (branch) => {
    const type = REPORT_LABEL_TO_TYPE[ccMode];
    if (!type || !ccBusinessUnit || !ccAccountCode) return;
    setSimpleDetailModal({ loading: true, error: '', data: null, branch: branch || null });
    try {
      const data = await fetchReportPreview({ type, bu: ccBusinessUnit, account: ccAccountCode, period, view: 'detail', branch });
      setSimpleDetailModal({ loading: false, error: '', data, branch: branch || null });
    } catch (err) {
      console.error('VatReconcileDashboard simple detail error:', err);
      setSimpleDetailModal({ loading: false, error: err?.message || 'เกิดข้อผิดพลาดระหว่างดึง Detail', data: null, branch: branch || null });
    }
  }, [ccMode, ccBusinessUnit, ccAccountCode, period]);

  const handlePreview = useCallback(async (viewOverride) => {
    const type = REPORT_LABEL_TO_TYPE[ccMode];
    if (!type || !ccBusinessUnit || !ccAccountCode) return;
    const view = viewOverride || (type === 'input_summary' ? previewView : SIMPLE_REPORT_TYPES.has(type) ? 'summary' : undefined);

    setPreviewLoading(true);
    setPreviewError('');
    try {
      // ส่ง ccBusinessUnit ตรงๆ ได้เลย (ไม่ว่าจะเป็นชื่อย่อ "BTM" หรือเลข "3218")
      // Backend (resolveBuToNumeric) จัดการแปลงให้เองแล้ว ไม่ต้องทำซ้ำฝั่ง Frontend
      const data = await fetchReportPreview({ type, bu: ccBusinessUnit, account: ccAccountCode, period, view });
      setPreviewData(data);
    } catch (err) {
      console.error('VatReconcileDashboard preview error:', err);
      setPreviewError(err?.message || 'เกิดข้อผิดพลาดระหว่างดึง Report');
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [ccMode, ccBusinessUnit, ccAccountCode, period, previewView]);

  // สลับ Summary/Invoice Detail หลังมี Preview ของ Input Summary Report อยู่แล้ว -- Fetch ใหม่ตาม View ที่เลือก
  const displayRows = buildDisplayRows(rows);

  // ── แถบตัวอักษร A-Z: โชว์เฉพาะตัวอักษรที่มี BU ขึ้นต้นด้วยตัวนั้นจริง (ไม่โชว์ตัวที่ไม่มี) ──
  const availableLetters = [...new Set(displayRows.map((r) => (r.label || '').charAt(0).toUpperCase()))]
    .filter(Boolean)
    .sort();

  // ── รวมตัวกรองทั้งหมด: ตัวอักษร (แถบด้านบน) + Business Unit และ Account Code (จาก Command Center) ──
  const filteredRows = displayRows.filter((r) => {
    if (letterFilter !== 'All' && !(r.label || '').toUpperCase().startsWith(letterFilter)) return false;
    if (ccBusinessUnit && r.label !== ccBusinessUnit) return false;
    if (ccAccountCode && r.account !== ccAccountCode) return false;
    return true;
  });

  // ── รายชื่อ BU สำหรับ Combobox: กรองเหลือเฉพาะ BU ที่มีข้อมูลจริงใน Period ที่เลือกอยู่เท่านั้น
  //    (ถ้า Period นั้นไม่มี BU ไหนมีข้อมูลเลย -> List ว่างเปล่าไปเลย ไม่มี Fallback โชว์ทุก BU แล้ว) ──
  const buHasData = (label) => rows.some(
    (r) => r.label === label && (r.tb_active || r.input_summary_active || r.simple_100_active || r.simple_avg_active)
  );
  const allBuLabels = [...new Set(rows.map((r) => r.label))].sort();
  const businessUnitOptions = allBuLabels.filter(buHasData);

  // ── Report ที่ดึงได้: แยกดูรายงานดิบแต่ละตัวได้ตามที่มีข้อมูลจริง + Report เปรียบเทียบรวม (ถ้าพร้อม Reconcile แล้ว) ──
  // ต้องเลือกทั้ง Business Unit และ Account Code ก่อน ถึงจะรู้ว่ามี Report ให้ดึงไหม
  const selectedCcRow = (ccBusinessUnit && ccAccountCode)
    ? rows.find((r) => r.label === ccBusinessUnit && r.account === ccAccountCode)
    : null;
  const reportOptions = selectedCcRow
    ? [
        selectedCcRow.tb_active && 'Trial Balance Report',
        selectedCcRow.input_summary_active && 'Input Summary Report',
        selectedCcRow.simple_100_active && 'Simple 100 Report',
        selectedCcRow.simple_avg_active && 'Simple AVG Report',
        selectedCcRow.ready && 'Input Reconcile Report', // Report เปรียบเทียบรวม TB vs Input Summary/Simple
      ].filter(Boolean)
    : [];

  return (
    <div style={{ padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, height: '35vh', flexShrink: 0 }}>
        {/* โซนซ้าย: 2 Tab -- Dashboard / Upload File */}
        <div style={{
          background: '#f7f7f7', border: '0.5px solid #ddd', borderRadius: 12, overflow: 'hidden',
          height: '100%', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', borderBottom: '0.5px solid #ddd', background: '#fff', flexShrink: 0 }}>
            <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
              Dashboard
            </TabButton>
            <TabButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')}>
              Upload File
            </TabButton>
          </div>

          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
            {activeTab === 'dashboard' && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, flexShrink: 0 }}>
                  <LetterFilterButton active={letterFilter === 'All'} onClick={() => setLetterFilter('All')}>
                    All
                  </LetterFilterButton>
                  {availableLetters.map((letter) => (
                    <LetterFilterButton key={letter} active={letterFilter === letter} onClick={() => setLetterFilter(letter)}>
                      {letter}
                    </LetterFilterButton>
                  ))}
                </div>

                {loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
                {errorMessage && <p style={{ fontSize: 13, color: '#a30d16' }}>{errorMessage}</p>}

                {!loading && !errorMessage && (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'left', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>BU</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>กลุ่ม</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>TB</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>Input<br />Summary</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>Simple<br />100</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>Simple<br />AVG</th>
                          <th style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'center', padding: '6px 4px', color: '#334155', fontWeight: 600 }}>พร้อม<br />Reconcile</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.length === 0 && (
                          <tr>
                            <td colSpan={7} style={{ padding: '16px 4px', textAlign: 'center', color: '#999' }}>
                              ไม่พบ BU ที่ตรงกับตัวกรอง
                            </td>
                          </tr>
                        )}
                        {filteredRows.map((r, i) => (
                          <StatusRow key={`${r.bu}-${r.group || 'merged'}-${i}`} r={r} index={i} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab === 'upload' && (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <VatReconcileSystem onCommitSuccess={handleCommitSuccess} />
              </div>
            )}
          </div>
        </div>

        {/* โซนขวา: Reconcile Command Center -- พื้นขาว, Label เป็น Gradient เดียวกับหัวตาราง Dashboard */}
        <div style={{
          border: '0.5px solid #ddd', borderRadius: 12, height: '100%',
          background: '#fff', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '1rem 1.25rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#334155', margin: '0 0 12px' }}>
                Reconcile Control Zone
              </p>
              <CommandCenterField label="PERIOD" value={period} onChange={setPeriod}
                options={availablePeriods.length > 0 ? availablePeriods : [period]}
                formatLabel={formatPeriodLabel} />
              <CommandCenterCombobox
                label="BUSINESS UNIT"
                value={ccBusinessUnit}
                onChange={setCcBusinessUnit}
                options={businessUnitOptions}
                resolveFn={(raw) => {
                  const trimmed = raw.trim();
                  // ถ้าพิมพ์เลข BU (เช่น "3218") -> Auto แปลงเป็นชื่อย่อ (เช่น "BTM") ให้เลย
                  const match = rows.find((r) => r.bu === trimmed);
                  return match ? match.label : null;
                }}
              />
              <CommandCenterField label="ACCOUNT CODE" value={ccAccountCode} onChange={setCcAccountCode}
                options={['11610752', '11610755']} />
              <CommandCenterField label="REPORT" value={ccMode} onChange={setCcMode}
                options={reportOptions} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={!ccMode}
                onClick={() => handlePreview()}
                style={{
                  flex: 1, padding: '11px', fontSize: 14, fontWeight: 700,
                  background: ccMode
                    ? 'linear-gradient(135deg, #2ea043, #1a7f37)'
                    : 'linear-gradient(135deg, #b8bfc7, #9aa2ab)',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: ccMode ? 'pointer' : 'not-allowed', flexShrink: 0,
                }}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={handleClearCommandCenter}
                style={{
                  flex: '0 0 30%', padding: '11px', fontSize: 14, fontWeight: 600,
                  background: '#fff', color: '#cf222e', border: '1px solid #ff9d9d',
                  borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Zone Preview: แยก Title/Toggle (คงที่ ไม่ Scroll) ออกจากตาราง (Scroll เฉพาะส่วนนี้ พร้อมหัว Column ตรึง) */}
      <div style={{
        marginTop: 16, border: '0.5px solid #ddd', borderRadius: 12,
        background: '#fff', padding: '1.25rem', flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: 0 }}>
            {previewData || previewLoading || previewError
              ? `${ccMode} · ${ccBusinessUnit} · ${formatPeriodLabel(period)}`
              : 'Preview'}
          </p>
          {(previewData || previewError) && (
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => { setPreviewData(null); setPreviewError(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666' }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {previewLoading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
          {previewError && <p style={{ fontSize: 13, color: '#a30d16' }}>{previewError}</p>}
          {!previewLoading && !previewError && previewData && (
            // DASHBOARD_SIMPLE_SUMMARY_FINAL_COLUMNS_PATCH_APPLIED -- ตัด Header Card ออก ใช้ Column ในตารางแทน
            <ReportPreviewTable
              data={previewData}
              onRowAction={SIMPLE_REPORT_TYPES.has(previewData.type) ? (row) => handleViewSimpleDetail(row.branch) : undefined}
              actionLabel="ดู Detail"
            />
          )}
          {!previewLoading && !previewError && !previewData && (
            <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '40px 0' }}>
              เลือก Business Unit, Account Code และ Report แล้วกด Preview เพื่อดูผลลัพธ์ที่นี่
            </p>
          )}
        </div>
      </div>

      {/* DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- Modal เต็มจอ ดู Detail ราย Invoice ของ Simple 100/AVG */}
      {simpleDetailModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setSimpleDetailModal(null)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 12, width: '95vw', height: '92vh',
              display: 'flex', flexDirection: 'column', padding: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: 0 }}>
                Detail · {ccMode} · {ccBusinessUnit}{simpleDetailModal.branch ? ` · สาขา ${simpleDetailModal.branch}` : ''} · {formatPeriodLabel(period)}
              </p>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setSimpleDetailModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {simpleDetailModal.loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
              {simpleDetailModal.error && <p style={{ fontSize: 13, color: '#a30d16' }}>{simpleDetailModal.error}</p>}
              {!simpleDetailModal.loading && !simpleDetailModal.error && simpleDetailModal.data && (
                <ReportPreviewTable data={simpleDetailModal.data} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const COLUMN_LABELS = {
  branch: 'Branch',
  cpc: 'CPC',
  account: 'Account',
  subacc: 'SubAcc',
  description: 'Description',
  beginning_balance: 'Beginning Balance',
  period_activity: 'Period Activity',
  ending_balance: 'Ending Balance',
  claimed100_amount: 'ภาษีซื้อที่ใช้สิทธิ์ 100% (มูลค่าสินค้า)',
  claimed100_vat: 'ภาษีซื้อที่ใช้สิทธิ์ 100% (เงินภาษี)',
  // DASHBOARD_SIMPLE_REPORT_LABELS_PATCH_APPLIED
  claimed_amount: 'มูลค่าที่ใช้สิทธิ์',
  claimed_vat: 'ภาษีที่ใช้สิทธิ์',
  tax_type_code: 'Tax Type',
  invoice_count: 'จำนวน Invoice',
  tb_amount: 'ยอด TB',
  input_summary_amount: 'ยอด Input Summary',
  difference: 'ผลต่าง',
  status: 'สถานะ',
  operator_name: 'ชื่อผู้ประกอบการ',
  // DASHBOARD_SIMPLE_SUMMARY_FINAL_COLUMNS_PATCH_APPLIED
  // DASHBOARD_SIMPLE_ENGLISH_LABELS_PATCH_APPLIED
  company_tax_id: 'Tax ID',
  branch_no: 'No.',
  claim_percent: '%',
  receive_date: 'วันที่ (รับสินค้า)',
  grt_no: 'GRT_No. (รับสินค้า)',
  tax_invoice_date: 'วันที่ใบกำกับภาษี',
  tax_invoice_no: 'เลขที่ใบกำกับภาษี',
  vendor_name: 'ชื่อผู้ค้า',
  tax_id: 'TAX ID',
  ho: 'HO',
  branch_field: 'BRANCH',
  item_detail: 'รายการ',
  paid_amount: 'ภาษีซื้อที่ชำระ (มูลค่าสินค้า)',
  paid_vat: 'ภาษีซื้อที่ชำระ (เงินภาษี)',
  calculate_tax: 'Calculate Tax (M-O)',
};

function ReportPreviewTable({ data, onRowAction, actionLabel }) {
  if (!data.rows || data.rows.length === 0) {
    return <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '24px 0' }}>ไม่พบข้อมูล</p>;
  }
  const columns = Object.keys(data.rows[0]);

  // Column ที่เป็นรหัส/เลขอ้างอิง (ไม่ใช่ยอดเงิน) แม้จะดูเป็นตัวเลขก็ไม่ต้อง Format/ชิดขวา
  // RUNNING_NO_FORMAT_FIX_PATCH_APPLIED -- running_no เป็น ID ไม่ใช่จำนวนเงิน ห้าม Format Comma/ทศนิยม
  // CLAIM_PERCENT_PLAIN_TEXT_PATCH_APPLIED -- claim_percent โชว์เป็น Text ดิบ (เช่น "100") ไม่บังคับทศนิยม
  // DASHBOARD_SIMPLE_DISPLAY_POLISH_PATCH_APPLIED -- company_tax_id/branch_no เป็น ID ไม่ใช่จำนวนเงิน ห้าม Format ตัวเลข
  const ID_COLUMNS = new Set(['cpc', 'account', 'subacc', 'grt_no', 'tax_id', 'tax_invoice_no', 'ho', 'branch_field', 'running_no', 'claim_percent', 'company_tax_id', 'branch_no']);

  // เช็คแบบทนทาน: รับได้ทั้ง Number จริง (Backend Cast แล้ว) และ String ตัวเลข (เผื่อ Backend ยังไม่ Cast)
  // กันปัญหา Backend Deploy ไม่ทัน Frontend แล้วตัวเลขไม่ชิดขวา/ไม่มี Comma
  const toNumericOrNull = (v, colName) => {
    if (ID_COLUMNS.has(colName)) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return null;
  };
  const isNumericColumn = (c) => toNumericOrNull(data.rows[0][c], c) !== null;

  // Column "branch" ใช้ Label ต่างกันตามชนิด Report: TB ต้องเป็น "Branch" (อังกฤษ, ตรงไฟล์ Recon_TB)
  // ส่วน Input Summary ต้องเป็น "สาขา" (ไทย, ตรงไฟล์ Detail Sheet) -- Report อื่นๆ ใช้ตาม COLUMN_LABELS ปกติ
  // DASHBOARD_SIMPLE_ALL_ENGLISH_HEADERS_PATCH_APPLIED -- Header ภาษาอังกฤษทั้งตาราง เฉพาะ Report Simple 100/AVG
  // (ไม่แตะ COLUMN_LABELS Global กันกระทบ Report อื่นที่ใช้ Field ชื่อเดียวกัน เช่น TB/Input Summary)
  const SIMPLE_REPORT_LABELS = {
    branch: 'Branch code',
    operator_name: 'Company name',
    company_tax_id: 'Tax ID',
    branch_no: 'No.',
    invoice_count: 'Invoice count',
    claimed_amount: 'Claimed amount',
    claimed_vat: 'Claimed VAT',
    claim_percent: '%',
  };
  const isSimpleReport = data.type === 'simple_100' || data.type === 'simple_avg';
  const getLabel = (c) => {
    if (isSimpleReport && SIMPLE_REPORT_LABELS[c]) return SIMPLE_REPORT_LABELS[c];
    if (c === 'branch' && data.type === 'tb') return 'Branch';
    if (c === 'branch') return 'สาขา';
    return COLUMN_LABELS[c] || c;
  };

  const statusColor = (status) => {
    if (status === 'ตรงกัน') return { bg: '#dafbe1', color: '#1a7f37' };
    if (status === 'ไม่ตรงกัน') return { bg: '#fff1e0', color: '#bc4c00' };
    return { bg: '#f2f2f2', color: '#666' }; // ไม่มี TB / ไม่มี Input Summary
  };

  return (
    <div>
      {data.summary && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, background: '#eaeef2', color: '#57606a', padding: '4px 12px', borderRadius: 20 }}>
            ทั้งหมด {data.summary.total} สาขา
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, background: '#dafbe1', color: '#1a7f37', padding: '4px 12px', borderRadius: 20 }}>
            ✓ ตรงกัน {data.summary.matched}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, background: '#fff1e0', color: '#bc4c00', padding: '4px 12px', borderRadius: 20 }}>
            ⚠ ไม่ตรงกัน {data.summary.mismatched}
          </span>
          {data.summary.missing > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, background: '#f2f2f2', color: '#666', padding: '4px 12px', borderRadius: 20 }}>
              ข้อมูลไม่ครบ {data.summary.missing}
            </span>
          )}
        </div>
      )}

      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', border: '1px solid #d0d7de' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={{
                position: 'sticky', top: 0,
                background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)',
                textAlign: isSimpleReport ? 'center' : (isNumericColumn(c) ? 'right' : 'left'),
                padding: '8px 12px', color: '#334155', fontWeight: 600,
                zIndex: 1, whiteSpace: 'nowrap',
                border: '1px solid #d0d7de',
              }}>
                {getLabel(c)}
              </th>
            ))}
            {onRowAction && (
              <th style={{
                position: 'sticky', top: 0,
                background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)',
                textAlign: isSimpleReport ? 'center' : 'left',
                padding: '8px 12px', color: '#334155', fontWeight: 600,
                border: '1px solid #d0d7de', zIndex: 1, whiteSpace: 'nowrap',
              }}>
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
              {columns.map((c) => {
                if (c === 'status') {
                  const sc = statusColor(r[c]);
                  return (
                    <td key={c} style={{ padding: '8px 12px', border: '1px solid #eaeef2' }}>
                      <span style={{ background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                        {r[c]}
                      </span>
                    </td>
                  );
                }
                if (c === 'branch') {
                  return (
                    <td key={c} style={{ padding: '8px 12px', fontWeight: 600, color: '#24292f', border: '1px solid #eaeef2', whiteSpace: 'nowrap' }}>
                      {r[c]}
                    </td>
                  );
                }
                // DASHBOARD_SIMPLE_DETAIL_FORMAT_FIX_PATCH_APPLIED
                if (c === 'branch_no' || c === 'branch_field') {
                  return (
                    <td key={c} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap' }}>
                      {String(r[c] ?? '0').padStart(5, '0')}
                    </td>
                  );
                }
                if (c === 'tax_id' || c === 'company_tax_id') {
                  return (
                    <td key={c} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap' }}>
                      {r[c] ? String(r[c]).padStart(13, '0') : ''}
                    </td>
                  );
                }
                const numVal = toNumericOrNull(r[c], c);
                const isNum = numVal !== null;
                return (
                  <td key={c} style={{
                    padding: '8px 12px', textAlign: isNum ? 'right' : 'left',
                    color: isNum ? '#24292f' : '#57606a', border: '1px solid #eaeef2',
                    whiteSpace: 'nowrap',
                    overflow: isNum ? 'visible' : 'hidden',
                    textOverflow: isNum ? 'clip' : 'ellipsis',
                    maxWidth: isNum ? 'none' : 280,
                  }}>
                    {isNum ? numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(r[c] ?? '')}
                  </td>
                );
              })}
              {onRowAction && (
                <td style={{ padding: '8px 12px', border: '1px solid #eaeef2', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => onRowAction(r)}
                    style={{
                      fontSize: 12, fontWeight: 600, color: '#1a56db', background: '#eef2ff',
                      border: '1px solid #c7d2fe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                    }}
                  >
                    {actionLabel || 'Detail'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}