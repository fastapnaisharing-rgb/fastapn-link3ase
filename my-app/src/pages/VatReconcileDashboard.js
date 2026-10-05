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

// MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_X_V1 -- ดึง company_list มาด้วย เพื่อเช็ค field "VAT %" ของแต่ละ BU
// (ถ้า BU ตั้งค่า VAT % = 100 แน่นอนว่าจะไม่มีทาง Upload Simple AVG ได้ เลยโชว์เป็น "X" แทน Dot เทาเฉยๆ)
// MARKER_VATRECONCILEDASHBOARD_COMPANYLIST_DEBUG_LOG_V1 -- เดิม Fail เงียบๆ (Return [] เฉยๆ ไม่ Log อะไร) ทำให้ debug ไม่ได้ว่าทำไม isBu100Percent/isAccountApplicableForBu ไม่ทำงาน
// ตอนนี้ Log เหตุผลที่ Fail ออก Console ชัดๆ + กัน Response ที่ไม่ใช่ Array ตรงๆ (เผื่อ Backend ห่อเป็น {data:[...]} แบบที่โค้ดจุดอื่นในระบบกันไว้)
async function fetchCompanyListForBuPercent() {
  const token = sessionStorage.getItem('fastapn_token');
  let res;
  try {
    res = await fetch(`${VAT_RECONCILE_API_BASE}/company_list`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    console.error('[VatReconcileDashboard] fetch /company_list network error:', err);
    return [];
  }
  if (!res.ok) {
    console.error(`[VatReconcileDashboard] fetch /company_list HTTP ${res.status} ${res.statusText}`);
    return [];
  }
  const data = await res.json().catch((err) => {
    console.error('[VatReconcileDashboard] /company_list response ไม่ใช่ JSON:', err);
    return [];
  });
  const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.rows) ? data.rows : []));
  if (!Array.isArray(data) && list.length === 0) {
    console.error('[VatReconcileDashboard] /company_list response ไม่ใช่ Array ตามที่คาด:', data);
  }
  console.log(`[VatReconcileDashboard] /company_list โหลดมา ${list.length} รายการ`, list.find((c) => c.bu === 'OOF') || '(ไม่พบ BU=OOF ใน Response)');
  return list;
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

// MARKER_VATRECONCILEDASHBOARD_READY_SIGNAL_COMPACT_V1 -- เปลี่ยนจาก Text Badge ("✓ พร้อม" / "ยังไม่พร้อม" กินพื้นที่มาก) เป็น Dot Signal สั้นๆ แบบเดียวกับ StatusDot
// เขียว = พร้อม Reconcile, ส้ม = ยังไม่พร้อม -- มี title Tooltip บอกความหมายตอน Hover
// MARKER_VATRECONCILEDASHBOARD_READY_SIGNAL_BLOCKED_ICON_V1 -- ready = Dot เขียวเหมือนเดิม, ยังไม่พร้อม = ⛔ (สื่อว่า "ห้าม Reconcile จนกว่าจะครบ")
// MARKER_VATRECONCILEDASHBOARD_READY_SIGNAL_CHECKMARK_V1 -- ready = ✅ (เครื่องหมายถูกสีเขียว แทน Dot เขียวเดิม เพื่อให้คู่กับ ⛔ ชัดเจนขึ้น)
function ReadyBadge({ ready }) {
  if (ready) {
    return (
      <span title="พร้อม Reconcile" aria-label="พร้อม Reconcile" style={{ fontSize: 13, lineHeight: 1 }}>
        ✅
      </span>
    );
  }
  return (
    <span title="ยังไม่พร้อม Reconcile" aria-label="ยังไม่พร้อม Reconcile" style={{ fontSize: 13, lineHeight: 1 }}>
      ⛔
    </span>
  );
}

// MARKER_VATRECONCILEDASHBOARD_PIVOT_BU_ACCOUNT_V1 -- GroupBadge/StatusRow (แสดงทีละแถวต่อ BU+กลุ่ม/Account) เลิกใช้แล้ว
// ถูกแทนที่ด้วยตาราง Pivot (BU = 1 แถว, Account = Column Group) ที่ Render ตรงใน JSX ของ VatReconcileDashboard เลย

/**
 * MARKER_VATRECONCILEDASHBOARD_PIVOT_BU_ACCOUNT_V1
 * Pivot ตาราง Dashboard: 1 BU = 1 แถว, Account เป็น Column Group (แทนที่จะแตกหลายแถวตาม Account เหมือนเดิม)
 * - BU ที่ไม่มีข้อมูลเลยสักกลุ่ม (ทุก Account/ทุก Report Inactive หมด) -> ไม่แสดงในตารางอีกต่อไป (ตามที่ Confirm ไว้ ให้เหมือน AP Dashboard ที่โชว์แค่ที่มีข้อมูลจริง)
 * - ถ้า BU เดียวมีหลาย Account (หรือหลาย group เช่น Asset/Expense ใน Account เดียวกัน) -> รวมสถานะด้วย OR (Active ถ้ามีอย่างน้อย 1 แหล่งที่ Active)
 */
function buildPivotRows(rows) {
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
    if (!anyActive) continue; // MARKER_VATRECONCILEDASHBOARD_HIDE_EMPTY_BU_V1 -- ไม่มีข้อมูลเลย ไม่ต้องโชว์แถวนี้

    const accMap = new Map();
    for (const r of group) {
      const acctKey = String(r.account ?? '').trim() || '—';
      if (!accMap.has(acctKey)) {
        accMap.set(acctKey, {
          account: acctKey,
          bu: r.bu,
          tb_active: false,
          input_summary_active: false,
          simple_100_active: false,
          simple_avg_active: false,
          ready: false,
        });
      }
      const cell = accMap.get(acctKey);
      cell.tb_active = cell.tb_active || !!r.tb_active;
      cell.input_summary_active = cell.input_summary_active || !!r.input_summary_active;
      cell.simple_100_active = cell.simple_100_active || !!r.simple_100_active;
      cell.simple_avg_active = cell.simple_avg_active || !!r.simple_avg_active;
      cell.ready = cell.ready || !!r.ready;
    }
    const accounts = [...accMap.values()].sort((a, b) =>
      String(a.account).localeCompare(String(b.account), undefined, { numeric: true })
    );
    result.push({ label, bu: group[0]?.bu, accounts });
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

// MARKER_VATRECONCILEDASHBOARD_REMOVE_LETTER_FILTER_V1 -- LetterFilterButton เลิกใช้แล้ว (ตัดแถบตัวอักษร A-Z ออกจาก Dashboard)

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

  // ── Command Center (Zone ขวา) -- Period ใช้ State เดียวกับ Date Picker บนสุด (Sync กัน)
  //    Account Code / Business Unit ควบคุมตัวกรองของตาราง Dashboard จริง
  //    Mode (ตอนนี้คือ Report ที่จะเลือกดู Preview)
  const [ccAccountCode, setCcAccountCode] = useState('');
  const [ccBusinessUnit, setCcBusinessUnit] = useState('');
  const [ccMode, setCcMode] = useState('');
  const [availablePeriods, setAvailablePeriods] = useState([]);
  // MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_X_V1
  const [companyList, setCompanyList] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewView] = useState('detail'); // Input Summary Report โชว์ Detail เสมอ (ตัด Summary ออกแล้ว)

  // DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- Modal ดู Detail เต็มจอ ของ Simple 100/AVG (แยก State จาก previewData หลัก)
  const [simpleDetailModal, setSimpleDetailModal] = useState(null); // null | { loading, error, data }
  const SIMPLE_REPORT_TYPES = new Set(['simple_100', 'simple_avg']);

  // MARKER_VATRECONCILEDASHBOARD_DOUBLECLICK_QUICK_PREVIEW_V1 -- Double-click ที่ช่อง TB / Input Summary ในตาราง Pivot เปิด Popup Preview ทันที (ไม่ต้องตั้งค่า Control Zone + กด Preview เอง)
  const [quickPreviewModal, setQuickPreviewModal] = useState(null); // null | { loading, error, data, type, bu, account }
  const QUICK_PREVIEW_LABEL = { tb: 'Trial Balance Report', input_summary: 'Input Summary Report' };
  const handleQuickPreview = useCallback(async (type, bu, account) => {
    setQuickPreviewModal({ loading: true, error: '', data: null, type, bu, account });
    try {
      const view = type === 'input_summary' ? 'detail' : undefined;
      const data = await fetchReportPreview({ type, bu, account, period, view });
      setQuickPreviewModal({ loading: false, error: '', data, type, bu, account });
    } catch (err) {
      console.error('VatReconcileDashboard quick preview error:', err);
      setQuickPreviewModal({ loading: false, error: err?.message || 'เกิดข้อผิดพลาดระหว่างดึง Report', data: null, type, bu, account });
    }
  }, [period]);

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

  // MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_X_V1 -- โหลด company_list ครั้งเดียวตอนเปิดหน้า เพื่อดู VAT % ของแต่ละ BU
  useEffect(() => {
    fetchCompanyListForBuPercent().then(setCompanyList).catch(() => setCompanyList([]));
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

  // MARKER_VATRECONCILEDASHBOARD_CONTROLZONE_RECONCILE_ONLY_V1 -- ตัดจุดที่ต้องเลือก REPORT Type ออก (TB/Input Summary/Simple 100/Simple AVG ดู Preview แยกได้จาก Double-click ปุ่มเขียวในตาราง Pivot อยู่แล้ว)
  // เลือก Period + Business Unit + Account Code ครบแล้ว -- ระบบรู้อยู่แล้วว่าต้อง Reconcile อะไร ไม่ต้องมี Dropdown ให้เลือก Report Type อีกชั้น -- กด Preview = เรียก "Input Reconcile Report" (type: 'reconcile') ตรงเลย
  const handlePreview = useCallback(async (viewOverride) => {
    if (!ccBusinessUnit || !ccAccountCode) return;
    const type = 'reconcile';
    const view = viewOverride;

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
  }, [ccBusinessUnit, ccAccountCode, period]);

  // MARKER_VATRECONCILEDASHBOARD_PIVOT_BU_ACCOUNT_V1 -- 1 BU = 1 แถว, Account เป็น Column Group, ไม่โชว์ BU ที่ไม่มีข้อมูล
  const pivotRows = buildPivotRows(rows);

  // ── ตัวกรอง: Business Unit และ Account Code (จาก Command Center) -- MARKER_VATRECONCILEDASHBOARD_REMOVE_LETTER_FILTER_V1 ตัดตัวกรองตัวอักษรออกแล้ว ──
  const filteredPivotRows = pivotRows.filter((r) => {
    if (ccBusinessUnit && r.label !== ccBusinessUnit) return false;
    if (ccAccountCode && !r.accounts.some((a) => a.account === ccAccountCode)) return false;
    return true;
  });

  // MARKER_VATRECONCILEDASHBOARD_PIN_ACCOUNT_11610751_V1 -- Account 11610751 ให้โชว์เป็น Column เสมอ (แม้ไม่มีข้อมูล จะโชว์เป็นสีเทา/ขีด —)
  // MARKER_VATRECONCILEDASHBOARD_ALWAYS_SHOW_KNOWN_ACCOUNTS_V1 -- Account ที่รู้จักทั้ง 3 ตัว (752, 755, 751) ต้องขึ้นเป็น Column เสมอ
  // ไม่ว่า Period/BU ที่กรองอยู่จะมีข้อมูลจริงของ Account นั้นหรือไม่ (ไม่มีข้อมูล -> โชว์เป็นขีด "—" สีเทา) -- เรียงตามลำดับนี้เสมอ (751 ไปท้ายสุด)
  const KNOWN_ACCOUNT_ORDER = ['11610752', '11610755', '11610751'];
  const accountSortKey = (acct) => {
    const knownIndex = KNOWN_ACCOUNT_ORDER.indexOf(acct);
    if (knownIndex !== -1) return knownIndex;
    const n = Number(acct);
    return 1000000 + (Number.isNaN(n) ? 0 : n); // Account อื่นที่ไม่รู้จัก (ถ้ามีในอนาคต) ไปท้ายสุด เรียงเลขจากน้อยไปมาก
  };
  const dynamicAccountColumns = [...new Set(filteredPivotRows.flatMap((r) => r.accounts.map((a) => a.account)))];
  const accountColumns = [...new Set([...KNOWN_ACCOUNT_ORDER, ...dynamicAccountColumns])]
    .sort((a, b) => accountSortKey(a) - accountSortKey(b));

  // MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_X_V1 -- Map bu -> 'VAT %' จาก company_list (Key เดียวกับ r.bu ที่ใช้ Match กันอยู่แล้วทั้งไฟล์)
  // MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_FIX_PARSEFLOAT_V1 -- เทียบด้วย parseFloat === 100 แบบเดียวกับที่ VatController.js ใช้ทั้งไฟล์ (ของเดิมเทียบ String ตรงๆ "100" เป๊ะๆ พลาดกรณีค่าเป็น "100.00"/"100%%" ฯลฯ)
  const buPercentMap = React.useMemo(() => {
    const map = new Map();
    for (const c of companyList) {
      const buKey = c.bu;
      if (buKey == null || map.has(buKey)) continue;
      const pct = parseFloat(c['VAT %']);
      if (!Number.isNaN(pct)) map.set(buKey, pct);
    }
    return map;
  }, [companyList]);
  const isBu100Percent = (buCode) => buPercentMap.get(buCode) === 100;

  // MARKER_VATRECONCILEDASHBOARD_TAXTYPE_ACCOUNT_APPLICABLE_V1
  // อ่าน company_list['allowed_tax_type'] (คอลัมน์ "Tax type" ใน VAT Config) เพื่อเช็คว่า BU นี้ควรมี Account ไหนบ้าง
  // M -> 11610751, A หรือ N -> 11610752, T หรือ F -> 11610755 (Logic เดียวกับที่ใช้จริงอยู่แล้วใน VatController -- allowedList null = "All Type" ซึ่งไม่รวม M โดย Default)
  const buTaxTypeMap = React.useMemo(() => {
    const map = new Map();
    for (const c of companyList) {
      const buKey = c.bu;
      if (buKey == null || map.has(buKey)) continue;
      const raw = String(c.allowed_tax_type ?? '').trim();
      if (raw) map.set(buKey, raw);
    }
    return map;
  }, [companyList]);
  const getAllowedTaxClasses = (buCode) => {
    const raw = buTaxTypeMap.get(buCode);
    if (!raw) return undefined; // ไม่มีข้อมูล Tax Type เลย -- ไม่รู้ ไม่ตัดสิน X (แสดงปกติ)
    if (raw.toLowerCase() === 'all type') return null; // null = "All Type" (ทุกชนิด ยกเว้น M ต้องระบุเจาะจงเท่านั้น)
    return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  };
  const isAccountApplicableForBu = (acct, buCode) => {
    const allowedList = getAllowedTaxClasses(buCode);
    if (allowedList === undefined) return true; // ไม่มีข้อมูล Tax Type -- Default ให้โชว์ปกติ
    if (acct === '11610751') return allowedList !== null && allowedList.includes('M');
    if (acct === '11610752') return allowedList === null || allowedList.includes('A') || allowedList.includes('N');
    if (acct === '11610755') return allowedList === null || allowedList.includes('T') || allowedList.includes('F');
    return true; // Account อื่นที่ไม่รู้จัก Rule -- ไม่ตัดสิน X
  };

  // MARKER_VATRECONCILEDASHBOARD_CLICK_TO_SELECT_V1 -- คลิกช่องสถานะของ Account ไหนในตาราง = Auto เซ็ต Business Unit + Account Code ให้ Control Zone ทันที
  const handleSelectBuAccount = useCallback((label, account) => {
    setCcBusinessUnit(label);
    setCcAccountCode(account);
  }, []);

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
      {/* MARKER_VATRECONCILEDASHBOARD_GRID_RATIO_MATCH_AP_V1 -- ปรับสัดส่วนให้เหมือน AP Reconcile Dashboard (2.3fr 1fr) ให้พื้นที่ตาราง Pivot ฝั่งซ้ายกว้างขึ้น รองรับ Account Column ที่เพิ่มมา */}
      {/* MARKER_VATRECONCILEDASHBOARD_TOPZONE_FLEX_STRETCH_V1 -- เดิม Fix height: '35vh' ตายตัว (Copy มาจาก AP) ทำให้มี Gap ว่างเหลือเวลาตารางสั้น/ไม่มีข้อมูล -- เปลี่ยนเป็น flex: 1 ให้ยื่นเต็มพื้นที่ที่เหลือจริง (Zone ด้านนอก height: 100vh + flexDirection: column บังคับเพดานรวมอยู่แล้ว ไม่มีทาง Overflow จอ) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.3fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
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
                {/* MARKER_VATRECONCILEDASHBOARD_REMOVE_LETTER_FILTER_V1 -- ตัดแถบตัวอักษร A-Z ออก (BU เหลือน้อยแล้วเพราะกรองแสดงแค่ที่มีข้อมูลจริง ไม่จำเป็นต้องมีแถบนี้) */}

                {loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
                {errorMessage && <p style={{ fontSize: 13, color: '#a30d16' }}>{errorMessage}</p>}

                {!loading && !errorMessage && (
                  // MARKER_VATRECONCILEDASHBOARD_PIVOT_BU_ACCOUNT_V1 -- overflow-x เพิ่มเข้ามา เผื่อ BU มีหลาย Account จนตารางกว้างเกินพื้นที่
                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {/* MARKER_VATRECONCILEDASHBOARD_PIVOT_STRETCH_COLUMNS_V1 -- เดิมไม่มี <colgroup> กำหนด Width สัดส่วนตายตัว ทำให้ Browser จัด Column ตาม Content จริง
                        เหลือพื้นที่ว่างฝั่งขวาเมื่อ Account น้อย (ไม่เต็มความกว้าง Zone) -- เพิ่ม <colgroup> เป็น % ให้รวมเป็น 100% เสมอ (BU 10% + Account ที่เหลือหารเท่ากัน) */}
                    <table style={{ width: '100%', minWidth: accountColumns.length > 0 ? accountColumns.length * 260 + 90 : '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      {accountColumns.length > 0 && (
                        <colgroup>
                          <col style={{ width: '10%' }} />
                          {accountColumns.map((acct) => (
                            <React.Fragment key={acct}>
                              {Array.from({ length: 5 }).map((_, si) => (
                                <col key={si} style={{ width: `${90 / (accountColumns.length * 5)}%` }} />
                              ))}
                            </React.Fragment>
                          ))}
                        </colgroup>
                      )}
                      <thead>
                        <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                          <th rowSpan={2} style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)', textAlign: 'left', padding: '6px 4px', color: '#334155', fontWeight: 600, verticalAlign: 'bottom' }}>BU</th>
                          {accountColumns.map((acct) => {
                            // MARKER_VATRECONCILEDASHBOARD_DIVIDER_AND_GREY_HEADER_V1 -- เส้นแบ่งเข้มขึ้นระหว่าง Account + หัว Account 11610751 ใช้สีเทา (Account ที่ไม่ค่อยได้ใช้)
                            const isGrey = acct === '11610751';
                            const headerBg = isGrey ? 'linear-gradient(180deg, #f1f2f4, #e4e6e9)' : 'linear-gradient(180deg, #eef4ff, #e3ecfb)';
                            const headerColor = isGrey ? '#6b7280' : '#334155';
                            return (
                              <th key={acct} colSpan={5} style={{ position: 'sticky', top: 0, background: headerBg, textAlign: 'center', padding: '6px 4px', color: headerColor, fontWeight: 600, borderLeft: '2px solid #b8bfc7' }}>
                                Account {acct}
                              </th>
                            );
                          })}
                        </tr>
                        <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                          {accountColumns.map((acct) => {
                            const isGrey = acct === '11610751';
                            const headerBg = isGrey ? 'linear-gradient(180deg, #f1f2f4, #e4e6e9)' : 'linear-gradient(180deg, #eef4ff, #e3ecfb)';
                            const headerColor = isGrey ? '#6b7280' : '#334155';
                            const subTh = (extra) => ({ position: 'sticky', top: 24, background: headerBg, textAlign: 'center', padding: '4px', color: headerColor, fontWeight: 500, fontSize: 11.5, ...extra });
                            return (
                              <React.Fragment key={acct}>
                                <th style={subTh({ borderLeft: '2px solid #b8bfc7' })}>TB</th>
                                <th style={subTh()}>Input<br />Summary</th>
                                <th style={subTh()}>Simple<br />100</th>
                                <th style={subTh()}>Simple<br />AVG</th>
                                <th style={subTh()}>Status</th>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {/* MARKER_VATRECONCILEDASHBOARD_PIVOT_NODATA_KEEP_DIVIDERS_V1 -- เดิมตอนไม่มีข้อมูล ใช้ td เดียว colSpan เต็มแถว ทำให้เส้นแบ่งระหว่างกลุ่ม Account (borderLeft) หายไปด้วย
                            -- เปลี่ยนเป็นแถวเปล่าที่มี Column จริงครบ (มี borderLeft ที่ขอบกลุ่มเหมือนแถวข้อมูลจริง) ให้สูงพอเห็นเส้นแบ่งชัด แล้วค่อยมีแถวข้อความแยกอีกแถวด้านล่าง */}
                        {filteredPivotRows.length === 0 && (
                          <>
                            <tr>
                              <td style={{ padding: 0, height: 220 }} />
                              {accountColumns.map((acct, gi) => (
                                <React.Fragment key={acct}>
                                  {Array.from({ length: 5 }).map((_, si) => (
                                    <td key={si} style={{ padding: 0, height: 220, borderLeft: si === 0 ? '2px solid #d7dade' : undefined }} />
                                  ))}
                                </React.Fragment>
                              ))}
                            </tr>
                            <tr>
                              <td colSpan={1 + accountColumns.length * 5} style={{ padding: '16px 4px', textAlign: 'center', color: '#999' }}>
                                ไม่พบ BU ที่มีข้อมูลตรงกับตัวกรอง
                              </td>
                            </tr>
                          </>
                        )}
                        {filteredPivotRows.map((pr, i) => {
                          // MARKER_VATRECONCILEDASHBOARD_BU_100PERCENT_X_V1 -- BU ตั้งค่า VAT % = 100 ใน company_list -> ไม่มีทางมี Simple AVG แน่นอน โชว์ "X" แทน Dot
                          const is100 = isBu100Percent(pr.bu);
                          const xCell = (styleObj, key, title) => (
                            <td key={key} style={styleObj} title={title}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#aeb4bb' }}>X</span>
                            </td>
                          );
                          return (
                          <tr key={`${pr.label}-${i}`} style={{ borderBottom: '0.5px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                            <td style={{ padding: '8px 4px', fontWeight: 600, color: '#24292f' }}>{pr.label}</td>
                            {accountColumns.map((acct) => {
                              const cell = pr.accounts.find((a) => a.account === acct);
                              const cellStyle = { padding: '8px 4px', textAlign: 'center', cursor: cell ? 'pointer' : 'default', borderLeft: '2px solid #d7dade' };
                              const plainCellStyle = { padding: '8px 4px', textAlign: 'center', cursor: cell ? 'pointer' : 'default' };
                              const onClick = cell ? () => handleSelectBuAccount(pr.label, acct) : undefined;

                              // MARKER_VATRECONCILEDASHBOARD_TAXTYPE_ACCOUNT_APPLICABLE_V1 -- BU นี้ไม่มี Tax Type ที่ตรงกับ Account นี้เลย -> X ทั้งแถว Account (ไม่มีทางมีข้อมูลแน่นอน)
                              if (!isAccountApplicableForBu(acct, pr.bu)) {
                                const taxTitle = `BU ${pr.label} ไม่มี Tax Type ที่ใช้ Account ${acct} (ดูจาก Tax Type ใน VAT Config)`;
                                return (
                                  <React.Fragment key={acct}>
                                    {xCell({ ...plainCellStyle, borderLeft: '2px solid #d7dade' }, 'x1', taxTitle)}
                                    {xCell(plainCellStyle, 'x2', taxTitle)}
                                    {xCell(plainCellStyle, 'x3', taxTitle)}
                                    {xCell(plainCellStyle, 'x4', taxTitle)}
                                    {xCell(plainCellStyle, 'x5', taxTitle)}
                                  </React.Fragment>
                                );
                              }

                              // MARKER_VATRECONCILEDASHBOARD_NODATA_HOLLOW_DOT_V1 -- "ยังไม่มีข้อมูลอัปโหลด" (Account นี้ใช้ได้กับ BU นี้ แต่ยังไม่มีคนอัปโหลด) ใช้วงกลมเทากลวง ○ แยกให้ชัดจาก X (ไม่เกี่ยวข้องแน่นอน)
                              if (!cell) {
                                const noDataTitle = `BU ${pr.label} · Account ${acct} — ยังไม่มีข้อมูลอัปโหลด`;
                                const noDataDot = (
                                  <span
                                    title={noDataTitle}
                                    aria-label="ยังไม่มีข้อมูล"
                                    style={{
                                      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                                      border: '1.5px solid #c9ced3', background: 'transparent',
                                    }}
                                  />
                                );
                                return (
                                  <React.Fragment key={acct}>
                                    <td style={cellStyle} title={noDataTitle}>{noDataDot}</td>
                                    <td style={plainCellStyle} title={noDataTitle}>{noDataDot}</td>
                                    <td style={plainCellStyle} title={noDataTitle}>{noDataDot}</td>
                                    {is100 ? xCell(plainCellStyle, 'avg', 'BU นี้ตั้งค่า VAT 100% — ไม่มี Simple AVG แน่นอน') : <td style={plainCellStyle} title={noDataTitle}>{noDataDot}</td>}
                                    <td style={plainCellStyle} title={noDataTitle}>{noDataDot}</td>
                                  </React.Fragment>
                                );
                              }
                              return (
                                <React.Fragment key={acct}>
                                  {/* MARKER_VATRECONCILEDASHBOARD_DOUBLECLICK_QUICK_PREVIEW_V1 -- Double-click ช่อง TB / Input Summary เปิด Popup Preview ของ Report นั้นทันที */}
                                  <td
                                    style={cellStyle}
                                    onClick={onClick}
                                    onDoubleClick={() => handleQuickPreview('tb', pr.label, acct)}
                                    title={`BU ${pr.label} · Account ${acct} (Double-click เพื่อดู TB Preview)`}
                                  ><StatusDot active={cell.tb_active} /></td>
                                  <td
                                    style={plainCellStyle}
                                    onClick={onClick}
                                    onDoubleClick={() => handleQuickPreview('input_summary', pr.label, acct)}
                                    title={`BU ${pr.label} · Account ${acct} (Double-click เพื่อดู Input Summary Preview)`}
                                  ><StatusDot active={cell.input_summary_active} /></td>
                                  <td style={plainCellStyle} onClick={onClick} title={`BU ${pr.label} · Account ${acct}`}><StatusDot active={cell.simple_100_active} /></td>
                                  {is100 ? xCell(plainCellStyle, 'avg', 'BU นี้ตั้งค่า VAT 100% — ไม่มี Simple AVG แน่นอน') : <td style={plainCellStyle} onClick={onClick} title={`BU ${pr.label} · Account ${acct}`}><StatusDot active={cell.simple_avg_active} /></td>}
                                  <td style={plainCellStyle} onClick={onClick} title={`BU ${pr.label} · Account ${acct}`}><ReadyBadge ready={cell.ready} /></td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                          );
                        })}
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
        {/* MARKER_VATRECONCILEDASHBOARD_CONTROLZONE_SHRINK_TO_CONTENT_V1 -- เดิม height:'100%' บังคับ Panel นี้สูงเท่า Zone บนที่ยืดเต็ม (TOPZONE_FLEX_STRETCH_V1)
            ทำให้เหลือพื้นที่ว่างข้างในกรอบที่ไม่ได้ใช้ -- เปลี่ยนเป็น alignSelf:'start' + height:'auto' ให้กรอบสูงพอดีกับเนื้อหาจริงเท่านั้น ไม่ต้องเผื่อช่องว่างไว้ */}
        <div style={{
          border: '0.5px solid #ddd', borderRadius: 12, height: 'auto', maxHeight: '100%', alignSelf: 'start',
          background: '#fff', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column' }}>
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
                options={['11610751', '11610752', '11610755']} />
            </div>

            {/* MARKER_VATRECONCILEDASHBOARD_CONTROLZONE_RECONCILE_ONLY_V1 -- ตัดช่อง REPORT (เลือก Report Type) ออก -- เลือก Period + Business Unit + Account Code ครบ ก็รู้อยู่แล้วว่าต้อง Reconcile อะไร ไม่ต้องเลือก Report Type อีกชั้น
                MARKER_VATRECONCILEDASHBOARD_CONTROLZONE_SINGLE_PREVIEW_BUTTON_V1 -- ตัดปุ่ม Clear ออก เหลือปุ่มเดียวคือ Preview (เลือกครบแล้วกดปุ่มเดียวพอ) */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexShrink: 0 }}>
              <button
                type="button"
                disabled={!ccBusinessUnit || !ccAccountCode}
                onClick={() => handlePreview()}
                style={{
                  flex: 1, padding: '11px', fontSize: 14, fontWeight: 700,
                  background: (ccBusinessUnit && ccAccountCode)
                    ? 'linear-gradient(135deg, #2ea043, #1a7f37)'
                    : 'linear-gradient(135deg, #b8bfc7, #9aa2ab)',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (ccBusinessUnit && ccAccountCode) ? 'pointer' : 'not-allowed', flexShrink: 0,
                }}
              >
                Preview
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
              ? `Input Reconcile Report · ${ccBusinessUnit} · ${formatPeriodLabel(period)}`
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

      {/* MARKER_VATRECONCILEDASHBOARD_DOUBLECLICK_QUICK_PREVIEW_V1 -- Modal เต็มจอ เปิดจาก Double-click ช่อง TB / Input Summary ในตาราง Pivot (ไม่ต้องผ่าน Control Zone) */}
      {quickPreviewModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setQuickPreviewModal(null)}
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
                {QUICK_PREVIEW_LABEL[quickPreviewModal.type] || 'Preview'} · {quickPreviewModal.bu} · {quickPreviewModal.account} · {formatPeriodLabel(period)}
              </p>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setQuickPreviewModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {quickPreviewModal.loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
              {quickPreviewModal.error && <p style={{ fontSize: 13, color: '#a30d16' }}>{quickPreviewModal.error}</p>}
              {!quickPreviewModal.loading && !quickPreviewModal.error && quickPreviewModal.data && (
                <ReportPreviewTable data={quickPreviewModal.data} />
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

// MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_TOOLTIP_V1 -- Tooltip อธิบายแต่ละ Column (Hover ที่หัว Column ในตาราง Preview)
const COLUMN_TOOLTIPS = {
  branch: 'รหัสสาขาของรายการนี้',
  cpc: 'รหัส CPC (Cost/Profit Center) ตาม Chart of Accounts',
  account: 'เลขที่บัญชี GL',
  subacc: 'รหัสบัญชีย่อย (Sub Account)',
  description: 'คำอธิบายรายการตาม TB',
  beginning_balance: 'ยอดคงเหลือต้นงวด',
  period_activity: 'ยอดเคลื่อนไหวระหว่างงวด',
  ending_balance: 'ยอดคงเหลือปลายงวด',
  claimed100_amount: 'มูลค่าสินค้าที่ใช้สิทธิ์ภาษีซื้อ 100%',
  claimed100_vat: 'เงินภาษีที่ใช้สิทธิ์ภาษีซื้อ 100%',
  claimed_amount: 'มูลค่าสินค้าที่ใช้สิทธิ์ภาษีซื้อ (ตาม Simple Report)',
  claimed_vat: 'เงินภาษีที่ใช้สิทธิ์ภาษีซื้อ (ตาม Simple Report)',
  tax_type_code: 'ประเภท Tax Type ที่ใช้คำนวณรายการนี้',
  invoice_count: 'จำนวนใบกำกับภาษีทั้งหมดของสาขานี้',
  tb_amount: 'ยอดตาม Trial Balance',
  input_summary_amount: 'ยอดตาม Input Summary',
  difference: 'ผลต่างระหว่าง TB กับ Input Summary',
  status: 'สถานะการ Reconcile ของรายการนี้',
  operator_name: 'ชื่อผู้ประกอบการ/บริษัทตามทะเบียน',
  company_tax_id: 'เลขประจำตัวผู้เสียภาษีของบริษัท',
  branch_no: 'หมายเลขสาขา',
  claim_percent: 'เปอร์เซ็นต์ที่ใช้สิทธิ์ภาษีซื้อของรายการนี้',
  receive_date: 'วันที่รับสินค้า/บริการตามเอกสาร GRT',
  grt_no: 'เลขที่ใบรับสินค้า (GRT)',
  tax_invoice_date: 'วันที่ตามใบกำกับภาษีของผู้ขาย',
  tax_invoice_no: 'เลขที่ใบกำกับภาษีของผู้ขาย',
  vendor_name: 'ชื่อผู้ขาย/ผู้ให้บริการ',
  tax_id: 'เลขประจำตัวผู้เสียภาษีของผู้ขาย',
  ho: 'รหัส HO (สำนักงานใหญ่) ตามต้นฉบับ — มีค่าเมื่อรายการนี้ออกในนาม HO',
  branch_field: 'รหัสสาขาตามต้นฉบับ — มีค่าเมื่อรายการนี้ออกในนามสาขา (ไม่ใช่ HO)',
  item_detail: 'รายละเอียด/คำอธิบายรายการตามใบกำกับภาษี',
  paid_amount: 'มูลค่าสินค้าที่ชำระภาษีซื้อ',
  paid_vat: 'เงินภาษีซื้อที่ชำระ',
  calculate_tax: 'ผลต่างระหว่างมูลค่าที่ใช้สิทธิ์กับมูลค่าที่ชำระจริง (M-O)',
};

// MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_FILTERS_V1 -- Filter รายคอลัมน์ (วันที่รับสินค้า/วันที่ใบกำกับภาษี) + ตัวเลือกสาขา (ถ้ามีมากกว่า 1 สาขาในผลลัพธ์)
// MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- Excel-Style Grid: Double-click แก้ไข Field ได้ทุก Column + PUT กลับ DB, Drag-Select หลาย Cell + Ctrl+C Copy (เฉพาะตอน Backend ส่ง "id" มาด้วย -- ตอนนี้รองรับแค่ Input Summary Detail)
// Hook ต้องอยู่ก่อน Early Return เสมอ (Rules of Hooks) ไม่งั้น Order จะไม่เท่ากันระหว่าง Render ที่มี/ไม่มีข้อมูล
const EDITABLE_TABLE_BY_REPORT = { 'input_summary|detail': 'vat_reconcile_input_summary' };
function ReportPreviewTable({ data, onRowAction, actionLabel }) {
  const [columnFilters, setColumnFilters] = React.useState({});
  const [branchFilter, setBranchFilter] = React.useState('');
  const [localRows, setLocalRows] = React.useState(data.rows || []);
  const [selection, setSelection] = React.useState(null); // {r1,c1,r2,c2} -- r/c = index เข้า filteredRows/columns (คำนวณสดทุก Render)
  const [isDragging, setIsDragging] = React.useState(false);
  const [editingCell, setEditingCell] = React.useState(null); // {rowId, col}
  const [editVal, setEditVal] = React.useState('');
  const [savingCell, setSavingCell] = React.useState(false);
  const gridRef = React.useRef(null);

  React.useEffect(() => { setLocalRows(data.rows || []); }, [data.rows]);
  React.useEffect(() => {
    const onUp = () => setIsDragging(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  if (!localRows || localRows.length === 0) {
    return <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '24px 0' }}>ไม่พบข้อมูล</p>;
  }
  // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- ตัด 'id' ออกจาก Column ที่แสดง/Filter/Copy (ใช้แค่เป็น Key อ้างอิงตอน PUT เท่านั้น ไม่ต้องโชว์)
  const columns = Object.keys(localRows[0]).filter((k) => k !== 'id');
  const editableTable = EDITABLE_TABLE_BY_REPORT[`${data.type}|${data.view || ''}`];
  const isEditable = !!editableTable && typeof localRows[0]?.id !== 'undefined';
  const FILTERABLE_COLUMNS = new Set(['receive_date', 'tax_invoice_date']);
  const branchOptions = columns.includes('branch')
    ? [...new Set(localRows.map((r) => String(r.branch ?? '').trim()).filter(Boolean))].sort()
    : [];
  const filteredRows = localRows.filter((r) => {
    if (branchFilter && String(r.branch ?? '').trim() !== branchFilter) return false;
    for (const col of FILTERABLE_COLUMNS) {
      const f = (columnFilters[col] || '').trim().toLowerCase();
      if (f && !String(r[col] ?? '').toLowerCase().includes(f)) return false;
    }
    return true;
  });

  // ── Excel-Style Drag-Select + Ctrl+C Copy (เฉพาะตอน isEditable) ──
  const normSel = () => {
    if (!selection) return null;
    return {
      r1: Math.min(selection.r1, selection.r2), r2: Math.max(selection.r1, selection.r2),
      c1: Math.min(selection.c1, selection.c2), c2: Math.max(selection.c1, selection.c2),
    };
  };
  const isCellSelected = (r, c) => {
    const s = normSel();
    return !!s && r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2;
  };
  const handleMouseDown = (r, c) => {
    if (!isEditable || editingCell) return;
    gridRef.current && gridRef.current.focus();
    setIsDragging(true);
    setSelection({ r1: r, c1: c, r2: r, c2: c });
  };
  const handleMouseEnter = (r, c) => {
    if (!isEditable || !isDragging) return;
    setSelection((s) => (s ? { ...s, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }));
  };
  const handleCopy = () => {
    const s = normSel();
    if (!s) return;
    const lines = [];
    for (let r = s.r1; r <= s.r2; r++) {
      const vals = [];
      for (let c = s.c1; c <= s.c2; c++) {
        vals.push(String(filteredRows[r]?.[columns[c]] ?? ''));
      }
      lines.push(vals.join('\t'));
    }
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };
  const startEdit = (row, col) => {
    if (!isEditable) return;
    setEditingCell({ rowId: row.id, col });
    setEditVal(String(row[col] ?? ''));
  };
  const commitEdit = async () => {
    if (!editingCell || savingCell) return;
    const { rowId, col } = editingCell;
    const row = localRows.find((r) => r.id === rowId);
    if (!row) { setEditingCell(null); return; }
    const nextVal = editVal.trim();
    const curVal = String(row[col] ?? '').trim();
    if (nextVal === curVal) { setEditingCell(null); return; }
    setSavingCell(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/${editableTable}/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ [col]: nextVal === '' ? null : nextVal }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      setLocalRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [col]: nextVal === '' ? null : nextVal } : r)));
      setEditingCell(null);
    } catch (err) {
      console.error('[VatReconcileDashboard] ReportPreviewTable inline edit error:', err);
      window.alert(err?.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    }
    setSavingCell(false);
  };

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
  const isNumericColumn = (c) => toNumericOrNull(localRows[0][c], c) !== null;

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

      {/* MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_FILTERS_V1 -- Branch Selector (โชว์เฉพาะตอนผลลัพธ์มีมากกว่า 1 สาขา) */}
      {branchOptions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>กรองสาขา:</label>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 6, border: '1px solid #d0d7de', background: '#fff' }}
          >
            <option value="">ทั้งหมด ({localRows.length})</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {branchFilter && (
            <span style={{ fontSize: 12, color: '#57606a' }}>พบ {filteredRows.length} รายการ</span>
          )}
        </div>
      )}

      {/* MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- ห่อด้วย div ที่ Focus ได้ เพื่อดักจับ Ctrl+C (Copy ช่วงที่ Drag-Select ไว้) */}
      {isEditable && (
        <p style={{ fontSize: 11.5, color: '#57606a', margin: '0 0 8px' }}>
          💡 Double-click ที่ช่องเพื่อแก้ไข (Enter/คลิกที่อื่นเพื่อบันทึก, Esc เพื่อยกเลิก) — Drag เลือกหลายช่องแล้ว Ctrl+C เพื่อ Copy
        </p>
      )}
      <div
        ref={gridRef}
        tabIndex={isEditable ? 0 : -1}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            handleCopy();
          }
        }}
        style={{ outline: 'none' }}
      >
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', border: '1px solid #d0d7de' }}>
        <thead>
          <tr>
            {columns.map((c, colIdx) => (
              <th key={c} title={COLUMN_TOOLTIPS[c] || getLabel(c)} style={{
                position: 'sticky', top: 0,
                background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)',
                textAlign: isSimpleReport ? 'center' : (isNumericColumn(c) ? 'right' : 'left'),
                padding: '8px 12px', color: '#334155', fontWeight: 600,
                zIndex: 1, whiteSpace: 'nowrap',
                border: '1px solid #d0d7de', cursor: 'help',
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
          {/* MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_FILTERS_V1 -- แถว Filter ย่อยใต้หัว Column เฉพาะ receive_date / tax_invoice_date */}
          {columns.some((c) => FILTERABLE_COLUMNS.has(c)) && (
            <tr>
              {columns.map((c) => (
                <th key={`filter-${c}`} style={{
                  position: 'sticky', top: 32, background: '#fff',
                  padding: '4px 8px', border: '1px solid #d0d7de', zIndex: 1,
                }}>
                  {FILTERABLE_COLUMNS.has(c) && (
                    <input
                      type="text"
                      value={columnFilters[c] || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, [c]: e.target.value }))}
                      placeholder="กรอง..."
                      style={{ width: '100%', fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid #d0d7de', boxSizing: 'border-box' }}
                    />
                  )}
                </th>
              ))}
              {onRowAction && <th style={{ position: 'sticky', top: 32, background: '#fff', border: '1px solid #d0d7de' }} />}
            </tr>
          )}
        </thead>
        <tbody>
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (onRowAction ? 1 : 0)} style={{ padding: '16px 4px', textAlign: 'center', color: '#999', border: '1px solid #eaeef2' }}>
                ไม่พบข้อมูลตรงกับตัวกรอง
              </td>
            </tr>
          )}
          {filteredRows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
              {columns.map((c, colIdx) => {
                // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1
                const selected = isEditable && isCellSelected(i, colIdx);
                const isEditingThis = isEditable && editingCell && editingCell.rowId === r.id && editingCell.col === c;
                const cellHandlers = isEditable ? {
                  onMouseDown: () => handleMouseDown(i, colIdx),
                  onMouseEnter: () => handleMouseEnter(i, colIdx),
                  onDoubleClick: () => startEdit(r, c),
                } : {};
                const selBg = selected ? 'rgba(26,86,219,0.16)' : undefined;

                if (isEditingThis) {
                  return (
                    <td key={c} style={{ padding: '2px', border: '2px solid #1a56db', background: '#fffdf2' }}>
                      <input
                        autoFocus
                        disabled={savingCell}
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                          else if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null); }
                        }}
                        style={{ width: '100%', fontSize: 12.5, padding: '6px 8px', border: '1px solid #1a56db', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </td>
                  );
                }

                if (c === 'status') {
                  const sc = statusColor(r[c]);
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', border: '1px solid #eaeef2', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: isEditable ? 'none' : 'auto' }}>
                      <span style={{ background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                        {r[c]}
                      </span>
                    </td>
                  );
                }
                if (c === 'branch') {
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', fontWeight: 600, color: '#24292f', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: isEditable ? 'none' : 'auto' }}>
                      {r[c]}
                    </td>
                  );
                }
                // DASHBOARD_SIMPLE_DETAIL_FORMAT_FIX_PATCH_APPLIED
                // MARKER_VATRECONCILEDASHBOARD_BRANCH_FIELD_BLANK_FIX_V1 -- เดิมถ้าต้นฉบับไม่มีค่า (null/undefined/ว่าง) จะ Default เป็น '0' แล้ว padStart เป็น "00000" เสมอ
                // ทำให้ BRANCH โชว์ "00000" ซ้ำกับ HO ทั้งที่ต้นฉบับไม่มีค่า -- แก้ให้โชว์ว่างถ้าต้นฉบับไม่มีค่าจริงๆ (Pad เฉพาะตอนมีค่าจริงเท่านั้น)
                if (c === 'branch_no' || c === 'branch_field') {
                  const rawVal = r[c];
                  const hasVal = rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: isEditable ? 'none' : 'auto' }}>
                      {hasVal ? String(rawVal).padStart(5, '0') : ''}
                    </td>
                  );
                }
                if (c === 'tax_id' || c === 'company_tax_id') {
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: isEditable ? 'none' : 'auto' }}>
                      {r[c] ? String(r[c]).padStart(13, '0') : ''}
                    </td>
                  );
                }
                const numVal = toNumericOrNull(r[c], c);
                const isNum = numVal !== null;
                return (
                  <td key={c} {...cellHandlers} style={{
                    padding: '8px 12px', textAlign: isNum ? 'right' : 'left',
                    color: isNum ? '#24292f' : '#57606a', border: '1px solid #eaeef2',
                    whiteSpace: 'nowrap',
                    overflow: isNum ? 'visible' : 'hidden',
                    textOverflow: isNum ? 'clip' : 'ellipsis',
                    maxWidth: isNum ? 'none' : 280,
                    background: selBg,
                    cursor: isEditable ? 'cell' : 'default',
                    userSelect: isEditable ? 'none' : 'auto',
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
    </div>
  );
}