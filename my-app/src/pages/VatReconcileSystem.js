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
};

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
  const [errorMessage, setErrorMessage] = useState('');

  const resetAll = useCallback(() => {
    setStage('idle');
    setSourceLabel('');
    setFileType(null);
    setPreviewData(null);
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
      } else if (apiModule === 'vat-reconcile' && /\.(xlsx|tsv)$/i.test(file.name)) { // MARKER_VATRECONCILESYSTEM_IS_XLSX_V1 -- .xlsx ที่ไม่ใช่ Simple = TB ที่ตัดแล้ว หรือ Input Summary ที่ Confirm แล้ว (เดาจากชื่อไฟล์ก่อน ถ้า Backend ตรวจหัวคอลัมน์แล้วไม่ใช่ -> ลองอีกชนิด)
        type = /Input[ _]+Summary/i.test(file.name) || !/(^|[^A-Za-z])TB([^A-Za-z]|$)/i.test(file.name) ? 'input_summary' : 'tb';
      } else {
        const headText = await readFileHead(file);
        type = detectFileType(headText);
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
        data = await callReconcileApi(ENDPOINTS[type].preview, formData, apiModule); // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
      } catch (e1) {
        const other = type === 'input_summary' ? 'tb' : type === 'tb' ? 'input_summary' : null;
        if (e1?.code === 'UNKNOWN_FORMAT' && other && /\.(xlsx|tsv)$/i.test(file.name)) { // ไม่ใช่ชนิดที่เดา -> ลองอีกชนิด
          type = other;
          setFileType(type);
          try { data = await callReconcileApi(ENDPOINTS[type].preview, formData, apiModule); } catch (e2) { e2.fileType = type; throw e2; }
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
    const isTsv = apiModule === 'vat-reconcile' && text.includes('\t'); // Copy จาก Excel = คั่นด้วย Tab -> Backend ใช้ Logic เดียวกับไฟล์ .xlsx ที่ตัดแล้ว
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
      const data = await callReconcileApi(ENDPOINTS[fileType].commit, formData, apiModule); // MARKER_VATRECONCILESYSTEM_APIMODULE_PROP_V1
      setStage('done');
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
      {stage === 'idle' && apiModule === 'vat-reconcile' && ( // MARKER_VATRECONCILESYSTEM_PASTE_TAB_V1
        <div style={{ display: 'flex', marginBottom: 10 }}>
          {[['file', '📎 แนบไฟล์ / ลากไฟล์'], ['paste', '📋 วาง Text จาก Excel / Notepad']].map(([k, label], ix) => (
            <button
              key={k}
              type="button"
              onClick={() => setInputMode(k)}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${inputMode === k ? '#1a7f37' : '#d0d7de'}`, borderLeft: ix ? (inputMode === k ? '1px solid #1a7f37' : 'none') : `1px solid ${inputMode === k ? '#1a7f37' : '#d0d7de'}`,
                borderRadius: ix ? '0 8px 8px 0' : '8px 0 0 8px', // MARKER_VATRECONCILESYSTEM_TAB_GREEN_V1 -- Tab ที่เลือกเป็นเขียว (โทนเดียวกับปุ่ม Reconcile)
                background: inputMode === k ? '#1a7f37' : '#fff', color: inputMode === k ? '#fff' : '#24292f',
              }}
            >{label}</button>
          ))}
        </div>
      )}

      {stage === 'idle' && apiModule === 'vat-reconcile' && inputMode === 'paste' && (
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
            <button
              type="button"
              disabled={!pasteText.trim()}
              onClick={() => submitPastedText(pasteText, 'ข้อมูลที่วาง')}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#0969da', color: '#fff', cursor: 'pointer', opacity: pasteText.trim() ? 1 : 0.5 }}
            >ตรวจสอบข้อมูล</button>
            <button
              type="button"
              disabled={!pasteText}
              onClick={() => setPasteText('')}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid #d0d7de', background: '#fff', cursor: 'pointer', opacity: pasteText ? 1 : 0.5 }}
            >ล้าง</button>
            <span style={{ fontSize: 12, color: '#6e7781' }}>{pasteText ? `${pasteText.split(/\r?\n/).filter((l) => l.trim()).length.toLocaleString()} บรรทัด` : ''}</span>
          </div>
        </div>
      )}

      {stage === 'idle' && !(apiModule === 'vat-reconcile' && inputMode === 'paste') && (
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
            width: fileType === 'input_summary' ? 1080 : 720, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', // MARKER_VATRECONCILESYSTEM_INPUT_PREVIEW_WIDE_V1 -- Input Summary มีหลายคอลัมน์ ขยายกล่องให้ไม่ต้องเลื่อนแนวนอน
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
              const list = showUnchanged ? recs : changedRecs;
              const toSave = (sm.new_count || 0) + (sm.updated_count || 0);
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
                    <span style={chip}>BU&nbsp;<b>{sm.bu}</b>{sm.bu_short ? <span style={{ color: '#656d76' }}>&nbsp;· {sm.bu_short}</span> : null}</span>
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

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: '#656d76' }}>
                    <span>รายการที่มีการเปลี่ยนแปลง {changedRecs.length} รายการ</span>
                    {sameCount > 0 && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                        <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                        แสดงรายการที่ไม่เปลี่ยนแปลง ({sameCount})
                      </label>
                    )}
                  </div>

                  <div style={{ border: '1px solid #e6e9ed', borderRadius: 12, maxHeight: '36vh', overflow: 'auto', marginBottom: 16 }}>
                    {list.length === 0 ? (
                      <div style={{ padding: '26px 16px', textAlign: 'center', color: '#656d76', fontSize: 14 }}>
                        ไม่มีรายการที่ต้องตรวจ — เปิดสวิตช์ด้านบนหากต้องการดูรายการที่ไม่เปลี่ยนแปลง
                      </div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...th, textAlign: 'left' }}>สาขา</th>
                            <th style={{ ...th, textAlign: 'left' }}>Account</th>
                            <th style={{ ...th, textAlign: 'right' }}>ยอดเดิม</th>
                            <th style={{ ...th, textAlign: 'right' }}>ยอดใหม่</th>
                            <th style={{ ...th, textAlign: 'left' }}>สถานะ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r, i) => {
                            const st = statusLabel(r.status);
                            const o = r.old_period_activity, n = r.effective_period_activity;
                            const diff = (o !== null && o !== undefined && r.status !== 'unchanged') ? Number(n) - Number(o) : null;
                            const muted = r.status === 'unchanged';
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #f0f2f5', color: muted ? '#656d76' : undefined }}>
                                <td style={{ padding: '9px 12px' }}>{r.branch}</td>
                                <td style={{ padding: '9px 12px' }}>{r.account}</td>
                                <td style={{ padding: '9px 12px', textAlign: 'right', color: '#656d76' }}>{formatNumber(o)}</td>
                                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                                  {formatNumber(n)}
                                  {diff !== null && diff !== 0 && (
                                    <span style={{ fontSize: 12, marginLeft: 6, color: diff > 0 ? '#1a7f37' : '#cf222e' }}>{diff > 0 ? '+' : ''}{formatNumber(diff)}</span>
                                  )}
                                </td>
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

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: '#656d76' }}>
                      {changedRecs.length ? `จะบันทึก ${toSave} รายการ · คงยอดเดิม ${sm.protected_kept_count || 0} รายการ` : 'ไม่มีการเปลี่ยนแปลง'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={resetAll} style={{ fontSize: 14, borderRadius: 10, padding: '9px 18px', border: '1px solid #cfd6de', background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
                      <button type="button" onClick={handleConfirmCommit} style={{ fontSize: 14, fontWeight: 600, borderRadius: 10, padding: '9px 18px', border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: 'pointer' }}>ยืนยันบันทึกลง DB</button>
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
              const amt = (n, o) => (o !== undefined && o !== null && Number(o) !== Number(n) ? <span><span style={{ color: '#656d76', textDecoration: 'line-through', marginRight: 6, fontSize: 12 }}>{formatNumber(o)}</span>{formatNumber(n)}</span> : formatNumber(n));
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

                  <div style={{ border: '1px solid #e6e9ed', borderRadius: 12, maxHeight: '36vh', overflow: 'auto', marginBottom: 16 }}>
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

                <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: '16px' }}>
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
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatNumber(b.total_claimed_amount)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatNumber(b.total_claimed_vat)}</td>
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

            {fileType === 'ap_cutting' && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#e6f4ea', borderRadius: '8px', marginBottom: '16px',
                }}>
                  <span style={{ fontSize: '13px', color: '#1a7f37' }}>
                    ตรวจพบ Account Payable (AP Cutting) · BU {previewData.summary?.bu || previewData.bu || '—'} ·
                    Period {previewData.summary?.period || previewData.period || '—'}
                  </span>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: '20px',
                }}>
                  {[
                    { label: 'Record ที่ Parse ได้', value: previewData.summary?.parsed_count ?? previewData.summary?.total_count },
                    { label: 'Match BU สำเร็จ', value: previewData.summary?.matched_count },
                    { label: 'ข้อมูลเดิมที่จะถูกแทนที่', value: previewData.summary?.existing_rows_to_replace, warn: true },
                    { label: 'สาขาที่ Match ไม่ได้', value: previewData.summary?.unmatched_branch_count, warn: true },
                  ].map((item, i) => (
                    <div key={i} style={{ background: '#f7f7f7', borderRadius: '8px', padding: '1rem' }}>
                      <p style={{ fontSize: '13px', color: '#666', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '24px', fontWeight: 500, margin: 0, color: item.warn && item.value > 0 ? '#9a6700' : undefined }}>
                        {item.value ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>

                <p style={{ fontSize: '12px', color: '#a30d16', marginBottom: '16px' }}>
                  ⚠️ การ Commit จะ<strong>ลบข้อมูลเดิมทั้งหมด</strong>ของ BU/เดือนนี้ก่อน แล้วบันทึกชุดใหม่แทนที่
                  (Replace ทั้งก้อน ไม่ใช่ Merge)
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
            บันทึก{fileType === 'tb' ? ' vat_reconcile_tb ' : fileType === 'simple' ? ' vat_reconcile_simple ' : fileType === 'ap_cutting' ? ' ap_cutting_staging ' : ' vat_reconcile_input_summary '}เรียบร้อย
          </p>
          <button type="button" onClick={resetAll} style={{ marginTop: '12px', fontSize: '13px' }}>
            อัปโหลดไฟล์อื่นต่อ
          </button>
        </div>
      )}
    </div>
  );
}
