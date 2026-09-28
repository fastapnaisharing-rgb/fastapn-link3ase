import React, { useState, useEffect, useCallback } from 'react';
import ReconcileZoneLayout from './ReconcileZoneLayout';

// ══════════════════════════════════════════════════════════════════════════
// GLFunctionalController.js — Module Controller ของ GL Functional
// ══════════════════════════════════════════════════════════════════════════
// โครงสร้างเดียวกับ VatController.js/IEController.js — รับ activeSubTab แล้ว
// Route เนื้อหาภายในเอง (ไม่ต้องเพิ่ม case ใหม่ใน App.js ทุกครั้งที่เพิ่ม Sub-menu
// ในอนาคต — แก้ Switch ที่นี่ที่เดียวพอ เหมือน Pattern เดิมของ VAT)
//
// ตอนนี้มีแค่ 1 Sub-menu: gl-ap-recon (Account Payable Recon.)
//
// MARKER_GL_FUNCTIONAL_CONTROLLER_V4 — ต่อ Data จริงแล้ว (2026-09-27):
//   - buRows: Fetch จาก GET /ap-reconcile/dashboard/status?period=YYYY-MM ทุกครั้งที่
//     เปลี่ยน Period (Endpoint นี้ Deploy ขึ้น Production แล้ว)
//   - fileJobs: Fetch จาก GET /file-storage/ap-reconcile-jobs?scope=mine|all ทุกครั้งที่
//     สลับ My Job/All Job Toggle ใน File Storage Zone (Endpoint นี้ก็ Deploy แล้ว)
//   - Download: เรียก GET /file-storage/:id/download (Endpoint Generic เดิมที่มีอยู่แล้ว)
//   - reportLabel/accounts ต่อไฟล์ยัง Derive จากชื่อไฟล์แบบคร่าวๆ (ดู
//     deriveJobDisplay ใน ReconcileZoneLayout.js) เพราะตาราง file_storage ยังไม่มี
//     Column บอก Report Type/Account ตรงๆ — จะแม่นขึ้นเมื่อ /generate ของจริงของ
//     ap-reconcile ถูกสร้าง (ตอนนี้ปุ่ม Export ยังเป็น Placeholder รอ Macro/Template)
// ══════════════════════════════════════════════════════════════════════════

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

function authHeaders() {
  const token = sessionStorage.getItem('fastapn_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
  return data;
}

// รหัสบัญชีตาม Whitelist จริงที่เจอในโค้ด VBA (Z_Option_TB_Cutting_for_Reconcile)
// แบ่งเป็น 2 กลุ่มตามที่ผู้ใช้ยืนยัน: AP Reconcile (52/54/84/85) กับ IE Reconcile (100/220)
const AP_ACCOUNT_GROUPS = [
  {
    key: 'ap',
    label: 'AP Reconcile',
    accounts: [
      { code: '21930052', label: 'Trade Payable' },
      { code: '21930054', label: 'Trade Payable 2' },
      { code: '21930084', label: 'Cancel Cheque' },
      { code: '21930085', label: 'Cancel Cheque 2' },
    ],
  },
  {
    key: 'ie',
    label: 'IE Reconcile',
    accounts: [
      { code: '21930100', label: 'Other Payable' },
      { code: '21930220', label: 'AP Misc' },
    ],
  },
];

// MARKER_PERIOD_FIELD_DEFAULT_BLANK_V2 — List ตัวเลือก PERIOD ไม่ Hardcode ในโค้ดอีกต่อไป
// ดึงจาก GET /ap-reconcile/periods จริง (Distinct Period ที่มีข้อมูล ap_cutting_staging อยู่)
// Default period = '' (ค่าว่าง "-") จนกว่าผู้ใช้จะเลือกเอง — และตอน Period ว่าง ต้อง Clear
// buRows ทิ้งด้วย (Root Cause ของปัญหา "ค้างข้อมูล Period เก่า" ที่เจอตอน V1 คือ Skip Fetch
// เฉยๆ แต่ไม่ได้ Clear State เก่าทิ้ง)
export default function GLFunctionalController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const [period, setPeriod] = useState('');
  const [periodOptions, setPeriodOptions] = useState([]);
  const [periodOptionsError, setPeriodOptionsError] = useState('');

  const [buRows, setBuRows] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');

  const [fileJobsScope, setFileJobsScope] = useState('mine');
  const [fileJobs, setFileJobs] = useState([]);
  const [fileJobsLoading, setFileJobsLoading] = useState(false);
  const [fileJobsError, setFileJobsError] = useState('');

  // ── List Period จริงจาก DB (ดึงครั้งเดียวตอน Mount) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchJson('/ap-reconcile/periods')
      .then((data) => { if (!cancelled) setPeriodOptions(data.periods || []); })
      .catch((err) => { if (!cancelled) setPeriodOptionsError(err.message); });
    return () => { cancelled = true; };
  }, []);

  // ── Dashboard: ดึงสถานะจริงตาม Period — ถ้า Period ว่าง Clear ตารางทิ้งเลย ────
  useEffect(() => {
    if (!period) { setBuRows([]); setDashboardError(''); setDashboardLoading(false); return; }
    let cancelled = false;
    setDashboardLoading(true);
    setDashboardError('');
    fetchJson(`/ap-reconcile/dashboard/status?period=${encodeURIComponent(period)}`)
      .then((data) => { if (!cancelled) setBuRows(data.bu_rows || []); })
      .catch((err) => { if (!cancelled) { setDashboardError(err.message); setBuRows([]); } })
      .finally(() => { if (!cancelled) setDashboardLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  // ── File Storage: ดึงรายการไฟล์จริงตาม Scope (mine/all) ────────────────
  const loadFileJobs = useCallback((scope) => {
    let cancelled = false;
    setFileJobsLoading(true);
    setFileJobsError('');
    fetchJson(`/file-storage/ap-reconcile-jobs?scope=${scope}`)
      .then((data) => { if (!cancelled) setFileJobs(Array.isArray(data) ? data : []); })
      .catch((err) => { if (!cancelled) { setFileJobsError(err.message); setFileJobs([]); } })
      .finally(() => { if (!cancelled) setFileJobsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cancel = loadFileJobs(fileJobsScope);
    return cancel;
  }, [fileJobsScope, loadFileJobs]);

  const handleFileDownload = useCallback(async (jobId, _code) => {
    try {
      const res = await fetch(`${API_BASE}/file-storage/${jobId}/download`, { headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const fileName = match ? match[1] : `download-${jobId}`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err.message || 'ดาวน์โหลดไม่สำเร็จ');
    }
  }, []);

  const errorBanner = dashboardError || fileJobsError || periodOptionsError
    ? (
      <div style={{ margin: '0 24px', padding: '8px 14px', background: '#fdedee', color: '#cf222e', border: '1px solid #f1c2c6', borderRadius: 8, fontSize: 12.5 }}>
        {periodOptionsError && <div>Period: {periodOptionsError}</div>}
        {dashboardError && <div>Dashboard: {dashboardError}</div>}
        {fileJobsError && <div>File Storage: {fileJobsError}</div>}
      </div>
    )
    : null;

  switch (activeSubTab) {
    case 'gl-ap-recon':
    default:
      return (
        <>
          {errorBanner}
          <ReconcileZoneLayout
            accountGroups={AP_ACCOUNT_GROUPS}
            periodOptions={periodOptions}
            period={period}
            onPeriodChange={setPeriod}
            buRows={buRows}
            fileJobs={fileJobs}
            fileJobsLoading={fileJobsLoading}
            fileJobsScope={fileJobsScope}
            onFileJobsScopeChange={setFileJobsScope}
            onFileDownload={handleFileDownload}
          />
        </>
      );
  }
}
