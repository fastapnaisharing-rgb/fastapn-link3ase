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
import { createPortal } from 'react-dom'; // MARKER_VATRECONCILE_SAMPLING_BTN_V1 -- Popup Sampling วาดซ้อนใน Popup Reconcile
import { confirmDialog } from '../confirmDialog'; // MARKER_VATRECONCILE_REPORT_FILES_CONFIRM_V1 -- ใช้ Dialog ของระบบแทน window.confirm
import VatReconcileSystem from './VatReconcileSystem';
import BranchFormModal from './BranchFormModal'; // MARKER_VATRECONCILE_BRANCHFORM_V1 -- ฟอร์ม New/Edit Branch (เหมือน Master Data > Branch)
import { subscribeWs, broadcastWs } from '../wsManager';
import { db } from '../lib/db'; // MARKER_RECON_FIRSTDRAFT_TO_TIMELINE_V1

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

// MARKER_VATRECONCILE_REBIND_BRANCHES_V1 -- หลังเพิ่ม/แก้สาขา: ให้ Backend ผูกแถว Input Summary ที่เคย Fallback ใหม่ด้วย branch_list จริง
async function rebindBranches({ bu, period, branch }) {
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/rebind-branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ bu, period, branch }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `ผูกสาขาใหม่ไม่สำเร็จ (HTTP ${res.status})`);
  return data;
}

// MARKER_VATRECONCILEDASHBOARD_RECONCILE_POPUP_V1 -- ดึงข้อมูล Popup Preview แบบ Reconcile จริงตาม Macro (Template 100% / 100%+Simple / เฉลี่ย AVG)
async function fetchReconcileReport({ bu, account, period }, includeSources) {
  const token = sessionStorage.getItem('fastapn_token');
  const params = new URLSearchParams({ bu, account, period });
  if (includeSources) params.set('include', 'sources'); // MARKER_VATRECONCILE_DRILLDOWN_V1 -- ดึง Detail/Simple/TB รายใบกำกับ (โหลดเมื่อกดดูสาขาเท่านั้น)
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/reconcile-report?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
  }
  return data;
}

// MARKER_VATRECONCILEDASHBOARD_REPORT_FILES_V1 -- ที่เก็บไฟล์รายงานภาษี (Export จาก Popup Preview -> เก็บบน Server)
function rfAuth(extra) {
  const token = sessionStorage.getItem('fastapn_token');
  return { ...(extra || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function fetchReportFiles({ period, scope }) { // MARKER_VATRECONCILE_REPORT_FILES_ALL_PERIODS_V16 -- period ไม่ส่ง = แสดงทุก Period (ไม่ Filter)
  // MARKER_VATRECONCILE_REPORT_FILES_SCOPE_V1 -- ไม่ต้องเลือก BU (แสดงทุก BU ของ Period) | scope = mine | all
  const params = new URLSearchParams({ scope: scope || 'mine' });
  if (period) params.set('period', period);
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files?${params}`, { headers: rfAuth() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `โหลดรายการไฟล์ไม่สำเร็จ (HTTP ${res.status})`);
  return data.files || [];
}
function logActivityTs(event, { bu, account, period } = {}) { // MARKER_VATRECONCILE_ACTIVITY_TS_V1 -- ยิง Timestamp (ไม่รอผล ไม่ขัดการทำงาน)
  try {
    fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/activity-ts`, { method: 'POST', headers: rfAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ event, bu, account, period }) }).catch(() => {});
  } catch (_) { /* ignore */ }
}
async function exportReportFile({ bu, account, period, fillStartedAt, draft }) {
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/export`, {
    method: 'POST', headers: rfAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ bu, account, period, fill_started_at: fillStartedAt || null, draft: draft === true }), // MARKER_VATRECONCILE_USER_TRANSACTION_V1
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Export ไม่สำเร็จ (HTTP ${res.status})`);
  return data.file;
}
async function downloadReportFile(file) {
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/download`, { headers: rfAuth() });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error || `ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = file.file_name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function confirmReportFile(file) { // MARKER_VATRECONCILE_REPORT_CONFIRM_V1 -- Confirm ไฟล์ก่อน Download / ส่ง SharePoint
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/confirm`, { method: 'POST', headers: rfAuth() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `Confirm ไม่สำเร็จ (HTTP ${res.status})`);
  return d;
}
async function releaseReportFile(file) { // MARKER_VATRECONCILE_REPORT_RELEASE_V1 -- ปุ่มเดียวกับ Confirm (สลับ Confirm <-> Release)
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/release`, { method: 'POST', headers: rfAuth() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `Release ไม่สำเร็จ (HTTP ${res.status})`);
  return d;
}
// Timeline (First Draft/Note/Confirm/Release/Delete) อัปเดตที่ Backend แล้ว (vatReconcileReportFiles.js)

async function saveDraftNote(file, note) { // MARKER_VATRECONCILE_FIRST_DRAFT_NOTE_V1 -- Note ของ First Draft (ผูก Timeline ฝั่ง Backend)
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/note`, { method: 'PUT', headers: rfAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ note }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `บันทึก Note ไม่สำเร็จ (HTTP ${res.status})`);
  return d;
}
async function deleteReportFile(file) { // MARKER_VATRECONCILE_REPORT_FILES_DELETE_V1
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}`, { method: 'DELETE', headers: rfAuth() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `ลบไม่สำเร็จ (HTTP ${res.status})`);
}
// MARKER_VATRECONCILE_DOT_CLEAR_V1 -- ล้างข้อมูลที่อัปโหลด (Input Summary / Simple 100 / Simple AVG) ของ BU + Account + Period ลบจริงใน DB
async function clearReconData({ kind, bu, account, period }) {
  const q = new URLSearchParams({ bu, account, period });
  let path = 'input-summary';
  if (kind !== 'input_summary') { path = 'simple'; q.set('type', kind); }
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/${path}?${q.toString()}`, { method: 'DELETE', headers: rfAuth() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `ล้างข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
  return d;
}
const DOT_KIND_LABEL = { input_summary: 'Input Summary', simple_100: 'Simple 100', simple_avg: 'Simple AVG' };
const rfSize = (n) => { const b = Number(n || 0); return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; };
const rfDate = (d) => { try { return new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
const RF_TEMPLATE = { '100': '100%', '100_simple': '100% + Simple', avg: 'เฉลี่ย (AVG)', pct: 'หัว %' };

// MARKER_VATRECONCILE_SP_SEND_FRONT_V1 -- ส่งไฟล์ Report ไป SharePoint: เว็บโหลดไฟล์ลง Downloads -> สั่ง Handler (fastapn-sp://) ย้ายเข้าโฟลเดอร์ OneDrive -> บันทึกว่าส่งแล้ว
// เลข BU + เดือน อ่านจากชื่อไฟล์ {เลข BU}_{BU}_{Account}_{MON-YY}.xlsx (อ่านไม่ได้ = ไม่ส่ง) -- ตรงกับ Backend (vatReconcileReportFiles.js parseSpTarget)
const SP_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function parseSpTarget(fileName) {
  const m = /^(\d{3,6})_.+_([A-Za-z]{3})-(\d{2})\.xlsx$/.exec(String(fileName || ''));
  if (!m) return null;
  const mi = SP_MONTHS.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  return { buCode: m[1], period: `20${m[3]}.${String(mi + 1).padStart(2, '0')}` };
}
async function markReportSentToSp(file) {
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/sp-sent`, { method: 'POST', headers: rfAuth() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `บันทึกการส่งไม่สำเร็จ (HTTP ${res.status})`);
  return d;
}
function launchSpHandler(fileName, t) {
  const uri = `fastapn-sp://send?name=${encodeURIComponent(fileName)}&bu=${encodeURIComponent(t.buCode)}&period=${encodeURIComponent(t.period)}`;
  const a = document.createElement('a');
  a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
}
// MARKER_VATRECONCILE_SP_DELETE_FRONT_V1 -- ลบไฟล์ใน SharePoint ผ่าน Folder Path เดียวกับตอนส่ง (Handler action=delete)
function launchSpDelete(fileName, t) {
  const uri = `fastapn-sp://delete?name=${encodeURIComponent(fileName)}&bu=${encodeURIComponent(t.buCode)}&period=${encodeURIComponent(t.period)}`;
  const a = document.createElement('a');
  a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
}

// MARKER_VATRECONCILE_FILE_ICONS_V1 -- ไอคอนปุ่ม Download / ลบ / ส่ง SharePoint ในตารางไฟล์ Report
const RF_ICON_PATH = {
  download: 'M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V4h6v3',
  send: 'M12 20V8m0 0l-4.5 4.5M12 8l4.5 4.5M5 4h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  release: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', // MARKER_VATRECONCILE_REPORT_CONFIRM_V1
  timeline: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h3', // MARKER_RECON_GO_TIMELINE_V1
  note: 'M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6', // MARKER_VATRECONCILE_FIRST_DRAFT_NOTE_V1
};
function RfIcon({ kind, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <path d={RF_ICON_PATH[kind]} />
    </svg>
  );
}

function SpSendDialog({ file, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const t = parseSpTarget(file.file_name);
  const confirmSend = async () => {
    setBusy(true); setMsg(null);
    try {
      await downloadReportFile(file); // เบราว์เซอร์โหลดไฟล์ลง Downloads (Login ปกติ)
      launchSpHandler(file.file_name, t); // Handler รอไฟล์ใน Downloads แล้วย้ายเข้าโฟลเดอร์ SharePoint (OneDrive)
      await markReportSentToSp(file);
      setMsg({ ok: true, text: 'ส่งคำสั่งแล้ว — ไฟล์ถูกย้ายเข้าโฟลเดอร์ SharePoint ในเครื่อง รอ OneDrive ซิงก์ขึ้น (ถ้าไม่มีแจ้งเตือนมุมจอ ให้ติดตั้ง Handler ที่ Document Center > Setup > Tools)' });
      if (onDone) onDone();
    } catch (err) {
      setMsg({ ok: false, text: err?.message || 'ส่งไม่สำเร็จ' });
    } finally { setBusy(false); }
  };
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1200, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { if (!busy) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: '94vw', boxShadow: '0 12px 40px rgba(0,0,0,.25)', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1e2a3a' }}>ส่งไฟล์ไป SharePoint</div>
        <div style={{ fontSize: 13, color: '#57606a', marginTop: 10, wordBreak: 'break-all' }}><b>ไฟล์:</b> {file.file_name}</div>
        {t ? (
          <div style={{ fontSize: 13, color: '#57606a', marginTop: 6, wordBreak: 'break-all' }}><b>ปลายทาง:</b> VAT Controller \ My System \ Z_Report Reconcile \ <b>{t.buCode}</b> \ <b>{t.period}</b> \</div>
        ) : (
          <div style={{ fontSize: 13, color: '#cf222e', marginTop: 8 }}>อ่านเลข BU / เดือน จากชื่อไฟล์ไม่ได้ (รูปแบบต้องเป็น เลขBU_BU_Account_MON-YY.xlsx) จึงส่งไม่ได้</div>
        )}
        <ul style={{ fontSize: 12.5, color: '#6b7788', margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>ถ้าในโฟลเดอร์ปลายทางมีไฟล์ชื่อเดียวกัน จะถูกเขียนทับ (SharePoint เก็บ Version History ให้)</li>
          <li>ต้องติดตั้ง SharePoint Handler บนเครื่องนี้ และมีสิทธิ์ Edit ในโฟลเดอร์ SharePoint</li>
          <li>ไฟล์จะขึ้น SharePoint เมื่อ OneDrive ซิงก์เสร็จ (เครื่องต้องเปิดและออนไลน์)</li>
        </ul>
        {msg && <div style={{ marginTop: 12, fontSize: 12.5, color: msg.ok ? '#1a7f37' : '#cf222e' }}>{msg.text}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" disabled={busy} onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid #d0d7de', background: '#fff', color: '#24292f', cursor: 'pointer' }}>{msg && msg.ok ? 'ปิด' : 'ยกเลิก'}</button>
          {!(msg && msg.ok) && <button type="button" disabled={busy || !t} onClick={confirmSend} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#0969da', color: '#fff', cursor: 'pointer', opacity: busy || !t ? 0.5 : 1 }}>{busy ? 'กำลังส่ง...' : 'Confirm ส่ง'}</button>}
        </div>
      </div>
    </div>
  );
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
      (r) => r.input_summary_active || r.simple_100_active || r.simple_avg_active
    );
    if (!anyActive) continue; // MARKER_VATRECONCILEDASHBOARD_HIDE_EMPTY_BU_V1 -- ไม่มีข้อมูลเลย ไม่ต้องโชว์แถวนี้ | MARKER_VATRECONCILEDASHBOARD_DETAIL_FIRST_V1 -- ยึด Detail (Input Summary/Simple) เป็นหลัก: มีแต่ TB = ไม่มีข้อมูล

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


// MARKER_RECON_JUMP_V1 -- Timeline กด "ไป Reconcile" -> ฝากค่า Period/BU/Account ไว้ใน sessionStorage แล้วหน้านี้เลือกให้เอง
function peekReconJump() {
  try { const j = JSON.parse(sessionStorage.getItem('recon_jump') || 'null'); return j && j.period && j.bu && Date.now() - (j.t || 0) < 60000 ? j : null; } catch (e) { return null; }
}

export default function VatReconcileDashboard({ defaultPeriod, onNavigate }) {
  const [reconJump, setReconJump] = useState(peekReconJump);
  const [period, setPeriodRaw] = useState((reconJump && reconJump.period) || defaultPeriod || new Date().toISOString().slice(0, 7));
  const fillStartedAtRef = useRef(new Date()); // MARKER_VATRECONCILE_USER_TRANSACTION_V1 -- Start_fill: เลือก Period = เริ่มนับงาน | Save (Export) = 1 Job แล้วเริ่มนับใหม่
  const setPeriod = useCallback((v) => { fillStartedAtRef.current = new Date(); setPeriodRaw(v); logActivityTs('PERIOD_SELECT', { period: v }); }, []);
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
  const buPercentRef = useRef(new Map()); // MARKER_RECON_FIRSTDRAFT_TO_TIMELINE_V1 -- ให้ Callback อ่าน VAT % ของ BU (หัว 100 / หัว %) ตอนเรียกใช้
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

  // MARKER_VATRECONCILEDASHBOARD_RECONCILE_POPUP_V1 -- ปุ่ม Preview ใน Control Zone เปิด Popup Reconcile ตาม Template จริงของ Macro
  const [reconPopup, setReconPopup] = useState(null); // null | { loading, error, data, bu, account, period }
  const openReconcilePopupFor = useCallback(async (ctx) => { // MARKER_VATRECONCILE_REPORT_FILES_SCOPE_V1 -- เปิด Popup จาก BU/Account/Period ใดก็ได้ (ใช้กับปุ่ม Preview ในที่เก็บไฟล์)
    if (!ctx?.bu || !ctx?.account) return;
    setReconPopup({ ...ctx, loading: true, error: '', data: null });
    try {
      const data = await fetchReconcileReport(ctx);
      setReconPopup({ ...ctx, loading: false, error: '', data });
    } catch (err) {
      setReconPopup({ ...ctx, loading: false, error: err?.message || 'เกิดข้อผิดพลาดระหว่างสร้าง Reconcile Report', data: null });
    }
  }, []);
  const openReconcilePopup = useCallback(() => {
    if (!ccBusinessUnit || !ccAccountCode) return;
    openReconcilePopupFor({ bu: ccBusinessUnit, account: ccAccountCode, period });
  }, [ccBusinessUnit, ccAccountCode, period, openReconcilePopupFor]);
  useEffect(() => {
    if (!reconPopup) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setReconPopup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reconPopup]);

  // MARKER_VATRECONCILEDASHBOARD_REPORT_FILES_V1 -- รายการไฟล์รายงานภาษีของ BU/Period ที่เลือก (Zone ล่าง)
  const [reportFiles, setReportFiles] = useState([]);
  const [reportFilesLoading, setReportFilesLoading] = useState(false);
  const [reportFilesError, setReportFilesError] = useState('');
  const [filePreview, setFilePreview] = useState(null); // MARKER_VATRECONCILE_FILE_PREVIEW_FRONT_V18
  const [reportScope, setReportScope] = useState('mine'); // MARKER_VATRECONCILE_REPORT_FILES_SCOPE_V1
  const [noteDlg, setNoteDlg] = useState(null); // MARKER_VATRECONCILE_FIRST_DRAFT_NOTE_V1 -- { file, value, saving, err }
  const [spConfirm, setSpConfirm] = useState(null); // MARKER_VATRECONCILE_SP_SEND_FRONT_V1 -- ไฟล์ที่กำลังจะส่ง SharePoint (เปิดกล่อง Confirm)
  const loadReportFiles = useCallback(async () => {
    setReportFilesLoading(true);
    setReportFilesError('');
    try {
      setReportFiles(await fetchReportFiles({ scope: reportScope })); // V16: ไม่ Filter ตาม Period/BU
    } catch (err) {
      setReportFilesError(err?.message || 'โหลดรายการไฟล์ไม่สำเร็จ');
    } finally {
      setReportFilesLoading(false);
    }
  }, [reportScope]);
  useEffect(() => { loadReportFiles(); }, [loadReportFiles]);
  const handleExportFromPopup = useCallback(async (opts) => { // MARKER_VATRECONCILE_FIRST_DRAFT_V1 -- opts.draft = First Draft
    if (!reconPopup) return;
    const d0 = fillStartedAtRef.current || new Date(); const p2 = (n) => String(n).padStart(2, '0');
    const fillStartedAt = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())} ${p2(d0.getHours())}:${p2(d0.getMinutes())}:${p2(d0.getSeconds())}.${String(d0.getMilliseconds()).padStart(3, '0')}`;
    const file = await exportReportFile({ bu: reconPopup.bu, account: reconPopup.account, period: reconPopup.period, fillStartedAt, draft: opts?.draft === true });
    fillStartedAtRef.current = new Date(); // Job ถัดไปเริ่มนับใหม่
    // Timeline: Backend อัปเดตเอง
    await loadReportFiles();
    return file;
  }, [reconPopup, loadReportFiles]);
  const handleDeleteReportFile = useCallback(async (file) => { // MARKER_VATRECONCILE_REPORT_FILES_DELETE_V1
    const spT = file.sp_sent_at ? parseSpTarget(file.file_name) : null;
    const spNote = file.sp_sent_at ? (spT ? '\n\nหมายเหตุ: ไฟล์นี้ส่งไป SharePoint แล้ว — ระบบจะลบไฟล์ใน SharePoint ด้วย (ผ่านโฟลเดอร์ OneDrive ในเครื่องนี้ กู้คืนได้จาก Recycle Bin ของ SharePoint)' : '\n\nหมายเหตุ: ไฟล์นี้ส่งไป SharePoint แล้ว แต่อ่านชื่อไฟล์ไม่ได้ — ไฟล์ใน SharePoint จะไม่ถูกลบ') : ''; // MARKER_VATRECONCILE_DELETE_SP_NOTE_V2
    const ok = await confirmDialog.confirm(`ต้องการลบไฟล์ ${file.file_name} ?\nลบแล้วกู้คืนไม่ได้ (Export ใหม่ได้จาก Preview)${spNote}`, { title: 'ลบไฟล์รายงานภาษี', confirmText: 'ลบไฟล์', cancelText: 'ยกเลิก', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteReportFile(file);
      try { // ย้อนสถานะ Timeline (Finish -> Pending) ตามไฟล์ที่ลบ
        const all = await fetchReportFiles({ scope: 'all' });
        const rest = (Array.isArray(all) ? all : []).filter((r) => r.id !== file.id && r.bu === file.bu && String(r.account) === String(file.account) && r.period === file.period);
        /* Timeline อัปเดตที่ Backend */
      } catch (e) { /* ไม่กระทบการลบ */ }
      if (spT) { try { launchSpDelete(file.file_name, spT); } catch (e) { /* ลบ SharePoint ไม่สำเร็จ = ไม่กระทบการลบในระบบ */ } }
      await loadReportFiles();
    } catch (err) { setReportFilesError(err?.message || 'ลบไม่สำเร็จ'); }
  }, [loadReportFiles]);
  const handleConfirmReportFile = useCallback(async (file) => { // MARKER_VATRECONCILE_REPORT_CONFIRM_V1 -- ปุ่มเดียว: ยังไม่ Confirm = Confirm (เริ่มนับ Expire + ส่ง SharePoint ให้อัตโนมัติ) | Confirm แล้ว = Release
    try {
      if (file.confirmed_at) {
        const okR = await confirmDialog.confirm(`Release ไฟล์ ${file.file_name} ?\nยกเลิกการ Confirm และหยุดนับวันหมดอายุของ Input — Download จะถูกล็อกอีกครั้ง\n(ไฟล์ที่ส่งไป SharePoint แล้วจะไม่ถูกลบ)`, { title: 'Release ไฟล์รายงาน' });
        if (!okR) return;
        await releaseReportFile(file);
        try { // Release -> Timeline Final กลับ Pending (First Draft กลับด้วยเมื่อไม่มีไฟล์ Draft เหลืออยู่)
          const all = await fetchReportFiles({ scope: 'all' });
          const hasDraft = (Array.isArray(all) ? all : []).some((r) => r.is_draft && r.id !== file.id && r.bu === file.bu && String(r.account) === String(file.account) && r.period === file.period);
          /* Timeline อัปเดตที่ Backend */
        } catch (e) { /* ไม่กระทบการ Release */ }
        await loadReportFiles();
        return;
      }
      const ok = await confirmDialog.confirm(`Confirm ไฟล์ ${file.file_name} ?\nถือว่าจบงาน: เริ่มนับวันหมดอายุของ Input และระบบจะส่งไฟล์ไป SharePoint ให้อัตโนมัติ\n(ถ้า Export ใหม่ทับไฟล์นี้ ต้อง Confirm ใหม่)`, { title: 'Confirm ไฟล์รายงาน' });
      if (!ok) return;
      await confirmReportFile(file);
      /* Timeline อัปเดตที่ Backend */
      await loadReportFiles();
      const t = parseSpTarget(file.file_name);
      if (t) { // ส่ง SharePoint อัตโนมัติ (ขั้นตอนเดียวกับปุ่มส่งเดิม)
        try {
          await downloadReportFile(file);
          launchSpHandler(file.file_name, t);
          await markReportSentToSp(file);
          await loadReportFiles();
        } catch (e) { setReportFilesError(`Confirm แล้ว แต่ส่ง SharePoint อัตโนมัติไม่สำเร็จ: ${e?.message || ''}`); }
      } else setReportFilesError('Confirm แล้ว แต่อ่านเลข BU / เดือน จากชื่อไฟล์ไม่ได้ จึงไม่ส่ง SharePoint');
    } catch (err) { setReportFilesError(err?.message || 'ไม่สำเร็จ'); }
  }, [loadReportFiles]);
  const handleDownloadReportFile = useCallback(async (file) => {
    try { await downloadReportFile(file); } catch (err) { setReportFilesError(err?.message || 'ดาวน์โหลดไม่สำเร็จ'); }
  }, []);
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

  const [clearNotice, setClearNotice] = useState(null);
  const [dotMenu, setDotMenu] = useState(null); // MARKER_VATRECONCILE_DOT_CLEAR_V1
  useEffect(() => {
    if (!dotMenu) return undefined;
    const close = () => setDotMenu(null);
    window.addEventListener('click', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', close); };
  }, [dotMenu]);
  const openDotMenu = (e, kind, bu, account, active, label) => {
    if (!active) return;
    e.preventDefault();
    setDotMenu({ x: e.clientX, y: e.clientY, kind, bu, account, label: label || bu });
  };
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

  useEffect(() => { // รับ Broadcast จากเครื่องอื่น/เครื่องตัวเอง -> โหลดสถานะจุดใหม่ถ้าเป็น Period เดียวกัน
    const unsub = subscribeWs(['vat_reconcile_data_changed'], (ev, parsed) => {
      const d = (parsed && (parsed.data || parsed)) || {};
      if (!d.period || d.period === period) loadStatus(period);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [period, loadStatus]);

  const handleClearDot = useCallback(async (m) => {
    setDotMenu(null);
    const ok = await confirmDialog.confirm(`ล้างข้อมูล ${DOT_KIND_LABEL[m.kind]} ของ BU ${m.label || m.bu} · Account ${m.account} · Period ${period} ?\nลบข้อมูลออกจากฐานข้อมูลจริง กู้คืนไม่ได้ (ต้อง Upload ใหม่)`, { title: 'ล้างข้อมูล', confirmText: 'ล้างข้อมูล', cancelText: 'ยกเลิก', variant: 'danger' });
    if (!ok) return;
    try {
      const r = await clearReconData({ kind: m.kind, bu: m.bu, account: m.account, period });
      const n = Number(r?.deleted) || 0;
      const det = r?.details != null ? ` (${Number(r.details)} รายการ)` : '';
      broadcastWs('vat_reconcile_data_changed', { bu: m.bu, account: m.account, period, kind: m.kind }); // MARKER_VATRECONCILE_DOT_CLEAR_BROADCAST_V1 -- ทุกเครื่องโหลดสถานะจุดใหม่ทันที
      await loadStatus(period);
      confirmDialog.alert( // MARKER_VATRECONCILE_DOT_CLEAR_POPUP_V1 -- แจ้งผลการล้างเป็น Popup
        n > 0
          ? `ล้าง ${DOT_KIND_LABEL[m.kind]} สำเร็จ\nBU ${m.label || m.bu} · Account ${m.account} · Period ${period}\nลบทั้งหมด ${n} ชุด${det}`
          : `ไม่พบข้อมูล ${DOT_KIND_LABEL[m.kind]} ที่จะลบ (ลบ 0 รายการ)\nBU ${m.label || m.bu} · Account ${m.account} · Period ${period}`,
        { title: n > 0 ? 'ล้างข้อมูลสำเร็จ' : 'ไม่มีข้อมูลที่ลบ', variant: n > 0 ? 'success' : 'warning' });
    } catch (err) { confirmDialog.alert(err?.message || 'ล้างข้อมูลไม่สำเร็จ', { title: 'ล้างข้อมูลไม่สำเร็จ', variant: 'danger' }); }
  }, [period, loadStatus]);

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
  buPercentRef.current = buPercentMap;

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

  useEffect(() => { // MARKER_RECON_JUMP_V1 -- ข้อมูลของ Period โหลดเสร็จ -> เลือก BU + Account ตามที่ Timeline ส่งมา (ครั้งเดียว)
    if (!reconJump || loading || period !== reconJump.period || !rows.length) return;
    const hit = rows.find((r) => r.label === reconJump.bu && (!reconJump.account || r.account === reconJump.account));
    if (hit) handleSelectBuAccount(hit.label, hit.account);
    try { sessionStorage.removeItem('recon_jump'); } catch (e) {}
    setReconJump(null);
  }, [reconJump, loading, rows, period, handleSelectBuAccount]);

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
      {/* MARKER_VATRECONCILEDASHBOARD_TOPZONE_35VH_EQUAL_HEIGHT_V1 -- Zone บน (Dashboard + Control Zone) สูงเท่ากัน และกินแค่ 35% ของความสูงจอ (35vh) เหมือน AP Reconcile -- ที่เหลือให้ Zone Preview (flex:1) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.3fr 1fr', gap: 16, height: '35vh', flexShrink: 0 }}>
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
                {clearNotice && <p style={{ fontSize: 13, fontWeight: 700, color: clearNotice.ok ? '#1a7f37' : '#a30d16' }}>{clearNotice.ok ? '✅ ' : '⚠️ '}{clearNotice.text}</p>}

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
                                    onContextMenu={(e) => openDotMenu(e, 'input_summary', pr.bu, acct, cell.input_summary_active, pr.label)}
                                    onDoubleClick={() => handleQuickPreview('input_summary', pr.label, acct)}
                                    title={`BU ${pr.label} · Account ${acct} (Double-click เพื่อดู Input Summary Preview)`}
                                  ><StatusDot active={cell.input_summary_active} /></td>
                                  <td style={plainCellStyle} onClick={onClick} onContextMenu={(e) => openDotMenu(e, 'simple_100', pr.bu, acct, cell.simple_100_active, pr.label)} title={`BU ${pr.label} · Account ${acct}`}><StatusDot active={cell.simple_100_active} /></td>
                                  {is100 ? xCell(plainCellStyle, 'avg', 'BU นี้ตั้งค่า VAT 100% — ไม่มี Simple AVG แน่นอน') : <td style={plainCellStyle} onClick={onClick} onContextMenu={(e) => openDotMenu(e, 'simple_avg', pr.bu, acct, cell.simple_avg_active, pr.label)} title={`BU ${pr.label} · Account ${acct}`}><StatusDot active={cell.simple_avg_active} /></td>}
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

            {dotMenu && (
              <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', left: dotMenu.x, top: dotMenu.y, zIndex: 3000, background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 4, minWidth: 170 }}>
                <div style={{ padding: '4px 10px', fontSize: 11, color: '#6e7781' }}>{dotMenu.bu} · {dotMenu.account} · {DOT_KIND_LABEL[dotMenu.kind]}</div>
                <button type="button" onClick={() => handleClearDot(dotMenu)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 13, fontWeight: 700, color: '#cf222e', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer' }}>🗑 ล้างข้อมูล</button>
              </div>
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
          border: '0.5px solid #ddd', borderRadius: 12, height: '100%',
          background: '#fff', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* MARKER_VATRECONCILEDASHBOARD_TOPZONE_35VH_EQUAL_HEIGHT_V1 -- Control Zone สูง 100% เท่ากล่องซ้าย (เลิก alignSelf:'start') เนื้อหาเกินให้ Scroll ในกรอบ */}
          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 16, flexShrink: 0 }}> {/* MARKER_VATRECONCILEDASHBOARD_PREVIEW_BUTTON_BOTTOM_V1 -- ดันปุ่ม Preview ลงชิดล่างของ Control Zone */}
              <button
                type="button"
                disabled={!ccBusinessUnit || !ccAccountCode}
                onClick={() => openReconcilePopup()} // MARKER_VATRECONCILEDASHBOARD_RECONCILE_POPUP_V1 -- เดิม handlePreview() (แสดงใน Zone ล่าง)
                style={{
                  flex: 1, padding: '11px', fontSize: 14, fontWeight: 700,
                  background: (ccBusinessUnit && ccAccountCode)
                    ? 'linear-gradient(135deg, #2ea043, #1a7f37)'
                    : 'linear-gradient(135deg, #b8bfc7, #9aa2ab)',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (ccBusinessUnit && ccAccountCode) ? 'pointer' : 'not-allowed', flexShrink: 0,
                }}
              >
                Reconcile {/* MARKER_VATRECONCILE_BUTTON_RENAME_V21 -- เปลี่ยนชื่อปุ่มจาก Preview */}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MARKER_VATRECONCILEDASHBOARD_REPORT_FILES_V1 -- Zone ล่าง = ที่เก็บไฟล์รายงานภาษี (My Job / All Job เหมือน Zone ของ AP) แสดงทุก BU ไม่ต้องเลือก BU */}
      <div style={{ marginTop: 16, border: '0.5px solid #ddd', borderRadius: 12, background: '#fff', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '0.5px solid #ddd', background: '#f7f7f7', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['mine', 'all'].map((sc) => (
              <button key={sc} type="button" onClick={() => setReportScope(sc)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${reportScope === sc ? '#1e2a3a' : '#d0d7de'}`,
                background: reportScope === sc ? '#1e2a3a' : '#fff', color: reportScope === sc ? '#fff' : '#57606a',
              }}>
                <span aria-hidden="true">{sc === 'mine' ? '👤' : '👥'}</span>
                {sc === 'mine' ? 'My Job' : 'All Job'}
              </button>
            ))}
            <span style={{ fontSize: 12, color: '#8b95a1', alignSelf: 'center', marginLeft: 4 }}>
              {reportFilesLoading ? 'กำลังโหลด…' : `${reportFiles.length} ไฟล์ · ทุก Period`}
            </span>
          </div>
        </div>
        {reportFilesError && <p style={{ fontSize: 13, color: '#a30d16', margin: '8px 16px 0' }}>{reportFilesError}</p>}
        <div style={{ padding: 0, overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'separate', borderSpacing: 0, minWidth: 860 }}>
            <thead>
              <tr style={{ background: RP_HEAD_GRAD }}>
                {['BU', 'Filename', 'Report Type', 'Generated By', 'Expire Date', 'Preview', 'Status', 'Action'].map((h) => ( /* MARKER_VATRECONCILE_ACTION_HEADER_V1 -- หัวคอลัมน์ Download -> Action (มี Confirm/Release + โหลด + ลบ) */
                  <th key={h} style={{ position: 'sticky', top: 0, background: RP_HEAD_GRAD, textAlign: h === 'Filename' ? 'left' : 'center', padding: '8px 10px', color: '#334155', fontWeight: 700, fontSize: 11.5, boxShadow: `0 1px 0 ${RP_BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportFiles.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center', color: '#8b95a1', fontSize: 13 }}>
                    {reportFilesLoading ? 'กำลังโหลด…' : 'ยังไม่มีไฟล์ที่ Generate ไว้ — กด Reconcile แล้วกด "Export ไฟล์" ใน Popup'}
                  </td>
                </tr>
              ) : reportFiles.map((f, i) => (
                <tr key={f.id} style={{ borderBottom: '0.5px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>{f.bu}</td>
                  <td style={{ padding: '8px 10px' }}>{f.file_name}{f.is_draft && f.draft_serial && <div style={{ fontSize: 10.5, color: '#7d4e00', marginTop: 2 }}>Serial {f.draft_serial}</div>}{!f.is_draft && f.draft_serial && <div style={{ fontSize: 10.5, color: '#8a94a3', marginTop: 2 }} title="First Draft ของชุดนี้ (ถูกลบตอน Confirm)">จาก Draft {f.draft_serial}</div>}{f.is_draft && f.note && <div style={{ fontSize: 11, color: '#57606a', marginTop: 2, whiteSpace: 'pre-wrap' }}>Note: {f.note}</div>}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>Input Reconcile · {f.account} · {RF_TEMPLATE[f.template] || f.template || '-'}{f.period ? ` · ${formatPeriodLabel(f.period)}` : ''}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{f.created_by || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }} title={f.input_expire_at ? 'วันหมดอายุของ Input (นับจากวัน Confirm)' : 'ยังไม่ Confirm'}>{f.input_expire_at ? new Date(f.input_expire_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button type="button" title="Preview" onClick={() => setFilePreview(f)} style={{ padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #d0d7de', background: '#fff', color: '#57606a', cursor: 'pointer' }}>Preview</button>
                  </td>
                  {/* MARKER_VATRECONCILE_STATUS_ACTION_COLUMNS_V1 -- Status = ปุ่มสลับ Confirm/Release | Action = ไอคอน Download + Delete */}
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {f.is_draft ? (<span title="First Draft — เก็บใน Backend เท่านั้น ยังไม่ส่ง SharePoint (Save เมื่อ Balance เพื่อใช้งานจริง)" style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #bf8700', background: '#fff8c5', color: '#7d4e00' }}>Draft</span>) : (
                      <button type="button" title={f.confirmed_at ? `Confirm แล้ว${f.confirmed_by ? ` โดย ${f.confirmed_by}` : ''} · ${rfDate(f.confirmed_at)} — กดเพื่อ Release` : 'Confirm ไฟล์ (จบงาน: เริ่มนับ Expire + ส่ง SharePoint อัตโนมัติ)'} disabled={!!f.file_removed_at} onClick={() => handleConfirmReportFile(f)} style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${f.confirmed_at ? '#bf8700' : '#1a7f37'}`, background: '#fff', color: f.confirmed_at ? '#9a6700' : '#1a7f37', cursor: 'pointer', opacity: f.file_removed_at ? 0.4 : 1 }}><RfIcon kind={f.confirmed_at ? 'release' : 'check'} />{f.confirmed_at ? 'Release' : 'Confirm'}</button>)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {!f.is_draft && <button type="button" title={f.confirmed_at ? 'Download' : 'ยังไม่ Confirm — Download ไม่ได้'} disabled={!f.confirmed_at} onClick={() => handleDownloadReportFile(f)} style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: f.confirmed_at ? 'pointer' : 'not-allowed', opacity: f.confirmed_at ? 1 : 0.35 }}><RfIcon kind="download" /></button>}
                      {f.is_draft && <button type="button" title={f.note ? 'แก้ Note' : 'เพิ่ม Note'} onClick={() => setNoteDlg({ file: f, value: f.note || '', saving: false, err: '' })} style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: '1px solid #bf8700', background: f.note ? '#fff8c5' : '#fff', color: '#7d4e00', cursor: 'pointer' }}><RfIcon kind="note" /></button>}
                      <button type="button" title="ลบไฟล์" onClick={() => handleDeleteReportFile(f)} style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: '1px solid #cf222e', background: '#fff', color: '#cf222e', cursor: 'pointer' }}><RfIcon kind="trash" /></button>
                      <button type="button" title={onNavigate ? `ไป Timeline ของ BU ${f.bu}` : 'ไม่พร้อมใช้งาน'} disabled={!onNavigate} onClick={() => { try { sessionStorage.setItem('timeline_jump', JSON.stringify({ bu: f.bu, t: Date.now() })); } catch (e) {} onNavigate && onNavigate('vat-timeline'); }} style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', cursor: onNavigate ? 'pointer' : 'not-allowed' }}><RfIcon kind="timeline" /></button>
                    </div>
                  </td>
                  {/* MARKER_VATRECONCILE_SP_COLUMN_REMOVED_V1 -- เอาคอลัมน์ SharePoint ออก: ส่งอัตโนมัติตอน Confirm ไม่มีปุ่มส่งเอง */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filePreview && <FileSheetPreview file={filePreview} onClose={() => setFilePreview(null)} />}
      {noteDlg && ( // MARKER_VATRECONCILE_FIRST_DRAFT_NOTE_V1
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => !noteDlg.saving && setNoteDlg(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 18, width: 440, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Note · First Draft</div>
            <div style={{ fontSize: 11.5, color: '#57606a', marginBottom: 8 }}>{noteDlg.file.file_name}{noteDlg.file.draft_serial ? ` · ${noteDlg.file.draft_serial}` : ''}<br />Note จะบันทึกลง Timeline ของคุณด้วย</div>
            <textarea autoFocus value={noteDlg.value} maxLength={2000} onChange={(e) => setNoteDlg({ ...noteDlg, value: e.target.value })} rows={5} style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: 8, border: '1px solid #d0d7de', borderRadius: 6, resize: 'vertical' }} placeholder="เช่น รอแก้ยอดสาขา 040201 / รอเอกสารเพิ่ม" />
            {noteDlg.err && <div style={{ color: '#cf222e', fontSize: 12, marginTop: 6 }}>{noteDlg.err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" disabled={noteDlg.saving} onClick={() => setNoteDlg(null)} style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #d0d7de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
              <button type="button" disabled={noteDlg.saving} onClick={async () => {
                setNoteDlg((d) => ({ ...d, saving: true, err: '' }));
                try { await saveDraftNote(noteDlg.file, noteDlg.value); /* Timeline อัปเดตที่ Backend */setNoteDlg(null); await loadReportFiles(); }
                catch (err) { setNoteDlg((d) => (d ? { ...d, saving: false, err: err?.message || 'บันทึกไม่สำเร็จ' } : d)); }
              }} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', cursor: 'pointer' }}>{noteDlg.saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
      {spConfirm && <SpSendDialog file={spConfirm} onClose={() => setSpConfirm(null)} onDone={loadReportFiles} />}

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
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {quickPreviewModal.loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
              {quickPreviewModal.error && <p style={{ fontSize: 13, color: '#a30d16' }}>{quickPreviewModal.error}</p>}
              {!quickPreviewModal.loading && !quickPreviewModal.error && quickPreviewModal.data && (
                <ReportPreviewTable data={quickPreviewModal.data} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* MARKER_VATRECONCILEDASHBOARD_RECONCILE_POPUP_V1 -- Popup Preview แบบ Reconcile จริงตาม Macro */}
      {reconPopup && (
        <ReconcileReportPopup
          state={reconPopup}
          periodLabel={formatPeriodLabel(reconPopup.period)}
          onClose={() => setReconPopup(null)}
          onExport={handleExportFromPopup}
        />
      )}
    </div>
  );
}

// MARKER_VATRECONCILEDASHBOARD_RECONCILE_POPUP_V1 -- Popup แสดง Reconcile ตาม Template จริงของ Macro
// (ชีต ReportVat_VGR / ReportVat_AVG + Cover: Per TB / Per Detail / Diff, Check Diff, Total) ข้อมูลมาจาก /dashboard/reconcile-report
const RP_BORDER = '#d0d7de';
// MARKER_VATRECONCILE_BRANCH_DOT_V1 -- สถานะสาขาแสดงเป็นจุดสีข้างรหัสสาขา (เขียว=Active, แดง=Closed, เหลือง=Relocate, น้ำเงิน=Temporary) ไม่มีคอลัมน์แยก
const RP_BRANCH_DOT = { Active: '#2da44e', Closed: '#cf222e', Relocate: '#d4a72c', Temporary: '#0969da' };
const RP_HEAD_GRAD = 'linear-gradient(180deg, #eef4ff, #e3ecfb)';
const rpFmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RP_PROCESS = {
  '100': [
    'Detail (Input Summary รายใบกำกับ): ตรวจรายแถว ROUND(มูลค่า×7/100 − ภาษีที่ใช้สิทธิ์, 2) ถ้าเกิน ±0.05 = Unbalance',
    'Pivot: รวมตามสาขา → มูลค่า / ภาษีที่ชำระ',
    'Report: Input-N 100% = Pivot · Excel-N 100% = ว่าง (ไม่มี Simple) · รวม = Input + Excel · รวมทั้งสิ้น = รวม + ยื่นเพิ่มเติม',
    'ภาษีตาม T/B = TB(SubAcc 999999) − TB(CPC 46119) ต่อสาขา (CPC 46250 บวก/ลบหักล้างกัน)',
    'ผลต่าง = ภาษีรวมทั้งสิ้น − ภาษีตาม T/B · Total = SUBTOTAL(9) ทุกสาขา',
    'Check Diff = "Found Diff in Detail" ถ้ามี Unbalance ใน Detail ไม่เช่นนั้น "Approve Balance"',
    'Cover: Per TB = TB รวมทั้งหมด · Per Detail = ภาษีรวมทั้งสิ้น · Diff · FinCredit 46250 = −TB(CPC 46250)',
  ],
  '100_simple': [
    'Detail → Pivot เหมือนแบบไม่มี Simple (Input-N 100%)',
    'Excel-N 100% = Simple 100 แถว "รวมสาขา" ของแต่ละสาขา (มูลค่า / ภาษีที่ใช้สิทธิ์)',
    'รวม = Input + Excel · รวมทั้งสิ้น = รวม + ยื่นเพิ่มเติม · T/B และผลต่างสูตรเดียวกับแบบไม่มี Simple',
    'Total = SUBTOTAL(9) ทุกสาขา · Check Diff / Cover เหมือนแบบ 100%',
  ],
  avg: [
    'A-Detail (Input รายใบกำกับ) มี มูลค่า/ภาษีที่ชำระ และ มูลค่า/ภาษีที่ใช้สิทธิ์ตามอัตราเฉลี่ย',
    'Input-N 100%: ภาษี = Σ มูลค่าที่ชำระของแถวที่ภาษีที่ชำระ = 0 · มูลค่า = ภาษี × 100 / 7',
    'Input ใช้สิทธิ์ x% = Σ ที่ใช้สิทธิ์ − Σ ที่ใช้สิทธิ์ของแถวที่ Calculate Tax = 0',
    'Excel ใช้สิทธิ์ x% = Simple AVG แถว "รวมสาขา" · รวม = Input-N100% + Input ใช้สิทธิ์ + Excel ใช้สิทธิ์',
    'ภาษีตาม T/B = TB รวมตามสาขา · ผลต่าง = ภาษีรวมทั้งสิ้น − T/B · Total = SUM ทุกสาขา (แบบ AVG ไม่มี Check Diff และไม่มีบรรทัด FinCredit 46250)',
  ],
};
const RP_TEMPLATE_LABEL = { '100': 'แบบ 100% (ไม่มี Simple)', '100_simple': 'แบบ 100% + Simple', avg: 'แบบเฉลี่ย (AVG) + Simple', pct: 'แบบหัว % (เฉลี่ยตาม % สาขา)' }; // MARKER_VATRECONCILE_PCT_TEMPLATE_V1

function ReconcileReportPopup({ state, periodLabel, onClose, onExport }) {
  const { loading, error, bu, account } = state;
  const [sampleHost, setSampleHost] = useState(null); // ที่วาง Popup Sampling (อยู่ใน Popup Reconcile)
  const [samplingOpen, setSamplingOpen] = useState(false); // MARKER_VATRECONCILE_SAMPLING_BTN_V1 -- ปุ่ม Sampling ที่แถบล่าง เปิด/ปิดแผงหาชุดรายการที่รวมกันได้ยอด
  const [liveData, setLiveData] = useState(null); // MARKER_VATRECONCILE_CELL_EDIT_FRONT_V14 -- ข้อมูล Reconcile ที่คำนวณใหม่หลังแก้ต้นทาง
  const data = liveData || state.data;
  const refreshTimer = useRef(null);
  const [branchForm, setBranchForm] = useState(null); // MARKER_VATRECONCILE_BRANCHFORM_V1 -- { branch } = เปิดฟอร์มสาขาจากไอคอนในแถว
  const reloadAfterBranchChange = async (branch) => { // ผูกใหม่ทุกจุดที่ Match ด้วยสาขา -> โหลดรายงานใหม่ + ล้าง Cache Detail
    try { await rebindBranches({ bu: state.bu, period: state.period, branch }); } catch (e) { console.error('[rebind-branches]', e); }
    try { setLiveData(await fetchReconcileReport({ bu: state.bu, account: state.account, period: state.period })); } catch (e) { /* ใช้ข้อมูลเดิม */ }
    setTabData({});
  };
  useEffect(() => { // คนอื่นเพิ่ม/แก้สาขา -> Popup ที่เปิดอยู่ผูกใหม่/โหลดใหม่ตามด้วย
    const unsub = subscribeWs(['branch_list_updated'], () => { reloadAfterBranchChange(); });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [state.bu, state.account, state.period]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSourceEdited = (rowId, nextRow) => {
    // MARKER_VATRECONCILE_EDIT_SYNC_CACHE_V1 -- แก้ Cell แล้วต้องอัปเดตแถวเดียวกันในทุก Tab ที่ Cache ไว้ (เดิมสลับสาขา/แท็บแล้วกลับมาเห็นค่าเก่า เหมือนไม่ Update)
    if (rowId != null && nextRow) {
      setTabData((prev) => {
        const out = {};
        for (const [k, t] of Object.entries(prev)) {
          if (t && t.data && Array.isArray(t.data.rows) && t.data.rows.some((r) => r.id === rowId)) {
            out[k] = { ...t, data: { ...t.data, rows: t.data.rows.map((r) => (r.id === rowId ? { ...r, ...nextRow } : r)) } };
          } else out[k] = t;
        }
        return out;
      });
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      fetchReconcileReport({ bu: state.bu, account: state.account, period: state.period }).then(setLiveData).catch(() => {});
    }, 700);
  };
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const [exporting, setExporting] = useState(false);
  const [expiredAck, setExpiredAck] = useState(false); // MARKER_VATRECONCILE_EXPIRED_REVIEW_GATE_V1 -- Expired (ไม่มี F ใน GRT_No) ต้องกด "ตรวจสอบแล้ว" ก่อน Save
  const [branchQ, setBranchQ] = useState(''); // MARKER_VATRECONCILEDASHBOARD_POPUP_MANYBRANCH_V1 -- ค้นหาสาขา / แสดงเฉพาะสาขาที่ไม่ตรง
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false); // MARKER_VATRECONCILE_MISSING_CHIP_FILTER_V1
  const [onlyIssue, setOnlyIssue] = useState(false); // MARKER_VATRECONCILE_NB_ISSUE_CHIPS_V1
  const [expanded, setExpanded] = useState(true); // MARKER_VATRECONCILEDASHBOARD_POPUP_EXPAND_V1 -- ขยาย Popup เต็มจอ
  const [exportMsg, setExportMsg] = useState(null); // { ok, text }
  const [prepVal, setPrepVal] = useState(null); // MARKER_VATRECONCILE_EXCEL_LOOK_FRONT_V20 -- ค่า Prepare by ที่แก้แล้ว (null = ใช้ค่าจาก data.header.preparedBy)
  const [prepEdit, setPrepEdit] = useState(false);
  const [prepDraft, setPrepDraft] = useState('');
  const prepCancel = useRef(false);
  const savePrep = async () => {
    if (prepCancel.current) { prepCancel.current = false; setPrepEdit(false); return; }
    const cur = prepVal != null ? prepVal : (data?.header?.preparedBy || '');
    const next = prepDraft.trim();
    setPrepEdit(false);
    if (next === cur) return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/prepared-by`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ bu: state.bu, value: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      setPrepVal(next);
    } catch (err) {
      window.alert(err?.message || 'บันทึกไม่สำเร็จ');
    }
  };
  // MARKER_VATRECONCILE_TABS_V1 -- กดยอดผลต่าง/สาขาที่มี Notice แล้วสลับเป็น Tab Detail ภายใน Popup เดิม: Reconcile | Input Summary | Simple (เฉพาะเมื่อมี Simple)
  const [view, setView] = useState('reconcile'); // 'reconcile' | 'input' | 'simple'
  useEffect(() => { setSamplingOpen(false); }, [view]); // เปลี่ยนหน้า = ปิด Sampling
  const [selBranch, setSelBranch] = useState('');
  const [simpleSel, setSimpleSel] = useState(''); // MARKER_VATRECONCILE_PCT_SIMPLE_BOTH_TABS_V1 -- Template หัว %: เลือก Simple AVG / Simple 100 ได้ทั้งสองแท็บ
  const [tabData, setTabData] = useState({}); // key -> { loading, error, data }
  // MARKER_VATRECONCILE_PCT_SIMPLE_TAB_V1 -- Template หัว % ใช้ทั้ง Simple AVG และ Simple 100 (เหมือนไฟล์ต้นแบบ): สาขาที่มี Simple AVG ดู AVG ก่อน ไม่มีก็ดู Simple 100
  const simpleTypeOf = (b) => {
    if (data?.template === 'avg') return 'simple_avg';
    if (data?.template === '100_simple') return 'simple_100';
    if (data?.template === 'pct') {
      const rb = (data.rows || []).find((x) => String(x.branch) === String(b));
      if (simpleSel === 'simple_100' || simpleSel === 'simple_avg') return simpleSel;
      return rb && rb.hasSimple100 && !rb.hasSimpleAvg ? 'simple_100' : 'simple_avg';
    }
    return null;
  };
  const simpleType = simpleTypeOf(selBranch);
  // MARKER_VATRECONCILE_DETAIL_ICON_V3
  const tabKey = (v, b, st) => (v === 'simple' ? `simple|${st || ''}|${b}` : v === 'tb' ? 'tb|' : `input|${b || ''}`); // MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13 // MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1
  const goView = (v, branch, force, forceType) => {
    const b = branch === undefined ? selBranch : branch;
    setView(v);
    setSelBranch(b);
    if (v === 'reconcile' || v === 'cover' || v === 'pivot') return; // MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13
    if (v === 'input' && !b && !force) return; // MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1 -- ไม่เลือกสาขา = ไม่โหลดทุกสาขาเอง (ต้องกด "โหลดทุกสาขา")
    const type = v === 'input' ? 'input_summary' : v === 'tb' ? 'tb' : (forceType || simpleTypeOf(b));
    const key = tabKey(v, b, type);
    if (tabData[key]) return;
    if (!type) return;
    setTabData((p) => ({ ...p, [key]: { loading: true, error: '', data: null } }));
    fetchReportPreview({ type, bu: state.bu, account: state.account, period: state.period, view: 'detail', branch: b || undefined })
      .then((d) => setTabData((p) => ({ ...p, [key]: { loading: false, error: '', data: d } })))
      .catch((err) => setTabData((p) => ({ ...p, [key]: { loading: false, error: err?.message || 'โหลด Detail ไม่สำเร็จ', data: null } })));
  };
  const isLocalView = view === 'reconcile' || view === 'cover' || view === 'pivot';
  const curTab = isLocalView ? null : tabData[tabKey(view, selBranch, simpleType)];
  // MARKER_VATRECONCILE_ESC_BACK_TO_RECONCILE_V1 -- อยู่หน้า Detail/Simple/TB แล้วกด Esc = กลับหน้า Reconcile (ไม่ปิด Popup) | ถ้ากำลังพิมพ์/แก้ Cell อยู่ ให้ Esc ทำหน้าที่เดิม (ยกเลิกแก้ไข)
  const goViewRef = useRef(goView);
  goViewRef.current = goView;
  useEffect(() => {
    if (view !== 'input' && view !== 'simple' && view !== 'tb') return undefined;
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      goViewRef.current('reconcile', '');
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [view]);
  const doExport = async (draft) => { // MARKER_VATRECONCILE_FIRST_DRAFT_V1 -- draft=true: เก็บเป็น First Draft (ไม่ต้อง Balance/ตรวจ Expired)
    const isDraft = draft === true;
    if (!isDraft && expiredGate) { setExportMsg({ ok: false, text: 'ต้องกด "ตรวจสอบแล้ว" รายการ Expired ก่อน Save' }); return; }
    if (!isDraft && saveBlocked) { setExportMsg({ ok: false, text: 'Save ไม่ได้: ยังไม่ Balance' }); return; }
    setExporting(true); setExportMsg(null);
    try {
      const f = await onExport({ draft: isDraft });
      setExportMsg({ ok: true, text: `${isDraft ? '[First Draft] ' : ''}เก็บไฟล์ ${f?.file_name || ''} ไว้ที่ "ที่เก็บไฟล์รายงานภาษี" แล้ว` });
      onClose(); // MARKER_VATRECONCILE_CLOSE_AFTER_EXPORT_V11
    } catch (err) {
      setExportMsg({ ok: false, text: err?.message || 'Save ไม่สำเร็จ' });
    } finally { setExporting(false); }
  };
  const tdBase = { padding: '6px 8px', borderBottom: `1px solid ${RP_BORDER}`, borderRight: `1px solid ${RP_BORDER}`, textAlign: 'right' };
  const cell = (v) => (v ? rpFmt(v) : <span style={{ color: '#9aa4b2' }}>-</span>);
  const th = (extra) => ({ // MARKER_VATRECONCILE_REVERT_EXCEL_LOOK_V21 -- หน้า Reconcile กลับเป็นตารางทำงาน (หน้าตาแบบชีต Excel ย้ายไปอยู่ที่ Preview ไฟล์ Export เท่านั้น)
    background: RP_HEAD_GRAD, padding: '6px 8px', borderBottom: `1px solid ${RP_BORDER}`, borderRight: `1px solid ${RP_BORDER}`,
    fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', zIndex: 2, color: '#334155', ...extra,
  });
  const nPairs = data ? data.pairLabels.length : 0;
  const shownRows = data ? data.rows.filter((r) => {
    if (onlyDiff && r.status === 'ตรงกัน') return false;
    if (onlyMissing && !r.branchMissing) return false;
    if (onlyIssue && !((r.overCount || 0) > 0 || ((r.futureCount || 0) > 0 && r.status !== 'ตรงกัน'))) return false; // MARKER_VATRECONCILE_FUTURE_ONLY_IF_DIFF_V1 -- Future Date ที่ไม่มี Diff (บันทึกตรง มียอดใน TB) ยอมรับได้ ไม่นับเป็น Issue
    const q = branchQ.trim().toLowerCase();
    return !q || String(r.branch).toLowerCase().includes(q) || String(r.name || '').toLowerCase().includes(q);
  }) : [];
  const notBalanceCount = data ? data.rows.filter((r) => r.status !== 'ตรงกัน').length : 0;
  const issueCount = data ? data.rows.filter((r) => (r.overCount || 0) > 0 || ((r.futureCount || 0) > 0 && r.status !== 'ตรงกัน')).length : 0;
  const okBranchSet = data ? new Set(data.rows.filter((r) => r.status === 'ตรงกัน').map((r) => String(r.branch))) : new Set();
  const futureBranchSet = data ? new Set(data.rows.flatMap((r) => r.futureCauseIds || [])) : null; // ใช้เป็น Set ของ id แถวที่เป็นสาเหตุ Diff // MARKER_VATRECONCILE_FUTURE_CAUSE_V1 -- สาขาที่ Future Date เป็นสาเหตุของ Diff
  const missingBranches = data ? data.rows.filter((r) => r.branchMissing).map((r) => r.branch) : []; // MARKER_VATRECONCILE_BRANCH_MISSING_FRONT_V10
  const hasDiff = data ? (data.checkDiff.applicable ? data.checkDiff.unbalance > 0 : Math.abs(data.totals.diff) > 1) || data.rows.some((r) => r.status !== 'ตรงกัน') : false;
  const saveBlocked = !!data && hasDiff; // MARKER_VATRECONCILE_SAVE_ONLY_BALANCE_V1 -- Save ได้เมื่อ Balance เท่านั้น (เกณฑ์เดียวกับป้าย Check Diff / Approve Balance)
  const expiredTotal = data ? data.rows.reduce((n, r) => n + (r.expiredCount || 0), 0) : 0;
  const expiredGate = expiredTotal > 0 && !expiredAck; // ยังมี Expired ที่ยังไม่ตรวจสอบ -> Save ไม่ได้เลย
  useEffect(() => { setExpiredAck(false); }, [expiredTotal]); // แก้จนไม่เหลือ / จำนวนเปลี่ยน -> เริ่มใหม่

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: expanded ? 4 : 16 }} onClick={onClose}>
      {branchForm && ( // MARKER_VATRECONCILE_BRANCHFORM_V1 -- ฟอร์มสาขา (New/Edit) เปิดจากไอคอนสาขาในแถว -- Save แล้วผูก + โหลดรายงานใหม่ทันที
        <div onClick={(e) => e.stopPropagation()}>
          <BranchFormModal
            show
            initialForm={{ 'Branch Code': branchForm.branch, bu: state.bu }}
            onClose={() => setBranchForm(null)}
            onSaved={async (saved) => { await reloadAfterBranchChange(saved && saved['Branch Code']); setBranchForm(null); }}
          />
        </div>
      )}
      <div style={{ background: '#fff', borderRadius: 12, width: expanded ? '99vw' : 'min(1500px, 96vw)', height: expanded ? '98vh' : undefined, maxHeight: expanded ? '98vh' : '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${RP_BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>
            {/* MARKER_VATRECONCILE_BACK_IN_TITLE_V1 -- ปุ่ม "‹ กลับ Reconcile" ย้ายมาแทนคำว่า Reconcile ที่หัวหน้าต่าง (เฉพาะตอนอยู่หน้า Detail/Simple) */}
            {!loading && !error && data && (view === 'input' || view === 'simple' || view === 'tb')
              ? <button type="button" onClick={() => goView('reconcile', '')} title="กลับหน้า Reconcile" style={{ padding: '3px 12px', fontSize: 14, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, background: '#fff', color: '#0969da' }}>‹ กลับ Reconcile</button>
              : 'Reconcile'}
            {' · '}{bu} · {account} · {periodLabel}
            {data && <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>({RP_TEMPLATE_LABEL[data.template]})</span>}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* MARKER_VATRECONCILE_HEADER_SOURCE_TABS_V1 -- แท็บ Detail | Simple | TB ที่หัว Popup (เฉพาะตอนเลือกสาขา) -- สาขาไหนไม่มีข้อมูลฝั่งไหน Disable แท็บนั้น */}
            {!loading && !error && data && selBranch && (view === 'input' || view === 'simple' || view === 'tb') && (() => {
              const br = data.rows.find((x) => String(x.branch) === String(selBranch));
              const nz = (p) => !!p && (Math.abs(Number(p[0]) || 0) > 0.004 || Math.abs(Number(p[1]) || 0) > 0.004);
              const hasDetail = !!br && nz(br.pairs && br.pairs[0]);
              const hasSimple = !!simpleType && !!br && (data.template === 'pct' ? !!(br.hasSimpleAvg || br.hasSimple100) : ((br.pairs || []).slice(1, data.template === 'avg' ? 3 : 2).some(nz)));
              const hasTb = !!br && Math.abs(Number(br.tb) || 0) > 0.004;
              const tabs = [
                { v: 'input', label: 'Detail', on: hasDetail, tip: 'ไม่มีข้อมูล Detail (Input Summary) ของสาขานี้' },
                ...(data.template === 'pct'
                  ? [
                      { v: 'simple', st: 'simple_avg', label: 'Simple AVG', on: !!(br && br.hasSimpleAvg), always: true, tip: 'ไม่มีข้อมูล Simple AVG ของสาขานี้' },
                      { v: 'simple', st: 'simple_100', label: 'Simple 100', on: !!(br && br.hasSimple100), always: true, tip: 'ไม่มีข้อมูล Simple 100 ของสาขานี้' },
                    ]
                  : (simpleType ? [{ v: 'simple', label: 'Simple', on: hasSimple, tip: 'ไม่มีข้อมูล Simple Report ของสาขานี้' }] : [])),
                { v: 'tb', label: 'TB', on: hasTb, tip: 'ไม่มียอด TB ของสาขานี้' },
              ];
              return (
                <span style={{ display: 'inline-flex', marginRight: 4, border: `1px solid ${RP_BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {tabs.map((t, ti) => {
                    const active = view === t.v && (!t.st || t.st === simpleType);
                    return (
                      <button key={t.st || t.v} type="button" disabled={!t.on && !active && !t.always} title={t.on || active || t.always ? `ดู ${t.label} ของสาขา ${selBranch}` : t.tip}
                        onClick={() => { if (!active) { if (t.st) setSimpleSel(t.st); goView(t.v, selBranch, false, t.st); } }}
                        style={{ padding: '4px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderLeft: ti ? `1px solid ${RP_BORDER}` : 'none', cursor: active ? 'default' : (t.on || t.always ? 'pointer' : 'not-allowed'), background: active ? '#0969da' : (t.on ? '#fff' : '#f3f4f6'), color: active ? '#fff' : (t.on ? '#0969da' : '#b6bcc4') }}>
                        {t.label}
                      </button>
                    );
                  })}
                </span>
              );
            })()}
            <button type="button" aria-label={expanded ? 'ย่อ' : 'ขยาย'} title={expanded ? 'ย่อ' : 'ขยายเต็มจอ'} onClick={() => setExpanded((v) => !v)} style={{ background: 'none', border: `1px solid ${RP_BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, padding: '3px 10px', color: '#334155' }}>{expanded ? '⤡ ย่อ' : '⤢ ขยาย'}</button>
            <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
          </div>
        </div>

        {/* MARKER_VATRECONCILE_NO_TABBAR_BACK_BTN_V4 -- ปุ่มกลับย้ายไปหัวหน้าต่างแล้ว (MARKER_VATRECONCILE_BACK_IN_TITLE_V1) เหลือแถบบอกสาขาที่เลือก */}
        {!loading && !error && data && (view === 'input' || view === 'simple' || view === 'tb') && selBranch && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px 0', flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: '#334155' }}>
              สาขา <b>{selBranch}</b>
              <button type="button" onClick={() => goView(view, '', true)} style={{ marginLeft: 8, fontSize: 12, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, borderRadius: 6, background: '#fff', padding: '2px 8px' }}>ดูทุกสาขา</button>
            </span>
          </div>
        )}

        <div style={{ padding: '16px 18px', overflowY: isLocalView ? 'auto' : 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loading && <p style={{ fontSize: 13, color: '#666' }}>กำลังสร้างรายงาน...</p>}
          {error && <p style={{ fontSize: 13, color: '#a30d16' }}>{error}</p>}
          {!loading && !error && data && (view === 'input' || view === 'simple' || view === 'tb') && (
            <>
              {view === 'input' && !selBranch && !curTab && (
                <div style={{ padding: '24px 4px', fontSize: 13, color: '#57606a' }}>
                  <p style={{ margin: '0 0 10px' }}>เลือกสาขาจากหน้า Reconcile แล้วกดไอคอน <b>Detail</b> ในช่อง NOTE/STATUS เพื่อดูรายการของสาขานั้น</p>
                  <button type="button" onClick={() => goView('input', '', true)} style={{ fontSize: 12.5, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, borderRadius: 6, background: '#fff', padding: '5px 14px' }}>โหลดทุกสาขา (ข้อมูลอาจมาก)</button>
                </div>
              )}
              {((!curTab && !(view === 'input' && !selBranch)) || curTab?.loading) && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}
              {curTab?.error && <p style={{ fontSize: 13, color: '#a30d16' }}>{curTab.error}</p>}
              {curTab?.data && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {view === 'simple' && curTab.data.groups && curTab.data.groups.length > 0 ? (
                    <SimpleOriginalView data={curTab.data} bu={bu} onEdited={onSourceEdited} flat simpleType={simpleType} />
                  ) : (
                    <ReportPreviewTable key={`${view}|${selBranch}`} okBranches={okBranchSet} futureBranches={futureBranchSet} data={curTab.data} initialBranch={view === 'input' ? selBranch : ''} onEdited={onSourceEdited} samplingOpen={samplingOpen} sampleHost={sampleHost} onSamplingClose={() => setSamplingOpen(false)} />
                  )}
                </div>
              )}
            </>
          )}
          {/* MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13 -- ชีต Cover */}
          {!loading && !error && data && view === 'cover' && (() => {
            const cv = data.cover;
            const rowsC = [[`Detail ${data.account}`, cv.perTb, cv.perDetail, cv.diff]];
            if (cv.finCredit != null) rowsC.push(['Detail of FinCredit 46250', null, null, cv.finCredit]);
            const cb = '1px solid #d9d9d9';
            const hc = { background: '#002060', color: '#fff', fontWeight: 700, padding: '5px 10px', borderTop: cb, borderLeft: cb, borderRight: cb };
            const nc = (v) => <span style={{ color: Number(v) < 0 ? '#ff0000' : 'inherit' }}>{v == null ? '' : rpFmt(v)}</span>;
            return (
              <div style={{ border: '2px solid #bfbfbf', maxWidth: 900, background: '#fff', fontSize: 13 }}>
                <div style={{ background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center', padding: '4px 0' }}>DETAIL OF ACCOUNT</div>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 2, padding: '14px 12px', borderBottom: '2px solid #bfbfbf' }}>
                  <b>Company</b><span>{data.buCode?.numeric ? `${data.buCode.numeric} ` : ''}{data.header.companyEn || data.header.company}</span>
                  <b>Branch</b><span>{data.rows.length ? `${data.rows[0].branch}-${data.rows[data.rows.length - 1].branch}` : ''} {data.header.companyEn || data.header.company}</span>
                  <b>Account code</b><span>{data.account}</span>
                  <b>Account name</b><span>{data.accountName}</span>
                  <b>Period</b><span>{periodLabel}</span>
                </div>
                <div style={{ padding: '12px 12px 16px' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
                    <thead><tr>
                      <th style={{ ...hc, textAlign: 'left' }}>By CPC</th>
                      <th style={{ ...hc, textAlign: 'center' }}>Per TB</th><th style={{ ...hc, textAlign: 'center' }}>Per Detail</th>
                      <th style={{ ...hc, textAlign: 'center' }}>Diff</th><th style={{ ...hc, textAlign: 'left' }}>Remark</th>
                    </tr></thead>
                    <tbody>
                      {rowsC.map((r) => (
                        <tr key={r[0]}>
                          <td style={{ padding: '14px 10px', borderLeft: cb }}>{r[0]}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderLeft: cb, borderRight: cb }}>{nc(r[1])}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderRight: cb }}>{nc(r[2])}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderRight: cb }}>{nc(r[3])}</td>
                          <td style={{ borderRight: cb }} />
                        </tr>
                      ))}
                      <tr style={{ background: '#9dc3e6', fontWeight: 700, borderTop: '1px solid #000', borderBottom: '2px solid #000' }}>
                        <td style={{ padding: '5px 10px' }}>Diff</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.perTb)}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.perDetail)}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.coverDiff)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          {/* ชีต Pivot (สรุปตามสาขา จาก Input-N 100%) */}
          {!loading && !error && data && view === 'pivot' && (
            <div style={{ border: `1px solid ${RP_BORDER}`, borderRadius: 8, overflow: 'auto', flex: '1 1 0', minHeight: 200 }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                <thead><tr>
                  {['สาขา', 'ชื่อผู้ประกอบการ', 'Sum of ภาษีซื้อที่ชำระ(มูลค่าสินค้า)', 'Sum of ภาษีซื้อที่ชำระ(เงินภาษี)'].map((h) => (
                    <th key={h} style={{ background: '#f2f2f2', color: '#002060', padding: '6px 8px', border: `1px solid ${RP_BORDER}`, position: 'sticky', top: 0 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.rows.filter((r) => r.pairs[0][0] || r.pairs[0][1]).map((r) => (
                    <tr key={r.branch}>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>{r.branch}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>{r.name}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(r.pairs[0][0])}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(r.pairs[0][1])}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#ffccff', fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>Grand Total</td>
                    <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(data.totals.pairs[0][0])}</td>
                    <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(data.totals.pairs[0][1])}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && data && view === 'reconcile' && (
            <>
              <div style={{ textAlign: 'center', lineHeight: 1.6 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#24292f' }}>{data.header.title}</div>
                <div style={{ fontSize: 13, color: '#57606a' }}>{data.header.company}</div>
                {data.header.taxId && <div style={{ fontSize: 13, color: '#57606a' }}>เลขประจำตัวผู้เสียภาษี {data.header.taxId}</div>}
                <div style={{ fontSize: 13, color: '#57606a' }}>ประจำเดือน {data.header.periodLabel}</div>
              </div>

              {/* MARKER_VATRECONCILE_NO_ACCOUNT_LINE_V1 -- เอาบรรทัด Account + ป้าย Check Diff ออกตามที่แจ้ง (เลข Account อยู่ที่หัวหน้าต่างแล้ว / ถ้าไม่ Balance ปุ่ม Save ล็อกและมีข้อความแดงบอก) */}

              {/* MARKER_VATRECONCILE_NO_SUMMARY_CARDS_V1 -- เอาการ์ดสรุป (Per TB / Per Detail / Diff / FinCredit / สาขาที่มียอด) ออกตามที่แจ้ง -- ตัวเลขเหล่านี้ยังมีใน Total ของตาราง และหน้า Preview */}
              {data.overCount > 0 && (
                <div style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 8, background: '#ffe5e5', color: '#cf222e', fontSize: 12.5, fontWeight: 600 }}>
                  ⚠ Over Period {data.overCount} รายการ ใน {data.rows.filter((r) => r.overCount > 0).length} สาขา (Tax Invoice Date เป็นเดือนหลังเดือน {data.header.periodLabel}) — กดแถวสาขาเพื่อดู Detail
                </div>
              )}
              {/* MARKER_VATRECONCILE_NO_FUTURE_BANNER_V1 -- เอาแถบเตือน Future Date ออก (ยังมีไอคอน/Tooltip รายสาขาใน Note/Status) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <input
                  type="text" value={branchQ} onChange={(e) => setBranchQ(e.target.value)} placeholder="ค้นหารหัส/ชื่อสาขา"
                  style={{ padding: '5px 10px', border: `1px solid ${RP_BORDER}`, borderRadius: 6, fontSize: 12.5, width: 220 }}
                />
                {(() => {
                  const chip = (color, bg, bd, on) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, border: `1px solid ${bd}`, background: bg, color, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', boxShadow: on ? '0 0 0 2px #0969da inset' : 'none' });
                  const badge = (bg) => ({ minWidth: 20, textAlign: 'center', padding: '1px 6px', borderRadius: 999, background: bg, color: '#fff', fontSize: 11.5 });
                  return (
                    <>
                      {missingBranches.length > 0 && ( // MARKER_VATRECONCILE_MISSING_BRANCH_CHIP_V1 -- มีสาขาที่ยังไม่ผูก Branch -> ห้ามขึ้น Balance ทุกสาขา (ขึ้น Error แทนจนกว่าจะผูก)
                        <span role="button" tabIndex={0} title={`ยังไม่ผูกสาขาใน Branch List: ${missingBranches.join(', ')} — กดเพื่อกรองเฉพาะสาขาที่ไม่พบ (กดซ้ำเพื่อยกเลิก)`} onClick={() => setOnlyMissing((v) => !v)} style={chip('#cf222e', '#fff5f5', '#f5b5ae', onlyMissing)}>
                          ❗ ไม่พบสาขา <span style={badge('#cf222e')}>{missingBranches.length}</span> สาขา — ยังไม่ผูก Branch
                        </span>
                      )}
                      {notBalanceCount > 0 ? (
                        <span role="button" tabIndex={0} title="กดเพื่อกรองเฉพาะสาขา Not Balance (กดซ้ำเพื่อยกเลิก)" onClick={() => setOnlyDiff((v) => !v)} style={chip('#cf222e', '#fff5f5', '#ffb8bc', onlyDiff)}>
                          ⚠ Not Balance <span style={badge('#cf222e')}>{notBalanceCount}</span> สาขา
                        </span>
                      ) : (
                        missingBranches.length > 0 ? null : <span style={{ ...chip('#1a7f37', '#f0fbf3', '#a7dfb8', false), cursor: 'default' }}>✔ Balance ทุกสาขา</span>
                      )}
                      {issueCount > 0 ? (
                        <span role="button" tabIndex={0} title="Over Period / Future Date — กดเพื่อกรองเฉพาะสาขาที่มี Issue (กดซ้ำเพื่อยกเลิก)" onClick={() => setOnlyIssue((v) => !v)} style={chip('#9a6700', '#fffbea', '#f0d58a', onlyIssue)}>
                          🚩 Issue <span style={badge('#bf8700')}>{issueCount}</span> สาขา
                        </span>
                      ) : (
                        <span style={{ ...chip('#1a7f37', '#f0fbf3', '#a7dfb8', false), cursor: 'default' }}>✔ ไม่มี Issue</span>
                      )}
                    </>
                  );
                })()}
                <span style={{ color: '#57606a' }}>แสดง {shownRows.length} / {data.rows.length} สาขา (Total คิดจากทุกสาขา)</span>
              </div>
              <div style={{ border: `1px solid ${RP_BORDER}`, borderRadius: 8, overflow: 'auto', maxHeight: expanded ? 'none' : '46vh', flex: expanded ? '1 1 0' : '0 0 auto', minHeight: expanded ? 200 : 0 }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', minWidth: 1250 }}>
                  <thead>
                    <tr>
                      <th rowSpan={2} style={th({ top: 0 })}>รหัสสาขา</th>
                      <th rowSpan={2} style={th({ top: 0 })}>สาขา</th>
                      {data.pairLabels.map((p) => <th key={p} colSpan={2} style={th({ top: 0 })}>{p}</th>)}
                      <th style={th({ top: 0 })}>ภาษีตาม T/B</th>
                      <th rowSpan={2} style={th({ top: 0 })}>ผลต่าง</th>
                      <th rowSpan={2} style={th({ top: 0 })}>Tools</th>
                    </tr>
                    <tr>
                      {data.pairLabels.map((p) => (
                        <React.Fragment key={p}>
                          <th style={th({ top: 31, fontSize: 11.5 })}>มูลค่า</th>
                          <th style={th({ top: 31, fontSize: 11.5 })}>ภาษี</th>
                        </React.Fragment>
                      ))}
                      <th style={th({ top: 31, fontSize: 11.5 })}>{data.tbLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.length === 0 && (
                      <tr><td colSpan={2 + nPairs * 2 + 3} style={{ ...tdBase, textAlign: 'center', color: '#999', padding: '24px 4px' }}>ไม่พบข้อมูลของ BU / Account / Period นี้</td></tr>
                    )}
                    {shownRows.map((r) => {
                      const ok = r.status === 'ตรงกัน';
                      const hasFuture = (r.futureCount || 0) > 0 && !ok; // MARKER_VATRECONCILE_DRILLDOWN_V1 | MARKER_VATRECONCILE_FUTURE_ONLY_IF_DIFF_V1 -- Future Date + ไม่มี Diff = ยอมรับได้ ไม่แจ้งเตือน
                      const hasOver = (r.overCount || 0) > 0;
                      const attn = !ok || hasFuture || hasOver || (r.expiredCount || 0) > 0; // สาขาที่ตรงและไม่มี Future Date / Over Period ไม่ต้องกดดู Detail
                      return (
                        <tr key={r.branch} style={r.branchMissing ? { background: '#ffd6d6' } : undefined} title={r.branchMissing ? 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export' : undefined}>
                          <td style={{ ...tdBase, textAlign: 'left', whiteSpace: 'nowrap' }} title={r.branchStatus ? `${r.branchStatus}${r.inactiveDate ? ` · Inactive Date: ${r.inactiveDate}` : ''}` : 'ไม่ทราบสถานะสาขา'}>
                            <span aria-label={r.branchStatus || 'ไม่ทราบสถานะ'} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', marginRight: 7, background: RP_BRANCH_DOT[r.branchStatus] || '#b6bcc4', verticalAlign: 'middle' }} />
                            {r.branch}
                          </td>
                          <td style={{ ...tdBase, textAlign: 'left', minWidth: 220 }}>{r.name}</td>
                          {r.pairs.map((p, i) => (
                            <React.Fragment key={i}>
                              <td style={tdBase}>{cell(p[0])}</td>
                              <td style={tdBase}>{cell(p[1])}</td>
                            </React.Fragment>
                          ))}
                          <td style={tdBase}>{cell(r.tb)}</td>
                          <td style={{ ...tdBase, color: ok ? 'inherit' : '#cf222e', fontWeight: ok ? 400 : 700 }}>{rpFmt(r.diff)}</td>
                          <td style={{ ...tdBase, textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {/* MARKER_VATRECONCILE_TOOLS_COLUMN_FRONT_V22 -- Tools 1 แถว (Branch ใช้งานเฉพาะสาขาที่ไม่พบในรายการสาขา): Detail | Branch | Cross check | Notice */}
                            {(() => {
                              const issues = [
                                r.branchMissing && 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export',
                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,
                                hasOver && `Over Period ${r.overCount} รายการ (เดือนของ Tax Invoice Date เกินเดือน Period)`,
                                (r.expiredCount || 0) > 0 && `Expired ${r.expiredCount} รายการ (Tax Invoice Date เกิน Aging 6 เดือนจาก Period)`, // MARKER_VATRECONCILE_EXPIRED_V1
                                hasFuture && `Future Date ${r.futureCount} รายการ (Receive Date น้อยกว่า Tax Invoice Date)`,
                              ].filter(Boolean);
                              const has = issues.length > 0;
                              const severe = !ok || hasOver || r.branchMissing;
                              const svgP = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
                              const tool = (key, enabled, title, onClick, color, bg, bd, icon, badge) => (
                                <button key={key} type="button" aria-label={title} title={title} disabled={!enabled}
                                  onClick={enabled && onClick ? onClick : undefined}
                                  style={{ position: 'relative', width: 26, height: 26, padding: 0, borderRadius: 6, cursor: enabled ? 'pointer' : 'not-allowed', border: `1px solid ${enabled ? bd : '#d0d7de'}`, background: enabled ? bg : '#f3f4f6', color: enabled ? color : '#b6bcc4', opacity: enabled ? 1 : 0.6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {icon}
                                  {enabled && badge > 1 && (
                                    <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: '#cf222e', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>{badge}</span>
                                  )}
                                </button>
                              );
                              return (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 26px)', gap: 4, justifyContent: 'center', padding: '2px 0' }} /* MARKER_VATRECONCILE_TOOLS_ONE_LINE_V1 */>
                                  {tool('detail', true, 'Detail (Input Summary) ของสาขานี้', () => goView('input', r.branch), '#0969da', '#fff', '#0969da',
                                    <svg {...svgP}><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" /></svg>)}
                                  {tool('branch', true, r.branchMissing ? 'ไม่พบสาขานี้ในรายการสาขา (Branch) — กดเพื่อเพิ่มสาขา' : 'สาขานี้ผูก Branch แล้ว — กดเพื่อแก้ไขสาขา', () => setBranchForm({ branch: r.branch }), r.branchMissing ? '#cf222e' : '#1a7f37', r.branchMissing ? '#ffe5e5' : '#f0fbf3', r.branchMissing ? '#cf222e' : '#1a7f37', // MARKER_VATRECONCILE_BRANCH_ICON_RED_V1 -- ไม่มีสาขา = แดง / ผูกแล้ว = เขียว (เปิดใช้ได้เพื่อแก้ไข)
                                    <svg {...svgP}><path d="M2.5 14.5h11M4 14.5V3h5.5v11.5M9.5 7H12v7.5" /><path d="M6 5.5h1.5M6 8h1.5M6 10.5h1.5" /></svg>)}
                                  {tool('cross', !ok, !ok ? `Cross check (ผลต่าง ${rpFmt(r.diff)}) — ยังไม่เปิดใช้งาน` : 'Cross check: ไม่มีผลต่าง', null, '#0969da', '#fff', '#0969da',
                                    <svg {...svgP}><path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5" /></svg>)}
                                  {tool('notice', has, has ? issues.join('\n') + '\n(กดเพื่อดู Detail)' : 'Notice: ไม่มีรายการที่ต้องแจ้ง', () => goView('input', r.branch), severe ? '#cf222e' : '#856404', severe ? '#ffe5e5' : '#fff3cd', severe ? '#f1a9a9' : '#e8d48a',
                                    <svg {...svgP}><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>, issues.length)}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={2} style={{ ...tdBase, textAlign: 'left', fontWeight: 800, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }}>Total</td>
                      {data.totals.pairs.map((p, i) => (
                        <React.Fragment key={i}>
                          <td style={{ ...tdBase, fontWeight: 800, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }}>{rpFmt(p[0])}</td>
                          <td style={{ ...tdBase, fontWeight: 800, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }}>{rpFmt(p[1])}</td>
                        </React.Fragment>
                      ))}
                      <td style={{ ...tdBase, fontWeight: 800, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }}>{rpFmt(data.totals.tb)}</td>
                      <td
                        onClick={Math.abs(data.totals.diff) > 0.005 ? () => goView('input', '', true) : undefined}
                        title={Math.abs(data.totals.diff) > 0.005 ? 'กดเพื่อดู Detail ทุกสาขา' : undefined}
                        style={{ ...tdBase, fontWeight: 800, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}`, color: Math.abs(data.totals.diff) > 0.005 ? '#cf222e' : 'inherit', cursor: Math.abs(data.totals.diff) > 0.005 ? 'pointer' : 'default', textDecoration: Math.abs(data.totals.diff) > 0.005 ? 'underline' : 'none' }}
                      >{rpFmt(data.totals.diff)}</td>
                      <td style={{ ...tdBase, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                    </tr>
                  </tbody>
                </table>
              </div>

            </>
          )}
        </div>

        {/* MARKER_VATRECONCILE_SHEET_TABS_REMOVED_V1 -- เอาปุ่มชีต (ReportVat / Detail / Simple) ออกจาก Reconcile Panel แต่คงแถบล่างไว้เป็นที่ว่างสำหรับใช้งานอื่น -- เข้า Detail/Simple ผ่านไอคอน Tools และมีปุ่ม "กลับ Reconcile" ด้านบน */}
        {!loading && !error && data && (
          <div style={{ minHeight: 34, padding: '4px 14px', background: '#f3f3f3', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {view === 'input' && (
              <button type="button" onClick={() => setSamplingOpen((v) => !v)} title="หาชุดรายการที่รวมกันได้ยอดที่ต้องการ" style={{ padding: '4px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: `1px solid ${samplingOpen ? '#1a7f37' : RP_BORDER}`, background: samplingOpen ? '#1a7f37' : '#fff', color: samplingOpen ? '#fff' : '#24292f' }}>Sampling</button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0 }}>
          {missingBranches.length > 0 && !exportMsg && <span style={{ fontSize: 12.5, marginRight: 'auto', color: '#cf222e', fontWeight: 600 }}>ไม่อนุญาตให้ Save: ไม่พบสาขา {missingBranches.slice(0, 5).join(', ')}{missingBranches.length > 5 ? ` และอีก ${missingBranches.length - 5} สาขา` : ''} ในรายการสาขา (Branch) — แถวไฮไลต์แดง</span>}
          {/* MARKER_VATRECONCILE_NO_SAVE_BLOCK_MSG_V1 -- ไม่แสดงข้อความเหตุผลที่ Save ไม่ได้ (ปุ่ม Save ยัง Disable ตาม Balance) */}
          {exportMsg && <span style={{ fontSize: 12.5, marginRight: 'auto', color: exportMsg.ok ? '#1a7f37' : '#cf222e' }}>{exportMsg.text}</span>}
          {expiredGate && <span style={{ fontSize: 12.5, marginRight: 'auto', color: '#9a6700', fontWeight: 600 }}>มี Expired {expiredTotal} รายการ (ไม่มี F ใน GRT_No) — ต้องตรวจสอบก่อน Save</span>}
          {expiredGate && <button type="button" onClick={() => { setExpiredAck(true); logActivityTs('EXPIRED_REVIEWED', { bu: state.bu, account: state.account, period: state.period }); }} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid #bf8700', background: '#fff8c5', color: '#7d4e00', cursor: 'pointer' }}>ตรวจสอบแล้ว</button>}
          <button type="button" title="เก็บไฟล์เป็น Draft ใน Backend (ไม่ต้อง Balance) — ไม่ส่ง SharePoint / Confirm / Download ไม่ได้" onClick={() => doExport(true)} disabled={exporting || loading || !!error || !data || data.rows.length === 0 || missingBranches.length > 0} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid #bf8700', background: '#fff8c5', color: '#7d4e00', cursor: 'pointer', opacity: exporting || loading || !!error || !data || data.rows.length === 0 || missingBranches.length > 0 ? 0.5 : 1 }}>First Draft</button>
          <button type="button" onClick={() => doExport()} disabled={exporting || loading || !!error || !data || data.rows.length === 0 || missingBranches.length > 0 || saveBlocked || expiredGate} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#1a7f37', color: '#fff', cursor: 'pointer', opacity: exporting || loading || !!error || !data || data.rows.length === 0 || missingBranches.length > 0 || saveBlocked || expiredGate ? 0.5 : 1 }}>{exporting ? 'กำลัง Save...' : 'Save'}</button>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: `1px solid ${RP_BORDER}`, background: '#fff', color: '#24292f', cursor: 'pointer' }}>ปิด</button>
        </div>
        {/* ที่วาง Popup Sampling (ซ้อนใน Popup Reconcile) */}
        <div ref={setSampleHost} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }} />
      </div>
    </div>
  );
}


// MARKER_VATRECONCILE_FILE_PREVIEW_FRONT_V18 -- Preview ไฟล์ที่ Export จริง (อ่านจาก .xlsx บน Server) ทุกชีตแบบ Excel อ่านอย่างเดียว
const pvColLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const pvParseCss = (css) => {
  const o = {};
  String(css || '').split(';').forEach((kv) => {
    const i = kv.indexOf(':'); if (i < 0) return;
    const k = kv.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = kv.slice(i + 1).trim();
  });
  return o;
};
function FileSheetPreview({ file, onClose }) {
  const [st, setSt] = useState({ loading: true, error: '', data: null });
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/preview`, { headers: rfAuth() });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
        if (!dead) setSt({ loading: false, error: '', data: j });
      } catch (err) { if (!dead) setSt({ loading: false, error: err?.message || 'เปิด Preview ไม่สำเร็จ', data: null }); }
    })();
    return () => { dead = true; };
  }, [file.id]);
  const d = st.data;
  const sh = d && d.sheets[Math.min(tab, d.sheets.length - 1)];
  const styleObjs = React.useMemo(() => (d ? d.styles.map(pvParseCss) : []), [d]);
  const grid = React.useMemo(() => {
    if (!sh) return null;
    const cellMap = new Map();
    sh.rows.forEach((r) => r.cells.forEach((c) => cellMap.set(`${r.r}:${c[0]}`, c)));
    const span = new Map(); const covered = new Set();
    sh.merges.forEach(([r1, c1, r2, c2]) => {
      span.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    });
    // MARKER_VATRECONCILE_PREVIEW_TEXT_OVERFLOW_V1 -- ข้อความยาวที่จัดชิดซ้ายและช่องขวาว่าง ให้ล้นไปช่องข้างเคียงเหมือน Excel (เช่น ผู้จัดทำ / ผู้อนุมัติ ท้ายรายงาน)
    const vis = sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]);
    sh.rows.forEach((r) => {
      vis.forEach((x, vi) => {
        const key = `${r.r}:${x.c}`;
        const c = cellMap.get(key);
        if (!c || !c[1] || c[3] || span.has(key) || covered.has(key)) return;
        const ta = ((d && d.styles[c[2]]) || '').match(/text-align:\s*(\w+)/);
        if (ta && ta[1] !== 'left') return;
        const need = String(c[1]).length * 7 + 10;
        let acc = x.w; let n = 1;
        for (let j = vi + 1; j < vis.length && acc < need; j++) {
          const k2 = `${r.r}:${vis[j].c}`;
          const c2 = cellMap.get(k2);
          if ((c2 && c2[1]) || span.has(k2) || covered.has(k2)) break;
          acc += vis[j].w; n++;
        }
        if (n > 1) {
          span.set(key, [1, n]);
          for (let j = vi + 1; j < vi + n; j++) covered.add(`${r.r}:${vis[j].c}`);
        }
      });
    });
    return { cellMap, span, covered };
  }, [sh, d]);
  const visCols = sh ? sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]) : [];
  const gl = sh && sh.grid ? '1px solid #e1e1e1' : 'none';
  const hdrCell = { background: '#f3f3f3', border: '1px solid #d4d4d4', color: '#555', fontSize: 11, textAlign: 'center', padding: '1px 4px', position: 'sticky', zIndex: 2 };
  const download = async () => { try { await downloadReportFile(file); } catch (err) { window.alert(err?.message || 'ดาวน์โหลดไม่สำเร็จ'); } };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '99vw', height: '98vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${RP_BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>
            Preview ไฟล์ · {file.file_name}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(ไฟล์ที่ Export จริง · อ่านอย่างเดียว)</span>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={download} disabled={!file.confirmed_at} title={file.confirmed_at ? '' : 'ยังไม่ Confirm — Download ไม่ได้'} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: file.confirmed_at ? 'pointer' : 'not-allowed', opacity: file.confirmed_at ? 1 : 0.35 }}>Download</button>
            <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
          {st.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังเปิดไฟล์...</p>}
          {st.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{st.error}</p>}
          {sh && grid && (
            <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 38 + visCols.reduce((t, x) => t + x.w, 0), fontFamily: 'Calibri, Tahoma, sans-serif', fontSize: 13, color: '#000' }}>{/* MARKER_VATRECONCILE_PREVIEW_FIXED_WIDTH_V1 -- ต้องกำหนด width ของตาราง ไม่งั้น tableLayout:fixed ถูก Browser ตีเป็น Auto แล้วความกว้างคอลัมน์ตามความยาวข้อความ (เช่น A/K กว้างเพราะข้อความหัวกระดาษ/ลายเซ็น) */}
              <colgroup><col style={{ width: 38 }} />{visCols.map((x) => <col key={x.c} style={{ width: x.w }} />)}</colgroup>
              <thead>
                <tr>
                  <th style={{ ...hdrCell, top: 0, left: 0, zIndex: 3 }} />
                  {visCols.map((x) => <th key={x.c} style={{ ...hdrCell, top: 0, fontWeight: 500 }}>{pvColLetter(x.c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {sh.rows.map((r) => (
                  <tr key={r.r} style={r.h ? { height: r.h } : { height: 20 }}>
                    <td style={{ ...hdrCell, left: 0, position: 'sticky' }}>{r.r}</td>
                    {visCols.map((x) => {
                      const key = `${r.r}:${x.c}`;
                      if (grid.covered.has(key)) return null;
                      const c = grid.cellMap.get(key);
                      const sp = grid.span.get(key);
                      const base = { border: gl, padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip', verticalAlign: 'bottom' };
                      const sty = c ? { ...base, ...(styleObjs[c[2]] || {}), ...(c[3] && !(styleObjs[c[2]] || {}).textAlign ? { textAlign: 'right' } : {}) } : base;
                      return <td key={x.c} rowSpan={sp ? sp[0] : undefined} colSpan={sp ? sp[1] : undefined} style={sty}>{c ? c[1] : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sh && sh.truncated && <p style={{ fontSize: 12, color: '#856404', padding: '8px 18px' }}>แสดง {sh.rows.length.toLocaleString()} จาก {sh.totalRows.toLocaleString()} แถว — ดูทั้งหมดได้จากไฟล์ที่ Download</p>}
        </div>
        {d && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 14px', background: '#f3f3f3', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
            {d.sheets.map((x, i) => {
              const on = i === tab;
              return (
                <button key={x.name} type="button" onClick={() => setTab(i)}
                  style={{ padding: '6px 16px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', borderTop: on ? '2px solid #1a7f37' : '2px solid transparent', background: on ? '#fff' : 'transparent', color: on ? '#1a7f37' : '#475569' }}>
                  {x.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
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
// MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_FRONT_V12 -- แสดง Simple Report ตาม Layout ไฟล์ต้นฉบับ (หัวรายงาน + ตารางหัวคอลัมน์ 2 ชั้น + รวมสาขา + รวมสุทธิ)
const SO_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const soDate = (v) => {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return `${m[3]}-${SO_MON[Number(m[2]) - 1] || m[2]}-${m[1].slice(2)}`;
};
const soNum = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const soZero = (v) => {
  if (v == null || v === '') return '';
  return /^0+$/.test(String(v).trim()) ? '0' : String(v);
};

function SimpleOriginalView({ data, bu, onEdited, flat, simpleType }) {
  const [gs, setGs] = useState((data && data.groups) || []);
  const [edit, setEdit] = useState(null); // { gi, ri, col }
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(false);
  const groups = gs;
  const NUM_COLS = ['paid_amount', 'paid_vat', 'claimed_amount', 'claimed_vat', 'claim_percent'];
  const commitEdit = async () => {
    if (!edit || busy) return;
    if (cancelRef.current) { cancelRef.current = false; return; }
    const r = gs[edit.gi].rows[edit.ri];
    const next = val.trim();
    if (next === String(r[edit.col] ?? '').trim()) { setEdit(null); return; }
    setBusy(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/cell`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ table: 'simple_detail', id: r.id, field: edit.col, value: next === '' ? null : next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      const nv = next === '' ? null : NUM_COLS.includes(edit.col) ? Number(next.replace(/,/g, '').replace(/%$/, '')) : next;
      setGs((prev) => prev.map((g, gi) => (gi !== edit.gi ? g : { ...g, rows: g.rows.map((x, ri) => (ri === edit.ri ? { ...x, [edit.col]: nv } : x)) })));
      setEdit(null);
      if (typeof onEdited === 'function') onEdited();
    } catch (err) {
      window.alert(err?.message || 'บันทึกไม่สำเร็จ');
    }
    setBusy(false);
  };
  const cellEd = (gi, ri, r, col, shown, style, colSpan) => {
    const on = edit && edit.gi === gi && edit.ri === ri && edit.col === col;
    return (
      <td colSpan={colSpan} style={on ? { ...style, padding: 0 } : style} title={r.id ? 'ดับเบิลคลิกเพื่อแก้ไข' : undefined}
        onDoubleClick={() => { if (!r.id) return; cancelRef.current = false; setEdit({ gi, ri, col }); setVal(r[col] == null ? '' : String(r[col])); }}>
        {on ? (
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { cancelRef.current = true; setEdit(null); } }}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '2px 4px', border: '2px solid #1a7f37', outline: 'none' }} />
        ) : shown}
      </td>
    );
  };
  const h0 = (groups[0] && groups[0].header) || {};
  const BD = '1px solid #000';
  const th = { border: BD, background: '#e5f1fb', fontWeight: 700, textAlign: 'center', padding: '3px 6px', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' };
  const td = { border: BD, padding: '2px 6px', fontSize: 12, verticalAlign: 'top' };
  const tdR = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
  const tdC = { ...td, textAlign: 'center', whiteSpace: 'nowrap' };
  const sum0 = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  // MARKER_VATRECONCILE_SIMPLE_PRINTED_SUBTOTAL_FRONT_V1 -- รวมสาขา ใช้ยอดที่พิมพ์มากับไฟล์ Simple (ไม่คำนวณใหม่); รวมสุทธิ = ผลรวมแถว
  const subHdr = new Map(groups.map((g) => [g.rows, g.header || {}]));
  const sum = (rows, k) => { const h = subHdr.get(rows); const v = h ? h['sub_' + k] : null; return v != null && v !== '' ? Number(v) : sum0(rows, k); };
  const allRows = groups.reduce((a, g) => a.concat(g.rows), []);
  const lbl = { fontWeight: 700, paddingRight: 8, whiteSpace: 'nowrap' };
  const Total = ({ label, rows }) => (
    <tr style={{ fontWeight: 700 }}>
      <td style={td} colSpan={8}></td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={tdR}>{soNum(sum(rows, 'paid_amount'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'paid_vat'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'claimed_amount'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'claimed_vat'))}</td>
      <td style={td}></td>
    </tr>
  );
  if (flat) { // MARKER_VATRECONCILE_SIMPLE_REPORT_FORMAT_FRONT_V21 -- Layout ตามไฟล์ Simple_Report_Vat ต้นฉบับ (รายงาน Oracle: หัวรายงาน + Block ต่อสาขา + รวมสาขา/รวมสุทธิ)
    const FB = '1px solid #000';
    const FONT = 'Tahoma, "Segoe UI", sans-serif';
    const PX = [11.5, 7.164, 7.164, 7.164, 7.5, 7.164, 7.164, 7.164, 8.664, 7.164, 7.164, 7.164, 14.664, 7.164, 10.5, 8.332, 7.164, 7.5, 18, 12.832, 16.164, 17.5, 7.164, 7.164, 7.164, 13].map((w) => Math.round(w * 7 + 5));
    const T9 = { fontFamily: FONT, fontSize: 12, color: '#000', background: '#fff', padding: '0 4px', verticalAlign: 'top', overflow: 'hidden' };
    const lab = { ...T9, fontWeight: 700 };
    const hidden = { ...T9, color: '#fff' }; // ต้นฉบับตั้งสีตัวอักษรขาว (ซ่อนค่า)
    const hd = { ...T9, background: '#e7f3fd', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', border: FB, padding: '0 2px' };
    const bx = { ...T9, border: FB, verticalAlign: 'bottom', whiteSpace: 'nowrap' };
    const bxR = { ...bx, textAlign: 'right' };
    const nf = (v) => {
      if (v == null || v === '') return '';
      const n = Number(v); if (!Number.isFinite(n)) return String(v);
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const pc = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : `${Number(v).toFixed(2)}%`);
    const NC = 26;
    const Sp = ({ h }) => <tr style={{ height: h }}><td colSpan={NC} style={{ background: '#fff', padding: 0 }} /></tr>;
    const BuCode = h0.bu_code || bu || '';
    const SubRow = ({ label, rows, top }) => {
      const base = { ...bx, fontWeight: 700 };
      const num = (k) => <td style={{ ...base, textAlign: 'right' }}>{nf(sum(rows, k))}</td>;
      return (
        <tr style={{ height: 26 }}>
          <td colSpan={15} style={base} />
          <td colSpan={4} style={base}>{label}</td>
          {num('paid_amount')}{num('paid_vat')}
          <td colSpan={2} style={{ ...base, textAlign: 'right' }}>{nf(sum(rows, 'claimed_amount'))}</td>
          <td colSpan={2} style={{ ...base, textAlign: 'right' }}>{nf(sum(rows, 'claimed_vat'))}</td>
          <td style={base} />
        </tr>
      );
    };
    const GrandRow = () => (
      <tr style={{ height: 26 }}>
        <td colSpan={15} style={T9} />
        <td colSpan={4} style={{ ...T9, fontWeight: 700 }}>รวมสุทธิ</td>
        <td style={{ ...T9, fontWeight: 700, textAlign: 'right' }}>{nf(sum0(allRows, 'paid_amount'))}</td>
        <td style={{ ...T9, fontWeight: 700, textAlign: 'right' }}>{nf(sum0(allRows, 'paid_vat'))}</td>
        <td colSpan={2} style={{ ...T9, fontWeight: 700, textAlign: 'right' }}>{nf(sum0(allRows, 'claimed_amount'))}</td>
        <td colSpan={2} style={{ ...T9, fontWeight: 700, textAlign: 'right' }}>{nf(sum0(allRows, 'claimed_vat'))}</td>
        <td style={T9} />
      </tr>
    );
    const co = (g, i) => {
      const h = g.header || {};
      const rows = [
        ['ชื่อผู้ประกอบการ', h.operator_name, 'เลขประจำตัวผู้เสียภาษี', h.company_tax_id ? `: ${h.company_tax_id}` : ''],
        ['ที่อยู่', h.address_line1, 'รหัสสาขา', `: ${g.branch}`],
        ['', h.address_line2, 'สาขาที่', h.branch_no ? `: ${h.branch_no}` : ''],
        ['', h.address_line3, '', ''],
      ];
      return rows.map(([l1, v1, l2, v2], k) => (
        <tr key={`co${i}-${k}`} style={{ height: k === 0 ? 19 : 18 }}>
          <td colSpan={3} style={lab}>{l1}</td>
          <td colSpan={6} style={T9}>{v1 || ''}</td>
          <td style={T9} />
          <td colSpan={2} style={lab}>{l2}</td>
          <td colSpan={k < 2 ? 3 : 13} style={hidden}>{v2}</td>
          {k < 2 && <td colSpan={10} style={T9} />}
        </tr>
      ));
    };
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, color: '#000' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: PX.reduce((a, b) => a + b, 0), margin: '0 auto' }}>
          <colgroup>{PX.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <tbody>
            <tr style={{ height: 35 }}><td colSpan={NC} style={{ ...T9, fontSize: 24, fontWeight: 700, textAlign: 'center' }}>{h0.report_title || 'รายงานภาษีซื้อ'}</td></tr>
            <Sp h={12} />
            {[['Bu Code:', BuCode], ['Report ID:', h0.report_id || ''], ['Print Date:', h0.print_date || ''], ['Print By:', h0.print_by || '']].map(([l, v], i) => (
              <tr key={`m${i}`} style={{ height: 18 }}>
                <td colSpan={2} style={lab}>{'   '}{l}</td>
                <td colSpan={3} style={T9}>{v}</td>
                <td colSpan={NC - 5} style={T9} />
              </tr>
            ))}
            <Sp h={19} />
            {groups.map((g, gi) => (
              <React.Fragment key={g.branch}>
                {co(g, gi)}
                <tr style={{ height: 27 }}><td colSpan={NC} style={{ ...T9, borderBottom: FB }} /></tr>
                <tr style={{ height: 32 }}>
                  <th colSpan={3} style={hd}>รับสินค้า/รับเอกสาร</th>
                  <th colSpan={9} style={hd}>ใบกำกับภาษี</th>
                  <th colSpan={2} rowSpan={2} style={hd}>เลขประจำตัวผู้เสียภาษีอากร</th>
                  <th rowSpan={2} style={hd}>สถานประกอบการ สาขาที่</th>
                  <th colSpan={4} rowSpan={2} style={hd}>รายการ</th>
                  <th colSpan={2} style={hd}>ภาษีซื้อที่ชำระ</th>
                  <th colSpan={5} style={hd}>ภาษีซื้อที่ใช้สิทธิ์</th>
                </tr>
                <tr style={{ height: 29 }}>
                  <th style={hd}>วัน/เดือน/ปี</th>
                  <th colSpan={2} style={hd}>ลำดับที่</th>
                  <th colSpan={3} style={hd}>วัน/เดือน/ปี</th>
                  <th colSpan={2} style={hd}>เลขที่</th>
                  <th colSpan={4} style={hd}>ชื่อผู้ค้า</th>
                  <th style={hd}>มูลค่าสินค้า</th>
                  <th style={hd}>เงินภาษี</th>
                  <th colSpan={2} style={hd}>มูลค่าสินค้า</th>
                  <th colSpan={2} style={hd}>เงินภาษี</th>
                  <th style={hd}>(%)</th>
                </tr>
                {g.rows.map((r, i) => (
                  <tr key={r.id ?? i} style={{ height: 26 }}>
                    {cellEd(gi, i, r, 'receive_date', soDate(r.receive_date), bxR)}
                    {cellEd(gi, i, r, 'running_no', r.running_no ?? '', bx, 2)}
                    {cellEd(gi, i, r, 'tax_invoice_date', soDate(r.tax_invoice_date), bxR, 3)}
                    {cellEd(gi, i, r, 'tax_invoice_no', r.tax_invoice_no || '', bx, 2)}
                    {cellEd(gi, i, r, 'vendor_name', r.vendor_name || '', bx, 4)}
                    {cellEd(gi, i, r, 'tax_id', soZero(r.tax_id), bx, 2)}
                    {cellEd(gi, i, r, 'branch_field', soZero(r.branch_field), bx)}
                    {cellEd(gi, i, r, 'item_detail', r.item_detail || '', bx, 4)}
                    {cellEd(gi, i, r, 'paid_amount', nf(r.paid_amount), bxR)}
                    {cellEd(gi, i, r, 'paid_vat', nf(r.paid_vat), bxR)}
                    {cellEd(gi, i, r, 'claimed_amount', nf(r.claimed_amount), bxR, 2)}
                    {cellEd(gi, i, r, 'claimed_vat', nf(r.claimed_vat), bxR, 2)}
                    {cellEd(gi, i, r, 'claim_percent', pc(r.claim_percent), bxR)}
                  </tr>
                ))}
                <SubRow label={`รวมสาขา ${g.branch}`} rows={g.rows} />
                <tr style={{ height: 12 }}><td colSpan={NC} style={{ background: '#fff', padding: 0, borderTop: FB }} /></tr>
                {gi < groups.length - 1 && <Sp h={19} />}
              </React.Fragment>
            ))}
            <GrandRow />
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, padding: '14px 16px', color: '#000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{h0.report_title || 'รายงานภาษีซื้อ'}</div>
      <table style={{ fontSize: 12.5, marginBottom: 8, borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={lbl}>Bu Code :</td><td>{bu || ''}</td></tr>
          <tr><td style={lbl}>Report ID :</td><td>{h0.report_id || ''}</td></tr>
          <tr><td style={lbl}>Print Date :</td><td>{h0.print_date ? soDate(h0.print_date) : ''}</td></tr>
          <tr><td style={lbl}>Print By :</td><td>{h0.print_by || ''}</td></tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 12.5, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div><b>ชื่อผู้ประกอบการ :</b> {h0.operator_name || ''}</div>
          <div><b>ที่อยู่ :</b> {h0.address_line1 || ''}</div>
          {h0.address_line2 ? <div style={{ paddingLeft: 40 }}>{h0.address_line2}</div> : null}
          {h0.address_line3 ? <div style={{ paddingLeft: 40 }}>{h0.address_line3}</div> : null}
        </div>
        <div>
          <div><b>เลขประจำตัวผู้เสียภาษี :</b> {h0.company_tax_id || ''}</div>
          <div><b>รหัสสาขา :</b> {(groups[0] && groups[0].branch) || ''}</div>
          <div><b>สาขาที่ :</b> {h0.branch_no || ''}</div>
        </div>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th} colSpan={2}>รับสินค้า/รับเอกสาร</th>
            <th style={th} colSpan={3}>ใบกำกับภาษี</th>
            <th style={th} rowSpan={2}>เลขประจำตัว<br />ผู้เสียภาษีอากร</th>
            <th style={th} rowSpan={2}>สถาน<br />ประกอบการ<br />สาขาที่</th>
            <th style={th} rowSpan={2}>&nbsp;</th>
            <th style={{ ...th, minWidth: 260 }} rowSpan={2}>รายการ</th>
            <th style={th} colSpan={2}>ภาษีซื้อที่ชำระ</th>
            <th style={th} colSpan={3}>ภาษีซื้อที่ใช้สิทธิ์</th>
          </tr>
          <tr>
            <th style={th}>วัน/เดือน/ปี</th>
            <th style={th}>ลำดับที่</th>
            <th style={th}>วัน/เดือน/ปี</th>
            <th style={th}>เลขที่</th>
            <th style={th}>ชื่อผู้ค้า</th>
            <th style={th}>มูลค่าสินค้า</th>
            <th style={th}>เงินภาษี</th>
            <th style={th}>มูลค่าสินค้า</th>
            <th style={th}>เงินภาษี</th>
            <th style={th}>(%)</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <React.Fragment key={g.branch}>
              {g.rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  {cellEd(gi, i, r, 'receive_date', soDate(r.receive_date), tdC)}
                  {cellEd(gi, i, r, 'running_no', r.running_no ?? '', tdC)}
                  {cellEd(gi, i, r, 'tax_invoice_date', soDate(r.tax_invoice_date), tdC)}
                  {cellEd(gi, i, r, 'tax_invoice_no', r.tax_invoice_no || '', { ...td, whiteSpace: 'nowrap' })}
                  {cellEd(gi, i, r, 'vendor_name', r.vendor_name || '', { ...td, whiteSpace: 'nowrap' })}
                  {cellEd(gi, i, r, 'tax_id', soZero(r.tax_id), tdC)}
                  {cellEd(gi, i, r, 'branch_field', soZero(r.branch_field), tdC)}
                  <td style={td}></td>
                  {cellEd(gi, i, r, 'item_detail', r.item_detail || '', { ...td, minWidth: 260 })}
                  {cellEd(gi, i, r, 'paid_amount', soNum(r.paid_amount), tdR)}
                  {cellEd(gi, i, r, 'paid_vat', soNum(r.paid_vat), tdR)}
                  {cellEd(gi, i, r, 'claimed_amount', soNum(r.claimed_amount), tdR)}
                  {cellEd(gi, i, r, 'claimed_vat', soNum(r.claimed_vat), tdR)}
                  {cellEd(gi, i, r, 'claim_percent', r.claim_percent == null ? '' : `${Number(r.claim_percent).toFixed(2)}%`, tdR)}
                </tr>
              ))}
              <Total label={`รวมสาขา ${g.branch}`} rows={g.rows} />
            </React.Fragment>
          ))}
          {groups.length > 1 && <Total label="รวมสุทธิ" rows={allRows} />}
        </tbody>
      </table>
    </div>
  );
}

// MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- Excel-Style Grid: Double-click แก้ไข Field ได้ทุก Column + PUT กลับ DB, Drag-Select หลาย Cell + Ctrl+C Copy (เฉพาะตอน Backend ส่ง "id" มาด้วย -- ตอนนี้รองรับแค่ Input Summary Detail)
// Hook ต้องอยู่ก่อน Early Return เสมอ (Rules of Hooks) ไม่งั้น Order จะไม่เท่ากันระหว่าง Render ที่มี/ไม่มีข้อมูล
// MARKER_VATRECONCILEDASHBOARD_DATE_DDMMMYY_V1 -- คอลัมน์วันที่โชว์เป็น DD-MMM-YY (เช่น 21-Sep-26) ; ค่าจริงใน DB ยังเป็น YYYY-MM-DD
const DATE_COLUMNS = new Set(['receive_date', 'tax_invoice_date']);
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDdMmmYy(v) {
  if (v === null || v === undefined || v === '') return '';
  let y; let m; let d;
  if (v instanceof Date && !Number.isNaN(v.getTime())) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); }
  else {
    const mm = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!mm) return String(v);
    y = Number(mm[1]); m = Number(mm[2]); d = Number(mm[3]);
  }
  if (m < 1 || m > 12) return String(v);
  return `${String(d).padStart(2, '0')}-${MON3[m - 1]}-${String(y % 100).padStart(2, '0')}`;
}
// "21-Sep-26" -> {y:2026,m:9,d:21} (null ถ้าไม่ใช่รูปแบบนี้)
function parseDdMmmYy(t) {
  const mm = String(t || '').match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!mm) return null;
  const mi = MON3.indexOf(mm[2]);
  if (mi < 0) return null;
  return { y: 2000 + Number(mm[3]), m: mi + 1, d: Number(mm[1]) };
}
const dateSortKey = (t) => { const p = parseDdMmmYy(t); return p ? p.y * 10000 + p.m * 100 + p.d : null; };
const EDITABLE_TABLE_BY_REPORT = { 'input_summary|detail': 'vat_reconcile_input_summary', 'tb|': 'tb', 'simple_100|detail': 'simple_detail', 'simple_avg|detail': 'simple_detail' }; // MARKER_VATRECONCILE_CELL_EDIT_FRONT_V14
// MARKER_VATRECONCILE_STATUS_COL_V1 -- คำนวณ Status ใหม่หลังแก้ช่อง (สูตรเดียวกับ Excel + Over Period) ถ้าอ่านวันที่ไม่ได้ให้คงค่าเดิม
function toIsoDay(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[1]) >= 2500 ? Number(m[1]) - 543 : m[1]}-${m[2]}-${m[3]}`; // MARKER_VATRECONCILE_EXPIRED_V1 -- ปี พ.ศ. -> ค.ศ.
  const p = parseDdMmmYy(s);
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null;
}
function calcInputStatusRow(row, period) {
  if (!('status' in row)) return row;
  const rc = toIsoDay(row.receive_date);
  const inv = toIsoDay(row.tax_invoice_date);
  if (!inv) return row;
  const pm = String(period || '').slice(0, 7);
  let status;
  if (pm && inv.slice(0, 7) > pm) status = 'Over Period';
  else if (pm && !/f/i.test(String(row.grt_no ?? '')) && (Number(pm.slice(0, 4)) * 12 + Number(pm.slice(5, 7))) - (Number(inv.slice(0, 4)) * 12 + Number(inv.slice(5, 7))) > 6) status = 'Expired'; // MARKER_VATRECONCILE_EXPIRED_V1 -- เกิน 6 เดือนจาก Period และ GRT_No ไม่มี F
  else if (rc && rc < inv) status = 'Futuredate';
  else {
    const amt = Number(String(row.paid_amount ?? 0).replace(/,/g, '')) || 0;
    const vat = Number(String(row.claimed100_vat ?? 0).replace(/,/g, '')) || 0;
    const f = row.claim_percent && !row.is_n ? Number(row.claim_percent) / 100 : 1; // MARKER_VATRECONCILE_PCT_STATUS_FRONT_V1 -- แถวหัว % เทียบกับ (มูลค่า × 7% × %) ไม่ใช่ 100%
    status = Math.abs(Math.round((amt * 7 / 100 * f - vat) * 100) / 100) > 0.05 ? 'Unbalance' : 'Balance';
  }
  return { ...row, status };
}
// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15 -- ค้นหาชุดรายการที่รวมกันได้ยอดเป้าหมาย (Subset Sum แบบ Algorithm ล้วน ไม่ใช้ AI) ทำงานในเบราว์เซอร์ ไม่ยิง API
// items: [{ c: จำนวนเต็มสตางค์ }] -> คืน [[index,...]] เรียงจากชุดที่ใช้รายการน้อยที่สุด | tol = ช่วงคลาดเคลื่อน (สตางค์)
// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V16
async function findSubsetSums(items, targetC, tolC, maxK, maxSets, shouldAbort) {
  const n = items.length;
  const v = items.map((x) => x.c);
  const out = [];
  const seen = new Set();
  const add = (idxs) => {
    const a = idxs.slice().sort((x, y) => x - y);
    const key = a.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  let lastYield = Date.now();
  const yieldNow = async () => { if (Date.now() - lastYield > 40) { await new Promise((r) => setTimeout(r, 0)); lastYield = Date.now(); } return shouldAbort(); };
  const lo = targetC - tolC;
  const hi = targetC + tolC;
  // เรียงค่า (เก็บ index เดิมไว้) -> ใช้ Two-pointer / Binary search แทนการไล่ทุกคู่ ทำให้รองรับหลักพันแถว
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  const sv = Float64Array.from(ord.map((i) => v[i])); // ค่าที่เรียงแล้ว
  const lowerBound = (arr, len, x) => { let l = 0; let h = len; while (l < h) { const m = (l + h) >> 1; if (arr[m] < x) l = m + 1; else h = m; } return l; };
  for (let k = 1; k <= maxK && out.length < maxSets; k++) {
    if (k === 1) {
      for (let p = lowerBound(sv, n, lo); p < n && sv[p] <= hi; p++) add([ord[p]]);
    } else if (k === 2) {
      for (let a = 0; a < n && out.length < maxSets; a++) {
        if (await yieldNow()) return out;
        for (let b = Math.max(a + 1, lowerBound(sv, n, lo - sv[a])); b < n && sv[b] <= hi - sv[a]; b++) add([ord[a], ord[b]]);
      }
    } else if (k === 3) {
      // เลือก 2 ตัว (a<b) แล้วหาตัวที่ 3 (c>b) ด้วย Binary search : O(n^2 log n)
      for (let a = 0; a < n && out.length < maxSets; a++) {
        if (await yieldNow()) return out;
        for (let b = a + 1; b < n; b++) {
          if (b % 64 === 0 && await yieldNow()) return out;
          const s2 = sv[a] + sv[b];
          for (let c = Math.max(b + 1, lowerBound(sv, n, lo - s2)); c < n && sv[c] <= hi - s2; c++) add([ord[a], ord[b], ord[c]]);
        }
      }
    } else {
      // k = 4,5: สร้างตารางผลรวมคู่ (เรียงแล้ว) แล้วจับคู่ด้วย Binary search
      const m = (n * (n - 1)) / 2;
      const ps = new Float64Array(m); const pa = new Int32Array(m); const pb = new Int32Array(m);
      { let t = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { ps[t] = sv[i] + sv[j]; pa[t] = i; pb[t] = j; t++; } }
      const pord = Int32Array.from({ length: m }, (_, i) => i).sort((x, y) => ps[x] - ps[y]);
      const sps = new Float64Array(m); for (let t = 0; t < m; t++) sps[t] = ps[pord[t]];
      if (k === 4) {
        for (let t = 0; t < m && out.length < maxSets; t++) {
          if (await yieldNow()) return out;
          const A = pord[t];
          for (let u = Math.max(t + 1, lowerBound(sps, m, lo - ps[A])); u < m && sps[u] <= hi - ps[A]; u++) {
            const B = pord[u];
            if (pa[A] !== pa[B] && pa[A] !== pb[B] && pb[A] !== pa[B] && pb[A] !== pb[B]) add([ord[pa[A]], ord[pb[A]], ord[pa[B]], ord[pb[B]]]);
          }
        }
      } else {
        for (let i = 0; i < n && out.length < maxSets; i++) {
          if (await yieldNow()) return out;
          for (let j = i + 1; j < n; j++) {
            if (await yieldNow()) return out;
            const s2 = sv[i] + sv[j];
            for (let l = j + 1; l < n; l++) {
              const s3 = s2 + sv[l];
              for (let u = lowerBound(sps, m, lo - s3); u < m && sps[u] <= hi - s3; u++) {
                const B = pord[u];
                if (pa[B] > l) add([ord[i], ord[j], ord[l], ord[pa[B]], ord[pb[B]]]);
              }
            }
          }
        }
      }
    }
  }
  out.sort((x, y) => x.length - y.length);
  return out;
}

// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15 -- แผงค้นหาชุดรายการที่รวมกันได้ยอดที่ต้องการ (Detail)
const SS_COLS = [['paid_vat', 'เงินภาษีที่ชำระ'], ['paid_amount', 'มูลค่าที่ชำระ'], ['claimed100_vat', 'เงินภาษีที่ใช้สิทธิ์'], ['claimed100_amount', 'มูลค่าที่ใช้สิทธิ์'], ['calculate_tax', 'Calculate Tax']];
function SubsetSumPanel({ rows, onPick, onClear, modal, onClose }) {
  const cols = SS_COLS.filter(([k]) => rows.some((r) => r[k] !== undefined));
  const [open, setOpen] = useState(!!modal);
  const [col, setCol] = useState('paid_vat');
  const [target, setTarget] = useState('');
  const [tol, setTol] = useState('0');
  const [maxK, setMaxK] = useState(5);
  const [prune, setPrune] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { sets:[{rows,sum}], ms, n, note }
  const [pick, setPick] = useState(-1);
  const abortRef = useRef(false);
  const calc = async () => {
    const tg = Number(String(target).replace(/,/g, ''));
    if (!Number.isFinite(tg) || String(target).trim() === '') { setResult({ sets: [], note: 'กรอกยอดเป้าหมายก่อน' }); return; }
    let items = rows.filter((r) => r[col] !== null && r[col] !== undefined && r[col] !== '' && Number.isFinite(Number(r[col]))).map((r) => ({ r, c: Math.round(Number(r[col]) * 100) }));
    let prunedNote = '';
    if (prune) {
      const hasNeg = items.some((x) => x.c < 0) || tg < 0;
      if (hasNeg) prunedNote = 'ไม่ได้ตัดรายการที่ยอดมากกว่า เพราะมียอดติดลบ (ยอดใหญ่อาจถูกหักล้างได้)';
      else {
        const lim = Math.round(tg * 100) + Math.round(Math.abs(Number(tol) || 0) * 100);
        const before = items.length;
        items = items.filter((x) => x.c <= lim);
        prunedNote = `ตัดรายการที่ยอดมากกว่า ${tg.toLocaleString('en-US', { minimumFractionDigits: 2 })} ออก ${(before - items.length).toLocaleString()} แถว เหลือค้นหา ${items.length.toLocaleString()} แถว`;
      }
    }
    if (items.length > 2000) { setResult({ sets: [], note: `มี ${items.length.toLocaleString()} แถว (เกิน 2,000) — กรองสาขา/คอลัมน์ให้เหลือน้อยลงก่อน` }); return; }
    const k = items.length > 500 ? Math.min(maxK, 4) : maxK;
    abortRef.current = false; setRunning(true); setPick(-1); onClear();
    const t0 = Date.now();
    const sets = await findSubsetSums(items, Math.round(tg * 100), Math.round(Math.abs(Number(tol) || 0) * 100), k, 30, () => abortRef.current || Date.now() - t0 > 60000);
    setResult({
      sets: sets.map((idx) => ({ rows: idx.map((i) => items[i].r), sum: idx.reduce((s, i) => s + items[i].c, 0) / 100 })),
      ms: Date.now() - t0, n: items.length, note: [prunedNote, abortRef.current ? 'หยุดค้นหาแล้ว (แสดงเท่าที่พบ)' : Date.now() - t0 > 60000 ? 'ครบเวลา 60 วินาที (แสดงเท่าที่พบ)' : ''].filter(Boolean).join(' · '),
    });
    setRunning(false);
  };
  const box = { border: '1px solid #d0d7de', borderRadius: 8, padding: '8px 12px', marginBottom: 10, background: '#fafbfc' };
  const inp = { fontSize: 12.5, padding: '4px 8px', border: '1px solid #d0d7de', borderRadius: 6 };
  return (
    <div style={modal ? { marginBottom: 0 } : box}>
      {modal
        ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>Sampling · หาชุดรายการที่รวมกันได้ยอดที่ต้องการ</span>
            <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
          </div>
        )
        : (
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#334155', padding: 0 }}>
            {open ? '▾' : '▸'} หาชุดรายการที่รวมกันได้ยอดที่ต้องการ
          </button>
        )}
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
            <label>ยอดที่ต้องการ <input style={{ ...inp, width: 110, textAlign: 'right' }} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="13.65" onKeyDown={(e) => { if (e.key === 'Enter' && !running) calc(); }} /></label>
            <label>รวมจากคอลัมน์ <select style={inp} value={col} onChange={(e) => setCol(e.target.value)}>{cols.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>คลาดเคลื่อน ± <input style={{ ...inp, width: 60, textAlign: 'right' }} value={tol} onChange={(e) => setTol(e.target.value)} /></label>
            <label>สูงสุดต่อชุด <select style={inp} value={maxK} onChange={(e) => setMaxK(Number(e.target.value))}>{[2, 3, 4, 5].map((k) => <option key={k} value={k}>{k} รายการ</option>)}</select></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} /> ตัดรายการที่ยอดมากกว่ายอดที่ต้องการออกก่อน</label>
            {!running
              ? <button type="button" onClick={calc} style={{ ...inp, background: '#1a7f37', color: '#fff', fontWeight: 700, border: 'none', padding: '5px 16px', cursor: 'pointer' }}>Calculate</button>
              : <button type="button" onClick={() => { abortRef.current = true; }} style={{ ...inp, background: '#cf222e', color: '#fff', fontWeight: 700, border: 'none', padding: '5px 16px', cursor: 'pointer' }}>หยุด</button>}
            {/* MARKER_VATRECONCILE_NO_SEARCH_COUNT_V1 -- เอาข้อความ "ค้นจาก N แถวที่แสดงอยู่" ออกตามที่แจ้ง */}
          </div>
          {running && <div style={{ marginTop: 6, fontSize: 12.5, color: '#57606a' }}>กำลังค้นหา...</div>}
          {result && !running && (
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              {result.note && <div style={{ color: '#856404', marginBottom: 4 }}>{result.note}</div>}
              {result.sets.length === 0 && !result.note?.startsWith('กรอก') && !result.note?.startsWith('มี ') && <div style={{ color: '#cf222e' }}>ไม่พบชุดที่รวมได้ยอดนี้ (ภายใน {maxK} รายการ) {result.ms != null ? `· ใช้เวลา ${result.ms} ms` : ''}</div>}
              {result.sets.length > 0 && <div style={{ color: '#57606a', marginBottom: 4 }}>พบ {result.sets.length}{result.sets.length >= 30 ? '+' : ''} ชุด (เรียงจากใช้รายการน้อยที่สุด) · กดชุดเพื่อไฮไลต์แถวในตาราง · ใช้เวลา {result.ms} ms</div>}
              {modal && result.sets.length > 0 && (() => {
                const ai = pick >= 0 && pick < result.sets.length ? pick : 0;
                const cur = result.sets[ai];
                const nf = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });
                return (
                  <div>
                    <div style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid #d0d7de', marginBottom: 8 }}>
                      {result.sets.map((st, i) => (
                        <button key={i} type="button" onClick={() => { setPick(i); onPick(st.rows.map((r) => r.id)); }}
                          style={{ padding: '5px 14px', fontSize: 12.5, fontWeight: ai === i ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', borderBottom: ai === i ? '2px solid #1a7f37' : '2px solid transparent', background: 'transparent', color: ai === i ? '#1a7f37' : '#475569' }}>
                          ชุดที่ {i + 1} <span style={{ color: '#8b95a1', fontWeight: 500 }}>({st.rows.length})</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ marginBottom: 6, color: '#334155' }}><b>ชุดที่ {ai + 1}</b> · {cur.rows.length} รายการ · รวม <b>{nf(cur.sum)}</b></div>
                    <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #d0d7de', borderRadius: 6 }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                        <thead><tr style={{ background: '#eef4ff' }}>
                          <th style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid #d0d7de' }}>#</th>
                          <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #d0d7de' }}>เลขที่ใบกำกับภาษี</th>
                          <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #d0d7de' }}>GRT_No.</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #d0d7de' }}>{(SS_COLS.find(([k]) => k === col) || [null, col])[1]}</th>
                        </tr></thead>
                        <tbody>
                          {cur.rows.map((r, j) => (
                            <tr key={j}>
                              <td style={{ padding: '3px 8px', textAlign: 'center', borderBottom: '1px solid #eee' }}>{j + 1}</td>
                              <td style={{ padding: '3px 8px', borderBottom: '1px solid #eee' }}>{r.tax_invoice_no || r.id}</td>
                              <td style={{ padding: '3px 8px', borderBottom: '1px solid #eee' }}>{r.grt_no || ''}</td>
                              <td style={{ padding: '3px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>{nf(r[col])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
              {!modal && <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {result.sets.map((s, i) => (
                  <div key={i} onClick={() => { setPick(i); onPick(s.rows.map((r) => r.id)); }}
                    style={{ border: `1px solid ${pick === i ? '#bf8700' : '#d0d7de'}`, background: pick === i ? '#fff8c5' : '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                    <b>ชุดที่ {i + 1}</b> · {s.rows.length} รายการ · รวม {s.sum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <div style={{ color: '#475569', marginTop: 2 }}>
                      {s.rows.map((r) => `${r.tax_invoice_no || r.grt_no || r.id} (${Number(r[col]).toLocaleString('en-US', { minimumFractionDigits: 2 })})`).join('  +  ')}
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportPreviewTable({ okBranches, futureBranches, data, onRowAction, actionLabel, initialBranch, onEdited, samplingOpen, sampleHost, onSamplingClose }) {
  const [columnFilters, setColumnFilters] = React.useState({});
  const [branchFilter, setBranchFilter] = React.useState(initialBranch || ''); // MARKER_VATRECONCILE_TABS_V1 -- เปิดมากรองสาขาที่กดมาจากตาราง Reconcile
  // V2: คงสถานะ Futuredate ไว้ทุกแถว (ไฮไลต์เฉพาะแถวที่รวมแล้วเท่ากับ Diff) · MARKER_VATRECONCILE_PCT_STATUS_FRONT_V2 -- Balance/Unbalance คำนวณใหม่จากค่าในแถวเสมอ (แถวหัว % เทียบกับ มูลค่า×7%×%)
  const demoteFuture = (rows) => (!rows ? rows : rows.map((r) => {
    if (!r || (r.status !== 'Balance' && r.status !== 'Unbalance')) return r;
    const f = r.claim_percent && !r.is_n ? Number(r.claim_percent) / 100 : 1;
    const amt = Number(String(r.paid_amount ?? 0).replace(/,/g, '')) || 0;
    const vat = Number(String(r.claimed100_vat ?? 0).replace(/,/g, '')) || 0;
    const st = Math.abs(Math.round((amt * 7 / 100 * f - vat) * 100) / 100) > 0.05 ? 'Unbalance' : 'Balance';
    return st === r.status ? r : { ...r, status: st };
  }));
  const [localRows, setLocalRows] = React.useState(() => demoteFuture(data.rows || []));
  const [taxSel, setTaxSel] = React.useState(''); // MARKER_VATRECONCILE_TAX_CHIPS_V1 -- กรองตาม Tax Type (All | T | F หรือ All | A | N) เมื่อมีหลาย Tax Type
  const [hiIds, setHiIds] = React.useState(() => new Set()); // MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15
  const [selection, setSelection] = React.useState(null); // {r1,c1,r2,c2} -- r/c = index เข้า filteredRows/columns (คำนวณสดทุก Render)
  const [isDragging, setIsDragging] = React.useState(false);
  const [rangeDragging, setRangeDragging] = React.useState(false); // MARKER_VATRECONCILE_TEXT_SELECT_COPY_V1 -- ลากข้ามหลาย Cell = เลือกช่วง Cell · ลากใน Cell เดียว = เลือกข้อความจริงแล้ว Ctrl+C ได้
  const [editingCell, setEditingCell] = React.useState(null); // {rowId, col}
  const [editVal, setEditVal] = React.useState('');
  const [savingCell, setSavingCell] = React.useState(false);
  const gridRef = React.useRef(null);
  // MARKER_VATRECONCILEDASHBOARD_COLUMN_DROPDOWN_FILTER_V1 -- Filter แบบ Excel: ปุ่ม ▾ ที่หัว Column → Popup มี Search + Checkbox ค่าไม่ซ้ำ
  const [openFilter, setOpenFilter] = React.useState(null); // {col, top, left}
  const [filterSearch, setFilterSearch] = React.useState('');
  const [hoverCol, setHoverCol] = React.useState(null);
  const [sortSpec, setSortSpec] = React.useState(null); // {col, dir:'asc'|'desc'} -- Sort A→Z / Z→A จากเมนู Filter (เหมือน Excel)
  const [dateOpen, setDateOpen] = React.useState(null); // Set ของ key ที่กางอยู่ในต้นไม้ปี>เดือน>วัน (null = ค่าเริ่มต้น: กางระดับปี)
  // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_SPLIT_HEADER_V1 -- หัวตารางแยกเป็นตารางของตัวเอง (ไม่ Scroll แนวตั้ง) Sync แนวนอนกับตัวตาราง
  const hdrRef = React.useRef(null);
  const [sbw, setSbw] = React.useState(0); // ความกว้าง Scrollbar แนวตั้งของตัวตาราง (ใช้เว้นขอบขวาของหัวให้ตรงกัน)
  const widthCacheRef = React.useRef({ rows: null, w: null });

  React.useEffect(() => { setLocalRows(demoteFuture(data.rows || [])); }, [data.rows, futureBranches]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const g = gridRef.current;
    if (!g) return undefined;
    const upd = () => setSbw(Math.max(0, g.offsetWidth - g.clientWidth));
    upd();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(upd); ro.observe(g); }
    window.addEventListener('resize', upd);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', upd); };
  }, [localRows.length]);
  React.useEffect(() => {
    const onUp = () => { setIsDragging(false); setRangeDragging(false); };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);
  // MARKER_VATRECONCILEDASHBOARD_GRID_AUTOSCROLL_V1 -- Drag เลือก Cell แล้วลากเมาส์ชิด/พ้นขอบตาราง → Auto Scroll ต่อเนื่องตราบที่ยังกดค้าง
  React.useEffect(() => {
    if (!isDragging) return undefined;
    const pos = { x: null, y: null };
    const onMove = (e) => { pos.x = e.clientX; pos.y = e.clientY; };
    window.addEventListener('mousemove', onMove);
    const EDGE = 30;
    const speed = (d) => Math.min(48, Math.max(8, Math.abs(d) / 2));
    const timer = setInterval(() => {
      const g = gridRef.current;
      if (!g || pos.x === null) return;
      const rect = g.getBoundingClientRect();
      const right = rect.left + g.clientWidth;
      const bottom = rect.top + g.clientHeight;
      let dx = 0;
      let dy = 0;
      if (pos.x < rect.left + EDGE) dx = -speed(rect.left + EDGE - pos.x);
      else if (pos.x > right - EDGE) dx = speed(pos.x - (right - EDGE));
      if (pos.y < rect.top + EDGE) dy = -speed(rect.top + EDGE - pos.y);
      else if (pos.y > bottom - EDGE) dy = speed(pos.y - (bottom - EDGE));
      if (!dx && !dy) return;
      g.scrollLeft += dx;
      g.scrollTop += dy;
      const cx = Math.min(right - 6, Math.max(rect.left + 6, pos.x));
      const cy = Math.min(bottom - 6, Math.max(rect.top + 6, pos.y));
      const el = document.elementFromPoint(cx, cy);
      const td = el && el.closest ? el.closest('td[data-r]') : null;
      if (td) {
        const r = Number(td.dataset.r);
        const c = Number(td.dataset.c);
        setSelection((sel) => (sel ? { ...sel, r2: r, c2: c } : sel));
      }
    }, 40);
    return () => { clearInterval(timer); window.removeEventListener('mousemove', onMove); };
  }, [isDragging]);

  if (!localRows || localRows.length === 0) {
    return <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: '24px 0' }}>ไม่พบข้อมูล</p>;
  }
  // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- ตัด 'id' ออกจาก Column ที่แสดง/Filter/Copy (ใช้แค่เป็น Key อ้างอิงตอน PUT เท่านั้น ไม่ต้องโชว์)
  const columns = Object.keys(localRows[0]).filter((k) => k !== 'id' && k !== 'claim_percent' && k !== 'is_n'); // MARKER_VATRECONCILE_CLAIM_PERCENT_HIDDEN_V1 -- claim_percent ใช้คำนวณ/ล็อกช่องเท่านั้น ไม่แสดงเป็นคอลัมน์
  const editableTable = EDITABLE_TABLE_BY_REPORT[`${data.type}|${data.view || ''}`];
  const isEditable = !!editableTable && typeof localRows[0]?.id !== 'undefined';
  const branchOptions = columns.includes('branch')
    ? [...new Set(localRows.map((r) => String(r.branch ?? '').trim()).filter(Boolean))].sort()
    : [];

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
    if (selection && (r !== selection.r1 || c !== selection.c1) && !rangeDragging) {
      setRangeDragging(true);
      try { window.getSelection && window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
    }
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
    // MARKER_VATRECONCILE_COPY_FALLBACK_V1 -- navigator.clipboard ใช้ได้เฉพาะ HTTPS/localhost (เปิดผ่าน http://IP จะเป็น undefined แล้ว Copy เงียบหาย) -> ใช้ textarea + execCommand('copy') เป็นตัวสำรอง
    const legacyCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        gridRef.current && gridRef.current.focus();
      } catch (e) { /* ignore */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(legacyCopy);
    } else {
      legacyCopy();
    }
  };
  // MARKER_VATRECONCILEDASHBOARD_GRID_KEYNAV_V1 -- เลื่อน Cell ด้วยคีย์บอร์ดแบบ Excel (กดค้างได้ + Auto Scroll ตาม)
  const scrollCellIntoView = (r, c) => {
    const g = gridRef.current;
    if (!g) return;
    const td = g.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    const gr = g.getBoundingClientRect();
    const tr = td.getBoundingClientRect();
    const top = gr.top;
    const bottom = gr.top + g.clientHeight;
    const left = gr.left;
    const right = gr.left + g.clientWidth;
    if (tr.top < top) g.scrollTop -= top - tr.top;
    else if (tr.bottom > bottom) g.scrollTop += tr.bottom - bottom;
    if (tr.left < left) g.scrollLeft -= left - tr.left;
    else if (tr.right > right) g.scrollLeft += tr.right - right;
  };
  const moveSel = (dr, dc, extend, jump) => {
    const R = filteredRows.length;
    const C = columns.length;
    if (!R || !C) return;
    let r = 0;
    let c = 0;
    if (selection) {
      r = selection.r2;
      c = selection.c2;
      if (jump) {
        if (dr) r = dr < 0 ? 0 : R - 1;
        if (dc) c = dc < 0 ? 0 : C - 1;
      } else {
        r += dr;
        c += dc;
      }
    }
    r = Math.min(R - 1, Math.max(0, r));
    c = Math.min(C - 1, Math.max(0, c));
    setSelection(extend && selection ? { r1: selection.r1, c1: selection.c1, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c });
    scrollCellIntoView(r, c);
  };
  const handleGridKeyDown = (e) => {
    if (editingCell || (e.target && e.target.tagName === 'INPUT')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) {
      // MARKER_VATRECONCILE_TEXT_SELECT_COPY_V1 -- มีข้อความที่ลากเลือกไว้ใน Cell เดียว -> ให้ Browser Copy ข้อความนั้นตามปกติ
      const _single = selection && selection.r1 === selection.r2 && selection.c1 === selection.c2;
      let _txt = ''; try { _txt = window.getSelection ? String(window.getSelection()) : ''; } catch (err) { /* ignore */ }
      if (_single && _txt.trim()) return;
      e.preventDefault(); handleCopy(); return;
    } //  // MARKER_VATRECONCILE_COPY_THAI_LAYOUT_V1 -- แป้นพิมพ์ภาษาไทย e.key ของ Ctrl+C ไม่ใช่ 'c' -> เช็ค e.code (ตำแหน่งปุ่ม) ด้วย
    if (!isEditable || e.altKey) return;
    const pageRows = Math.max(1, Math.floor(((gridRef.current && gridRef.current.clientHeight) || 400) / 33) - 1);
    const sh = e.shiftKey;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': moveSel(-1, 0, sh, ctrl); break;
      case 'ArrowDown': moveSel(1, 0, sh, ctrl); break;
      case 'ArrowLeft': moveSel(0, -1, sh, ctrl); break;
      case 'ArrowRight': moveSel(0, 1, sh, ctrl); break;
      case 'PageUp': moveSel(-pageRows, 0, sh, false); break;
      case 'PageDown': moveSel(pageRows, 0, sh, false); break;
      case 'Home': if (ctrl) { moveSel(-1, -1, sh, true); } else { moveSel(0, -1, sh, true); } break;
      case 'End': if (ctrl) { moveSel(1, 1, sh, true); } else { moveSel(0, 1, sh, true); } break;
      case 'Tab': moveSel(0, sh ? -1 : 1, false, false); break;
      case 'Enter': moveSel(sh ? -1 : 1, 0, false, false); break;
      case 'F2':
        if (selection && filteredRows[selection.r2]) startEdit(filteredRows[selection.r2], columns[selection.c2]);
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };
  const endEdit = (dir) => {
    setEditingCell(null);
    setTimeout(() => {
      const ae = document.activeElement;
      if (gridRef.current && (!ae || ae === document.body)) gridRef.current.focus();
    }, 0);
    if (dir === 'down') moveSel(1, 0, false, false);
    else if (dir === 'right') moveSel(0, 1, false, false);
  };
  const startEdit = (row, col) => {
    if (!isEditable || col === 'status') return; // Status เป็นคอลัมน์คำนวณ แก้ไม่ได้
    if (col === 'tax_type') return; // MARKER_VATRECONCILE_PCT_N_ROWS_FRONT_V1 -- Tax Type แสดงอย่างเดียว (การย้ายต้องเปลี่ยน Account ด้วย ยังไม่เปิดให้แก้จากช่องนี้)
    if (row.is_n && (col === 'claimed100_amount' || col === 'claimed100_vat' || col === 'calculate_tax')) return; // Input N ในหัว % = 100% คำนวณให้ แก้ที่ช่องที่ชำระแทน
    if (row.claim_percent && (col === 'claimed100_amount' || col === 'claimed100_vat')) return; // MARKER_VATRECONCILE_CLAIM_PERCENT_HEADER_V1 -- ช่องใช้สิทธิ์ = ที่ชำระ x % (คำนวณ) แก้ที่ช่องที่ชำระแทน
    setEditingCell({ rowId: row.id, col });
    setEditVal(DATE_COLUMNS.has(col) ? fmtDdMmmYy(row[col]) : String(row[col] ?? '')); // MARKER_VATRECONCILE_DATE_DDMMMYY_GRID_V1 -- วันที่แสดง/แก้เป็น dd-mmm-yy
  };
  const commitEdit = async (dir) => {
    if (!editingCell || savingCell) return;
    const { rowId, col } = editingCell;
    const row = localRows.find((r) => r.id === rowId);
    if (!row) { endEdit(); return; }
    let nextVal = editVal.trim();
    if (DATE_COLUMNS.has(col) && nextVal !== '') { const iso = toIsoDay(nextVal); if (iso) nextVal = iso; } // dd-mmm-yy -> ISO ก่อนบันทึก (DB เก็บ ISO)
    const curVal = DATE_COLUMNS.has(col) ? (toIsoDay(row[col]) || String(row[col] ?? '').trim()) : String(row[col] ?? '').trim();
    if (nextVal === curVal) { endEdit(dir); return; }
    setSavingCell(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const putField = async (field, value) => {
        const viaCell = editableTable === 'tb' || editableTable === 'simple_detail';
        const res = await fetch(viaCell ? `${VAT_RECONCILE_API_BASE}/vat-reconcile/cell` : `${VAT_RECONCILE_API_BASE}/${editableTable}/${rowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(viaCell ? { table: editableTable, id: rowId, field, value } : { [field]: value }),
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(resData?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      };
      const newVal = nextVal === '' ? null : nextVal;
      const updates = { [col]: newVal };
      // MARKER_VATRECONCILEDASHBOARD_AUTO_VAT_7PCT_V1 -- แก้ มูลค่าสินค้า (paid_amount) → คำนวณ เงินภาษี (paid_vat) อัตโนมัติ = ROUND(amount*7/100, 2)
      if (col === 'paid_amount' && editableTable === 'vat_reconcile_input_summary') {
        if (newVal === null) {
          updates.paid_vat = null;
        } else {
          const n = Number(String(newVal).replace(/,/g, ''));
          if (Number.isFinite(n)) {
            const raw = n * 7;
            updates.paid_vat = (Math.sign(raw) * Math.round(Math.abs(raw)) / 100).toFixed(2);
          }
        }
      }
      for (const [f, v] of Object.entries(updates)) await putField(f, v);
      // MARKER_VATRECONCILE_PCT_STATUS_FRONT_V1 -- แก้ มูลค่า/ภาษีที่ชำระของแถวหัว % -> คำนวณช่องใช้สิทธิ์ (x%) + Calculate Tax ในหน้าจอใหม่ทันที (ไม่งั้น Status เป็น Unbalance ทั้งที่ถูก)
      const localExtra = {};
      const _pct = Number(row.claim_percent) || 0;
      if (_pct && !row.is_n && editableTable === 'vat_reconcile_input_summary' && (col === 'paid_amount' || col === 'paid_vat')) {
        const _r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
        const _L = Number(String(updates.paid_amount ?? row.paid_amount ?? 0).replace(/,/g, '')) || 0;
        const _V = Number(String(updates.paid_vat ?? row.paid_vat ?? 0).replace(/,/g, '')) || 0;
        const _n = _r2(_L * _pct / 100);
        localExtra.claimed100_amount = _n; localExtra.claimed100_vat = _r2(_V * _pct / 100); localExtra.calculate_tax = _r2(_L - _n);
      }
      const nextRow = editableTable === 'vat_reconcile_input_summary' ? demoteFuture([calcInputStatusRow({ ...row, ...updates, ...localExtra }, data.period)])[0] : { ...row, ...updates };
      setLocalRows((prev) => prev.map((r) => (r.id === rowId ? nextRow : r)));
      if (typeof onEdited === 'function') onEdited(rowId, nextRow);
      endEdit(dir);
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

  // ข้อความที่โชว์ใน Cell (ใช้เป็นค่าใน Filter ด้วย เพื่อให้ตรงกับที่ผู้ใช้เห็น)
  const cellText = (r, c) => {
    const v = r[c];
    if (c === 'branch_no' || c === 'branch_field') return v !== null && v !== undefined && String(v).trim() !== '' ? String(v).padStart(5, '0') : '';
    if (c === 'tax_id' || c === 'company_tax_id') return v ? String(v).padStart(13, '0') : '';
    if (DATE_COLUMNS.has(c)) return fmtDdMmmYy(v);
    const n = toNumericOrNull(v, c);
    if (n !== null) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(v ?? '');
  };
  const activeFilterCols = Object.keys(columnFilters).filter((k) => columnFilters[k]);
  const filteredBase = localRows.filter((r) => {
    if (branchFilter && String(r.branch ?? '').trim() !== branchFilter) return false;
    if (taxSel && String(r.tax_type ?? '') !== taxSel) return false;
    for (const col of activeFilterCols) {
      if (!columnFilters[col].has(cellText(r, col))) return false;
    }
    return true;
  });
  // MARKER_VATRECONCILEDASHBOARD_EXCEL_SORT_V1 -- Sort ตามคอลัมน์ที่เลือก (วันที่เรียงตามปฏิทิน, ตัวเลขเรียงตามค่า, อื่นๆ ตามตัวอักษร) ; ช่องว่างอยู่ท้ายเสมอ
  const compareCells = (a, b, col) => {
    const ta = cellText(a, col);
    const tb = cellText(b, col);
    if (ta === '' && tb === '') return 0;
    if (ta === '') return 1;
    if (tb === '') return -1;
    if (DATE_COLUMNS.has(col)) {
      const ka = dateSortKey(ta);
      const kb = dateSortKey(tb);
      if (ka !== null && kb !== null) return ka - kb;
    }
    const na = toNumericOrNull(a[col], col);
    const nb = toNumericOrNull(b[col], col);
    if (na !== null && nb !== null) return na - nb;
    return ta.localeCompare(tb, 'th', { numeric: true });
  };
  const filteredRows = sortSpec
    ? [...filteredBase].sort((a, b) => {
        const ta = cellText(a, sortSpec.col);
        const tb = cellText(b, sortSpec.col);
        if (ta === '' || tb === '') return compareCells(a, b, sortSpec.col); // ว่างท้ายเสมอไม่ว่าทิศทางไหน
        return sortSpec.dir === 'asc' ? compareCells(a, b, sortSpec.col) : -compareCells(a, b, sortSpec.col);
      })
    : filteredBase;
  const openFilterFor = (e, c) => {
    e.stopPropagation();
    const rect = e.currentTarget.closest('th').getBoundingClientRect();
    setFilterSearch('');
    setDateOpen(null);
    setOpenFilter({ col: c, top: rect.bottom + 2, left: Math.max(8, Math.min(rect.left, window.innerWidth - 290)) });
  };
  const allValuesOf = (c) => {
    const set = new Set(localRows.map((r) => cellText(r, c)));
    if (DATE_COLUMNS.has(c)) {
      return [...set].sort((a, b) => { // วันที่เรียงตามปฏิทิน (ไม่ใช่ตามตัวอักษร) ; ว่างไว้ท้าย
        if (a === '') return 1;
        if (b === '') return -1;
        const ka = dateSortKey(a);
        const kb = dateSortKey(b);
        return ka !== null && kb !== null ? ka - kb : a.localeCompare(b);
      });
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  };
  const setColFilter = (c, nextSet, total) => {
    setColumnFilters((prev) => {
      const n = { ...prev };
      if (!nextSet || nextSet.size >= total) delete n[c]; else n[c] = nextSet;
      return n;
    });
  };

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
    if (c === 'tax_type') return 'Tax'; // MARKER_VATRECONCILE_PCT_N_ROWS_FRONT_V1
    if (c === 'src_account') return 'Account'; // MARKER_VATRECONCILE_SIMPLE_N_MERGE_V1 -- ที่มาของแถว Simple (11610755 / 11610752)
    if (c === 'status' && data.type === 'input_summary' && data.view === 'detail') return 'Status'; // MARKER_VATRECONCILE_STATUS_COL_V1 -- หัวคอลัมน์ตาม Excel
    // MARKER_VATRECONCILE_CLAIM_PERCENT_HEADER_V1 -- BU ที่ใช้สิทธิ์เฉลี่ย (เช่น CFW 59.53%) หัวช่องใช้สิทธิ์เปลี่ยนจาก 100% เป็น % จริงของ BU (หลาย % ในไฟล์เดียว = ตาม % สาขา)
    if (data.type === 'input_summary' && data.view === 'detail' && (c === 'claimed100_amount' || c === 'claimed100_vat') && COLUMN_LABELS[c]) {
      if (data.claim_percent) return COLUMN_LABELS[c].replace('100%', `${data.claim_percent}%`);
      if (data.claim_percent_mixed) return COLUMN_LABELS[c].replace('100%', 'ตาม % สาขา');
    }
    return COLUMN_LABELS[c] || c;
  };

  const statusColor = (status) => {
    if (status === 'Balance') return { bg: '#dafbe1', color: '#1a7f37' }; // MARKER_VATRECONCILE_STATUS_COL_V1
    if (status === 'Futuredate') return { bg: '#fff3cd', color: '#856404' };
    if (status === 'Over Period') return { bg: '#ffe5e5', color: '#cf222e' };
    if (status === 'Expired') return { bg: '#e8e8ee', color: '#5a2d82' }; // MARKER_VATRECONCILE_EXPIRED_V1
    if (status === 'Unbalance') return { bg: '#fff1e0', color: '#bc4c00' };
    if (status === 'ตรงกัน') return { bg: '#dafbe1', color: '#1a7f37' };
    if (status === 'ไม่ตรงกัน') return { bg: '#fff1e0', color: '#bc4c00' };
    return { bg: '#f2f2f2', color: '#666' }; // ไม่มี TB / ไม่มี Input Summary
  };

  // ความกว้างแต่ละ Column วัดจากข้อความจริงด้วย Canvas (หัวและตัวตารางใช้ชุดเดียวกัน เพื่อให้ตรงกันเป๊ะ)
  let colW = widthCacheRef.current.rows === data.rows && widthCacheRef.current.w && widthCacheRef.current.w.length === columns.length
    ? widthCacheRef.current.w : null;
  if (!colW) {
    const cv = document.createElement('canvas').getContext('2d');
    const fam = window.getComputedStyle(document.body).fontFamily || 'sans-serif';
    const measure = (t, bold) => { cv.font = `${bold ? '600 ' : ''}13px ${fam}`; return cv.measureText(t).width; };
    const sample = localRows.slice(0, 400);
    colW = columns.map((c) => {
      const headW = measure(getLabel(c), true) + 72;
      let cellW = 0;
      for (const r of sample) {
        const t = cellText(r, c);
        if (t) cellW = Math.max(cellW, measure(t, c === 'branch') + 26);
      }
      const num = isNumericColumn(c);
      const cap = num ? 420 : Math.max(headW, 280);
      return Math.round(Math.max(70, Math.min(Math.max(headW, cellW), cap)));
    });
    widthCacheRef.current = { rows: data.rows, w: colW };
  }
  const totalW = colW.reduce((a, x) => a + x, 0) + (onRowAction ? 90 : 0);
  const tblStyle = { width: totalW, minWidth: '100%', tableLayout: 'fixed', fontSize: 13, borderCollapse: 'collapse', border: '1px solid #d0d7de' };
  const colgroup = (
    <colgroup>
      {columns.map((c, i) => <col key={c} style={{ width: colW[i] }} />)}
      {onRowAction && <col style={{ width: 90 }} />}
    </colgroup>
  );

  // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_FIXED_HEADER_V1 -- ส่วนบน (สรุป/Filter/คำใบ้) ตรึงอยู่กับที่ มีเฉพาะตารางที่ Scroll (หัว Column จึงไม่ถูกดันขึ้นตาม)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0 }}>
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
            {/* MARKER_VATRECONCILE_BRANCH_SELECT_COUNT_V1 -- ตัวเลขใน () ต้องเป็นจำนวน "สาขา" จริง ไม่ใช่จำนวนแถว; แต่ละสาขาบอกจำนวนรายการของตัวเอง */}
            <option value="">ทั้งหมด ({branchOptions.length} สาขา · {localRows.length} รายการ)</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>{b} ({localRows.filter((r) => String(r.branch) === String(b)).length} รายการ)</option>
            ))}
          </select>
          {branchFilter && (
            <span style={{ fontSize: 12, color: '#57606a' }}>พบ {filteredRows.length} รายการ</span>
          )}
        </div>
      )}

      {data.type === 'input_summary' && data.view === 'detail' && filteredRows.length > 0 && typeof filteredRows[0].id !== 'undefined' && (
        // samplingOpen === undefined = หน้า Preview อื่นๆ แสดงแผงแบบเดิม | มีค่า (true/false) = ปุ่ม Sampling ที่แถบล่างของ Reconcile Panel เปิด Popup (วาดซ้อนใน Popup Reconcile ผ่าน sampleHost)
        samplingOpen === undefined
          ? <SubsetSumPanel rows={filteredRows} onPick={(ids) => setHiIds(new Set(ids))} onClear={() => setHiIds(new Set())} />
          : (samplingOpen && sampleHost && createPortal(
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onSamplingClose}>
              <div style={{ background: '#fff', borderRadius: 10, width: 'min(980px, 96%)', maxHeight: '86%', overflowY: 'auto', padding: '14px 18px', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
                <SubsetSumPanel modal onClose={onSamplingClose} rows={filteredRows} onPick={(ids) => setHiIds(new Set(ids))} onClear={() => setHiIds(new Set())} />
              </div>
            </div>,
            sampleHost
          ))
      )}

      {activeFilterCols.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12, color: '#57606a' }}>
          <span>กำลังกรอง {activeFilterCols.length} คอลัมน์ · พบ {filteredRows.length.toLocaleString()} / {localRows.length.toLocaleString()} แถว</span>
          <button
            type="button"
            onClick={() => setColumnFilters({})}
            style={{ fontSize: 12, color: '#1a56db', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}

      {/* MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- ห่อด้วย div ที่ Focus ได้ เพื่อดักจับ Ctrl+C (Copy ช่วงที่ Drag-Select ไว้) */}
      {(() => { // MARKER_VATRECONCILE_TAX_CHIPS_V1 -- ปุ่มกรอง Tax Type: แสดงเมื่อมีมากกว่า 1 ชนิด
        const types = [...new Set(localRows.map((r) => (r.tax_type == null ? '' : String(r.tax_type))).filter(Boolean))].sort();
        if (!columns.includes('tax_type') || types.length < 2) return null;
        const chip = (val, label) => (
          <button key={label} type="button" onClick={() => setTaxSel(val)} style={{ padding: '3px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 999, cursor: 'pointer', border: `1px solid ${taxSel === val ? '#0969da' : '#d0d7de'}`, background: taxSel === val ? '#0969da' : '#fff', color: taxSel === val ? '#fff' : '#24292f' }}>{label}</button>
        );
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 8px' }}>
            <span style={{ fontSize: 12, color: '#57606a', marginRight: 2 }}>Tax</span>
            {chip('', 'All')}
            {types.map((t) => chip(t, t))}
          </div>
        );
      })()}
      </div>
      <div ref={hdrRef} style={{ overflow: 'hidden', flexShrink: 0, marginRight: sbw }}>
      <table style={tblStyle}>
        {colgroup}
        <thead>
          <tr>
            {columns.map((c, colIdx) => (
              <th
                key={c}
                title={`${COLUMN_TOOLTIPS[c] || getLabel(c)} — คลิกเพื่อ Filter`}
                onClick={(e) => openFilterFor(e, c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol((h) => (h === c ? null : h))}
                style={{
                  // MARKER_VATRECONCILEDASHBOARD_BIG_FILTER_TARGET_V1 -- คลิกได้ทั้งช่องหัว Column (ไม่ใช่แค่ลูกศรเล็กๆ) + ลูกศรใหญ่ขึ้น + Hover ไฮไลต์
                  background: hoverCol === c || openFilter?.col === c ? 'linear-gradient(180deg, #dde9fd, #cddff9)' : 'linear-gradient(180deg, #eef4ff, #e3ecfb)',
                  textAlign: isSimpleReport ? 'center' : (isNumericColumn(c) ? 'right' : 'left'),
                  padding: '13px 12px', color: '#334155', fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: '1px solid #d0d7de', cursor: 'pointer', userSelect: 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{getLabel(c)}</span>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0, fontSize: 14, lineHeight: 1, padding: '5px 8px', borderRadius: 5,
                      color: columnFilters[c] ? '#fff' : '#475569',
                      background: columnFilters[c] ? '#1a56db' : (hoverCol === c ? '#bcd0f0' : '#dbe5f6'),
                    }}
                  >
                    {columnFilters[c] ? '⏷' : (sortSpec && sortSpec.col === c ? (sortSpec.dir === 'asc' ? '↑' : '↓') : '▾')}
                  </span>
                </span>
              </th>
            ))}
            {onRowAction && (
              <th style={{
                background: 'linear-gradient(180deg, #eef4ff, #e3ecfb)',
                textAlign: isSimpleReport ? 'center' : 'left',
                padding: '13px 12px', color: '#334155', fontWeight: 600,
                border: '1px solid #d0d7de', whiteSpace: 'nowrap',
              }}>
                Action
              </th>
            )}
          </tr>
        </thead>
      </table>
      </div>
      <div
        ref={gridRef}
        tabIndex={isEditable ? 0 : -1}
        onKeyDown={handleGridKeyDown}
        onScroll={(e) => { if (hdrRef.current) hdrRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
        style={{ outline: 'none', flex: 1, minHeight: 0, overflow: 'auto' }}
      >
      <table style={tblStyle}>
        {colgroup}
        <tbody>
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (onRowAction ? 1 : 0)} style={{ padding: '16px 4px', textAlign: 'center', color: '#999', border: '1px solid #eaeef2' }}>
                ไม่พบข้อมูลตรงกับตัวกรอง
              </td>
            </tr>
          )}
          {filteredRows.map((r, i) => (
            <tr key={i} style={{ background: hiIds.has(r.id) ? '#fff3bf' : (() => { /* MARKER_VATRECONCILE_FUTURE_ROW_ORANGE_V1 -- แถวที่ Receive Date < Tax Invoice Date (Future Date) ไฮไลต์ทั้งแถวสีส้ม */ const _rc = toIsoDay(r.receive_date); const _iv = toIsoDay(r.tax_invoice_date); if (r.status === 'Expired') return '#e9defa'; /* MARKER_VATRECONCILE_EXPIRED_V1 */ return (_rc && _iv && _rc < _iv && !(okBranches && okBranches.has(String(r.branch))) && (!futureBranches || futureBranches.has(r.id))) ? '#ffd9a8' : null; })() || (i % 2 === 0 ? '#fff' : '#fafbfc') }}>
              {columns.map((c, colIdx) => {
                // MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1
                const selected = isEditable && isCellSelected(i, colIdx);
                const isEditingThis = isEditable && editingCell && editingCell.rowId === r.id && editingCell.col === c;
                const cellHandlers = isEditable ? {
                  'data-r': i,
                  'data-c': colIdx,
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
                        onBlur={() => commitEdit()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? undefined : 'down'); }
                          else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
                          else if (e.key === 'Escape') { e.preventDefault(); endEdit(); }
                        }}
                        style={{ width: '100%', fontSize: 12.5, padding: '6px 8px', border: '1px solid #1a56db', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </td>
                  );
                }

                if (c === 'tax_type') { // MARKER_VATRECONCILE_PCT_N_ROWS_FRONT_V1 -- ป้าย Tax Type หน้าสุด (N ในหัว % = สีแดง)
                  const isN = !!r.is_n;
                  return (
                    <td key={c} {...cellHandlers} title={isN ? 'Input N — ใช้สิทธิ์ 100% (แยกตาม Tax Code จากไฟล์ All Type)' : `Tax Type ${r[c] || ''}`} style={{ padding: '8px 6px', border: '1px solid #eaeef2', textAlign: 'center', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: (isEditable && rangeDragging) ? 'none' : 'text' }}>
                      <span style={{ display: 'inline-block', minWidth: 22, padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: '#eef1f4', color: '#57606a' }}>{r[c] || '-'}</span>
                    </td>
                  );
                }
                if (c === 'status') {
                  const sc = statusColor(r[c]);
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', border: '1px solid #eaeef2', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: (isEditable && rangeDragging) ? 'none' : 'text' }}>
                      <span style={{ background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                        {r[c]}
                      </span>
                    </td>
                  );
                }
                if (c === 'branch') {
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', fontWeight: 600, color: '#24292f', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: (isEditable && rangeDragging) ? 'none' : 'text' }}>
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
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: (isEditable && rangeDragging) ? 'none' : 'text' }}>
                      {hasVal ? String(rawVal).padStart(5, '0') : ''}
                    </td>
                  );
                }
                if (c === 'tax_id' || c === 'company_tax_id') {
                  return (
                    <td key={c} {...cellHandlers} style={{ padding: '8px 12px', color: '#57606a', border: '1px solid #eaeef2', whiteSpace: 'nowrap', background: selBg, cursor: isEditable ? 'cell' : 'default', userSelect: (isEditable && rangeDragging) ? 'none' : 'text' }}>
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
                    userSelect: (isEditable && rangeDragging) ? 'none' : 'text',
                  }}>
                    {DATE_COLUMNS.has(c) ? fmtDdMmmYy(r[c]) : isNum ? numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(r[c] ?? '')}
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

      {openFilter && (() => {
        const c = openFilter.col;
        const all = allValuesOf(c);
        const q = filterSearch.trim().toLowerCase();
        const visible = all.filter((v) => !q || v.toLowerCase().includes(q));
        const cur = columnFilters[c]; // Set | undefined (undefined = เลือกทั้งหมด)
        const isChecked = (v) => !cur || cur.has(v);
        const LIMIT = 500;
        const shown = visible.slice(0, LIMIT);
        const allVisibleChecked = visible.length > 0 && visible.every(isChecked);
        const toggleOne = (v) => {
          const next = new Set(cur || all);
          if (next.has(v)) next.delete(v); else next.add(v);
          setColFilter(c, next, all.length);
        };
        const toggleAllVisible = () => {
          const next = new Set(cur || all);
          if (allVisibleChecked) visible.forEach((v) => next.delete(v)); else visible.forEach((v) => next.add(v));
          setColFilter(c, next, all.length);
        };
        // MARKER_VATRECONCILEDASHBOARD_DATE_TREE_FILTER_V1 -- Filter วันที่แบบ Excel: ต้นไม้ ปี > เดือน > วัน (ติ๊กระดับปี/เดือนเลือกทั้งกลุ่ม) ; ถ้าพิมพ์ Search จะกลับเป็นรายการวันที่แบบเรียบ
        const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const isDateTree = DATE_COLUMNS.has(c) && !q;
        const blankInAll = all.includes('');
        const dateTree = [];
        if (isDateTree) {
          const yMap = new Map();
          all.forEach((t) => {
            const p = parseDdMmmYy(t);
            if (!p) return;
            if (!yMap.has(p.y)) yMap.set(p.y, new Map());
            const mMap = yMap.get(p.y);
            if (!mMap.has(p.m)) mMap.set(p.m, []);
            mMap.get(p.m).push({ t, d: p.d });
          });
          [...yMap.keys()].sort((a, b) => a - b).forEach((y) => {
            const months = [...yMap.get(y).keys()].sort((a, b) => a - b).map((m) => {
              const days = yMap.get(y).get(m).sort((a, b) => a.d - b.d);
              return { m, days, leaves: days.map((x) => x.t) };
            });
            dateTree.push({ y, months, leaves: months.flatMap((mn) => mn.leaves) });
          });
        }
        const toggleGroup = (leaves) => {
          const next = new Set(cur || all);
          const allOn = leaves.every((t) => next.has(t));
          leaves.forEach((t) => { if (allOn) next.delete(t); else next.add(t); });
          setColFilter(c, next, all.length);
        };
        const toggleOpen = (key, isOpenNow) => {
          const base = dateOpen ? new Set(dateOpen) : new Set(dateTree.map((yn) => `y${yn.y}`));
          if (isOpenNow) base.delete(key); else base.add(key);
          setDateOpen(base);
        };
        const renderTreeRow = (key, label, leaves, level, isOpen) => {
          const onCount = leaves.filter(isChecked).length;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', paddingLeft: level * 18, fontSize: 12.5, color: '#24292f' }}>
              <button type="button" onClick={() => toggleOpen(key, isOpen)} style={{ width: 18, border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#57606a', fontSize: 11 }}>{isOpen ? '▼' : '▶'}</button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                <input
                  type="checkbox"
                  checked={onCount === leaves.length}
                  ref={(el) => { if (el) el.indeterminate = onCount > 0 && onCount < leaves.length; }}
                  onChange={() => toggleGroup(leaves)}
                  style={{ flexShrink: 0 }}
                />
                <span style={{ fontWeight: level === 0 ? 600 : 500 }}>{label}</span>
              </label>
            </div>
          );
        };
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 1200 }} onMouseDown={() => setOpenFilter(null)} />
            <div
              style={{
                position: 'fixed', top: openFilter.top, left: openFilter.left, width: 280, zIndex: 1201,
                background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.22)',
                display: 'flex', flexDirection: 'column', maxHeight: 'min(420px, 70vh)',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eaeef2', fontSize: 12, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setColFilter(c, null, all.length)}
                  disabled={!cur}
                  style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: cur ? '#1a56db' : '#9aa4b2', cursor: cur ? 'pointer' : 'default' }}
                >
                  ล้าง Filter
                </button>
                <button type="button" onClick={() => setOpenFilter(null)} style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#57606a', cursor: 'pointer' }}>
                  ปิด
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, padding: '8px 12px 0', flexShrink: 0 }}>
                {[{ dir: 'asc', label: DATE_COLUMNS.has(c) ? '↑ เก่า → ใหม่' : '↑ A → Z' }, { dir: 'desc', label: DATE_COLUMNS.has(c) ? '↓ ใหม่ → เก่า' : '↓ Z → A' }].map((o) => {
                  const on = sortSpec && sortSpec.col === c && sortSpec.dir === o.dir;
                  return (
                    <button
                      key={o.dir}
                      type="button"
                      onClick={() => setSortSpec(on ? null : { col: c, dir: o.dir })}
                      style={{ flex: 1, fontSize: 12, padding: '5px 6px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? '#1a56db' : '#d0d7de'}`, background: on ? '#e8f0fe' : '#fff', color: on ? '#1a56db' : '#24292f', fontWeight: on ? 600 : 400 }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ padding: '8px 12px 4px', flexShrink: 0 }}>
                <input
                  autoFocus
                  type="text"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Search"
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid #d0d7de' }}
                />
              </div>
              <div style={{ overflowY: 'auto', padding: '4px 12px 8px', flex: 1, minHeight: 0 }}>
                {visible.length === 0 && <p style={{ fontSize: 12.5, color: '#999', textAlign: 'center', margin: '12px 0' }}>ไม่พบรายการ</p>}
                {visible.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, fontWeight: 600, borderBottom: '1px solid #f0f2f5', cursor: 'pointer' }}>
                    <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} />
                    (เลือกทั้งหมด{q ? ' ที่ค้นหา' : ''}) · {visible.length.toLocaleString()}
                  </label>
                )}
                {isDateTree ? (
                  <>
                    {dateTree.map((yn) => {
                      const yKey = `y${yn.y}`;
                      const yOpen = dateOpen ? dateOpen.has(yKey) : true;
                      return (
                        <div key={yKey}>
                          {renderTreeRow(yKey, String(yn.y), yn.leaves, 0, yOpen)}
                          {yOpen && yn.months.map((mn) => {
                            const mKey = `m${yn.y}-${mn.m}`;
                            const mOpen = dateOpen ? dateOpen.has(mKey) : false;
                            return (
                              <div key={mKey}>
                                {renderTreeRow(mKey, MONTH_FULL[mn.m - 1], mn.leaves, 1, mOpen)}
                                {mOpen && mn.days.map((dn) => (
                                  <label key={dn.t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 44px', fontSize: 12.5, color: '#24292f', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={isChecked(dn.t)} onChange={() => toggleOne(dn.t)} style={{ flexShrink: 0 }} />
                                    <span>{dn.t}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {blankInAll && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, color: '#24292f', cursor: 'pointer' }}>
                        <input type="checkbox" checked={isChecked('')} onChange={() => toggleOne('')} style={{ flexShrink: 0 }} />
                        <span>(ว่าง)</span>
                      </label>
                    )}
                  </>
                ) : shown.map((v) => (
                  <label key={v === '' ? '__blank__' : v} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', fontSize: 12.5, color: '#24292f', cursor: 'pointer', wordBreak: 'break-word' }}>
                    <input type="checkbox" checked={isChecked(v)} onChange={() => toggleOne(v)} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>{v === '' ? '(ว่าง)' : v}</span>
                  </label>
                ))}
                {visible.length > LIMIT && (
                  <p style={{ fontSize: 11.5, color: '#999', margin: '6px 0 0' }}>แสดง {LIMIT} จาก {visible.length.toLocaleString()} รายการ — พิมพ์ค้นหาเพื่อกรองเพิ่ม</p>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}