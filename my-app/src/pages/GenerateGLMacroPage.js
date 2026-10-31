// GenerateGLMacroPage.js
// MARKER_GL_GENERATE_MACRO_PAGE_V1
// ─────────────────────────────────────────────────────────────────────────
// เมนู GL Functional > Reconcile > "Generate by GL Macro"
// หน้าตา/Flow เหมือน "Generate by Macro Logic" ของ I-Expense (จุดโยนไฟล์ + ตาราง Job My/All)
// ต่างกันที่: ไม่มี Mail Manage | ระบบจับรูปแบบรายงานเองจากเนื้อไฟล์ (GL_MACRO_TYPES)
//   ตอนนี้รองรับ: Vendor Payment History Report (NEW) -> พอร์ตจาก M_Vendor Payment History Summary.xlsm
//
// Flow: โยนไฟล์/Paste -> detectGlMacroType -> parse (ฝั่ง Browser) -> สร้าง .xlsx ด้วย ExcelJS
//       -> POST /file-storage/generate-raw (module 'gl-macro', เก็บ 48 ชม.) -> รายการ Job
// Preview: อ่านไฟล์กลับมาแสดง + ค้นหา + ติ๊กเลือกแถว -> "สร้างไฟล์ใหม่เฉพาะที่เลือก" (แทน Track/Add Data เดิม)
// ─────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useMemo } from 'react';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { apiFetch } from '../api';
import JSZip from 'jszip'; // MARKER_GL_MACRO_IB_HOSPITAL_V1 -- แตก ZIP (มากับ exceljs อยู่แล้ว)
import { useDataCache } from '../contexts/DataCacheContext';
import {
  detectGlMacroType, parseVendorPaymentHistory, GL_MACRO_TYPES, GL_MACRO_TYPE_LABEL,
  GL_VPH_COLUMNS, formatOraDate, parseOraDate,
} from '../lib/GL-MacroLogic';
import {
  HOSPITAL_TYPE_LABEL, HOSPITAL_MIN_SCORE, HOSPITAL_MAYBE_SCORE, scoreHospitalAoa, parseHospitalAoa,
  periodOptions, accountingDate, buildIbHospital, IB_ADI_COLUMNS, parsePeriod, resolveBuByCom,
} from '../lib/GL-MacroHospital';

const MODULE_KEY = 'gl-macro';
const RETENTION_HOURS = 48;
const INPUT_AREA_HEIGHT = '210px'; // ความสูงพื้นที่นำเข้า ล็อกเท่ากันทั้ง 2 Tab ไม่ให้ตารางด้านล่างขยับตอนสลับ Tab

const pad2 = (n) => String(n).padStart(2, '0');
const IB_EX_COLUMNS = [ // MARKER_GL_MACRO_IB_HOSPITAL_V1 -- คอลัมน์ไฟล์ข้อยกเว้น (ไม่ใช่ IB / จับคู่ BU ไม่ได้)
  { key: 'file', header: 'ไฟล์' }, { key: 'hospital', header: 'โรงพยาบาล' }, { key: 'invoice', header: 'Invoice' },
  { key: 'reason', header: 'เหตุผล' }, { key: 'amount', header: 'ยอดรวม', type: 'amount' },
];

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const fmtMoney = (n) => (typeof n === 'number' ? n : Number(n) || 0)
  .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDT = (v) => v
  ? new Date(v).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-';

function buildFileName(bu, now = new Date()) {
  const yy = String(now.getFullYear()).slice(-2);
  return `${bu}_InvoiceHistory_${yy}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.${pad2(now.getHours())}${pad2(now.getMinutes())}.xlsx`;
}

export default function GenerateGLMacroPage({ currentUser, userName = '', isOwner, isAdmin }) {
  const { getCached, fetchCollection } = useDataCache();

  const [dragOver, setDragOver] = useState(false);
  const [mainTab, setMainTab] = useState('mine'); // 'mine' | 'all'
  const [jobs, setJobs] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [statusList, setStatusList] = useState([]); // แถบสถานะใต้ Dropzone: [{ id, source, typeLabel, state, message }]
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEntry, setPreviewEntry] = useState(null); // { job, rows, meta }
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(null);
  const [jobSel, setJobSel] = useState(() => new Set()); // MARKER_GLMACRO_JOB_BULK_DELETE_V1 -- ติ๊กหลายรายการแล้วกด Delete
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [jobSearch, setJobSearch] = useState(''); // ค้นหา Job (BU / ชื่อไฟล์ / ผู้ Generate)
  const [jobTypeFilter, setJobTypeFilter] = useState('all'); // all | vph | ibh | ibx
  const [previewField, setPreviewField] = useState('invoiceNumber');
  const [previewSearch, setPreviewSearch] = useState('');
  const [srcJobs, setSrcJobs] = useState([]); // MARKER_GLMACRO_ORIGINAL_STORE_V1 -- ไฟล์ต้นทาง (Original) ที่เก็บไว้ ref_id = IBS|<refId ของไฟล์ ADI>|<ลำดับ> อายุ/การลบเท่าไฟล์ ADI
  const [srcView, setSrcView] = useState(null); // { name, loading, error, sheets, sheet, aoa, jobId }
  const [showSrc, setShowSrc] = useState(false); // Monitor ไฟล์ต้นทาง (Original) ของ Hospital IB
  const [picked, setPicked] = useState(() => new Set()); // index ของแถวที่ติ๊กเลือกใน Preview
  const [regenBusy, setRegenBusy] = useState(false);
  const [scrollTop, setScrollTop] = useState(0); // MARKER_GL_MACRO_PREVIEW_VIRTUAL_V1 -- Preview แสดงเฉพาะแถวที่มองเห็น (Virtual scroll) เปิดเร็วแม้หลายพันแถว
  const previewScrollRef = useRef(null);
  const PREVIEW_ROW_H = 36;
  const [previewFull, setPreviewFull] = useState(true); // MARKER_GL_MACRO_PREVIEW_FULLSCREEN_V1 -- Preview เต็มจอเป็นค่าเริ่มต้น กดปุ่มเพื่อย่อ/ขยาย
  const [inputTab, setInputTab] = useState('file'); // 'file' | 'text'  MARKER_GL_MACRO_INPUT_TABS_V1
  const periodList = useMemo(() => periodOptions(new Date()), []); // MARKER_GL_MACRO_IB_HOSPITAL_V1
  const [hpPeriod, setHpPeriod] = useState(() => periodOptions(new Date())[1] || ''); // เดือนปัจจุบัน (รายการเรียงใหม่->เก่า: [0]=เดือนหน้า [1]=เดือนปัจจุบัน)
  const pasteHandlerRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const statusSeq = useRef(0);

  useEffect(() => {
    try { fetchCollection('BranchList'); } catch (e) { /* ไม่มี Cache -> ข้าม */ }
    try { if (!getCached('CompanyList')) fetchCollection('CompanyList').catch(() => {}); } catch (e) { /* ข้าม */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Job List ──────────────────────────────────────────────────────────────
  const loadJobs = async () => {
    setLoadingList(true);
    try {
      const data = await apiFetch(`/file-storage/gl-macro-jobs?scope=${mainTab}`);
      const all0 = Array.isArray(data) ? data : [];
      setSrcJobs(all0.filter(j => String(j.ref_id || '').startsWith('IBS|')));
      setJobs(all0.filter(j => !String(j.ref_id || '').startsWith('IBS|'))); // ไฟล์ต้นทางไม่โชว์เป็น Job
    } catch (err) {
      console.error('[GL-Macro] โหลด Job List ไม่สำเร็จ:', err.message);
      setJobs([]);
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { loadJobs(); }, [mainTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── หา BU จาก Branch Code ที่เจอในรายงาน (Branch Master) ────────────────────
  const resolveBu = (codes) => {
    const branchItems = getCached('BranchList') || [];
    const list = (codes || []).filter(Boolean);
    if (!branchItems.length || !list.length) return '';
    const bus = [...new Set(list.map(code => {
      const found = branchItems.find(b => String(b['Branch Code'] || '').trim() === code);
      return found ? String(found['BU Code'] || found['bu'] || '').trim() : '';
    }).filter(Boolean))];
    if (!bus.length) return '';
    return bus.length === 1 ? bus[0] : `${bus[0]}+${bus.length - 1}`;
  };
  const companyOf = (bu) => {
    const items = getCached('CompanyList') || [];
    const c = items.find(x => String(x['bu'] || '').trim() === String(bu || '').split('+')[0]);
    return { name: c ? String(c['Company Name'] || '').trim() : '', taxId: c ? String(c['Tax ID'] || '').trim() : '' };
  };

  // ── สร้าง Workbook (หน้าตาเหมือนชีต Pre-Export / AP07 ของ Macro เดิม: หัวรายงาน 5 บรรทัด, หัวตารางแถว 6, ข้อมูลตั้งแต่แถว 7) ──
  const buildWorkbookBuffer = async (rows, head, rec) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('AP07');
    ws.getCell('A1').value = 'REPORT';
    ws.getCell('B1').value = 'Vendor Payment History (NEW)';
    ws.getCell('A2').value = 'BU CODE';
    ws.getCell('B2').value = head.bu || '';
    ws.getCell('A3').value = 'ชื่อผู้ประกอบการ';
    ws.getCell('B3').value = head.company || '';
    ws.getCell('A4').value = 'Tax ID';
    ws.getCell('B4').value = head.taxId ? String(head.taxId) : '';
    ws.getCell('A5').value = 'Period';
    ws.getCell('B5').value = head.period || '';
    [1, 2, 3, 4, 5].forEach(r => { ws.getCell(`A${r}`).font = { bold: true }; });

    const headerRow = ws.getRow(6);
    GL_VPH_COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    rows.forEach((r, idx) => {
      const row = ws.getRow(7 + idx);
      GL_VPH_COLUMNS.forEach((c, i) => {
        let v = r[c.key];
        if (c.type === 'date') v = (v instanceof Date && !isNaN(v)) ? v : (v ? String(v) : '');
        row.getCell(i + 1).value = v == null ? '' : v;
        if (c.type === 'amount') row.getCell(i + 1).numFmt = '#,##0.00';
        if (c.type === 'date') row.getCell(i + 1).numFmt = 'dd-mmm-yy';
      });
    });
    GL_VPH_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    ws.views = [{ state: 'frozen', ySplit: 6 }];

    // ชีต Reconcile: เทียบยอดรวมที่พิมพ์ในรายงาน (Report Total / Vendor Total) กับยอด Amount Paid ที่ดึงได้
    if (rec && rec.reportTotal != null) {
      const rs = wb.addWorksheet('Reconcile');
      rs.getCell('A1').value = 'Report Total (ตามรายงาน)'; rs.getCell('B1').value = rec.reportTotal;
      rs.getCell('A2').value = 'รวมยอดการจ่ายเงิน (Functional บาท) ที่ดึงได้'; rs.getCell('B2').value = rec.paymentTotal;
      rs.getCell('A3').value = 'ผลต่าง (ระดับการจ่ายเงิน)'; rs.getCell('B3').value = rec.paymentDiff;
      rs.getCell('A4').value = 'รวม Total Inv. ของรายการบิล (สกุลเดิมของบิล)'; rs.getCell('B4').value = rec.parsedTotal;
      rs.getCell('A5').value = 'หมายเหตุ'; rs.getCell('B5').value = 'ยอดรายงานคิดจากการจ่ายเงินเป็นบาท (Functional Amount) บิลสกุลต่างประเทศจึงมียอดรายการไม่เท่ากับ Report Total';
      [1, 2, 3, 4, 5].forEach(r => { rs.getCell(`A${r}`).font = { bold: true }; });
      ['B1', 'B2', 'B3', 'B4'].forEach(a => { rs.getCell(a).numFmt = '#,##0.00'; });
      const hdr = ['Vendor Number', 'Name', 'Vendor Total (รายงาน)', 'รวมการจ่ายเงิน (บาท)', 'ผลต่างการจ่ายเงิน', 'รวม Total Inv. รายการบิล', 'ผลต่างรายการบิล', 'Cur', 'จำนวนรายการ'];
      hdr.forEach((h, i) => {
        const c = rs.getRow(7).getCell(i + 1); c.value = h;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });
      rec.vendors.forEach((v, i) => {
        const row = rs.getRow(8 + i);
        [v.vendorNumber, v.name, v.vendorTotal, v.payFunctional, v.payDiff, v.parsed, v.diff, v.curs.join(','), v.count].forEach((val, j) => { row.getCell(j + 1).value = val; });
        [3, 4, 5, 6, 7].forEach(j => { row.getCell(j).numFmt = '#,##0.00'; });
        if (Math.abs(v.payDiff) > 0.05) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } }; });
        else if (Math.abs(v.diff) > 0.005) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; });
      });
      // ชีต Payments: รายการจ่ายเงินที่ใช้เทียบ (Functional Amount = บาท)
      const ps = wb.addWorksheet('Payments');
      ['Vendor Number', 'Name', 'Site', 'Account Name', 'Payment Number', 'Payment Date', 'Payment Amount', 'Cur', 'Functional Amount (บาท)', 'Document Name'].forEach((h, i) => {
        const c = ps.getRow(1).getCell(i + 1); c.value = h;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });
      rec.payments.forEach((x, i) => {
        const row = ps.getRow(2 + i);
        [x.vendorNumber, x.name, x.site, x.account, x.paymentNumber, x.paymentDate, x.paymentAmount, x.cur, x.functional, x.documentName].forEach((val, j) => { row.getCell(j + 1).value = val; });
        row.getCell(7).numFmt = '#,##0.00'; row.getCell(9).numFmt = '#,##0.00';
      });
      [16, 40, 16, 16, 16, 14, 18, 6, 22, 28].forEach((w, i) => { ps.getColumn(i + 1).width = w; });
      [16, 44, 22, 22, 18, 24, 18, 8, 14].forEach((w, i) => { rs.getColumn(i + 1).width = w; });
      rs.getColumn(1).width = 46;
    }
    return wb.xlsx.writeBuffer();
  };

  const uploadWorkbook = async (buffer, bu, fileName, refPrefix = 'VPH') => {
    const refId = `${refPrefix}|${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await apiFetch('/file-storage/generate-raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: MODULE_KEY, bu: bu || 'UnknownBU', refId, fileName, fileBase64: arrayBufferToBase64(buffer),
        retentionDays: RETENTION_HOURS / 24,
      }),
    });
    return refId;
  };
  // MARKER_GLMACRO_ORIGINAL_STORE_V1 -- เก็บไฟล์ต้นทางจริงของแต่ละใบ (อายุเท่าไฟล์ ADI เพราะใช้ retentionDays เดียวกัน ลบพร้อมกัน)
  const uploadSourceOriginals = async (parentRef, bu, files, bufByName) => {
    for (let i = 0; i < files.length; i++) {
      try {
        const nm = files[i].file; const buf = bufByName.get(nm);
        if (!buf || buf.byteLength > 20 * 1024 * 1024) continue;
        await apiFetch('/file-storage/generate-raw', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: MODULE_KEY, bu: bu || 'UnknownBU', refId: `IBS|${parentRef}|${i}`, fileName: nm, fileBase64: arrayBufferToBase64(buf), retentionDays: RETENTION_HOURS / 24 }),
        });
      } catch (e) { console.error('[GL-Macro] เก็บไฟล์ต้นทางไม่สำเร็จ:', e.message); }
    }
  };

  // ── แถบสถานะใต้ Dropzone ───────────────────────────────────────────────────
  const addStatus = (item) => {
    const id = ++statusSeq.current;
    setStatusList(prev => [{ id, ...item }, ...prev].slice(0, 6));
    return id;
  };
  const patchStatus = (id, patch) => setStatusList(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));

  // ── ประมวลผลข้อความหนึ่งชุด: จับรูปแบบ -> Parse -> Generate -> อัปโหลด ────────
  const processText = async (text, sourceLabel) => {
    const type = detectGlMacroType(text);
    if (!type) {
      addStatus({ source: sourceLabel, typeLabel: '', state: 'error', message: 'ไม่รู้จักรูปแบบรายงานนี้ -- ข้ามไฟล์นี้ (รองรับ: Vendor Payment History Report (NEW))' });
      return;
    }
    const typeLabel = GL_MACRO_TYPE_LABEL[type];
    if (type === GL_MACRO_TYPES.VENDOR_PAYMENT_HISTORY_OLD) {
      addStatus({ source: sourceLabel, typeLabel, state: 'error', message: 'รายงานรุ่นเก่า (APCRC039) ไม่รองรับ -- ใช้ "Vendor Payment History Report (Custom) (New)" (APCRC305) เท่านั้น' });
      return;
    }
    const sid = addStatus({ source: sourceLabel, typeLabel, state: 'working', message: 'กำลังแปลง ...' });
    await new Promise(r => setTimeout(r, 30)); // ให้แถบสถานะวาดก่อนเริ่มงานหนัก (parse + สร้างไฟล์)
    try {
      if (type === GL_MACRO_TYPES.VENDOR_PAYMENT_HISTORY) {
        const { rows, meta } = parseVendorPaymentHistory(text);
        if (meta.error) { patchStatus(sid, { state: 'error', message: meta.error }); return; }
        const bu = resolveBu(meta.branchCodes) || 'UnknownBU';
        const co = companyOf(bu);
        const head = { bu, company: co.name, taxId: co.taxId, period: [meta.startDate, meta.endDate].filter(Boolean).join(' ถึง ') };
        const buffer = await buildWorkbookBuffer(rows, head, meta.reconcile);
        await uploadWorkbook(buffer, bu, buildFileName(bu));
        const rec = meta.reconcile;
        let recMsg = '';
        let recOk = true;
        if (rec && rec.reportTotal != null) {
          const payOk = Math.abs(rec.paymentDiff) < 0.05;
          recOk = payOk;
          recMsg = payOk
            ? ` · ✔ ยอดการจ่ายเงิน ${fmtMoney(rec.paymentTotal)} ตรงกับ Report Total ${fmtMoney(rec.reportTotal)}`
            : ` · ⚠ Report Total ${fmtMoney(rec.reportTotal)} | ดึงการจ่ายเงินได้ ${fmtMoney(rec.paymentTotal)} | ต่าง ${fmtMoney(rec.paymentDiff)} ดูชีต Reconcile`;
        }
        patchStatus(sid, { state: recOk ? 'done' : 'warn', message: `สำเร็จ ${rows.length.toLocaleString()} รายการ (BU ${bu})${recMsg}` });
        if (mainTab !== 'mine') setMainTab('mine'); else await loadJobs();
      }
    } catch (err) {
      patchStatus(sid, { state: 'error', message: 'ไม่สำเร็จ: ' + err.message });
    }
  };

  const decodeTextBytes = (bytes) => { // MARKER_GL_THAI_DECODE_V1
    let b = bytes;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3); // ตัด BOM
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* ไม่ใช่ UTF-8 -> ลอง Thai Windows */ }
    try { return new TextDecoder('windows-874').decode(b); } catch (e) { return Array.from(b).map((x) => String.fromCharCode(x)).join(''); }
  };
  const readFile = async (file) => {
    try {
      const lower = file.name.toLowerCase();
      let text = '';
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        text = rows.map(r => r[0] ?? '').join('\n');
      } else {
        text = decodeTextBytes(new Uint8Array(await file.arrayBuffer())); // MARKER_GL_THAI_DECODE_V1 -- UTF-8 ก่อน ถ้าไม่ใช่ลอง Windows-874 (กัน � ในภาษาไทย)
      }
      await processText(text, file.name);
    } catch (err) {
      addStatus({ source: file.name, typeLabel: '', state: 'error', message: 'อ่านไฟล์ไม่สำเร็จ: ' + err.message });
    }
  };
  // ── MARKER_GL_MACRO_IB_HOSPITAL_V1 -- รับ Excel/ZIP หลายไฟล์พร้อมกัน -> แยกชนิดทีละไฟล์จากเนื้อหา (ไม่ดูชื่อไฟล์) ──
  const decodeZipName = (bytes) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* ไม่ใช่ UTF-8 -> ลอง Thai Windows */ }
    try { return new TextDecoder('windows-874').decode(bytes); } catch (e) { return Array.from(bytes).map(b => String.fromCharCode(b)).join(''); }
  };
  const wrapBytes = (name, u8) => ({
    name,
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
    text: async () => decodeTextBytes(u8),
  });
  const expandFiles = async (list, depth = 0) => {
    const out = [];
    for (const f of list) {
      const base = String(f.name || '').split(/[\\/]/).pop();
      if (!base || base.startsWith('~$') || String(f.name).includes('__MACOSX') || base === '.DS_Store' || base.toLowerCase() === 'thumbs.db') continue;
      if (base.toLowerCase().endsWith('.zip') && depth < 3) {
        try {
          const zip = await JSZip.loadAsync(await f.arrayBuffer(), { decodeFileName: decodeZipName });
          const inner = [];
          // อ่านเนื้อไฟล์ตอนใช้งานจริงเท่านั้น (lazy) -- ไม่ถือไฟล์ทั้ง ZIP ไว้ใน RAM พร้อมกัน
          for (const e of Object.values(zip.files)) { if (!e.dir) inner.push({ name: e.name, arrayBuffer: () => e.async('arraybuffer'), text: async () => decodeTextBytes(await e.async('uint8array')) }); }
          out.push(...await expandFiles(inner, depth + 1));
        } catch (err) {
          addStatus({ source: f.name, typeLabel: '', state: 'error', message: 'แตก ZIP ไม่สำเร็จ: ' + err.message });
        }
      } else out.push(f);
    }
    return out;
  };

  // MARKER_GL_MACRO_IB_VATSTYLE_V1 -- ไฟล์ผลลัพธ์ = ชีตเดียว "ADI-Upload" เหมือนปุ่ม Generate file (ADI) ของ VAT Controller:
  //   หัวตารางแถว 1 (A..S), ข้อมูลเริ่มแถว 2, X1 'FASTAPN LINK3ASE', X2 = Folder Path (SEGMENT3\\yyyy.mm), X7 = BU Book
  //   รายการไฟล์ต้นทาง (ใช้กับปุ่ม Original) เก็บใน Properties ของไฟล์ ไม่ใส่เป็นชีต/เซลล์เพิ่ม
  const buildIbWorkbook = async (g, fileName, info = {}) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ADI-Upload');
    const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } };
    const headers = IB_ADI_COLUMNS.map(c => c.header).concat(['Line DFF']);
    headers.forEach((h, i) => {
      const cell = ws.getRow(1).getCell(i + 1);
      cell.value = h; cell.fill = hdrFill;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF002060' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      const w = i < IB_ADI_COLUMNS.length ? IB_ADI_COLUMNS[i].width : 12;
      ws.getColumn(i + 1).width = w;
    });
    g.lines.forEach((l, idx) => {
      const row = ws.getRow(2 + idx);
      IB_ADI_COLUMNS.forEach((c, i) => {
        const v = l[c.key];
        const cell = row.getCell(i + 1);
        if (c.type === 'amount') { cell.value = v == null ? null : v; cell.numFmt = '#,##0.00'; }
        else if (c.key === 'accDate') {
          const m = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(String(v || ''));
          const mi = m ? MON3.indexOf(m[2].toUpperCase()) : -1;
          if (mi >= 0) { cell.value = new Date(Date.UTC(2000 + Number(m[3]), mi, Number(m[1]))); cell.numFmt = 'dd-mmm-yy'; } else cell.value = v == null ? '' : String(v);
        } else cell.value = v == null ? '' : String(v);
      });
    });
    ws.getCell('W1').value = 'Create by '; ws.getCell('X1').value = 'FASTAPN LINK3ASE';
    ws.getCell('W2').value = 'Folder Path'; ws.getCell('X2').value = info.folder || '';
    ws.getCell('W3').value = 'Time Stamp'; ws.getCell('W4').value = 'Filename'; ws.getCell('W5').value = 'ADI File'; ws.getCell('W6').value = 'History filename';
    ws.getCell('W7').value = 'BU Book'; ws.getCell('X7').value = info.book || g.bu || '';
    ws.getCell('W8').value = 'WorkFlow'; ws.getCell('X8').value = 'PreUpload = Setup_fm.';
    ws.getColumn(23).width = 16; ws.getColumn(24).width = 20;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    wb.title = fileName;
    wb.description = JSON.stringify({ v: 1, sources: g.files.map(f => ({ file: f.file, hospital: f.hospital, invoice: f.invoice, rows: f.rows, amount: f.amount, journal: f.journal, note: (f.note || []).join(' | ') })) });
    return wb.xlsx.writeBuffer();
  };

  const buildExceptionWorkbook = async (exceptions, period) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Exceptions');
    ws.getCell('A1').value = `IB Hospital — รายการที่ไม่ถูกสร้างเป็น ADI (ข้อยกเว้น) · Period ${period}`;
    ws.getCell('A1').font = { bold: true };
    ['ไฟล์', 'โรงพยาบาล', 'Invoice', 'เหตุผล', 'ยอดรวม'].forEach((h, i) => {
      const c = ws.getRow(3).getCell(i + 1); c.value = h;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });
    exceptions.forEach((x, i) => {
      const row = ws.getRow(4 + i);
      [x.file, x.hospital || '', x.invoice || '', x.reason, x.amount == null ? '' : x.amount].forEach((v, j) => { row.getCell(j + 1).value = v; });
      row.getCell(3).numFmt = '@'; row.getCell(5).numFmt = '#,##0.00';
    });
    [60, 34, 18, 52, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    return wb.xlsx.writeBuffer();
  };

  // ประมวลผลไฟล์ IB Hospital ทั้งชุด: รวม -> ใส่ BU -> สร้าง ADI Upload ต่อ BU -> อัปโหลด (1 Job ต่อ 1 BU)
  const processHospital = async (items) => {
    const sid = addStatus({ source: `${items.length.toLocaleString()} ไฟล์`, typeLabel: HOSPITAL_TYPE_LABEL, state: 'working', message: `กำลังรวมข้อมูล + แยก BU (Period ${hpPeriod}) ...` });
    await new Promise(r => setTimeout(r, 30));
    try {
      let branches = getCached('BranchList');
      let companies = getCached('CompanyList');
      if (!branches || !branches.length) branches = await fetchCollection('BranchList');
      if (!companies || !companies.length) companies = await fetchCollection('CompanyList');
      const branchMap = new Map();
      (branches || []).forEach(b => { const k = String(b['Branch Code'] || '').trim(); if (k) branchMap.set(k, String(b['BU Code'] || b['bu'] || '').trim()); });
      const companyMap = new Map();
      (companies || []).forEach(c => { const k = String(c['bu'] || '').trim(); if (k) companyMap.set(k, { companyCode: String(c['COMPANY CODE'] || '').trim(), name: String(c['Company Name'] || '').trim(), segment3: String(c['SEGMENT3'] || '').trim(), book: String(c['BOOK'] || c['Book'] || '').trim() }); });
      if (!branchMap.size) { patchStatus(sid, { state: 'error', message: 'ยังโหลดตารางสาขา (Branch List) ไม่ได้ -- ลองใหม่อีกครั้ง' }); return; }

      // MARKER_GL_MACRO_IB_BRANCH_COM_FALLBACK_V1 -- สาขาไม่อยู่ใน Branch List -> พิสูจน์ด้วย Group Range / COM (SEGMENT3)
      let groupRanges = [];
      try { const gr = await apiFetch('/vat_watchlist_bu_group_range'); groupRanges = Array.isArray(gr) ? gr : []; } catch (e) { /* ไม่มี Group Range -> ใช้ COM อย่างเดียว */ }
      const companyRows = [...companyMap.entries()].map(([bu, c]) => ({ bu, segment3: c.segment3 }));
      const comCache = new Map();
      const viaCom = (c) => { if (!comCache.has(c)) comCache.set(c, resolveBuByCom(c, groupRanges, companyRows)); return comCache.get(c); };

      const parsed = items.map(it => ({ name: it.name, parsed: parseHospitalAoa(it.aoa) }));
      const res = buildIbHospital(parsed, {
        period: hpPeriod, accDate: accountingDate(hpPeriod),
        buOfBranch: (c) => branchMap.get(c) || (viaCom(c) || {}).bu || '',
        viaOf: (c) => (branchMap.get(c) ? null : viaCom(c)),
        companyOf: (bu) => companyMap.get(bu) || null,
      });
      const stamp = (() => { const n = new Date(); return `${String(n.getFullYear()).slice(-2)}${pad2(n.getMonth() + 1)}${pad2(n.getDate())}_${pad2(n.getHours())}${pad2(n.getMinutes())}`; })();
      let totalLines = 0; let unbalanced = 0;
      for (const g of res.groups) {
        const fileName = `${g.bu}_ADI_${stamp}.xlsx`;
        const co = companyMap.get(g.bu) || {};
        const pp = parsePeriod(hpPeriod);
        const buffer = await buildIbWorkbook(g, fileName, { folder: co.segment3 && pp ? `${co.segment3}\\${pp.year}.${pad2(pp.month + 1)}` : '', book: co.book || g.bu });
        const parentRef = await uploadWorkbook(buffer, g.bu, fileName, 'IBH');
        try { await uploadSourceOriginals(parentRef, g.bu, g.files, new Map(items.map(it => [it.name, it.buf]))); } catch (e) { /* ไม่กระทบไฟล์ ADI */ }
        totalLines += g.lines.length;
        if (!g.balanced) unbalanced += 1;
      }
      if (res.exceptions.length) {
        const fileName = `IB-Exceptions_${hpPeriod}_${stamp}.xlsx`;
        await uploadWorkbook(await buildExceptionWorkbook(res.exceptions, hpPeriod), 'IB-Exceptions', fileName, 'IBX');
      }
      const okFiles = res.groups.reduce((s, g) => s + g.files.length, 0);
      const parts = [
        `สำเร็จ ${okFiles.toLocaleString()} ไฟล์ → ${res.groups.length} BU (${res.groups.map(g => g.bu).join(', ') || '-'}) · ADI ${totalLines.toLocaleString()} บรรทัด`,
        res.groups.length ? (unbalanced ? `⚠ ไม่ Balance ${unbalanced} BU` : '✔ Debit = Credit ทุก BU') : '',
        res.exceptions.length ? `ข้อยกเว้น ${res.exceptions.length.toLocaleString()} ไฟล์ (อ่านไม่ได้ / จับคู่ BU ไม่ได้) ดูไฟล์ IB-Exceptions ใน My Job` : '',
        res.warnings.length ? `เตือน ${res.warnings.length} รายการ (ดูชีต Summary)` : '',
        items.some(i => i.score < HOSPITAL_MIN_SCORE) ? `${items.filter(i => i.score < HOSPITAL_MIN_SCORE).length} ไฟล์โครงสร้างต่างจากปกติเล็กน้อย` : '',
      ].filter(Boolean);
      const needAttention = !!(unbalanced || res.exceptions.length || res.warnings.length);
      // สำเร็จเรียบร้อย -> ไม่ต้องแสดงแถวสถานะ (ผลดูได้ที่ My Job) | มีข้อยกเว้น/คำเตือน/ไม่ Balance -> ยังแสดงให้เห็น
      if (needAttention) patchStatus(sid, { state: 'warn', message: parts.join(' · ') });
      else setStatusList(prev => prev.filter(x => x.id !== sid));
      if (mainTab !== 'mine') setMainTab('mine'); else await loadJobs();
    } catch (err) {
      patchStatus(sid, { state: 'error', message: 'ไม่สำเร็จ: ' + err.message });
    }
  };

  const tick = () => new Promise(r => setTimeout(r, 0)); // คืนการควบคุมให้เบราว์เซอร์ -- หน้าจอไม่ค้าง
  const LIGHT_READ = { type: 'array', cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellNF: false, bookProps: false, bookVBA: false };
  // ชีตจำนวนมากประกาศช่วงข้อมูลเป็น A:XFC (16,383 คอลัมน์) ทั้งที่ใช้จริงแค่ A:Q -- จำกัดที่ 60 คอลัมน์ (ถึง BH) ไม่งั้นวนทุกคอลัมน์ทุกแถวช้ามาก
  const MAX_COLS = 60;
  const sheetToAoaCapped = (ws) => {
    const ref = ws && ws['!ref'];
    if (!ref) return [];
    const rg = XLSX.utils.decode_range(ref);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range: { s: { r: rg.s.r, c: 0 }, e: { r: rg.e.r, c: Math.min(rg.e.c, MAX_COLS - 1) } } });
  };
  const HEAD_CAP = 5000; // ไฟล์โรงพยาบาลสั้นมาก -- อ่านแค่ 5,000 แถวแรก ถ้าชนเพดานค่อยอ่านเต็ม
  const readFiles = async (fileList) => {
    const all = await expandFiles(Array.from(fileList || []));
    const hospital = []; const rest = [];
    const total = all.length;
    const pid = total > 8 ? addStatus({ source: `${total.toLocaleString()} ไฟล์`, typeLabel: 'กำลังอ่านไฟล์', state: 'working', message: `กำลังอ่าน 0/${total.toLocaleString()} ...` }) : null;
    let n = 0;
    for (const f of all) {
      n++;
      if (pid && (n % 10 === 0 || n === total)) { patchStatus(pid, { message: `กำลังอ่าน ${n.toLocaleString()}/${total.toLocaleString()} ...` }); await tick(); }
      if (/\.(xlsx|xls|xlsm)$/i.test(f.name)) {
        try {
          const buf = await f.arrayBuffer();
          let wb = XLSX.read(buf, { ...LIGHT_READ, sheetRows: HEAD_CAP });
          let best = null;
          wb.SheetNames.forEach(sn => {
            const aoaHead = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '', range: { s: { r: 0, c: 0 }, e: { r: 40, c: 40 } } }); // ตรวจจากหัวไฟล์ 40 แถวพอ -- ไม่อ่านทั้งชีต
            const s = scoreHospitalAoa(aoaHead);
            if (!best || s.score > best.score) best = { sn, score: s.score };
          });
          if (best && best.score >= HOSPITAL_MAYBE_SCORE) {
            let aoa = sheetToAoaCapped(wb.Sheets[best.sn]);
            if (aoa.length >= HEAD_CAP) { // ชนเพดาน -> อ่านเต็มเฉพาะชีตที่ใช้
              wb = XLSX.read(buf, { ...LIGHT_READ, sheets: [best.sn] });
              aoa = sheetToAoaCapped(wb.Sheets[best.sn]);
            }
            hospital.push({ name: String(f.name).split(/[\\/]/).pop(), aoa, score: best.score, buf });
            continue;
          }
        } catch (e) { /* อ่านด้วยวิธีใหม่ไม่ได้ -> ลองทางเดิม (รายงาน Text) */ }
      }
      rest.push(f);
    }
    if (pid) setStatusList(prev => prev.filter(x => x.id !== pid)); // แถวความคืบหน้าแสดงเฉพาะตอนกำลังอ่าน -- เสร็จแล้วเอาออก เหลือแถวผลลัพธ์แถวเดียว
    if (hospital.length) await processHospital(hospital);
    for (const f of rest) { await readFile(f); }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files); };
  const handleBrowseClick = () => fileInputRef.current?.click();
  const handlePaste = async (e) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) { e.preventDefault(); readFiles(files); return; }
    const text = e.clipboardData?.getData('text');
    if (text && text.trim()) { e.preventDefault(); await processText(text, `Paste (${new Date().toLocaleTimeString('th-TH')})`); }
  };

  // ── Ctrl+V ได้ทั้งหน้า (ไม่ต้องคลิก Dropzone ก่อน) -- ยกเว้นตอนพิมพ์อยู่ในช่องค้นหา/Textarea/Popup ──
  pasteHandlerRef.current = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (previewEntry || confirmDeleteJob) return;
    handlePaste(e);
  };
  useEffect(() => {
    const fn = (e) => pasteHandlerRef.current && pasteHandlerRef.current(e);
    document.addEventListener('paste', fn);
    return () => document.removeEventListener('paste', fn);
  }, []);


  // ── ดึงไฟล์จาก Backend (ใช้ทั้ง Preview และ Download) ────────────────────────
  const fetchJobFileBlob = async (jobId) => {
    const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
    const token = sessionStorage.getItem('fastapn_token');
    const res = await fetch(`${apiBase}/api/file-storage/${jobId}/download-gl-macro`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `ดาวน์โหลดไฟล์ไม่สำเร็จ (${res.status})`);
    }
    return res.blob();
  };

  const handleDownloadJob = async (job) => {
    try {
      const blob = await fetchJobFileBlob(job.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = job.file_name || 'InvoiceHistory.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
  };

  const srcJobOf = (refId, k) => srcJobs.find(j => j.ref_id === `IBS|${refId}|${k}`);
  // MARKER_GLMACRO_ORIGINAL_VIEW_EXCEL_V2 -- เปิดไฟล์ต้นฉบับแบบ Excel จริง (สี/ฟอนต์/เส้นขอบ/Merge/ความกว้างคอลัมน์/Format ตัวเลข + แท็บชีตด้านล่าง) ใช้ ExcelJS อ่านได้เฉพาะ .xlsx/.xlsm ส่วน .xls ใช้ตารางธรรมดา
  const xlColor = (c) => { try { const a = c && c.argb; if (a && /^[0-9A-Fa-f]{8}$/.test(a)) return '#' + a.slice(2); } catch (e) { /* ignore */ } return null; };
  const xlColLetter = (n) => { let t = ''; while (n > 0) { const m = (n - 1) % 26; t = String.fromCharCode(65 + m) + t; n = Math.floor((n - 1) / 26); } return t; };
  const buildXlSheet = (ws) => {
    const maxR = Math.min(ws.rowCount || 0, 500); const maxC = Math.min(ws.columnCount || 0, 60);
    const merges = {}; const skip = new Set();
    try {
      (ws.model.merges || []).forEach((rg) => {
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rg); if (!m) return;
        const toN = (L) => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
        const c1 = toN(m[1]), r1 = Number(m[2]), c2 = toN(m[3]), r2 = Number(m[4]);
        merges[`${r1}:${c1}`] = { cs: c2 - c1 + 1, rs: r2 - r1 + 1 };
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) skip.add(`${r}:${c}`);
      });
    } catch (e) { /* ignore */ }
    const cols = []; for (let c = 1; c <= maxC; c++) { const w = ws.getColumn(c).width; cols.push(Math.round((w || 8.43) * 7 + 5)); }
    const rows = [];
    for (let r = 1; r <= maxR; r++) {
      const row = ws.getRow(r); const cells = [];
      for (let c = 1; c <= maxC; c++) {
        if (skip.has(`${r}:${c}`)) { cells.push({ skip: true }); continue; }
        const cell = row.getCell(c); let text = ''; try { text = cell.text == null ? '' : String(cell.text); } catch (e) { text = ''; }
        const st = {}; try {
          const f = cell.fill; if (f && f.type === 'pattern' && f.pattern === 'solid') { const bg = xlColor(f.fgColor); if (bg) st.background = bg; }
          const fo = cell.font || {}; if (fo.bold) st.fontWeight = 700; if (fo.italic) st.fontStyle = 'italic'; if (fo.underline) st.textDecoration = 'underline';
          const fc = xlColor(fo.color); if (fc) st.color = fc; if (fo.size) st.fontSize = Math.round(fo.size * 1.2) + 'px';
          const al = cell.alignment || {}; if (al.horizontal && ['left', 'center', 'right'].includes(al.horizontal)) st.textAlign = al.horizontal; else if (typeof cell.value === 'number') st.textAlign = 'right';
          if (al.wrapText) { st.whiteSpace = 'pre-wrap'; }
          const b = cell.border || {}; const bs = (x) => (x && x.style ? `${x.style === 'medium' || x.style === 'thick' ? 2 : 1}px solid ${xlColor(x.color) || '#555'}` : null);
          const bt = bs(b.top), bb = bs(b.bottom), bl = bs(b.left), br = bs(b.right); if (bt) st.borderTop = bt; if (bb) st.borderBottom = bb; if (bl) st.borderLeft = bl; if (br) st.borderRight = br;
        } catch (e) { /* ignore */ }
        cells.push({ text, st, cs: (merges[`${r}:${c}`] || {}).cs, rs: (merges[`${r}:${c}`] || {}).rs });
      }
      rows.push({ h: row.height ? Math.round(row.height * 1.333) : 20, cells });
    }
    return { cols, rows, truncated: (ws.rowCount || 0) > maxR || (ws.columnCount || 0) > maxC };
  };
  const viewSourceFile = async (sj, name) => {
    setSrcView({ name, loading: true, error: '', sheets: [], sheet: '', aoa: [], jobId: sj.id });
    try {
      const blob = await fetchJobFileBlob(sj.id);
      const ab = await blob.arrayBuffer();
      if (/\.(xlsx|xlsm)$/i.test(name)) {
        try {
          const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(ab);
          const names = wbx.worksheets.map(w => w.name);
          if (names.length) {
            const first = names[0];
            setSrcView({ name, loading: false, error: '', sheets: names, sheet: first, aoa: [], jobId: sj.id, xl: buildXlSheet(wbx.getWorksheet(first)), _xwb: wbx });
            return;
          }
        } catch (e) { /* อ่านด้วย ExcelJS ไม่ได้ -> ใช้ตารางธรรมดา */ }
      }
      const wbv = XLSX.read(ab, { type: 'array', cellFormula: false });
      const sn = wbv.SheetNames[0];
      const mk = (n) => XLSX.utils.sheet_to_json(wbv.Sheets[n], { header: 1, raw: false, defval: '' }).slice(0, 1000);
      setSrcView({ name, loading: false, error: '', sheets: wbv.SheetNames, sheet: sn, aoa: mk(sn), jobId: sj.id, _wb: wbv, _mk: mk });
    } catch (err) { setSrcView({ name, loading: false, error: err.message, sheets: [], sheet: '', aoa: [], jobId: sj.id }); }
  };
  const downloadSourceFile = async (sj, name) => {
    try {
      const blob = await fetchJobFileBlob(sj.id);
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { alert(err.message); }
  };

  const handlePreviewJob = async (job) => {
    setPreviewLoading(true);
    try {
      const blob = await fetchJobFileBlob(job.id);
      const jobRef = String(job.ref_id || '');
      if (jobRef.startsWith('IBH|') || jobRef.startsWith('IBX|')) { // MARKER_GL_MACRO_IB_HOSPITAL_V1 -- Preview ของ IB Hospital (ADI Upload / Exceptions)
        const isEx = jobRef.startsWith('IBX|');
        const wbi = XLSX.read(await blob.arrayBuffer(), { type: 'array', sheets: isEx ? ['Exceptions'] : ['ADI-Upload', 'ADI Upload', 'Summary'] });
        const isNew = !isEx && !!wbi.Sheets['ADI-Upload']; // MARKER_GL_MACRO_IB_VATSTYLE_V1 -- ไฟล์แบบใหม่ = ชีต ADI-Upload (หัวแถว 1) | ไฟล์เก่า = ADI Upload (หัวแถว 5)
        const aoaI = XLSX.utils.sheet_to_json(wbi.Sheets[isEx ? 'Exceptions' : (isNew ? 'ADI-Upload' : 'ADI Upload')], { header: 1, raw: true, defval: '' });
        const cols = isEx ? IB_EX_COLUMNS : IB_ADI_COLUMNS;
        const start = isEx ? 3 : (isNew ? 1 : 5);
        const fmtD = (v) => { if (typeof v !== 'number') return v == null ? '' : String(v); const d = new Date(Math.round((v - 25569) * 86400000)); return `${pad2(d.getUTCDate())}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(-2)}`; };
        const rowsI = aoaI.slice(start).filter(a => a && a.slice(0, 18).some(v => v !== '')).map(a => {
          const o = {};
          cols.forEach((c, i) => { const v = a[i]; o[c.key] = c.type === 'amount' ? (v === '' || v == null ? null : Number(v)) : (c.key === 'accDate' ? fmtD(v) : (v == null ? '' : String(v))); });
          return o;
        });
        let sources = [];
        if (isNew) {
          try { sources = ((JSON.parse((wbi.Props && wbi.Props.Comments) || '{}').sources) || []).map(a => ({ file: String(a.file || ''), hospital: String(a.hospital || ''), invoice: String(a.invoice || ''), rows: Number(a.rows) || 0, amount: Number(a.amount) || 0, journal: String(a.journal || ''), note: String(a.note || '') })); } catch (e) { sources = []; }
        } else if (!isEx && wbi.Sheets['Summary']) { // ไฟล์เก่า: รายการไฟล์ต้นทางจากชีต Summary
          const aoaS = XLSX.utils.sheet_to_json(wbi.Sheets['Summary'], { header: 1, raw: true, defval: '' });
          sources = aoaS.slice(1).filter(a => a && a[0] !== '' && !String(a[0]).startsWith('รวม')).map(a => ({
            file: String(a[0]), hospital: String(a[1] ?? ''), invoice: String(a[2] ?? ''), rows: Number(a[3]) || 0,
            amount: Number(a[4]) || 0, journal: String(a[5] ?? ''), note: String(a[6] ?? ''),
          }));
        }
        const sumD = rowsI.reduce((t, r) => t + (Number(r.debit) || 0), 0), sumC = rowsI.reduce((t, r) => t + (Number(r.credit) || 0), 0);
        const statusI = isEx ? '' : (isNew ? (Math.abs(sumD - sumC) < 0.005 ? 'Balance' : (sumD > sumC ? 'Diff Dr. Over' : 'Diff Cr. Over')) : String((aoaI[1] && aoaI[1][1]) || ''));
        const metaI = { kind: isEx ? 'ibx' : 'ibh', refId: jobRef, sources, bu: job.bu || '', status: statusI, period: rowsI[0] ? (rowsI[0].period || '') : '' };
        setPicked(new Set()); setPreviewSearch(''); setPreviewField(isEx ? 'file' : 'desc'); setShowSrc(false);
        setPreviewEntry({ job, rows: rowsI, meta: metaI });
        return;
      }
      const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array', sheets: ['AP07', 'Reconcile'] }); // ข้ามชีต Payments ที่ไม่ต้องใช้ -> เปิดเร็วขึ้น
      const sheet = wb.Sheets['AP07'] || wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
      const meta = {
        bu: String((aoa[1] && aoa[1][1]) || ''), company: String((aoa[2] && aoa[2][1]) || ''),
        taxId: String((aoa[3] && aoa[3][1]) || ''), period: String((aoa[4] && aoa[4][1]) || ''),
      };
      const rows = aoa.slice(6).filter(arr => arr && (arr[0] !== '' || arr[1] !== '' || arr[4] !== '')).map(arr => {
        const o = {};
        GL_VPH_COLUMNS.forEach((c, i) => {
          let v = arr[i];
          if (c.type === 'amount') v = Number(v) || 0;
          else if (c.type === 'date') v = (typeof v === 'number') ? new Date(Math.round((v - 25569) * 86400000)) : (parseOraDate(v) || '');
          else v = v == null ? '' : String(v);
          o[c.key] = v;
        });
        return o;
      });
      const rs = wb.Sheets['Reconcile'];
      if (rs) {
        const gv = (a) => (rs[a] ? rs[a].v : null);
        meta.rec = { reportTotal: gv('B1'), paymentTotal: gv('B2'), diff: gv('B3'), billTotal: gv('B4') };
      }
      setPicked(new Set()); setPreviewSearch(''); setPreviewField('invoiceNumber');
      setPreviewEntry({ job, rows, meta });
    } catch (err) {
      alert('เปิด Preview ไม่สำเร็จ: ' + err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleBulkDelete = async (targets) => { // MARKER_GLMACRO_JOB_BULK_DELETE_V1
    setBulkDeleting(true);
    const okIds = []; const failed = []; const goneKids = [];
    for (const job of targets) {
      try {
        await apiFetch(`/file-storage/${job.id}`, { method: 'DELETE' });
        okIds.push(job.id);
        const kids = srcJobs.filter(j => String(j.ref_id || '').startsWith(`IBS|${job.ref_id}|`));
        for (const k of kids) { try { await apiFetch(`/file-storage/${k.id}`, { method: 'DELETE' }); goneKids.push(k.id); } catch (e) { /* ปล่อยให้หมดอายุเอง */ } }
      } catch (err) { failed.push(`${job.file_name}: ${err.message}`); }
    }
    setJobs(prev => prev.filter(j => !okIds.includes(j.id)));
    if (goneKids.length) setSrcJobs(prev => prev.filter(j => !goneKids.includes(j.id)));
    setJobSel(new Set());
    setConfirmBulkDelete(false);
    setBulkDeleting(false);
    if (failed.length) alert(`ลบไม่สำเร็จ ${failed.length} รายการ\n` + failed.join('\n'));
  };

  const handleDeleteJob = async (job) => {
    try {
      await apiFetch(`/file-storage/${job.id}`, { method: 'DELETE' });
      const kids = srcJobs.filter(j => String(j.ref_id || '').startsWith(`IBS|${job.ref_id}|`)); // MARKER_GLMACRO_ORIGINAL_STORE_V1 -- ลบไฟล์ต้นทางพร้อมไฟล์ ADI
      for (const k of kids) { try { await apiFetch(`/file-storage/${k.id}`, { method: 'DELETE' }); } catch (e) { /* ปล่อยให้หมดอายุเอง */ } }
      if (kids.length) setSrcJobs(prev => prev.filter(j => !kids.some(k => k.id === j.id)));
      setJobs(prev => prev.filter(j => j.id !== job.id));
      setConfirmDeleteJob(null);
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  // ── Preview: กรอง + ติ๊กเลือก + สร้างไฟล์ใหม่เฉพาะที่เลือก ────────────────────
  const previewFiltered = useMemo(() => {
    if (!previewEntry) return [];
    const q = previewSearch.trim().toLowerCase();
    const all = previewEntry.rows.map((r, i) => ({ r, i }));
    if (!q) return all;
    return all.filter(({ r }) => {
      if (['amtInv', 'debit', 'credit', 'amount'].includes(previewField)) {
        const n = Number(q.replace(/,/g, ''));
        return !isNaN(n) && r[previewField] != null && Math.abs(r[previewField] - n) < 0.005;
      }
      return String(r[previewField] ?? '').toLowerCase().includes(q);
    });
  }, [previewEntry, previewSearch, previewField]);

  // ── ไฮไลต์เป็นชุด ๆ ใน Preview ของ IB Hospital: แถวที่ Journal Name เดียวกัน (Debit + Credit ของใบเดียว) = 1 ชุด สลับสีทีละชุด ──
  const ibBands = useMemo(() => {
    if (!previewEntry || previewEntry.meta.kind !== 'ibh') return null;
    let band = -1; let prev = null;
    return previewEntry.rows.map(r => { if (r.journal !== prev) { band++; prev = r.journal; } return band; });
  }, [previewEntry]);

  useEffect(() => { setScrollTop(0); if (previewScrollRef.current) previewScrollRef.current.scrollTop = 0; }, [previewSearch, previewField, previewEntry]);

  const togglePick = (i) => setPicked(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const allFilteredPicked = previewFiltered.length > 0 && previewFiltered.every(({ i }) => picked.has(i));
  const toggleAllFiltered = () => setPicked(prev => {
    const n = new Set(prev);
    if (allFilteredPicked) previewFiltered.forEach(({ i }) => n.delete(i)); else previewFiltered.forEach(({ i }) => n.add(i));
    return n;
  });

  const regenerateSelected = async () => {
    if (!previewEntry || picked.size === 0) return;
    setRegenBusy(true);
    try {
      const rows = previewEntry.rows.filter((_, i) => picked.has(i));
      const head = previewEntry.meta;
      const buffer = await buildWorkbookBuffer(rows, head);
      await uploadWorkbook(buffer, head.bu, buildFileName(head.bu || 'UnknownBU'));
      setPreviewEntry(null);
      if (mainTab !== 'mine') setMainTab('mine'); else await loadJobs();
      addStatus({ source: previewEntry.job.file_name, typeLabel: GL_MACRO_TYPE_LABEL.VENDOR_PAYMENT_HISTORY, state: 'done', message: `สร้างไฟล์ใหม่เฉพาะที่เลือก ${rows.length.toLocaleString()} รายการ` });
    } catch (err) {
      alert('สร้างไฟล์ใหม่ไม่สำเร็จ: ' + err.message);
    } finally { setRegenBusy(false); }
  };

  const macroTypeOfJob = (job) => {
    const ref = String(job.ref_id || '');
    if (ref.startsWith('IBH|')) return HOSPITAL_TYPE_LABEL;
    if (ref.startsWith('IBX|')) return `${HOSPITAL_TYPE_LABEL} · ข้อยกเว้น`;
    return (ref.startsWith('VPH|') || !ref) ? GL_MACRO_TYPE_LABEL.VENDOR_PAYMENT_HISTORY : '-';
  };
  const jobTypeKey = (job) => { const r = String(job.ref_id || ''); return r.startsWith('IBH|') ? 'ibh' : r.startsWith('IBX|') ? 'ibx' : 'vph'; };
  const displayedJobs = jobs.filter(j => {
    if (jobTypeFilter !== 'all' && jobTypeKey(j) !== jobTypeFilter) return false;
    const q = jobSearch.trim().toLowerCase();
    if (!q) return true;
    return [j.bu, j.file_name, j.owner_username, macroTypeOfJob(j)].some(v => String(v || '').toLowerCase().includes(q));
  });
  const stateColor = { working: '#1a3a5c', done: '#1a7a4c', warn: '#b45309', error: '#b45309' };

  const pvKind = previewEntry ? previewEntry.meta.kind : null; // MARKER_GL_MACRO_IB_HOSPITAL_V1
  const isIb = pvKind === 'ibh' || pvKind === 'ibx';
  const pvCols = pvKind === 'ibh' ? IB_ADI_COLUMNS : pvKind === 'ibx' ? IB_EX_COLUMNS : GL_VPH_COLUMNS;

  return (
    <div style={{ padding: '24px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#1a3a5c' }}>⚙️ Generate by GL Macro</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {/* MARKER_GL_MACRO_IB_HOSPITAL_V1 -- Period ที่ใช้ตอนสร้าง ADI ของ IB Hospital (ชื่อ Batch / Journal / Acc Date) */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#555' }} title="ใช้กับไฟล์ค่ารักษาพยาบาล (IB Hospital): กำหนด Period / Batch Name / Acc Date">
          Period
          <select value={hpPeriod} onChange={e => setHpPeriod(e.target.value)} style={{ height: '30px', border: '0.5px solid #ddd', borderRadius: '6px', padding: '0 8px', fontSize: '12px', color: '#1a3a5c', background: '#fff' }}>
            {periodList.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {/* Tab สลับวิธีนำเข้า (มุมขวาบน): โยนไฟล์ | วางข้อความ -- Logic เดียวกัน */}
        <div style={{ display: 'flex', border: '0.5px solid #ddd', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
          {[['file', '📁 โยนไฟล์'], ['text', '📋 วางข้อความ']].map(([k, label], idx) => (
            <button key={k} onClick={() => setInputTab(k)}
              style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, border: 'none', borderLeft: idx ? '0.5px solid #ddd' : 'none', background: inputTab === k ? '#1a3a5c' : 'white', color: inputTab === k ? 'white' : '#555', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {inputTab === 'text' && (
        <div style={{ border: '0.5px solid #ddd', borderRadius: '10px', background: '#fafbfc', padding: '14px', height: INPUT_AREA_HEIGHT, boxSizing: 'border-box', marginBottom: statusList.length ? '8px' : '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', color: '#888' }}>Copy ข้อความทั้งรายงานจาก Oracle / Notepad แล้ววางที่ช่องนี้ (Ctrl+V) ระบบจะจับรูปแบบและแปลงให้ทันที เหมือนการโยนไฟล์ ไม่ต้องกดยืนยัน</div>
          <textarea spellCheck={false}
            onPaste={e => { // วางแล้วแปลงทันที ไม่ต้องกดยืนยัน (เหมือนโยนไฟล์)
              const text = e.clipboardData?.getData('text');
              if (text && text.trim()) { e.preventDefault(); processText(text, `Paste (${new Date().toLocaleTimeString('th-TH')})`); }
            }}
            placeholder="กด Ctrl+V เพื่อวางข้อความรายงาน (แปลงอัตโนมัติ)"
            style={{ flex: 1, minHeight: 0, fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre', overflow: 'auto', border: '0.5px solid #cfd6df', borderRadius: '6px', padding: '8px', resize: 'none', background: '#fff' }} />
        </div>
      )}

      {inputTab === 'file' && (
      <div
        ref={dropZoneRef}
        tabIndex={0}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        style={{
          height: INPUT_AREA_HEIGHT, boxSizing: 'border-box', border: `2px dashed ${dragOver ? '#1a3a5c' : '#ccc'}`,
          borderRadius: '10px', background: dragOver ? '#eef4fa' : '#fafbfc',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: '20px', textAlign: 'center', transition: 'all .15s',
          marginBottom: statusList.length ? '8px' : '16px', outline: 'none',
        }}>
        <div style={{ fontSize: '30px', marginBottom: '8px' }}>📁</div>
        <div style={{ fontSize: '13px', color: '#555', fontWeight: 500 }}>
          ลากไฟล์มาวางที่นี่ · คลิกเพื่อเลือกไฟล์ · หรือกด Ctrl+V เพื่อวางข้อความ/ไฟล์
        </div>
        <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>
          รองรับ .xlsx, .xls, .zip (หลายไฟล์พร้อมกัน), .txt หรือ Copy ข้อความจาก Oracle มา Paste ตรงนี้ได้เลย · ระบบจับรูปแบบรายงานและแปลงให้เอง
        </div>
        <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.xlsm,.txt,.zip" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) readFiles(e.target.files); e.target.value = ''; }} onClick={e => e.stopPropagation()} />
      </div>
      )}

      {statusList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
          {statusList.map(s => (
            <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '6px 12px', background: '#fff', border: '0.5px solid #e3e7ec', borderRadius: '8px', fontSize: '12px' }}>
              <span style={{ color: stateColor[s.state], fontWeight: 600 }}>{s.state === 'working' ? '⏳' : s.state === 'done' ? '✔' : '⚠'}</span>
              <span style={{ fontFamily: 'monospace', color: '#1c2b3a' }}>{s.source}</span>
              {s.typeLabel && <span style={{ padding: '1px 8px', borderRadius: '10px', background: '#d6f1e6', color: '#0b5e45', fontSize: '11px', fontWeight: 600 }}>ตรวจพบ: {s.typeLabel}</span>}
              <span style={{ color: stateColor[s.state] }}>{s.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tab + ตาราง Job อยู่ในกรอบเดียวกัน */}
      <div style={{ border: '0.5px solid #eee', borderRadius: '8px', background: 'white', minHeight: '360px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '0.5px solid #eee', background: '#fafbfc' }}>
          <div style={{ display: 'flex', border: '0.5px solid #ddd', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => setMainTab('mine')}
              style={{ padding: '6px 14px', fontSize: '12px', border: 'none', background: mainTab === 'mine' ? '#1a3a5c' : 'white', color: mainTab === 'mine' ? 'white' : '#555', cursor: 'pointer' }}>
              👤 My Job
            </button>
            {(
              <button onClick={() => setMainTab('all')}
                style={{ padding: '6px 14px', fontSize: '12px', border: 'none', borderLeft: '0.5px solid #ddd', background: mainTab === 'all' ? '#1a3a5c' : 'white', color: mainTab === 'all' ? 'white' : '#555', cursor: 'pointer' }}>
                👥 All Job
              </button>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>{loadingList ? 'กำลังโหลด...' : (displayedJobs.length === jobs.length ? `${jobs.length} รายการ` : `${displayedJobs.length} / ${jobs.length} รายการ`)}</div>
          {(() => { const n = displayedJobs.filter(j => jobSel.has(j.id) && j.can_delete !== false).length; return n > 0 ? (<button onClick={() => setConfirmBulkDelete(true)} style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#c0392b', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>🗑 Delete ({n})</button>) : null; })()}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select value={jobTypeFilter} onChange={e => setJobTypeFilter(e.target.value)} title="กรองตาม Macro Type"
              style={{ height: '28px', border: '0.5px solid #ddd', borderRadius: '6px', background: '#fff', color: '#35506b', fontSize: '12px', padding: '0 8px' }}>
              <option value="all">Macro Type: ทั้งหมด</option>
              <option value="vph">{GL_MACRO_TYPE_LABEL.VENDOR_PAYMENT_HISTORY}</option>
              <option value="ibh">{HOSPITAL_TYPE_LABEL}</option>
              <option value="ibx">{HOSPITAL_TYPE_LABEL} · ข้อยกเว้น</option>
            </select>
            <input value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="ค้นหา BU / ไฟล์ / ผู้ Generate ..."
              style={{ height: '28px', width: '220px', border: '0.5px solid #ddd', borderRadius: '6px', padding: '0 10px', fontSize: '12px', outline: 'none' }} />
          </div>
          <button onClick={loadJobs} title="โหลดรายการใหม่" style={{ padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', background: '#fff', color: '#555', fontSize: '11px', cursor: 'pointer' }}>↻ รีเฟรช</button>
        </div>

        {loadingList && jobs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>กำลังโหลด...</div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f5f7fa' }}>
                  <th style={{ width: '34px', padding: '8px 10px', borderBottom: '1px solid #eee' }}>
                    {(() => { const dj = displayedJobs.filter(j => j.can_delete !== false); const all = dj.length > 0 && dj.every(j => jobSel.has(j.id)); return (<input type="checkbox" checked={all} disabled={dj.length === 0} title="เลือกทั้งหมดที่แสดงอยู่" onChange={() => setJobSel(all ? new Set() : new Set(dj.map(j => j.id)))} />); })()}
                  </th>
                  {['BU', 'Filename', 'Macro Type', 'Generated By', 'Expire Date', 'Preview', 'Download'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #eee', whiteSpace: 'nowrap', color: '#1a3a5c' }}>{h}</th>
                  ))}
                  <th style={{ width: '40px' }} />
                </tr>
              </thead>
              <tbody>
                {displayedJobs.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>{jobs.length === 0 ? 'ยังไม่มีไฟล์ที่ Generate ไว้' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}</td></tr>
                ) : displayedJobs.map(job => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #f2f2f2', background: jobSel.has(job.id) ? '#E6F1FB' : undefined }}>
                    <td style={{ padding: '8px 10px' }}>{job.can_delete !== false && (<input type="checkbox" checked={jobSel.has(job.id)} onChange={() => setJobSel(prev => { const n = new Set(prev); if (n.has(job.id)) n.delete(job.id); else n.add(job.id); return n; })} />)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{job.bu || '-'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      📄 {job.file_name}
                      <div style={{ fontSize: '10px', color: '#aaa' }}>{fmtDT(job.created_at)}</div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{macroTypeOfJob(job)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{job.owner_username}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#c0392b' }}>⏳ {fmtDT(new Date(new Date(job.created_at).getTime() + RETENTION_HOURS * 3600 * 1000))}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => handlePreviewJob(job)} disabled={previewLoading}
                        style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '11px', fontWeight: 500, cursor: previewLoading ? 'default' : 'pointer', opacity: previewLoading ? 0.6 : 1 }}>
                        👁 Preview
                      </button>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => handleDownloadJob(job)}
                        style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#1a7a4c', color: 'white', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>
                        📤 Download
                      </button>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {job.can_delete !== false && (
                        <button onClick={() => setConfirmDeleteJob(job)} title="ลบรายการนี้"
                          style={{ padding: '4px 8px', borderRadius: '6px', border: '0.5px solid #ddd', background: '#f8f9fa', color: '#999', fontSize: '11px', cursor: 'pointer' }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmBulkDelete && (() => { const targets = displayedJobs.filter(j => jobSel.has(j.id) && j.can_delete !== false); return (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !bulkDeleting) setConfirmBulkDelete(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '420px', maxWidth: '92vw', padding: '22px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a3a5c', marginBottom: '8px' }}>ลบ {targets.length.toLocaleString()} ไฟล์ที่เลือก?</div>
            <div style={{ fontSize: '13px', color: '#555', marginBottom: '20px' }}>ลบไฟล์ (รวมไฟล์ต้นทาง Original ของแต่ละไฟล์) ออกจากระบบ — ไม่สามารถกู้คืนได้</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button disabled={bulkDeleting} onClick={() => setConfirmBulkDelete(false)} style={{ padding: '7px 16px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '13px', cursor: 'pointer' }}>ยกเลิก</button>
              <button disabled={bulkDeleting} onClick={() => handleBulkDelete(targets)} style={{ padding: '7px 16px', borderRadius: '6px', border: 'none', background: '#c0392b', color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'pointer', opacity: bulkDeleting ? 0.6 : 1 }}>{bulkDeleting ? 'กำลังลบ...' : 'ลบ'}</button>
            </div>
          </div>
        </div>); })()}

      {/* Popup ยืนยันลบ */}
      {confirmDeleteJob && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDeleteJob(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '380px', maxWidth: '92vw', padding: '22px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a3a5c', marginBottom: '8px' }}>ลบไฟล์นี้?</div>
            <div style={{ fontSize: '13px', color: '#555', marginBottom: '20px', wordBreak: 'break-word' }}>
              ลบไฟล์ <strong>"{confirmDeleteJob.file_name}"</strong> ออกจากระบบ — ไม่สามารถกู้คืนได้
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmDeleteJob(null)} style={{ padding: '7px 16px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '13px', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={() => handleDeleteJob(confirmDeleteJob)} style={{ padding: '7px 16px', borderRadius: '6px', border: 'none', background: '#c0392b', color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {previewEntry && (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !regenBusy) setPreviewEntry(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10005, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: previewFull ? 0 : '12px', width: previewFull ? '100vw' : 'min(1400px, 96vw)', height: previewFull ? '100vh' : 'min(820px, 92vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: '0.5px solid #e3e7ec' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '11px', color: '#888' }}>Preview · {isIb ? HOSPITAL_TYPE_LABEL : 'Vendor Payment History'} · {previewEntry.meta.bu || '-'} {previewEntry.meta.period ? `· ${previewEntry.meta.period}` : ''}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 500, overflowWrap: 'anywhere' }}>{previewEntry.job.file_name}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {pvKind === 'ibh' && (
                  <button onClick={() => setShowSrc(v => !v)} title="ดูรายการไฟล์ต้นทาง (Original) ที่ถูกรวมเข้า BU นี้"
                    style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #1a3a5c', background: showSrc ? '#1a3a5c' : '#fff', color: showSrc ? '#fff' : '#1a3a5c', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                    📂 Original ({(previewEntry.meta.sources || []).length.toLocaleString()} ไฟล์)
                  </button>
                )}
                {isIb && (
                  <button onClick={() => handleDownloadJob(previewEntry.job)}
                    style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: '#0f7a5a', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', marginRight: '6px' }}>ดาวน์โหลด .xlsx</button>
                )}
                <button onClick={() => setPreviewFull(v => !v)} title={previewFull ? 'ย่อหน้าต่าง' : 'ขยายเต็มจอ'} style={{ background: 'none', border: '0.5px solid #ddd', borderRadius: '6px', padding: '4px 10px', fontSize: '13px', color: '#555', cursor: 'pointer' }}>{previewFull ? '🗗 ย่อ' : '⛶ เต็มจอ'}</button>
                <button onClick={() => !regenBusy && setPreviewEntry(null)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#999', cursor: 'pointer' }}>✕</button>
              </div>
            </div>

            {previewEntry.meta.rec && previewEntry.meta.rec.reportTotal != null && (
              <div style={{ padding: '8px 20px', fontSize: '12px', background: Math.abs(previewEntry.meta.rec.diff) < 0.05 ? '#e8f6ee' : '#fff4e0', color: Math.abs(previewEntry.meta.rec.diff) < 0.05 ? '#0b5e45' : '#8a5a00', borderBottom: '0.5px solid #e3e7ec' }}>
                Report Total <b>{fmtMoney(previewEntry.meta.rec.reportTotal)}</b> · ยอดการจ่ายเงินที่ดึงได้ (บาท) <b>{fmtMoney(previewEntry.meta.rec.paymentTotal)}</b> · ผลต่าง <b>{fmtMoney(previewEntry.meta.rec.diff)}</b>
                {Math.abs(previewEntry.meta.rec.diff) < 0.05 ? ' ✔ ตรงกัน' : ' · ไม่ตรง ดูรายละเอียดในชีต Reconcile ของไฟล์ที่ Download'}
                {previewEntry.meta.rec.billTotal != null ? ` · รวม Total Inv. รายการบิล ${fmtMoney(previewEntry.meta.rec.billTotal)} (สกุลเดิมของบิล)` : ''}
              </div>
            )}
            <div style={{ padding: '10px 20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', borderBottom: '0.5px solid #e3e7ec' }}>
              <div style={{ display: 'flex', border: '0.5px solid #cfd6df', borderRadius: '6px', overflow: 'hidden', height: '32px' }}>
                <select value={previewField} onChange={e => setPreviewField(e.target.value)} style={{ border: 'none', borderRight: '0.5px solid #cfd6df', background: '#eef2f6', fontSize: '12px', padding: '0 8px', color: '#35506b' }}>
                  {pvKind === 'ibh' ? (
                    <>
                      <option value="desc">Line Description</option>
                      <option value="branch">Branch</option>
                      <option value="journal">Journal Name</option>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </>
                  ) : pvKind === 'ibx' ? (
                    <>
                      <option value="file">ไฟล์</option>
                      <option value="invoice">Invoice</option>
                      <option value="reason">เหตุผล</option>
                      <option value="amount">ยอดรวม</option>
                    </>
                  ) : (
                    <>
                      <option value="invoiceNumber">Invoice</option>
                      <option value="name">Name</option>
                      <option value="site">Site</option>
                      <option value="vendorNumber">Vendor-N</option>
                      <option value="amtInv">Amt.Inv</option>
                      <option value="grTrans">Doc (GR Trans)</option>
                    </>
                  )}
                </select>
                <input value={previewSearch} onChange={e => setPreviewSearch(e.target.value)} placeholder="ค้นหา..." style={{ border: 'none', outline: 'none', padding: '0 10px', fontSize: '12px', width: '200px' }} />
              </div>
              <span style={{ fontSize: '12px', color: '#44566a' }}>{isIb ? 'จำนวนบรรทัด' : 'Count Inv.'} <b>{previewEntry.rows.length.toLocaleString()}</b></span>
              <span style={{ fontSize: '12px', color: '#44566a' }}>แสดง <b>{previewFiltered.length.toLocaleString()}</b></span>
              {!isIb && <span style={{ fontSize: '12px', color: '#8a5a00' }}>เลือกไว้ <b>{picked.size.toLocaleString()}</b></span>}
              <div style={{ flex: 1 }} />
              {!isIb && (
                <>
                  <button onClick={toggleAllFiltered} disabled={previewFiltered.length === 0} style={{ padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #c9d2dc', background: '#fff', color: '#1a3a5c', fontSize: '12px', cursor: 'pointer' }}>
                    {allFilteredPicked ? 'ยกเลิกเลือกที่แสดงอยู่' : 'เลือกทั้งหมดที่แสดงอยู่'}
                  </button>
                  <button onClick={() => setPicked(new Set())} disabled={picked.size === 0} style={{ padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #c9d2dc', background: '#fff', color: '#555', fontSize: '12px', cursor: 'pointer', opacity: picked.size ? 1 : 0.5 }}>Clear</button>
                </>
              )}
            </div>
            {pvKind === 'ibh' && showSrc && (() => {
              const src = previewEntry.meta.sources || [];
              const sumAmt = src.reduce((t, x) => t + x.amount, 0);
              return (
                <div onMouseDown={e => { if (e.target === e.currentTarget) setShowSrc(false); }}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: '#fff', borderRadius: '12px', width: 'min(1800px, 97vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}> {/* MARKER_GLMACRO_ORIGINAL_POPUP_WIDE_V1 */}
                  <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderBottom: '0.5px solid #e3e7ec' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a3a5c' }}>📂 Original — ไฟล์ต้นทางของ BU {previewEntry.meta.bu || '-'}</div>
                      <div style={{ fontSize: '12px', color: '#44566a', marginTop: '2px' }}><b>{src.length.toLocaleString()}</b> ไฟล์ · ยอดรวม <b>{fmtMoney(sumAmt)}</b> · คลิกแถวเพื่อกรองดูบรรทัด ADI ของใบนั้น</div>
                    </div>
                    <button onClick={() => setShowSrc(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#999', cursor: 'pointer' }}>✕</button>
                  </div>
                  <div style={{ overflow: 'auto', flex: 1, background: '#f7f9fb' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ color: '#35506b', textAlign: 'left' }}>
                        {['#', 'ไฟล์ต้นทาง', 'Original', 'โรงพยาบาล', 'Invoice', 'แถว', 'ยอดรวม', 'Journal Name', 'หมายเหตุ'].map((h, k) => (
                          <th key={h} style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap', textAlign: (k === 5 || k === 6) ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {src.length === 0 ? (
                        <tr><td colSpan={9} style={{ padding: '14px', textAlign: 'center', color: '#aaa' }}>ไม่พบรายการไฟล์ต้นทางในไฟล์นี้ (ไฟล์ที่สร้างก่อนเพิ่มฟังก์ชัน Original)</td></tr>
                      ) : src.map((x, k) => (
                        <tr key={k} onClick={() => { setPreviewField('journal'); setPreviewSearch(x.journal); setShowSrc(false); }}
                          style={{ cursor: 'pointer', borderTop: '1px solid #eef0f3', background: previewField === 'journal' && previewSearch === x.journal ? '#fff3cd' : (k % 2 ? '#fff' : 'transparent') }}>
                          <td style={{ padding: '5px 10px', color: '#888' }}>{k + 1}</td>
                          <td style={{ padding: '5px 10px', minWidth: '260px' }}>{x.file}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>{(() => { const sj = srcJobOf(previewEntry.meta.refId, k); return sj ? (<><button type="button" onClick={() => viewSourceFile(sj, x.file)} title="ดูไฟล์ต้นทาง" style={{ border: '0.5px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: '5px', padding: '2px 8px', fontSize: '11.5px', cursor: 'pointer', marginRight: '4px' }}>👁 ดู</button><button type="button" onClick={() => downloadSourceFile(sj, x.file)} title="ดาวน์โหลดไฟล์ต้นทาง" style={{ border: '0.5px solid #c9d2dc', background: '#fff', color: '#555', borderRadius: '5px', padding: '2px 8px', fontSize: '11.5px', cursor: 'pointer' }}>⬇</button></>) : (<span style={{ color: '#bbb', fontSize: '11.5px' }} title="ไม่มีไฟล์ต้นทางเก็บไว้ (สร้างก่อนเพิ่มฟังก์ชันนี้ หรือหมดอายุแล้ว)">—</span>); })()}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{x.hospital}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{x.invoice}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>{x.rows}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(x.amount)}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{x.journal}</td>
                          <td style={{ padding: '5px 10px', color: '#8a5a00', minWidth: '460px' }}> {/* MARKER_GLMACRO_ORIGINAL_NOTE_BULLET_V1 -- หมายเหตุแยกเป็น Bullet ทีละข้อ (แยกที่ ' | ') */}
                            {(() => { const parts = String(x.note || '').split(' | ').map((t) => t.trim()).filter(Boolean); return parts.length === 0 ? null : (<ul style={{ margin: 0, paddingLeft: '16px', listStyle: 'disc' }}>{parts.map((t, i2) => (<li key={i2} style={{ marginBottom: '2px', lineHeight: 1.4 }}>{t}</li>))}</ul>); })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '0.5px solid #e3e7ec', background: '#fff' }}>
                    <span style={{ fontSize: '12px', color: '#6b7a89' }}>{previewField === 'journal' && previewSearch ? `กำลังกรองตาม ${previewSearch}` : ''}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {previewField === 'journal' && previewSearch && (
                        <button onClick={() => { setPreviewSearch(''); setPreviewField('desc'); setShowSrc(false); }} style={{ fontSize: '12px', border: '0.5px solid #c9d2dc', background: '#fff', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>ล้างตัวกรอง</button>
                      )}
                      <button onClick={() => setShowSrc(false)} style={{ fontSize: '12px', border: 'none', background: '#1a3a5c', color: '#fff', borderRadius: '6px', padding: '6px 16px', cursor: 'pointer' }}>ปิด</button>
                    </div>
                  </div>
                </div>
                </div>
              );
            })()}

            {srcView && (
              <div onMouseDown={e => { if (e.target === e.currentTarget) setSrcView(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10020, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{/* MARKER_GLMACRO_ORIGINAL_VIEW_V1 */}
                <div style={{ background: '#fff', borderRadius: '12px', width: 'min(1700px, 97vw)', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
                  <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '0.5px solid #e3e7ec' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a3a5c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {srcView.name}</div>
                    {!srcView.xl && srcView.sheets.length > 1 && (<select value={srcView.sheet} onChange={(e) => { const n = e.target.value; setSrcView(v => ({ ...v, sheet: n, aoa: v._mk(n) })); }} style={{ fontSize: '12px', padding: '3px 6px' }}>{srcView.sheets.map(n => <option key={n} value={n}>{n}</option>)}</select>)}
                    <button onClick={() => srcView.jobId && downloadSourceFile({ id: srcView.jobId }, srcView.name)} style={{ fontSize: '12px', border: '0.5px solid #c9d2dc', background: '#fff', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer' }}>⬇ ดาวน์โหลด</button>
                    <button onClick={() => setSrcView(null)} style={{ fontSize: '12px', border: 'none', background: '#1a3a5c', color: '#fff', borderRadius: '6px', padding: '5px 14px', cursor: 'pointer' }}>ปิด</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
                    {srcView.loading ? (<div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>กำลังเปิดไฟล์...</div>)
                      : srcView.error ? (<div style={{ padding: '30px', textAlign: 'center', color: '#b3261e' }}>{srcView.error}</div>)
                      : srcView.xl ? (
                        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px', fontFamily: 'Calibri, Arial, sans-serif', width: `${40 + srcView.xl.cols.reduce((t, w) => t + w, 0)}px` }}>
                          <colgroup><col style={{ width: '40px' }} />{srcView.xl.cols.map((w, ci) => <col key={ci} style={{ width: `${w}px` }} />)}</colgroup>
                          <thead><tr><th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#e6e6e6', border: '1px solid #c8c8c8' }} />{srcView.xl.cols.map((w, ci) => <th key={ci} style={{ position: 'sticky', top: 0, zIndex: 2, background: '#e6e6e6', border: '1px solid #c8c8c8', fontWeight: 400, color: '#444', padding: '2px 0' }}>{xlColLetter(ci + 1)}</th>)}</tr></thead>
                          <tbody>{srcView.xl.rows.map((r, ri) => (
                            <tr key={ri} style={{ height: `${r.h}px` }}>
                              <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#e6e6e6', border: '1px solid #c8c8c8', textAlign: 'center', color: '#444' }}>{ri + 1}</td>
                              {r.cells.map((c, ci) => c.skip ? null : (<td key={ci} colSpan={c.cs || 1} rowSpan={c.rs || 1} style={{ border: '1px solid #e1e1e1', padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', background: '#fff', ...c.st }}>{c.text}</td>))}
                            </tr>))}</tbody>
                        </table>)
                      : (<table style={{ borderCollapse: 'collapse', fontSize: '12px' }}><tbody>{srcView.aoa.map((r, ri) => (<tr key={ri} style={{ borderTop: '0.5px solid #eee' }}><td style={{ padding: '3px 8px', color: '#aaa', background: '#f7f9fb', position: 'sticky', left: 0 }}>{ri + 1}</td>{r.map((c, ci) => (<td key={ci} style={{ padding: '3px 8px', whiteSpace: 'nowrap', borderLeft: '0.5px solid #f0f0f0' }}>{String(c)}</td>))}</tr>))}</tbody></table>)}
                  </div>
                  <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: '4px', borderTop: '0.5px solid #c8c8c8', background: '#f3f3f3', minHeight: '32px' }}>
                    {srcView.xl && srcView.sheets.map(n => (<button key={n} type="button" onClick={() => { try { setSrcView(v => ({ ...v, sheet: n, xl: buildXlSheet(v._xwb.getWorksheet(n)) })); } catch (e) { /* ignore */ } }} style={{ padding: '4px 14px', fontSize: '12px', border: '1px solid #c8c8c8', borderBottom: srcView.sheet === n ? '2px solid #217346' : '1px solid #c8c8c8', background: srcView.sheet === n ? '#fff' : '#e9e9e9', color: srcView.sheet === n ? '#217346' : '#444', fontWeight: srcView.sheet === n ? 600 : 400, cursor: 'pointer', borderRadius: '0 0 4px 4px' }}>{n}</button>))}
                    <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: '#888' }}>{srcView.xl ? `แสดงสูงสุด 500 แถว × 60 คอลัมน์${srcView.xl.truncated ? ' (ไฟล์นี้ถูกตัด)' : ''}` : 'แสดงสูงสุด 1,000 แถวแรก'} · ไฟล์ต้นทางหมดอายุ/ถูกลบพร้อมไฟล์ ADI</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={previewScrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '1500px', width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {!isIb && (
                      <th style={{ position: 'sticky', top: 0, background: '#1a3a5c', width: '36px', padding: '8px' }}>
                        <input type="checkbox" checked={allFilteredPicked} onChange={toggleAllFiltered} aria-label="เลือกทั้งหมดที่แสดงอยู่" />
                      </th>
                    )}
                    {pvCols.map(c => (
                      <th key={c.key} style={{ position: 'sticky', top: 0, background: '#1a3a5c', color: '#fff', padding: '8px 10px', textAlign: c.type === 'amount' ? 'right' : 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewFiltered.length === 0 ? (
                    <tr><td colSpan={pvCols.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#aaa' }}>ไม่พบรายการ</td></tr>
                  ) : (() => {
                    const viewH = (previewScrollRef.current && previewScrollRef.current.clientHeight) || 800;
                    const start = Math.max(0, Math.floor(scrollTop / PREVIEW_ROW_H) - 8);
                    const end = Math.min(previewFiltered.length, start + Math.ceil(viewH / PREVIEW_ROW_H) + 16);
                    const colSpan = pvCols.length + 1;
                    return (
                      <>
                        {start > 0 && <tr style={{ height: start * PREVIEW_ROW_H }}><td colSpan={colSpan} style={{ padding: 0, border: 'none' }} /></tr>}
                        {previewFiltered.slice(start, end).map(({ r, i }) => (
                          <tr key={i} onClick={isIb ? undefined : () => togglePick(i)} style={{ height: PREVIEW_ROW_H, background: picked.has(i) ? '#fffaf0' : (ibBands ? (ibBands[i] % 2 ? '#e3eefb' : '#ffffff') : 'transparent'), cursor: isIb ? 'default' : 'pointer', borderBottom: '1px solid #eef0f3', borderTop: (ibBands && (i === 0 || ibBands[i - 1] !== ibBands[i])) ? '1.5px solid #9db7d5' : undefined }}>
                            {!isIb && (
                              <td style={{ padding: '0 8px', textAlign: 'center' }}>
                                <input type="checkbox" checked={picked.has(i)} onChange={() => togglePick(i)} onClick={e => e.stopPropagation()} aria-label={`เลือกแถว ${i + 1}`} />
                              </td>
                            )}
                            {pvCols.map(c => (
                              <td key={c.key} style={{ padding: '0 10px', whiteSpace: 'nowrap', textAlign: c.type === 'amount' ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>
                                {c.type === 'amount' ? (r[c.key] == null ? '' : fmtMoney(r[c.key])) : c.type === 'date' ? (r[c.key] instanceof Date ? formatOraDate(r[c.key]) : (r[c.key] || '')) : (r[c.key] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {end < previewFiltered.length && <tr style={{ height: (previewFiltered.length - end) * PREVIEW_ROW_H }}><td colSpan={colSpan} style={{ padding: 0, border: 'none' }} /></tr>}
                        {pvKind === 'ibh' && (() => { // บรรทัดสุดท้าย: ยอดรวม Debit / Credit ใต้คอลัมน์ของมัน (รวมเฉพาะบรรทัดที่แสดงอยู่)
                          const t = previewFiltered.reduce((a, { r }) => ({ dr: a.dr + (r.debit || 0), cr: a.cr + (r.credit || 0) }), { dr: 0, cr: 0 });
                          return (
                            <tr style={{ height: PREVIEW_ROW_H, background: '#f1f5fa', borderTop: '2px solid #1a3a5c', fontWeight: 700 }}>
                              {pvCols.map(c => (
                                <td key={c.key} style={{ padding: '0 10px', textAlign: 'right', color: '#1a3a5c', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                  {c.key === 'debit' ? fmtMoney(t.dr) : c.key === 'credit' ? fmtMoney(t.cr) : ''}
                                </td>
                              ))}
                            </tr>
                          );
                        })()}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between', borderTop: '0.5px solid #e3e7ec', background: '#f7f9fb' }}>
              <div style={{ fontSize: '12px', color: '#6b7a89', flex: '1 1 320px' }}>{isIb ? 'ผลลัพธ์ ADI Upload แยกตาม BU (ชีต Summary ในไฟล์ที่ Download แสดงรายไฟล์/โรงพยาบาล)' : 'ติ๊กเลือกแถวที่ต้องการ แล้วกด "สร้างไฟล์ใหม่เฉพาะที่เลือก" จะได้ไฟล์ใหม่ใน My Job (ไฟล์เดิมยังอยู่)'}</div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!isIb && (
                  <button onClick={regenerateSelected} disabled={picked.size === 0 || regenBusy}
                    style={{ padding: '8px 16px', borderRadius: '6px', border: '0.5px solid #0f7a5a', background: '#fff', color: '#0f7a5a', fontSize: '13px', fontWeight: 500, cursor: picked.size && !regenBusy ? 'pointer' : 'default', opacity: picked.size && !regenBusy ? 1 : 0.5 }}>
                    {regenBusy ? 'กำลังสร้าง...' : `สร้างไฟล์ใหม่เฉพาะที่เลือก (${picked.size})`}
                  </button>
                )}
                {!isIb && (
                  <button onClick={() => handleDownloadJob(previewEntry.job)}
                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#0f7a5a', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>ดาวน์โหลด .xlsx</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
