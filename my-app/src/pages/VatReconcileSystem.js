// VatReconcileSystem.js
// ============================================================================
// FASTAPN Link3ase — Component กลางสำหรับ Reconcile รายงานภาษีซื้อ (VAT Reconcile)
// ออกแบบให้ Reusable: รับ Prop `bu` เข้ามา ไม่ Hardcode ว่าเรียกจาก AP หรือ IE
// (CPC ในข้อมูลเองแยก AP=99999 / IE=46115 อยู่แล้ว ไม่ต้องแยก Logic ในนี้)
//
// ใช้งาน:
//   import VatReconcileSystem from './VatReconcileSystem';
//   <VatReconcileSystem bu={currentBu} onCommitSuccess={() => {...}} />
//
// รองรับ 3 ชนิดไฟล์: TB (Trial Balance), Input Summary และ Simple Report
// TB/Input Summary ตรวจชนิดจากเนื้อหาไฟล์ (Client-side) ส่วน Simple ตรวจจากชื่อไฟล์
// (เพราะเป็น .xlsx Binary อ่านเป็น Text ตรงๆ ไม่ได้)
//
// ⚠️ TODO ที่ยังไม่ Complete ในเวอร์ชันนี้:
//   - ยังไม่มีหน้า "จัดการไฟล์ Simple" (ลบ/แก้ Tax Type/Exclude Row) -- Commit ได้แค่ Upload ใหม่ทับเท่านั้น
// ============================================================================

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { broadcastWs } from '../wsManager'; // MARKER_APRECONCILE_REALTIME_V1

// ── Base URL Pattern เดียวกับ api.js — REACT_APP_API_URL มี /api ต่อท้ายอยู่แล้ว ──
// ── (เช่น http://10.101.87.126:4000/api) ไม่ต้องเติม /api ซ้ำตอนต่อ Path ──
const VAT_RECONCILE_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// ── ใช้ fetch ตรงๆ เอง (ไม่ใช้ apiFetch) เพราะต้องส่ง multipart/form-data ไม่ใช่ JSON ──
async function callReconcileApi(path, formData, apiModule = 'vat-reconcile') { // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/${apiModule}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
    e.code = data?.code; e.suggest = data?.suggest; // MARKER_VATRECONCILESYSTEM_IS_XLSX_META_V1
    throw e;
  }
  return data;
}

function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// MARKER_VATRECONCILESYSTEM_NEG_RED_ALL_V1 -- ตัวเลขเงินที่ติดลบแสดงสีแดงทุกจุด (ใช้ <Money v={..} /> แทน <Money v={..} />)
const NEG_RED = '#d1242f';
function Money({ v, us }) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const t = n.toLocaleString(us ? 'en-US' : undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? <span style={{ color: NEG_RED }}>{t}</span> : t;
}

function statusLabel(status) {
  switch (status) {
    case 'new': return { text: 'ใหม่', color: '#1a7f37' };
    case 'updated': return { text: 'อัปเดต', color: '#0969da' };
    case 'protected_kept': return { text: 'Protected · คงยอดเดิม', color: '#9a6700' };
    case 'unchanged': return { text: 'ไม่เปลี่ยนแปลง', color: '#57606a' };
    case 'zero_skipped': return { text: 'ยอดเป็น 0 · ไม่บันทึก', color: '#9a6700' }; // MARKER_VATRECONCILE_TB_ZERO_NOT_INSERT_V1
    default: return { text: status || '—', color: '#57606a' };
  }
}

// ── ตรวจชนิดไฟล์จากเนื้อหา (ไม่ใช่จากนามสกุล เพราะทั้ง TB และ Input Summary ดิบเป็น .out เหมือนกัน) ──
// อ่านแค่ 4000 ตัวอักษรแรกพอ (Header อยู่ต้นไฟล์เสมอ)
function detectFileType(headText) {
  if (headText.includes('Company Range:') && headText.includes('GLCRC064')) {
    return 'tb';
  }
  if (headText.includes('End Receive Date') || headText.includes('Merchandise')) {
    return 'input_summary';
  }
  if (headText.includes('Accounts Payable Trial Balance Summary')) { // MARKER_VATRECONCILESYSTEM_AP_CUTTING_DETECT_V1
    return 'ap_cutting';
  }
  return 'unknown';
}

// ── ไฟล์ Simple เป็น .xlsx (Binary) อ่านเป็น Text ตรงๆ ไม่ได้ -- ตรวจจาก "ชื่อไฟล์" แทน ──
// (Pattern เดียวกับที่ Backend ใช้ตัดสิน Simple Type + Tax Type Code)
// SIMPLE_FILENAME_FLEXIBLE_SEP_PATCH_APPLIED — รองรับทั้ง Space และ Underscore คั่นคำในชื่อไฟล์
const SIMPLE_FILENAME_PATTERN = /Simple[ _]+Report[ _]+Vat[ _]+(100|AVG)[ _]+([NAFT])/i;
function isSimpleFile(filename) {
  return SIMPLE_FILENAME_PATTERN.test(filename);
}

function readFileHead(file, maxChars = 4000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(reader.error);
    // slice ก่อนอ่าน กันไฟล์ใหญ่เกินไปทำให้ช้า
    reader.readAsText(file.slice(0, maxChars), 'windows-1252');
  });
}

const ENDPOINTS = {
  tb: { preview: '/tb/preview', commit: '/tb/commit' },
  input_summary: { preview: '/input-summary/preview', commit: '/input-summary/commit' },
  simple: { preview: '/simple/preview', commit: '/simple/commit' },
  ap_cutting: { preview: '/ap-cutting/preview', commit: '/ap-cutting/commit' }, // MARKER_VATRECONCILESYSTEM_AP_CUTTING_DETECT_V1
  jv_journal: { preview: '/jv-journal/preview', commit: '/jv-journal/commit' }, // MARKER_VATRECONCILESYSTEM_JV_JOURNAL_V1 -- JV Journal (FNDWRR) -> ap_detailoverhead
};
// MARKER_VATRECONCILESYSTEM_JV_JOURNAL_V1 -- route JV Journal อยู่ใน vatReconcile router (/api/vat-reconcile/jv-journal/*) ไม่ได้ Forward ผ่าน /api/ap-reconcile
const apiModOf = (type, apiModule) => (type === 'jv_journal' ? 'vat-reconcile' : apiModule);

export default function VatReconcileSystem({ bu, onCommitSuccess, apiModule = 'vat-reconcile', initialFile = null, expectedType = null, expectedSimple = null, expectedBu = null, expectedLabel = '', expectedTaxType = null, expectedBuNum = null }) { // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1 -- โยนไฟล์จากหน้า Timeline: initialFile = ไฟล์ที่โยน | expectedType/expectedSimple/expectedBu = Scope ของการ์ดที่โยน // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [inputMode, setInputMode] = useState('file'); // MARKER_VATRECONCILESYSTEM_PASTE_TAB_V1 -- 'file' = ลากไฟล์/เลือกไฟล์ | 'paste' = วาง Text ที่ Copy จาก Excel / Notepad (เหมือนหน้า Upload Incomplete)
  const [pasteText, setPasteText] = useState('');
  const autoCommitRef = useRef(false); // MARKER_VATRECONCILESYSTEM_PASTE_AUTOCOMMIT_V1 -- วาง Text แล้วรูปแบบถูก (ไม่มีคำเตือน) -> บันทึกต่อเองเลย ไม่ต้องกด Confirm
  const confirmCommitRef = useRef(null);
  const metaRef = useRef(null); // { period, taxType } ที่ผู้ใช้กำหนดใน Popup (Input Summary .xlsx)
  const [showUnchanged, setShowUnchanged] = useState(false); // MARKER_VATRECONCILESYSTEM_TB_PREVIEW_REDESIGN_V1
  const [metaDialog, setMetaDialog] = useState(null); // { file, label, message, period, taxType } // เก็บ File Object ที่ใช้ตอน Preview ไว้ใช้ซ้ำตอน Commit

  const [stage, setStage] = useState('idle'); // idle | scanning | preview | committing | done | error
  const [sourceLabel, setSourceLabel] = useState('');
  const [fileType, setFileType] = useState(null); // 'tb' | 'input_summary' | 'simple' | 'ap_cutting'
  const [previewData, setPreviewData] = useState(null); // { summary, records, unmatchedLines }
  const [tbComFilter, setTbComFilter] = useState(null); // MARKER_VATRECONCILESYSTEM_TB_COM_FILTER_V1 -- กดชิป COM เพื่อกรองตารางใน Preview TB (null = ทั้งหมด)
  const [tbBranchFilter, setTbBranchFilter] = useState(null); // MARKER_VATRECONCILESYSTEM_TB_BRANCH_FILTER_V1 -- Filter สาขา (List แสดง 5 แถว เลื่อนดูได้)
  const [tbBranchPop, setTbBranchPop] = useState(null); // { x, y } ตำแหน่ง Popup
  const [tbBranchQ, setTbBranchQ] = useState('');
  useEffect(() => { setTbComFilter(null); setTbBranchFilter(null); setTbBranchPop(null); setTbBranchQ(''); }, [previewData]);
  const [tbTab, setTbTab] = useState('changed'); // MARKER_VATRECONCILESYSTEM_TB_TABS_V1 -- แท็บในหน้ายืนยัน TB: changed | unmatched | skipped
  const [apTab, setApTab] = useState('all'); const [apPage, setApPage] = useState(0); const [apQ, setApQ] = useState(''); // MARKER_VATRECONCILESYSTEM_AP_POPUP_V1 -- แท็บ/หน้าของตาราง AP Cutting
  const [errorMessage, setErrorMessage] = useState('');

  const resetAll = useCallback(() => {
    setStage('idle');
    setSourceLabel('');
    setFileType(null);
    setPreviewData(null); setTbTab('changed'); setApTab('all'); setApPage(0); setApQ('');
    setErrorMessage('');
    pendingFileRef.current = null;
    metaRef.current = null;
    autoCommitRef.current = false;
    setPasteText('');
    setMetaDialog(null);
    setShowUnchanged(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const runPreview = useCallback(async (file, label) => {
    setStage('scanning');
    setSourceLabel(label);
    setErrorMessage('');
    pendingFileRef.current = file; // เก็บไว้ใช้ตอนกดยืนยัน Commit
    try {
      // เช็คไฟล์ Simple (.xlsx) จากชื่อไฟล์ก่อน -- อ่านเป็น Text ไม่ได้เพราะเป็น Binary
      let type;
      if (isSimpleFile(file.name)) {
        type = 'simple';
      } else if ((apiModule === 'vat-reconcile' || apiModule === 'ap-reconcile') && /\.(xlsx|tsv)$/i.test(file.name)) { // MARKER_VATRECONCILESYSTEM_AP_TB_SAME_LOGIC_V1 -- หน้า AP รับ TB .xlsx/.tsv เหมือนหน้า VAT (ใน ap-reconcile ไฟล์ .xlsx/.tsv = TB เสมอ) // MARKER_VATRECONCILESYSTEM_IS_XLSX_V1 -- .xlsx ที่ไม่ใช่ Simple = TB ที่ตัดแล้ว หรือ Input Summary ที่ Confirm แล้ว (เดาจากชื่อไฟล์ก่อน ถ้า Backend ตรวจหัวคอลัมน์แล้วไม่ใช่ -> ลองอีกชนิด)
        type = apiModule === 'ap-reconcile' ? 'tb' : (/Input[ _]+Summary/i.test(file.name) || !/(^|[^A-Za-z])TB([^A-Za-z]|$)/i.test(file.name) ? 'input_summary' : 'tb');
      } else {
        const headText = await readFileHead(file);
        type = detectFileType(headText);
      }

      if (apiModule === 'ap-reconcile' && /\.(xlsx|tsv)$/i.test(file.name)) { // MARKER_VATRECONCILESYSTEM_JV_JOURNAL_V1 -- JV Journal: ชื่อไฟล์มี JV Journal หรือ Text ที่วางมีหัว Branch Code + Journal name
        if (/JV[ _-]?Journal|Detail[ _-]?of[ _-]?Overhead/i.test(file.name)) type = 'jv_journal';
        else if (/\.tsv$/i.test(file.name)) { try { const h = await file.slice(0, 6000).text(); if (/branch code/i.test(h) && /journal name/i.test(h)) type = 'jv_journal'; } catch (_) { /* ใช้ชนิดเดิม */ } }
      }
      if (type === 'unknown') {
        throw new Error(
          apiModule === 'ap-reconcile'
            ? 'ไม่รู้จักชนิดไฟล์นี้ — รองรับเฉพาะ TB (.out จาก GLCRC064) และ Account Payable (.out จาก Accounts Payable Trial Balance Summary) เท่านั้น'
            : 'ไม่รู้จักชนิดไฟล์นี้ — รองรับ TB (.out จาก GLCRC064), Input Summary (.out จาก APCRC201) ' +
              'และ Simple Report (.xlsx ชื่อไฟล์มี Simple_Report_Vat_100/AVG)'
        );
      }
      setFileType(type);
      const formData = new FormData();
      formData.append('file', file);
      if (metaRef.current) { Object.entries(metaRef.current).forEach(([k, v]) => { if (v) formData.append(k, v); }); }
      let data;
      try {
        data = await callReconcileApi(ENDPOINTS[type].preview, formData, apiModOf(type, apiModule)); // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
      } catch (e1) {
        const other = apiModule === 'ap-reconcile' ? (type === 'tb' ? 'jv_journal' : null) : type === 'input_summary' ? 'tb' : type === 'tb' ? 'input_summary' : null; // MARKER_VATRECONCILESYSTEM_JV_JOURNAL_V1 -- หน้า AP ไม่มี Input Summary: TB ไม่ใช่ -> ลอง JV Journal
        if (e1?.code === 'UNKNOWN_FORMAT' && other && /\.(xlsx|tsv)$/i.test(file.name)) { // ไม่ใช่ชนิดที่เดา -> ลองอีกชนิด
          type = other;
          setFileType(type);
          try { data = await callReconcileApi(ENDPOINTS[type].preview, formData, apiModOf(type, apiModule)); } catch (e2) { if (type === 'jv_journal' && e2?.code === 'UNKNOWN_FORMAT') { throw new Error('ไม่รู้จักชนิดไฟล์นี้ — รองรับ TB, Account Payable และ Detail of Overhead (JV Journal)'); } e2.fileType = type; throw e2; }
        } else { e1.fileType = type; throw e1; }
      }
      if (expectedType && type !== expectedType) { // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1 -- เช็กหลังรู้ชนิดจริง (ไฟล์ .xlsx/.tsv/Paste เดาชนิดก่อนแล้วลองอีกชนิดได้)
        const TL = { tb: 'Trial Balance (TB)', input_summary: 'Input Summary', simple: 'Simple Report' };
        throw new Error(`ไฟล์ที่โยนเป็น ${TL[type] || type} แต่ช่อง${expectedLabel ? ' ' + expectedLabel : ''}นี้รับเฉพาะ ${TL[expectedType] || expectedType} — ตรวจว่าโยนถูกการ์ดหรือยัง`);
      }
      if (expectedSimple && type === 'simple' && String(data?.simple_type || '').toLowerCase().replace('%', '') !== String(expectedSimple).toLowerCase()) { // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1
        throw new Error(`ไฟล์ที่โยนเป็น Simple ${data?.simple_type || '?'}% แต่ช่อง${expectedLabel ? ' ' + expectedLabel : ''}นี้รับเฉพาะ Simple ${String(expectedSimple).toUpperCase() === '100' ? '100%' : 'AVG'}`);
      }
      if (expectedTaxType && type === 'input_summary') { // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1 -- Input Summary: Detect Tax Type จากไฟล์ ให้ตรงกับการ์ดที่โยน
        const gotTax = String(data?.summary?.tax_type || '').toUpperCase();
        if (gotTax && gotTax !== String(expectedTaxType).toUpperCase()) throw new Error(`ไฟล์ที่โยนเป็น Input Summary Tax Type ${gotTax} แต่ช่อง${expectedLabel ? ' ' + expectedLabel : ''}นี้รับเฉพาะ Tax Type ${String(expectedTaxType).toUpperCase()} — ตรวจว่าโยนถูกการ์ดหรือยัง`);
      }
      if (expectedBu && type === 'input_summary' && Array.isArray(data?.summary?.bu_list) && data.summary.bu_list.length) { // BU ในไฟล์ต้องมี BU ที่เปิดอยู่
        const nums = data.summary.bu_list.map((x) => String(x?.bu ?? x ?? '').trim()).filter((x) => /^\d+$/.test(x));
        if (expectedBuNum && nums.length && !nums.includes(String(expectedBuNum))) throw new Error(`ไฟล์นี้เป็นของ BU ${nums.join(', ')} แต่คุณกำลังอยู่ที่ BU ${expectedBu || expectedBuNum} (${expectedBuNum})`);
        const names = data.summary.bu_list.map((x) => String(x?.bu_short || x?.short || x?.bu || x || '').toUpperCase()).filter((x) => x && !/^\d+$/.test(x));
        if (names.length && !names.includes(String(expectedBu).toUpperCase())) throw new Error(`ไฟล์นี้เป็นของ BU ${names.join(', ')} แต่คุณกำลังอยู่ที่ BU ${expectedBu}`);
      }
      { const gotBu = String(data?.summary?.bu_short || data?.bu_short || (type === 'simple' ? data?.bu : '') || '').trim(); // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1 -- BU ในไฟล์ต้องตรงกับ BU ที่เปิดอยู่ใน Timeline
        if (expectedBu && gotBu && !/^\d+$/.test(gotBu) && gotBu.toUpperCase() !== String(expectedBu).toUpperCase()) throw new Error(`ไฟล์นี้เป็นของ BU ${gotBu} แต่คุณกำลังอยู่ที่ BU ${expectedBu}`); }
      setPreviewData(data);
      setStage('preview');
      const sm = data?.summary || {};
      const clean = (type === 'tb' || type === 'input_summary') && !(sm.unmatched_lines_count > 0) && !(sm.unmatched_branch_count > 0) && !(sm.fallback_count > 0) && (sm.total ?? sm.parsed_count ?? 0) > 0;
      if (autoCommitRef.current && clean) setTimeout(() => { if (confirmCommitRef.current) confirmCommitRef.current(); }, 80); // รูปแบบถูก -> บันทึกต่อทันที
    } catch (err) {
      if (err?.code === 'NEED_META') { // ชื่อไฟล์ระบุไม่ได้ -> ให้ผู้ใช้กำหนด Period / Tax Type
        setStage('idle');
        setMetaDialog({ file, label, message: err.message, kind: err.fileType || 'input_summary', period: err.suggest?.period || '', taxType: err.suggest?.taxType || '', bu: err.suggest?.bu || '' });
        return;
      }
      console.error('VatReconcileSystem preview error:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดระหว่างตรวจสอบไฟล์');
      setStage('error');
    }
  }, [apiModule, expectedType, expectedSimple, expectedBu, expectedLabel, expectedTaxType, expectedBuNum]);

  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    metaRef.current = null;
    autoCommitRef.current = false;
    runPreview(file, file.name);
  }, [runPreview]);

  const initialFileDoneRef = useRef(null); // MARKER_VATRECONCILESYSTEM_TIMELINE_SCOPE_V1 -- โยนไฟล์มาจาก Timeline: ตรวจ Preview อัตโนมัติครั้งเดียว
  useEffect(() => {
    if (initialFile && initialFileDoneRef.current !== initialFile) { initialFileDoneRef.current = initialFile; handleFileSelect([initialFile]); }
  }, [initialFile, handleFileSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current && (dropZoneRef.current.style.background = '');
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) dropZoneRef.current.style.background = '#f7f7f7';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) dropZoneRef.current.style.background = '';
  }, []);

  // ── Paste (Ctrl+V) — รองรับทั้งวางไฟล์ และวาง Text ดิบ (Copy จาก Notepad) ──
  const submitPastedText = useCallback((text, label) => { // MARKER_VATRECONCILESYSTEM_PASTE_TAB_V1
    if (!text || !text.trim()) return;
    const isTsv = (apiModule === 'vat-reconcile' || apiModule === 'ap-reconcile') && text.includes('\t'); // Copy จาก Excel = คั่นด้วย Tab -> Backend ใช้ Logic เดียวกับไฟล์ .xlsx ที่ตัดแล้ว
    const blob = new Blob([text], { type: 'text/plain' });
    const file = new File([blob], isTsv ? 'pasted-excel.tsv' : 'pasted-data.out', { type: 'text/plain' });
    metaRef.current = null;
    autoCommitRef.current = false; // วางแล้วตรวจสอบให้ทันที แต่ต้องกดยืนยันเอง (ไม่บันทึกอัตโนมัติ)
    runPreview(file, label || 'ข้อมูลที่วาง');
  }, [runPreview, apiModule]);

  const handlePaste = useCallback((e) => {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return; // วางใน Textarea ของ Tab วาง Text -> ปล่อยให้ Textarea รับเอง
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.trim().length > 0 && text.includes('\t')) { // Excel Copy ติดมาทั้งรูป+Text ให้เอา Text ก่อน
      e.preventDefault();
      submitPastedText(text, 'ข้อมูลที่ Copy จาก Excel');
      return;
    }
    const clipboardFiles = e.clipboardData?.files;
    if (clipboardFiles && clipboardFiles.length > 0) {
      e.preventDefault();
      handleFileSelect(clipboardFiles);
      return;
    }
    if (text && text.trim().length > 0) {
      e.preventDefault();
      submitPastedText(text, 'ข้อมูลจากคลิปบอร์ด');
    }
  }, [handleFileSelect, submitPastedText]);

  // MARKER_VATRECONCILESYSTEM_WINDOW_PASTE_V1 -- ดักจับ Ctrl+V ที่ระดับหน้าทั้งหมด (window) ไม่ต้องคลิก Focus กรอบ Dropzone ก่อน
  // (เดิม onPaste ผูกกับกรอบ Dropzone อย่างเดียว แต่กรอบนั้น onClick เปิด File Dialog ทันที ทำให้ไม่มีทางคลิกเพื่อ Focus เฉยๆ ได้เลย)
  // ทำงานเฉพาะตอน stage === 'idle' (ยังไม่ได้เลือกไฟล์) และ Component นี้ Mount อยู่ (คือ Tab "Upload File" เปิดอยู่เท่านั้น -- Unmount ตอนสลับ Tab จึงไม่กระทบ Tab อื่น)
  useEffect(() => {
    if ((stage !== 'idle' && stage !== 'error') || metaDialog) return undefined; // MARKER_VATRECONCILESYSTEM_PASTE_ON_ERROR_V1 -- ตอนขึ้น Error ก็ต้องวางใหม่ได้ (เดิมวางไม่ได้เพราะรับเฉพาะ idle -> เหมือนไม่ทำอะไรเลย)
    const onWindowPaste = (e) => handlePaste(e);
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [stage, handlePaste, metaDialog]);

  const handleConfirmCommit = useCallback(async () => {
    if (!pendingFileRef.current || !fileType) {
      setErrorMessage('ไม่พบไฟล์ต้นฉบับ กรุณาอัปโหลดใหม่อีกครั้ง');
      setStage('error');
      return;
    }
    setStage('committing');
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('file', pendingFileRef.current);
      if (metaRef.current) { Object.entries(metaRef.current).forEach(([k, v]) => { if (v) formData.append(k, v); }); }
      const data = await callReconcileApi(ENDPOINTS[fileType].commit, formData, apiModOf(fileType, apiModule)); // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
      setStage('done');
      if (apiModule === 'ap-reconcile') { try { broadcastWs('ap_reconcile_data_changed', { kind: fileType, period: data?.period || data?.summary?.period || undefined }); } catch (_) { /* ไม่มี WS -> ข้าม */ } } // MARKER_APRECONCILE_REALTIME_V1 -- อัปโหลด TB/AP เข้า DB สำเร็จ -> ทุกเครื่อง (ทุก User) รีเฟรช Dashboard AP Recon ทันที
      if (typeof onCommitSuccess === 'function') onCommitSuccess(data);
    } catch (err) {
      console.error('VatReconcileSystem commit error:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล');
      setStage('error');
    }
  }, [onCommitSuccess, fileType, apiModule]);
  confirmCommitRef.current = handleConfirmCommit;

  return (
    // MARKER_VATRECONCILESYSTEM_FILL_ZONE_HEIGHT_V2 — Container + Dropzone ขยายเต็มทั้งความสูง
    // และความกว้างของ Zone ที่ครอบอยู่ (ตัด maxWidth: 720 เดิมที่ทำให้ค้างแคบไม่ขยายตาม % จอออก
    // เหลือพื้นที่ขาวว่างรอบๆ) ใช้ Flex แทน Fix ขนาด — มีผลกับทุก Module ที่ใช้ Component นี้
    // ร่วมกัน (VAT/AP/IE) เหมือนกันหมด — Popup Preview (Modal) ยังคง width: 720 เดิมไว้
    // เพราะเป็นกล่อง Dialog ลอย ไม่ใช่ตัว Container หลักที่ต้องเต็ม Zone
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      {stage === 'idle' && (apiModule === 'vat-reconcile' || apiModule === 'ap-reconcile') && ( // MARKER_VATRECONCILESYSTEM_PASTE_TAB_V1
        <div style={{ display: 'flex', gap: 4, paddingLeft: 12, marginBottom: 12, borderBottom: '1px solid #d0d7de' }}>{/* MARKER_VATRECONCILESYSTEM_FOLDER_TABS_V1 -- แท็บแบบแฟ้ม: ตัวที่เลือกขาว + เส้นน้ำเงินด้านล่าง ต่อกับเส้นกรอบเนื้อหา */}
          {[['file', '📎 แนบไฟล์ / ลากไฟล์'], ['paste', '📋 วาง Text จาก Excel / Notepad']].map(([k, label]) => {
            const on = inputMode === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setInputMode(k)}
                style={{
                  padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginBottom: -1,
                  border: '1px solid #d0d7de', borderBottom: on ? '1px solid #fff' : '1px solid #d0d7de', borderRadius: '10px 10px 0 0',
                  background: on ? '#fff' : '#f6f8fa', color: on ? '#1a3a5c' : '#6e7781',
                  boxShadow: on ? 'inset 0 -3px 0 #1a73e8' : 'none',
                }}
              >{label}</button>
            );
          })}
        </div>
      )}

      {stage === 'idle' && (apiModule === 'vat-reconcile' || apiModule === 'ap-reconcile') && inputMode === 'paste' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => { // วางเสร็จตรวจสอบให้อัตโนมัติ (ไม่ต้องกดปุ่ม) -- MARKER_VATRECONCILESYSTEM_PASTE_AUTORUN_V1
              const t = e.clipboardData?.getData('text/plain');
              if (t && t.trim()) { e.preventDefault(); setPasteText(t); submitPastedText(t, 'ข้อมูลที่วาง'); }
            }}
            placeholder={'คลิกแล้ววาง (Ctrl+V) ข้อมูลที่ Copy จาก Excel หรือ Text จากไฟล์ .out ที่นี่\n\n• Input Summary / TB ที่ตัดแล้ว (Copy จาก Excel พร้อมหัวคอลัมน์ หรือไม่มีหัวก็ได้)\n• TB / Input Summary ดิบ (.out) จาก Notepad\nระบบตรวจชนิดข้อมูลให้เอง ถ้าระบุ Period / BU / Tax Type ไม่ได้จะมี Popup ให้กำหนด'}
            style={{ flex: '1 0 auto', minHeight: 200, height: 260, width: '100%', boxSizing: 'border-box', fontFamily: 'Consolas, monospace', fontSize: 12, padding: 12, border: '1.5px dashed #ccc', borderRadius: 12, resize: 'vertical', outline: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* MARKER_VATRECONCILESYSTEM_PASTE_NO_BUTTONS_V1 -- เอาปุ่ม ตรวจสอบข้อมูล / ล้าง ออก (วางแล้วตรวจให้อัตโนมัติอยู่แล้ว) */}
            <span style={{ fontSize: 12, color: '#6e7781' }}>{pasteText ? `${pasteText.split(/\r?\n/).filter((l) => l.trim()).length.toLocaleString()} บรรทัด` : ''}</span>
          </div>
        </div>
      )}

      {stage === 'idle' && !((apiModule === 'vat-reconcile' || apiModule === 'ap-reconcile') && inputMode === 'paste') && (
        <div
          ref={dropZoneRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          tabIndex={0}
          style={{
            border: '1.5px dashed #ccc',
            borderRadius: '12px',
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            outline: 'none',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".out,.txt,.xlsx"
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <p style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 4px' }}>
            ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์
          </p>
          {/* MARKER_VATRECONCILESYSTEM_UPLOAD_HINT_WORDING_V1 — แยก Wording ตาม apiModule เพราะ
              ap-reconcile รับแค่ TB กับ Account Payable (ap_cutting) เท่านั้น ไม่มี Input Summary/
              Simple เลย — พูดถึงชนิดไฟล์ที่ไม่รองรับจะทำให้เข้าใจผิดว่าจะรองรับในอนาคต */}
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 10px' }}>
            {apiModule === 'ap-reconcile'
              ? 'รองรับ TB (.out) และ Account Payable (.out) — ระบบตรวจชนิดไฟล์ให้อัตโนมัติ'
              : 'รองรับ TB (.out), Input Summary (.out) และ Simple Report (.xlsx) — ระบบตรวจชนิดไฟล์ให้อัตโนมัติ'}
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px',
            color: '#666', background: '#f2f2f2', borderRadius: '8px', padding: '4px 10px',
          }}>
            <span>หรือกด Ctrl+V เพื่อวางข้อมูลจากคลิปบอร์ดโดยตรง</span>
          </div>
        </div>
      )}

      {stage === 'scanning' && (
        <div style={{ padding: '12px 14px', background: '#f7f7f7', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px' }}>กำลังตรวจสอบไฟล์: {sourceLabel}...</span>
        </div>
      )}

      {metaDialog && ( // MARKER_VATRECONCILESYSTEM_IS_XLSX_META_V1 -- Popup กำหนด Period / Tax Type เมื่อชื่อไฟล์ระบุไม่ได้
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, width: 420, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{metaDialog.kind === 'tb' ? 'กำหนดข้อมูลไฟล์ TB' : 'กำหนดข้อมูลไฟล์ Input Summary'}</div>
            <div style={{ fontSize: 12, color: '#57606a', marginBottom: 14 }}>{metaDialog.label} — {metaDialog.message}</div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Period (เดือนที่ Reconcile)</label>
            <input type="month" value={metaDialog.period} onChange={(e) => setMetaDialog({ ...metaDialog, period: e.target.value })} style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: '1px solid #d0d7de', borderRadius: 8, marginBottom: 12, boxSizing: 'border-box' }} />
            {metaDialog.kind === 'tb' ? (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>BU (รหัส 4 หลัก เช่น 0402)</label>
                <input type="text" maxLength={4} value={metaDialog.bu} onChange={(e) => setMetaDialog({ ...metaDialog, bu: e.target.value.replace(/\D/g, '') })} style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: '1px solid #d0d7de', borderRadius: 8, boxSizing: 'border-box' }} />
              </>
            ) : (
              <>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Tax Type</label>
            <select value={metaDialog.taxType} onChange={(e) => setMetaDialog({ ...metaDialog, taxType: e.target.value })} style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: '1px solid #d0d7de', borderRadius: 8, boxSizing: 'border-box' }}>
              <option value="">— เลือก Tax Type —</option>
              <option value="N">N → Account 11610752</option>
              <option value="A">A → Account 11610752</option>
              <option value="F">F → Account 11610755</option>
              <option value="T">T → Account 11610755</option>
            </select>
              </>
            )}
            <div style={{ fontSize: 11, color: '#6e7781', marginTop: 8 }}>{metaDialog.kind === 'tb' ? 'TB: ยอด 0 จะไม่ทับยอดเดิมของบัญชีภาษีซื้อ ตามกติกาเดิม' : 'BU ระบบหาจากรหัสสาขาในไฟล์ให้อัตโนมัติ · เมื่อ Confirm ระบบจะแทนที่ข้อมูลเดิมของ BU + Period + Account นี้ทั้งก้อน'}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => { setMetaDialog(null); resetAll(); }} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid #d0d7de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
              <button type="button" disabled={!/^\d{4}-\d{2}$/.test(metaDialog.period) || (metaDialog.kind === 'tb' ? metaDialog.bu.length !== 4 : !metaDialog.taxType)} onClick={() => { const d = metaDialog; metaRef.current = d.kind === 'tb' ? { period: d.period, bu: d.bu } : { period: d.period, tax_type: d.taxType }; setMetaDialog(null); runPreview(d.file, d.label); }} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#0969da', color: '#fff', cursor: 'pointer', opacity: (!/^\d{4}-\d{2}$/.test(metaDialog.period) || (metaDialog.kind === 'tb' ? metaDialog.bu.length !== 4 : !metaDialog.taxType)) ? 0.5 : 1 }}>ตกลง ตรวจสอบไฟล์</button>
            </div>
          </div>
        </div>
      )}
      {stage === 'error' && (
        <div style={{ padding: '14px', background: '#fdecec', borderRadius: '8px', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#a30d16', margin: 0 }}>{errorMessage}</p>
          <button type="button" onClick={resetAll} style={{ marginTop: '10px', fontSize: '13px' }}>
            ลองใหม่
          </button>
        </div>
      )}

      {stage === 'preview' && previewData && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '1.5rem',
            width: fileType === 'ap_cutting' ? 'min(1800px, 97vw)' : 1240, maxWidth: fileType === 'ap_cutting' ? '97vw' : '94vw', maxHeight: '94vh', overflowY: 'auto', // MARKER_VATRECONCILESYSTEM_INPUT_PREVIEW_WIDE_V1 -- Input Summary มีหลายคอลัมน์ ขยายกล่องให้ไม่ต้องเลื่อนแนวนอน
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>ยืนยันข้อมูลก่อนบันทึก</p>
              <button
                type="button"
                aria-label="ปิด"
                onClick={resetAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#666' }}
              >
                ✕
              </button>
            </div>

            {fileType === 'tb' && (() => { // MARKER_VATRECONCILESYSTEM_TB_PREVIEW_REDESIGN_V1 -- หน้ายืนยัน TB: แสดงเฉพาะรายการที่เปลี่ยน + สวิตช์ดูรายการที่ไม่เปลี่ยน
              const sm = previewData.summary || {};
              const recs = previewData.records || [];
              const changedRecs = recs.filter((r) => r.status !== 'unchanged');
              const sameCount = recs.length - changedRecs.length;
              const comList = (showUnchanged ? recs : changedRecs).filter((r) => !tbComFilter || String(r.bu) === tbComFilter);
              const branchOpts = [...new Set(comList.map((r) => String(r.branch)))].sort();
              const list = comList.filter((r) => !tbBranchFilter || String(r.branch) === tbBranchFilter);
              const toSave = (sm.new_count || 0) + (sm.updated_count || 0);
              const comMissing = (sm.com_unmatched || []); /* MARKER_VATRECONCILESYSTEM_TB_COM_MATCH_BLOCK_V1 */ const tbBlocked = (previewData.unmatchedLines || []).length > 0 || comMissing.length > 0; // MARKER_VATRECONCILE_TB_UNMATCHED_BLOCK_V1 -- มีบรรทัดอ่านไม่ได้ = Error -> บันทึกไม่ได้
              const C = { new: ['#e6f4ea', '#1a7f37'], upd: ['#ddf0ff', '#0969da'], prot: ['#fff4d6', '#9a6700'], bad: ['#ffebe9', '#cf222e'] };
              const cards = [
                ['Record ใหม่', sm.new_count || 0, 'new'],
                ['ยอดเปลี่ยน', sm.updated_count || 0, 'upd'],
                ['Protected (คงยอดเดิม)', sm.protected_kept_count || 0, 'prot'],
                ['ไม่พบ / Parse ไม่ได้', sm.unmatched_lines_count || 0, 'bad'],
              ];
              const chip = { display: 'inline-flex', alignItems: 'center', fontSize: 13, padding: '5px 12px', borderRadius: 999, background: '#f3f4f6' };
              const th = { position: 'sticky', top: 0, background: '#f7f8fa', padding: '9px 12px', fontSize: 12, fontWeight: 600, color: '#656d76', borderBottom: '1px solid #e6e9ed' };
              return (
                <div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    <span style={{ ...chip, background: '#ddf0ff', color: '#0969da', fontWeight: 600 }}>Trial Balance (TB)</span>
                    {((sm.bu_breakdown && sm.bu_breakdown.length) ? sm.bu_breakdown : [{ bu: sm.bu, com: sm.bu_short, book: null, count: recs.length }]).map((b) => ( // MARKER_VATRECONCILESYSTEM_TB_COM_BU_BOOK_V1 -- COM | BU | BOOK (COM = Segment 3 ของ Flexfield, BU = company_list.bu, BOOK = company_list.BOOK)
                      <span key={b.bu} onClick={() => { setTbComFilter(tbComFilter === String(b.bu) ? null : String(b.bu)); setTbBranchFilter(null); }} style={{ ...(b.found === false ? { ...chip, background: '#ffebe9', color: '#cf222e' } : chip), cursor: 'pointer', boxShadow: tbComFilter === String(b.bu) ? 'inset 0 0 0 2px #0969da' : undefined, background: tbComFilter === String(b.bu) ? '#ddf0ff' : (b.found === false ? '#ffebe9' : chip.background) }} title={b.found === false ? 'ไม่พบใน Company List — กดเพื่อกรอง' : (tbComFilter === String(b.bu) ? 'กดอีกครั้งเพื่อดูทั้งหมด' : 'กดเพื่อกรองเฉพาะ COM นี้')}><span style={{ color: '#656d76' }}>COM&nbsp;</span><b>{b.bu}</b><span style={{ color: '#b6bcc4' }}>&nbsp;|&nbsp;</span><span style={{ color: '#656d76' }}>BU&nbsp;</span><b>{b.com || '—'}</b><span style={{ color: '#b6bcc4' }}>&nbsp;|&nbsp;</span><span style={{ color: '#656d76' }}>BOOK&nbsp;</span><b>{b.book || '—'}</b>{(sm.bu_breakdown && sm.bu_breakdown.length > 1) ? <span style={{ color: '#656d76' }}>&nbsp;({b.count})</span> : null}</span>
                    ))}
                    <span style={chip}>Period&nbsp;<b>{sm.period}</b></span>
                    <span style={chip}>ทั้งหมด&nbsp;<b>{recs.length}</b>&nbsp;รายการ</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
                    {cards.map(([label, value, k]) => (
                      <div key={k} style={{ borderRadius: 12, padding: '12px 14px', background: value ? C[k][0] : '#f3f4f6' }}>
                        <div style={{ fontSize: 12, color: '#656d76', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2, color: value ? C[k][1] : '#b6bcc4' }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {changedRecs.length === 0 && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#e6f4ea', color: '#14532d', borderRadius: 12, padding: '12px 14px', fontSize: 14, marginBottom: 16 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#1a7f37', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, flex: 'none' }}>✓</span>
                      <span><b>ข้อมูลตรงกับใน DB ทั้งหมด</b> — ไม่มีรายการใหม่หรือยอดที่เปลี่ยน การบันทึกจะไม่ทำให้ข้อมูลเปลี่ยน</span>
                    </div>
                  )}

                  {((previewData.unmatchedLines || []).length > 0 || (previewData.skippedLines || []).length > 0) && ( // MARKER_VATRECONCILESYSTEM_TB_TABS_V1
                    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e6e9ed', marginBottom: 12 }}>
                      {[['changed', `รายการที่จะบันทึก (${changedRecs.length})`, '#0969da'], ['unmatched', `อ่านไม่ได้ (${(previewData.unmatchedLines || []).length})`, '#cf222e'], ['skipped', `ข้าม — ไม่อยู่ใน Config (${(previewData.skippedLines || []).length})`, '#9a6700']].map(([k, label, col]) => (
                        <button key={k} type="button" onClick={() => setTbTab(k)} style={{ padding: '8px 14px', fontSize: 13, fontWeight: tbTab === k ? 600 : 500, cursor: 'pointer', background: 'none', border: 'none', borderBottom: tbTab === k ? `2px solid ${col}` : '2px solid transparent', color: tbTab === k ? col : '#656d76', marginBottom: -1 }}>{label}</button>
                      ))}
                    </div>
                  )}

                  {(tbTab === 'unmatched' || tbTab === 'skipped') && ((previewData.unmatchedLines || []).length > 0 || (previewData.skippedLines || []).length > 0) && (() => {
                    const isU = tbTab === 'unmatched'; const arr = isU ? (previewData.unmatchedLines || []) : (previewData.skippedLines || []);
                    return (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, marginBottom: 8, color: isU ? '#82071e' : '#7d4e00' }}>{isU ? 'บรรทัดเหล่านี้อ่านไม่ได้ — จะไม่ถูกบันทึก (ตรวจไฟล์ต้นฉบับก่อนยืนยัน)' : 'บรรทัดเหล่านี้ Account ไม่อยู่ใน Config — จึงไม่ถูกบันทึก'}</div>
                        <div style={{ border: '1px solid #e6e9ed', borderRadius: 12, maxHeight: '52vh', overflow: 'auto', padding: '6px 12px', background: isU ? '#fff5f4' : '#fffaf0' }}>
                          {arr.length === 0 ? <div style={{ padding: 16, color: '#656d76', fontSize: 13 }}>ไม่มีรายการ</div> : arr.map((ln, i) => (
                            <div key={i} style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12, color: '#24292f', padding: '4px 0', borderBottom: '1px dashed #e6e9ed', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{i + 1}. {String(ln)}</div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {tbTab === 'changed' && (<>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: '#656d76' }}>
                    <span>รายการที่มีการเปลี่ยนแปลง {changedRecs.length} รายการ{(tbComFilter || tbBranchFilter) ? <b style={{ color: '#0969da' }}> · กำลังกรอง{tbComFilter ? ` COM ${tbComFilter}` : ''}{tbBranchFilter ? ` สาขา ${tbBranchFilter}` : ''}: แสดง {list.length} แถว (บันทึกยังรวมทุกแถว)</b> : null}</span>
                    {sameCount > 0 && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                        <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                        แสดงรายการที่ไม่เปลี่ยนแปลง ({sameCount})
                      </label>
                    )}
                  </div>

                  <div style={{ border: '1px solid #e6e9ed', borderRadius: 12, maxHeight: '52vh', overflow: 'auto', marginBottom: 16 }}>
                    {list.length === 0 ? (
                      <div style={{ padding: '26px 16px', textAlign: 'center', color: '#656d76', fontSize: 14 }}>
                        ไม่มีรายการที่ต้องตรวจ — เปิดสวิตช์ด้านบนหากต้องการดูรายการที่ไม่เปลี่ยนแปลง
                      </div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...th, textAlign: 'left', cursor: 'pointer', userSelect: 'none', color: tbBranchFilter ? '#0969da' : th.color }} title="กดเพื่อกรองสาขา" onClick={(e) => { const rc = e.currentTarget.getBoundingClientRect(); setTbBranchQ(''); setTbBranchPop(tbBranchPop ? null : { x: rc.left, y: rc.bottom + 4 }); }}>
                              สาขา <span style={{ fontSize: 10 }}>▾</span>{tbBranchFilter ? <span style={{ fontWeight: 400 }}> · {tbBranchFilter}</span> : null}
                              {tbBranchPop && (
                                <>
                                  <div onClick={(e) => { e.stopPropagation(); setTbBranchPop(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1099 }} />
                                  <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', left: tbBranchPop.x, top: tbBranchPop.y, zIndex: 1100, width: 220, background: '#fff', border: '1px solid #d0d7de', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 8, fontWeight: 400 }}>
                                    <input autoFocus value={tbBranchQ} onChange={(e) => setTbBranchQ(e.target.value)} placeholder="ค้นหาสาขา..." style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 8px', border: '1px solid #d0d7de', borderRadius: 6, marginBottom: 6, outline: 'none' }} />
                                    <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                                      {(!tbBranchQ.trim() || 'ทั้งหมด'.includes(tbBranchQ.trim())) && (
                                        <div onClick={() => { setTbBranchFilter(null); setTbBranchPop(null); }} style={{ height: 30, lineHeight: '30px', padding: '0 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6, color: '#0969da', background: !tbBranchFilter ? '#ddf0ff' : undefined }}>ทั้งหมด ({comList.length})</div>
                                      )}
                                      {branchOpts.filter((b) => !tbBranchQ.trim() || b.toLowerCase().includes(tbBranchQ.trim().toLowerCase())).map((b) => (
                                        <div key={b} onClick={() => { setTbBranchFilter(b); setTbBranchPop(null); }} style={{ height: 30, lineHeight: '30px', padding: '0 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6, background: tbBranchFilter === b ? '#ddf0ff' : undefined, color: '#1f2328' }}>{b}</div>
                                      ))}
                                    </div>
                                  </div>
                                </>
                              )}
                            </th>
                            <th style={{ ...th, textAlign: 'left' }}>CPC</th>
                            <th style={{ ...th, textAlign: 'left' }}>Account</th>
                            <th style={{ ...th, textAlign: 'left' }}>Sub Acc</th>
                            <th style={{ ...th, textAlign: 'left' }}>Description</th>
                            <th style={{ ...th, textAlign: 'right' }}>Beginning</th>
                            <th style={{ ...th, textAlign: 'right' }}>Period Activity</th>
                            <th style={{ ...th, textAlign: 'right' }}>Ending</th>
                            <th style={{ ...th, textAlign: 'left' }}>สถานะ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r, i) => {
                            const st = statusLabel(r.status);
                            // MARKER_VATRECONCILESYSTEM_TB_PREVIEW_FULL_COLS_V1 -- แสดงครบ Branch/CPC/Account/SubAcc/Description/Beginning/Period Activity/Ending ตามไฟล์ TB จริง
                            // protected_kept = DB คงยอดเดิม -> โชว์ยอดเดิมทั้ง 3 ช่อง, อื่นๆ โชว์ยอดจากไฟล์ + ค่าเดิม/ส่วนต่างเมื่อเปลี่ยน
                            const keep = r.status === 'protected_kept';
                            const cols = [
                              { n: keep ? r.old_beginning_balance : r.beginning_balance, o: r.old_beginning_balance },
                              { n: r.effective_period_activity, o: r.old_period_activity },
                              { n: keep ? r.old_ending_balance : r.ending_balance, o: r.old_ending_balance },
                            ];
                            const muted = r.status === 'unchanged';
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #f0f2f5', color: muted ? '#656d76' : undefined }}>
                                <td style={{ padding: '9px 12px' }}>{r.branch}</td>
                                <td style={{ padding: '9px 12px' }}>{r.cpc}</td>
                                <td style={{ padding: '9px 12px' }}>{r.account}</td>
                                <td style={{ padding: '9px 12px' }}>{r.subacc}</td>
                                <td style={{ padding: '9px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</td>
                                {cols.map((c, ci) => {
                                  const diff = (c.o !== null && c.o !== undefined && r.status === 'updated' && Math.abs(Number(c.n) - Number(c.o)) > 0.004) ? Number(c.n) - Number(c.o) : null;
                                  return (
                                    <td key={ci} style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                      <Money v={c.n} />
                                      {diff !== null && (
                                        <div style={{ fontSize: 11, color: '#656d76' }}>
                                          เดิม <Money v={c.o} /> <span style={{ color: diff > 0 ? '#1a7f37' : '#cf222e' }}>{diff > 0 ? '+' : ''}<Money v={diff} /></span>
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                                <td style={{ padding: '9px 12px' }}>
                                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: muted ? 500 : 600, background: muted ? '#f3f4f6' : (C[r.status === 'new' ? 'new' : r.status === 'updated' ? 'upd' : 'prot'][0]), color: muted ? '#656d76' : (C[r.status === 'new' ? 'new' : r.status === 'updated' ? 'upd' : 'prot'][1]) }}>{st.text}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  </>)}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: tbBlocked ? '#cf222e' : '#656d76', fontWeight: tbBlocked ? 600 : undefined }}>
                      {tbBlocked ? (comMissing.length ? `บันทึกไม่ได้ — COM ${comMissing.join(', ')} ไม่พบใน Company List (SEGMENT3) กรุณาเพิ่มในหน้า Business Unit ก่อน` : `บันทึกไม่ได้ — มี ${previewData.unmatchedLines.length} บรรทัดที่อ่านไม่ได้ (Error) กรุณาแก้ไฟล์ แล้วอัปโหลดใหม่`) : changedRecs.length ? `จะบันทึก ${toSave} รายการ · คงยอดเดิม ${sm.protected_kept_count || 0} รายการ` : 'ไม่มีการเปลี่ยนแปลง'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={resetAll} style={{ fontSize: 14, borderRadius: 10, padding: '9px 18px', border: '1px solid #cfd6de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
                      <button type="button" disabled={tbBlocked} onClick={handleConfirmCommit} style={{ fontSize: 14, fontWeight: 600, borderRadius: 10, padding: '9px 18px', border: '1px solid ' + (tbBlocked ? '#b6c9e3' : '#0969da'), background: tbBlocked ? '#b6c9e3' : '#0969da', color: '#fff', cursor: tbBlocked ? 'not-allowed' : 'pointer' }}>ยืนยันบันทึกลง DB</button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {fileType === 'input_summary' && (() => { // MARKER_VATRECONCILESYSTEM_INPUT_PREVIEW_REDESIGN_V1 -- หน้ายืนยัน Input Summary: เทียบกับ DB (ใหม่/ยอดเปลี่ยน/จะถูกลบ) + ซ่อนรายการที่ไม่เปลี่ยน + บล็อกบันทึกถ้า Match สาขาไม่ได้
              const sm = previewData.summary || {};
              const recs = previewData.records || [];
              const hasDiff = sm.new_count !== undefined;
              const removed = (previewData.removed_records || []).map((r) => ({ ...r, status: 'removed' }));
              const unmatchedRows = (previewData.unmatched_branches || []).map((r) => ({ ...r, status: 'bad' }));
              const changedRecs = hasDiff ? [...unmatchedRows, ...recs.filter((r) => r.status !== 'unchanged'), ...removed] : [...unmatchedRows, ...recs];
              const sameRecs = hasDiff ? recs.filter((r) => r.status === 'unchanged') : [];
              const list = showUnchanged ? [...changedRecs, ...sameRecs] : changedRecs;
              const existing = sm.existing_rows_to_replace || 0;
              const unmatchedCount = sm.unmatched_branch_count || 0;
              const blocked = unmatchedCount > 0;
              const C = { new: ['#e6f4ea', '#1a7f37'], upd: ['#ddf0ff', '#0969da'], del: ['#fff4d6', '#9a6700'], bad: ['#ffebe9', '#cf222e'] };
              const cards = [
                ['รายการใหม่', hasDiff ? sm.new_count : (sm.matched_count || 0), 'new'],
                ['ยอดเปลี่ยน (แทนที่ข้อมูลเดิม)', hasDiff ? sm.updated_count : 0, 'upd'],
                ['จะถูกลบ (ไม่อยู่ในไฟล์ใหม่)', hasDiff ? sm.removed_count : 0, 'del'],
                ['สาขาที่ Match ไม่ได้', unmatchedCount, 'bad'],
              ];
              const PILL = {
                new: ['ใหม่', 'new'], updated: ['ยอดเปลี่ยน', 'upd'], removed: ['จะถูกลบ', 'del'], bad: ['Match สาขาไม่ได้', 'bad'], unchanged: ['ไม่เปลี่ยน', null],
              };
              const chip = { display: 'inline-flex', alignItems: 'center', fontSize: 13, padding: '5px 12px', borderRadius: 999, background: '#f3f4f6' };
              const th = { position: 'sticky', top: 0, background: '#f7f8fa', padding: '9px 12px', fontSize: 12, fontWeight: 600, color: '#656d76', borderBottom: '1px solid #e6e9ed', whiteSpace: 'nowrap' };
              const noticeBase = { display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 12, padding: '12px 14px', fontSize: 14, marginBottom: 12 };
              const icon = (bg, t) => <span style={{ width: 22, height: 22, borderRadius: '50%', background: bg, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, flex: 'none' }}>{t}</span>;
              const amt = (n, o) => (o !== undefined && o !== null && Number(o) !== Number(n) ? <span><span style={{ color: '#656d76', textDecoration: 'line-through', marginRight: 6, fontSize: 12 }}><Money v={o} /></span><Money v={n} /></span> : <Money v={n} />);
              const barLabel = existing === 0 ? `รายการที่จะบันทึก ${(sm.matched_count || 0).toLocaleString()} ใบ` : `รายการที่ต่างจากเดิม ${changedRecs.length.toLocaleString()} รายการ`;
              const hint = blocked
                ? `บันทึกไม่ได้จนกว่าจะแก้ ${unmatchedCount} รายการ`
                : (existing === 0 ? `จะบันทึก ${(sm.matched_count || 0).toLocaleString()} ใบกำกับภาษี` : `จะบันทึก ${(sm.matched_count || 0).toLocaleString()} ใบ${hasDiff && sm.removed_count ? ` · ลบออก ${sm.removed_count} ใบที่ไม่อยู่ในไฟล์ใหม่` : ''}`);
              return (
                <div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    <span style={{ ...chip, background: '#ddf0ff', color: '#0969da', fontWeight: 600 }}>Input Summary</span>
                    <span style={chip}>BU&nbsp;<b>{sm.bu_list?.join(', ') || '—'}</b></span>
                    <span style={chip}>Period&nbsp;<b>{sm.period}</b></span>
                    <span style={chip}>Tax Type&nbsp;<b>{sm.tax_type}</b>&nbsp;· Account&nbsp;<b>{sm.reconcile_account}</b></span>
                    <span style={chip}>ทั้งหมด&nbsp;<b>{(sm.parsed_count || 0).toLocaleString()}</b>&nbsp;ใบกำกับภาษี</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
                    {cards.map(([label, value, k]) => (
                      <div key={k} style={{ borderRadius: 12, padding: '12px 14px', background: value ? C[k][0] : '#f3f4f6' }}>
                        <div style={{ fontSize: 12, color: '#656d76', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2, color: value ? C[k][1] : '#b6bcc4' }}>{Number(value || 0).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>

                  {blocked && (
                    <div style={{ ...noticeBase, background: '#ffebe9', color: '#82071e' }}>
                      {icon('#cf222e', '✕')}
                      <span><b>มี {unmatchedCount} ใบที่ Match สาขาไม่ได้</b> — ต้องเพิ่ม/แก้สาขาใน branch_list / Group Range ก่อน หรือแก้ไฟล์ แล้วอัปโหลดใหม่ จึงจะบันทึกได้</span>
                    </div>
                  )}

                  {sm.fallback_count > 0 && ( // MARKER_VATRECONCILE_BRANCH_FALLBACK_KEEP_ROWS_V1
                    <div style={{ ...noticeBase, background: '#ffebe9', color: '#82071e' }}>
                      {icon('#cf222e', '!')}
                      <span>สาขา {(sm.fallback_branches || []).join(', ')} ไม่พบใน branch_list / Group Range — Match BU ผ่าน TB / ไฟล์นี้แทน และเก็บเข้า Detail ครบ {sm.fallback_count} รายการ (แถวที่มี ❗ สีแดง) กรุณาเพิ่มสาขานี้ใน branch_list</span>
                    </div>
                  )}

                  {existing === 0 ? (
                    <div style={{ ...noticeBase, background: '#e6f4ea', color: '#14532d' }}>
                      {icon('#1a7f37', '✓')}
                      <span><b>ข้อมูลชุดนี้ยังไม่เคยบันทึกใน DB</b> — ใบกำกับภาษีทั้ง {(sm.matched_count || 0).toLocaleString()} ใบจะถูกบันทึกเป็นรายการใหม่ ไม่มีข้อมูลเดิมถูกแทนที่</span>
                    </div>
                  ) : (
                    <div style={{ ...noticeBase, background: '#fff4d6', color: '#5c4100' }}>
                      {icon('#9a6700', '!')}
                      <span><b>BU / Period / ประเภทภาษีนี้มีข้อมูลเดิมอยู่แล้ว {existing.toLocaleString()} ใบ</b> — การ Commit จะ<b>ลบข้อมูลเดิมทั้งหมด</b>แล้วบันทึกชุดใหม่แทนที่ (Replace ทั้งก้อน ไม่ใช่ Merge){hasDiff ? ' ด้านล่างคือรายการที่ต่างจากเดิม' : ''}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8, fontSize: 13, color: '#656d76' }}>
                    <span>{barLabel}</span>
                    {sameRecs.length > 0 && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                        <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                        แสดงรายการที่ไม่เปลี่ยน ({sameRecs.length.toLocaleString()})
                      </label>
                    )}
                  </div>

                  <div style={{ border: '1px solid #e6e9ed', borderRadius: 12, maxHeight: '52vh', overflow: 'auto', marginBottom: 16 }}>
                    {list.length === 0 ? (
                      <div style={{ padding: '26px 16px', textAlign: 'center', color: '#656d76', fontSize: 14 }}>
                        <b style={{ display: 'block', color: '#1f2328', fontSize: 15, marginBottom: 4 }}>ข้อมูลตรงกับใน DB ทั้งหมด</b>
                        ไม่มีรายการใหม่หรือยอดที่เปลี่ยน เปิดสวิตช์ด้านบนหากต้องการดูรายการที่ไม่เปลี่ยน
                      </div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...th, textAlign: 'left' }}>สาขา</th>
                            <th style={{ ...th, textAlign: 'left' }}>เลขที่ใบกำกับภาษี</th>
                            <th style={{ ...th, textAlign: 'left' }}>ชื่อผู้ค้า</th>
                            <th style={{ ...th, textAlign: 'right' }}>มูลค่าสินค้า</th>
                            <th style={{ ...th, textAlign: 'right' }}>ภาษี</th>
                            {hasDiff && <th style={{ ...th, textAlign: 'left' }}>สถานะ</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r, i) => {
                            const p = hasDiff || r.status === 'bad' ? PILL[r.status || 'new'] : null;
                            const muted = r.status === 'unchanged';
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #f0f2f5', color: muted ? '#656d76' : undefined, background: r.status === 'bad' ? '#fff8f7' : undefined }}>
                                <td style={{ padding: '9px 12px', ...(r.branch_warning ? { color: '#a30d16', fontWeight: 600 } : {}) }} title={r.branch_warning ? 'สาขานี้ไม่พบใน branch_list — ใช้ BU จาก ' + (r.branch_match_source === 'tb_fallback' ? 'TB' : 'ไฟล์นี้') : undefined}>{r.branch_warning ? '❗ ' : ''}{r.branch || '—'}</td>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{r.tax_invoice_no}</td>
                                <td style={{ padding: '9px 12px', minWidth: 280 }}>{r.vendor_name}</td>
                                <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{amt(r.claimed100_amount, r.old_claimed100_amount)}</td>
                                <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{amt(r.claimed100_vat, r.old_claimed100_vat)}</td>
                                {hasDiff && (
                                  <td style={{ padding: '9px 12px' }}>
                                    {p && <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: muted ? 500 : 600, whiteSpace: 'nowrap', background: p[1] ? C[p[1]][0] : '#f3f4f6', color: p[1] ? C[p[1]][1] : '#656d76' }}>{p[0]}</span>}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: '#656d76' }}>{hint}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={resetAll} style={{ fontSize: 14, borderRadius: 10, padding: '9px 18px', border: '1px solid #cfd6de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
                      <button type="button" disabled={blocked} onClick={handleConfirmCommit} style={{ fontSize: 14, fontWeight: 600, borderRadius: 10, padding: '9px 18px', border: '1px solid ' + (blocked ? '#b6c9e3' : '#0969da'), background: blocked ? '#b6c9e3' : '#0969da', color: '#fff', cursor: blocked ? 'not-allowed' : 'pointer' }}>ยืนยันบันทึกลง DB</button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {fileType === 'jv_journal' && (() => { // MARKER_VATRECONCILESYSTEM_JV_JOURNAL_V1 -- หน้ายืนยัน JV Journal -> ap_detailoverhead
              const d = previewData; const f = d.file || {}; const j = d.journal || {};
              const unres = d.unresolved || []; const inv = d.invalid || []; const ex = (d.existing || []).filter((e) => !(d.blocks || []).some((b) => b.com === e.com && b.account_code === e.account_code && b.status === 'unchanged')); // MARKER_VATRECONCILESYSTEM_JV_UNCHANGED_V1
              const allSame = !!d.all_unchanged; const sameBlocks = (d.blocks || []).filter((b) => b.status === 'unchanged');
              const th = { textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 };
              const SRC = { ap_reconcile: 'AP Reconcile', ie_reconcile: 'IE Reconcile' };
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 14px', background: '#e6f4ea', borderRadius: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: '#1a7f37' }}>ตรวจพบ Detail of Overhead (JV Journal) · Period {d.period}{d.period_derived ? ' (เดาจากวันที่ Journal)' : ''} · {f.name}</span>
                    <label style={{ fontSize: 12, color: '#334155', marginLeft: 'auto' }}>เปลี่ยน Period{' '}
                      <input type="month" defaultValue={d.period} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { metaRef.current = { period: e.target.value }; runPreview(pendingFileRef.current, sourceLabel); } }} style={{ fontSize: 12, padding: '2px 6px' }} />
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, fontSize: 12 }}>
                    <span style={{ padding: '4px 10px', borderRadius: 999, background: '#f1f5f9' }}>แถวทั้งไฟล์ {Number(f.row_count || 0).toLocaleString()}</span>
                    <span style={{ padding: '4px 10px', borderRadius: 999, background: '#f1f5f9' }}>Journal ที่บันทึก {Number(j.saved_count || 0).toLocaleString()} แถว · <Money v={j.total} /></span>
                    <span style={{ padding: '4px 10px', borderRadius: 999, background: f.total_match === false ? '#fdecec' : '#e6f4ea', color: f.total_match === false ? '#a30d16' : '#1a7f37' }}>
                      Total ท้ายไฟล์ {f.file_total == null ? '—' : <Money v={f.file_total} />} {f.total_match === false ? <>≠ ผลรวมที่คำนวณ <Money v={f.computed_total} /></> : f.total_match ? '✓ ตรงกับผลรวม' : ''}
                    </span>
                    {d.skipped_other_account > 0 && <span style={{ padding: '4px 10px', borderRadius: 999, background: '#fff8c5', color: '#9a6700' }}>ข้าม {d.skipped_other_account} แถว (มี Journal แต่ Account ไม่อยู่ใน 6 ตัว)</span>}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {(d.bu_breakdown || []).map((b) => (
                      <span key={`${b.com}|${b.bu}`} style={{ padding: '4px 10px', borderRadius: 999, background: '#e6f0ff', color: '#0b4fb3', fontSize: 12, fontWeight: 600 }}>
                        COM {b.com} | BU {b.bu || '—'} | BOOK {b.book || '—'} ({b.count.toLocaleString()} แถว · <Money v={b.total} />)
                      </span>
                    ))}
                  </div>

                  {allSame && (
                    <div style={{ padding: '14px 16px', background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#57606a' }}>ไม่มีการเปลี่ยนแปลง</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#57606a' }}>ข้อมูล Journal ชุดนี้มีอยู่ใน DB แล้วครบทุกแถว — ไม่ต้องบันทึก/อัปเดตซ้ำ</p>
                    </div>
                  )}
                  {!allSame && sameBlocks.length > 0 && (
                    <p style={{ fontSize: 12, color: '#57606a', margin: '0 0 12px' }}>ไม่เปลี่ยนแปลง (ไม่แตะ DB): {sameBlocks.map((b) => `COM ${b.com} / ${b.account_code} (${b.new_count} แถว)`).join(' · ')}</p>
                  )}
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 12 }}>
                    <thead><tr style={{ borderBottom: '0.5px solid #ddd' }}>
                      <th style={th}>Account</th><th style={th}>Source</th><th style={{ ...th, textAlign: 'right' }}>แถว</th><th style={{ ...th, textAlign: 'right' }}>ยอดรวม (ลบ = เครดิต)</th>
                    </tr></thead>
                    <tbody>
                      {(j.by_account || []).map((a) => (
                        <tr key={a.account_code} style={{ borderBottom: '0.5px solid #eee' }}>
                          <td style={{ padding: '6px 8px' }}>{a.account_code}</td>
                          <td style={{ padding: '6px 8px' }}>{SRC[a.source] || a.source}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{a.count.toLocaleString()}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}><Money v={a.total} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {(d.rows || []).length > 0 && (allSame || sameBlocks.length > 0) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#57606a', marginBottom: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                      แสดงรายการที่ไม่เปลี่ยนแปลง ({(d.rows || []).filter((r) => r.status === 'unchanged').length.toLocaleString()})
                    </label>
                  )}
                  {(d.rows || []).length > 0 && (() => { // MARKER_VATRECONCILESYSTEM_JV_JOURNAL_ROWS_V1 -- Detail แบบ AP: จัดกลุ่มตามสาขา (ไม่มีแถว Total) / ซ่อนก้อนที่ไม่เปลี่ยนแปลง
                    const shown = (d.rows || []).filter((r) => showUnchanged || r.status !== 'unchanged');
                    if (!shown.length) return null;
                    const sorted = [...shown].sort((x, y) => String(x.branch_code).localeCompare(String(y.branch_code)) || String(x.sub_account_code).localeCompare(String(y.sub_account_code)) || String(x.transaction_date).localeCompare(String(y.transaction_date)) || x.line_no - y.line_no);
                    const groups = []; sorted.forEach((r) => { const g = groups[groups.length - 1]; if (g && g.branch === r.branch_code) g.rows.push(r); else groups.push({ branch: r.branch_code, rows: [r] }); });
                    const H = ['Branch', 'Account', 'SubAcc', 'Journal name', 'Vendor', 'วันที่', 'Description', 'Amount'];
                    const td = { padding: '3px 8px', borderLeft: '0.5px solid #e5e7eb', borderRight: '0.5px solid #e5e7eb' };
                    return (
                      <div style={{ marginBottom: 12 }}>
                        <p style={{ fontSize: 12, color: '#57606a', margin: '0 0 6px' }}>Detail of Journal ({sorted.length.toLocaleString()} แถว · {groups.length} สาขา)</p>
                        <div style={{ maxHeight: '36vh', overflow: 'auto', border: '0.5px solid #ccc', borderRadius: 6 }}>
                          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                            <thead><tr>
                              {H.map((h, i) => <th key={h} style={{ position: 'sticky', top: 0, background: '#e8eef7', textAlign: i === 7 ? 'right' : 'left', padding: '5px 8px', color: '#334155', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid #b6c3d6' }}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {groups.map((g) => (
                                <React.Fragment key={g.branch}>
                                  {g.rows.map((r) => (
                                    <tr key={r.line_no}>
                                      <td style={{ ...td, whiteSpace: 'nowrap' }} title={r.branch_name || ''}>{r.branch_code}</td>
                                      <td style={td}>{r.account_code}</td>
                                      <td style={td}>{r.sub_account_code}</td>
                                      <td style={{ ...td, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.journal_name}>{r.journal_name}</td>
                                      <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.vendor_name || ''}>{r.vendor_name || ''}</td>
                                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.transaction_date}</td>
                                      <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description || ''}>{r.description || ''}</td>
                                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}><Money v={r.amount} /></td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {unres.length > 0 && (
                    <div style={{ padding: '10px 14px', background: '#fdecec', borderRadius: 8, marginBottom: 12 }}>
                      <p style={{ fontSize: 13, color: '#a30d16', margin: '0 0 6px', fontWeight: 600 }}>⚠️ จับ COM ไม่ได้ {unres.length} สาขา — แถวเหล่านี้จะไม่ถูกบันทึก (เพิ่ม Branch ใน Branch List / Group Range หรือ SEGMENT3 ใน Company List แล้วอัปโหลดใหม่)</p>
                      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12 }}>
                        {unres.map((u) => <div key={u.branch_code}>{u.branch_code} · {u.branch_name || ''} — {u.count} แถว · <Money v={u.total} /></div>)}
                      </div>
                    </div>
                  )}
                  {d.invalid_count > 0 && (
                    <div style={{ padding: '10px 14px', background: '#fdecec', borderRadius: 8, marginBottom: 12 }}>
                      <p style={{ fontSize: 13, color: '#a30d16', margin: '0 0 6px', fontWeight: 600 }}>⛔ มี {d.invalid_count} แถวข้อมูลไม่ครบ — บันทึกไม่ได้ กรุณาแก้ไฟล์</p>
                      <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 12 }}>{inv.map((x, i) => <div key={i}>แถว {x.line_no} · {x.branch_code} — ขาด {x.reason}</div>)}</div>
                    </div>
                  )}
                  {ex.length > 0 && (
                    <p style={{ fontSize: 12, color: '#9a6700', margin: '0 0 12px' }}>
                      ℹ️ มีข้อมูลเดิมที่จะถูกแทนที่: {ex.map((e) => `COM ${e.com} / ${e.account_code} (${e.journal_count} แถว)`).join(' · ')}
                    </p>
                  )}
                  {!allSame && <p style={{ fontSize: 12, color: '#a30d16', marginBottom: 16 }}>
                    ⚠️ การ Commit จะ<strong>ลบข้อมูลเดิม</strong>ของ COM + Period + Account นี้ก่อน แล้วบันทึกชุดใหม่แทนที่ (Replace ทั้งก้อน) · เก็บเฉพาะแถวที่มี Journal name
                  </p>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={resetAll} style={{ fontSize: 14, borderRadius: 10, padding: '9px 18px', border: '1px solid #cfd6de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
                    <button type="button" disabled={!d.can_save} onClick={handleConfirmCommit} style={{ fontSize: 14, fontWeight: 600, borderRadius: 10, padding: '9px 18px', border: '1px solid ' + (d.can_save ? '#0969da' : '#b6c9e3'), background: d.can_save ? '#0969da' : '#b6c9e3', color: '#fff', cursor: d.can_save ? 'pointer' : 'not-allowed' }}>{allSame ? 'ไม่มีการเปลี่ยนแปลง' : 'ยืนยันบันทึกลง DB'}</button>
                  </div>
                </div>
              );
            })()}

            {fileType === 'simple' && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#e6f4ea', borderRadius: '8px', marginBottom: '16px',
                }}>
                  <span style={{ fontSize: '13px', color: '#1a7f37' }}>
                    ตรวจพบ Simple Report ({previewData.simple_type}%) · BU {previewData.bu} ·
                    Period {previewData.period}
                  </span>
                </div>

                <div style={{ maxHeight: '52vh', overflowY: 'auto', marginBottom: '16px' }}>
                  <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>สาขา</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '6px 8px', color: '#666', fontWeight: 500 }}>จำนวน Invoice</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>Tax Type (ชื่อไฟล์ / กลุ่มจากวันที่)</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>Account</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '6px 8px', color: '#666', fontWeight: 500 }}>รวมมูลค่าที่ใช้สิทธิ์</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '6px 8px', color: '#666', fontWeight: 500 }}>รวมภาษี</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.branches.map((b, i) => (
                        <tr key={i} style={{ borderBottom: '0.5px solid #eee' }}>
                          <td style={{ padding: '6px 8px' }}>{b.branch}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{b.row_count}</td>
                          <td style={{ padding: '6px 8px' }}>
                            {b.tax_type_from_name || '—'} / {b.tax_type_group_from_date || '—'}
                            {b.tax_type_date_mismatch && (
                              <span style={{ color: '#9a6700' }}> ⚠️ ไม่ตรงกัน</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px' }}>{b.reconcile_account} ({b.tax_type_group})</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}><Money v={b.total_claimed_amount} /></td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}><Money v={b.total_claimed_vat} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p style={{ fontSize: '12px', color: '#a30d16', marginBottom: '16px' }}>
                  ⚠️ การ Commit จะ<strong>ลบข้อมูลเดิมทั้งหมด</strong>ของ BU/สาขา/เดือน/ประเภทภาษี/Simple Type นี้ก่อน
                  แล้วบันทึกชุดใหม่แทนที่ (Replace ทั้งก้อน ไม่ใช่ Merge)
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={resetAll} style={{ fontSize: '13px' }}>ยกเลิก</button>
                  <button
                    type="button"
                    onClick={handleConfirmCommit}
                    style={{ fontSize: '13px', borderColor: '#0969da', color: '#0969da' }}
                  >
                    ยืนยันบันทึกลง DB
                  </button>
                </div>
              </div>
            )}

            {fileType === 'ap_cutting' && (() => { // MARKER_VATRECONCILESYSTEM_AP_POPUP_V1
              const sm = previewData.summary || {};
              const ctl = previewData.control || sm.control || null;
              const rows = previewData.records || [];
              const oos = rows.filter((r) => r.status === 'out_of_scope');
              const buCounts = Object.entries(rows.reduce((m, r) => { if (r.bu) m[r.bu] = (m[r.bu] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
              const passCond = (r) => r.status === 'ok' && r.in_whitelist !== false; // เข้าเงื่อนไข = จับ BU/Book ได้ และ GL อยู่ใน 6 รหัส
              const pass = rows.filter(passCond);
              const fail = rows.filter((r) => !passCond(r));
              const whyFail = (r) => (r.status === 'out_of_scope' ? `Com ${r.com} จับ BU ไม่ได้ (ไม่อยู่ใน Group Range / company_list)` : `GL ${r.gl_account} ไม่อยู่ใน 6 รหัสที่กำหนด`);
              const num = (t) => { const x = String(t ?? '').trim(); if (!x) return 0; const neg = x.startsWith('(') && x.endsWith(')'); const v = Math.round(parseFloat(x.replace(/[(),]/g, '')) * 100) || 0; return neg ? -v : v; }; // หน่วยสตางค์ กันทศนิยมเพี้ยน
              const sumOf = (arr, k) => arr.reduce((a, r) => a + num(r[k]), 0) / 100;
              const passAmt = sumOf(pass, 'amount_raw'), failAmt = sumOf(fail, 'amount_raw');
              const passRem = sumOf(pass, 'remaining_amount_raw'), failRem = sumOf(fail, 'remaining_amount_raw');
              const TABS = [['all', 'ทั้งหมด', rows.length], ['pass', 'เข้าเงื่อนไข', pass.length], ['fail', 'ไม่เข้าเงื่อนไข', fail.length]];
              const baseShown = apTab === 'pass' ? pass : apTab === 'fail' ? fail : rows;
              const q = apQ.trim().toLowerCase();
              const shown = q ? baseShown.filter((r) => [r.invoice_no, r.supplier_code, r.supplier_name, r.branch, r.gl_account, r.sub_account, r.description].some((v) => String(v || '').toLowerCase().includes(q))) : baseShown;
              const shownAmt = sumOf(shown, 'amount_raw'), shownRem = sumOf(shown, 'remaining_amount_raw');
              const tabName = apTab === 'pass' ? 'เข้าเงื่อนไข' : apTab === 'fail' ? 'ไม่เข้าเงื่อนไข' : 'ทั้งหมด';
              const PAGE = 200;
              const pages = Math.max(1, Math.ceil(shown.length / PAGE));
              const pg = Math.min(apPage, pages - 1);
              const pageRows = shown.slice(pg * PAGE, pg * PAGE + PAGE);
              const blocked = !!ctl && ctl.ok === false;
              const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
              const th = { position: 'sticky', top: 0, background: '#e6f0ff', padding: '7px 8px', fontSize: 12, fontWeight: 600, color: '#1f3a6b', borderBottom: '1px solid #d0d7de', whiteSpace: 'nowrap', textAlign: 'left' };
              const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #eef0f2', whiteSpace: 'nowrap' };
              return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#e6f4ea', borderRadius: '8px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', color: '#1a7f37' }}>
                    ตรวจพบ Account Payable (AP Cutting) · {buCounts.length ? buCounts.map(([b, n]) => `${b} (${n.toLocaleString()})`).join(' · ') : (sm.bu || '—')} · Book {sm.book || '—'} · Period {sm.period || previewData.period || '—'}
                  </span>
                </div>

                {ctl && ( // Total AP จากไฟล์ (Total for Report) ตั้งเป็นยอดตั้งต้นไว้บนสุด แล้วยอดรายแถวต้องรวมได้เท่ากัน
                  <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', background: '#eef4ff', border: '1px solid #c9dcff', borderRadius: 8, padding: '10px 16px', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1f3a6b' }}>Total AP (Total for Report ในไฟล์)</span>
                    <span style={{ fontSize: 13 }}>Amount <b style={{ fontSize: 18 }}><Money v={ctl.file_total_amount} us /></b></span>
                    <span style={{ fontSize: 13 }}>Remaining <b style={{ fontSize: 18 }}><Money v={ctl.file_total_remaining} us /></b></span>
                    <span style={{ fontSize: 13 }}>จำนวนแถว <b style={{ fontSize: 18 }}>{(ctl.file_line_count ?? 0).toLocaleString()}</b></span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: blocked ? '#cf222e' : '#1a7f37' }}>{blocked ? '✕ รวมรายแถวไม่เท่ากับ Total AP' : '✓ รวมรายแถวเท่ากับ Total AP'}</span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ background: '#e6f4ea', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 12, color: '#1a7f37' }}>เข้าเงื่อนไข</div><div style={{ fontSize: 20, fontWeight: 600 }}>{pass.length.toLocaleString()} แถว</div><div style={{ fontSize: 12 }}><Money v={passAmt} us /></div></div>
                  <div style={{ fontSize: 18 }}>+</div>
                  <div style={{ background: '#fff4d6', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 12, color: '#9a6700' }}>ไม่เข้าเงื่อนไข</div><div style={{ fontSize: 20, fontWeight: 600 }}>{fail.length.toLocaleString()} แถว</div><div style={{ fontSize: 12 }}><Money v={failAmt} us /></div></div>
                  <div style={{ fontSize: 18 }}>=</div>
                  <div style={{ background: '#f7f7f7', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 12, color: '#666' }}>รวมทั้งไฟล์ (ข้อมูลเดิมที่จะถูกแทนที่ {(sm.existing_rows_to_replace ?? 0).toLocaleString()} แถว)</div><div style={{ fontSize: 20, fontWeight: 600 }}>{rows.length.toLocaleString()} แถว</div><div style={{ fontSize: 12 }}><Money v={passAmt + failAmt} us /> {Math.abs(passAmt + failAmt - (ctl?.file_total_amount ?? 0)) < 0.005 ? <b style={{ color: '#1a7f37' }}>ตรง Total AP</b> : <b style={{ color: '#cf222e' }}>ไม่ตรง Total AP</b>}</div></div>
                </div>

                {ctl && blocked && (
                  <div style={{ borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, background: '#ffebe9', color: '#82071e' }}>
                    <b>{blocked ? 'ยอดไม่ปิดกับไฟล์ — บันทึกไม่ได้' : 'ยอดปิดกับ Total for Report ของไฟล์'}</b>
                    <div style={{ marginTop: 4 }}>
                      Total for Report (ไฟล์): Amount <b><Money v={ctl.file_total_amount} us /></b> · Remaining <b><Money v={ctl.file_total_remaining} us /></b>
                      {' '}| รวมที่อ่านได้: Amount <b><Money v={ctl.parsed_amount_total} us /></b> · Remaining <b><Money v={ctl.parsed_remaining_total} us /></b>
                    </div>
                    <div style={{ marginTop: 2 }}>
                      เข้าเงื่อนไข <b><Money v={passAmt} us /></b> + ไม่เข้าเงื่อนไข <b><Money v={failAmt} us /></b> = <b><Money v={passAmt + failAmt} us /></b> เทียบ Total for Report <b><Money v={ctl.file_total_amount} us /></b> {Math.abs(passAmt + failAmt - (ctl.file_total_amount ?? 0)) < 0.005 ? '✓ ตรง' : '✕ ไม่ตรง'}
                      {' '}(Remaining: <b><Money v={passRem} us /></b> + <b><Money v={failRem} us /></b> = <b><Money v={passRem + failRem} us /></b> เทียบ <b><Money v={ctl.file_total_remaining} us /></b>)
                    </div>
                    <div style={{ marginTop: 2 }}>
                      จำนวนแถว: ไฟล์ {ctl.file_line_count?.toLocaleString()} = อ่านได้ {rows.length.toLocaleString()} (บันทึก {ctl.saved_line_count?.toLocaleString()} + นอก Scope {ctl.out_of_scope_count?.toLocaleString()})
                      {ctl.out_of_scope_count > 0 && <> · Com ที่จับ BU ไม่ได้: <b>{(ctl.out_of_scope_coms || []).join(', ')}</b> (ยอด <Money v={ctl.out_of_scope_amount} us />)</>}
                    </div>
                    {blocked && <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{(ctl.errors || []).map((e, i) => <li key={i}>{e}</li>)}</ul>}
                  </div>
                )}

                {(previewData.unmatchedLines || []).length > 0 && (
                  <div style={{ borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, background: '#ffebe9', color: '#82071e' }}>
                    <b>บรรทัดที่อ่านไม่ได้ {(previewData.unmatchedLines || []).length} บรรทัด (Error)</b>
                    <pre style={{ margin: '6px 0 0', maxHeight: 120, overflow: 'auto', fontSize: 11 }}>{(previewData.unmatchedLines || []).slice(0, 50).join('\n')}</pre>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #d0d7de', marginBottom: 8, alignItems: 'center' }}>
                  {TABS.map(([k, label, n]) => (
                    <button key={k} type="button" onClick={() => { setApTab(k); setApPage(0); }} style={{ padding: '7px 14px', fontSize: 13, fontWeight: apTab === k ? 600 : 500, cursor: 'pointer', background: 'none', border: 'none', borderBottom: apTab === k ? '2px solid #0969da' : '2px solid transparent', color: apTab === k ? '#0969da' : '#57606a' }}>
                      {label} <span style={{ opacity: 0.7 }}>({n.toLocaleString()})</span>
                    </button>
                  ))}
                  <input type="text" value={apQ} onChange={(e) => { setApQ(e.target.value); setApPage(0); }} placeholder="ค้นหา Invoice / Supplier / Branch" style={{ marginLeft: 'auto', width: 240, fontSize: 12, padding: '5px 8px', border: '1px solid #d0d7de', borderRadius: 6 }} />
                </div>

                <div style={{ maxHeight: '52vh', overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['#', 'BU', 'Branch', 'CPC', 'SubAcc', 'Supplier Number &Name', 'Invoice Number', 'Invoice Date', 'Curr', 'Amount', 'Remaining Amount', 'Invoice Description', 'สถานะ'].map((h) => (
                          <th key={h} style={{ ...th, textAlign: ['Amount', 'Remaining Amount'].includes(h) ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r) => (
                        <tr key={r.row_no} style={{ background: passCond(r) ? undefined : '#fff4d6' }}>
                          <td style={{ ...td, color: '#8c959f' }}>{r.row_no}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{r.bu || '—'}</td>
                          <td style={td}>{r.branch}</td>
                          <td style={td}>{r.gl_account}</td>
                          <td style={td}>{r.sub_account}</td>
                          <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${r.supplier_code || ''} : ${r.supplier_name || ''}`}>{r.supplier_code} : {r.supplier_name}</td>
                          <td style={td}>{r.invoice_no}</td>
                          <td style={td}>{r.invoice_date}</td>
                          <td style={td}>{r.currency}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.amount_raw}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.remaining_amount_raw}</td>
                          <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.description}>{r.description}</td>
                          <td style={{ ...td, color: passCond(r) ? '#1a7f37' : '#9a6700' }} title={passCond(r) ? '' : whyFail(r)}>
                            {passCond(r) ? 'เข้าเงื่อนไข' : `ไม่เข้า: ${whyFail(r)}`}
                          </td>
                        </tr>
                      ))}
                      {pageRows.length === 0 && <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: '#8c959f', padding: 16 }}>ไม่มีรายการ</td></tr>}
                    </tbody>
                    {ctl && (
                      <tfoot>
                        <tr style={{ background: '#f1f5ff', fontWeight: 600 }}>
                          <td colSpan={9} style={{ ...td, textAlign: 'right', position: 'sticky', bottom: 0, background: '#f1f5ff' }}>Total {tabName} ({shown.length.toLocaleString()} แถว)</td>
                          <td style={{ ...td, textAlign: 'right', position: 'sticky', bottom: 0, background: '#f1f5ff' }}><Money v={shownAmt} us /></td>
                          <td style={{ ...td, textAlign: 'right', position: 'sticky', bottom: 0, background: '#f1f5ff' }}><Money v={shownRem} us /></td>
                          <td colSpan={2} style={{ ...td, position: 'sticky', bottom: 0, background: '#f1f5ff', color: blocked ? '#cf222e' : '#1a7f37' }}>{apTab === 'all' ? (Math.abs(shownAmt - (ctl.file_total_amount ?? 0)) < 0.005 ? '= Total for Report ✓' : 'ไม่ตรงกับ Total for Report') : `จาก Total for Report ${fmt(ctl.file_total_amount)}`}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 12px', fontSize: 12, color: '#57606a' }}>
                  <span>แสดง {shown.length === 0 ? 0 : pg * PAGE + 1}–{Math.min((pg + 1) * PAGE, shown.length)} จาก {shown.length.toLocaleString()} แถว</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button type="button" disabled={pg === 0} onClick={() => setApPage(pg - 1)} style={{ fontSize: 12 }}>ก่อนหน้า</button>
                    <span>หน้า {pg + 1} / {pages}</span>
                    <button type="button" disabled={pg >= pages - 1} onClick={() => setApPage(pg + 1)} style={{ fontSize: 12 }}>ถัดไป</button>
                  </span>
                </div>

                <p style={{ fontSize: '12px', color: '#a30d16', marginBottom: '12px' }}>
                  ⚠️ การ Commit จะ<strong>ลบข้อมูลเดิมทั้งหมด</strong>ของ BU/เดือนนี้ก่อน แล้วบันทึกข้อมูลใหม่ (Replace ทั้งก้อน ไม่ใช่ Merge) · แถว "นอก Scope" จะไม่ถูกบันทึก
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {blocked && <span style={{ fontSize: 12, color: '#cf222e' }}>บันทึกไม่ได้ — ยอด/จำนวนแถวไม่ปิดกับไฟล์ (Error)</span>}
                  <button type="button" onClick={resetAll} style={{ fontSize: '13px' }}>ยกเลิก</button>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={handleConfirmCommit}
                    style={{ fontSize: '13px', borderColor: blocked ? '#d0d7de' : '#0969da', color: blocked ? '#8c959f' : '#0969da', cursor: blocked ? 'not-allowed' : 'pointer' }}
                  >
                    ยืนยันบันทึกลง DB
                  </button>
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {stage === 'committing' && (
        <div style={{ padding: '12px 14px', background: '#f7f7f7', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px' }}>กำลังบันทึกข้อมูล...</span>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <p style={{ fontSize: '14px', margin: '10px 0 0', color: '#1a7f37' }}>
            บันทึก{fileType === 'tb' ? ' vat_reconcile_tb ' : fileType === 'simple' ? ' vat_reconcile_simple ' : fileType === 'ap_cutting' ? ' ap_cutting_staging ' : fileType === 'jv_journal' ? ' ap_detailoverhead ' : ' vat_reconcile_input_summary '}เรียบร้อย
          </p>
          <button type="button" onClick={resetAll} style={{ marginTop: '12px', fontSize: '13px' }}>
            อัปโหลดไฟล์อื่นต่อ
          </button>
        </div>
      )}
    </div>
  );
}
