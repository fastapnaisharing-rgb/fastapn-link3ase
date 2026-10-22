import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReconcileZoneLayout from './ReconcileZoneLayout';
import { confirmDialog } from '../confirmDialog'; // MARKER_APRECONCILE_REPORT_DELETE_V1
import { useRealtimeRefresh } from '../useRealtimeRefresh'; // MARKER_APRECONCILE_REALTIME_V1
import { broadcastWs } from '../wsManager'; // MARKER_APRECONCILE_REALTIME_V1

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

// MARKER_APRECONCILE_REALTIME_V1 -- แจ้งทุก Client (ทุก User) ว่ารายการไฟล์ My Job / All Job เปลี่ยน: Event ไม่มีข้อมูลไฟล์ติดไป แต่ละเครื่องดึงรายการใหม่เองจาก Endpoint เดิม ซึ่ง Backend กรองสิทธิ์ให้อยู่แล้ว (My Job = ของตัวเอง | All Job = Owner ทั้งหมด / Admin เฉพาะของ User ที่มีสิทธิ์เดียวกัน)
const notifyApFilesChanged = () => { try { broadcastWs('ap_reconcile_files_changed', {}); } catch (_) { /* ไม่มี WS -> ข้าม (Poll สำรองกวาดให้) */ } };

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

// MARKER_APRECONCILE_SP_SEND_V1 -- Confirm ไฟล์ AP Recon = ส่งไป SharePoint อัตโนมัติ (เว็บโหลดไฟล์ลง Downloads -> Handler fastapn-sp:// ย้ายเข้าโฟลเดอร์ Z_Report Reconcile - Account Payable ที่ซิงก์ OneDrive)
// เลข BU + เดือน อ่านจากชื่อไฟล์ {เลข BU}_{BU}_{Account}_{MON-YY}[ No Data].xlsx (อ่านไม่ได้ = ไม่ส่ง) | ปลายทาง: <โฟลเดอร์ AP>\<เลข BU>\<YYYY.MM>\<ชื่อไฟล์>
const SP_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function parseApSpTarget(fileName) {
  const m = /^(\d{3,6})_.+_([A-Za-z]{3})-(\d{2})(?: No Data)?\.xlsx$/i.exec(String(fileName || ''));
  if (!m) return null;
  const mi = SP_MONTHS.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  return { buCode: m[1], period: `20${m[3]}.${String(mi + 1).padStart(2, '0')}` };
}
function spReportParams() { // MARKER_APRECONCILE_SP_REPORT_TOKEN_V1
  try {
    const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
    const token = sessionStorage.getItem('fastapn_token') || '';
    return token ? `&api=${encodeURIComponent(apiRoot)}&token=${encodeURIComponent(token)}` : '';
  } catch (_) { return ''; }
}
function launchApSpHandler(action, fileName, t) { // action = send | delete | fileName = ชื่อไฟล์ หรือ Array ชื่อไฟล์ (ส่งหลายไฟล์ใน URI เดียว -- Handler v9 ขึ้นไป)
  const list = Array.isArray(fileName) ? fileName : [fileName]; // MARKER_APRECONCILE_SP_MULTI_SEND_V1 -- name= ไฟล์แรก (เครื่อง Handler v8 ยังส่งไฟล์แรกได้) + names= ทุกไฟล์ คั่นด้วย | (v9)
  const uri = `fastapn-sp://${action}?name=${encodeURIComponent(list[0])}${list.length > 1 ? `&names=${encodeURIComponent(list.join('|'))}` : ''}&bu=${encodeURIComponent(t.buCode)}&period=${encodeURIComponent(t.period)}&dest=recon${spReportParams()}`; // MARKER_APRECONCILE_SP_REPORT_TOKEN_V1 -- แนบ api+token ให้ Handler รายงานเวอร์ชันกลับ Backend ทุกครั้งที่ใช้งาน (แจ้งเตือน Home จะรู้ว่าติดตั้งแล้ว) | MARKER_APRECONCILE_SP_DEST_RECON_V1 -- AP ใช้โฟลเดอร์เดียวกับ VAT (Z_Report Reconcile) ไม่ต้องตั้งปลายทาง 'ap' แยก
  const a = document.createElement('a');
  a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
}

// MARKER_APRECONCILE_SP_DELETE_MANY_V1 -- ลบหลายไฟล์ใน SharePoint ด้วย URI เดียว (delete?items=a/b/c|... ของ Handler v6+) ยืนยันครั้งเดียว | เดิมยิงทีละไฟล์ต่อกัน -> เบราว์เซอร์ทิ้งบางคำสั่ง (ไฟล์ค้าง) และหน้าต่างถามซ้อนหลายใบ
function launchApSpDeleteMany(fileNames, silent) { // silent = true: ไม่ถาม/ไม่แจ้งเตือน (ใช้ตอน Release ที่ผู้ใช้ยืนยันในเว็บแล้ว | ต้อง Handler ที่รองรับ silent=1)
  const rels = [];
  for (const n of fileNames || []) { const t = parseApSpTarget(n); if (t) rels.push(`${t.buCode}/${t.period}/${n}`); }
  if (!rels.length) return;
  const uri = `fastapn-sp://delete?items=${encodeURIComponent(rels.join('|'))}&dest=recon${silent ? '&silent=1' : ''}`;
  const a = document.createElement('a');
  a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
}

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
  const dashSilentRef = useRef(false); // MARKER_APRECONCILE_REALTIME_V1 -- รีเฟรชจาก Event/Poll = ไม่กะพริบ (ไม่ขึ้น Loading / ไม่ล้างตารางเดิม)
  const [dashTick, setDashTick] = useState(0); // MARKER_DASHBOARD_AP_CLEAR_V1 -- สั่งโหลด Dashboard ใหม่หลังล้างข้อมูล
  const [dashboardError, setDashboardError] = useState('');

  const [fileJobsScope, setFileJobsScope] = useState('mine');
  const [fileJobs, setFileJobs] = useState([]);
  const [fileJobsLoading, setFileJobsLoading] = useState(false);
  const [fileJobsError, setFileJobsError] = useState('');

  // MARKER_APRECON_SP_HANDLER_TOAST_V1 -- Popup มุมขวาล่าง แจ้ง SharePoint Handler เวอร์ชันเก่า/ยังไม่ได้ติดตั้ง (ขึ้นทันทีที่มีเวอร์ชันใหม่ ไม่รอ 7 วัน) -- ใช้ Key ปิด/อัปเดตร่วมกับหน้า Home
  const [spToast, setSpToast] = useState(null);
  const [spMissing, setSpMissing] = useState(false); // MARKER_APRECONCILE_SP_SETTING_V1 -- Backend ไม่เคยเห็น Handler ของ User นี้ = Confirm/Release ใช้ไม่ได้
  const spLoadRef = useRef(null);
  const [spDest, setSpDest] = useState({ checked: false, ok: true, path: '' }); // MARKER_APRECONCILE_SP_DEST_CHECK_V1 -- ผลที่ Handler ตรวจโฟลเดอร์ปลายทางในเครื่อง (รายงานกลับ Backend)
  const [spChecking, setSpChecking] = useState(false);
  const loadSpDest = useCallback(async () => {
    try { const d = await fetchJson('/ap-reconcile/sp-dest-status'); setSpDest({ checked: !!d.checked, ok: d.ok !== false, path: d.path || '', at: d.checked_at || '' }); return d; } catch (_) { return null; }
  }, []);
  useEffect(() => { loadSpDest(); }, [loadSpDest]);
  const spDownload = useCallback(async () => { // MARKER_APRECONCILE_SP_SETTING_V1 -- ดาวน์โหลดชุดติดตั้ง Handler (zip) จาก GET /api/file-storage/sp-handler
    try {
      const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token') || '';
      const r = await fetch(`${apiRoot}/api/file-storage/sp-handler`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error || `HTTP ${r.status}`); }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'fastapn-sp-handler.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { window.alert(`ดาวน์โหลดตัวติดตั้งไม่สำเร็จ: ${e.message || e}`); }
  }, []);
  const spCheckFolder = useCallback(async () => {
    setSpChecking(true);
    try {
      const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token') || '';
      const before = spDest.at || '';
      const a = document.createElement('a'); a.href = `fastapn-sp://check?dest=recon&api=${encodeURIComponent(apiRoot)}&token=${encodeURIComponent(token)}`; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      for (let i = 0; i < 8; i += 1) { // รอ Handler รายงานกลับ (สูงสุด ~12 วินาที)
        await new Promise((r) => setTimeout(r, 1500));
        const d = await loadSpDest();
        if (d && d.checked && String(d.checked_at || '') !== before) break;
      }
      if (spLoadRef.current) spLoadRef.current();
    } finally { setSpChecking(false); }
  }, [spDest.at, loadSpDest]);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
        const token = sessionStorage.getItem('fastapn_token') || '';
        const res = await fetch(`${apiRoot}/api/file-storage/sp-handler/my-status`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || stop) return;
        const d = await res.json();
        if (!stop) setSpMissing(d.installed === false); // ติดตั้ง Handler หรือยัง (โฟลเดอร์ปลายทางดู spDest)
        let snoozed = false;
        try { snoozed = Number(localStorage.getItem('fastapn_sp_toast_snooze') || 0) > Date.now(); } catch (_) { /* เงียบ */ }
        let hideUntil = 0;
        try { const u = JSON.parse(localStorage.getItem('fastapn_sp_updated') || 'null'); if (u && Number(u.v) >= Number(d.latest || 0)) hideUntil = Number(u.at || 0) + 24 * 3600 * 1000; } catch (_) { /* เงียบ */ }
        if (stop || snoozed) { if (snoozed) setSpToast(null); return; }
        if (d.installed === false) { setSpToast({ kind: 'missing', latest: d.latest }); return; }
        const old = Array.isArray(d.outdated) && d.outdated.length > 0 && Date.now() > hideUntil;
        setSpToast(old ? { kind: 'outdated', latest: d.latest, from: d.outdated[0].version } : null);
      } catch (_) { /* เงียบ */ }
    };
    spLoadRef.current = load;
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(iv); };
  }, []);
  const spToastClose = () => { try { localStorage.setItem('fastapn_sp_toast_snooze', String(Date.now() + 86400000)); } catch (_) { /* เงียบ */ } setSpToast(null); };
  const spToastUpdate = () => {
    try {
      const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token') || '';
      window.location.href = `fastapn-sp://update?v=${spToast?.latest || ''}&api=${encodeURIComponent(apiRoot)}&token=${encodeURIComponent(token)}`;
      try { localStorage.setItem('fastapn_sp_updated', JSON.stringify({ v: Number(spToast?.latest || 0), at: Date.now() })); } catch (_) { /* เงียบ */ }
      setSpToast(null);
    } catch (_) { /* เงียบ */ }
  };

  // ── List Period จริงจาก DB (ดึงครั้งเดียวตอน Mount) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchJson('/ap-reconcile/periods')
      .then((data) => { if (!cancelled) setPeriodOptions(data.periods || []); })
      .catch((err) => { if (!cancelled) setPeriodOptionsError(err.message); });
    return () => { cancelled = true; };
  }, [dashTick]); // MARKER_APRECONCILE_PERIOD_REFRESH_V1 -- โหลด List Period ใหม่ทุกครั้งที่ข้อมูลเปลี่ยน (อัปโหลดแล้วได้ Period ใหม่ จะขึ้นใน Dropdown ทันที ไม่ต้อง F5)

  // ── Dashboard: ดึงสถานะจริงตาม Period — ถ้า Period ว่าง Clear ตารางทิ้งเลย ────
  useEffect(() => {
    if (!period) { dashSilentRef.current = false; setBuRows([]); setDashboardError(''); setDashboardLoading(false); return; }
    let cancelled = false;
    const silent = dashSilentRef.current; dashSilentRef.current = false; // MARKER_APRECONCILE_REALTIME_V1
    if (!silent) { setDashboardLoading(true); setDashboardError(''); }
    fetchJson(`/ap-reconcile/dashboard/status?period=${encodeURIComponent(period)}`)
      .then((data) => { if (!cancelled) { setBuRows(data.bu_rows || []); if (silent) setDashboardError(''); } })
      .catch((err) => { if (!cancelled && !silent) { setDashboardError(err.message); setBuRows([]); } })
      .finally(() => { if (!cancelled) setDashboardLoading(false); });
    return () => { cancelled = true; };
  }, [period, dashTick]);

  // ── File Storage: ดึงรายการไฟล์จริงตาม Scope (mine/all) ────────────────
  const loadFileJobs = useCallback((scope, silent = false) => { // MARKER_APRECONCILE_REALTIME_V1 -- silent = รีเฟรชเงียบ (Event/Poll) ไม่ขึ้น Loading ไม่ล้างรายการเดิมถ้าพลาด
    let cancelled = false;
    if (!silent) { setFileJobsLoading(true); setFileJobsError(''); }
    fetchJson(`/file-storage/ap-reconcile-jobs?scope=${scope}`)
      .then(async (data) => { // MARKER_APRECONCILE_AP_EXPIRE_V1 -- เติมวันหมดอายุ (Confirm+30 วัน) + จำนวน Line ข้อมูล AP ที่จะถูกลบ ให้คอลัมน์ Expire Date
        let list = Array.isArray(data) ? data : [];
        try {
          const ids = list.filter((j) => j && j.confirmed_at).map((j) => j.id);
          if (ids.length) {
            const info = await fetchJson(`/ap-reconcile/expire-info?ids=${ids.join(',')}`);
            list = list.map((j) => (info && info[j.id] ? { ...j, expire_at: info[j.id].expire_at, expire_lines: info[j.id].lines, expire_purged: info[j.id].purged } : j));
          }
        } catch (_) { /* ไม่มีข้อมูล Expire = แสดง — */ }
        if (!cancelled) setFileJobs(list);
      })
      .catch((err) => { if (!cancelled && !silent) { setFileJobsError(err.message); setFileJobs([]); } })
      .finally(() => { if (!cancelled) setFileJobsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cancel = loadFileJobs(fileJobsScope);
    return cancel;
  }, [fileJobsScope, loadFileJobs]);

  // MARKER_APRECONCILE_REALTIME_V1 -- Auto Refresh แบบ Real-time ทุก User/ทุก Permission: รับ Broadcast (WS) แล้วดึงใหม่ทันที + Poll สำรองทุก 60 วิ (เผื่อ WS หลุด)
  //   Dashboard (ap_reconcile_data_changed: อัปโหลด TB/AP, ล้างข้อมูล, ตั้งค่า AP) = ทุกคนเห็นครบ ไม่กรองตาม Permission
  //   รายการไฟล์ (ap_reconcile_files_changed: Export/Confirm/Release/ลบ) = ดึงจาก Endpoint เดิมที่ Backend กรองสิทธิ์ให้ (My Job ของตัวเอง | All Job เฉพาะ Admin ตามสิทธิ์)
  useRealtimeRefresh(['ap_reconcile_data_changed'], () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    dashSilentRef.current = true; setDashTick((t) => t + 1);
  });
  useRealtimeRefresh(['ap_reconcile_files_changed'], () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    loadFileJobs(fileJobsScope, true);
  });

  const handleFileDownload = useCallback(async (jobId, _code, jobFileName) => {
    try {
      const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${jobId}/download`, { headers: authHeaders() }); // MARKER_APRECONCILE_REPORT_CONFIRM_V1 -- ไฟล์ AP Recon เป็น .xlsx ตรง ๆ + Download ได้เมื่อ Confirm แล้ว
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const star = /filename\*=UTF-8''([^;]+)/.exec(disposition);
      const match = /filename="?([^";]+)"?/.exec(disposition);
      // MARKER_APRECONCILE_DOWNLOAD_FILENAME_V1 -- ใช้ชื่อไฟล์จากแถวใน My Job เป็นหลัก (Browser อ่าน Content-Disposition ข้าม Origin ไม่ได้ถ้า Server ไม่ Expose Header)
      let fileName = jobFileName || `download-${jobId}.xlsx`;
      if (!jobFileName) try { if (star) fileName = decodeURIComponent(star[1]); else if (match) fileName = decodeURIComponent(match[1]); } catch (_) { /* ใช้ชื่อสำรอง */ }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err.message || 'ดาวน์โหลดไม่สำเร็จ');
    }
  }, []);

  // MARKER_APRECONCILE_REPORT_CONFIRM_V1 -- Confirm / Release (เฉพาะไฟล์ของตัวเองใน My Job)
  // MARKER_APRECONCILE_SP_SEND_V1 -- Confirm = จบงาน: ส่งไฟล์ไป SharePoint ให้อัตโนมัติ | Release = ยกเลิก Confirm (ไฟล์ที่ส่งไป SharePoint แล้วไม่ถูกลบ) -- เหมือน VAT Reconcile
  const handleFileConfirm = useCallback(async (job, confirm) => {
    try {
      if (confirm) {
        const ok = await confirmDialog.confirm(`Confirm ไฟล์ ${job.fileName} ?\nถือว่าจบงาน: ระบบจะส่งไฟล์ไป SharePoint ให้อัตโนมัติ\n(ถ้า Export ใหม่ทับไฟล์นี้ ต้อง Confirm ใหม่)`, { title: 'Confirm ไฟล์รายงาน' });
        if (!ok) return;
      } else {
        const okR = await confirmDialog.confirm(`Release ไฟล์ ${job.fileName} ?\nยกเลิกการ Confirm — Download จะถูกล็อกอีกครั้ง และไฟล์จะหายจาก All Job\nและระบบจะลบไฟล์ใน SharePoint ด้วย (กู้คืนได้จาก Recycle Bin ของ SharePoint)`, { title: 'Release ไฟล์รายงาน' }); // MARKER_APRECONCILE_RELEASE_SP_DELETE_V1
        if (!okR) return;
      }
      const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${job.id}/${confirm ? 'confirm' : 'release'}`, { method: 'POST', headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `ทำรายการไม่สำเร็จ (HTTP ${res.status})`);
      loadFileJobs(fileJobsScope);
      notifyApFilesChanged(); // MARKER_APRECONCILE_REALTIME_V1
      if (!confirm) { const spT = parseApSpTarget(job.fileName); if (spT) { try { launchApSpDeleteMany([job.fileName], true); } catch (e) { /* ลบใน SharePoint ไม่สำเร็จ = ไม่กระทบการ Release ในระบบ */ } } } // MARKER_APRECONCILE_RELEASE_SP_DELETE_V1 -- Release = ลบไฟล์ใน SharePoint กลับด้วย
      if (confirm) {
        const t = parseApSpTarget(job.fileName);
        if (!t) { confirmDialog.alert('Confirm แล้ว แต่อ่านเลข BU / เดือน จากชื่อไฟล์ไม่ได้ จึงไม่ส่ง SharePoint', { variant: 'danger' }); return; }
        try {
          await handleFileDownload(job.id, 'all', job.fileName); // เบราว์เซอร์โหลดไฟล์ลง Downloads
          launchApSpHandler('send', job.fileName, t);            // Handler ย้ายเข้าโฟลเดอร์ SharePoint (OneDrive)
        } catch (e) { confirmDialog.alert(`Confirm แล้ว แต่ส่ง SharePoint อัตโนมัติไม่สำเร็จ: ${e?.message || ''}`, { variant: 'danger' }); }
      }
    } catch (err) {
      confirmDialog.alert(err.message || 'ทำรายการไม่สำเร็จ', { variant: 'danger' });
    }
  }, [fileJobsScope, loadFileJobs, handleFileDownload]);

  // MARKER_APRECONCILE_REPORT_DELETE_V1 -- ลบไฟล์ใน My Job (ถาม Confirm ก่อนเสมอ)
  const handleFileDelete = useCallback(async (job) => {
    const ok = await confirmDialog.confirm(
      `ต้องการลบไฟล์นี้ใช่หรือไม่?\n${job.fileName}${job.confirmedAt ? '\n\nหมายเหตุ: ไฟล์นี้ Confirm แล้ว — จะหายจาก All Job และระบบจะลบไฟล์ใน SharePoint ด้วย (ผ่านโฟลเดอร์ OneDrive ในเครื่องนี้ กู้คืนได้จาก Recycle Bin ของ SharePoint)' : ''}\n\nลบแล้วกู้คืนไม่ได้ (Export ใหม่ได้จาก Preview)`,
      { title: 'ลบไฟล์', confirmText: 'ลบ', cancelText: 'ยกเลิก', variant: 'danger' }
    );
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${job.id}`, { method: 'DELETE', headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `ลบไม่สำเร็จ (HTTP ${res.status})`);
      const spT = job.confirmedAt ? parseApSpTarget(job.fileName) : null; // MARKER_APRECONCILE_SP_SEND_V1 -- ลบใน SharePoint ด้วย (ลบไม่สำเร็จ = ไม่กระทบการลบในระบบ)
      if (spT) { try { launchApSpDeleteMany([job.fileName], true); } catch (e) { /* เงียบ */ } }
      loadFileJobs(fileJobsScope);
      notifyApFilesChanged(); // MARKER_APRECONCILE_REALTIME_V1
    } catch (err) {
      confirmDialog.alert(err.message || 'ลบไม่สำเร็จ', { variant: 'danger' });
    }
  }, [fileJobsScope, loadFileJobs]);

  // MARKER_APRECONCILE_JOBGROUP_V1 -- Confirm / Release ทั้งชุด (ทุกไฟล์ของ BU+Period เดียวกัน) ถามยืนยันครั้งเดียว | Confirm = ส่งแต่ละไฟล์ไป SharePoint เหมือนเดิม (ทีละไฟล์ เว้นช่วงให้ Handler)
  const handleGroupConfirm = useCallback(async (files, confirm) => {
    const targets = (files || []).filter((f) => (confirm ? !f.confirmedAt : !!f.confirmedAt));
    if (!targets.length) return;
    const names = targets.map((f) => `• ${f.fileName}`).join('\n');
    try {
      const ok = confirm
        ? await confirmDialog.confirm(`Confirm ทั้งชุด ${targets.length} ไฟล์ ?\n${names}\nถือว่าจบงาน: ระบบจะส่งไฟล์ไป SharePoint ให้อัตโนมัติ\n(ถ้า Export ใหม่ทับไฟล์เหล่านี้ ต้อง Confirm ใหม่)`, { title: 'Confirm ไฟล์รายงาน' })
        : await confirmDialog.confirm(`Release ทั้งชุด ${targets.length} ไฟล์ ?\n${names}\nยกเลิกการ Confirm — Download จะถูกล็อกอีกครั้ง และไฟล์จะหายจาก All Job\nและระบบจะลบไฟล์ใน SharePoint ด้วย (กู้คืนได้จาก Recycle Bin ของ SharePoint)`, { title: 'Release ไฟล์รายงาน' });
      if (!ok) return;
      const failed = [];
      // MARKER_APRECONCILE_SP_MULTI_SEND_V1 -- Confirm ทุกไฟล์พร้อมกัน (เร็ว) -> ยิง Handler "ครั้งเดียวต่อชุด" ทันทีขณะยังอยู่ในสิทธิ์การคลิก (เบราว์เซอร์ยอมให้เปิดโปรแกรมได้ครั้งเดียวต่อการคลิก) -> แล้วค่อยโหลดไฟล์ลง Downloads (Handler รอไฟล์ได้ 45 วินาที/ไฟล์)
      await Promise.all(targets.map(async (f) => {
        try {
          const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${f.id}/${confirm ? 'confirm' : 'release'}`, { method: 'POST', headers: authHeaders() });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        } catch (e) { failed.push(`${f.fileName}: ${e.message}`); }
      }));
      loadFileJobs(fileJobsScope);
      notifyApFilesChanged(); // MARKER_APRECONCILE_REALTIME_V1
      if (confirm) {
        const sendFiles = targets.filter((f) => !failed.some((x) => x.startsWith(f.fileName + ':')) && parseApSpTarget(f.fileName));
        const bySp = new Map(); // รวมไฟล์ตาม BU + งวด (ปกติชุดเดียว = ยิงครั้งเดียว)
        for (const f of sendFiles) {
          const t = parseApSpTarget(f.fileName); const k = `${t.buCode}|${t.period}`;
          if (!bySp.has(k)) bySp.set(k, { t, names: [] });
          bySp.get(k).names.push(f.fileName);
        }
        for (const g of bySp.values()) {
          try { launchApSpHandler('send', g.names, g.t); } catch (e) { failed.push(`ส่งคำสั่ง SharePoint ไม่สำเร็จ: ${e?.message || ''}`); }
        }
        for (const f of sendFiles) {
          try { await handleFileDownload(f.id, 'all', f.fileName); } catch (e) { failed.push(`${f.fileName}: ดาวน์โหลดไม่สำเร็จ ${e?.message || ''}`); }
        }
      }
      if (!confirm) { // MARKER_APRECONCILE_RELEASE_SP_DELETE_V1 -- Release สำเร็จ -> ลบไฟล์ใน SharePoint ทั้งชุดด้วยคำสั่งเดียว (ถามยืนยันครั้งเดียว)
        try { launchApSpDeleteMany(targets.filter((f) => !failed.some((x) => x.startsWith(f.fileName + ':'))).map((f) => f.fileName), true); } catch (e) { /* ลบใน SharePoint ไม่สำเร็จ = ไม่กระทบการ Release ในระบบ */ }
      }
      if (failed.length) confirmDialog.alert(`ทำรายการไม่สำเร็จบางไฟล์:\n${failed.join('\n')}`, { variant: 'danger' });
    } catch (err) {
      confirmDialog.alert(err.message || 'ทำรายการไม่สำเร็จ', { variant: 'danger' });
    }
  }, [fileJobsScope, loadFileJobs, handleFileDownload]);

  // MARKER_APRECONCILE_JOBGROUP_V1 -- ลบทั้งชุด (ถามยืนยันครั้งเดียว) | ไฟล์ที่ Confirm แล้วลบใน SharePoint ด้วย
  const handleGroupDelete = useCallback(async (files) => {
    const list = files || [];
    if (!list.length) return;
    const anyConf = list.some((f) => f.confirmedAt);
    const ok = await confirmDialog.confirm(
      `ต้องการลบทั้งชุด ${list.length} ไฟล์ ใช่หรือไม่?\n${list.map((f) => `• ${f.fileName}`).join('\n')}${anyConf ? '\n\nหมายเหตุ: ไฟล์ที่ Confirm แล้ว จะหายจาก All Job และระบบจะลบไฟล์ใน SharePoint ด้วย (ผ่านโฟลเดอร์ OneDrive ในเครื่องนี้ กู้คืนได้จาก Recycle Bin ของ SharePoint)' : ''}\n\nลบแล้วกู้คืนไม่ได้ (Export ใหม่ได้จาก Preview)`,
      { title: 'ลบไฟล์', confirmText: 'ลบทั้งชุด', cancelText: 'ยกเลิก', variant: 'danger' }
    );
    if (!ok) return;
    const failed = []; const spDel = [];
    for (const f of list) {
      try {
        const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${f.id}`, { method: 'DELETE', headers: authHeaders() });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        if (f.confirmedAt) spDel.push(f.fileName);
      } catch (e) { failed.push(`${f.fileName}: ${e.message}`); }
    }
    if (spDel.length) { try { launchApSpDeleteMany(spDel, true); } catch (e) { /* เงียบ */ } } // MARKER_APRECONCILE_SP_DELETE_MANY_V1
    loadFileJobs(fileJobsScope);
    notifyApFilesChanged(); // MARKER_APRECONCILE_REALTIME_V1
    if (failed.length) confirmDialog.alert(`ลบไม่สำเร็จบางไฟล์:\n${failed.join('\n')}`, { variant: 'danger' });
  }, [fileJobsScope, loadFileJobs]);

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
            onFileConfirm={handleFileConfirm} // MARKER_APRECONCILE_REPORT_CONFIRM_V1
            onFileDelete={handleFileDelete} // MARKER_APRECONCILE_REPORT_DELETE_V1
            onGroupConfirm={handleGroupConfirm} // MARKER_APRECONCILE_JOBGROUP_V1
            onGroupDelete={handleGroupDelete} // MARKER_APRECONCILE_JOBGROUP_V1
            spMissing={spMissing || (spDest.checked && spDest.ok === false)} spReason={spMissing ? 'handler' : 'folder'} spDestPath={spDest.path} spChecking={spChecking} onSpCheckFolder={spCheckFolder} onSpDownload={spDownload} onSpRecheck={() => { try { localStorage.removeItem('fastapn_sp_toast_snooze'); } catch (_) { /* เงียบ */ } if (spLoadRef.current) spLoadRef.current(); }} // MARKER_APRECONCILE_SP_SETTING_V1
            onExported={() => { loadFileJobs(fileJobsScope); notifyApFilesChanged(); }} // MARKER_APRECONCILE_REPORT_V1
            onDashboardChanged={() => setDashTick((t) => t + 1)} // MARKER_DASHBOARD_AP_CLEAR_V1
            onJobWatchChanged={() => { loadFileJobs(fileJobsScope); }} // MARKER_APRECONCILE_JOB_WATCH_V1
          />
          {spToast && (
            <div style={{ position: 'fixed', right: '20px', bottom: '20px', zIndex: 10020, width: '320px', background: '#fff', border: '1px solid #f3c98b', borderLeft: '4px solid #E24B4A', borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,0.18)', padding: '12px 14px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#791F1F', margin: '0 0 4px' }}>
                {spToast.kind === 'missing' ? '⚠️ ยังไม่ได้ติดตั้ง SharePoint Handler' : '⚠️ มี SharePoint Handler เวอร์ชันใหม่'}
              </p>
              <p style={{ fontSize: '11px', color: '#666', margin: '0 0 10px' }}>
                {spToast.kind === 'missing'
                  ? 'ต้องติดตั้งก่อนจึงส่งไฟล์ AP Recon ขึ้น SharePoint ได้ (ติดตั้งที่หน้า Home > Notification)'
                  : `v${spToast.from} → v${spToast.latest} · ต้องอัปเดตเพื่อให้ Confirm ส่งไฟล์ AP เข้า SharePoint ได้`}
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button onClick={spToastClose} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ccc', background: '#fff', color: '#555', cursor: 'pointer' }}>ปิด</button>
                {spToast.kind !== 'missing' && (
                  <button onClick={spToastUpdate} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#8a4a00', color: '#fff', cursor: 'pointer' }}>Update ตอนนี้</button>
                )}
              </div>
            </div>
          )}
        </>
      );
  }
}
