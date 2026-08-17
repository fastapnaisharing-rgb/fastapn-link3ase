import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';
// MARKER_UPLOADGEN_DOCACCESS_FIX_V1
import { broadcastWs, subscribeWs } from '../wsManager';

const DOC_FOLDERS = [
  { key: 'ap',   label: 'AP Manual',       icon: '🧾', permKey: 'Manual', color: '#E6F1FB', textColor: '#0C447C', desc: 'ใบวางบิล, ใบเสร็จ, หนังสือยืนยัน', docTypes: ['APN01','AP09','AP07'] },
  { key: 'vat',  label: 'VAT Control',     icon: '🧮', permKey: 'VAT',   color: '#EAF3DE', textColor: '#27500A', desc: 'ใบกำกับภาษี, รายงาน PP30', docTypes: ['VAT'] },
  { key: 'ie',   label: 'I-Expense',       icon: '💸', permKey: 'IE',    color: '#FAEEDA', textColor: '#633806', desc: 'ใบเบิกค่าใช้จ่าย, ค่าเดินทาง, ค่าที่พัก', docTypes: ['IE'] },
  { key: 'gl',   label: 'GL Report',       icon: '📊', permKey: 'GL',    color: '#EEEDFE', textColor: '#3C3489', desc: 'รายงาน GL บัญชีแยกประเภท', docTypes: ['GL'] },
  { key: 'ipro', label: 'I-Pro Interface', icon: '🔗', permKey: 'I-Pro', color: '#FAECE7', textColor: '#712B13', desc: 'เอกสาร interface ระบบ · spec, mapping', docTypes: ['IPRO'] },
];

// MARKER_SUPPORT_FEEDBACK_PHASE2_V1
const MENU_SOURCE_OPTIONS = ['AP Controller', 'VAT Controller', 'I-Expense', 'GL Functional', 'I-Pro Interface', 'Master Data', 'Resource Center', 'อื่นๆ'];
// MARKER_SUPPORT_SEVERITY_LEVEL_V1
// ── ระดับความสำคัญ: เรียงรุนแรงมาก -> น้อย (Incident > Important > Issue > Request) ──
const SEVERITY_LEVELS = [
  { value: 'incident',  label: 'Incident',  color: '#791F1F', bg: '#FCEBEB', desc: 'ระบบใช้งานไม่ได้เลย / ข้อมูลผิดพลาดกระทบเงิน' },
  { value: 'important', label: 'Important', color: '#8a4a00', bg: '#FDF0E0', desc: 'Feature หลักใช้ไม่ได้ แต่ยังมีทางเลี่ยงทำงานต่อได้' },
  { value: 'issue',     label: 'Issue',     color: '#856404', bg: '#FAEEDA', desc: 'ไม่สะดวกแต่ยังทำงานต่อได้ปกติ' },
  { value: 'request',   label: 'Request',   color: '#27500A', bg: '#EAF3DE', desc: 'ข้อเสนอแนะ / ไม่กระทบการทำงาน' },
];
const SEVERITY_MAP = Object.fromEntries(SEVERITY_LEVELS.map(s => [s.value, s]));

// MARKER_SUPPORT_SEARCH_FILTER_V1
const MENU_SOURCE_ICONS = {
  'AP Controller': '🧾',
  'VAT Controller': '🧮',
  'I-Expense': '💸',
  'GL Functional': '📊',
  'I-Pro Interface': '🔗',
  'Master Data': '📚',
  'Resource Center': '📁',
  'อื่นๆ': '🧩',
};

const FILE_TYPE_ICONS = {
  pdf:  { bg: '#FCEBEB', color: '#791F1F', icon: '📄' },
  xlsx: { bg: '#EAF3DE', color: '#27500A', icon: '📊' },
  xls:  { bg: '#EAF3DE', color: '#27500A', icon: '📊' },
  docx: { bg: '#E6F1FB', color: '#0C447C', icon: '📝' },
  doc:  { bg: '#E6F1FB', color: '#0C447C', icon: '📝' },
  pptx: { bg: '#FAEEDA', color: '#633806', icon: '📋' },
  ppt:  { bg: '#FAEEDA', color: '#633806', icon: '📋' },
  png:  { bg: '#EEEDFE', color: '#3C3489', icon: '🖼️' },
  jpg:  { bg: '#EEEDFE', color: '#3C3489', icon: '🖼️' },
  jpeg: { bg: '#EEEDFE', color: '#3C3489', icon: '🖼️' },
};

function getFileTypeStyle(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return FILE_TYPE_ICONS[ext] || { bg: '#f5f5f5', color: '#666', icon: '📎' };
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
}

// MARKER_SUPPORT_LIST_INBOX_STYLE_V1
function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── Add File Modal ───────────────────────────────────────────────────────────
function AttachDropZone({ attachments, setAttachments }) {
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef(null);

  const processFiles = (files) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (attachments.length + imgs.length > 3) {
      alert('แนบได้สูงสุด 3 รูปครับ'); return;
    }
    imgs.slice(0, 3 - attachments.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        setAttachments(prev => [...prev, { name: file.name, data: e.target.result, mime: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div style={{ display:'flex',alignItems:'center',gap:'6px',flexShrink:0 }}>
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);processFiles(e.dataTransfer.files);}}
        onClick={()=>attachments.length<3&&inputRef.current?.click()}
        style={{ display:'flex',alignItems:'center',gap:'6px',padding:'4px 10px',borderRadius:'6px',border:`1.5px dashed ${dragOver?'#1a3a5c':'#ddd'}`,background:dragOver?'#f0f6ff':'white',cursor:attachments.length<3?'pointer':'default',fontSize:'11px',color:'#888',whiteSpace:'nowrap',transition:'all .15s' }}>
        📎 {attachments.length===0?'แนบรูป':attachments.length+'/3'}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>processFiles(e.target.files)}/>
      {attachments.map((a,i)=>(
        <div key={i} style={{ position:'relative',flexShrink:0 }}>
          <img src={a.data} alt={a.name} style={{ width:'32px',height:'32px',borderRadius:'4px',objectFit:'cover',border:'0.5px solid #ddd' }}/>
          <button onClick={()=>setAttachments(prev=>prev.filter((_,j)=>j!==i))}
            style={{ position:'absolute',top:'-4px',right:'-4px',width:'14px',height:'14px',borderRadius:'50%',border:'none',background:'#c0392b',color:'white',cursor:'pointer',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1 }}>×</button>
        </div>
      ))}
    </div>
  );
}


// ── Duplicate check — serial_code + doc_type เท่านั้น ──────────────────
// APN01 และ AP09 มาจากข้อมูลชุดเดียวกันแต่คนละประเภทเอกสาร ห้าม block กัน
async function checkDuplicateSerial(db, serialCode, docType) {
  if (!serialCode) return null;
  const { data } = await db
    .from('doc_collection')
    .select('serial_code,doc_type')
    .eq('serial_code', serialCode)
    .eq('doc_type', docType)
    .maybeSingle();
  return data || null;
}

// checkAllDuplicates: exact match only — 0% or 100%
// APN01: Invoice Number + Branch + มูลค่ารวม ต้องตรงทั้งหมด
// AP09:  Tax Invoice No. + Branch + ยอดรวม ต้องตรงทั้งหมด
// ไม่ใช้ Batch Name / Vendor เพราะ Supplier เดียวกันมีหลาย invoice โดยธรรมชาติ
async function checkAllDuplicates(db, rows, currentSerial, expectedDocType) {
  if (!rows || rows.length === 0) return [];
  const norm  = v => String(v||'').trim().toLowerCase();
  const toNum = v => parseFloat(String(v||'0').replace(/,/g,''))||0;
  const checkAPN01 = expectedDocType !== 'AP09';
  const checkAP09  = expectedDocType !== 'APN01';
  try {
    const found = {};

    // ── APN01: ต้องตรงทั้ง Invoice Number + Branch + Amount (recheck doc_type: ข้ามถ้า expectedDocType เป็น AP09) ──
    if (checkAPN01) {
      const { data: apn01 } = await db.from('doc_collection')
        .select('serial_code,doc_type,rows,uploaded_by,created_at,status')
        .eq('doc_type','APN01').neq('serial_code', currentSerial);

      for (const r of rows) {
        const inv    = norm(r['Invoice Number']||r['Invoice Num']);
        const branch = norm(r['Branch']||r['Site']);
        const amt    = toNum(r['มูลค่ารวม']||r['Invoice Amount']);
        if (!inv) continue;

        for (const rec of (apn01||[])) {
          for (const d of (rec.rows||[])) {
            const dInv    = norm(d['Invoice Number']||d['Invoice Num']);
            const dBranch = norm(d['Branch']||d['Site']);
            const dAmt    = toNum(d['มูลค่ารวม']||d['Invoice Amount']);
            if (!dInv) continue;

            if (inv === dInv && branch === dBranch && Math.abs(amt - dAmt) < 0.01) {
              const key = inv + '|' + branch;
              if (!found[key]) {
                found[key] = {
                  invoiceNo: inv, docType: 'APN01', confidence: 100,
                  supplier: d['Vendor Name']||d['Supplier']||'',
                  batch: d['Batch Name']||d['[ ]']||'',
                  serial: rec.serial_code, uploadedBy: rec.uploaded_by, createdAt: rec.created_at,
                  status: rec.status || 'active',
                };
              }
            }
          }
        }
      }
    }

    // ── AP09: ต้องตรงทั้ง Tax Invoice No. + Branch + ยอดรวม (recheck doc_type: ข้ามถ้า expectedDocType เป็น APN01) ──
    if (checkAP09) {
      const { data: ap09 } = await db.from('doc_collection')
        .select('serial_code,doc_type,rows,uploaded_by,created_at,status')
        .eq('doc_type','AP09').neq('serial_code', currentSerial);

      for (const r of rows) {
        const tax    = norm(r['Tax Invoice No.']);
        const branch = norm(r['Branch']||r['Site']);
        const amt    = toNum(r['ยอดรวม']);
        if (!tax) continue;

        for (const rec of (ap09||[])) {
          for (const d of (rec.rows||[])) {
            const dTax    = norm(d['Tax Invoice No.']);
            const dBranch = norm(d['Branch']||d['Site']);
            const dAmt    = toNum(d['ยอดรวม']);
            if (!dTax) continue;

            // เช็คแค่ Tax Invoice No. — unique อยู่แล้ว ไม่ต้องรวม Branch
            if (tax === dTax) {
              const key = 'ap09|' + tax;
              if (!found[key]) {
                found[key] = {
                  invoiceNo: tax, docType: 'AP09', confidence: 100,
                  supplier: d['Vendor Name']||d['Supplier']||'',
                  batch: d['Batch Name']||'',
                  serial: rec.serial_code, uploadedBy: rec.uploaded_by, createdAt: rec.created_at,
                  status: rec.status || 'active',
                };
              }
            }
          }
        }
      }
    }

    const result = Object.values(found);
    console.log('[checkAllDuplicates] rows:', rows.length, 'expectedDocType:', expectedDocType||'both', 'results:', result.length,
      result.map(r => r.invoiceNo + ' (' + r.docType + ')'));
    return result;
  } catch(e) { console.error('checkAllDuplicates error:', e); return []; }
}

// ── Module-level AP09 row parser ─────────────────────────────────────────────
// [ ] format: "AP Manual.{vendor_tax}.{GRT_batch}.{GL}...{Yes|No}.{TaxInvDate}.{TaxInvNo}"
// branch มาจาก column Site ของ row ไม่ใช่ parts[2]
// vendor ใบกำกับภาษีมาจาก parts[1] (เช่น "กรมศุลกากร") ไม่ใช่ Supplier (DHL ซ้ำทุกแถว)
// ── parseAP09RowsFromRaw ──────────────────────────────────────────────────────
// [ ] format (split by '.'):
//   [0] "AP Manual"
//   [1] ชื่อเจ้าของใบกำกับภาษี เช่น "กรมศุลกากร" (ว่าง = ไม่มี)
//   [2] GRT Batch No. เช่น "6920720127"
//   [3] GL เช่น "010101"
//   ...
//   [yesIdx+0] "Yes"
//   [yesIdx+1] Receive Date เช่น "22-JUL-26"
//   [yesIdx+2] GRT No. (ใบ GRT จริง) เช่น "6910720051"
//   [yesIdx+3] Tax Invoice Date เช่น "07-JUL-26"
//   [yesIdx+4] Tax Invoice No. เช่น "1190-090337"
// smartSplitBracket: split ด้วย '.' แต่ข้าม '\.' (escaped dot ในชื่อบริษัท เช่น พี\.เอส\.วาย\.)
// Raw จาก ERP: \. = backslash+dot = dot จริงในชื่อ → ไม่ควร split
function smartSplitBracket(raw) {
  const PH = '\x00';
  // แทน \. (1 backslash + 1 dot) ด้วย placeholder
  const s = String(raw || '').replace(/\\\./g, PH);
  const parts = s.split('.');
  return parts.map(p => p.replace(new RegExp(PH, 'g'), '.').trim()).filter(p => p.length > 0);
}

function parseAP09RowsFromRaw(rawRows) {
  return rawRows
    .filter(r => {
      const parts = smartSplitBracket(r['[ ]']);
      return parts.some(p => p.toLowerCase() === 'yes');
    })
    .map(r => {
      const parts  = smartSplitBracket(r['[ ]']);
      const yesIdx = parts.findIndex(p => p.toLowerCase() === 'yes');

      // Branch: ดึงจาก [ ] เหมือน APN01 — numParts[1] คือ GL เช่น "010101"
      const bracketParts = parts.filter(p => p);
      const numParts = bracketParts.filter(p => /^\d+$/.test(p));
      const branch   = numParts[1] || '';

      // Vendor Name: ใช้ r['Supplier'] เป็นหลัก (Vendor จริง)
      // parts[1] = vendor slot (format: AP Manual.{vendor}.{GRT}.{branch}...)
      // if empty/numeric -> fallback r['Supplier'] (column B)
      const _vpRef = (parts[1] && !/^\d+$/.test(parts[1])) ? parts[1] : '';
      const taxVendor = (_vpRef || r['Supplier'] || r['Vendor Name'] || '').trim();

      // ข้อมูลหลัง Yes
      const receiveDate = (yesIdx >= 0 ? (parts[yesIdx + 1] || '').trim() : '') || r['Receive Date'] || r['Invoice Date'] || '';
      const grtNo       = yesIdx >= 0 ? (parts[yesIdx + 2] || '').trim() : '';
      const taxInvDate  = yesIdx >= 0 ? (parts[yesIdx + 3] || '').trim() : '';
      const taxInvNo    = yesIdx >= 0 ? (parts[yesIdx + 4] || '').trim() : '';

      // ยอดเงิน: ดึงจาก Invoice Amount ของ row นั้น (ไม่คำนวณย้อน)
      const invAmt = parseFloat(String(r['Invoice Amount'] || r['มูลค่ารวม'] || '0').replace(/,/g, '')) || 0;
      const taxAmt = parseFloat(String(r['Tax Amount'] || '0').replace(/,/g, '')) || 0;
      // ยอดก่อนภาษี = invAmt - taxAmt (ถ้ามี Tax Amount) หรือคำนวณจาก 100/107
      const gross  = taxAmt > 0
        ? Math.round((invAmt - taxAmt) * 100) / 100
        : Math.round(invAmt * 100 / 107 * 100) / 100;
      const vat    = taxAmt > 0
        ? taxAmt
        : Math.round(invAmt * 7 / 107 * 100) / 100;

      return {
        'Branch':           branch,
        'Vendor Name':      taxVendor,
        'Receive Date':     receiveDate || r['Invoice Date'] || r['Receive Date'] || '',
        'GRT No.':          grtNo,
        'Tax Invoice Date': taxInvDate,
        'Tax Invoice No.':  taxInvNo,
        'Description':      r['Description'] || r['Desctiption'] || r['รายการ'] || '',
        'ยอดก่อนภาษี':     gross,
        'ยอดภาษี':         vat,
        'ยอดรวม':          invAmt,
      };
    });
}

function PdfOcrTab({ serialCode, setSerialCode, docType, setDocType, DOC_TYPE_MAP, db, userName, currentUser, onSave, onClose, saving, setSaving, genSerial, pdfQueue, setPdfQueue, pdfSelected, setPdfSelected, folder }) {
  // pdfQueue และ setPdfQueue มาจาก AddFileModal — สลับ tab ไม่หาย
  const selected = pdfSelected;
  const setSelected = setPdfSelected;
  const [pdfSubTab, setPdfSubTab] = React.useState('new'); // 'new' | 'inprogress'

  // โหลด queue ที่ค้างอยู่จาก DB เมื่อ mount ครั้งแรก
  React.useEffect(() => {
    const loadPendingQueue = async () => {
      try {
        const token = sessionStorage.getItem('fastapn_token');
        const res = await fetch('http://10.101.87.126:4000/api/docenter/queue', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          // กรองเฉพาะ pending/ocring/error ที่ยังไม่ done
          const pending = data.filter(r => ['pending','ocring','error'].includes(r.status));
          setPdfQueue(prev => {
            const existIds = new Set(prev.map(x => x.id));
            const newItems = pending
              .filter(r => !existIds.has(r.id))
              .map(r => ({
                id:       r.id,
                fileName: r.file_name,
                file:     { name: r.file_name },
                status:   r.status === 'ocring' ? 'ocring' : r.status,
                result:   r.result_data || null,
                error:    r.error_msg || '',
                serial:   r.serial_code || '',
              }));
            return [...prev, ...newItems];
          });
        }
      } catch(_) {}
    };
    loadPendingQueue();
  }, []);

  // SSE: รับ push จาก backend เมื่อ queue status เปลี่ยน (แทน polling ทุก 5 วิ เดิม)
  // ใช้ stream endpoint เดียวกับ Queue Monitor sidebar (FolderDetail) — backend เดียวกัน ไม่ต้อง poll ซ้ำ
  const docTypeRef = React.useRef(docType); docTypeRef.current = docType;
  const genSerialRef = React.useRef(genSerial); genSerialRef.current = genSerial;

  // Initial load: โหลด queue ของ user จาก DB ตอนเปิด modal ใหม่
  React.useEffect(() => {
    const token = sessionStorage.getItem('fastapn_token');
    fetch('http://10.101.87.126:4000/api/docenter/queue', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(items => {
      if (!Array.isArray(items)) return;
      const mapped = items.map(row => ({
        id: row.id,
        fileName: row.file_name,
        status: row.status,
        error: row.error_msg || '',
        result: row.result_data || null,
        serial: row.serial_code || row.result_meta?.serial_code || row.result_data?.serial_code || '',
        file: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      setPdfQueue(prev => {
        const prevIds = new Set(prev.map(x => x.id).filter(Boolean));
        const newItems = mapped.filter(x => !prevIds.has(x.id));
        return [...prev, ...newItems];
      });
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    const token = sessionStorage.getItem('fastapn_token');
    const es = new EventSource(`http://10.101.87.126:4000/api/docenter/queue/stream?token=${encodeURIComponent(token || "")}`);
    es.addEventListener('queue_update', (e) => {
      try {
        const { snapshot } = JSON.parse(e.data);
        if (!Array.isArray(snapshot)) return;
        setPdfQueue(q => q.map(item => {
          const updated = snapshot.find(r => r.id === item.id);
          if (!updated) return item;
          if (updated.status === 'done') {
            const buFromName = (() => {
              const m = (item.fileName||'').replace(/[.]pdf$/i,'').match(/^([A-Z]{2,6})[_-]/);
              return m ? m[1] : '';
            })();
            const dtype  = updated.result_meta?.doc_type || docTypeRef.current;
            const serial = updated.result_data?.serial_code || genSerialRef.current?.(buFromName||'XX', dtype) || item.fileName;
            return { ...item, status:'done', result: updated.result_data, serial, error:'' };
          }
          if (updated.status === 'error') return { ...item, status:'error', error: updated.error_msg || 'OCR ล้มเหลว' };
          if (updated.status === 'ocring') return { ...item, status:'ocring' };
          return item;
        }));
      } catch(_) {}
    });
    es.onerror = () => { es.close(); }; // close on error — จะ reconnect เองรอบหน้าที่ mount ใหม่
    return () => { es.close(); };
  }, []);
  const [attachments, setAttachments] = React.useState([]);
  const [pdfError, setPdfError]       = React.useState('');
  const pdfInputRef                   = React.useRef();
  const attachInputRef                = React.useRef();

  const runOcr = async (file, idx, retryCount = 0, rotation = 0) => {
    // ใช้ queue system แทน ocr-pdf โดยตรง — SSE จะ push status update มาให้ frontend
    setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'pending', error:''} : x));
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const fd = new FormData();
      fd.append('file', file);
      if (rotation) fd.append('rotation', String(rotation));
      fd.append('doc_type', docType || 'APN01');
      const res = await fetch('http://10.101.87.126:4000/api/docenter/queue/add', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ส่ง queue ไม่สำเร็จ');
      // set id จาก queue ทันที — SSE จะ push status update มาหา item นี้
      const queueId = data.id || data.queue_id;
      setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'pending', id: queueId, fileName: file.name} : x));
    } catch(err) {
      const msg = err.message;
      if (retryCount === 0 && err.message === 'Failed to fetch') {
        setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'pending', error:'กำลัง retry...'} : x));
        await new Promise(r => setTimeout(r, 3000));
        return runOcr(file, idx, 1, rotation);
      }
      setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'error', error:msg} : x));
    }
  };

  const addFiles = async (files) => {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf');
    if (!pdfs.length) { setPdfError('กรุณาเลือกไฟล์ PDF เท่านั้น'); return; }
    // Duplicate check ใน queue (ชื่อไฟล์)
    const existingNames = new Set(pdfQueue.map(x => x.fileName || x.file?.name));
    const newPdfs = pdfs.filter(f => {
      if (existingNames.has(f.name)) { setPdfError(`ไฟล์ "${f.name}" มีอยู่ใน queue แล้ว`); return false; }
      return true;
    });
    if (!newPdfs.length) return;
    setPdfError('');
    // ส่ง PDF ผ่าน /api/docenter/queue/add (backend จัดการ insert + trigger OCR)
    const token = sessionStorage.getItem('fastapn_token');
    for (const file of newPdfs) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('doc_type', docType || 'APN01');
        if (folder?.id) fd.append('folder_id', String(folder.id));
        if (folder?.menu_id) fd.append('menu_id', folder.menu_id);
        const res = await fetch('http://10.101.87.126:4000/api/docenter/queue/add', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'เพิ่ม queue ไม่สำเร็จ');
        setPdfQueue(q => [...q, {
          id:       data.queue_id,
          fileName: data.file_name,
          file:     file,
          status:   'pending',
          result:   null,
          error:    '',
          serial:   '',
        }]);
        if (selected === null) setSelected(pdfQueue.length);
        setPdfSubTab('inprogress');
      } catch(err) {
        setPdfError('เพิ่ม queue ไม่สำเร็จ: ' + err.message);
      }
    }
  };

  const removeFile = async (idx) => {
    const item = pdfQueue[idx];
    // ลบจาก DB ถ้ามี id
    if (item?.id) {
      try {
        const token = sessionStorage.getItem('fastapn_token');
        await fetch(`http://10.101.87.126:4000/api/docenter/queue/${item.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch(_) {}
    }
    setPdfQueue(q => q.filter((_,i) => i !== idx));
    setSelected(s => s === idx ? (pdfQueue.length > 1 ? 0 : null) : s > idx ? s - 1 : s);
  };

  const handlePdfSave = async () => {
    const readyItems = pdfQueue.filter(x => x.status === 'done');
    if (!readyItems.length) { setPdfError('ไม่มีไฟล์ที่ OCR สำเร็จ'); return; }
    setSaving(true);
    for (const item of readyItems) {
      try {
        const rot = previewRotation[getItemKey(item)] || 0;
        const now  = new Date().toISOString();
        const meta = item.result.metadata || {};
        // ดึง bu (MPS/LKS) จาก company_list โดย match bu_code_name
        const buShort = meta.bu_short || meta.bu_code?.split('-')[0]?.trim() || '';
        let insertBuCode     = buShort;
        let insertBuCodeName = meta.bu_code || '';
        let insertBuName     = meta.bu_name || meta.bu_name_ocr || '';
        if (buShort) {
          try {
            const { data: cl } = await db.from('company_list')
              .select('bu,bu_code_name,"THAI COMPANY NAME"')
              .ilike('bu_code_name', buShort + '%').maybeSingle();
            if (cl) {
              insertBuCode     = cl.bu || buShort;
              insertBuCodeName = cl.bu_code_name || insertBuCodeName;
              insertBuName     = cl['THAI COMPANY NAME'] || insertBuName;
            }
          } catch(_) {}
        }
        const finalSerial = item.serial || serialCode.trim() || item.result.serial_code || item.file.name;
        const ocrDocType  = meta.doc_type || docType;
        // Duplicate check — serial + doc_type เท่านั้น
        const dupSerial = await checkDuplicateSerial(db, finalSerial, ocrDocType);
        if (dupSerial) { setPdfError(`Serial "${finalSerial}" (${ocrDocType}) มีในระบบแล้ว — ข้ามไฟล์นี้`); continue; }
        // rotate image before insert, respecting user preview rotation
        let pdfImageData = item.result.pdf_image || '';
        if (pdfImageData && rot) {
          try {
            pdfImageData = await new Promise((resolve) => {
              const img = new Image();
              const doRotate = () => {
                const canvas = document.createElement('canvas');
                const swap = rot === 90 || rot === 270;
                canvas.width  = swap ? img.height : img.width;
                canvas.height = swap ? img.width  : img.height;
                const ctx = canvas.getContext('2d');
                ctx.translate(canvas.width/2, canvas.height/2);
                ctx.rotate(rot * Math.PI / 180);
                ctx.drawImage(img, -img.width/2, -img.height/2);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
              };
              img.onload = doRotate;
              img.onerror = () => resolve(pdfImageData);
              img.src = pdfImageData;
              if (img.complete && img.naturalWidth > 0) doRotate();
            });
          } catch(_) {}
        }
        const pdfAttachment = pdfImageData ? [{
          name: finalSerial + '.jpg',
          data: pdfImageData, mime: 'image/jpeg', source: 'ocr_pdf',
        }] : [];

        // ── Group rows ตาม receive_date → insert แยก record ─────────────
        const allRows = item.result.rows || [];
        const rowsByDate = {};
        const defaultDate = meta.receive_date || now.split('T')[0];
        allRows.forEach(r => {
          const rd = r['Receive Date'] || defaultDate;
          if (!rowsByDate[rd]) rowsByDate[rd] = [];
          rowsByDate[rd].push(r);
        });
        const dateGroups = Object.entries(rowsByDate);
        // ถ้าวันเดียว ใช้ serial เดิม / ถ้าหลายวัน ใส่ suffix วันที่
        for (let gi = 0; gi < dateGroups.length; gi++) {
          const [groupDate, groupRows] = dateGroups[gi];
          const groupSerial = dateGroups.length === 1
            ? finalSerial
            : `${finalSerial}_${groupDate.replace(/[^a-zA-Z0-9]/g, '')}`;
          const { error: err } = await db.from('doc_collection').insert([{
            serial_code:  groupSerial,
            doc_type:     ocrDocType,
            doc_name:     DOC_TYPE_MAP[ocrDocType] || ocrDocType,
            rows:         groupRows,
            bu_code:      insertBuCode,
            bu_code_name: insertBuCodeName,
            bu_name:      insertBuName,
            source:       'ocr_pdf',
            file_date:    groupDate,
            uploaded_by:  userName || currentUser?.email || '',
            ocr_text:     item.result.ocr_text || '',
            attachments:  gi === 0 ? [...pdfAttachment, ...attachments] : [...attachments],
            created_at:   now, updated_at: now,
          }]);
          if (err) throw new Error(err.message);
        }
      } catch(e) { setPdfError('บันทึกไม่สำเร็จ: ' + e.message); }
    }
    setSaving(false);
    onSave();
  };

  const [previewRotation, setPreviewRotation] = React.useState({}); // {itemKey: 0/90/180/270}
  const getItemKey = (item) => item?.id || item?.fileName || item?.file?.name || '';

  const selectedItem = selected !== null ? pdfQueue[selected] : null;
  const meta = selectedItem?.result?.metadata || {};
  const currentRot = selectedItem ? (previewRotation[getItemKey(selectedItem)] || 0) : 0;
  const rotatePreview = () => {
    if (!selectedItem) return;
    const key = getItemKey(selectedItem);
    setPreviewRotation(r => ({ ...r, [key]: ((r[key]||0) + 90) % 360 }));
  };

  const statusIcon = (s) => s==='done'?'✅':s==='ocring'?'⏳':s==='error'?'❌':s==='duplicate'?'⚠️':'🕐';

  const inProgressItems = pdfQueue.filter(x => ['pending','ocring','error'].includes(x.status));
  const inProgressCount = inProgressItems.length;

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minHeight:0 }}>
      {/* ── Sub-tabs: New / In Progress/Done ── */}
      <div style={{ display:'flex', padding:'5px 10px 0', gap:'3px', background:'#f8f9fa', borderBottom:'0.5px solid #e5eaf2', flexShrink:0 }}>
        <button onClick={()=>setPdfSubTab('new')}
          style={{ padding:'5px 14px', fontSize:'11px', borderRadius:'6px 6px 0 0', border:'0.5px solid', borderBottom: pdfSubTab==='new'?'0.5px solid white':'0.5px solid #e5eaf2', background: pdfSubTab==='new'?'white':'transparent', color: pdfSubTab==='new'?'#1a3a5c':'#888', cursor:'pointer', fontWeight: pdfSubTab==='new'?'500':'400' }}>
          ＋ New
        </button>
        <button onClick={()=>setPdfSubTab('inprogress')}
          style={{ padding:'5px 14px', fontSize:'11px', borderRadius:'6px 6px 0 0', border:'0.5px solid', borderBottom: pdfSubTab==='inprogress'?'0.5px solid white':'0.5px solid #e5eaf2', background: pdfSubTab==='inprogress'?'white':'transparent', color: pdfSubTab==='inprogress'?'#1a3a5c':'#888', cursor:'pointer', fontWeight: pdfSubTab==='inprogress'?'500':'400', display:'flex', alignItems:'center', gap:'5px' }}>
          🕐 In Progress / Done
          {inProgressCount > 0 && <span style={{ background:'#E24B4A',color:'white',borderRadius:'50%',width:'14px',height:'14px',fontSize:'9px',display:'inline-flex',alignItems:'center',justifyContent:'center' }}>{inProgressCount}</span>}
        </button>
      </div>

      {/* ── Main area: left list + right preview ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden', gap:0, minHeight:0 }}>

        {/* ── Left: File List ── */}
        <div style={{ width:'240px', flexShrink:0, display:'flex', flexDirection:'column', borderRight:'1px solid #e5eaf2', background: pdfSubTab==='new'?'#f8faff':'white' }}>
          <input ref={pdfInputRef} type="file" accept="application/pdf" multiple style={{ display:'none' }}
            onChange={e=>addFiles(e.target.files)}/>

          {/* ── sub-tab: New ── */}
          {pdfSubTab === 'new' && (
          <div style={{ flex:1, overflowY:'auto' }}
            onDrop={e=>{e.preventDefault();addFiles(e.dataTransfer.files);}}
            onDragOver={e=>e.preventDefault()}>
            <div style={{ height:'100%', minHeight:'300px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', background:'#1a3a5c', color:'white' }}
              onClick={()=>pdfInputRef.current?.click()}>
              <div style={{ fontSize:'40px', marginBottom:'10px' }}>📄</div>
              <div style={{ fontWeight:'500', fontSize:'12px', marginBottom:'4px' }}>ลากไฟล์มาวาง</div>
              <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.5)' }}>หรือคลิกเพื่อเลือก</div>
              <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', marginTop:'4px' }}>.pdf</div>
            </div>
          </div>
          )}

          {/* ── sub-tab: In Progress / Done ── */}
          {pdfSubTab === 'inprogress' && (
          <div style={{ flex:1, overflowY:'auto' }}>
            {pdfQueue.length === 0 ? (
              <div style={{ textAlign:'center',color:'#aaa',padding:'40px 16px',fontSize:'12px' }}>ไม่มีรายการ</div>
            ) : pdfQueue.map((item, idx) => (
              <div key={idx} onClick={()=>{ setSelected(idx); setPdfSubTab('inprogress'); if(item.serial) setSerialCode(item.serial); }}
                style={{ padding:'10px 12px', borderBottom:'0.5px solid #eef', cursor:'pointer', background: selected===idx ? '#e8f0fb' : item.status==='done'?'#f0fff4':'white', display:'flex', alignItems:'center', gap:'8px' }}>
                {/* queue number */}
                <span style={{ fontSize:'10px',fontWeight:'500',minWidth:'18px',height:'18px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,background: item.status==='ocring'?'#CCE5FF':item.status==='done'?'#D4EDDA':item.status==='error'?'#F8D7DA':'#f0f0f0',color: item.status==='ocring'?'#004085':item.status==='done'?'#155724':item.status==='error'?'#721C24':'#666' }}>
                  {item.status==='done'?'✓':item.status==='error'?'!':idx+1}
                </span>
                <span style={{ fontSize:'14px' }}>{statusIcon(item.status)}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={item.fileName||item.file?.name}>{item.fileName||item.file?.name}</div>
                  <div style={{ fontSize:'10px', color: item.status==='error'?'#c0392b':'#888', marginTop:'2px' }}>
                    {item.status==='done' ? (() => {
                      const rows = item.result?.total_rows || 0;
                      const pages = item.result?.pages || 0;
                      const dur = item.createdAt && item.updatedAt
                        ? Math.round((new Date(item.updatedAt) - new Date(item.createdAt)) / 1000)
                        : null;
                      const durStr = dur !== null
                        ? dur >= 60 ? `${Math.floor(dur/60)} นาที ${dur%60} วิ` : `${dur} วิ`
                        : '';
                      return `${rows} รายการ · ${pages} หน้า${durStr ? ' · ' + durStr : ''}`;
                    })() :
                     item.status==='error' ? item.error :
                     item.status==='ocring' ? (
                       <div>
                         <span style={{ fontSize:'9px', color:'#1a3a5c', fontWeight:'500' }}>กำลัง OCR...</span>
                         <div style={{ height:'3px', borderRadius:'2px', background:'#dce8fb', overflow:'hidden', marginTop:'3px', width:'100%' }}>
                           <div style={{ height:'100%', borderRadius:'2px', background:'#1a3a5c', animation:'ocrShimmer 1.5s ease-in-out infinite' }}/>
                         </div>
                         <style>{`@keyframes ocrShimmer{0%{width:0%}50%{width:80%}100%{width:100%}}`}</style>
                       </div>
                     ) : 'รอ queue'}
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();removeFile(idx);}}
                  style={{ background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:'13px',padding:'0 2px',flexShrink:0 }}>×</button>
              </div>
            ))}
          </div>
          )}
        </div>
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
          {selectedItem?.result ? (
            <>
              {/* Metadata bar */}
              <div style={{ padding:'8px 14px', background:'#f0f6ff', borderBottom:'0.5px solid #dce8fb', display:'flex', gap:'16px', flexWrap:'wrap', flexShrink:0, alignItems:'center' }}>
                {meta.doc_type    && <span style={{ fontSize:'11px', color:'#1a3a5c' }}><b>DOC TYPE</b> {meta.doc_type}</span>}
                {meta.bu_code     && <span style={{ fontSize:'11px', color:'#1a3a5c' }}><b>BU CODE</b> {meta.bu_code}</span>}
                {meta.bu_name     && <span style={{ fontSize:'11px', color:'#555' }}><b>บริษัท</b> {meta.bu_name}</span>}
                {meta.receive_date && <span style={{ fontSize:'11px', color:'#555' }}><b>Receive Date</b> {meta.receive_date}</span>}
                <span style={{ fontSize:'11px', color:'#888', marginLeft:'auto' }}>{selectedItem.result.total_rows} รายการ · {selectedItem.result.pages} หน้า</span>
                {selectedItem.result.pdf_image && (
                  <button onClick={rotatePreview}
                    title={`หมุน 90° (ปัจจุบัน ${currentRot}°)`}
                    style={{ padding:'3px 10px', borderRadius:'6px', border:'0.5px solid #c0d0e8', background:'white', color:'#1a3a5c', fontSize:'12px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
                    ↺ {currentRot}°
                  </button>
                )}
              </div>
              {/* PDF Image */}
              <div style={{ flex:1, overflowY:'auto', display:'flex', justifyContent:'center', alignItems:'flex-start', padding:'12px', background:'#f5f5f5' }}>
                {selectedItem.result.pdf_image ? (
                  <img src={selectedItem.result.pdf_image} alt="PDF Preview"
                    style={{ maxWidth: currentRot===90||currentRot===270 ? 'calc(100vh - 200px)' : '100%', borderRadius:'6px', boxShadow:'0 2px 12px rgba(0,0,0,0.15)', cursor:'zoom-in', transform:`rotate(${currentRot}deg)`, transition:'transform 0.3s ease', transformOrigin:'center center' }}
                    onClick={()=>window.open(selectedItem.result.pdf_image,'_blank')}/>
                ) : (
                  <div style={{ textAlign:'center', color:'#aaa', paddingTop:'40px' }}>
                    <div style={{ fontSize:'40px' }}>📄</div>
                    <div style={{ fontSize:'12px', marginTop:'8px' }}>{selectedItem.result.total_rows} รายการ</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#ccc', fontSize:'12px', flexDirection:'column', gap:'8px' }}
              onDrop={e=>{e.preventDefault();addFiles(e.dataTransfer.files);}}
              onDragOver={e=>e.preventDefault()}>
              <div style={{ fontSize:'40px' }}>📄</div>
              {pdfQueue.length === 0 ? 'ลากไฟล์ PDF มาวาง หรือเพิ่มไฟล์จากด้านซ้าย' : 'เลือกไฟล์จากรายการทางซ้าย'}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer: Serial + Save ── */}
      <div style={{ borderTop:'1px solid #e5eaf2', padding:'10px 16px', background:'white', flexShrink:0, display:'flex', gap:'8px', alignItems:'center' }}>
        <input
          value={selected !== null && pdfQueue[selected] ? (pdfQueue[selected].serial || serialCode) : serialCode}
          onChange={e => {
            const val = e.target.value;
            if (selected !== null) {
              setPdfQueue(q => q.map((x,i) => i===selected ? {...x, serial: val} : x));
            }
            setSerialCode(val);
          }}
          placeholder="Serial Code"
          style={{ flex:1, padding:'6px 10px', border:'1px solid #ddd', borderRadius:'6px', fontSize:'12px' }}/>
        <button onClick={handlePdfSave} disabled={saving || !pdfQueue.some(x=>x.status==='done')}
          style={{ padding:'6px 20px', borderRadius:'6px', border:'none', background: saving||!pdfQueue.some(x=>x.status==='done') ?'#ccc':'#1a3a5c', color:'white', fontSize:'12px', fontWeight:'500', cursor: saving?'default':'pointer' }}>
          {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
        </button>
        {pdfError && <span style={{ fontSize:'11px', color:'#c0392b' }}>{pdfError}</span>}
      </div>
    </div>
  );
}

function AlertModal({ title, message, onClose, type='error' }) {
  if (!message) return null;
  const colors = {
    error:   { bg:'#FEF2F2', border:'#FCA5A5', icon:'❌', tc:'#991B1B', btn:'#DC2626' },
    warning: { bg:'#FFFBEB', border:'#FCD34D', icon:'⚠️', tc:'#92400E', btn:'#D97706' },
    info:    { bg:'#EFF6FF', border:'#93C5FD', icon:'ℹ️', tc:'#1E40AF', btn:'#2563EB' },
    success: { bg:'#F0FDF4', border:'#86EFAC', icon:'✅', tc:'#166534', btn:'#16A34A' },
  };
  const c = colors[type] || colors.error;
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:99999,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'white',borderRadius:'12px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxWidth:'460px',width:'calc(100% - 32px)',overflow:'hidden',animation:'alertFadeIn .15s ease'}}>
        <div style={{background:c.bg,borderBottom:`1px solid ${c.border}`,padding:'16px 20px',display:'flex',alignItems:'flex-start',gap:'12px'}}>
          <span style={{fontSize:'20px',flexShrink:0,marginTop:'1px'}}>{c.icon}</span>
          <div style={{flex:1}}>
            {title&&<div style={{fontSize:'13px',fontWeight:'600',color:c.tc,marginBottom:'4px'}}>{title}</div>}
            <div style={{fontSize:'12px',color:c.tc,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{message}</div>
          </div>
        </div>
        <div style={{padding:'12px 16px',display:'flex',justifyContent:'flex-end',background:'#fafafa'}}>
          <button onClick={onClose}
            style={{padding:'6px 20px',borderRadius:'6px',border:'none',background:c.btn,color:'white',fontSize:'12px',fontWeight:'500',cursor:'pointer'}}>
            ตกลง
          </button>
        </div>
      </div>
      <style>{`@keyframes alertFadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// MARKER_APMANUAL_EDITOR_PERM_AND_VIEW_V1
function AddFileModal({ folder, onClose, onSave, userName, currentUser, isOwner, isAdmin, isEditor }) {
  const [docType, setDocType] = React.useState('APN01');
  const [tab, setTab] = React.useState('paste');
  const [pasteSubTab, setPasteSubTab] = React.useState('new');
  const [dupWarnings, setDupWarnings] = React.useState([]);
  const [drafts, setDrafts] = React.useState([]);
  const [draftsLoading, setDraftsLoading] = React.useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = React.useState([]);
  const [selectedDraft, setSelectedDraft] = React.useState(null);
  const [dupModal, setDupModal] = React.useState(null);
  const [confirmDraftDelete, setConfirmDraftDelete] = React.useState(null);
  const [previewDocType, setPreviewDocType] = React.useState('APN01');
  const [saveDraftModal, setSaveDraftModal] = React.useState(false);
  const [ap09Duplicated, setAp09Duplicated] = React.useState(false); // AP09 ซ้ำ → ซ่อน AP09/Both ใน modal
  // pdfQueue อยู่ที่นี่ เพื่อให้สลับ tab แล้วไม่หาย
  const [pdfQueue, setPdfQueue] = React.useState([]);
  const [pdfSelected, setPdfSelected] = React.useState(null);
  const [pasteText, setPasteText] = React.useState('');
  const [toast, setToast] = React.useState(null);
  const [draftLevel, setDraftLevel] = React.useState(1);
  const [draftDocType, setDraftDocType] = React.useState(null);
  const [draftBU, setDraftBU] = React.useState(null);
  const [draftViewAll, setDraftViewAll] = React.useState(false);
  const [draftUserFilter, setDraftUserFilter] = React.useState('me'); // 'me' หรือ email ของ user อื่น
  const [draftUserList, setDraftUserList] = React.useState([]); // list ของ users ที่มี draft
  const showToast = React.useCallback((msg, type='success')=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); }, []);
  React.useEffect(()=>{
    const fn = e=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown',fn);
    return ()=>window.removeEventListener('keydown',fn);
  },[onClose]);
  const [parsedRows, setParsedRows] = React.useState([]);
  const [parsedHeaders, setParsedHeaders] = React.useState([]);
  const [fileQueue, setFileQueue] = React.useState([]);
  const [filePreviewType, setFilePreviewType] = React.useState('APN01');
  const [selectedFileIdx, setSelectedFileIdx] = React.useState(0);
  const [serialCode, setSerialCode] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const [alertModal, setAlertModal] = React.useState(null);
  const showAlert = (message, type='error', title='') => setAlertModal({title, message, type});
  const [formatWarning, setFormatWarning] = React.useState('');
  const [sciInvNums, setSciInvNums] = React.useState(new Set());
  const fileRef = React.useRef(null);
  const [attachments, setAttachments] = React.useState([]); // max 3 รูป
  const [dragOver, setDragOver] = React.useState(false);

  // DOC_TYPE_MAP: doc_type → ชื่อเอกสารใน serial (มีช่องว่าง ตรงตามตัวอย่างจริง)
  const DOC_TYPE_MAP = {
    APN01: 'Invoice Register',
    AP07:  'Input Tax Invoice',
    AP09:  'Input Tax Invoice',
    TRANS: 'Transaction AP',
  };

  // genSerial: CDS_Invoice Register_APN01-260419.2256
  const _genSerialCounter = React.useRef(0);
  const genSerial = (bu, type) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2,'0');
    const yy=String(now.getFullYear()).slice(2),mm=p(now.getMonth()+1),dd=p(now.getDate()),hh=p(now.getHours()),mi=p(now.getMinutes());
    const ss=p(now.getSeconds());
    _genSerialCounter.current = (_genSerialCounter.current + 1) % 100;
    const seq = _genSerialCounter.current > 0 ? `.${_genSerialCounter.current}` : '';
    return `${bu||'XX'}_${DOC_TYPE_MAP[type]||type}_${type}-${yy}${mm}${dd}.${hh}${mi}`;
  };

  // MARKER_GEN_DRAFT_SERIAL_HHMMSS_SEQ_V1
  // ── ใช้เฉพาะตอน Save Draft หลายไฟล์พร้อมกัน (Loop) กัน Serial Code ชนกันเอง ──
  // ── ระหว่างไฟล์ในรอบ Save เดียวกัน — มี ss+seq การันตีไม่ซ้ำ แม้ Loop จะรัน ──
  // ── เร็วจนอยู่ในนาทีเดียวกันหมด — ตอน Confirm จะ Regenerate ใหม่ด้วย ──────
  // ── genSerial() (Format เดิม ไม่มี ss/seq) เสมอ ไม่เกี่ยวกับตัวนี้เลย ──────
  const genDraftSerial = (bu, type) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2,'0');
    const yy=String(now.getFullYear()).slice(2),mm=p(now.getMonth()+1),dd=p(now.getDate()),hh=p(now.getHours()),mi=p(now.getMinutes());
    const ss=p(now.getSeconds());
    _genSerialCounter.current = (_genSerialCounter.current + 1) % 100;
    const seq = _genSerialCounter.current > 0 ? `.${_genSerialCounter.current}` : '';
    return `${bu||'XX'}_${DOC_TYPE_MAP[type]||type}_${type}-${yy}${mm}${dd}.${hh}${mi}${ss}${seq}`;
  };

  const parseTabText = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { headers:[], rows:[] };
    const headers = lines[0].split('	').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cells = line.split('	'); const row={};
      headers.forEach((h,i) => {
        let val = (cells[i]||'').trim();
        if (['Invoice Amount','Tax Amount','Amount','Total','VAT'].includes(h)) {
          const n = parseFloat(String(val).replace(/,/g,''));
          if (!isNaN(n)) val = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        row[h] = val;
      });
      return row;
    });
    return { headers, rows };
  };

  const handlePaste = async (text) => {
    setPasteText(text);
    if (text.trim().length < 5) { setParsedRows([]); return; }
    // ── เช็ค Scientific Notation จาก raw text ก่อน parse ──
    const rawLines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    const rawHeaders = rawLines[0]?.split('\t').map(h=>h.trim())||[];
    const invIdx = rawHeaders.indexOf('Invoice Num');
    const bracketIdx = rawHeaders.indexOf('[ ]');
    if (invIdx >= 0) {
      const sciRows = rawLines.slice(1).filter(line => {
        const cells = line.split('\t');
        const bv = bracketIdx >= 0 ? (cells[bracketIdx]||'').toLowerCase() : '';
        if (bv.includes('.yes.') || bv.endsWith('.yes')) return false;
        return /^-?\d+\.?\d*[eE][+-]?\d+$/.test((cells[invIdx]||'').trim());
      });
      if (sciRows.length > 0) {
        const sample = (sciRows[0].split('\t')[invIdx]||'').trim();
        setFormatWarning(`⚠️ พบ Invoice Number ${sciRows.length} รายการที่ผิด Format (เช่น "${sample}") — กรุณาเปิดไฟล์ Excel แก้ Format column Invoice Num เป็น Number แล้ว Copy ใหม่`);
        setSciInvNums(new Set(sciRows.map(line => (line.split('\t')[invIdx]||'').trim())));
      } else {
        setFormatWarning('');
        setSciInvNums(new Set());
      }
    }
    const { headers, rows } = parseTabText(text);
    setParsedHeaders(headers); setParsedRows(rows);
    const _ap09Prev = parseAP09RowsFromRaw(rows);
    const _ap09Ser = (serialCode||'').replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
    const [_d1,_d2] = await Promise.all([
      checkAllDuplicates(db, rows, serialCode||'', 'APN01'),
      _ap09Prev.length>0 ? checkAllDuplicates(db, _ap09Prev, _ap09Ser||((serialCode||'')+'_AP09'), 'AP09') : Promise.resolve([]),
    ]);
    // เก็บ dup ทั้ง APN01 และ AP09 — render filter ตาม docType ของแต่ละ view
    setDupWarnings([..._d1, ..._d2]);
    // Tab paste = ไฟล์ดิบเสมอ → gen serial APN01 อัตโนมัติ ไม่ต้องให้ user เลือก
    if (!serialCode) {
      const bu = detectBU('', rows);
      if (bu) setSerialCode(genSerial(bu, 'APN01'));
    }
  };

  const detectBU = (fileName, rows) => {
    const fromName = fileName.split('_')[0];
    if (fromName && fromName.length>=2 && fromName.length<=6 && /^[A-Z]/.test(fromName)) return fromName;
    const bv = rows[0]?.['Batch Name'] || rows[0]?.['[ ]'] || '';
    const m = bv.match(/^([A-Z]{2,6})-/);
    if (m) return m[1];
    const liab = rows[0]?.['Liability Account'] || '';
    return liab.split('-')[2] || '';
  };

  // detect ว่า rows ชุดนี้ Gen doc type ไหนได้บ้าง
  const detectAvailableDocTypes = (rows) => {
    if (!rows || rows.length === 0) return [];
    const headers = Object.keys(rows[0] || {});
    const available = [];

    // Invoice Batch format (มี [ ] และ Supplier/Invoice Num) → APN01
    const isInvoiceBatch = headers.includes('[ ]') &&
      (headers.includes('Invoice Num') || headers.includes('Supplier'));
    if (isInvoiceBatch) {
      available.push('APN01');
      // มี Yes ใน [ ] = Gen AP09 ได้
      const hasYes = rows.some(r => String(r['[ ]']||'').split('.').some(s => s.trim().toLowerCase() === 'yes'));
      if (hasYes) available.push('AP09');
      // Invoice Batch ไม่ใช่ TRANS — return เลย
      return available;
    }

    // AP07/AP09 standalone format
    if (headers.includes('Vat Value') || headers.includes('Tax Invoice No') || headers.includes('GRT No')) {
      available.push('AP07');
      return available;
    }

    // TRANS/IMP format — ต้องมี Liability Account และไม่มี [ ] หรือ Invoice Num
    if ((headers.includes('Liability Account') || headers.includes('GL Account'))
        && !headers.includes('[ ]') && !headers.includes('Invoice Num')) {
      available.push('TRANS');
      return available;
    }

    // fallback — ถ้า detect ไม่ได้ก็ไม่แสดง pill
    return available;
  };

  const detectDocType = (fileName) => {
    if (/APN01/i.test(fileName)) return 'APN01';
    if (/AP07/i.test(fileName)) return 'AP07';
    if (/AP09/i.test(fileName)) return 'AP09';
    if (/TRANS/i.test(fileName)) return 'TRANS';
    return docType;
  };

  const handleFiles = (fileList) => {
    const files = Array.from(fileList);
    const newQueue = files.map(f => ({
      name: f.name,
      serialCode: f.name.replace(/\.[^.]+$/,''),
      rows: [],
      headers: [],
      bu: f.name.split('_')[0] || '',
      detectedType: 'APN01', // placeholder — จะถูก overwrite ใน SheetJS callback
      status: 'ready',
      loading: true,
    }));
    setFileQueue(newQueue);

    // อ่านแต่ละไฟล์ด้วย SheetJS
    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const XLSX = require('xlsx');
          const wb   = XLSX.read(e.target.result, { type: 'array', cellText: false, cellDates: true });
          const ws   = wb.Sheets[wb.SheetNames[0]];

          // ── อ่านทุก row เป็น array ก่อน (raw:false เพื่อให้ Date เป็น string) ──
          const allRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '', header: 1 });

          // ── ดึง metadata จาก A1-A4 (col 0 = label, col 1 = value) ──
          const getCellVal = (rowIdx) => String(allRows[rowIdx]?.[1] || '').trim();
          const metaDocType     = getCellVal(0); // row 1: DOC TYPE
          const metaBuRaw       = getCellVal(1); // row 2: BU CODE เช่น "3218 - Beautrium Co.,Ltd."
          const metaBuName      = getCellVal(2); // row 3: ชื่อผู้ประกอบการ
          const metaReceiveDate = getCellVal(3); // row 4: Receive Date

          // เก็บ bu_code เต็มๆ จากไฟล์ เช่น "3218 - Beautrium Co.,Ltd."
          const metaBuCode = metaBuRaw.trim();

          // ── หา header row จริง (row ที่มี 'Branch' หรือ 'Invoice Number') ──
          const HEADER_KEYS = ['Branch','Invoice Number','Invoice Num','Vendor Name','GR Transaction No.','GRT No.','Tax Invoice No.','Tax Invoice Date'];
          let headerRowIdx = 0;
          for (let i = 0; i < Math.min(10, allRows.length); i++) {
            const rowVals = allRows[i].map(v => String(v||'').trim());
            if (HEADER_KEYS.some(k => rowVals.includes(k))) { headerRowIdx = i; break; }
          }

          // ── parse data rows โดย skip metadata ด้านบน ──
          const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', range: headerRowIdx });
          const NUM_COLS = ['Invoice Amount','Tax Amount','Amount','Total','VAT','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
          rows.forEach(row => { Object.keys(row).forEach(k => {
            if (row[k] instanceof Date) {
              const d = row[k];
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              row[k] = `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
            } else if (typeof row[k] === 'number') {
              if (NUM_COLS.includes(k)) {
                row[k] = Number(row[k]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              } else {
                row[k] = String(row[k]);
              }
            }
          }); });
          const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
          // bu_code สำหรับ lookup company_list
          const buShortFromMeta = metaBuCode?.split('-')[0]?.trim() || '';
          const bu = detectBU(file.name, rows) || buShortFromMeta || '';
          const VALID_DOC_TYPES = ['APN01','AP07','AP09','TRANS'];
          const validMetaDocType = VALID_DOC_TYPES.includes(metaDocType) ? metaDocType : '';
          const detectedFromContent = detectAvailableDocTypes(rows)[0] || '';
          const detectedType = validMetaDocType || detectedFromContent || 'APN01';
          const serial = file.name.replace(/\.[^.]+$/, ''); // ใช้ชื่อไฟล์ตัด .xlsx เป็น serial_code
          // ── ผ่าน parse logic เหมือน Paste tab ────────────────────────────
          // ตรวจว่ามี [ ] field (Fleet Card format) หรือเปล่า
          const hasFleetCard = rows.some(r => String(r['[ ]']||'').toLowerCase().includes('.yes.') || String(r['[ ]']||'').toLowerCase().endsWith('.yes'));
          // APN01 rows ผ่าน mapRowsForExcel
          const mappedRows = rows.map(r => mapRowsForExcel([r], 'APN01')[0] || r);
          // AP09 rows ถ้ามี Fleet Card
          const ap09Rows = hasFleetCard ? parseAP09RowsFromRaw(rows) : [];
          setFileQueue(prev => prev.map((f, i) => i === idx ? {
            ...f, rows: mappedRows, ap09Rows, headers, loading: false,
            bu, serialCode: serial, detectedType,
            metaBuCode, metaBuName, metaReceiveDate,
            hasFleetCard, dupWarnings: [], ap09DupWarnings: [],
          } : f));
          if (idx === 0 && serial) setSerialCode(serial);
          // Duplicate check — เหมือน Paste tab (ไม่ block ถ้า error)
          (async () => {
            try {
              const [_dw, _adw] = await Promise.all([
                checkAllDuplicates(db, mappedRows, serial, 'APN01'),
                ap09Rows.length > 0 ? checkAllDuplicates(db, ap09Rows, serial + '_AP09', 'AP09') : Promise.resolve([]),
              ]);
              setFileQueue(prev => prev.map((f, i) => i === idx ? { ...f, dupWarnings: _dw, ap09DupWarnings: _adw } : f));
            } catch(_) {}
          })();
        } catch (err) {
          setFileQueue(prev => prev.map((f, i) => i === idx ? { ...f, loading: false, status: 'error', error: 'อ่านไฟล์ไม่ได้: ' + err.message } : f));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const loadDrafts = React.useCallback(async () => {
    setDraftsLoading(true);
    try {
      const me = userName || currentUser?.email || '';
      let q = db.from('doc_collection').select('*').eq('status', 'draft');
      const canViewAll = isOwner || isAdmin || isEditor;
      if (!canViewAll) {
        q = q.eq('uploaded_by', me);
      } else if (draftUserFilter === 'me') {
        q = q.eq('uploaded_by', me);
      } else if (draftUserFilter !== 'all') {
        q = q.eq('uploaded_by', draftUserFilter);
      }
      const { data } = await q;
      setDrafts(data || []);
      // auto-back: if current BU has no drafts left -> go back to DocType level
      setDraftBU(prevBU => {
        if (!prevBU) return prevBU;
        setDraftDocType(prevDocType => {
          if (!prevDocType) return prevDocType;
          const stillHas = (data||[]).some(d =>
            d.doc_type === prevDocType &&
            (d.bu_code || (d.serial_code||'').split('_')[0] || '?') === prevBU
          );
          if (!stillHas) {
            setDraftLevel(2);
            setSelectedDraftIds([]);
            setSelectedDraft(null);
            return null;
          }
          return prevDocType;
        });
        return prevBU;
      });
      // สร้าง user list จาก drafts ทั้งหมด (Owner/Admin)
      if (canViewAll) {
        const allQ = await db.from('doc_collection').select('uploaded_by').eq('status','draft');
        const users = [...new Set((allQ.data||[]).map(d=>d.uploaded_by).filter(Boolean))];
        setDraftUserList(users);
      }
    } catch(_) {}
    setDraftsLoading(false);
  }, [db, draftViewAll, draftUserFilter, isOwner, isAdmin, isEditor, userName, currentUser]);

  React.useEffect(() => { if ((tab === 'paste' || tab === 'file') && pasteSubTab === 'draft') loadDrafts(); }, [tab, pasteSubTab, draftUserFilter, loadDrafts]);
  React.useEffect(() => { setError(''); }, [tab, pasteSubTab]); // เคลียร์ error ค้างจาก tab อื่นเมื่อสลับ tab

  const handleSaveDraft = async () => {
    if (!serialCode.trim()) { setError('กรุณาระบุ Serial code'); return; }
    if (parsedRows.length === 0) { setError('กรุณาวางข้อมูลก่อน'); return; }
    const dupItems = await checkAllDuplicates(db, parsedRows, serialCode.trim(), 'APN01');
    if (dupItems.length > 0) {
      setDupModal({ items: dupItems, onConfirm: null });
      return;
    }
    const _ap09Check = parseAP09RowsFromRaw(parsedRows);
    if (_ap09Check.length === 0) { doSaveDraft('APN01'); return; }
    // เช็ค AP09 dup แยก doctype
    const _ap09Serial = serialCode.trim().replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
    const ap09DupItems = await checkAllDuplicates(db, _ap09Check, _ap09Serial !== serialCode.trim() ? _ap09Serial : serialCode.trim()+'_AP09', 'AP09');
    if (ap09DupItems.length > 0) {
      // AP09 ซ้ำ → บันทึก APN01 อัตโนมัติเลย ไม่ต้องแสดง modal
      doSaveDraft('APN01');
      return;
    }
    setSaveDraftModal(true);
  };

  const doSaveDraft = async (target) => {
    setSaveDraftModal(false);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const serial = serialCode.trim();
      const buCode = serial.split('_')[0] || null;
      let buCodeName=null, buNameThai=null;
      if (buCode) {
        const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', buCode).maybeSingle();
        buCodeName = buData?.bu_code_name || null;
        buNameThai = buData?.['THAI COMPANY NAME'] || null;
      }
      if (target === 'APN01' || target === 'Both') {
        await db.from('doc_collection').insert([{
          serial_code: serial, doc_type: 'APN01',
          doc_name: 'Invoice Register',
          bu_code: buCode, bu_code_name: buCodeName, bu_name: buNameThai,
          rows: parsedRows, attachments: [], source: 'upload', status: 'draft',
          file_date: parsedRows[0]?.['Invoice Date'] || parsedRows[0]?.['Receive Date'] || now.split('T')[0],
          uploaded_by: userName || currentUser?.email || '',
          created_at: now, updated_at: now,
        }]);
      }
      if (target === 'AP09' || target === 'Both') {
        const ap09Rows = parseAP09RowsFromRaw(parsedRows);
        if (ap09Rows.length > 0) {
          const ap09Serial = serial.replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
          await db.from('doc_collection').insert([{
            serial_code: ap09Serial !== serial ? ap09Serial : serial+'_AP09',
            doc_type: 'AP09', doc_name: 'Input Tax Invoice',
            bu_code: buCode, bu_code_name: buCodeName, bu_name: buNameThai,
            rows: ap09Rows, attachments: [], source: 'upload', status: 'draft',
            file_date: ap09Rows[0]?.['Receive Date'] || now.split('T')[0],
            uploaded_by: userName || currentUser?.email || '',
            created_at: now, updated_at: now,
          }]);
        }
      }
      setPasteText(''); setParsedRows([]); setParsedHeaders([]); setFormatWarning(''); setDupWarnings([]);
      setSerialCode(genSerial(buCode || 'XX', 'APN01'));
      showToast('บันทึก Draft สำเร็จ');
      loadDrafts();
      // Draft saved — ไม่ปิด modal
    } catch(e) { setError('บันทึก Draft ไม่สำเร็จ: ' + (e?.message || e?.details || e?.hint || JSON.stringify(e))); }
    setSaving(false);
  };

  const handleSubmitDraft = async (draftIds) => {
    if (!draftIds || draftIds.length === 0) return;
    setSaving(true);
    try {
      const selectedDrafts = drafts.filter(d => draftIds.includes(d.id));
      if (selectedDrafts.length === 0) throw new Error('ไม่พบ Draft');

      // merge rows จากทุก draft ที่เลือก
      const mergedRows = selectedDrafts.flatMap(d => d.rows || []);
      const firstDraft = selectedDrafts[0];
      const bu = firstDraft.bu_code || (firstDraft.serial_code||'').split('_')[0] || 'XX';
      const docType = firstDraft.doc_type || 'APN01';

      // always gen new serial on submit draft
      const newSerial = genSerial(bu, docType);

      // lookup BU info
      let buCodeName = null, buNameThai = null;
      const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', bu).maybeSingle();
      buCodeName = buData?.bu_code_name || null;
      buNameThai = buData?.['THAI COMPANY NAME'] || null;

      // insert batch ใหม่ status='active'
      const _submitNow = new Date().toISOString();
      const _fileDate = mergedRows[0]?.['Receive Date'] || mergedRows[0]?.['Invoice Date'] || _submitNow.split('T')[0];
      const { error: insErr } = await db.from('doc_collection').insert([{
        serial_code:   newSerial,
        bu_code:       bu,
        bu_code_name:  buCodeName,
        bu_name:       buNameThai,
        doc_type:      docType,
        rows:          mergedRows,
        attachments:   [],
        source:        'upload',
        doc_name:      ({APN01:'Invoice Register',AP07:'Input Tax Invoice',AP09:'Input Tax Invoice',TRANS:'Transaction AP'}[docType])||'Invoice Register',
        status:        'active',
        file_date:     _fileDate,
        uploaded_by:   userName || currentUser?.email || '',
        created_at:    _submitNow,
        updated_at:    _submitNow,
      }]);
      if (insErr) throw insErr;

      // ลบ draft เดิมทั้งหมด
      for (const id of draftIds) {
        await db.from('doc_collection').delete().eq('id', id);
      }

      showToast(`ยืนยันสำเร็จ — ${mergedRows.length} แถว → ${newSerial}`);
      setSerialCode('');
      loadDrafts();
      setSelectedDraftIds([]);
      setSelectedDraft(null);
      onSave && onSave();
    } catch(e) { setError('ยืนยัน Draft ไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const handleSaveDraftFile = async () => {
    const readyFiles = fileQueue.filter(f => f.status === 'ready' && !f.loading);
    if (readyFiles.length === 0) { setError('ไม่มีไฟล์ที่พร้อมบันทึก'); return; }
    setSaving(true);
    try {
      for (const f of readyFiles) {
        const now         = new Date().toISOString();
        const docType     = f.detectedType || 'APN01';
        const buCodeShort = f.bu || (f.metaBuCode ? f.metaBuCode.split('-')[0].trim() : '') || 'XX';
        // serial priority: 1) input field (serialCode) 2) f.serialCode 3) gen new
        const SERIAL_RE = /^[A-Z]{2,6}_.*_[A-Z0-9]+-\d{6}[.\d]*$/;
        const _userSerial = (serialCode||'').trim();
        const serial = SERIAL_RE.test(_userSerial) ? _userSerial
          : SERIAL_RE.test(f.serialCode||'') ? f.serialCode
          : genDraftSerial(buCodeShort, docType);
        let buNameThai = f.metaBuName || null;
        let buCodeName = f.metaBuCode || null;
        if (buCodeShort && buCodeShort !== 'XX') {
          const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', buCodeShort).maybeSingle();
          if (buData?.["THAI COMPANY NAME"]) buNameThai = buData["THAI COMPANY NAME"];
          if (buData?.bu_code_name) buCodeName = buData.bu_code_name;
        }
        // Duplicate check — invoice-level (serial gen ใหม่ทุกครั้งจึงเช็ค serial ซ้ำไม่ได้ ต้องเช็คที่ Invoice Number จริง) + recheck doc_type
        const apn01Dups = await checkAllDuplicates(db, f.rows, serial, 'APN01');
        const dupInvSet = new Set(apn01Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
        const cleanRows = f.rows.filter(r=>!dupInvSet.has(String(r['Invoice Number']||r['Invoice Num']||'').trim().toLowerCase()));
        let cleanAP09 = [];
        let finalAP09Serial = '';
        if (f.ap09Rows && f.ap09Rows.length > 0) {
          const ap09Serial = serial.replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
          finalAP09Serial = ap09Serial !== serial ? ap09Serial : serial + '_AP09';
          const ap09Dups = await checkAllDuplicates(db, f.ap09Rows, finalAP09Serial, 'AP09');
          const dupTaxSet = new Set(ap09Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
          cleanAP09 = f.ap09Rows.filter(r=>!dupTaxSet.has(String(r['Tax Invoice No.']||'').trim().toLowerCase()));
        }
        if (cleanRows.length === 0 && (f.ap09Rows?.length ? cleanAP09.length === 0 : true)) {
          setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'error', error:'ข้อมูลซ้ำทั้งหมด — ไม่ได้บันทึก Draft' } : p));
          continue;
        }
        // insert APN01 draft
        const { error: err } = await db.from('doc_collection').insert([{
          serial_code:  serial, doc_type: docType,
          doc_name:     DOC_TYPE_MAP[docType] || docType,
          rows:         cleanRows, bu_code: buCodeShort,
          bu_code_name: buCodeName || null, bu_name: buNameThai,
          attachments:  [], source: 'upload', status: 'draft',
          file_date:    (f.metaReceiveDate && f.metaReceiveDate !== '0' && !isNaN(Date.parse(f.metaReceiveDate))) ? f.metaReceiveDate : now.split('T')[0],
          uploaded_by:  userName || currentUser?.email || '',
          created_at:   now, updated_at: now,
        }]);
        if (err) throw err;
        // insert AP09 draft แยก record ถ้ามีข้อมูลเหลือหลังกรองซ้ำ
        if (cleanAP09.length > 0) {
          const ap09Now = new Date().toISOString();
          await db.from('doc_collection').insert([{
            serial_code:  finalAP09Serial, doc_type: 'AP09',
            doc_name:     DOC_TYPE_MAP['AP09'] || 'Input Tax Invoice',
            rows:         cleanAP09, bu_code: buCodeShort,
            bu_code_name: buCodeName || null, bu_name: buNameThai,
            attachments:  [], source: 'upload', status: 'draft',
            file_date:    cleanAP09[0]?.['Receive Date'] || ap09Now.split('T')[0],
            uploaded_by:  userName || currentUser?.email || '',
            created_at:   ap09Now, updated_at: ap09Now,
          }]);
        }
        setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'done' } : p));
      }
      showToast(`บันทึก Draft ${readyFiles.length} ไฟล์สำเร็จ`);
      setFileQueue([]); setSelectedFileIdx(0);
      loadDrafts();
    } catch(e) { setError('บันทึก Draft ไม่สำเร็จ: ' + (e?.message || e?.details || e?.hint || JSON.stringify(e))); }
    setSaving(false);
  };

  const handleSave = async () => {
    // ââ Tab paste: ไฟล์ดิบ → Gen APN01 + AP09 เสมอ ──────────────────────
    if (tab === 'paste') {
      if (!serialCode.trim()) { setError('กรุณาระบุ Serial code'); return; }
      if (parsedRows.length === 0) { setError('กรุณาวางข้อมูลก่อน'); return; }
      // เช็ค Scientific Notation
      const sciRows = parsedRows.filter(r => /^-?\d+\.?\d*[eE][+-]?\d+$/.test(String(r['Invoice Num']||'')));
      if (sciRows.length > 0) {
        showAlert(`พบ Invoice Number ${sciRows.length} รายการที่ผิด Format (เช่น "${sciRows[0]['Invoice Num']}")\n\nกรุณาเปิดไฟล์ Excel → Format column Invoice Num เป็น Number → Copy ใหม่`, 'error', '❌ ไม่สามารถบันทึกได้');
        return;
      }
      setSaving(true);
      try {
        const now    = new Date().toISOString();
        const serial = serialCode.trim();
        const buCode = serial.split('_')[0] || null;
        let buCodeName = null, buNameThai = null;
        if (buCode) {
          const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', buCode).maybeSingle();
          buCodeName = buData?.bu_code_name || null;
          buNameThai = buData?.['THAI COMPANY NAME'] || null;
        }
        const _apSer = serial.replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
        const _finalAP09 = _apSer !== serial ? _apSer : serial+'_AP09';
        const _allAP09 = parseAP09RowsFromRaw(parsedRows);
        const [_apn01Dups, _ap09Dups] = await Promise.all([
          checkAllDuplicates(db, parsedRows, serial, 'APN01'),
          _allAP09.length>0 ? checkAllDuplicates(db, _allAP09, _finalAP09, 'AP09') : Promise.resolve([]),
        ]);
        const _dupInv = new Set(_apn01Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
        const _dupTax = new Set(_ap09Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
        const cleanRows = parsedRows.filter(r=>!_dupInv.has(String(r['Invoice Number']||r['Invoice Num']||'').trim().toLowerCase()));
        const _cleanAP09 = _allAP09.filter(r=>!_dupTax.has(String(r['Tax Invoice No.']||'').trim().toLowerCase()));
        if (cleanRows.length===0 && (_allAP09.length===0||_cleanAP09.length===0)) {
          setPasteText(''); setParsedRows([]); setParsedHeaders([]); setSerialCode(''); setFormatWarning(''); setDupWarnings([]);
          setSaving(false); showToast('ข้อมูลซ้ำทั้งหมด ล้างข้อมูลแล้ว','warning'); onSave(); return;
        }

        const { error: err } = await db.from('doc_collection').insert([{
          serial_code:  serial,
          bu_code:      buCode,
          bu_code_name: buCodeName,
          bu_name:      buNameThai,
          doc_type:     'APN01',
          doc_name:     DOC_TYPE_MAP['APN01'],
          rows:         cleanRows,
          attachments:  attachments,
          source:       'upload',
          file_date:    parsedRows[0]?.['Invoice Date'] || parsedRows[0]?.['Receive Date'] || now.split('T')[0],
          uploaded_by:  userName || currentUser?.email || '',
          created_at:   now,
          updated_at:   now,
        }]);
        if (err) throw err;

        if (_cleanAP09.length > 0) {
            const ap09Now = new Date().toISOString();
            await db.from('doc_collection').insert([{
              serial_code:  _finalAP09,
              bu_code:      buCode,
              bu_code_name: buCodeName,
              bu_name:      buNameThai,
              doc_type:     'AP09',
              doc_name:     DOC_TYPE_MAP['AP09'],
              rows:         _cleanAP09,
              attachments:  [],
              source:       'upload',
              file_date:    _cleanAP09[0]?.['Receive Date'] || ap09Now.split('T')[0],
              uploaded_by:  userName || currentUser?.email || '',
              created_at:   ap09Now,
              updated_at:   ap09Now,
            }]);
        }
        setPasteText(''); setParsedRows([]); setParsedHeaders([]); setSerialCode(''); setFormatWarning(''); setDupWarnings([]);
        showToast('บันทึกสำเร็จ');
        onSave();
      } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
      setSaving(false);

    // ── Tab file: ไฟล์สำเร็จ → บันทึกตรง serial = ชื่อไฟล์ ──────────────
    } else {
      console.log('[handleSave] tab:', tab, 'fileQueue:', fileQueue.length, fileQueue.map(f=>({name:f.name,status:f.status,loading:f.loading,rows:f.rows?.length})));
      const readyFiles = fileQueue.filter(f => f.status === 'ready' && !f.loading);
      console.log('[handleSave] readyFiles:', readyFiles.length);
      if (readyFiles.length === 0) { setError('ไม่มีไฟล์ที่พร้อมบันทึก — ดู Console สำหรับรายละเอียด'); return; }
      setSaving(true); setSaveProgress(0);
      let done = 0;
      for (const f of readyFiles) {
        try {
          const now         = new Date().toISOString();
          const docType     = f.detectedType || 'APN01';
          const buCodeShort = f.bu || (f.metaBuCode ? f.metaBuCode.split('-')[0].trim() : '') || 'XX';
          // serial priority: 1) input field (serialCode) 2) f.serialCode 3) gen new
          const SERIAL_RE2 = /^[A-Z]{2,6}_.*_[A-Z0-9]+-\d{6}[.\d]*$/;
          const _userSerial2 = (serialCode||'').trim();
          const serial = SERIAL_RE2.test(_userSerial2) ? _userSerial2
            : SERIAL_RE2.test(f.serialCode||'') ? f.serialCode
            : genDraftSerial(buCodeShort, docType);
          let buNameThai    = f.metaBuName || null;
          let buCodeName    = f.metaBuCode || null;
          if (buCodeShort && buCodeShort !== 'XX') {
            const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', buCodeShort).maybeSingle();
            if (buData?.["THAI COMPANY NAME"]) buNameThai = buData["THAI COMPANY NAME"];
            if (buData?.bu_code_name) buCodeName = buData.bu_code_name;
          }
          // Duplicate check — invoice-level (เหมือน Paste tab และ Preview columns) กันซ้ำข้าม serial + recheck doc_type
          const apn01Dups = await checkAllDuplicates(db, f.rows, serial, 'APN01');
          const dupInvSet = new Set(apn01Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
          const cleanRows = f.rows.filter(r=>!dupInvSet.has(String(r['Invoice Number']||r['Invoice Num']||'').trim().toLowerCase()));
          let cleanAP09 = [];
          let finalAP09Serial = '';
          if (f.ap09Rows && f.ap09Rows.length > 0) {
            const ap09Serial = serial.replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
            finalAP09Serial = ap09Serial !== serial ? ap09Serial : serial + '_AP09';
            const ap09Dups = await checkAllDuplicates(db, f.ap09Rows, finalAP09Serial, 'AP09');
            const dupTaxSet = new Set(ap09Dups.filter(d=>d.confidence>=80).map(d=>d.invoiceNo));
            cleanAP09 = f.ap09Rows.filter(r=>!dupTaxSet.has(String(r['Tax Invoice No.']||'').trim().toLowerCase()));
          }
          if (cleanRows.length === 0 && (f.ap09Rows?.length ? cleanAP09.length === 0 : true)) {
            setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'error', error:'ข้อมูลซ้ำทั้งหมด — ไม่ได้บันทึก' } : p));
            done++; setSaveProgress(Math.round(done / readyFiles.length * 100));
            continue;
          }
          console.log('[insert] serial:', serial, 'docType:', docType, 'bu:', buCodeShort, 'rows:', cleanRows.length, 'metaBuCode:', f.metaBuCode, 'metaReceiveDate:', f.metaReceiveDate);
          const insertPayload = {
            serial_code:  serial,
            doc_type:     docType,
            doc_name:     DOC_TYPE_MAP[docType] || docType,
            rows:         cleanRows,
            bu_code:      buCodeShort,
            bu_code_name: buCodeName || null,
            bu_name:      buNameThai,
            source:       'upload',
            file_date:    (f.metaReceiveDate && f.metaReceiveDate !== '0' && !isNaN(Date.parse(f.metaReceiveDate)))
                            ? f.metaReceiveDate
                            : now.split('T')[0],
            uploaded_by:  userName || currentUser?.email || '',
            created_at:   now,
            updated_at:   now,
          };
          const { data: insertData, error: err } = await db.from('doc_collection').insert([insertPayload]).select();
          console.log('[insert result] data:', insertData, 'error:', err);
          if (err) throw err;
          // insert AP09 แยก record ถ้ามีข้อมูลเหลือหลังกรองซ้ำ
          if (cleanAP09.length > 0) {
            const ap09Now = new Date().toISOString();
            await db.from('doc_collection').insert([{
              serial_code:  finalAP09Serial,
              doc_type:     'AP09',
              doc_name:     DOC_TYPE_MAP['AP09'] || 'Input Tax Invoice',
              rows:         cleanAP09,
              bu_code:      buCodeShort,
              bu_code_name: buCodeName || null,
              bu_name:      buNameThai,
              source:       'upload',
              file_date:    cleanAP09[0]?.['Receive Date'] || ap09Now.split('T')[0],
              uploaded_by:  userName || currentUser?.email || '',
              created_at:   ap09Now,
              updated_at:   ap09Now,
            }]);
          }
          setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'done' } : p));
        } catch (err) {
          console.error('[insert catch]', err);
          setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'error', error:err.message } : p));
          setError('Insert error: ' + err.message);
        }
        done++; setSaveProgress(Math.round(done / readyFiles.length * 100));
      }
      setSaving(false);
      setTimeout(() => { onSave(); setFileQueue([]); setSelectedFileIdx(0); showToast('บันทึกสำเร็จ'); }, 800);
    }
  };

  // docTypes ไม่จำเป็นแล้ว — Tab บอก intent ครบ (paste=raw→APN01+AP09, file=finished, pdf=OCR)
  const S = {
    overlay: { position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999 },
    modal: { background:'white',borderRadius:'12px',width:'calc(100vw - 20px)',maxWidth:'1800px',height:'92vh',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden' },
    pill: (sel) => ({ display:'inline-flex',alignItems:'center',padding:'4px 12px',borderRadius:'20px',fontSize:'11px',cursor:'pointer',border:'0.5px solid',borderColor:sel?'#1a3a5c':'#ddd',background:sel?'#1a3a5c':'#f5f5f5',color:sel?'white':'#555',userSelect:'none' }),
    tab: (sel) => ({ flex:1,padding:'7px',fontSize:'12px',border:'0.5px solid #ddd',background:sel?'white':'#f5f5f5',color:sel?'#1a3a5c':'#888',cursor:'pointer',fontWeight:sel?'500':'400' }),
    inp: { padding:'5px 8px',borderRadius:'6px',border:'0.5px solid #d0d0d0',fontSize:'12px',width:'100%',boxSizing:'border-box',height:'30px' },
  };

  const fmtDupDate = (d) => { if(!d) return '-'; try { return new Date(d).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}); } catch(_) { return d.slice(0,10); } };
  const logicColor = (l) => ({ A:{bg:'#FCEBEB',color:'#791F1F'}, B:{bg:'#FFF9E6',color:'#856404'}, C:{bg:'#FFF9E6',color:'#856404'}, D:{bg:'#E6F1FB',color:'#0C447C'}, E:{bg:'#E6F1FB',color:'#0C447C'}, F:{bg:'#EAF3DE',color:'#27500A'} }[l] || {bg:'#f5f5f5',color:'#555'});

  return (
    <>
    {toast && (
      <div style={{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',zIndex:200000,background:toast.type==='warning'?'#856404':toast.type==='error'?'#791F1F':'#1a3a5c',color:'white',padding:'10px 20px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',boxShadow:'0 4px 12px rgba(0,0,0,0.2)',whiteSpace:'nowrap'}}>
        {toast.type==='warning'?'⚠️':toast.type==='error'?'❌':'✅'} {toast.msg}
      </div>
    )}
    {confirmDraftDelete && (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:100001,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #e0e0e0',width:'360px',boxShadow:'0 8px 32px rgba(0,0,0,0.18)',overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'0.5px solid #f0f0f0',display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'20px'}}>&#128465;</span>
            <div style={{fontSize:'13px',fontWeight:'600',color:'#1a3a5c'}}>ยืนยันการลบ</div>
          </div>
          <div style={{padding:'16px 20px'}}>
            <div style={{fontSize:'12px',color:'#555',lineHeight:1.7}}>
              {confirmDraftDelete.multi
                ? <>ลบ <strong>{confirmDraftDelete.serial}</strong> ออกจากระบบ? </>
                : <>ลบ <strong style={{color:'#c0392b'}}>{confirmDraftDelete.serial}</strong><br/>ออกจากระบบ? </>
              }
            </div>
          </div>
          <div style={{padding:'12px 20px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
            <button onClick={()=>setConfirmDraftDelete(null)} style={{padding:'6px 16px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer'}}>ยกเลิก</button>
            <button onClick={async()=>{
              if(confirmDraftDelete.multi){
                for(const id of confirmDraftDelete.ids){ await db.from('doc_collection').delete().eq('id',id); }
                setSelectedDraftIds([]); setSelectedDraft(null);
              } else {
                await db.from('doc_collection').delete().eq('id',confirmDraftDelete.id);
                setSelectedDraft(null); setSelectedDraftIds([]);
              }
              setConfirmDraftDelete(null); loadDrafts();
            }} style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:'#c0392b',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}>ลบ</button>
          </div>
        </div>
      </div>
    )}
    {saveDraftModal && (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #e0e0e0',width:'340px',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'0.5px solid #f0f0f0'}}>
            <div style={{fontSize:'13px',fontWeight:'500',color:'#1a3a5c'}}>📂 เลือกประเภทที่จะ Save Draft</div>
            <div style={{fontSize:'11px',color:'#888',marginTop:'3px'}}>บันทึกไว้เป็น Draft ผ่าน Dup Check แล้ว</div>
          </div>
          <div style={{padding:'14px 18px',display:'flex',flexDirection:'column',gap:'8px'}}>
            {ap09Duplicated && (
              <div style={{fontSize:'11px',color:'#b45309',background:'#FEF3C7',borderRadius:'6px',padding:'6px 10px',marginBottom:'4px'}}>
                ⚠️ AP09 ซ้ำกับที่มีอยู่แล้ว — บันทึกได้เฉพาะ APN01
              </div>
            )}
            {[
              ['APN01','📄 APN01 เท่านั้น ('+parsedRows.length+' แถว)','#E6F1FB','#0C447C','#b5d4f4'],
              ...(!ap09Duplicated ? [
                ['AP09','📄 AP09 เท่านั้น ('+parseAP09RowsFromRaw(parsedRows).length+' แถว)','#EAF3DE','#27500A','#c0dd97'],
                ['Both','📂 Both — APN01 + AP09','#1a3a5c','white','#1a3a5c'],
              ] : []),
            ].map(([v,label,bg,color,border])=>(
              <button key={v} onClick={()=>doSaveDraft(v)}
                style={{padding:'8px 14px',borderRadius:'8px',border:`0.5px solid ${border}`,background:bg,color,fontSize:'12px',cursor:'pointer',fontWeight:v==='Both'?'500':'400',textAlign:'left'}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{padding:'10px 18px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'flex-end'}}>
            <button onClick={()=>setSaveDraftModal(false)} style={{padding:'5px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'11px',cursor:'pointer',color:'#555'}}>ยกเลิก</button>
          </div>
        </div>
      </div>
    )}
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ padding:'14px 18px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',gap:'8px' }}>
            <div style={{ width:'26px',height:'26px',borderRadius:'6px',background:folder.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px' }}>{folder.icon}</div>
            <span style={{ fontSize:'13px',fontWeight:'500',color:'#1a3a5c' }}>เพิ่มไฟล์ใน {folder.label}</span>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#888' }}>×</button>
        </div>
        {/* Tab paste: แสดงสรุปว่าจะ Gen อะไรบ้าง (info เท่านั้น ไม่ให้เลือก) */}
        {tab === 'paste' && parsedRows.length > 0 && (() => {
          const ap09Count = parseAP09RowsFromRaw(parsedRows).length;
          return (
            <div style={{ padding:'6px 18px',borderBottom:'0.5px solid #f0f0f0',background:'#f0f6ff',flexShrink:0,display:'flex',alignItems:'center',gap:'10px' }}>
              <span style={{ fontSize:'11px',color:'#0C447C',fontWeight:'500' }}>จะ Gen:</span>
              <span onClick={()=>setPreviewDocType('APN01')} style={{ fontSize:'11px',padding:'2px 10px',borderRadius:'20px',background:previewDocType==='APN01'?'#1a3a5c':'#e8eef5',color:previewDocType==='APN01'?'white':'#1a3a5c',cursor:'pointer',border:'0.5px solid #1a3a5c' }}>APN01 ({parsedRows.length})</span>
              {ap09Count > 0 && (
                <span onClick={()=>setPreviewDocType('AP09')} style={{ fontSize:'11px',padding:'2px 10px',borderRadius:'20px',background:previewDocType==='AP09'?'#0F6E56':'#e6f4f0',color:previewDocType==='AP09'?'white':'#0F6E56',cursor:'pointer',border:'0.5px solid #0F6E56' }}>AP09 ({ap09Count})</span>
              )}
              <span style={{ fontSize:'11px',color:'#888',marginLeft:'4px' }}>— บันทึกอัตโนมัติทั้งคู่</span>
            </div>
          );
        })()}
        <div style={{ padding:'14px 18px', flexShrink:0 }}>
          {error && <div style={{ background:'#FCEBEB',color:'#791F1F',padding:'7px 12px',borderRadius:'6px',fontSize:'12px',marginBottom:'10px' }}>{error}</div>}
          <div style={{ display:'flex' }}>
            <button style={{ ...S.tab(tab==='paste'),borderRadius:'6px 0 0 6px' }} onClick={()=>setTab('paste')}>📋 วางจาก Excel/Sheet</button>
            <button style={{ ...S.tab(tab==='file'),borderLeft:'none' }} onClick={()=>setTab('file')}>📎 แนบไฟล์ Excel (หลายไฟล์)</button>
            <button style={{ ...S.tab(tab==='pdf'),borderRadius:'0 6px 6px 0',borderLeft:'none' }} onClick={()=>setTab('pdf')}>📄 OCR PDF</button>
          </div>
        </div>

        {/* ── Tab content ── */}
        {tab==='pdf' ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
            <PdfOcrTab serialCode={serialCode} setSerialCode={setSerialCode} docType={docType} setDocType={setDocType} DOC_TYPE_MAP={DOC_TYPE_MAP} db={db} userName={userName} currentUser={currentUser} onSave={onSave} onClose={onClose} saving={saving} setSaving={setSaving} genSerial={genSerial} pdfQueue={pdfQueue} setPdfQueue={setPdfQueue} pdfSelected={pdfSelected} setPdfSelected={setPdfSelected} folder={folder}/>
          </div>
        ) : (
        <div style={{ padding:'0 18px 14px', overflowY:'auto', flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
          {tab==='paste' ? (
            <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
              {/* sub-tabs: + New | Report / Draft */}
              <div style={{ display:'flex',borderBottom:'0.5px solid #eee',flexShrink:0,margin:'0 -18px',padding:'0 18px',background:'#f8f9fa' }}>
                <button onClick={()=>setPasteSubTab('new')}
                  style={{ padding:'6px 14px',fontSize:'11px',background:'none',border:'none',borderBottom:`2px solid ${pasteSubTab==='new'?'#1a3a5c':'transparent'}`,color:pasteSubTab==='new'?'#1a3a5c':'#888',cursor:'pointer',fontWeight:pasteSubTab==='new'?'500':'400' }}>
                  + New
                </button>
                <button onClick={()=>{ setPasteSubTab('draft'); loadDrafts(); }}
                  style={{ padding:'6px 14px',fontSize:'11px',background:'none',border:'none',borderBottom:`2px solid ${pasteSubTab==='draft'?'#1a3a5c':'transparent'}`,color:pasteSubTab==='draft'?'#1a3a5c':'#888',cursor:'pointer',fontWeight:pasteSubTab==='draft'?'500':'400',display:'flex',alignItems:'center',gap:'5px' }}>
                  Report / Draft
                  {drafts.length>0 && <span style={{background:'#FFF9E6',color:'#856404',borderRadius:'3px',padding:'0 5px',fontSize:'9px',fontWeight:'600'}}>{drafts.length}</span>}
                  {(isOwner||isAdmin||isEditor) && pasteSubTab==='draft' && (
                    <span onClick={e=>e.stopPropagation()} style={{marginLeft:'6px',display:'flex',alignItems:'center',gap:'4px'}}>
                      <span style={{fontSize:'9px',color:'#888'}}>ดูของ</span>
                      <select value={draftUserFilter} onChange={e=>{setDraftUserFilter(e.target.value);setDraftLevel(1);setDraftDocType(null);setDraftBU(null);setSelectedDraftIds([]);setSelectedDraft(null);}}
                        style={{fontSize:'10px',padding:'1px 4px',borderRadius:'4px',border:'0.5px solid #ccc',background:'white',color:'#1a3a5c',cursor:'pointer',outline:'none',maxWidth:'130px'}}>
                        <option value="me">ของฉัน ({userName||currentUser?.email||''})</option>
                        {draftUserList.filter(u=>u!==(userName||currentUser?.email||'')).map(u=>(
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </span>
                  )}
                </button>
              </div>
              {pasteSubTab==='draft' ? (
                <div style={{display:'flex',flex:1,minHeight:0,marginTop:'8px',border:'0.5px solid #e0e0e0',borderRadius:'8px',overflow:'hidden'}}>
                  {/* Left: list */}
                  <div style={{width:'210px',flexShrink:0,borderRight:'0.5px solid #e0e0e0',overflowY:'auto',background:'#f8f9fa',display:'flex',flexDirection:'column'}}>
                    <div style={{padding:'5px 10px',borderBottom:'0.5px solid #e0e0e0',display:'flex',alignItems:'center',gap:'6px',background:'#f0f2f5',flexShrink:0,minHeight:'27px'}}>
                      {(()=>{
                        if (!(draftLevel===2 && draftDocType && draftBU)) {
                          return <span style={{fontSize:'10px',color:'#bbb'}}>เลือก BU ก่อนจึงจะเลือกหลายรายการได้</span>;
                        }
                        const scopedDrafts = drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU);
                        const scopedIds = scopedDrafts.map(d=>d.id);
                        const selInScope = selectedDraftIds.filter(id=>scopedIds.includes(id));
                        const allChk = scopedDrafts.length>0 && selInScope.length===scopedDrafts.length;
                        return (<>
                          <input type='checkbox' checked={allChk}
                            onChange={e=>setSelectedDraftIds(p=>e.target.checked?[...new Set([...p,...scopedIds])]:p.filter(x=>!scopedIds.includes(x)))}
                            style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                          <span style={{fontSize:'10px',color:'#555',fontWeight:'500'}}>เลือกทั้งหมด</span>
                          {selInScope.length>0&&<span style={{marginLeft:'auto',fontSize:'10px',color:'#0C447C',fontWeight:'500'}}>เลือก {selInScope.length}/{scopedDrafts.length}</span>}
                        </>);
                      })()}
                    </div>
                    {draftLevel===1&&(
                      <div style={{flex:1,overflowY:'auto'}}>
                        {draftsLoading&&<div style={{fontSize:'12px',color:'#888',padding:'20px',textAlign:'center'}}>กำลังโหลด...</div>}
                        {!draftsLoading&&drafts.length===0&&<div style={{fontSize:'12px',color:'#aaa',padding:'40px 10px',textAlign:'center'}}>No Draft</div>}
                        {['APN01','AP09','AP07'].filter(t=>drafts.some(d=>d.doc_type===t)).map(t=>{
                          const cnt=drafts.filter(d=>d.doc_type===t).length;
                          const label=t==='AP09'?'AP09 - Tax Invoice':t==='AP07'?'AP07':t+' - Invoice Register';
                          return <div key={t} onClick={()=>{ setDraftDocType(t); setDraftLevel(2); setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }}
                            style={{padding:'12px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                            <div>
                              <div style={{fontSize:'12px',fontWeight:'500',color:t==='AP09'?'#0F6E56':'#1a3a5c'}}>{label}</div>
                              <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{cnt} draft</div>
                            </div>
                            <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                          </div>;
                        })}
                      </div>
                    )}
                    {draftLevel===2&&draftDocType&&!draftBU&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                          <button onClick={()=>{ setDraftLevel(1); setDraftDocType(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                          <span style={{fontSize:'11px',fontWeight:'600',color:draftDocType==='AP09'?'#0F6E56':'#1a3a5c',marginLeft:'4px'}}>{draftDocType}</span>
                        </div>
                        <div style={{flex:1,overflowY:'auto'}}>
                          {[...new Set(drafts.filter(d=>d.doc_type===draftDocType).map(d=>d.bu_code||(d.serial_code||'').split('_')[0]||'?'))].map(bu=>{
                            const buDrafts=drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===bu);
                            return <div key={bu} onClick={()=>{ setDraftBU(bu); setSelectedDraftIds([]); setSelectedDraft(null); }}
                              style={{padding:'10px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                              <div>
                                <div style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{bu}</div>
                                <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{buDrafts.length} draft</div>
                              </div>
                              <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                            </div>;
                          })}
                        </div>
                      </div>
                    )}
                    {draftLevel===2&&draftDocType&&draftBU&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                          <button onClick={()=>{ setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                          <span style={{fontSize:'11px',color:'#888',marginLeft:'2px'}}>{draftDocType}</span>
                          <span style={{fontSize:'11px',color:'#ccc'}}>/</span>
                          <span style={{fontSize:'11px',fontWeight:'600',color:'#1a3a5c'}}>{draftBU}</span>
                        </div>

                        <div style={{flex:1,overflowY:'auto'}}>
                          {drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU).map(d=>{
                            const isChk=selectedDraftIds.includes(d.id);
                            const isSel=selectedDraft?.id===d.id;
                            return <div key={d.id} onClick={()=>{ setSelectedDraft(d); const newIds=selectedDraftIds.includes(d.id)?selectedDraftIds.filter(x=>x!==d.id):[...selectedDraftIds,d.id]; setSelectedDraftIds(newIds); const sel=drafts.filter(x=>newIds.includes(x.id)); if(sel.length>0){const bu=sel[0].bu_code||(sel[0].serial_code||'').split('_')[0]||'XX'; setSerialCode(genSerial(bu,sel[0].doc_type||'APN01'));} else setSerialCode(''); }}
                              style={{padding:'8px 10px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',gap:'7px',background:isSel?'#e8f0fb':'white',borderLeft:isSel?'2.5px solid #1a3a5c':'2.5px solid transparent'}}>
                              <input type='checkbox' checked={isChk}
                                onChange={e=>{ e.stopPropagation(); const chk=e.target.checked; const newIds=chk?[...selectedDraftIds,d.id]:selectedDraftIds.filter(x=>x!==d.id); setSelectedDraftIds(newIds); setSelectedDraft(chk?d:(selectedDraft?.id===d.id?null:selectedDraft)); const sel=drafts.filter(x=>newIds.includes(x.id)); if(sel.length>0){const bu=sel[0].bu_code||(sel[0].serial_code||'').split('_')[0]||'XX'; setSerialCode(genSerial(bu,sel[0].doc_type||'APN01'));} else setSerialCode(''); }}
                                onClick={e=>e.stopPropagation()}
                                style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.serial_code||d.doc_name||'-'}</div>
                                <div style={{fontSize:'10px',color:'#888',marginTop:'1px'}}>{d.rows?.length||0} แถว · {(d.created_at||'').slice(0,10)}</div>
                              </div>
                            </div>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    {(()=>{
                      const previewDrafts = drafts.filter(d=>selectedDraftIds.includes(d.id));
                      if (previewDrafts.length===0) return (
                        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'8px',color:'#aaa'}}>
                          <span style={{fontSize:'28px'}}>&#128196;</span>
                          <span style={{fontSize:'12px'}}>เลือก Draft ทางซ้ายเพื่อดู Preview</span>
                        </div>
                      );
                      const firstDraft = selectedDraft || previewDrafts[0];
                      const isAP09d = firstDraft.doc_type==='AP09';
                      const APN01_COLS=['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
                      const AP09_COLS=['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'];
                      const COLS = isAP09d ? AP09_COLS : APN01_COLS;
                      const NUM_COLS = isAP09d?['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม']:['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
                      const thBg = isAP09d?'#0F6E56':'#1a3a5c';
                      const allRows = previewDrafts.flatMap(d=>(d.rows||[]).map(r=>mapRowsForExcel([r],isAP09d?'AP09':'APN01')[0]||r));
                      const totalRows = previewDrafts.reduce((s,d)=>s+(d.rows?.length||0),0);
                      return (
                        <>
                          <div style={{padding:'8px 14px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                            <div style={{minWidth:0,flex:1}}>
                              {previewDrafts.length===1
                                ?<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{firstDraft.serial_code}</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถว · {firstDraft.doc_type}</span></>
                                :<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{previewDrafts.length} Draft</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถวรวม · {firstDraft.doc_type}</span></>
                              }
                            </div>
                            {previewDrafts.length===1&&(()=>{
                              const me = userName || currentUser?.email || '';
                              const canDel = isOwner || isAdmin || isEditor || firstDraft.uploaded_by===me;
                              return (
                                <button onClick={async()=>{ if(!canDel) return; setConfirmDraftDelete({id:firstDraft.id,serial:firstDraft.serial_code,multi:false}); }}
                                  disabled={!canDel}
                                  title={!canDel?'เจ้าของ Draft เท่านั้น':''}
                                  style={{fontSize:'11px',padding:'4px 10px',borderRadius:'6px',border:'0.5px solid #f7c1c1',background:canDel?'#FCEBEB':'#f5f5f5',color:canDel?'#791F1F':'#bbb',cursor:canDel?'pointer':'not-allowed',flexShrink:0}}>
                                  🗑 ลบ draft
                                </button>
                              );
                            })()}
                          </div>
                          <div style={{flex:1,overflowX:'auto',overflowY:'auto'}}>
                            <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
                              <thead><tr>
                                <th style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1,textAlign:'center',width:'32px'}}>#</th>
                                {COLS.map((h,i)=>(<th key={i} style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:NUM_COLS.includes(h)?'right':'left',position:'sticky',top:0,zIndex:1,borderRight:'0.5px solid rgba(255,255,255,0.1)'}}>{h}</th>))}
                              </tr></thead>
                              <tbody>{allRows.map((row,i)=>(
                                <tr key={i} style={{background:i%2===0?'white':'#f8f9fa'}}>
                                  <td style={{padding:'4px 8px',textAlign:'center',color:'#aaa',fontSize:'10px'}}>{i+1}</td>
                                  {COLS.map((h,j)=>{
                                    const isNum=NUM_COLS.includes(h); const v=row[h];
                                    const isDesc=h==='Description'||h==='รายการ';
                                    const fv=isNum&&v?Number(String(v).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):(v||'');
                                    return <td key={j} title={isDesc?String(fv):undefined} style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',borderRight:'0.5px solid #f5f5f5',textAlign:isNum?'right':'left',maxWidth:isDesc?'160px':'none',overflow:isDesc?'hidden':'visible',textOverflow:isDesc?'ellipsis':'clip',whiteSpace:'nowrap'}}>{fv}</td>;
                                  })}
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                          {/* ปุ่ม Submit ย้ายไปอยู่ที่ปุ่มล่างสุดของ Modal แล้ว */}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
              <>{parsedRows.length === 0 ? (
                <textarea placeholder="คลิกแล้ววาง (Ctrl+V) ข้อมูลจาก Excel หรือ Google Sheet ที่นี่ — ระบบจะแยกคอลัมน์ตาม Tab ให้อัตโนมัติ"
                  style={{ flex:1, width:'100%', minHeight:'200px', fontSize:'11px',borderRadius:'6px',border:'0.5px solid #d0d0d0',padding:'8px',boxSizing:'border-box',resize:'none',fontFamily:'monospace',lineHeight:1.5,whiteSpace:'pre',overflowX:'auto' }}
                  value={pasteText} onChange={e=>handlePaste(e.target.value)}/>
              ) : (
                <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
                  {(() => {
                    const ap09Count = parseAP09RowsFromRaw(parsedRows).length;
                    // เช็ค sci จาก parsedRows — ยกเว้น rows ที่มี [ ] field (Fleet Card จะดึง Invoice จาก [ ] แทน)
                    const sciCount = parsedRows.filter(r=>{
                      const bracket = String(r['[ ]']||'').toLowerCase();
                      if (bracket.includes('.yes.') || bracket.endsWith('.yes') || /\.yes\b/.test(bracket)) return false;
                      return /^-?\d+\.?\d*[eE][+-]?\d+$/.test(String(r['Invoice Num']||''));
                    }).length;
                    const hasDup = dupWarnings.length > 0;
                    const hasSci = sciCount > 0;
                    const apn01DupW = dupWarnings.filter(d=>d.docType==='APN01');
                    const ap09DupW  = dupWarnings.filter(d=>d.docType==='AP09');
                    const ap09TotalCnt = parseAP09RowsFromRaw(parsedRows).length;
                    const allDup = hasDup && apn01DupW.length>=parsedRows.length && (ap09TotalCnt===0||ap09DupW.length>=ap09TotalCnt);
                    const bg = hasSci||allDup?'#FCEBEB':hasDup?'#FFF9E6':'#EAF3DE';
                    const border = hasSci||allDup?'#f7c1c1':hasDup?'#FFE082':'#c0dd97';
                    const tc = hasSci||allDup?'#791F1F':hasDup?'#856404':'#27500A';
                    return (
                      <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 10px',background:bg,border:`0.5px solid ${border}`,borderRadius:'6px 6px 0 0',fontSize:'10px',color:tc,flexShrink:0}}>
                        <span>{hasSci||allDup?'🚨':hasDup?'⚠️':'✅'}</span>
                        <span>
                          {hasSci
                            ? <><strong>Format ผิด {sciCount} แถว</strong> — ตรวจสอบ Invoice Num</>
                            : hasDup
                                                    ? <>{apn01DupW.length>0&&<span>APN01: <strong>ซ้ำ {apn01DupW.length}/{parsedRows.length} แถว</strong></span>}{apn01DupW.length>0&&ap09DupW.length>0&&<span style={{margin:'0 6px',color:'#ccc'}}>|</span>}{ap09DupW.length>0&&<span>AP09: <strong>ซ้ำ {ap09DupW.length}/{ap09TotalCnt} แถว</strong></span>}{allDup&&' — อาจเคย Upload ไปแล้ว'}</>
                              : <><strong>เอาเข้า {parsedRows.length} แถว</strong>{ap09Count>0?` · AP09 ${ap09Count} แถว`:''}</>
                          }
                        </span>
                        <span style={{marginLeft:'auto',display:'flex',gap:'5px',alignItems:'center'}}>
                          <button onClick={()=>setPreviewDocType('APN01')} style={{padding:'1px 7px',borderRadius:'20px',border:'0.5px solid #1a3a5c',background:previewDocType==='APN01'?'#1a3a5c':'white',color:previewDocType==='APN01'?'white':'#1a3a5c',fontSize:'9px',cursor:'pointer'}}>APN01</button>
                          {ap09Count>0&&<button onClick={()=>setPreviewDocType('AP09')} style={{padding:'1px 7px',borderRadius:'20px',border:'0.5px solid #0F6E56',background:previewDocType==='AP09'?'#0F6E56':'white',color:previewDocType==='AP09'?'white':'#0F6E56',fontSize:'9px',cursor:'pointer'}}>AP09</button>}
                          <button onClick={()=>{setPasteText('');setParsedRows([]);setParsedHeaders([]);setSerialCode('');setFormatWarning('');setDupWarnings([]);setSciInvNums(new Set());}} style={{fontSize:'9px',padding:'1px 6px',borderRadius:'4px',border:'0.5px solid #aaa',background:'white',cursor:'pointer',color:'#888'}}>✕ ล้าง</button>
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{flex:1,overflowX:'auto',overflowY:'auto',minHeight:0,border:'0.5px solid #d0d0d0',borderTop:'none',borderRadius:'0 0 6px 6px'}}>
                    <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
                      {(()=>{
                        const isAP09v = previewDocType==='AP09';
                        const rawPrev = isAP09v ? parseAP09RowsFromRaw(parsedRows) : parsedRows;
                        const APN01_COLS=['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
                        const AP09_COLS=['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'];
                        const COLS = isAP09v ? AP09_COLS : APN01_COLS;
                        const NUM_COLS = isAP09v ? ['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'] : ['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
                        const mapped = rawPrev.map(r=>mapRowsForExcel([r],isAP09v?'AP09':'APN01')[0]||{});
                        // filter dupWarnings ตาม docType ของ view — APN01 เห็นเฉพาะ APN01 dup, AP09 เห็นเฉพาะ AP09 dup
                        const dupMap = {};
                        dupWarnings
                          .filter(d => isAP09v ? d.docType === 'AP09' : d.docType !== 'AP09')
                          .forEach(d => { dupMap[d.invoiceNo] = d; });
                        const thBg = isAP09v?'#0F6E56':'#1a3a5c';
                        const fmtDate = (d)=>{ try{return new Date(d).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'});}catch(_){return d?.slice(0,10)||'—';} };
                        return (<>
                          <thead><tr>
                            <th style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'center',borderRight:'0.5px solid rgba(255,255,255,0.15)',position:'sticky',top:0,zIndex:1,width:'36px'}}>#</th>
                            {COLS.map((h,i)=>(<th key={i} style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:NUM_COLS.includes(h)?'right':'left',borderRight:'0.5px solid rgba(255,255,255,0.15)',position:'sticky',top:0,zIndex:1,maxWidth:h==='Description'||h==='รายการ'?'160px':'none',whiteSpace:'nowrap'}}>{h}</th>))}
                            <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'center',position:'sticky',top:0,zIndex:1}}>Dup %</th>
                            <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1}}>Updated by</th>
                            <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1,whiteSpace:'nowrap'}}>Updated at</th>
                          </tr></thead>
                          <tbody>{mapped.map((row,i)=>{
                            const invKey=(isAP09v?(row['Tax Invoice No.']||''):(row['Invoice Number']||'')).trim().toLowerCase();
                            const dup=dupMap[invKey];
                            const isDupRow=!!dup&&dup.confidence>=80;
                            const rawInv=(isAP09v?(row['Tax Invoice No.']||''):(row['Invoice Number']||row['Invoice Num']||'')).trim();
                            const isSciRow=sciInvNums.has(rawInv)||/^-?\d+\.?\d*[eE][+-]?\d+$/.test(rawInv);
                            const rowBg=isSciRow?'#FEF2F2':isDupRow?'#FFFBF0':i%2===0?'white':'#f8f9fa';
                            return (
                              <tr key={i} style={{background:rowBg}} onMouseEnter={e=>e.currentTarget.style.background='#e8f0fe'} onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                                <td style={{padding:'4px 8px',textAlign:'center',borderRight:'0.5px solid #f0f0f0',borderBottom:'0.5px solid #f0f0f0',color:'#aaa',fontSize:'10px',width:'36px'}}>{i+1}</td>
                                {COLS.map((h,j)=>{
                                  const isNum=NUM_COLS.includes(h);
                                  const isDesc=h==='Description'||h==='รายการ';
                                  const isInvCol=h==='Invoice Number'||h==='Invoice Num'||h==='Tax Invoice No.';
                                  const v=row[h];
                                  const fv=isNum&&v?Number(String(v).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):(v||'');
                                  const cellSci=isSciRow&&isInvCol;
                                  return <td key={j} title={isDesc?fv:(cellSci?'⚠️ Invoice Number ผิด Format':undefined)} style={{padding:'4px 8px',borderRight:'0.5px solid #f0f0f0',borderBottom:'0.5px solid #f0f0f0',textAlign:isNum?'right':'left',maxWidth:isDesc?'160px':'none',overflow:isDesc?'hidden':'visible',textOverflow:isDesc?'ellipsis':'clip',whiteSpace:'nowrap',...(cellSci?{background:'#FEE2E2',color:'#991B1B',fontWeight:'600'}:{})}}>{fv}</td>;
                                })}
                                <td style={{padding:'4px 8px',textAlign:'center',borderBottom:'0.5px solid #f0f0f0',fontWeight:'500',color:dup?(dup.confidence>=90?'#791F1F':'#856404'):'#ccc'}}>{dup?dup.confidence+'%':'—'}</td>
                                <td style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',color:dup?'#555':'#ccc',whiteSpace:'nowrap'}}>{dup?((dup.status==='draft'?'Draft by ':'Created by ')+(dup.uploadedBy||'—')):'—'}</td>
                                <td style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',color:dup?'#888':'#ccc',whiteSpace:'nowrap'}}>{dup?fmtDate(dup.createdAt):'—'}</td>
                              </tr>
                            );
                          })}</tbody>
                        </>);
                      })()}
                    </table>
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          ) : (
            <div style={{ display:'flex',flexDirection:'column',flex:1,minHeight:0 }}>
              {/* sub-tabs: New | Report/Draft — เหมือน Paste tab */}
              <div style={{ display:'flex',borderBottom:'0.5px solid #eee',flexShrink:0,margin:'0 -18px',padding:'0 18px',background:'#f8f9fa' }}>
                <button onClick={()=>setPasteSubTab('new')}
                  style={{ padding:'6px 14px',fontSize:'11px',background:'none',border:'none',borderBottom:`2px solid ${pasteSubTab==='new'?'#1a3a5c':'transparent'}`,color:pasteSubTab==='new'?'#1a3a5c':'#888',cursor:'pointer',fontWeight:pasteSubTab==='new'?'500':'400' }}>
                  + New
                </button>
                <button onClick={()=>{ setPasteSubTab('draft'); setDraftLevel(1); setDraftDocType(null); setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); loadDrafts(); }}
                  style={{ padding:'6px 14px',fontSize:'11px',background:'none',border:'none',borderBottom:`2px solid ${pasteSubTab==='draft'?'#1a3a5c':'transparent'}`,color:pasteSubTab==='draft'?'#1a3a5c':'#888',cursor:'pointer',fontWeight:pasteSubTab==='draft'?'500':'400',display:'flex',alignItems:'center',gap:'5px' }}>
                  Report / Draft
                  {drafts.length>0 && <span style={{background:'#FFF9E6',color:'#856404',borderRadius:'3px',padding:'0 5px',fontSize:'9px',fontWeight:'600'}}>{drafts.length}</span>}
                  {(isOwner||isAdmin||isEditor) && pasteSubTab==='draft' && (
                    <span onClick={e=>e.stopPropagation()} style={{marginLeft:'6px',display:'flex',alignItems:'center',gap:'4px'}}>
                      <span style={{fontSize:'9px',color:'#888'}}>ดูของ</span>
                      <select value={draftUserFilter} onChange={e=>{setDraftUserFilter(e.target.value);setDraftLevel(1);setDraftDocType(null);setDraftBU(null);setSelectedDraftIds([]);setSelectedDraft(null);}}
                        style={{fontSize:'10px',padding:'1px 4px',borderRadius:'4px',border:'0.5px solid #ccc',background:'white',color:'#1a3a5c',cursor:'pointer',outline:'none',maxWidth:'130px'}}>
                        <option value="me">ของฉัน ({userName||currentUser?.email||''})</option>
                        {draftUserList.filter(u=>u!==(userName||currentUser?.email||'')).map(u=>(
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </span>
                  )}
                </button>
              </div>
              {pasteSubTab==='draft' ? (
                <div style={{display:'flex',flex:1,minHeight:0,marginTop:'8px',border:'0.5px solid #e0e0e0',borderRadius:'8px',overflow:'hidden'}}>
                  {/* Left: list */}
                  <div style={{width:'210px',flexShrink:0,borderRight:'0.5px solid #e0e0e0',overflowY:'auto',background:'#f8f9fa',display:'flex',flexDirection:'column'}}>
                    <div style={{padding:'5px 10px',borderBottom:'0.5px solid #e0e0e0',display:'flex',alignItems:'center',gap:'6px',background:'#f0f2f5',flexShrink:0,minHeight:'27px'}}>
                      {(()=>{
                        if (!(draftLevel===2 && draftDocType && draftBU)) {
                          return <span style={{fontSize:'10px',color:'#bbb'}}>เลือก BU ก่อนจึงจะเลือกหลายรายการได้</span>;
                        }
                        const scopedDrafts = drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU);
                        const scopedIds = scopedDrafts.map(d=>d.id);
                        const selInScope = selectedDraftIds.filter(id=>scopedIds.includes(id));
                        const allChk = scopedDrafts.length>0 && selInScope.length===scopedDrafts.length;
                        return (<>
                          <input type='checkbox' checked={allChk}
                            onChange={e=>setSelectedDraftIds(p=>e.target.checked?[...new Set([...p,...scopedIds])]:p.filter(x=>!scopedIds.includes(x)))}
                            style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                          <span style={{fontSize:'10px',color:'#555',fontWeight:'500'}}>เลือกทั้งหมด</span>
                          {selInScope.length>0&&<span style={{marginLeft:'auto',fontSize:'10px',color:'#0C447C',fontWeight:'500'}}>เลือก {selInScope.length}/{scopedDrafts.length}</span>}
                        </>);
                      })()}
                    </div>
                    {draftLevel===1&&(
                      <div style={{flex:1,overflowY:'auto'}}>
                        {draftsLoading&&<div style={{fontSize:'12px',color:'#888',padding:'20px',textAlign:'center'}}>กำลังโหลด...</div>}
                        {!draftsLoading&&drafts.length===0&&<div style={{fontSize:'12px',color:'#aaa',padding:'40px 10px',textAlign:'center'}}>No Draft</div>}
                        {['APN01','AP09','AP07'].filter(t=>drafts.some(d=>d.doc_type===t)).map(t=>{
                          const cnt=drafts.filter(d=>d.doc_type===t).length;
                          const label=t==='AP09'?'AP09 - Tax Invoice':t==='AP07'?'AP07':t+' - Invoice Register';
                          return <div key={t} onClick={()=>{ setDraftDocType(t); setDraftLevel(2); setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }}
                            style={{padding:'12px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                            <div>
                              <div style={{fontSize:'12px',fontWeight:'500',color:t==='AP09'?'#0F6E56':'#1a3a5c'}}>{label}</div>
                              <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{cnt} draft</div>
                            </div>
                            <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                          </div>;
                        })}
                      </div>
                    )}
                    {draftLevel===2&&draftDocType&&!draftBU&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                          <button onClick={()=>{ setDraftLevel(1); setDraftDocType(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                          <span style={{fontSize:'11px',fontWeight:'600',color:draftDocType==='AP09'?'#0F6E56':'#1a3a5c',marginLeft:'4px'}}>{draftDocType}</span>
                        </div>
                        <div style={{flex:1,overflowY:'auto'}}>
                          {[...new Set(drafts.filter(d=>d.doc_type===draftDocType).map(d=>d.bu_code||(d.serial_code||'').split('_')[0]||'?'))].map(bu=>{
                            const buDrafts=drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===bu);
                            return <div key={bu} onClick={()=>{ setDraftBU(bu); setSelectedDraftIds([]); setSelectedDraft(null); }}
                              style={{padding:'10px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                              <div>
                                <div style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{bu}</div>
                                <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{buDrafts.length} draft</div>
                              </div>
                              <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                            </div>;
                          })}
                        </div>
                      </div>
                    )}
                    {draftLevel===2&&draftDocType&&draftBU&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                          <button onClick={()=>{ setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                          <span style={{fontSize:'11px',color:'#888',marginLeft:'2px'}}>{draftDocType}</span>
                          <span style={{fontSize:'11px',color:'#ccc'}}>/</span>
                          <span style={{fontSize:'11px',fontWeight:'600',color:'#1a3a5c'}}>{draftBU}</span>
                        </div>

                        <div style={{flex:1,overflowY:'auto'}}>
                          {drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU).map(d=>{
                            const isChk=selectedDraftIds.includes(d.id);
                            const isSel=selectedDraft?.id===d.id;
                            return <div key={d.id} onClick={()=>{ setSelectedDraft(d); const newIds=selectedDraftIds.includes(d.id)?selectedDraftIds.filter(x=>x!==d.id):[...selectedDraftIds,d.id]; setSelectedDraftIds(newIds); const sel=drafts.filter(x=>newIds.includes(x.id)); if(sel.length>0){const bu=sel[0].bu_code||(sel[0].serial_code||'').split('_')[0]||'XX'; setSerialCode(genSerial(bu,sel[0].doc_type||'APN01'));} else setSerialCode(''); }}
                              style={{padding:'8px 10px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',gap:'7px',background:isSel?'#e8f0fb':'white',borderLeft:isSel?'2.5px solid #1a3a5c':'2.5px solid transparent'}}>
                              <input type='checkbox' checked={isChk}
                                onChange={e=>{ e.stopPropagation(); const chk=e.target.checked; const newIds=chk?[...selectedDraftIds,d.id]:selectedDraftIds.filter(x=>x!==d.id); setSelectedDraftIds(newIds); setSelectedDraft(chk?d:(selectedDraft?.id===d.id?null:selectedDraft)); const sel=drafts.filter(x=>newIds.includes(x.id)); if(sel.length>0){const bu=sel[0].bu_code||(sel[0].serial_code||'').split('_')[0]||'XX'; setSerialCode(genSerial(bu,sel[0].doc_type||'APN01'));} else setSerialCode(''); }}
                                onClick={e=>e.stopPropagation()}
                                style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.serial_code||d.doc_name||'-'}</div>
                                <div style={{fontSize:'10px',color:'#888',marginTop:'1px'}}>{d.rows?.length||0} แถว · {(d.created_at||'').slice(0,10)}</div>
                              </div>
                            </div>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    {(()=>{
                      const previewDrafts = drafts.filter(d=>selectedDraftIds.includes(d.id));
                      if (previewDrafts.length===0) return (
                        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'8px',color:'#aaa'}}>
                          <span style={{fontSize:'28px'}}>&#128196;</span>
                          <span style={{fontSize:'12px'}}>เลือก Draft ทางซ้ายเพื่อดู Preview</span>
                        </div>
                      );
                      const firstDraft = selectedDraft || previewDrafts[0];
                      const isAP09d = firstDraft.doc_type==='AP09';
                      const APN01_COLS=['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
                      const AP09_COLS=['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'];
                      const COLS = isAP09d ? AP09_COLS : APN01_COLS;
                      const NUM_COLS = isAP09d?['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม']:['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
                      const thBg = isAP09d?'#0F6E56':'#1a3a5c';
                      const allRows = previewDrafts.flatMap(d=>(d.rows||[]).map(r=>mapRowsForExcel([r],isAP09d?'AP09':'APN01')[0]||r));
                      const totalRows = previewDrafts.reduce((s,d)=>s+(d.rows?.length||0),0);
                      return (
                        <>
                          <div style={{padding:'8px 14px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                            <div style={{minWidth:0,flex:1}}>
                              {previewDrafts.length===1
                                ?<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{firstDraft.serial_code}</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถว · {firstDraft.doc_type}</span></>
                                :<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{previewDrafts.length} Draft</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถวรวม · {firstDraft.doc_type}</span></>
                              }
                            </div>
                            {previewDrafts.length===1&&(()=>{
                              const me = userName || currentUser?.email || '';
                              const canDel = isOwner || isAdmin || isEditor || firstDraft.uploaded_by===me;
                              return (
                                <button onClick={async()=>{ if(!canDel) return; setConfirmDraftDelete({id:firstDraft.id,serial:firstDraft.serial_code,multi:false}); }}
                                  disabled={!canDel}
                                  title={!canDel?'เจ้าของ Draft เท่านั้น':''}
                                  style={{fontSize:'11px',padding:'4px 10px',borderRadius:'6px',border:'0.5px solid #f7c1c1',background:canDel?'#FCEBEB':'#f5f5f5',color:canDel?'#791F1F':'#bbb',cursor:canDel?'pointer':'not-allowed',flexShrink:0}}>
                                  🗑 ลบ draft
                                </button>
                              );
                            })()}
                          </div>
                          <div style={{flex:1,overflowX:'auto',overflowY:'auto'}}>
                            <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
                              <thead><tr>
                                <th style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1,textAlign:'center',width:'32px'}}>#</th>
                                {COLS.map((h,i)=>(<th key={i} style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:NUM_COLS.includes(h)?'right':'left',position:'sticky',top:0,zIndex:1,borderRight:'0.5px solid rgba(255,255,255,0.1)'}}>{h}</th>))}
                              </tr></thead>
                              <tbody>{allRows.map((row,i)=>(
                                <tr key={i} style={{background:i%2===0?'white':'#f8f9fa'}}>
                                  <td style={{padding:'4px 8px',textAlign:'center',color:'#aaa',fontSize:'10px'}}>{i+1}</td>
                                  {COLS.map((h,j)=>{
                                    const isNum=NUM_COLS.includes(h); const v=row[h];
                                    const isDesc=h==='Description'||h==='รายการ';
                                    const fv=isNum&&v?Number(String(v).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):(v||'');
                                    return <td key={j} title={isDesc?String(fv):undefined} style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',borderRight:'0.5px solid #f5f5f5',textAlign:isNum?'right':'left',maxWidth:isDesc?'160px':'none',overflow:isDesc?'hidden':'visible',textOverflow:isDesc?'ellipsis':'clip',whiteSpace:'nowrap'}}>{fv}</td>;
                                  })}
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
            <div style={{ display:'flex',border:'0.5px solid #e0e0e0',borderRadius:'8px',overflow:'hidden',flex:1,minHeight:'400px' }}>
              <div style={{ width:'190px',flexShrink:0,background:'#1a3a5c',display:'flex',flexDirection:'column' }}
                onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();handleFiles(e.dataTransfer.files);}}>
                <div style={{ flex:1,overflowY:'auto',padding:'6px' }}>
                  {fileQueue.length === 0 ? (
                    <div onClick={()=>fileRef.current?.click()} style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:'6px',cursor:'pointer' }}>
                      <div style={{ fontSize:'28px' }}>📊</div>
                      <div style={{ fontSize:'10px',color:'rgba(255,255,255,0.6)',textAlign:'center' }}>ลากไฟล์มาวาง<br/>หรือคลิกเลือก</div>
                      <div style={{ fontSize:'9px',color:'rgba(255,255,255,0.35)' }}>.xlsx, .xls</div>
                    </div>
                  ) : (
                    <>
                      {fileQueue.map((f,i)=>(
                        <div key={i} onClick={()=>setSelectedFileIdx(i)} style={{ display:'flex',alignItems:'center',gap:'6px',padding:'5px 7px',borderRadius:'5px',cursor:'pointer',marginBottom:'4px',background:selectedFileIdx===i?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.07)',border:selectedFileIdx===i?'0.5px solid rgba(255,255,255,0.35)':'0.5px solid transparent' }}>
                          <span style={{ fontSize:'14px',flexShrink:0 }}>{f.loading?'⏳':f.status==='done'?'✅':f.status==='error'?'❌':'📄'}</span>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontSize:'10px',color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{f.name}</div>
                            <div style={{ fontSize:'9px',color:'rgba(255,255,255,0.5)',marginTop:'1px' }}>{f.bu||'-'} · {f.detectedType}{f.rows?.length?` · ${f.rows.length}แถว`:''}</div>
                          </div>
                          <button onClick={e=>{e.stopPropagation();setFileQueue(prev=>{const next=prev.filter((_,j)=>j!==i);if(selectedFileIdx>=next.length)setSelectedFileIdx(Math.max(0,next.length-1));return next;});}} style={{ background:'none',border:'none',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:'12px',padding:'0 2px',lineHeight:1,flexShrink:0 }}>✕</button>
                        </div>
                      ))}
                      <div onClick={()=>fileRef.current?.click()} style={{ fontSize:'10px',color:'rgba(255,255,255,0.35)',textAlign:'center',marginTop:'6px',cursor:'pointer' }}>+ เพิ่มไฟล์</div>
                    </>
                  )}
                </div>
              </div>
              <div style={{ flex:1,background:'white',display:'flex',flexDirection:'column',overflow:'hidden' }}>
                {fileQueue.length === 0 ? (
                  <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'6px',color:'#aaa' }}>
                    <div style={{ fontSize:'28px' }}>📋</div>
                    <div style={{ fontSize:'11px' }}>เลือกไฟล์เพื่อดู Preview</div>
                  </div>
                ) : (() => {
                  const sel = fileQueue[selectedFileIdx]||fileQueue[0];
                  if (!sel) return null;
                  if (sel.loading) return <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'#888'}}>กำลังอ่านไฟล์...</div>;
                  if (!sel.rows?.length) return <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'#aaa'}}>ไม่มีข้อมูล</div>;
                  return (
                    <>
                      <div style={{padding:'6px 12px',borderBottom:'0.5px solid #f0f0f0',fontSize:'11px',display:'flex',gap:'8px',alignItems:'center',flexShrink:0}}>
                        <span style={{fontWeight:'500',color:'#1a3a5c'}}>{sel.name}</span>
                        <button onClick={()=>setFilePreviewType('APN01')} style={{padding:'1px 8px',borderRadius:'20px',border:'0.5px solid #1a3a5c',background:filePreviewType==='APN01'?'#1a3a5c':'white',color:filePreviewType==='APN01'?'white':'#1a3a5c',fontSize:'9px',cursor:'pointer'}}>APN01 ({sel.rows?.length||0})</button>
                        {sel.ap09Rows?.length>0&&<button onClick={()=>setFilePreviewType('AP09')} style={{padding:'1px 8px',borderRadius:'20px',border:'0.5px solid #0F6E56',background:filePreviewType==='AP09'?'#0F6E56':'white',color:filePreviewType==='AP09'?'white':'#0F6E56',fontSize:'9px',cursor:'pointer'}}>AP09 ({sel.ap09Rows.length})</button>}
                        <span style={{marginLeft:'auto',fontWeight:'400',color:'#aaa',fontSize:'10px'}}>{filePreviewType==='AP09'?(sel.ap09Rows?.length||0):sel.rows.length} แถว</span>
                      </div>
                      <div style={{flex:1,overflowX:'auto',overflowY:'auto'}}>
                        {(()=>{
                          const isAP09f = filePreviewType==='AP09';
                          const fRows = isAP09f ? (sel.ap09Rows||[]) : sel.rows;
                          const APN01_COLS=['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
                          const AP09_COLS=['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'];
                          const COLS = isAP09f ? AP09_COLS : APN01_COLS;
                          const NUM_COLS = isAP09f?['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม']:['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
                          const thBg = isAP09f?'#0F6E56':'#1a3a5c';
                          const fDupList = isAP09f ? (sel.ap09DupWarnings||[]) : (sel.dupWarnings||[]);
                          const fDupMap = {}; fDupList.forEach(d=>{fDupMap[d.invoiceNo]=d;});
                          const fmtDateF = (d)=>{ try{return new Date(d).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'});}catch(_){return d?.slice(0,10)||'—';} };
                          return (
                            <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
                              <thead><tr>
                                <th style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.9)',fontWeight:'500',textAlign:'center',position:'sticky',top:0,zIndex:1,width:'32px'}}>#</th>
                                {COLS.map((h,i)=>(<th key={i} style={{padding:'5px 10px',background:thBg,color:'rgba(255,255,255,0.9)',fontWeight:'500',textAlign:NUM_COLS.includes(h)?'right':'left',borderRight:'0.5px solid rgba(255,255,255,0.1)',position:'sticky',top:0,zIndex:1}}>{h}</th>))}
                                <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'center',position:'sticky',top:0,zIndex:1}}>Dup %</th>
                                <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1}}>Updated by</th>
                                <th style={{padding:'5px 8px',background:'#633806',color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1,whiteSpace:'nowrap'}}>Updated at</th>
                              </tr></thead>
                              <tbody>{fRows.map((row,i)=>{
                                const fInvKey=(isAP09f?(row['Tax Invoice No.']||''):(row['Invoice Number']||row['Invoice Num']||'')).trim().toLowerCase();
                                const fDup=fDupMap[fInvKey];
                                const fIsDupRow=!!fDup&&fDup.confidence>=80;
                                const fRowBg=fIsDupRow?'#FFFBF0':i%2===0?'white':'#f8f9fa';
                                return (
                                <tr key={i} style={{background:fRowBg}}>
                                  <td style={{padding:'4px 8px',textAlign:'center',color:'#aaa',fontSize:'10px'}}>{i+1}</td>
                                  {COLS.map((h,j)=>{
                                    const isNum=NUM_COLS.includes(h);
                                    const v=row[h];
                                    const fv=isNum&&v?Number(String(v).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):(v||'');
                                    return <td key={j} style={{padding:'4px 10px',borderBottom:'0.5px solid #f0f0f0',textAlign:isNum?'right':'left'}}>{fv}</td>;
                                  })}
                                  <td style={{padding:'4px 8px',textAlign:'center',borderBottom:'0.5px solid #f0f0f0',fontWeight:'500',color:fDup?(fDup.confidence>=90?'#791F1F':'#856404'):'#ccc'}}>{fDup?fDup.confidence+'%':'—'}</td>
                                  <td style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',color:fDup?'#555':'#ccc',whiteSpace:'nowrap'}}>{fDup?((fDup.status==='draft'?'Draft by ':'Created by ')+(fDup.uploadedBy||'—')):'—'}</td>
                                  <td style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',color:fDup?'#888':'#ccc',whiteSpace:'nowrap'}}>{fDup?fmtDateF(fDup.createdAt):'—'}</td>
                                </tr>
                                );
                              })}</tbody>
                            </table>
                          );
                        })()}
                      </div>
                    </>
                  );
                })()}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display:'none' }} onChange={e=>handleFiles(e.target.files)}/>
            </div>
              )}
            </div>
          )}
        </div>
        )}

        {tab !== 'pdf' && <div
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#f0f6ff';e.currentTarget.style.borderColor='#1a3a5c';}}
                  onDragLeave={e=>{e.currentTarget.style.background='#fafafa';e.currentTarget.style.borderColor='#d0d0d0';}}
                  onDrop={e=>{
                    e.preventDefault();
                    e.currentTarget.style.background='#fafafa';
                    e.currentTarget.style.borderColor='#d0d0d0';
                    const imgs = Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'));
                    if(attachments.length + imgs.length > 3){showAlert('แนบได้สูงสุด 3 รูปครับ','warning','แนบรูป');return;}
                    imgs.slice(0,3-attachments.length).forEach(file=>{
                      const reader=new FileReader();
                      reader.onload=ev=>setAttachments(prev=>[...prev,{name:file.name,data:ev.target.result,mime:file.type}]);
                      reader.readAsDataURL(file);
                    });
                  }}
                  onClick={()=>{if(attachments.length<3)document.getElementById('attachDropInput').click();}}
                  style={{ borderRadius:'6px',border:'1.5px dashed #d0d0d0',padding:'6px 14px',background:'#fafafa',display:'flex',alignItems:'center',gap:'10px',cursor:attachments.length<3?'pointer':'default',transition:'all .15s',marginTop:'8px' }}>
                  <input id="attachDropInput" type="file" accept="image/*" multiple style={{display:'none'}}
                    onChange={e=>{
                      const imgs=Array.from(e.target.files).filter(f=>f.type.startsWith('image/'));
                      if(attachments.length+imgs.length>3){showAlert('แนบได้สูงสุด 3 รูปครับ','warning','แนบรูป');return;}
                      imgs.slice(0,3-attachments.length).forEach(file=>{
                        const reader=new FileReader();
                        reader.onload=ev=>setAttachments(prev=>[...prev,{name:file.name,data:ev.target.result,mime:file.type}]);
                        reader.readAsDataURL(file);
                      });
                    }}/>
                  {attachments.length===0 ? (
                    <span style={{fontSize:'11px',color:'#aaa'}}>📎 ลากรูปหลักฐานมาวางที่นี่ หรือคลิกเพื่อเลือก (สูงสุด 3 รูป)</span>
                  ) : (
                    <>
                      {attachments.map((a,i)=>(
                      <div key={i} style={{position:'relative',flexShrink:0}}>
                          <img src={a.data} alt={a.name} style={{width:'40px',height:'40px',borderRadius:'6px',objectFit:'cover',border:'0.5px solid #ddd'}}/>
                          <button onClick={ev=>{ev.stopPropagation();setAttachments(prev=>prev.filter((_,j)=>j!==i));}}
                            style={{position:'absolute',top:'-5px',right:'-5px',width:'16px',height:'16px',borderRadius:'50%',border:'none',background:'#c0392b',color:'white',cursor:'pointer',fontSize:'10px',display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                      </div>
                      ))}
                      {attachments.length<3 && <span style={{fontSize:'11px',color:'#aaa'}}>+ เพิ่มรูป ({attachments.length}/3)</span>}
                    </>
                  )}
              </div>}

        {tab !== 'pdf' && <div style={{ padding:'10px 18px',borderTop:'0.5px solid #f0f0f0',background:'#f8f9fa',display:'flex',alignItems:'center',gap:'10px',flexShrink:0 }}>
          <label style={{ fontSize:'11px',color:'#888',whiteSpace:'nowrap',flexShrink:0 }}>Serial Code</label>
          <input style={{ ...S.inp,flex:1,fontFamily:'monospace',fontSize:'11px' }} value={serialCode} onChange={e=>setSerialCode(e.target.value)} placeholder="generate อัตโนมัติเมื่อ detect BU ได้"/>
          <div style={{ display:'flex',gap:'8px',alignItems:'center',flexShrink:0,marginLeft:'auto' }}>
            {saving&&saveProgress>0 && <span style={{ fontSize:'11px',color:'#1a3a5c',fontWeight:'500' }}>{saveProgress}%</span>}
            <button style={{ padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer',color:'#555' }} onClick={onClose}>ยกเลิก</button>
            {(()=>{
              const isDraftTab = pasteSubTab==='draft'; // ทั้ง Paste tab และ File tab ใช้ pasteSubTab ร่วมกัน
              const isNewTab = tab==='paste' && pasteSubTab==='new';
              const isFileTab = tab==='file';
              const readyFiles = fileQueue.filter(f=>f.status==='ready'&&!f.loading);
              const canSaveDraft = (isNewTab && parsedRows.length > 0) || (isFileTab && readyFiles.length > 0);
              const canSubmitDraft = isDraftTab && selectedDraftIds.length > 0;
              if (canSaveDraft) return (
                <>
                  <button style={{padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #b5d4f4',background:'#E6F1FB',fontSize:'12px',cursor:'pointer',color:'#0C447C',fontWeight:'500'}}
                    onClick={isFileTab ? handleSaveDraftFile : handleSaveDraft} disabled={saving}>
                    {saving?'กำลังบันทึก...':'📋 บันทึก Draft'}
                  </button>
                  <button style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:saving?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}
                    onClick={handleSave} disabled={saving}>
                    {saving?`กำลังบันทึก...${saveProgress>0?` ${saveProgress}%`:''}`:'💾 บันทึก'}
                  </button>
                </>
              );
              if (canSubmitDraft) {
                const me = userName || currentUser?.email || '';
                const canAct = isOwner || isAdmin || isEditor || drafts.filter(d=>selectedDraftIds.includes(d.id)).every(d=>d.uploaded_by===me);
                return (
                  <button style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:saving||!canAct?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:canAct?'pointer':'not-allowed',fontWeight:'500'}}
                    onClick={()=>canAct&&handleSubmitDraft(selectedDraftIds)} disabled={saving||!canAct}
                    title={!canAct?'เจ้าของ Draft เท่านั้น':''}>
                    {saving?'กำลังบันทึก...':`✅ ยืนยัน ${selectedDraftIds.length} Draft`}
                  </button>
                );
              }
              return (
                <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                  {selectedDraftIds.length > 0 && (
                    <button
                      style={{padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #f7c1c1',background:'#FCEBEB',color:'#791F1F',fontSize:'12px',cursor:'pointer'}}
                      onClick={async()=>{
                        setConfirmDraftDelete({ids:selectedDraftIds,serial:`${selectedDraftIds.length} Draft`,multi:true});
                        setSelectedDraft(null);
                        setSelectedDraftIds([]);
                        loadDrafts();
                      }}>
                      🗑 ลบที่เลือก ({selectedDraftIds.length})
                    </button>
                  )}
                  <button style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:saving?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}
                    onClick={handleSave} disabled={saving}>
                    {saving?`กำลังบันทึก...${saveProgress>0?` ${saveProgress}%`:'`'}`:'💾 บันทึก'}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>}
      </div>
    </div>
    </>
  );
}

function mapRowsForExcel(rawRows, docType) {
  const isAP09 = docType === 'AP09' || docType === 'AP07';
  return rawRows.map(r => {
    if (isAP09) {
      return {
        'Branch':           r['Branch'] || '',
        'Vendor Name':      r['Vendor Name'] || '',
        'Receive Date':     r['Receive Date'] || '',
        'GRT No.':          r['GRT No.'] || '',
        'Tax Invoice Date': r['Tax Invoice Date'] || '',
        'Tax Invoice No.':  r['Tax Invoice No.'] || '',
        'Description':      r['Description'] || r['Desctiption'] || '',
        'ยอดก่อนภาษี':     parseFloat(String(r['ยอดก่อนภาษี']||'0').replace(/,/g,''))||0,
        'ยอดภาษี':         parseFloat(String(r['ยอดภาษี']||'0').replace(/,/g,''))||0,
        'ยอดรวม':          parseFloat(String(r['ยอดรวม']||'0').replace(/,/g,''))||0,
      };
    }
    const isPasteFormat = '[ ]' in r || 'Supplier' in r || 'Invoice Num' in r;
    if (isPasteFormat) {
      const invAmt = parseFloat(String(r['Invoice Amount']||'0').replace(/,/g,''))||0;
      const _bRaw=String(r['[ ]']||'');const _bPH='\x00';const _bS=_bRaw.replace(/\\./g,_bPH);const bracketParts=_bS.split('.').map(p=>p.replace(new RegExp(_bPH,'g'),'.').trim()).filter(p=>p);
      const numParts = bracketParts.filter(p=>/^\d+$/.test(p));
      const _yesIdx = bracketParts.findIndex(p=>p.toLowerCase()==='yes');
      const _invNo = _yesIdx>=0 ? (bracketParts[_yesIdx+4]||'') : (r['Invoice Num']||'');
      const _grtNo = _yesIdx>=0 ? (bracketParts[_yesIdx+2]||'') : (numParts[0]||'');
      return {
        'Branch':             numParts[1] || '',
        'Vendor Name':        r['Supplier']||'',
        'GR Transaction No.': _grtNo,
        'Invoice Number':     _invNo,
        'Receive Date':       r['Invoice Date']||'',
        'รายการ':             r['Description']||'',
        'มูลค่าก่อนภาษี':   invAmt||'',
        'มูลค่าภาษี':        parseFloat(String(r['Tax Amount']||'0').replace(/,/g,''))||'',
        'มูลค่ารวม':         invAmt||'',
        'Batch Name':         r['Batch Name']||'',
      };
    }
    const gross = parseFloat(String(r['มูลค่าก่อนภาษี']||r['Gross Value']||r['Invoice Amount']||'0').replace(/,/g,''))||0;
    const vat   = parseFloat(String(r['มูลค่าภาษี']||r['Vat Value']||r['Tax Amount']||'0').replace(/,/g,''))||0;
    const total = parseFloat(String(r['มูลค่ารวม']||r['Total Value']||'0').replace(/,/g,''))||(gross+vat)||0;
    return {
      'Branch':             r['Branch']||'',
      'Vendor Name':        r['Vendor Name']||'',
      'GR Transaction No.': r['GR Transaction No.']||'',
      'Invoice Number':     r['Invoice Number']||r['Invoice Num']||'',
      'Receive Date':       r['Receive Date']||'',
      'รายการ':             r['รายการ']||r['Description']||'',
      'มูลค่าก่อนภาษี':   gross||'',
      'มูลค่าภาษี':        vat||'',
      'มูลค่ารวม':         total||'',
      'Batch Name':         r['Batch Name']||'',
    };
  });
}

function DocDetailModal({ file, onClose, searchQuery='' }) {
  const rawRows = Array.isArray(file.rows) ? file.rows : [];

  const fmtNum = (n) => {
    if (!n && n !== 0) return '-';
    const str = String(n).replace(/,/g, '');
    const v = parseFloat(str);
    if (isNaN(v) || v === 0) return '-';
    const decimals = (str.split('.')[1]||'').length;
    return v.toLocaleString('th-TH', {minimumFractionDigits: Math.min(decimals,2), maximumFractionDigits: Math.max(decimals,2)});
  };
  const fmtDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return String(d).split(' ')[0]||'-';
    return `${String(dt.getDate()).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]}-${String(dt.getFullYear()).slice(2)}`;
  };

  const isAP09 = file.doc_type === 'AP09';

  // Map raw rows ตาม doc_type
  const mappedRows = mapRowsForExcel(rawRows, file.doc_type);

  const API_BASE = 'http://10.101.87.126:4000/api';
  const [downloading, setDownloading] = useState(false);

  // MARKER_APMANUAL_VIEW_MODAL_UX_V1
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const handleDownloadExcel = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API_BASE}/excel/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ file, rows: mappedRows }),
      });
      if (!res.ok) throw new Error('Generate ไม่สำเร็จ');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${file.serial_code || 'Invoice_Register'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download ไม่สำเร็จ: ' + err.message);
    }
    setDownloading(false);
  };
  const COLS = isAP09
    ? ['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม']
    : ['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
  const NUM_COLS = isAP09 ? ['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'] : ['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
  // COL_W: fixed cols รวมกัน < 1200px เพื่อให้ รายการ/Description ได้พื้นที่เหลือโดยไม่มี scroll ข้าง
  // APN01 fixed: 80+150+120+140+100+110+100+110+150 = 1060 → รายการได้ ~180px
  // AP09  fixed: 80+150+100+110+110+130+110+100+110 = 1000 → Description ได้ ~240px
  const COL_W = {
    'Branch':             '80px',
    'Vendor Name':        '150px',
    'GR Transaction No.': '120px',
    'Invoice Number':     '140px',
    'Receive Date':       '100px',
    'GRT No.':            '110px',
    'Tax Invoice Date':   '110px',
    'Tax Invoice No.':    '130px',
    'Description':        'auto',
    'รายการ':             'auto',
    'มูลค่าก่อนภาษี':    '110px',
    'ยอดก่อนภาษี':       '110px',
    'มูลค่าภาษี':        '100px',
    'ยอดภาษี':           '100px',
    'มูลค่ารวม':         '110px',
    'ยอดรวม':            '110px',
    'Batch Name':         '150px',
  };

  const totalAmt = mappedRows.reduce((s,r)=>s+(parseFloat(r[NUM_COLS[0]])||0),0);
  const totalVat = mappedRows.reduce((s,r)=>s+(parseFloat(r[NUM_COLS[1]])||0),0);
  const totalAll = mappedRows.reduce((s,r)=>s+(parseFloat(r[NUM_COLS[2]])||0),0);
  const receiveDate = rawRows[0]?.['Invoice Date']||file.file_date||'';

  const S = {
    overlay:{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000},
    modal:{background:'white',borderRadius:'12px',width:'calc(100vw - 40px)',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden'},
    th:{padding:'7px 10px',fontSize:'11px',color:'rgba(255,255,255,0.9)',fontWeight:'500',background:'#1a3a5c',whiteSpace:'nowrap',borderRight:'0.5px solid rgba(255,255,255,0.1)',position:'sticky',top:0,zIndex:2},
    td:{padding:'7px 10px',fontSize:'11px',borderBottom:'0.5px solid #f0f0f0',verticalAlign:'middle'},
    hlabel:{fontSize:'11px',color:'#555',width:'130px',padding:'4px 0',flexShrink:0,fontWeight:'500'},
    hval:{fontSize:'11px',color:'#1a3a5c',padding:'4px 8px'},
  };

  return (
    <div style={S.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.modal}>
        <div style={{padding:'12px 20px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'10px',padding:'3px 10px',borderRadius:'20px',background:'#e8f0fb',color:'#1a3a5c',fontWeight:'500'}}>{file.doc_type}</span>
            <span style={{fontSize:'13px',fontWeight:'500',color:'#1a3a5c',maxWidth:'600px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.serial_code}</span>
          </div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button onClick={handleDownloadExcel} disabled={downloading} style={{padding:'5px 12px',fontSize:'11px',borderRadius:'6px',border:'0.5px solid #1a3a5c',background: downloading ? '#ccc' : '#1a3a5c',cursor: downloading ? 'default' : 'pointer',color:'white'}}>
              {downloading ? 'กำลัง Generate...' : '⬇ Download Excel'}
            </button>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'22px',color:'#aaa',lineHeight:1}}>×</button>
          </div>
        </div>

        <div style={{padding:'10px 20px',background:'#f8f9fa',borderBottom:'0.5px solid #e8e8e8',flexShrink:0,position:'sticky',top:0,zIndex:3}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 40px'}}>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>DOC TYPE</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.doc_type}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>BU CODE</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.bu_code_name||file.bu_code||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>ชื่อผู้ประกอบการ</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.bu_name||file.bu_code_name||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>Receive Date</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{fmtDate(receiveDate)}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>อัพโหลดโดย</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.uploaded_by||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>จำนวนรายการ</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{mappedRows.length} รายการ</span></div>
          </div>
        </div>

        <div style={{overflowX:'auto',overflowY:'auto',flex:1,padding:'0 20px',boxSizing:'border-box'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px',tableLayout:'auto'}}>
            <thead>
              <tr>
                {COLS.map((h,i)=>(
                  <th key={i} style={{...S.th,whiteSpace:'nowrap',textAlign:NUM_COLS.includes(h)?'right':'left'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappedRows.map((row,i)=>{
                const q = searchQuery.toLowerCase();
                const rowMatch = q && Object.values(row).some(v=>String(v||'').toLowerCase().includes(q));
                const rowStyle = rowMatch ? {background:'#FFFBF0',borderLeft:'3px solid #F59E0B'} : {background:i%2===0?'white':'#f8fbff'};
                const hlText = (val) => {
                  const s = String(val||'');
                  if (!q || !s.toLowerCase().includes(q)) return s;
                  const idx = s.toLowerCase().indexOf(q);
                  return <>{s.slice(0,idx)}<mark style={{background:'#FEF08A',padding:'0'}}>{s.slice(idx,idx+q.length)}</mark>{s.slice(idx+q.length)}</>;
                };
                return (
                  <tr key={i} style={rowStyle}
                    onMouseEnter={e=>e.currentTarget.style.background='#e8f0fe'}
                    onMouseLeave={e=>e.currentTarget.style.background=rowStyle.background}>
                    {COLS.map((h,j)=>(
                      <td key={j} style={{...S.td,textAlign:NUM_COLS.includes(h)?'right':'left',whiteSpace:'nowrap'}}>
                        {NUM_COLS.includes(h) ? fmtNum(row[h]) : (h==='Receive Date'||h==='Tax Invoice Date') ? fmtDate(row[h]) : hlText(row[h])}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* Total row — อยู่ใน table เพื่อให้ align column ตรง */}
              <tr style={{background:'#EAF3DE',borderTop:'2px solid #97C459'}}>
                {COLS.map((h,j)=>{
                  const isFirst = j === 0;
                  const isNum   = NUM_COLS.includes(h);
                  const fmt2    = (n) => Math.round(n * 100) / 100;
                  const totals  = [fmt2(totalAmt), fmt2(totalVat), fmt2(totalAll)];
                  const numIdx  = NUM_COLS.indexOf(h);
                  return (
                    <td key={j} style={{...S.td,fontWeight:'600',fontSize:'12px',color:'#27500A',
                      textAlign: isNum ? 'right' : isFirst ? 'left' : 'left',
                      whiteSpace:'nowrap', borderBottom:'none'}}>
                      {isFirst ? 'ยอดรวมทั้งหมด' : isNum ? fmtNum(totals[numIdx]) : ''}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── compress รูปก่อน save ให้เหลือ ≤ maxKB ──────────────────────────────────
function compressImage(dataUrl, maxKB = 200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // คำนวณขนาดใหม่ถ้ากว้าง/สูงเกิน 1600px
      const MAX_DIM = 1600;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      // ลด quality จนกว่าจะ ≤ maxKB
      let q = quality;
      let result = canvas.toDataURL('image/jpeg', q);
      while (result.length * 0.75 > maxKB * 1024 && q > 0.3) {
        q -= 0.08;
        result = canvas.toDataURL('image/jpeg', q);
      }
      resolve(result);
    };
    img.src = dataUrl;
  });
}

function AttachmentModal({ file, onClose, onSave, db, logActivity }) {
  const [attachments, setAttachments] = React.useState(Array.isArray(file.attachments) ? [...file.attachments] : []);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(null); // index ที่กำลัง preview
  const inputRef = React.useRef();

  const handleAddFiles = (e) => {
    const imgs = Array.from(e.target.files||[]).filter(f=>f.type.startsWith('image/'));
    if (attachments.length + imgs.length > 3) { alert('แนบได้สูงสุด 3 รูปครับ'); return; }
    imgs.slice(0, 3 - attachments.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = async ev => {
        const compressed = await compressImage(ev.target.result, 200);
        const kb = Math.round(compressed.length * 0.75 / 1024);
        setAttachments(prev => [...prev, { name: file.name, data: compressed, mime: 'image/jpeg', size_kb: kb }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleRemove = (i) => {
    setAttachments(prev => prev.filter((_,j)=>j!==i));
    if (preview === i) setPreview(null);
    else if (preview > i) setPreview(p => p - 1);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.from('doc_collection').update({ attachments }).eq('id', file.id);
      await logActivity('update_attachment', file.serial_code, { count: attachments.length });
      onSave();
    } catch(e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()}
      style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1500}}>
      <div style={{background:'white',borderRadius:'12px',width:'520px',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}>
        {/* Header */}
        <div style={{padding:'12px 18px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <div>
            <div style={{fontSize:'13px',fontWeight:'600',color:'#1a3a5c'}}>📎 จัดการรูปแนบ</div>
            <div style={{fontSize:'10px',color:'#888',marginTop:'2px'}}>{file.serial_code}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'#aaa',lineHeight:1}}>×</button>
        </div>

        {/* Content */}
        <div style={{padding:'16px 18px',flex:1,overflowY:'auto'}}>
          {/* Preview ใหญ่ */}
          <div style={{width:'100%',height:'220px',borderRadius:'8px',background:'#f4f6f9',border:'0.5px solid #e0e0e0',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'12px',overflow:'hidden',cursor:preview!=null?'zoom-in':'default'}}
            onClick={()=>preview!=null&&window.open(attachments[preview].data,'_blank')}>
            {preview != null
              ? <img src={attachments[preview].data} alt={attachments[preview].name} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>
              : <div style={{textAlign:'center',color:'#bbb'}}>
                  <div style={{fontSize:'32px',marginBottom:'6px'}}>🖼</div>
                  <div style={{fontSize:'11px'}}>คลิกรูปด้านล่างเพื่อดู Preview</div>
                </div>
            }
          </div>

          {/* Thumbnail list */}
          <div style={{display:'flex',gap:'8px',marginBottom:'14px',flexWrap:'wrap'}}>
            {attachments.map((a,i)=>(
              <div key={i} style={{position:'relative',width:'80px',height:'80px'}}>
                <img src={a.data} alt={a.name} onClick={()=>setPreview(i)}
                  style={{width:'80px',height:'80px',borderRadius:'6px',objectFit:'cover',cursor:'pointer',border:preview===i?'2px solid #1a3a5c':'1.5px solid #ddd',transition:'border .15s'}}/>
                <button onClick={()=>handleRemove(i)}
                  style={{position:'absolute',top:'-6px',right:'-6px',width:'18px',height:'18px',borderRadius:'50%',background:'#c0392b',border:'none',color:'white',cursor:'pointer',fontSize:'10px',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>✕</button>
                <div style={{fontSize:'9px',color:'#888',textAlign:'center',marginTop:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'80px'}}>{a.name}</div>
                {a.size_kb && <div style={{fontSize:'9px',color:'#aaa',textAlign:'center'}}>{a.size_kb} KB</div>}
              </div>
            ))}
            {attachments.length < 3 && (
              <div onClick={()=>inputRef.current?.click()}
                style={{width:'80px',height:'80px',borderRadius:'6px',border:'1.5px dashed #ccc',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:'4px',color:'#bbb',background:'#fafafa',transition:'all .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='#1a3a5c';e.currentTarget.style.color='#1a3a5c';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='#ccc';e.currentTarget.style.color='#bbb';}}>
                <span style={{fontSize:'22px'}}>+</span>
                <span style={{fontSize:'9px'}}>เพิ่มรูป</span>
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleAddFiles}/>

          <div style={{fontSize:'10px',color:'#aaa'}}>แนบได้สูงสุด 3 รูป · คลิก ✕ เพื่อลบรูป · {attachments.length}/3</div>
        </div>

        {/* Footer */}
        <div style={{padding:'10px 18px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'flex-end',gap:'8px',flexShrink:0}}>
          <button onClick={onClose} style={{padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer',color:'#555'}}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:saving?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:saving?'default':'pointer',fontWeight:'500'}}>
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
      {/* alertModal: AddFileModal only */}
    </div>
  );
}

// MARKER_DRAFT_PANEL_STANDALONE_V1
// ── DraftPanel: แยก "Report / Draft" ออกมาเป็น Popup อิสระ (เดิมฝังอยู่ใน AddFileModal) ──
// ── Search แทนที่ "ดูของ" — ว่าง = ไล่ระดับ DocType→BU ปกติ, มีค่า = โชว์ผลลัพธ์แบบแบนทันที ──
function DraftPanel({ userName, currentUser, isOwner, isAdmin, isEditor, onClose, onSubmitted }) {
  const [drafts, setDrafts]                 = React.useState([]);
  const [draftsLoading, setDraftsLoading]    = React.useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = React.useState([]);
  const [selectedDraft, setSelectedDraft]    = React.useState(null);
  const [confirmDraftDelete, setConfirmDraftDelete] = React.useState(null);
  const [draftLevel, setDraftLevel]          = React.useState(1);
  const [draftDocType, setDraftDocType]      = React.useState(null);
  const [draftBU, setDraftBU]                = React.useState(null);
  const [search, setSearch]                  = React.useState('');
  const [saving, setSaving]                  = React.useState(false);
  const [error, setError]                    = React.useState('');
  const [toast, setToast]                    = React.useState(null);
  const showToast = React.useCallback((msg, type='success')=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); }, []);

  const DOC_TYPE_MAP = { APN01:'Invoice Register', AP07:'Input Tax Invoice', AP09:'Input Tax Invoice', TRANS:'Transaction AP' };
  const _genSerialCounter = React.useRef(0);
  const genSerial = (bu, type) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2,'0');
    const yy=String(now.getFullYear()).slice(2),mm=p(now.getMonth()+1),dd=p(now.getDate()),hh=p(now.getHours()),mi=p(now.getMinutes());
    _genSerialCounter.current = (_genSerialCounter.current + 1) % 100;
    return `${bu||'XX'}_${DOC_TYPE_MAP[type]||type}_${type}-${yy}${mm}${dd}.${hh}${mi}`;
  };

  const loadDrafts = React.useCallback(async () => {
    setDraftsLoading(true);
    try {
      const me = userName || currentUser?.email || '';
      let q = db.from('doc_collection').select('*').eq('status', 'draft');
      const canViewAll = isOwner || isAdmin || isEditor;
      if (!canViewAll) q = q.eq('uploaded_by', me);
      const { data } = await q;
      setDrafts(data || []);
    } catch(_) {}
    setDraftsLoading(false);
  }, [isOwner, isAdmin, isEditor, userName, currentUser]);

  React.useEffect(() => { loadDrafts(); }, [loadDrafts]);

  // Esc: ปิด confirmDraftDelete ก่อนถ้ามีอยู่ ไม่งั้นค่อยปิด Panel ทั้งหมด
  React.useEffect(() => {
    const fn = e => {
      if (e.key !== 'Escape') return;
      if (confirmDraftDelete) { setConfirmDraftDelete(null); return; }
      onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [confirmDraftDelete, onClose]);

  const handleSubmitDraft = async (draftIds) => {
    if (!draftIds || draftIds.length === 0) return;
    setSaving(true);
    try {
      const selectedDrafts = drafts.filter(d => draftIds.includes(d.id));
      if (selectedDrafts.length === 0) throw new Error('ไม่พบ Draft');

      const mergedRows = selectedDrafts.flatMap(d => d.rows || []);
      const firstDraft = selectedDrafts[0];
      const bu = firstDraft.bu_code || (firstDraft.serial_code||'').split('_')[0] || 'XX';
      const docType = firstDraft.doc_type || 'APN01';
      const newSerial = genSerial(bu, docType);

      let buCodeName = null, buNameThai = null;
      const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', bu).maybeSingle();
      buCodeName = buData?.bu_code_name || null;
      buNameThai = buData?.['THAI COMPANY NAME'] || null;

      const _submitNow = new Date().toISOString();
      const _fileDate = mergedRows[0]?.['Receive Date'] || mergedRows[0]?.['Invoice Date'] || _submitNow.split('T')[0];
      const { error: insErr } = await db.from('doc_collection').insert([{
        serial_code:   newSerial,
        bu_code:       bu,
        bu_code_name:  buCodeName,
        bu_name:       buNameThai,
        doc_type:      docType,
        rows:          mergedRows,
        attachments:   [],
        source:        'upload',
        doc_name:      ({APN01:'Invoice Register',AP07:'Input Tax Invoice',AP09:'Input Tax Invoice',TRANS:'Transaction AP'}[docType])||'Invoice Register',
        status:        'active',
        file_date:     _fileDate,
        uploaded_by:   userName || currentUser?.email || '',
        created_at:    _submitNow,
        updated_at:    _submitNow,
      }]);
      if (insErr) throw insErr;

      for (const id of draftIds) {
        await db.from('doc_collection').delete().eq('id', id);
      }

      showToast(`ยืนยันสำเร็จ — ${mergedRows.length} แถว → ${newSerial}`);
      setSelectedDraftIds([]);
      setSelectedDraft(null);
      onSubmitted && onSubmitted();
      setTimeout(() => onClose(), 600); // ให้เห็น toast แป๊บนึงก่อนปิด
    } catch(e) { setError('ยืนยัน Draft ไม่สำเร็จ: ' + e.message); }
    setSaving(false);
  };

  const previewTable = (previewDrafts) => {
    if (previewDrafts.length===0) return (
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'8px',color:'#aaa'}}>
        <span style={{fontSize:'28px'}}>&#128196;</span>
        <span style={{fontSize:'12px'}}>เลือก Draft ทางซ้ายเพื่อดู Preview</span>
      </div>
    );
    const firstDraft = selectedDraft || previewDrafts[0];
    const isAP09d = firstDraft.doc_type==='AP09';
    const APN01_COLS=['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
    const AP09_COLS=['Branch','Vendor Name','Receive Date','GRT No.','Tax Invoice Date','Tax Invoice No.','Description','ยอดก่อนภาษี','ยอดภาษี','ยอดรวม'];
    const COLS = isAP09d ? AP09_COLS : APN01_COLS;
    const NUM_COLS = isAP09d?['ยอดก่อนภาษี','ยอดภาษี','ยอดรวม']:['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];
    const thBg = isAP09d?'#0F6E56':'#1a3a5c';
    const allRows = previewDrafts.flatMap(d=>(d.rows||[]).map(r=>mapRowsForExcel([r],isAP09d?'AP09':'APN01')[0]||r));
    const totalRows = previewDrafts.reduce((s,d)=>s+(d.rows?.length||0),0);
    return (
      <>
        <div style={{padding:'8px 14px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <div style={{minWidth:0,flex:1}}>
            {previewDrafts.length===1
              ?<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{firstDraft.serial_code}</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถว · {firstDraft.doc_type}</span></>
              :<><span style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{previewDrafts.length} Draft</span><span style={{fontSize:'10px',color:'#888',marginLeft:'8px'}}>{totalRows} แถวรวม · {firstDraft.doc_type}</span></>
            }
          </div>
          {previewDrafts.length===1&&(()=>{
            const me = userName || currentUser?.email || '';
            const canDel = isOwner || isAdmin || isEditor || firstDraft.uploaded_by===me;
            return (
              <button onClick={()=>{ if(!canDel) return; setConfirmDraftDelete({id:firstDraft.id,serial:firstDraft.serial_code,multi:false}); }}
                disabled={!canDel}
                title={!canDel?'เจ้าของ Draft เท่านั้น':''}
                style={{fontSize:'11px',padding:'4px 10px',borderRadius:'6px',border:'0.5px solid #f7c1c1',background:canDel?'#FCEBEB':'#f5f5f5',color:canDel?'#791F1F':'#bbb',cursor:canDel?'pointer':'not-allowed',flexShrink:0}}>
                🗑 ลบ draft
              </button>
            );
          })()}
        </div>
        <div style={{flex:1,overflowX:'auto',overflowY:'auto'}}>
          <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
            <thead><tr>
              <th style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',position:'sticky',top:0,zIndex:1,textAlign:'center',width:'32px'}}>#</th>
              {COLS.map((h,i)=>(<th key={i} style={{padding:'5px 8px',background:thBg,color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:NUM_COLS.includes(h)?'right':'left',position:'sticky',top:0,zIndex:1,borderRight:'0.5px solid rgba(255,255,255,0.1)'}}>{h}</th>))}
            </tr></thead>
            <tbody>{allRows.map((row,i)=>(
              <tr key={i} style={{background:i%2===0?'white':'#f8f9fa'}}>
                <td style={{padding:'4px 8px',textAlign:'center',color:'#aaa',fontSize:'10px'}}>{i+1}</td>
                {COLS.map((h,j)=>{
                  const isNum=NUM_COLS.includes(h); const v=row[h];
                  const isDesc=h==='Description'||h==='รายการ';
                  const fv=isNum&&v?Number(String(v).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):(v||'');
                  return <td key={j} title={isDesc?String(fv):undefined} style={{padding:'4px 8px',borderBottom:'0.5px solid #f0f0f0',borderRight:'0.5px solid #f5f5f5',textAlign:isNum?'right':'left',maxWidth:isDesc?'160px':'none',overflow:isDesc?'hidden':'visible',textOverflow:isDesc?'ellipsis':'clip',whiteSpace:'nowrap'}}>{fv}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>
    );
  };

  const toggleSelect = (d) => {
    setSelectedDraft(d);
    const newIds = selectedDraftIds.includes(d.id) ? selectedDraftIds.filter(x=>x!==d.id) : [...selectedDraftIds, d.id];
    setSelectedDraftIds(newIds);
  };

  const q = search.trim().toLowerCase();
  const searchResults = q ? drafts.filter(d =>
    (d.serial_code||'').toLowerCase().includes(q) ||
    (d.bu_code||'').toLowerCase().includes(q) ||
    (d.bu_code_name||'').toLowerCase().includes(q) ||
    (d.bu_name||'').toLowerCase().includes(q) ||
    (d.doc_type||'').toLowerCase().includes(q) ||
    (d.uploaded_by||'').toLowerCase().includes(q) ||
    (d.file_date||'').toLowerCase().includes(q) ||
    (Array.isArray(d.rows) && d.rows.some(row =>
      Object.values(row).some(v => String(v||'').toLowerCase().includes(q))
    ))
  ) : [];

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:100000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      {toast && (
        <div style={{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',zIndex:200000,background:toast.type==='warning'?'#856404':toast.type==='error'?'#791F1F':'#1a3a5c',color:'white',padding:'10px 20px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',boxShadow:'0 4px 12px rgba(0,0,0,0.2)',whiteSpace:'nowrap'}}>
          {toast.type==='warning'?'⚠️':toast.type==='error'?'❌':'✅'} {toast.msg}
        </div>
      )}
      {confirmDraftDelete && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:100101,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #e0e0e0',width:'360px',boxShadow:'0 8px 32px rgba(0,0,0,0.18)',overflow:'hidden'}}>
            <div style={{padding:'16px 20px',borderBottom:'0.5px solid #f0f0f0',display:'flex',alignItems:'center',gap:'10px'}}>
              <span style={{fontSize:'20px'}}>&#128465;</span>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#1a3a5c'}}>ยืนยันการลบ</div>
            </div>
            <div style={{padding:'16px 20px'}}>
              <div style={{fontSize:'12px',color:'#555',lineHeight:1.7}}>
                {confirmDraftDelete.multi
                  ? <>ลบ <strong>{confirmDraftDelete.serial}</strong> ออกจากระบบ? </>
                  : <>ลบ <strong style={{color:'#c0392b'}}>{confirmDraftDelete.serial}</strong><br/>ออกจากระบบ? </>
                }
              </div>
            </div>
            <div style={{padding:'12px 20px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
              <button onClick={()=>setConfirmDraftDelete(null)} style={{padding:'6px 16px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer'}}>ยกเลิก</button>
              <button onClick={async()=>{
                if(confirmDraftDelete.multi){
                  for(const id of confirmDraftDelete.ids){ await db.from('doc_collection').delete().eq('id',id); }
                  setSelectedDraftIds([]); setSelectedDraft(null);
                } else {
                  await db.from('doc_collection').delete().eq('id',confirmDraftDelete.id);
                  setSelectedDraft(null); setSelectedDraftIds([]);
                }
                setConfirmDraftDelete(null); loadDrafts();
              }} style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:'#c0392b',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}>ลบ</button>
            </div>
          </div>
        </div>
      )}
      <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #e0e0e0',width:'calc(100vw - 20px)',maxWidth:'1800px',height:'92vh',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}}>
        <div style={{padding:'14px 18px',borderBottom:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหา Serial code, BU, Invoice No., Vendor..."
            style={{fontSize:'11px',padding:'5px 10px',borderRadius:'6px',border:'0.5px solid #ddd',background:'#f7f8fa',outline:'none',width:'200px'}}/>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <span style={{fontSize:'16px'}}>📋</span>
              <span style={{fontSize:'13px',fontWeight:'500',color:'#1a3a5c'}}>Draft Management</span>
            </span>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#888'}}>×</button>
          </div>
        </div>
        {error && <div style={{margin:'10px 18px 0',background:'#FCEBEB',color:'#791F1F',padding:'7px 12px',borderRadius:'6px',fontSize:'12px'}}>{error}</div>}
        <div style={{display:'flex',flex:1,minHeight:0,margin:'10px 18px',border:'0.5px solid #e0e0e0',borderRadius:'8px',overflow:'hidden'}}>
          {/* Left: list */}
          <div style={{width:'230px',flexShrink:0,borderRight:'0.5px solid #e0e0e0',overflowY:'auto',background:'#f8f9fa',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'5px 10px',borderBottom:'0.5px solid #e0e0e0',display:'flex',alignItems:'center',gap:'6px',background:'#f0f2f5',flexShrink:0,minHeight:'27px'}}>
              {(()=>{
                const scopedDrafts = q ? searchResults : (draftLevel===2 && draftDocType && draftBU ? drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU) : null);
                if (!scopedDrafts) return <span style={{fontSize:'10px',color:'#bbb'}}>เลือก BU ก่อนจึงจะเลือกหลายรายการได้</span>;
                const scopedIds = scopedDrafts.map(d=>d.id);
                const selInScope = selectedDraftIds.filter(id=>scopedIds.includes(id));
                const allChk = scopedDrafts.length>0 && selInScope.length===scopedDrafts.length;
                return (<>
                  <input type='checkbox' checked={allChk}
                    onChange={e=>setSelectedDraftIds(p=>e.target.checked?[...new Set([...p,...scopedIds])]:p.filter(x=>!scopedIds.includes(x)))}
                    style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                  <span style={{fontSize:'10px',color:'#555',fontWeight:'500'}}>เลือกทั้งหมด</span>
                  {selInScope.length>0&&<span style={{marginLeft:'auto',fontSize:'10px',color:'#0C447C',fontWeight:'500'}}>เลือก {selInScope.length}/{scopedDrafts.length}</span>}
                </>);
              })()}
            </div>

            {q ? (
              <div style={{flex:1,overflowY:'auto'}}>
                {searchResults.length===0&&<div style={{fontSize:'12px',color:'#aaa',padding:'40px 10px',textAlign:'center'}}>ไม่พบผลลัพธ์</div>}
                {searchResults.map(d=>{
                  const isChk=selectedDraftIds.includes(d.id);
                  const isSel=selectedDraft?.id===d.id;
                  return <div key={d.id} onClick={()=>toggleSelect(d)}
                    style={{padding:'8px 10px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',gap:'7px',background:isSel?'#e8f0fb':'white',borderLeft:isSel?'2.5px solid #1a3a5c':'2.5px solid transparent'}}>
                    <input type='checkbox' checked={isChk} onChange={e=>{e.stopPropagation();toggleSelect(d);}} onClick={e=>e.stopPropagation()} style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:'11px',fontWeight:'500',color:d.doc_type==='AP09'?'#0F6E56':'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.serial_code||d.doc_name||'-'}</div>
                      <div style={{fontSize:'10px',color:'#888',marginTop:'1px'}}>{d.doc_type} · {d.rows?.length||0} แถว · {(d.created_at||'').slice(0,10)}</div>
                    </div>
                  </div>;
                })}
              </div>
            ) : (
            <>
            {draftLevel===1&&(
              <div style={{flex:1,overflowY:'auto'}}>
                {draftsLoading&&<div style={{fontSize:'12px',color:'#888',padding:'20px',textAlign:'center'}}>กำลังโหลด...</div>}
                {!draftsLoading&&drafts.length===0&&<div style={{fontSize:'12px',color:'#aaa',padding:'40px 10px',textAlign:'center'}}>No Draft</div>}
                {['APN01','AP09','AP07'].filter(t=>drafts.some(d=>d.doc_type===t)).map(t=>{
                  const cnt=drafts.filter(d=>d.doc_type===t).length;
                  const label=t==='AP09'?'AP09 - Tax Invoice':t==='AP07'?'AP07':t+' - Invoice Register';
                  return <div key={t} onClick={()=>{ setDraftDocType(t); setDraftLevel(2); setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }}
                    style={{padding:'12px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                    <div>
                      <div style={{fontSize:'12px',fontWeight:'500',color:t==='AP09'?'#0F6E56':'#1a3a5c'}}>{label}</div>
                      <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{cnt} draft</div>
                    </div>
                    <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                  </div>;
                })}
              </div>
            )}
            {draftLevel===2&&draftDocType&&!draftBU&&(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                  <button onClick={()=>{ setDraftLevel(1); setDraftDocType(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                  <span style={{fontSize:'11px',fontWeight:'600',color:draftDocType==='AP09'?'#0F6E56':'#1a3a5c',marginLeft:'4px'}}>{draftDocType}</span>
                </div>
                <div style={{flex:1,overflowY:'auto'}}>
                  {[...new Set(drafts.filter(d=>d.doc_type===draftDocType).map(d=>d.bu_code||(d.serial_code||'').split('_')[0]||'?'))].map(bu=>{
                    const buDrafts=drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===bu);
                    return <div key={bu} onClick={()=>{ setDraftBU(bu); setSelectedDraftIds([]); setSelectedDraft(null); }}
                      style={{padding:'10px 14px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:'white'}}>
                      <div>
                        <div style={{fontSize:'12px',fontWeight:'500',color:'#1a3a5c'}}>{bu}</div>
                        <div style={{fontSize:'10px',color:'#aaa',marginTop:'2px'}}>{buDrafts.length} draft</div>
                      </div>
                      <span style={{fontSize:'16px',color:'#ccc'}}>›</span>
                    </div>;
                  })}
                </div>
              </div>
            )}
            {draftLevel===2&&draftDocType&&draftBU&&(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'6px 10px',borderBottom:'0.5px solid #e0e0e0',background:'#f0f2f5',display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                  <button onClick={()=>{ setDraftBU(null); setSelectedDraftIds([]); setSelectedDraft(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:'13px',color:'#1a3a5c',padding:'0',display:'flex',alignItems:'center',gap:'4px'}}>← กลับ</button>
                  <span style={{fontSize:'11px',color:'#888',marginLeft:'2px'}}>{draftDocType}</span>
                  <span style={{fontSize:'11px',color:'#ccc'}}>/</span>
                  <span style={{fontSize:'11px',fontWeight:'600',color:'#1a3a5c'}}>{draftBU}</span>
                </div>
                <div style={{flex:1,overflowY:'auto'}}>
                  {drafts.filter(d=>d.doc_type===draftDocType&&(d.bu_code||(d.serial_code||'').split('_')[0]||'?')===draftBU).map(d=>{
                    const isChk=selectedDraftIds.includes(d.id);
                    const isSel=selectedDraft?.id===d.id;
                    return <div key={d.id} onClick={()=>toggleSelect(d)}
                      style={{padding:'8px 10px',borderBottom:'0.5px solid #e8e8e8',cursor:'pointer',display:'flex',alignItems:'center',gap:'7px',background:isSel?'#e8f0fb':'white',borderLeft:isSel?'2.5px solid #1a3a5c':'2.5px solid transparent'}}>
                      <input type='checkbox' checked={isChk} onChange={e=>{e.stopPropagation();toggleSelect(d);}} onClick={e=>e.stopPropagation()} style={{cursor:'pointer',width:'13px',height:'13px',flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.serial_code||d.doc_name||'-'}</div>
                        <div style={{fontSize:'10px',color:'#888',marginTop:'1px'}}>{d.rows?.length||0} แถว · {(d.created_at||'').slice(0,10)}</div>
                      </div>
                    </div>;
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            {previewTable(drafts.filter(d=>selectedDraftIds.includes(d.id)))}
          </div>
        </div>
        <div style={{padding:'10px 18px',borderTop:'0.5px solid #f0f0f0',background:'#f8f9fa',display:'flex',justifyContent:'flex-end',gap:'8px',flexShrink:0}}>
          <button onClick={onClose} style={{padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer',color:'#555'}}>ปิด</button>
          {selectedDraftIds.length > 0 && (
            <button
              style={{padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #f7c1c1',background:'#FCEBEB',color:'#791F1F',fontSize:'12px',cursor:'pointer'}}
              onClick={()=>{ setConfirmDraftDelete({ids:selectedDraftIds,serial:`${selectedDraftIds.length} Draft`,multi:true}); }}>
              🗑 ลบที่เลือก ({selectedDraftIds.length})
            </button>
          )}
          {selectedDraftIds.length > 0 && (()=>{
            const me = userName || currentUser?.email || '';
            const canAct = isOwner || isAdmin || isEditor || drafts.filter(d=>selectedDraftIds.includes(d.id)).every(d=>d.uploaded_by===me);
            return (
              <button style={{padding:'6px 16px',borderRadius:'6px',border:'none',background:saving||!canAct?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:canAct?'pointer':'not-allowed',fontWeight:'500'}}
                onClick={()=>canAct&&handleSubmitDraft(selectedDraftIds)} disabled={saving||!canAct}
                title={!canAct?'เจ้าของ Draft เท่านั้น':''}>
                {saving?'กำลังบันทึก...':`✅ ยืนยัน ${selectedDraftIds.length} Draft`}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function FolderDetail({ folder, onBack, userName, currentUser, canDelete, isOwner, isAdmin, isEditor }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('APN01');
  const [buFilter, setBuFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('updated_desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [showAdd, setShowAdd] = useState(false);
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [draftBadge, setDraftBadge] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewFile, setViewFile] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { attachments:[], index:0 }
  const [attachModal, setAttachModal] = useState(null); // file object ที่กำลังแก้ไข attachment
  const [showQueue, setShowQueue] = useState(false);
  const [qSideTab, setQSideTab]   = useState('dashboard');
  const [qStatus,  setQStatus]    = useState('active');
  const [queueItems, setQueueItems] = useState([]);
  const [queueBadge, setQueueBadge] = useState(0);

  // MARKER_FOLDERDETAIL_ESC_BACK_V1
  // Esc = Back ไป Document Center — ใช้ร่วมกันทุกเมนู (AP/VAT/IE/GL/I-Pro เป็น Component เดียวกัน)
  // กันชนกับ Esc ของ Popup อื่น: ถ้ามี Popup ใดๆ เปิดอยู่ ให้ Popup นั้นจัดการ Esc ของตัวเองก่อน ไม่ Back ทับ
  React.useEffect(() => {
    const fn = e => {
      if (e.key !== 'Escape') return;
      if (showAdd || showDraftPanel || confirmDelete || viewFile || lightbox || attachModal || showQueue) return;
      onBack();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [showAdd, showDraftPanel, confirmDelete, viewFile, lightbox, attachModal, showQueue, onBack]);
  const [queueTab, setQueueTab] = useState('my'); // 'my' | 'all'
  const API_Q = 'http://10.101.87.126:4000/api/docenter';

  const TABS = [
    { key:'APN01', label:'APN01' },
    { key:'AP07',  label:'AP07'  },
    { key:'AP09',  label:'AP09'  },
    { key:'TRANS', label:'IMP / Trans' },
  ];

  const logActivity = async (action, target, detail={}) => {
    try { await db.from('activity_log').insert([{ user_email:currentUser?.email||'', username:userName||currentUser?.email||'', action, target, detail, created_at:new Date().toISOString() }]); } catch(e){}
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await db.from('doc_collection').select('*').neq('status','draft').order('created_at',{ ascending:false });
      setFiles(data||[]);
    } catch(e){ console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => {
    const unsub = subscribeWs(['doc_collection_updated'], () => fetchFiles());
    return unsub;
  }, [fetchFiles]);

  // ── Queue: ดึงรายการและนับ pending/ocring ────────────────────────────────
  const fetchQueue = React.useCallback(async () => {
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const r = await fetch(`${API_Q}/queue`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setQueueItems(Array.isArray(data) ? data : []);
      setQueueBadge((Array.isArray(data) ? data : []).filter(q => ['pending','ocring','waiting_ap'].includes(q.status)).length);
    } catch(_) {}
  }, []);

  // SSE: รับ push จาก backend เมื่อ queue status เปลี่ยน (แทน polling)
  useEffect(() => {
    fetchQueue(); // โหลดครั้งแรก
    const token = sessionStorage.getItem('fastapn_token');
    const es = new EventSource(`${API_Q}/queue/stream?token=${encodeURIComponent(token || "")}`);
    es.addEventListener('queue_update', (e) => {
      try {
        const { snapshot } = JSON.parse(e.data);
        if (Array.isArray(snapshot) && snapshot.length >= 0) {
          // merge snapshot (active) กับ done items ที่มีอยู่แล้ว
          setQueueItems(prev => {
            const doneItems = prev.filter(q => q.status === 'done');
            const merged = [...snapshot, ...doneItems.filter(d => !snapshot.find(s => s.id === d.id))];
            return merged;
          });
          setQueueBadge(snapshot.filter(q => ['pending','ocring','waiting_ap'].includes(q.status)).length);
        }
      } catch(_) {}
    });
    es.addEventListener('queue_done', () => { fetchQueue(); }); // reload เมื่อ done
    es.onerror = () => { es.close(); }; // close on error — จะ reconnect เอง
    return () => { es.close(); };
  }, [fetchQueue]);

  // ── Draft: นับจำนวน Draft ทั้งหมดที่ผู้ใช้คนนี้มีสิทธิ์เห็น (สำหรับ Badge) ──
  const fetchDraftBadge = React.useCallback(async () => {
    try {
      const me = userName || currentUser?.email || '';
      let q = db.from('doc_collection').select('*').eq('status', 'draft');
      if (!(isOwner || isAdmin || isEditor)) q = q.eq('uploaded_by', me);
      const { data } = await q;
      setDraftBadge((data || []).length);
    } catch(_) {}
  }, [userName, currentUser, isOwner, isAdmin, isEditor]);
  useEffect(() => { fetchDraftBadge(); }, [fetchDraftBadge]);

  const handleDelete = async (file) => {
    try {
      await db.from('doc_collection').delete().eq('id', file.id);
      await logActivity('delete_file', file.serial_code, { folder:folder.key });
      broadcastWs('doc_collection_updated', { action:'delete', serial:file.serial_code });
      setConfirmDelete(null); fetchFiles();
    } catch(e){ alert('ลบไม่สำเร็จ: '+e.message); }
  };

  const API_BASE_ROW = 'http://10.101.87.126:4000/api';
  const [downloadingRow, setDownloadingRow] = useState(null);

  // ── Parse [ ] field → AP09 rows ─────────────────────────────────────────
  const parseAP09Rows = (rawRows) => {
    return rawRows
      .filter(r => {
        const parts = String(r['[ ]'] || '').split('.').map(p => p.trim());
        return parts.some(p => p.toLowerCase() === 'yes');
      })
      .map(r => {
        const parts = String(r['[ ]'] || '').split('.').map(p => p.trim()).filter(p => p);
        const yesIdx = parts.findIndex(p => p.toLowerCase() === 'yes');
        const branch = parts[2] || '';
        const taxInvDate = yesIdx >= 0 ? parts[yesIdx + 1] || '' : '';
        const grtNo      = yesIdx >= 0 ? parts[yesIdx + 2] || '' : '';
        // Vendor Name จาก Supplier ปกติ (Real Vendor อยู่ใน bracket segment ก่อน Yes)
        const vendorName = r['Supplier'] || r['Vendor Name'] || '';
        const invAmt = parseFloat(String(r['Invoice Amount'] || r['มูลค่ารวม'] || '0').replace(/,/g,'')) || 0;
        const gross  = Math.round(invAmt * 100 / 107 * 100) / 100;
        const vat    = Math.round(invAmt * 7   / 107 * 100) / 100;
        return {
          'Branch':           branch,
          'Vendor Name':      vendorName,
          'Receive Date':     r['Invoice Date'] || r['Receive Date'] || '',
          'GRT No.':          grtNo,
          'Tax Invoice Date': taxInvDate,
          'Tax Invoice No.':  r['Invoice Num'] || r['Invoice Number'] || '',
          'Description':      r['Description'] || r['Desctiption'] || r['รายการ'] || '',
          'ยอดก่อนภาษี':     gross,
          'ยอดภาษี':         vat,
          'ยอดรวม':          invAmt,
        };
      });
  };

  const handleRowDownload = async (file) => {
    if (downloadingRow === file.id) return;
    setDownloadingRow(file.id);
    try {
      // ocr_pdf → download PDF image แทน Excel
      if (file.source === 'ocr_pdf' && Array.isArray(file.attachments) && file.attachments.length > 0) {
        const att = file.attachments[0];
        const a = document.createElement('a');
        a.href = att.data.startsWith('data:') ? att.data : `data:${att.mime||'image/jpeg'};base64,${att.data}`;
        a.download = `${file.serial_code || 'ocr_preview'}.jpg`;
        a.click();
        setDownloadingRow(null);
        return;
      }
      const token = sessionStorage.getItem('fastapn_token');
      const rawRows = Array.isArray(file.rows) ? file.rows : [];
      const mappedRows = mapRowsForExcel(rawRows, file.doc_type);
      const res = await fetch(`${API_BASE_ROW}/excel/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ file, rows: mappedRows, ap09Rows: file.doc_type === 'APN01' ? (() => {
          try { return parseAP09RowsFromRaw(rawRows); } catch(_) { return []; }
        })() : [] }),
      });
      if (!res.ok) throw new Error('Generate ไม่สำเร็จ');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${file.serial_code || 'Invoice_Register'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Download ไม่สำเร็จ: ' + err.message); }
    setDownloadingRow(null);
  };

  const filteredAll = React.useMemo(() => {
    const base = files.filter(f => {
      const matchTab = (() => {
        if (activeTab === 'TRANS') return ['TRANS','STORE'].includes(f.doc_type);
        if (activeTab === 'AP09')  return f.doc_type === 'AP09';
        return f.doc_type === activeTab;
      })();
      const matchBu = buFilter === 'ALL' || f.bu_code === buFilter;
      const matchSearch = !search || (() => {
        const q = search.toLowerCase();
        return f.serial_code?.toLowerCase().includes(q) ||
          f.bu_code?.toLowerCase().includes(q) ||
          f.bu_code_name?.toLowerCase().includes(q) ||
          f.bu_name?.toLowerCase().includes(q) ||
          f.file_date?.toLowerCase().includes(q) ||
          f.uploaded_by?.toLowerCase().includes(q) ||
          f.ocr_text?.toLowerCase().includes(q) ||
          (Array.isArray(f.rows) && f.rows.some(row =>
            Object.values(row).some(v => String(v||'').toLowerCase().includes(q))
          ));
      })();
      return matchTab && matchBu && matchSearch;
    });

    // sort
    const toNum = v => parseFloat(String(v||'0').replace(/,/g,''))||0;
    const getTotal = f => {
      const rows = Array.isArray(f.rows)?f.rows:[];
      return rows.reduce((s,r)=>s+toNum(r['ยอดรวม']||r['มูลค่ารวม']||r['Total Value']||r['Invoice Amount']),0);
    };
    return [...base].sort((a,b) => {
      switch(sortBy) {
        case 'bu_asc':   return (a.bu_code||'').localeCompare(b.bu_code||'');
        case 'bu_desc':  return (b.bu_code||'').localeCompare(a.bu_code||'');
        case 'amount_desc': return getTotal(b)-getTotal(a);
        case 'date_desc': {
          const da = new Date(a.file_date||a.created_at||0);
          const db2= new Date(b.file_date||b.created_at||0);
          return db2-da;
        }
        case 'updated_desc':
        default:
          return new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0);
      }
    });
  }, [files, activeTab, buFilter, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAll.length / perPage));
  const safePage   = Math.min(currentPage, totalPages);
  const filtered   = filteredAll.slice((safePage-1)*perPage, safePage*perPage);

  // reset page เมื่อเปลี่ยน tab / buFilter / search
  useEffect(() => { setCurrentPage(1); }, [activeTab, buFilter, search]);

  // รายการ BU ที่มีใน tab นั้น (สำหรับ pills)
  // ── BU Color map ─────────────────────────────────────────────────────────
  // ── BU Color map — Desaturated palette (นุ่มตา ไม่แสบ) ────────────────────
  const BU_PALETTE = [
    { bg:'#EEF0F2', color:'#546E7A', activeBg:'#455A64', border:'#CFD8DC' },
    { bg:'#EEEEF6', color:'#5C6BC0', activeBg:'#3949AB', border:'#C5CAE9' },
    { bg:'#EDF5F4', color:'#4E8079', activeBg:'#37706A', border:'#B2DFDB' },
    { bg:'#F5EEF2', color:'#8D6B7E', activeBg:'#7B5A6D', border:'#F8BBD9' },
    { bg:'#F5F2EC', color:'#8D7B5A', activeBg:'#7A6A4A', border:'#FFE0B2' },
    { bg:'#F1EEF5', color:'#7B6B94', activeBg:'#6A5A82', border:'#D1C4E9' },
    { bg:'#EEF4EF', color:'#5A7C5E', activeBg:'#4A6C4E', border:'#C8E6C9' },
    { bg:'#F5EEEE', color:'#8D5E5E', activeBg:'#7A4E4E', border:'#FFCDD2' },
    { bg:'#EEF3F7', color:'#4F6E8A', activeBg:'#3F5E7A', border:'#BBDEFB' },
    { bg:'#F4F5EE', color:'#7A8050', activeBg:'#6A7040', border:'#DCEDC8' },
  ];
  const BU_COLORS = {
    BTM:  { bg:'#EEF0F2', color:'#546E7A', activeBg:'#455A64', border:'#CFD8DC' },
    CDS:  { bg:'#EEEEF6', color:'#5C6BC0', activeBg:'#3949AB', border:'#C5CAE9' },
    LKS:  { bg:'#EDF5F4', color:'#4E8079', activeBg:'#37706A', border:'#B2DFDB' },
    MPS:  { bg:'#F5EEF2', color:'#8D6B7E', activeBg:'#7B5A6D', border:'#F8BBD9' },
    CDS2: { bg:'#EEEEF6', color:'#5C6BC0', activeBg:'#3949AB', border:'#C5CAE9' },
  };
  // BU ที่ไม่อยู่ใน map → สุ่มสีจาก palette ตาม hash ของ code
  const getBuColor = (code) => {
    if (!code) return { bg:'#ECEFF1', color:'#546E7A', activeBg:'#455A64', border:'#CFD8DC' };
    if (BU_COLORS[code]) return BU_COLORS[code];
    let h = 0; for (let i=0;i<code.length;i++) h=(h*31+code.charCodeAt(i))&0xFFFFFFFF;
    return BU_PALETTE[Math.abs(h) % BU_PALETTE.length];
  };

  // Overflow: เก็บ state ว่า dropdown เปิดอยู่มั้ย
  const [showMoreBU, setShowMoreBU] = useState(false);
  const buFilterBarRef = React.useRef(null);
  // ปิด dropdown เมื่อคลิกข้างนอก
  useEffect(() => {
    if (!showMoreBU) return;
    const handler = (e) => { if (buFilterBarRef.current && !buFilterBarRef.current.contains(e.target)) setShowMoreBU(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreBU]);

  const buList = React.useMemo(() => {
    const base = files.filter(f => {
      if (activeTab === 'TRANS') return ['TRANS','STORE'].includes(f.doc_type);
      if (activeTab === 'AP09')  return f.doc_type === 'AP09';
      return f.doc_type === activeTab;
    });
    const map = {};
    base.forEach(f => { const k = f.bu_code||'?'; map[k] = (map[k]||0)+1; });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([code,cnt])=>({ code, cnt }));
  }, [files, activeTab]);

  const tabCount = (key) => {
    if (key === 'TRANS') return files.filter(f => ['TRANS','STORE'].includes(f.doc_type)).length;
    if (key === 'AP09') return files.filter(f => f.doc_type === 'AP09').length;
    return files.filter(f => f.doc_type === key).length;
  };
  const tabHasSearch = (key) => {
    if (!search) return false;
    const q = search.toLowerCase();
    const tabFiles = key==='TRANS' ? files.filter(f=>['TRANS','STORE'].includes(f.doc_type)) : files.filter(f=>f.doc_type===key);
    return tabFiles.some(f =>
      f.serial_code?.toLowerCase().includes(q)||
      f.bu_code?.toLowerCase().includes(q)||
      f.uploaded_by?.toLowerCase().includes(q)||
      (Array.isArray(f.rows)&&f.rows.some(row=>Object.values(row).some(v=>String(v||'').toLowerCase().includes(q))))
    );
  };
  const fmtDate = (d) => {
    if (!d) return '-';
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    // "01-Dec-25" หรือ "1-Dec-25" → คืนตรงๆ
    const m = String(d).match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/);
    if (m) {
      const day = m[1].padStart(2,'0');
      const mon = m[2].charAt(0).toUpperCase() + m[2].slice(1,3).toLowerCase();
      const yr  = m[3].length===2 ? m[3] : String(m[3]).slice(2);
      return `${day}-${mon}-${yr}`;
    }
    const dt = new Date(d);
    if (isNaN(dt)) return String(d).replace(/T.*/,'');
    return `${String(dt.getDate()).padStart(2,'0')}-${MON[dt.getMonth()]}-${String(dt.getFullYear()).slice(2)}`;
  };
  const fmtNum = (n) => n!=null&&!isNaN(n)&&Number(n)!==0 ? Number(n).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}) : '-';

  const S = {
    th: { padding:'8px 12px',fontSize:'11px',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'left',background:'#1a3a5c',whiteSpace:'nowrap' },
    td: { padding:'8px 12px',fontSize:'11px',borderBottom:'0.5px solid #f0f0f0',verticalAlign:'middle' },
    tab: (a) => ({ padding:'7px 16px',fontSize:'12px',cursor:'pointer',border:'none',borderBottom:a?'2px solid #1a3a5c':'2px solid transparent',background:'transparent',color:a?'#1a3a5c':'#888',fontWeight:a?'500':'400',marginBottom:'-1px',whiteSpace:'nowrap' }),
  };

  // ── Pagination helper ────────────────────────────────────────────────────
  const pageNums = React.useMemo(() => {
    if (totalPages <= 7) return Array.from({length:totalPages},(_,i)=>i+1);
    const pages = [];
    if (safePage <= 4) {
      for (let i=1;i<=5;i++) pages.push(i);
      pages.push('…'); pages.push(totalPages);
    } else if (safePage >= totalPages-3) {
      pages.push(1); pages.push('…');
      for (let i=totalPages-4;i<=totalPages;i++) pages.push(i);
    } else {
      pages.push(1); pages.push('…');
      for (let i=safePage-1;i<=safePage+1;i++) pages.push(i);
      pages.push('…'); pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safePage]);

  return (
    <div style={{ display:'flex',flexDirection:'column',flex:1,minHeight:0,width:'100%',minWidth:0,overflow:'hidden',background:'#f7f8fa' }}>
      {/* ── TOP: Breadcrumb + Header + Toolbar + Tabs + Filter ── */}
      <div style={{ flexShrink:0,background:'white',borderBottom:'1px solid #e8e8e8',boxShadow:'0 1px 4px rgba(0,0,0,0.04)',width:'100%',boxSizing:'border-box' }}>
        {/* Breadcrumb + Header + Toolbar */}
        <div style={{ padding:'10px 20px 0' }}>
          <div style={{ display:'flex',alignItems:'center',gap:'6px',marginBottom:'8px' }}>
            <button onClick={onBack} style={{ background:'none',border:'none',cursor:'pointer',color:'#aaa',fontSize:'11px',padding:0,display:'flex',alignItems:'center',gap:'4px' }}>← Document Center</button>
            <span style={{ color:'#ddd',fontSize:'11px' }}>/</span>
            <span style={{ fontSize:'11px',color:'#666' }}>{folder.label}</span>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px' }}>
            <div style={{ width:'32px',height:'32px',borderRadius:'8px',background:folder.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0 }}>{folder.icon}</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:'14px',fontWeight:'600',color:'#1a3a5c',lineHeight:1.2 }}>{folder.label}</div>
              <div style={{ fontSize:'11px',color:'#aaa' }}>{files.length} รายการทั้งหมด</div>
            </div>
            {/* Toolbar right */}
            <div style={{ display:'flex',gap:'8px',alignItems:'center',flexShrink:0 }}>
              <input placeholder="Search Serial code, BU..." value={search} onChange={e=>setSearch(e.target.value)}
                style={{ width:'220px',padding:'5px 10px',borderRadius:'6px',border:'0.5px solid #ddd',fontSize:'11px',background:'#f7f8fa',outline:'none' }}/>
              {search && <button onClick={()=>setSearch('')} style={{ padding:'5px 7px',borderRadius:'6px',border:'0.5px solid #ddd',fontSize:'11px',cursor:'pointer',background:'#f5f5f5',color:'#888' }}>✕</button>}
              <div style={{ position:'relative',display:'inline-block' }}>
                <button onClick={()=>setShowDraftPanel(true)}
                  style={{ padding:'5px 12px',borderRadius:'6px',border:'0.5px solid #c8d8ec',background:'#f0f6ff',color:'#1a3a5c',fontSize:'12px',cursor:'pointer',fontWeight:'500' }}>
                  📋 Draft
                </button>
                {draftBadge > 0 && (
                  <span style={{ position:'absolute',top:'-5px',right:'-5px',background:'#856404',color:'white',borderRadius:'50%',width:'16px',height:'16px',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700' }}>
                    {draftBadge}
                  </span>
                )}
              </div>
              <div style={{ position:'relative',display:'inline-block' }}>
                <button onClick={()=>{ setShowQueue(true); fetchQueue(); }}
                  style={{ padding:'5px 12px',borderRadius:'6px',border:'0.5px solid #c8d8ec',background:'#f0f6ff',color:'#1a3a5c',fontSize:'12px',cursor:'pointer',fontWeight:'500' }}>
                  🔔 Queue
                </button>
                {queueBadge > 0 && (
                  <span style={{ position:'absolute',top:'-5px',right:'-5px',background:'#e74c3c',color:'white',borderRadius:'50%',width:'16px',height:'16px',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700' }}>
                    {queueBadge}
                  </span>
                )}
              </div>
              <button onClick={()=>setShowAdd(true)} style={{ padding:'5px 14px',borderRadius:'6px',border:'none',background:'#1a3a5c',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500' }}>+ เพิ่มไฟล์</button>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex',padding:'0 20px' }}>
          {TABS.map(t => (
            <button key={t.key} style={S.tab(activeTab===t.key)} onClick={()=>{ setActiveTab(t.key); setBuFilter('ALL'); }}>
              {t.label}
              <span style={{ marginLeft:'4px',fontSize:'10px',background:activeTab===t.key?'#1a3a5c':'#eee',color:activeTab===t.key?'white':'#999',padding:'1px 5px',borderRadius:'20px',fontWeight:'500' }}>{tabCount(t.key)}</span>
              {tabHasSearch(t.key)&&<span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#378ADD',display:'inline-block',marginLeft:'3px',flexShrink:0}}></span>}
            </button>
          ))}
        </div>
        {/* Filter Bar */}
        <div ref={buFilterBarRef} style={{ display:'flex',alignItems:'center',gap:'6px',padding:'6px 20px',background:'#f7f8fa',borderTop:'0.5px solid #eee',position:'relative' }}>
          <span style={{ fontSize:'11px',color:'#aaa',whiteSpace:'nowrap',flexShrink:0,fontWeight:'500' }}>BU</span>
          {/* Pills row — overflow จะถูก handle โดย JS ตอน mount */}
          <div style={{ display:'flex',gap:'4px',flex:1,overflow:'hidden',minWidth:0,alignItems:'center' }}>
            {/* All pill */}
            <button onClick={()=>{ setBuFilter('ALL'); setShowMoreBU(false); }}
              style={{ height:'24px',padding:'0 12px',borderRadius:'20px',border:`1.5px solid ${buFilter==='ALL'?'#455A64':'#CFD8DC'}`,background:buFilter==='ALL'?'#455A64':'white',color:buFilter==='ALL'?'white':'#546E7A',fontSize:'11px',cursor:'pointer',fontWeight:'600',whiteSpace:'nowrap',flexShrink:0,display:'inline-flex',alignItems:'center',gap:'4px' }}>
              All <span style={{ fontSize:'10px',opacity:buFilter==='ALL'?0.75:0.6,fontWeight:'500' }}>{buList.reduce((s,b)=>s+b.cnt,0)}</span>
            </button>
            {/* BU pills — แสดงสูงสุด 5 แล้วที่เหลือไป +N more */}
            {buList.slice(0, 5).map(({code,cnt}) => {
              const c = getBuColor(code);
              const isActive = buFilter===code;
              return (
                <button key={code} onClick={()=>{ setBuFilter(code); setShowMoreBU(false); }}
                  style={{ height:'24px',padding:'0 12px',borderRadius:'20px',border:`1.5px solid ${isActive?c.activeBg:c.border}`,background:isActive?c.activeBg:c.bg,color:isActive?'white':c.color,fontSize:'11px',cursor:'pointer',fontWeight:'600',whiteSpace:'nowrap',flexShrink:0,display:'inline-flex',alignItems:'center',gap:'4px' }}>
                  {code} <span style={{ fontSize:'10px',opacity:.75,fontWeight:'500' }}>{cnt}</span>
                </button>
              );
            })}
            {/* +N more — แสดงเมื่อมี BU เกิน 5 */}
            {buList.length > 5 && (
              <div style={{ position:'relative',flexShrink:0 }}>
                <button onClick={()=>setShowMoreBU(v=>!v)}
                  style={{ height:'24px',padding:'0 10px',borderRadius:'20px',border:'1.5px solid #CFD8DC',background:showMoreBU?'#EEF0F2':'white',color:'#546E7A',fontSize:'11px',cursor:'pointer',fontWeight:'600',display:'inline-flex',alignItems:'center',gap:'3px',whiteSpace:'nowrap' }}>
                  +{buList.length-5} more <span style={{ fontSize:'10px' }}>{showMoreBU?'▲':'▼'}</span>
                </button>
                {showMoreBU && (
                  <div style={{ position:'absolute',top:'28px',left:0,background:'white',border:'0.5px solid #ddd',borderRadius:'8px',padding:'4px',zIndex:100,minWidth:'130px',boxShadow:'0 4px 12px rgba(0,0,0,0.08)' }}>
                    {buList.slice(5).map(({code,cnt}) => {
                      const c = getBuColor(code);
                      const isActive = buFilter===code;
                      return (
                        <button key={code} onClick={()=>{ setBuFilter(code); setShowMoreBU(false); }}
                          style={{ display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'5px 8px',borderRadius:'5px',border:'none',background:isActive?c.bg:'transparent',cursor:'pointer',fontSize:'11px',color:c.color,fontWeight:isActive?'600':'400' }}>
                          <span style={{ display:'inline-flex',alignItems:'center',gap:'4px' }}>
                            <span style={{ width:'8px',height:'8px',borderRadius:'50%',background:c.activeBg,display:'inline-block' }}></span>
                            {code}
                          </span>
                          <span style={{ fontSize:'10px',color:'#aaa',marginLeft:'12px' }}>{cnt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Sort */}
          <div style={{ display:'flex',alignItems:'center',gap:'5px',flexShrink:0 }}>
            <span style={{ fontSize:'11px',color:'#bbb',whiteSpace:'nowrap' }}>เรียงตาม</span>
            <select value={sortBy} onChange={e=>{ setSortBy(e.target.value); setCurrentPage(1); }}
              style={{ height:'24px',padding:'0 6px',border:'0.5px solid #ddd',borderRadius:'5px',fontSize:'11px',background:'white',color:'#333',cursor:'pointer' }}>
              <option value="updated_desc">Updated ล่าสุด</option>
              <option value="date_desc">Receive Date ล่าสุด</option>
              <option value="bu_asc">BU Code (A→Z)</option>
              <option value="bu_desc">BU Code (Z→A)</option>
              <option value="amount_desc">Amount มากสุด</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── MIDDLE: Table + Footer อยู่ใน scroll container เดียวกัน ── */}
      <div style={{ flex:'1 1 0',overflow:'hidden',padding:'8px 16px 0',display:'flex',flexDirection:'column',minHeight:0 }}>
        <div style={{ flex:'1 1 0',overflowY:'auto',overflowX:'auto',background:'white',border:'0.5px solid #e8e8e8',borderRadius:'6px',display:'flex',flexDirection:'column' }}>
          {/* Table area */}
          <div style={{ flex:'1 1 auto' }}>
        {loading ? (
          <div style={{ padding:'40px',textAlign:'center',color:'#aaa',fontSize:'13px' }}>กำลังโหลด...</div>
        ) : filteredAll.length===0 ? (
          <div style={{ padding:'32px',textAlign:'center',color:'#aaa',fontSize:'12px' }}>
            {search ? 'ไม่พบรายการที่ค้นหา' : `ยังไม่มีรายการ ${activeTab}`}
          </div>
        ) : filtered.length===0 ? (
          <div style={{ padding:'32px',textAlign:'center',color:'#aaa',fontSize:'12px' }}>ไม่พบรายการในหน้านี้</div>
        ) : (
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:'11px',minWidth:'800px' }}>
            <thead><tr>
              <th style={{ ...S.th,minWidth:'240px' }}>Filename / Serial Code</th>
              <th style={{ ...S.th,width:'200px' }}>BU Company Name</th>
              <th style={{ ...S.th,width:'70px',textAlign:'center' }}>BU Code</th>
              <th style={{ ...S.th,width:'95px',textAlign:'center' }}>Receive Date</th>
              <th style={{ ...S.th,width:'120px',textAlign:'right' }}>Amount</th>
              <th style={{ ...S.th,width:'90px',textAlign:'right' }}>VAT</th>
              <th style={{ ...S.th,width:'120px',textAlign:'right' }}>Total</th>
              <th style={{ ...S.th,width:'110px',textAlign:'center' }}>Attachment</th>
              <th style={{ ...S.th,width:'100px',textAlign:'center' }}>Action</th>
              <th style={{ ...S.th,width:'65px',textAlign:'center' }}>Invoice</th>
              <th style={{ ...S.th,width:'100px' }}>Uploaded By</th>
              <th style={{ ...S.th,width:'95px' }}>Updated At</th>
            </tr></thead>
            <tbody>
              {filtered.map(file => {
                const rows = Array.isArray(file.rows)?file.rows:[];
                const toNum = v => parseFloat(String(v||'0').replace(/,/g,''))||0;
                const totalAmt = rows.reduce((s,r)=>s+toNum(r['ยอดก่อนภาษี']||r['มูลค่าก่อนภาษี']||r['Gross Value']||r['Invoice Amount']),0);
                const totalVat = rows.reduce((s,r)=>s+toNum(r['ยอดภาษี']||r['มูลค่าภาษี']||r['Vat Value']||r['Tax Amount']),0);
                const totalAll = rows.reduce((s,r)=>s+toNum(r['ยอดรวม']||r['มูลค่ารวม']||r['Total Value']),0);
                const rawReceiveDate = rows[0]?.['Receive Date']||file.file_date||'';
                // clean duplicate เช่น "01-Dec-25 01-Dec-25" → "01-Dec-25"
                const receiveDate = (() => {
                  const m = String(rawReceiveDate).match(/(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/);
                  return m ? m[1] : rawReceiveDate;
                })();
                const attachCount = Array.isArray(file.attachments)?file.attachments.length:0;
                const isMatch = search && (() => {
                  const q = search.toLowerCase();
                  return file.serial_code?.toLowerCase().includes(q)||
                    file.bu_code?.toLowerCase().includes(q)||
                    file.bu_code_name?.toLowerCase().includes(q)||
                    file.uploaded_by?.toLowerCase().includes(q)||
                    (Array.isArray(file.rows)&&file.rows.some(row=>Object.values(row).some(v=>String(v||'').toLowerCase().includes(q))));
                })();
                const rowBg = isMatch ? '#FFFBF0' : 'white';
                return (
                  <tr key={file.id} style={{background:rowBg,borderLeft:isMatch?'3px solid #F59E0B':'3px solid transparent'}} onMouseEnter={e=>e.currentTarget.style.background=isMatch?'#FFF3CD':'#e8f0fe'} onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                    <td style={S.td}>
                      <div style={{ fontWeight:'500',color:'#1a3a5c',maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }} title={file.serial_code}>{file.serial_code}</div>
                      </td>
                    <td style={{ ...S.td,fontSize:'10px',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#555' }} title={file.bu_code_name||''}>{file.bu_code_name||'-'}</td>
                    <td style={{ ...S.td,textAlign:'center' }}>{(() => { const c=getBuColor(file.bu_code); return <span style={{ display:'inline-block',padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:'700',background:c.bg,color:c.color,border:`1px solid ${c.border}`,letterSpacing:'0.3px' }}>{file.bu_code||'-'}</span>; })()}</td>
                    <td style={{ ...S.td, textAlign:'center', width:'95px' }}>{fmtDate(receiveDate)}</td>
                    <td style={{ ...S.td,textAlign:'right' }}>{totalAmt>0?fmtNum(totalAmt):'-'}</td>
                    <td style={{ ...S.td,textAlign:'right' }}>{totalVat>0?fmtNum(totalVat):'-'}</td>
                    <td style={{ ...S.td,textAlign:'right',fontWeight:'500' }}>{(totalAll||totalAmt+totalVat)>0?fmtNum(totalAll||totalAmt+totalVat):'-'}</td>
                    <td style={{ ...S.td,textAlign:'center' }}>
                      <div style={{ display:'flex',gap:'4px',justifyContent:'center',alignItems:'center' }}>
                        {Array.isArray(file.attachments)&&file.attachments.length>0 ? (
                          <>
                            {file.attachments.slice(0,3).map((a,i)=>(
                              <img key={i} src={a.data} alt={a.name} title={a.name}
                                onClick={()=>setLightbox({attachments:file.attachments,index:i})}
                                style={{ width:'32px',height:'32px',borderRadius:'4px',objectFit:'cover',border:'0.5px solid #ddd',cursor:'pointer' }}/>
                            ))}
                            {file.attachments.length>3&&<span style={{ fontSize:'10px',color:'#aaa' }}>+{file.attachments.length-3}</span>}
                          </>
                        ) : <span style={{ fontSize:'10px',color:'#ccc' }}>-</span>}
                      </div>
                    </td>
                    
                    <td style={{ ...S.td,textAlign:'center' }}>
                      <div style={{ display:'inline-flex',gap:'4px' }}>
                        {file.source === 'ocr_pdf' && Array.isArray(file.attachments) && file.attachments.length > 0
                          ? <button title="Download PDF Preview" onClick={()=>{
                              const att = file.attachments[0];
                              const a = document.createElement('a');
                              a.href = att.data.startsWith('data:') ? att.data : `data:${att.mime||'image/jpeg'};base64,${att.data}`;
                              a.download = att.name || (file.serial_code + '.jpg');
                              a.click();
                            }} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #0F6E56',background:'#0F6E56',cursor:'pointer',fontSize:'9px',color:'white',fontWeight:'700',padding:'0',display:'flex',alignItems:'center',justifyContent:'center' }}>PDF</button>
                          : <button title="ดู" onClick={()=>setViewFile(file)} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'12px' }}>👁</button>
                        }
                        <button title="Download" onClick={()=>handleRowDownload(file)} disabled={downloadingRow===file.id} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #ddd',background: downloadingRow===file.id ? '#eee' : 'white',cursor: downloadingRow===file.id ? 'default' : 'pointer',fontSize:'12px' }}>⬇</button>
                        <button title="จัดการรูปแนบ" onClick={()=>setAttachModal(file)} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #1a3a5c',background:'white',cursor:'pointer',fontSize:'12px' }}>📎</button>
                        {(isOwner || isAdmin || file.uploaded_by===(userName||currentUser?.email||'')) && <button title="ลบ" onClick={()=>setConfirmDelete(file)} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #f7c1c1',background:'#FCEBEB',cursor:'pointer',fontSize:'12px' }}>🗑</button>}
                      </div>
                    </td>
                    <td style={{ ...S.td,textAlign:'center',fontWeight:'500',color:'#1a3a5c' }}>{rows.length}</td>
                    <td style={{ ...S.td,fontSize:'10px',color:'#888' }}>{(file.uploaded_by||'-').split('@')[0]}</td>
                    <td style={{ ...S.td,fontSize:'10px',color:'#888' }}>{fmtDate(file.updated_at||file.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
          </div>{/* end table area */}

          {/* ── FOOTER: อยู่ใน scroll container → กว้าง sync กับ table ── */}
          <div style={{ position:'sticky',bottom:0,left:0,borderTop:'1px solid #e8e8e8',background:'white',padding:'8px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',zIndex:2,minWidth:'800px' }}>
            {/* แสดงข้อมูล */}
            <div style={{ fontSize:'11px',color:'#999',whiteSpace:'nowrap' }}>
              แสดง <strong style={{ color:'#333' }}>{filteredAll.length===0?0:(safePage-1)*perPage+1}–{Math.min(safePage*perPage,filteredAll.length)}</strong> จาก <strong style={{ color:'#333' }}>{filteredAll.length}</strong> รายการ
            </div>
            {/* Page buttons */}
            <div style={{ display:'flex',alignItems:'center',gap:'3px' }}>
              <button disabled={safePage<=1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}
                style={{ width:'28px',height:'28px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',cursor:safePage<=1?'default':'pointer',color:'#555',fontSize:'13px',opacity:safePage<=1?0.35:1,display:'flex',alignItems:'center',justifyContent:'center' }}>‹</button>
              {pageNums.map((p,i) => p==='…'
                ? <span key={`d${i}`} style={{ width:'28px',textAlign:'center',fontSize:'11px',color:'#aaa' }}>…</span>
                : <button key={p} onClick={()=>setCurrentPage(p)}
                    style={{ minWidth:'28px',height:'28px',padding:'0 4px',borderRadius:'6px',border:`0.5px solid ${safePage===p?'#1a3a5c':'#ddd'}`,background:safePage===p?'#1a3a5c':'white',color:safePage===p?'white':'#555',fontSize:'11px',cursor:'pointer',fontWeight:safePage===p?'600':'400' }}>
                    {p}
                  </button>
              )}
              <button disabled={safePage>=totalPages} onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))}
                style={{ width:'28px',height:'28px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',cursor:safePage>=totalPages?'default':'pointer',color:'#555',fontSize:'13px',opacity:safePage>=totalPages?0.35:1,display:'flex',alignItems:'center',justifyContent:'center' }}>›</button>
            </div>
            {/* Rows per page */}
            <div style={{ display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'#999',whiteSpace:'nowrap' }}>
              แถวต่อหน้า
              <select value={perPage} onChange={e=>{ setPerPage(Number(e.target.value)); setCurrentPage(1); }}
                style={{ height:'26px',padding:'0 6px',border:'0.5px solid #ddd',borderRadius:'6px',fontSize:'11px',background:'white',color:'#333',cursor:'pointer' }}>
                <option value={10}>10</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value={999999}>ทั้งหมด</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {viewFile && <DocDetailModal file={viewFile} onClose={()=>setViewFile(null)} searchQuery={search}/>}
      {attachModal && (
        <AttachmentModal
          file={attachModal}
          onClose={()=>setAttachModal(null)}
          onSave={()=>{ setAttachModal(null); fetchFiles(); }}
          db={db}
          logActivity={logActivity}
        />
      )}
      {lightbox && (
        <div onClick={()=>setLightbox(null)}
          style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.82)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,flexDirection:'column',gap:'12px'}}>
          <div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'90vw',maxHeight:'80vh'}}>
            <img src={lightbox.attachments[lightbox.index].data} alt={lightbox.attachments[lightbox.index].name}
              style={{maxWidth:'90vw',maxHeight:'80vh',borderRadius:'8px',objectFit:'contain',boxShadow:'0 8px 32px rgba(0,0,0,0.5)'}}/>
            <button onClick={()=>setLightbox(null)}
              style={{position:'absolute',top:'-14px',right:'-14px',width:'28px',height:'28px',borderRadius:'50%',border:'none',background:'white',cursor:'pointer',fontSize:'14px',fontWeight:'bold',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>×</button>
            {lightbox.attachments.length>1&&lightbox.index>0&&(
              <button onClick={()=>setLightbox(p=>({...p,index:p.index-1}))}
                style={{position:'absolute',left:'-40px',top:'50%',transform:'translateY(-50%)',width:'32px',height:'32px',borderRadius:'50%',border:'none',background:'white',cursor:'pointer',fontSize:'16px',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>‹</button>
            )}
            {lightbox.attachments.length>1&&lightbox.index<lightbox.attachments.length-1&&(
              <button onClick={()=>setLightbox(p=>({...p,index:p.index+1}))}
                style={{position:'absolute',right:'-40px',top:'50%',transform:'translateY(-50%)',width:'32px',height:'32px',borderRadius:'50%',border:'none',background:'white',cursor:'pointer',fontSize:'16px',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>›</button>
            )}
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            {lightbox.attachments.map((a,i)=>(
              <img key={i} src={a.data} alt={a.name} onClick={e=>{e.stopPropagation();setLightbox(p=>({...p,index:i}));}}
                style={{width:'48px',height:'48px',borderRadius:'4px',objectFit:'cover',cursor:'pointer',border:i===lightbox.index?'2px solid white':'2px solid rgba(255,255,255,0.3)',opacity:i===lightbox.index?1:0.6,transition:'all .15s'}}/>
            ))}
          </div>
          <div style={{fontSize:'11px',color:'rgba(255,255,255,0.5)'}}>{lightbox.attachments[lightbox.index].name}</div>
        </div>
      )}
      {showAdd && <AddFileModal folder={folder} onClose={()=>setShowAdd(false)} onSave={()=>{setShowAdd(false);fetchFiles();fetchQueue();broadcastWs('doc_collection_updated',{action:'save'});}} userName={userName} currentUser={currentUser} isOwner={isOwner} isAdmin={isAdmin} isEditor={isEditor}/>}
      {showDraftPanel && <DraftPanel onClose={()=>{setShowDraftPanel(false);fetchDraftBadge();}} onSubmitted={()=>{fetchFiles();fetchDraftBadge();broadcastWs('doc_collection_updated',{action:'save'});}} userName={userName} currentUser={currentUser} isOwner={isOwner} isAdmin={isAdmin} isEditor={isEditor}/>}

      {/* ── Queue Modal — Central Queue Monitor ── */}
      {showQueue && (() => {
        const MENU_ITEMS = [
          { key:'ap_controller', label:'AP Controller' },
          { key:'docenter',      label:'Document Center' },
          { key:'vat_controller',label:'VAT Controller' },
          { key:'i_expense',     label:'I-Expense' },
          { key:'gl_functional', label:'GL Functional' },
          { key:'i_pro',         label:'I-Pro Interface' },
        ];

        const getMenuCount = (key) => {
          if (key === 'docenter') return queueItems.filter(q => !['done'].includes(q.status)).length;
          if (key === 'ap_controller') return 0; // placeholder — AP OCR จะ hook เข้ามาในอนาคต
          return 0;
        };
        const activeCount = queueItems.filter(q => ['pending','ocring','waiting_ap','error'].includes(q.status)).length;
        const totalCount  = queueItems.length;

        const filteredItems = queueItems.filter(q => {
          const matchSrc = qSideTab === 'dashboard' || (qSideTab === 'docenter');
          const matchSt  = qStatus === 'all'
            ? true
            : qStatus === 'active' ? ['pending','ocring','waiting_ap'].includes(q.status)
            : qStatus === 'done'   ? q.status === 'done'
            : qStatus === 'error'  ? q.status === 'error'
            : true;
          return matchSrc && matchSt;
        });

        const getStatusTag = (status) => {
          const map = {
            ocring:     { label:'กำลัง OCR',    bg:'#E3F0FF', color:'#1a3a5c' },
            pending:    { label:'รอคิว',         bg:'#F5F5F5', color:'#777' },
            waiting_ap: { label:'รอ AP Controller', bg:'#F5EEF2', color:'#8D6B7E' },
            done:       { label:'เสร็จแล้ว',    bg:'#EEF4EF', color:'#5A7C5E' },
            error:      { label:'ผิดพลาด',       bg:'#FFEBEE', color:'#C62828' },
          };
          return map[status] || { label:status, bg:'#f0f0f0', color:'#666' };
        };

        return (
          <div style={{ position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1500 }}
            onClick={()=>setShowQueue(false)}>
            <div onClick={e=>e.stopPropagation()}
              style={{ background:'white',borderRadius:'12px',width:'900px',height:'580px',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}>

              {/* Header */}
              <div style={{ background:'#1a3a5c',padding:'13px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0 }}>
                <div style={{ display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',fontWeight:'600',color:'white' }}>
                  🖥️ Central Queue Monitor
                  {activeCount > 0 && <span style={{ background:'#E24B4A',color:'white',borderRadius:'10px',padding:'1px 8px',fontSize:'10px',fontWeight:'700' }}>{activeCount}</span>}
                </div>
                <button onClick={()=>setShowQueue(false)} style={{ background:'none',border:'none',color:'rgba(255,255,255,0.6)',fontSize:'20px',cursor:'pointer',lineHeight:1 }}>×</button>
              </div>

              {/* Info bar */}
              <div style={{ padding:'5px 16px',background:'#EEF3F7',borderBottom:'0.5px solid #C5CAE9',fontSize:'10px',color:'#4F6E8A',display:'flex',gap:'16px',alignItems:'center',flexShrink:0 }}>
                <span><span style={{ width:'7px',height:'7px',borderRadius:'50%',background:'#E24B4A',display:'inline-block',marginRight:'3px' }}></span>AP Controller = Priority สูง</span>
                <span><span style={{ width:'7px',height:'7px',borderRadius:'50%',background:'#4E8079',display:'inline-block',marginRight:'3px' }}></span>Document Center = Priority ปกติ</span>
                {isOwner && <span style={{ marginLeft:'auto',color:'#856404',fontWeight:'500' }}>Owner: กด ↑ ลัดคิวได้</span>}
              </div>

              {/* Body */}
              <div style={{ display:'flex',flex:1,overflow:'hidden' }}>

                {/* Sidebar */}
                <div style={{ width:'170px',flexShrink:0,borderRight:'0.5px solid #eee',background:'#fafafa',overflowY:'auto',display:'flex',flexDirection:'column' }}>
                  {/* Dashboard */}
                  <div style={{ padding:'10px 0' }}>
                    <div onClick={()=>setQSideTab('dashboard')}
                      style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',cursor:'pointer',fontSize:'12px',fontWeight:'700',color:qSideTab==='dashboard'?'#455A64':'#444',background:qSideTab==='dashboard'?'#EEF3F7':'transparent',borderLeft:`2.5px solid ${qSideTab==='dashboard'?'#455A64':'transparent'}` }}>
                      Dashboard
                      {activeCount > 0 && <span style={{ background:'#E24B4A',color:'white',borderRadius:'8px',padding:'1px 6px',fontSize:'9px',fontWeight:'700' }}>{activeCount}</span>}
                    </div>
                  </div>
                  <div style={{ borderTop:'0.5px solid #eee',margin:'0 14px' }}></div>
                  <div style={{ padding:'8px 0' }}>
                    <div style={{ fontSize:'9px',fontWeight:'600',color:'#bbb',padding:'4px 14px 6px',letterSpacing:'.5px',textTransform:'uppercase' }}>เมนู</div>
                    {MENU_ITEMS.map(({ key, label }) => {
                      const cnt = getMenuCount(key);
                      const isOn = qSideTab === key;
                      return (
                        <div key={key} onClick={()=>cnt>0?setQSideTab(key):null}
                          style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',cursor:cnt>0?'pointer':'default',fontSize:'11px',color:isOn?'#455A64':cnt===0?'#bbb':'#555',background:isOn?'#EEF3F7':'transparent',borderLeft:`2.5px solid ${isOn?'#455A64':'transparent'}`,fontWeight:isOn?'600':'400' }}>
                          {label}
                          <span style={{ fontSize:'9px',borderRadius:'8px',padding:'1px 6px',background:cnt>0?'#E24B4A':'#E8ECEF',color:cnt>0?'white':'#aaa',fontWeight:'600' }}>{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Content */}
                <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0 }}>

                  {/* Status filter */}
                  <div style={{ display:'flex',alignItems:'center',gap:'8px',padding:'8px 14px',borderBottom:'0.5px solid #eee',flexShrink:0,background:'#fafafa' }}>
                    {[['active','กำลังทำงาน/รอ'],['done','Done'],['error','Error'],['all','ทั้งหมด']].map(([v,l]) => (
                      <button key={v} onClick={()=>setQStatus(v)}
                        style={{ padding:'5px 12px',fontSize:'11px',background:qStatus===v?'#455A64':'white',color:qStatus===v?'white':'#546E7A',border:'0.5px solid #CFD8DC',borderRadius:'6px',cursor:'pointer',fontWeight:qStatus===v?'500':'400',whiteSpace:'nowrap' }}>
                        {l}
                      </button>
                    ))}
                  </div>

                  {/* Table header */}
                  <div style={{ display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 100px 72px 90px 64px',padding:'6px 14px',background:'#F5F7F9',borderBottom:'0.5px solid #e8e8e8',flexShrink:0,gap:'4px' }}>
                    {['#','ไฟล์','สถานะ','เวลา','อัปโหลดโดย','Action'].map((h,i) => (
                      <div key={i} style={{ fontSize:'10px',fontWeight:'500',color:'#888',textAlign:i===5?'right':'left' }}>{h}</div>
                    ))}
                  </div>

                  {/* List */}
                  <div style={{ flex:1,overflowY:'auto',overflowX:'hidden' }}>
                    {filteredItems.length === 0 ? (
                      <div style={{ textAlign:'center',padding:'40px',color:'#aaa',fontSize:'12px' }}>
                        <div style={{ fontSize:'28px',marginBottom:'8px' }}>✅</div>
                        ไม่มีงานในคิว
                      </div>
                    ) : filteredItems.map((q, qi) => {
                      const st = getStatusTag(q.status);
                      const pos = q.queue_position || (qi+1);
                      const isOcring = q.status === 'ocring';
                      return (
                        <div key={q.id} style={{ display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 100px 72px 90px 64px',padding:'10px 14px',borderBottom:'0.5px solid #f5f5f5',alignItems:'center',gap:'4px',background:isOcring?'#f0f6ff':'white' }}>
                          {/* # */}
                          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'1px' }}>
                            <span style={{ fontSize:'8px',color:'#bbb',fontWeight:'700' }}>#{pos}</span>
                            <span style={{ fontSize:'14px',lineHeight:1 }}>
                              {q.status==='ocring'?'⚙️':q.status==='done'?'✅':q.status==='error'?'❌':q.status==='waiting_ap'?'⏸️':'⏳'}
                            </span>
                          </div>
                          {/* ไฟล์ */}
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{q.file_name}</div>
                            <div style={{ display:'flex',gap:'3px',marginTop:'2px',flexWrap:'wrap' }}>
                              <span style={{ fontSize:'9px',padding:'1px 5px',borderRadius:'3px',fontWeight:'500',background:'#EDF5F4',color:'#4E8079',border:'1px solid #B2DFDB' }}>Document Center</span>
                              <span style={{ fontSize:'9px',padding:'1px 5px',borderRadius:'3px',fontWeight:'500',background:st.bg,color:st.color }}>{st.label}</span>
                            </div>
                            {isOcring && <div style={{ height:'3px',borderRadius:'2px',background:'#dce8fb',overflow:'hidden',marginTop:'4px' }}><div style={{ height:'100%',borderRadius:'2px',background:'#1a3a5c',animation:'ocrShimmer 1.5s ease-in-out infinite' }}/></div>}
                          </div>
                          {/* สถานะ */}
                          <div><span style={{ fontSize:'9px',padding:'1px 6px',borderRadius:'3px',fontWeight:'500',background:st.bg,color:st.color,whiteSpace:'nowrap' }}>{st.label}</span></div>
                          {/* เวลา */}
                          <div style={{ fontSize:'10.5px',color:'#666' }}>{new Date(q.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</div>
                          {/* อัปโหลดโดย */}
                          <div style={{ fontSize:'10.5px',color:'#666',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{q.uploaded_by||'-'}</div>
                          {/* Action */}
                          <div style={{ display:'flex',gap:'4px',justifyContent:'flex-end' }}>
                            {isOwner && ['pending','waiting_ap'].includes(q.status) && (
                              <button onClick={async()=>{ const token=sessionStorage.getItem('fastapn_token'); await fetch(`${API_Q}/queue/${q.id}/priority`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({direction:'up'})}); fetchQueue(); }}
                                style={{ width:'24px',height:'24px',borderRadius:'4px',border:'0.5px solid #455A64',background:'#EEF0F2',color:'#455A64',fontSize:'11px',cursor:'pointer',fontWeight:'700',display:'flex',alignItems:'center',justifyContent:'center' }}>↑</button>
                            )}
                            <button onClick={async()=>{ const token=sessionStorage.getItem('fastapn_token'); await fetch(`${API_Q}/queue/${q.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}}); fetchQueue(); }}
                              style={{ width:'24px',height:'24px',borderRadius:'4px',border:'0.5px solid #FFCDD2',background:'#FFEBEE',color:'#C62828',fontSize:'11px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div style={{ flexShrink:0,borderTop:'0.5px solid #eee',padding:'7px 14px',background:'#fafafa',fontSize:'10px',color:'#aaa',display:'flex',justifyContent:'space-between' }}>
                    <span>แสดง {filteredItems.length} รายการ (24 ชั่วโมงล่าสุด)</span>
                    <span>อัปเดตทันทีเมื่อมีการเปลี่ยนแปลง</span>
                  </div>

                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {confirmDelete && (
        <div style={{ position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999 }}>
          <div style={{ background:'white',borderRadius:'10px',padding:'24px',width:'380px' }}>
            <div style={{ fontSize:'15px',fontWeight:'500',marginBottom:'8px' }}>ยืนยันการลบ</div>
            <div style={{ fontSize:'12px',color:'#555',marginBottom:'20px' }}>ลบ <strong>{confirmDelete.serial_code}</strong> ออกจากระบบ?</div>
            <div style={{ display:'flex',justifyContent:'flex-end',gap:'8px' }}>
              <button onClick={()=>setConfirmDelete(null)} style={{ padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={()=>handleDelete(confirmDelete)} style={{ padding:'6px 14px',borderRadius:'6px',border:'none',background:'#c0392b',color:'white',fontSize:'12px',cursor:'pointer' }}>ลบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document Center (Main) ───────────────────────────────────────────────────
// ── Support & Feedback: Drop Zone แนบรูป (Limit ปรับได้ต่างจาก AttachDropZone เดิม) ──
function SupportAttachDropZone({ attachments, setAttachments, maxImages = 5 }) {
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef(null);

  const processFiles = (files) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (attachments.length + imgs.length > maxImages) {
      alert(`แนบได้สูงสุด ${maxImages} รูปครับ`); return;
    }
    imgs.slice(0, maxImages - attachments.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        setAttachments(prev => [...prev, { name: file.name, data: e.target.result, mime: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div style={{ display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap' }}>
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);processFiles(e.dataTransfer.files);}}
        onClick={()=>attachments.length<maxImages&&inputRef.current?.click()}
        style={{ display:'flex',alignItems:'center',gap:'6px',padding:'4px 10px',borderRadius:'6px',border:`1.5px dashed ${dragOver?'#1a3a5c':'#ddd'}`,background:dragOver?'#f0f6ff':'white',cursor:attachments.length<maxImages?'pointer':'default',fontSize:'11px',color:'#888',whiteSpace:'nowrap',transition:'all .15s' }}>
        📎 {attachments.length===0?'แนบรูป':attachments.length+'/'+maxImages}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>processFiles(e.target.files)}/>
      {attachments.map((a,i)=>(
        <div key={i} style={{ position:'relative',flexShrink:0 }}>
          <img src={a.data} alt={a.name} style={{ width:'32px',height:'32px',borderRadius:'4px',objectFit:'cover',border:'0.5px solid #ddd' }}/>
          <button onClick={()=>setAttachments(prev=>prev.filter((_,j)=>j!==i))}
            style={{ position:'absolute',top:'-4px',right:'-4px',width:'14px',height:'14px',borderRadius:'50%',border:'none',background:'#c0392b',color:'white',cursor:'pointer',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1 }}>×</button>
        </div>
      ))}
    </div>
  );
}

function DocumentCenter({ jumpToSetupToken, returnPage, onBackToCaller } = {}) {
  const downloadOutlookHandler = async (full) => {
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const path = full ? '/api/file-storage/outlook-handler' : '/api/file-storage/outlook-handler/ps1-only';
      const filename = full ? 'fastapn-outlook-handler.zip' : 'fastapn-outlook.ps1';
      const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      try { localStorage.setItem('fastapn_handler_ready', '1'); } catch(e) {}
    } catch (err) { alert('ดาวน์โหลดไม่สำเร็จ: ' + err.message); }
  };

  const { currentUser, userName, userPermissions } = useAuth();
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const [userRoleData, setUserRoleData] = useState(null);
  const [fileCounts, setFileCounts] = useState({});
  const [folderBatches, setFolderBatches] = useState({});
  const [folderDrafts, setFolderDrafts] = useState({});
  const [detailFolder, setDetailFolder] = useState(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailBU, setDetailBU] = useState('');
  const [detailMode, setDetailMode] = useState('batch');
  const [detailViewFile, setDetailViewFile] = useState(null); // MARKER_APMANUAL_EDITOR_PERM_AND_VIEW_V1
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState({});
  const [toast, setToast] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeTab, setActiveTab] = useState('folders');
  useEffect(() => { if (jumpToSetupToken) setActiveTab('setup'); }, [jumpToSetupToken]);
  const [showHandlerDetail, setShowHandlerDetail] = useState(false);

  // ── Support & Feedback State (Phase 2) ──
  const [supportThreads, setSupportThreads] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportStatusTab, setSupportStatusTab] = useState('new');
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [newThreadMenuSource, setNewThreadMenuSource] = useState('');
  const [newThreadAttachments, setNewThreadAttachments] = useState([]);
  // MARKER_SEVERITY_DEFAULT_REQUEST_V1
  const [newThreadSeverity, setNewThreadSeverity] = useState('request');
  const [creatingThread, setCreatingThread] = useState(false);
  // MARKER_UPLOADGEN_AGREEMENT_SYSTEM_V1
  const [newThreadRefLogNumber, setNewThreadRefLogNumber] = useState('');
  const [newThreadRefTitle, setNewThreadRefTitle] = useState('');
  const [agreeingThread, setAgreeingThread] = useState(false);
  const [disagreeingThread, setDisagreeingThread] = useState(false);
  // MARKER_UPLOADGEN_AGREEMENT_SYNC_V1
  const [pendingRefThreadId, setPendingRefThreadId] = useState('');
  // MARKER_UPLOADGEN_EDIT_THREAD_V1
  // ── '' = Create Mode / มีค่า = Edit Mode (id ของกระทู้ที่กำลังแก้) ──
  const [editingThreadId, setEditingThreadId] = useState('');
  const [existingImages, setExistingImages] = useState([]); // รูปเดิมจาก Server [{id, ...}]
  const [existingImageUrls, setExistingImageUrls] = useState({}); // {imgId: blobUrl}
  const [deletingImageId, setDeletingImageId] = useState('');

  // ── รับค่า Disagree จากหน้าอื่น (Bell/Home) ผ่าน sessionStorage -> เปิด Tab + ฟอร์มอัตโนมัติ ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pendingDisagreeRef');
      if (raw) {
        const ref = JSON.parse(raw);
        setActiveTab('support');
        setNewThreadRefLogNumber(ref.logNumber || '');
        setNewThreadRefTitle(ref.title || '');
        // MARKER_UPLOADGEN_DISAGREE_PREFILL_MENUSOURCE_V1
        if (ref.menuSource) setNewThreadMenuSource(ref.menuSource);
        // MARKER_UPLOADGEN_AGREEMENT_SYNC_V1
        setPendingRefThreadId(ref.threadId || '');
        setShowNewThreadForm(true);
        sessionStorage.removeItem('pendingDisagreeRef');
      }
    } catch (err) { console.error('[pendingDisagreeRef]', err); }
  }, []);

  // MARKER_SUPPORT_RECYCLE_BIN_FRONTEND_V1
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [recycleBinThreads, setRecycleBinThreads] = useState([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState(null);
  // MARKER_SUPPORT_CONFIRM_MODAL_V1
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  // MARKER_SUPPORT_CONFIRM_MODAL_KEYBOARD_V1
  useEffect(() => {
    if (!confirmDialog) return;
    const fn = e => {
      if (e.key === 'Enter') confirmDialog.onConfirm();
      else if (e.key === 'Escape') setConfirmDialog(null);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [confirmDialog]);

  // MARKER_SUPPORT_EXPORT_WORD_FRONTEND_V1
  const [showExportReport, setShowExportReport] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportFilterUser, setExportFilterUser] = useState('');
  const [exportingReport, setExportingReport] = useState(false);

  // MARKER_SUPPORT_THREAD_DETAIL_V1
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadDetailLoading, setThreadDetailLoading] = useState(false);
  const [threadComments, setThreadComments] = useState([]);
  const [threadImageUrls, setThreadImageUrls] = useState({});
  // MARKER_SUPPORT_COMMENT_IMAGES_V1
  const [threadImages, setThreadImages] = useState([]); // Raw List พร้อม sub_ref_id ไว้แยกรูปตาม Comment
  // MARKER_SUPPORT_IMAGE_LIGHTBOX_V1
  const [lightboxImageUrl, setLightboxImageUrl] = useState(null);
  // MARKER_SUPPORT_THREAD_FULLPAGE_V1
  useEffect(() => {
    if (!lightboxImageUrl) return;
    const fn = e => { if (e.key === 'Escape') setLightboxImageUrl(null); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [lightboxImageUrl]);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentAttachments, setNewCommentAttachments] = useState([]);
  const [postingComment, setPostingComment] = useState(false);
  const [finishingThread, setFinishingThread] = useState(false);
  const [rejectingThread, setRejectingThread] = useState(false); // MARKER_SUPPORT_REJECT_V1
  // MARKER_SUPPORT_HOLD_FRONTEND_V1
  const [holdingThread, setHoldingThread] = useState(false);
  const [unholdingThread, setUnholdingThread] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdReasonInput, setHoldReasonInput] = useState('');
  const statusTimerRef = React.useRef(null);
  const [supportSearchQuery, setSupportSearchQuery] = useState('');
  const [supportMenuFilter, setSupportMenuFilter] = useState('');

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { data: roleData } = await db.from('user_roles').select('*').eq('email', currentUser.email).single();
      setUserRoleData(roleData);
      if (roleData?.id) {
        const { data: reqData } = await db.from('access_requests').select('*').eq('requester_id', roleData.id);
        setRequests(reqData || []);
      }
      const [{ data: countData }, { data: batchData }] = await Promise.all([
        db.from('doc_files').select('folder_key'),
        db.from('doc_collection').select('serial_code,doc_type,bu_code,bu_name,created_at,uploaded_by,status').neq('doc_type',''),
      ]);
      if (countData) {
        const counts = {};
        countData.forEach(r => { counts[r.folder_key] = (counts[r.folder_key] || 0) + 1; });
        if (batchData) counts['ap'] = (counts['ap']||0) + (batchData.filter(r=>r.doc_type==='APN01'&&r.status!=='draft').length);
        setFileCounts(counts);
      }
      if (batchData) {
        const allBatches = batchData||[];
        const nonDraft = allBatches.filter(b=>b.status!=='draft');
        const draftOnly = allBatches.filter(b=>b.status==='draft');
        console.log('[folderBatches] total:', nonDraft.length, 'drafts:', draftOnly.length);
        const byFolder = {}, byFolderDraft = {};
        DOC_FOLDERS.forEach(f => {
          if (f.docTypes) {
            byFolder[f.key] = nonDraft.filter(b=>(f.docTypes).includes(b.doc_type));
            byFolderDraft[f.key] = draftOnly.filter(b=>(f.docTypes).includes(b.doc_type));
          }
        });
        setFolderBatches(byFolder);
        setFolderDrafts(byFolderDraft);
      }
    } catch (err) { console.error('fetchData error:', err); }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // MARKER_COMINGSOON_ESC_BACK_V1
  // Esc = Back สำหรับหน้า "Module นี้ยังไม่เปิดใช้งาน" (VAT/I-Expense/GL/I-Pro)
  // คนละ Component กับ FolderDetail (ที่มีแต่ AP Manual ใช้) เลยต้องแยกจับที่นี่
  useEffect(() => {
    const fn = e => {
      if (e.key !== 'Escape') return;
      if (activeFolder && activeFolder.key !== 'ap') {
        setActiveFolder(null);
        fetchData();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [activeFolder, fetchData]);

  // ── Support & Feedback: ดึงรายการกระทู้ (Endpoint 1.8) ──
  const fetchSupportThreads = useCallback(async () => {
    setSupportLoading(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) setSupportThreads(data.threads || []);
    } catch (err) { console.error('fetchSupportThreads error:', err); }
    setSupportLoading(false);
  }, []);

  useEffect(() => { if (activeTab === 'support') fetchSupportThreads(); }, [activeTab, fetchSupportThreads]);

  // ── Support & Feedback: ตั้งกระทู้ใหม่ + อัปโหลดรูปแนบ (ถ้ามี) ──
  // MARKER_SUPPORT_PASTE_IMAGE_V1
  // ── Paste รูปจาก Clipboard (Ctrl+V) เข้าช่องแนบรูปโดยตรง ไม่ต้องกดปุ่มแนบ ──
  const handleImagePaste = (e, attachments, setAttachments, maxImages = 5) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(item => item.type && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    if (attachments.length + imageItems.length > maxImages) {
      alert(`แนบได้สูงสุด ${maxImages} รูปครับ`);
      return;
    }
    imageItems.slice(0, maxImages - attachments.length).forEach(item => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        setAttachments(prev => [...prev, { name: file.name || 'pasted-image.png', data: ev.target.result, mime: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  };

  // MARKER_UPLOADGEN_EDIT_THREAD_OPEN_V1
  // ── เปิด Form แก้ไข -- Pre-fill ข้อมูลเดิม + โหลดรูปเดิม (ต้องผ่าน Auth Header ──
  // ── เพราะ view-image Endpoint เช็คสิทธิ์ก่อนส่งรูป ใช้ <img src> ตรงๆ ไม่ได้) ──
  const handleOpenEditThread = async (thread) => {
    setEditingThreadId(thread.id);
    setNewThreadTitle(thread.title || '');
    setNewThreadBody(thread.body || '');
    setNewThreadMenuSource(thread.menu_source || '');
    setNewThreadSeverity(thread.severity || 'request');
    setNewThreadAttachments([]);
    setNewThreadRefLogNumber('');
    setNewThreadRefTitle('');
    setPendingRefThreadId('');
    setExistingImages([]);
    setExistingImageUrls({});
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${thread.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        const postImages = (data.images || []).filter(img => !img.sub_ref_id);
        const urls = {};
        for (const img of postImages) {
          try {
            const imgRes = await fetch(`${apiBase}/api/file-storage/${img.id}/view-image`, { headers: { Authorization: `Bearer ${token}` } });
            const blob = await imgRes.blob();
            urls[img.id] = URL.createObjectURL(blob);
          } catch (e) { console.error('load existing image error:', e); }
        }
        setExistingImageUrls(urls);
        setExistingImages(postImages);
      }
    } catch (err) { console.error('load thread images for edit error:', err); }
    setShowNewThreadForm(true);
  };

  const handleDeleteExistingImage = async (imgId) => {
    setDeletingImageId(imgId);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      await fetch(`${apiBase}/api/file-storage/${imgId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      setExistingImages(prev => prev.filter(img => img.id !== imgId));
    } catch (err) { alert('ลบรูปไม่สำเร็จ: ' + err.message); }
    setDeletingImageId('');
  };

  const handleCreateThread = async () => {
    if (!newThreadTitle.trim() || !newThreadBody.trim() || !newThreadMenuSource) {
      alert('กรุณากรอกหัวข้อ รายละเอียด และเลือกเมนูที่เกี่ยวข้อง'); return;
    }
    setCreatingThread(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      // MARKER_UPLOADGEN_EDIT_THREAD_SUBMIT_V1 -- แยก Create (POST) / Edit (PATCH) ในฟังก์ชันเดียวกัน
      const isEditMode = !!editingThreadId;
      const url = isEditMode ? `${apiBase}/api/support/threads/${editingThreadId}` : `${apiBase}/api/support/threads`;
      const method = isEditMode ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: newThreadTitle.trim(), body: newThreadBody.trim(), menuSource: newThreadMenuSource, severity: newThreadSeverity, refLogNumber: newThreadRefLogNumber || undefined, refThreadId: pendingRefThreadId || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { alert((isEditMode ? 'แก้ไข' : 'ตั้ง') + 'กระทู้ไม่สำเร็จ: ' + (data.error || '')); setCreatingThread(false); return; }
      // MARKER_UPLOADGEN_AGREEMENT_SYNC_V1 -- Commit Disagree สำเร็จพร้อมกระทู้ใหม่ -> Broadcast ให้ Bell/Home Sync ทันที
      if (!isEditMode && pendingRefThreadId) broadcastWs('support_agreement_updated', { threadId: pendingRefThreadId });

      const targetThreadId = isEditMode ? editingThreadId : data.thread.id;
      for (const att of newThreadAttachments) {
        const base64 = att.data.split(',')[1];
        await fetch(`${apiBase}/api/file-storage/upload-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ module: 'support-feedback', refId: targetThreadId, fileBase64: base64 }),
        });
      }

      setShowNewThreadForm(false);
      setNewThreadTitle(''); setNewThreadBody(''); setNewThreadMenuSource(''); setNewThreadAttachments([]); setNewThreadSeverity('request');
      setNewThreadRefLogNumber(''); setNewThreadRefTitle(''); setPendingRefThreadId('');
      setEditingThreadId(''); setExistingImages([]); setExistingImageUrls({});
      fetchSupportThreads();
      if (isEditMode) setSelectedThread(prev => (prev && prev.id === targetThreadId ? { ...prev, ...data.thread } : prev));
    } catch (err) { alert('บันทึกกระทู้ไม่สำเร็จ: ' + err.message); }
    setCreatingThread(false);
  };

  // MARKER_UPLOADGEN_TESTING_IN_INPROCESS_TAB_V1 -- testing ยังไม่จบงาน นับ/แสดงใน Tab In process ด้วย
  // MARKER_UPLOADGEN_BACKLOG_TAB_V1 -- Resolve เฉพาะไม่เกิน 7 วัน / Backlog เฉพาะเกิน 7 วัน (Owner เท่านั้น) นับจาก resolved_at
  const isBacklogThread = (t) => {
    if (t.status !== 'resolved' || !t.resolved_at) return false;
    const daysSince = (Date.now() - new Date(t.resolved_at).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  };
  const supportCounts = {
    new: supportThreads.filter(t => t.status === 'new').length,
    in_process: supportThreads.filter(t => t.status === 'in_process' || t.status === 'testing').length,
    resolved: supportThreads.filter(t => t.status === 'resolved' && !isBacklogThread(t)).length,
    backlog: supportThreads.filter(t => isBacklogThread(t)).length,
  };
  const filteredSupportThreads = supportThreads.filter(t => {
    if (supportStatusTab === 'in_process') {
      if (t.status !== 'in_process' && t.status !== 'testing') return false;
    } else if (supportStatusTab === 'backlog') {
      if (!isBacklogThread(t)) return false;
    } else if (supportStatusTab === 'resolved') {
      if (t.status !== 'resolved' || isBacklogThread(t)) return false;
    } else if (t.status !== supportStatusTab) {
      return false;
    }
    if (supportMenuFilter && t.menu_source !== supportMenuFilter) return false;
    if (supportSearchQuery.trim()) {
      const q = supportSearchQuery.trim().toLowerCase();
      const haystack = `${t.title} ${t.body} ${t.created_by} ${t.menu_source}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ── Unread: เฉพาะ Tab In process (รวม testing) — เทียบ last_activity_at กับ read_at ของฝั่งตัวเอง ──
  const isThreadUnread = (t) => {
    if ((t.status !== 'in_process' && t.status !== 'testing') || !t.last_activity_at) return false;
    const readAt = isOwner ? t.owner_last_read_at : t.creator_last_read_at;
    return !readAt || new Date(t.last_activity_at) > new Date(readAt);
  };

  const sortedFilteredSupportThreads = supportStatusTab === 'in_process'
    ? [...filteredSupportThreads].sort((a, b) => (isThreadUnread(b) ? 1 : 0) - (isThreadUnread(a) ? 1 : 0))
    : filteredSupportThreads;

  // ── Support & Feedback: ลบกระทู้ (Soft Delete เข้า Recycle Bin) ──
  const handleDeleteThread = (threadId) => {
    setConfirmDialog({
      message: 'ลบกระทู้นี้เข้า Recycle Bin? (กู้คืนได้ภายใน 3 วัน)',
      onConfirm: async () => {
        setConfirmDialog(null);
        setDeletingThreadId(threadId);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');
          const res = await fetch(`${apiBase}/api/support/threads/${threadId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!data.ok) { alert('ลบไม่สำเร็จ: ' + (data.error || '')); setDeletingThreadId(null); return; }
          fetchSupportThreads();
        } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
        setDeletingThreadId(null);
      },
    });
  };

  const canDeleteThread = (t) => {
    if (isOwner) return true;
    return t.status === 'new' && t.created_by === (userName || currentUser?.email);
  };

  // ── Support & Feedback: Export Report เป็น Word (Phase 5) — Download ทันที ไม่เก็บไว้ ──
  const handleExportReport = async () => {
    if (!exportFrom || !exportTo) { alert('กรุณาเลือกช่วงวันที่'); return; }
    setExportingReport(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const params = new URLSearchParams({ from: exportFrom, to: exportTo });
      if (isOwner && exportFilterUser) params.set('filterUser', exportFilterUser);
      const res = await fetch(`${apiBase}/api/support/threads/export-word?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert('Export ไม่สำเร็จ: ' + (errData.error || res.statusText));
        setExportingReport(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fmtDate = (d) => { const dt = new Date(d); return String(dt.getDate()).padStart(2, '0') + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getFullYear()).slice(2); };
      const who = userName || currentUser?.email || 'user';
      a.href = url;
      a.download = `Feedback Report by ${who} ${fmtDate(exportFrom)}-${fmtDate(exportTo)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportReport(false);
    } catch (err) { alert('Export ไม่สำเร็จ: ' + err.message); }
    setExportingReport(false);
  };

  const supportReportUserOptions = [...new Set(supportThreads.map(t => t.created_by).filter(Boolean))].sort();

  // ── Support & Feedback: Recycle Bin (Owner เท่านั้น) ──
  const fetchRecycleBin = useCallback(async () => {
    setRecycleBinLoading(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/recycle-bin/list`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) setRecycleBinThreads(data.threads || []);
    } catch (err) { console.error('fetchRecycleBin error:', err); }
    setRecycleBinLoading(false);
  }, []);

  useEffect(() => { if (showRecycleBin) fetchRecycleBin(); }, [showRecycleBin, fetchRecycleBin]);

  const handleRestoreThread = async (threadId) => {
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${threadId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) { alert('กู้คืนไม่สำเร็จ: ' + (data.error || '')); return; }
      fetchRecycleBin();
      fetchSupportThreads();
    } catch (err) { alert('กู้คืนไม่สำเร็จ: ' + err.message); }
  };

  // ── Thread Detail: โหลดรูปแนบทั้งหมดเป็น Blob URL (ต้องแนบ Token ตอนขอรูป) ──
  const loadThreadImages = async (images) => {
    const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
    const token = sessionStorage.getItem('fastapn_token');
    const urls = {};
    for (const img of images) {
      try {
        const res = await fetch(`${apiBase}/api/file-storage/${img.id}/view-image`, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await res.blob();
        urls[img.id] = URL.createObjectURL(blob);
      } catch (err) { console.error('load thread image error:', err); }
    }
    setThreadImageUrls(urls);
    setThreadImages(images);
  };

  // ── Thread Detail: เปิดกระทู้ + (ถ้าเป็น Owner) เรียก /view ทันที + จับ Timer 30 วิ ──
  const openThreadDetail = async (threadId) => {
    setThreadDetailLoading(true);
    setSelectedThread({ id: threadId });
    setThreadComments([]);
    setThreadImageUrls({});
    setThreadImages([]);
    setNewCommentText('');
    setNewCommentAttachments([]);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${threadId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.ok) { alert('โหลดกระทู้ไม่สำเร็จ: ' + (data.error || '')); setSelectedThread(null); setThreadDetailLoading(false); return; }

      setSelectedThread(data.thread);
      setThreadComments(data.comments || []);
      loadThreadImages(data.images || []);

      if (isOwner) {
        fetch(`${apiBase}/api/support/threads/${threadId}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});

        if (data.thread.status === 'new') {
          statusTimerRef.current = setTimeout(async () => {
            try {
              const r = await fetch(`${apiBase}/api/support/threads/${threadId}/start-process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
              const d = await r.json();
              if (d.ok && d.changed) {
                setSelectedThread(prev => (prev && prev.id === threadId ? { ...prev, status: 'in_process' } : prev));
              }
            } catch (err) { console.error('start-process error:', err); }
          }, 30000);
        }
      }
    } catch (err) {
      alert('โหลดกระทู้ไม่สำเร็จ: ' + err.message);
      setSelectedThread(null);
    }
    setThreadDetailLoading(false);
  };

  // ── Thread Detail: ปิด Modal — ยกเลิก Timer ถ้ายังไม่ครบ 30 วิ + Refresh List ──
  // MARKER_UPLOADGEN_SUPPORT_DISMISS_ON_CLOSE_V1
  // ── ปิด Chat = ถือว่าอ่านจบแล้ว -- ลบ Notification ฝั่งตัวเองสำหรับ Thread นี้ ──
  const closeThreadDetail = () => {
    if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); statusTimerRef.current = null; }
    const dismissThreadId = selectedThread?.id;
    if (dismissThreadId) {
      (async () => {
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');
          await fetch(`${apiBase}/api/support/threads/${dismissThreadId}/dismiss`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
          });
        } catch (err) { console.error('dismiss error:', err); }
      })();
    }
    setSelectedThread(null);
    setThreadComments([]);
    setThreadImageUrls({});
    setThreadImages([]);
    fetchSupportThreads();
  };

  // MARKER_UPLOADGEN_THREAD_DETAIL_ESC_BACK_V1
  // ── กด Esc ใน Thread Detail = เท่ากับกดปุ่ม ← (Back) กลับไปหน้า List ──────────
  // ── เช็ค lightboxImageUrl ก่อนเสมอ -- ถ้า Lightbox (ดูรูปขยาย) เปิดซ้อนอยู่ ──
  // ── ให้ Handler ของ Lightbox จัดการปิดตัวเองก่อน ไม่ Back ออกไปทั้ง Thread ──────
  useEffect(() => {
    if (!selectedThread) return;
    const fn = e => {
      if (e.key !== 'Escape') return;
      if (lightboxImageUrl) return;
      closeThreadDetail();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [selectedThread, lightboxImageUrl]);

  // ── Thread Detail: ส่ง Comment (ข้อความ + รูปแนบถ้ามี) แล้ว Reload Comment/รูป ──
  const handlePostComment = async () => {
    if (!newCommentText.trim() && newCommentAttachments.length === 0) return;
    setPostingComment(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');

      // MARKER_SUPPORT_FIX_IMAGE_ONLY_REPLY_V1
      // ── สร้าง Comment เสมอ (แม้ข้อความว่าง — ตอบด้วยรูปอย่างเดียว) เพื่อให้มี ID ผูกกับรูปเสมอ ──
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: newCommentText.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { alert('ส่งข้อความไม่สำเร็จ: ' + (data.error || '')); setPostingComment(false); return; }
      const newCommentId = data.comment && data.comment.id;

      // ── รูปแนบผูกกับ Comment นี้โดยตรง (subRefId) เสมอ ──
      for (const att of newCommentAttachments) {
        const base64 = att.data.split(',')[1];
        await fetch(`${apiBase}/api/file-storage/upload-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ module: 'support-feedback', refId: selectedThread.id, subRefId: newCommentId, fileBase64: base64 }),
        });
      }

      setNewCommentText('');
      setNewCommentAttachments([]);

      const res2 = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data2 = await res2.json();
      if (data2.ok) {
        setThreadComments(data2.comments || []);
        loadThreadImages(data2.images || []);
      }
    } catch (err) { alert('ส่งข้อความไม่สำเร็จ: ' + err.message); }
    setPostingComment(false);
  };

  // ── Thread Detail: Owner กด Finish -> Resolve ──
  // MARKER_SUPPORT_FINISH_AUTO_COMMENT_V1
  const handleRejectThread = () => {
    setConfirmDialog({
      message: 'ยืนยัน Reject กระทู้นี้?',
      onConfirm: async () => {
        setConfirmDialog(null);
        setRejectingThread(true);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');

          if (newCommentText.trim()) {
            await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ message: newCommentText.trim() }),
            });
          }

          await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: 'คำขอนี้ถูกปฏิเสธ' }),
          });

          const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/reject`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (!data.ok) { alert('Reject กระทู้ไม่สำเร็จ: ' + (data.error || '')); setRejectingThread(false); return; }

          setNewCommentText('');
          setSelectedThread(prev => (prev ? { ...prev, status: 'resolved', resolution_type: 'rejected' } : prev));

          const res2 = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}`, { headers: { Authorization: `Bearer ${token}` } });
          const data2 = await res2.json();
          if (data2.ok) {
            setThreadComments(data2.comments || []);
            loadThreadImages(data2.images || []);
          }
        } catch (err) { alert('Reject กระทู้ไม่สำเร็จ: ' + err.message); }
        setRejectingThread(false);
      },
    });
  };

  // MARKER_UPLOADGEN_ACCEPT_BUTTON_V1
  const [acceptingThread, setAcceptingThread] = useState(false);
  const handleAcceptThread = async () => {
    if (!selectedThread) return;
    setAcceptingThread(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/start-process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.ok) { alert('Accept ไม่สำเร็จ: ' + (data.error || '')); setAcceptingThread(false); return; }
      // MARKER_UPLOADGEN_ACCEPT_SYNC_V1 -- Broadcast ให้ Bell/Home Sync ทันที
      broadcastWs('support_thread_status_updated', { threadId: selectedThread.id });
      setSelectedThread(prev => (prev ? { ...prev, status: 'in_process' } : prev));
      fetchSupportThreads();
    } catch (err) { alert('Accept ไม่สำเร็จ: ' + err.message); }
    setAcceptingThread(false);
  };

  const handleFinishThread = () => {
    setConfirmDialog({
      message: 'ยืนยันปิดกระทู้นี้เป็น Resolve?',
      onConfirm: async () => {
        setConfirmDialog(null);
        setFinishingThread(true);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');

          // ── ถ้ามีข้อความพิมพ์ค้างไว้ในช่องตอบกลับ (ยังไม่ได้กด "ส่ง") -> ส่งเป็น Comment ก่อน ──
          // ── เผื่อกระทู้ถูกเปิดมาแบบเข้าใจผิด/มีบริบทเพิ่มเติมที่ Owner อยากอธิบายก่อนปิด ──
          if (newCommentText.trim()) {
            await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ message: newCommentText.trim() }),
            });
          }

          // ── Auto Comment ปิดงานเสมอ ──
          await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: 'ดำเนินการเรียบร้อยแล้ว' }),
          });

          const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (!data.ok) { alert('ปิดกระทู้ไม่สำเร็จ: ' + (data.error || '')); setFinishingThread(false); return; }

          setNewCommentText('');
          setSelectedThread(prev => (prev ? { ...prev, status: 'resolved' } : prev));

          // ── Reload Comment ให้เห็น Comment ที่เพิ่ง Auto ส่งไปด้วย ──
          const res2 = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}`, { headers: { Authorization: `Bearer ${token}` } });
          const data2 = await res2.json();
          if (data2.ok) {
            setThreadComments(data2.comments || []);
            loadThreadImages(data2.images || []);
          }
        } catch (err) { alert('ปิดกระทู้ไม่สำเร็จ: ' + err.message); }
        setFinishingThread(false);
      },
    });
  };

  // MARKER_UPLOADGEN_TESTING_FLOW_V1
  const [sendingToTest, setSendingToTest] = useState(false);
  const [confirmingResolve, setConfirmingResolve] = useState(false);
  const [rejectingTest, setRejectingTest] = useState(false);
  const [showRejectTestModal, setShowRejectTestModal] = useState(false);
  const [rejectTestReasonInput, setRejectTestReasonInput] = useState('');
  // MARKER_UPLOADGEN_SHARE_TESTING_V1
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCandidates, setShareCandidates] = useState([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [selectedShareUsernames, setSelectedShareUsernames] = useState([]);
  const [sharingThread, setSharingThread] = useState(false);

  // ── ตัวเลือกเสริม: ส่งให้ผู้แจ้งกระทู้ Test ก่อน (ไม่บังคับ Owner ยัง Resolve ตรงได้เสมอ) ──
  const handleSendToTest = () => {
    setConfirmDialog({
      message: 'ส่งกระทู้นี้ให้ผู้แจ้งไป Test ก่อนใช่ไหม?',
      onConfirm: async () => {
        setConfirmDialog(null);
        setSendingToTest(true);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');
          const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/send-to-test`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (!data.ok) { alert('ส่งให้ Test ไม่สำเร็จ: ' + (data.error || '')); setSendingToTest(false); return; }
          setSelectedThread(prev => (prev ? { ...prev, status: 'testing' } : prev));
          fetchSupportThreads();
        } catch (err) { alert('ส่งให้ Test ไม่สำเร็จ: ' + err.message); }
        setSendingToTest(false);
      },
    });
  };

  // ── ผู้แจ้งกระทู้ Confirm ว่า Test ผ่าน -> Resolve ทันที ──
  const handleConfirmResolve = () => {
    setConfirmDialog({
      message: 'ยืนยันว่างานเสร็จสมบูรณ์ ปิดกระทู้นี้เลยใช่ไหม?',
      onConfirm: async () => {
        setConfirmDialog(null);
        setConfirmingResolve(true);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');
          const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/request-resolve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (!data.ok) { alert('Resolve ไม่สำเร็จ: ' + (data.error || '')); setConfirmingResolve(false); return; }
          setSelectedThread(prev => (prev ? { ...prev, status: 'resolved' } : prev));
          fetchSupportThreads();
        } catch (err) { alert('Resolve ไม่สำเร็จ: ' + err.message); }
        setConfirmingResolve(false);
      },
    });
  };

  const handleOpenRejectTestModal = () => { setRejectTestReasonInput(''); setShowRejectTestModal(true); };
  const handleConfirmRejectTest = async () => {
    if (!rejectTestReasonInput.trim()) { alert('กรุณากรอกเหตุผลก่อนตีกลับ'); return; }
    setRejectingTest(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/reject-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: rejectTestReasonInput.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { alert('ตีกลับไม่สำเร็จ: ' + (data.error || '')); setRejectingTest(false); return; }
      setSelectedThread(prev => (prev ? { ...prev, status: 'in_process' } : prev));
      setShowRejectTestModal(false);
      fetchSupportThreads();
      const res2 = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data2 = await res2.json();
      if (data2.ok) setThreadComments(data2.comments || []);
    } catch (err) { alert('ตีกลับไม่สำเร็จ: ' + err.message); }
    setRejectingTest(false);
  };

  // MARKER_UPLOADGEN_SHARE_TESTING_V1
  // ── Share กระทู้ Testing ให้ User อื่นช่วย Test (เจ้าของกระทู้ หรือ Owner เท่านั้น, เฉพาะ Status testing) ──
  const handleOpenShareModal = async () => {
    setSelectedShareUsernames([]);
    setShowShareModal(true);
    setShareCandidatesLoading(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/share-candidates`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setShareCandidates(data.ok ? (data.candidates || []) : []);
      if (!data.ok) alert('โหลดรายชื่อไม่สำเร็จ: ' + (data.error || ''));
    } catch (err) { alert('โหลดรายชื่อไม่สำเร็จ: ' + err.message); }
    setShareCandidatesLoading(false);
  };

  const toggleShareUsername = (uname) => {
    setSelectedShareUsernames(prev => prev.includes(uname) ? prev.filter(u => u !== uname) : [...prev, uname]);
  };

  const handleConfirmShare = async () => {
    if (selectedShareUsernames.length === 0) { alert('กรุณาเลือกอย่างน้อย 1 คน'); return; }
    setSharingThread(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usernames: selectedShareUsernames }),
      });
      const data = await res.json();
      if (!data.ok) { alert('Share ไม่สำเร็จ: ' + (data.error || '')); setSharingThread(false); return; }
      setShowShareModal(false);
      const res2 = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data2 = await res2.json();
      if (data2.ok) setThreadComments(data2.comments || []);
    } catch (err) { alert('Share ไม่สำเร็จ: ' + err.message); }
    setSharingThread(false);
  };

  // ── Thread Detail: Owner กด Hold (บังคับกรอกเหตุผล) / ปลด Hold (Manual) ──
  const handleOpenHoldModal = () => { setHoldReasonInput(''); setShowHoldModal(true); };

  // MARKER_UPLOADGEN_AGREEMENT_SYSTEM_V1
  // ── Agree: จบเลย ไม่มีผลอื่น กลับไป List ──
  const handleAgreeThread = async () => {
    if (!selectedThread) return;
    setAgreeingThread(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/agree`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.ok) { alert('Agree ไม่สำเร็จ: ' + (data.error || '')); setAgreeingThread(false); return; }
      // MARKER_UPLOADGEN_AGREEMENT_SYNC_V1 -- Broadcast ให้ Bell/Home Sync ทันที
      broadcastWs('support_agreement_updated', { threadId: selectedThread.id });
      setSelectedThread(null);
      fetchSupportThreads();
    } catch (err) { alert('Agree ไม่สำเร็จ: ' + err.message); }
    setAgreeingThread(false);
  };

  // MARKER_UPLOADGEN_AGREEMENT_SYNC_V1
  // ── Disagree: แค่เปิดฟอร์มตั้งกระทู้ใหม่เปล่า พร้อม Prefill Ref -- ไม่ Commit ที่ Backend
  // ── จนกว่าจะ Submit กระทู้ใหม่จริง (เก็บ id กระทู้เดิมไว้ใน pendingRefThreadId ก่อนเฉยๆ) ──
  // ── ใช้ข้อมูลจาก selectedThread ตรงๆ ไม่ต้องยิง API /disagree อีกต่อไป ──────────────────
  const handleDisagreeThread = () => {
    if (!selectedThread) return;
    setNewThreadRefLogNumber(selectedThread.log_number || '');
    setNewThreadRefTitle(selectedThread.title || '');
    if (selectedThread.menu_source) setNewThreadMenuSource(selectedThread.menu_source);
    setPendingRefThreadId(selectedThread.id);
    setSelectedThread(null);
    setShowNewThreadForm(true);
  };

  const isAgreementWindowOpen = (thread) => {
    if (!thread || !thread.resolved_at) return false;
    const hoursSince = (Date.now() - new Date(thread.resolved_at).getTime()) / (1000 * 60 * 60);
    return hoursSince < 72; // 3 วัน
  };

  const handleConfirmHold = async () => {
    if (!holdReasonInput.trim()) { alert('กรุณากรอกเหตุผลก่อน Hold'); return; }
    setHoldingThread(true);
    try {
      const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: holdReasonInput.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { alert('Hold กระทู้ไม่สำเร็จ: ' + (data.error || '')); setHoldingThread(false); return; }
      setSelectedThread(prev => (prev ? { ...prev, on_hold: true, hold_reason: holdReasonInput.trim() } : prev));
      setShowHoldModal(false);
    } catch (err) { alert('Hold กระทู้ไม่สำเร็จ: ' + err.message); }
    setHoldingThread(false);
  };

  const handleUnholdThread = () => {
    setConfirmDialog({
      message: 'ยืนยันปลด Hold กระทู้นี้?',
      onConfirm: async () => {
        setConfirmDialog(null);
        setUnholdingThread(true);
        try {
          const apiBase = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
          const token = sessionStorage.getItem('fastapn_token');
          const res = await fetch(`${apiBase}/api/support/threads/${selectedThread.id}/unhold`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (!data.ok) { alert('ปลด Hold ไม่สำเร็จ: ' + (data.error || '')); setUnholdingThread(false); return; }
          setSelectedThread(prev => (prev ? { ...prev, on_hold: false, hold_reason: null } : prev));
        } catch (err) { alert('ปลด Hold ไม่สำเร็จ: ' + err.message); }
        setUnholdingThread(false);
      },
    });
  };

  // ── Track active session + Auto start/stop OCR service ───────────────
  useEffect(() => {
    if (!userName && !currentUser?.email) return;
    const user = userName || currentUser?.email || '';
    const sessionId = `doc-center-${user}-${Date.now()}`;
    const token = sessionStorage.getItem('fastapn_token');

    const heartbeat = async () => {
      // 1. upsert session
      await db.from('menu_active_sessions').upsert({
        session_id: sessionId,
        menu_id: 'document-center',
        user_name: user,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'session_id' });
      // 2. trigger auto start/stop OCR service
      fetch('/api/docenter/ocr-service/auto', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };

    heartbeat();
    const interval = setInterval(heartbeat, 30000);

    return () => {
      clearInterval(interval);
      db.from('menu_active_sessions').delete().eq('session_id', sessionId);
      // stop service ถ้าไม่มี user เหลือ
      fetch('/api/docenter/ocr-service/auto', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };
  }, [userName, currentUser]);

  useEffect(() => {
    const unsubscribe = subscribeWs(['doc_access_updated', 'user_permissions_updated'], () => fetchData());
    return unsubscribe;
  }, [fetchData]);

  const canAccess = (folder) => {
    if (isOwner) return true;
    const docAccessVal = userPermissions?.docAccess?.[folder.key];
    if (docAccessVal !== undefined) return docAccessVal;
    return userRoleData?.permissions?.[folder.permKey] ?? false;
  };

  const getRequestStatus = (folderKey) => {
    const req = requests.find(r => r.folder_key === folderKey && r.status === 'pending');
    return req ? 'pending' : null;
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRequestAccess = async (folder) => {
    if (!userRoleData?.id) return;
    setRequesting(prev => ({ ...prev, [folder.key]: true }));
    try {
      const existing = requests.find(r => r.folder_key === folder.key && r.status === 'pending');
      if (existing) { showToast('ส่ง request ไปแล้วครับ รออนุมัติอยู่', 'info'); return; }
      const { error } = await db.from('access_requests').insert([{
        requester_id: userRoleData.id,
        requester_name: userName || currentUser?.email || '',
        folder_key: folder.key,
        status: 'pending',
        created_at: new Date().toISOString(),
      }]);
      if (error) throw error;
      setRequests(prev => [...prev, { folder_key: folder.key, status: 'pending' }]);
      showToast(`ส่งคำขอ "${folder.label}" แล้วครับ รออนุมัติจาก Owner/Admin`);
    } catch (err) { showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'); }
    setRequesting(prev => ({ ...prev, [folder.key]: false }));
  };

  // MARKER_DOCUMENTCENTER_COMING_SOON_V1
  // ── เฉพาะ AP Manual (folder.key==='ap') ที่มี Feature จริง — Module อื่นยังไม่เคยถูกสร้าง ──
  // ── ไม่เกี่ยวกับ Permission (canAccess) เลย — แค่ตัดสินว่า "เข้าไปแล้วเจออะไร" ──
  if (activeFolder && activeFolder.key !== 'ap') {
    return (
      <div style={{ display:'flex',flexDirection:'column',flex:1,height:'100%',overflow:'hidden',position:'relative' }}>
        <div style={{ display:'flex',alignItems:'center',gap:'12px',padding:'16px 20px',borderBottom:'0.5px solid #eee' }}>
          <button onClick={()=>{ setActiveFolder(null); fetchData(); }} style={{ width:'32px',height:'32px',borderRadius:'50%',background:'#f5f5f5',border:'none',cursor:'pointer',fontSize:'16px',color:'#555',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }}>←</button>
          <div>
            <p style={{ fontSize:'15px',fontWeight:'500',margin:0,color:'#1a3a5c' }}>{activeFolder.label}</p>
            <p style={{ fontSize:'12px',color:'#999',margin:'2px 0 0' }}>Document Center</p>
          </div>
        </div>
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'64px 20px',gap:'12px',flex:1 }}>
          <div style={{ fontSize:'32px' }}>🛠️</div>
          <p style={{ fontSize:'15px',fontWeight:'500',margin:0,color:'#1a3a5c' }}>Module นี้ยังไม่เปิดใช้งาน</p>
          <p style={{ fontSize:'13px',color:'#666',margin:0,textAlign:'center',maxWidth:'320px' }}>{activeFolder.label} ยังอยู่ระหว่างออกแบบ จะเปิดให้ใช้งานในเฟสถัดไป</p>
        </div>
      </div>
    );
  }

  if (activeFolder) {
    return (
      <div style={{ display:'flex',flexDirection:'column',flex:1,height:'100%',overflow:'hidden',position:'relative' }}>
        <FolderDetail
          folder={activeFolder}
          onBack={() => { setActiveFolder(null); fetchData(); }}
          userName={userName}
          currentUser={currentUser}
          canDelete={true}
          isOwner={isOwner}
          isAdmin={isAdmin}
          isEditor={isEditor}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding:'20px' }}>
        <h2 style={{ fontSize:'16px', fontWeight:'600', marginBottom:'16px' }}>📁 Document Center</h2>
        <div style={{ color:'#888', fontSize:'13px' }}>กำลังโหลด...</div>
      </div>
    );
  }

  const accessibleCount = DOC_FOLDERS.filter(f => canAccess(f)).length;

  return (
    <div style={{ padding:'20px', position:'relative' }}>
      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'10px 16px', borderRadius:'8px', fontSize:'13px', fontWeight:'500', background: toast.type==='error'?'#FCEBEB':toast.type==='info'?'#e8f0fb':'#EAF3DE', color: toast.type==='error'?'#791F1F':toast.type==='info'?'#1a3a5c':'#27500A', border:`0.5px solid ${toast.type==='error'?'#f7c1c1':toast.type==='info'?'#b5d4f4':'#97C459'}`, boxShadow:'0 4px 12px rgba(0,0,0,0.1)' }}>{toast.msg}</div>
      )}

      {detailFolder && !detailViewFile && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.35)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
          <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #e0e0e0',width:'600px',height:'520px',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{padding:'10px 12px',borderBottom:'0.5px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
              <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'20px',fontWeight:'500',background:detailFolder.color,color:detailFolder.textColor,whiteSpace:'nowrap'}}>{detailFolder.label}</span>
              <div style={{flex:1,display:'flex',alignItems:'center',gap:'5px',background:'#f5f7f9',border:'0.5px solid #e0e0e0',borderRadius:'6px',padding:'5px 9px'}}>
                <span style={{fontSize:'13px',color:'#aaa'}}>&#128269;</span>
                <input autoFocus value={detailSearch} onChange={e=>setDetailSearch(e.target.value)} placeholder="Serial, Invoice, BU, Batch..." style={{flex:1,border:'none',background:'none',fontSize:'12px',outline:'none',color:'#333'}}/>
                {detailSearch&&<span onClick={()=>setDetailSearch('')} style={{fontSize:'12px',color:'#aaa',cursor:'pointer'}}>&#x2715;</span>}
              </div>
              {(()=>{
                const bus=[...new Set((folderBatches[detailFolder.key]||[]).map(b=>b.bu_code).filter(Boolean))].sort();
                return bus.length>0&&(
                  <select value={((detailFolder.docTypes||[]).includes(detailBU))?'':detailBU} onChange={e=>setDetailBU(e.target.value)}
                    style={{fontSize:'11px',padding:'4px 8px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',color:'#555',cursor:'pointer',outline:'none',flexShrink:0}}>
                    <option value="">BU</option>
                    {bus.map(b=><option key={b} value={b}>{b}</option>)}
                  </select>
                );
              })()}
              <button onClick={()=>setDetailFolder(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#aaa',padding:0}}>&#x2715;</button>
            </div>
            {(()=>{
              const draftTypes = [...new Set((folderDrafts[detailFolder.key]||[]).map(b=>b.doc_type))].sort();
              const batchTypes = detailFolder.docTypes||[];
              const tabs = [
                {v:'batch', label:'ทั้งหมด', count:(folderBatches[detailFolder.key]||[]).filter(r=>r.doc_type!=='AP09').length, color:'#1a3a5c'},
                ...batchTypes.map(t=>({v:'batch_'+t, label:t, count:(folderBatches[detailFolder.key]||[]).filter(r=>r.doc_type===t).length, color:'#1a3a5c'})),
                ...draftTypes.map(t=>({v:'draft_'+t, label:t+' - Draft', count:(folderDrafts[detailFolder.key]||[]).filter(r=>r.doc_type===t).length, color:'#856404'})),
              ];
              const isDraft = detailMode.startsWith('draft_');
              const modeType = detailMode.replace(/^(batch_|draft_)/,'');
              const pool = isDraft ? (folderDrafts[detailFolder.key]||[]) : (folderBatches[detailFolder.key]||[]);
              const s = detailSearch.toLowerCase();
              const items = pool.filter(b=>{
                const matchS=!s||(b.serial_code||'').toLowerCase().includes(s)||(b.bu_code||'').toLowerCase().includes(s)||(b.uploaded_by||'').toLowerCase().includes(s);
                const matchT = detailMode==='batch' ? true : b.doc_type===modeType;
                const matchBU = !detailBU || b.bu_code===detailBU;
                return matchS&&matchT&&matchBU;
              });
              return (<>
                <div style={{display:'flex',alignItems:'center',gap:'4px',padding:'7px 12px',borderBottom:'0.5px solid #f0f0f0',flexShrink:0,flexWrap:'wrap'}}>
                  {tabs.map(tab=>(
                    <button key={tab.v} onClick={()=>setDetailMode(tab.v)}
                      style={{fontSize:'10px',padding:'2px 8px',borderRadius:'20px',
                        border:`0.5px solid ${detailMode===tab.v?tab.color:'#ddd'}`,
                        background:detailMode===tab.v?tab.color:'white',
                        color:detailMode===tab.v?'white':tab.color,
                        cursor:'pointer',fontWeight:detailMode===tab.v?'600':'400',whiteSpace:'nowrap'}}>
                      {tab.label} <span style={{opacity:0.75}}>{tab.count}</span>
                    </button>
                  ))}
                </div>
                <div style={{flex:1,overflowY:'auto'}}>
                  {!items.length
                    ? <div style={{padding:'40px',textAlign:'center',fontSize:'12px',color:'#aaa'}}>ไม่พบข้อมูล</div>
                    : items.map((b,i)=>(
                      <div key={(b.serial_code||'')+i} style={{padding:'8px 12px',display:'flex',alignItems:'center',gap:'8px',borderBottom:'0.5px solid #f5f5f5',background:isDraft?'#FFFDF5':'white'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:'11px',fontFamily:'monospace',color:isDraft?'#856404':'#0C447C',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.serial_code}</div>
                          <div style={{fontSize:'10px',color:'#888',marginTop:'1px'}}>{b.bu_code||''}{b.uploaded_by?' · '+b.uploaded_by.split('@')[0]:''}</div>
                        </div>
                        <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',fontWeight:'500',
                          background:isDraft?'#FFF3CD':b.doc_type==='AP09'?'#EAF3DE':'#E6F1FB',
                          color:isDraft?'#856404':b.doc_type==='AP09'?'#27500A':'#0C447C',flexShrink:0}}>
                          {b.doc_type}{isDraft?' Draft':''}
                        </span>
                        <span style={{fontSize:'10px',color:'#aaa',whiteSpace:'nowrap',flexShrink:0}}>{b.created_at?new Date(b.created_at).toLocaleDateString('th-TH',{day:'2-digit',month:'short'}):'—'}</span>
                        <button title="ดู" onClick={async(e)=>{ e.stopPropagation(); try { const { data } = await db.from('doc_collection').select('*').eq('serial_code', b.serial_code).eq('doc_type', b.doc_type).maybeSingle(); if (data) setDetailViewFile(data); } catch(err) { console.error('load view detail error:', err); } }}
                          style={{width:'22px',height:'22px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'11px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>👁</button>
                      </div>
                    ))
                  }
                </div>
                <div style={{padding:'7px 12px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <span style={{fontSize:'10px',color:'#aaa'}}>{items.length} รายการ{isDraft?' (Draft — ดูได้อย่างเดียว)':''}</span>
                  <button onClick={()=>setDetailFolder(null)} style={{fontSize:'10px',padding:'2px 8px',borderRadius:'5px',border:'0.5px solid #ddd',background:'none',color:'#555',cursor:'pointer'}}>ปิด</button>
                </div>
              </>);
            })()}
          </div>
        </div>
      )}
      {detailViewFile && <DocDetailModal file={detailViewFile} onClose={()=>setDetailViewFile(null)} searchQuery={detailSearch}/>}
      <div style={{ display:'flex', gap:'4px', borderBottom:'1px solid #eee', marginBottom:'16px' }}>
        <button onClick={()=>setActiveTab('folders')} style={{ padding:'8px 4px', marginRight:'20px', fontSize:'14px', fontWeight: activeTab==='folders'?'600':'400', color: activeTab==='folders'?'#1a3a5c':'#888', background:'none', border:'none', borderBottom: activeTab==='folders'?'2px solid #1a3a5c':'2px solid transparent', cursor:'pointer' }}>Document Center</button>
        <button onClick={()=>setActiveTab('setup')} style={{ padding:'8px 4px', fontSize:'14px', fontWeight: activeTab==='setup'?'600':'400', color: activeTab==='setup'?'#1a3a5c':'#888', background:'none', border:'none', borderBottom: activeTab==='setup'?'2px solid #1a3a5c':'2px solid transparent', cursor:'pointer' }}>Setup - Tools</button>
        <button onClick={()=>setActiveTab('support')} style={{ padding:'8px 4px', marginLeft:'20px', fontSize:'14px', fontWeight: activeTab==='support'?'600':'400', color: activeTab==='support'?'#1a3a5c':'#888', background:'none', border:'none', borderBottom: activeTab==='support'?'2px solid #1a3a5c':'2px solid transparent', cursor:'pointer' }}>Support & Feedback</button>
      </div>

      {activeTab==='folders' && (
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {DOC_FOLDERS.map(folder => {
          const accessible = canAccess(folder);
          const count = fileCounts[folder.key] ?? 0;
          const reqStatus = getRequestStatus(folder.key);
          const isRequesting = requesting[folder.key];

          return (
            <div key={folder.key}
              onClick={() => accessible && setActiveFolder(folder)}
              style={{ background:'white', border:`0.5px solid ${accessible?'#e8e8e8':'#f0f0f0'}`, borderRadius:'8px', padding:'12px 16px', display:'flex', alignItems:'center', gap:'14px', cursor: accessible?'pointer':'default', opacity: accessible?1:0.6, transition:'border-color 0.15s' }}
              onMouseEnter={e => { if (accessible) e.currentTarget.style.borderColor='#1a3a5c'; }}
              onMouseLeave={e => { if (accessible) e.currentTarget.style.borderColor=accessible?'#e8e8e8':'#f0f0f0'; }}>

              <div style={{ width:'42px', height:'42px', borderRadius:'8px', background:accessible?folder.color:'#f5f5f5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', flexShrink:0 }}>
                {accessible ? folder.icon : '🔒'}
              </div>

              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:'14px', fontWeight:'500', color:accessible?'#1a3a5c':'#999', marginBottom:'2px', display:'flex', alignItems:'center', gap:'8px' }}>
                  {folder.label}
                  {!accessible && reqStatus === 'pending' && (
                    <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'20px', background:'#FFF3CD', color:'#856404', fontWeight:'500' }}>⏳ รออนุมัติ</span>
                  )}
                </div>
                <div style={{ fontSize:'11px', color:'#888' }}>{folder.desc}</div>
              </div>

              <span style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', background:accessible?folder.color:'#f5f5f5', color:accessible?folder.textColor:'#aaa', display:'flex', alignItems:'center', gap:'4px', flexShrink:0, whiteSpace:'nowrap' }}>
                📄 {folderBatches[folder.key]!==undefined ? folderBatches[folder.key].filter(r=>r.doc_type!=='AP09').length : count} batch
                {folderDrafts[folder.key]?.length>0 && <span style={{marginLeft:'4px',padding:'1px 5px',borderRadius:'3px',background:'#FFF9E6',color:'#856404',fontSize:'10px',fontWeight:'600'}}>· {folderDrafts[folder.key].length} draft</span>}
              </span>
              {folder.docTypes && (
                <button onClick={e=>{ e.stopPropagation(); setDetailFolder(folder); setDetailSearch(''); setDetailBU(''); setDetailMode('batch'); }}
                  style={{ fontSize:'11px',padding:'3px 10px',borderRadius:'6px',border:'0.5px solid #d0d0d0',background:'white',color:'#555',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap' }}>
                  Detail
                </button>
              )}
              <span style={{ fontSize:'11px', color:'#aaa', flexShrink:0, minWidth:'80px', textAlign:'right' }}>—</span>

              {accessible ? (
                <span style={{ fontSize:'16px', color:'#aaa', flexShrink:0 }}>›</span>
              ) : (
                <>
                  {reqStatus === 'pending' ? (
                    <button disabled style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #FFF3CD', background:'#FFF9E6', color:'#856404', cursor:'default', flexShrink:0 }}>⏳ รออนุมัติ</button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); handleRequestAccess(folder); }} disabled={isRequesting}
                      style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #b5d4f4', background:'#E6F1FB', color:'#0C447C', cursor:'pointer', flexShrink:0, fontWeight:'500', opacity:isRequesting?0.6:1 }}>
                      {isRequesting ? 'กำลังส่ง...' : '🔑 ขอสิทธิ์'}
                    </button>
                  )}
                  <span style={{ fontSize:'16px', color:'#ddd', flexShrink:0 }}>🔒</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      )}

      {activeTab==='setup' && (
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        <div style={{ background:'white', border:'0.5px solid #e8e8e8', borderRadius:'8px', padding:'12px 16px', display:'flex', alignItems:'center', gap:'14px' }}>
          {returnPage && (
            <button onClick={onBackToCaller} title="กลับไปหน้าที่มา" style={{ width:'28px', height:'28px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#1a3a5c', cursor:'pointer', fontSize:'14px', flexShrink:0 }}>←</button>
          )}
          <div style={{ width:'42px', height:'42px', borderRadius:'8px', background:'#E6F1FB', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', flexShrink:0 }}>📧</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:'14px', fontWeight:'500', color:'#1a3a5c', marginBottom:'2px' }}>Outlook Handler</div>
            <div style={{ fontSize:'11px', color:'#888' }}>เครื่องมือเปิด Outlook Draft อัตโนมัติ ติดตั้งครั้งเดียวใช้ได้ทุกเมนู</div>
          </div>
          <button onClick={()=>downloadOutlookHandler(true)} style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#1a3a5c', cursor:'pointer', flexShrink:0 }}>⬇ Download</button>
          <button onClick={()=>downloadOutlookHandler(false)} style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer', flexShrink:0 }}>↻ Update</button>
          <button onClick={()=>setShowHandlerDetail(true)} style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer', flexShrink:0 }}>Detail</button>
        </div>
        {Array.from({length:9}).map((_,i) => (
          <div key={'setup-placeholder-'+i} style={{ background:'white', border:'0.5px dashed #ddd', borderRadius:'8px', padding:'12px 16px', display:'flex', alignItems:'center', gap:'14px', opacity:0.5 }}>
            <div style={{ width:'42px', height:'42px', borderRadius:'8px', background:'#f5f5f5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', flexShrink:0 }}>🧩</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:'14px', fontWeight:'500', color:'#aaa', marginBottom:'2px' }}>เครื่องมือใหม่ {i+2}</div>
              <div style={{ fontSize:'11px', color:'#bbb' }}>Coming soon</div>
            </div>
          </div>
        ))}
      </div>
      )}

      {activeTab==='support' && selectedThread && (
      // MARKER_SUPPORT_THREAD_REDESIGN_V1
      // MARKER_SUPPORT_CHAT_HEIGHT_ENTER_SEND_V1
      // MARKER_SUPPORT_THREAD_HEIGHT_90VH_V1
      <div style={{ display:'flex', flexDirection:'column', height:'90vh', background:'white', border:'0.5px solid #e8e8e8', borderRadius:'12px', overflow:'hidden' }}>
        {threadDetailLoading ? (
          <div style={{ textAlign:'center', padding:'40px', color:'#999', fontSize:'13px' }}>กำลังโหลด...</div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'16px 20px', borderBottom:'0.5px solid #eee' }}>
              <button onClick={closeThreadDetail} style={{ width:'32px', height:'32px', borderRadius:'50%', background:'#f5f5f5', border:'none', cursor:'pointer', fontSize:'16px', color:'#555', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>←</button>
              <div style={{ flex:1, minWidth:0 }}>
                {/* MARKER_SUPPORT_LOG_NUMBER_DISPLAY_V1 */}
                <div style={{ fontSize:'16px', fontWeight:'500', color:'#1a3a5c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selectedThread.title}</div>
                <div style={{ fontSize:'12px', color:'#999', marginTop:'3px' }}>
                  {selectedThread.log_number && <span style={{ fontFamily:'monospace', color:'#666', fontWeight:'500' }}>{selectedThread.log_number}</span>}
                  {selectedThread.log_number && ' · '}
                  {selectedThread.menu_source} · {selectedThread.created_by}
                </div>
              </div>
              {/* MARKER_UPLOADGEN_TESTING_BADGE_ROLE_V1 -- testing แยก Text ตาม Role + สีฟ้า */}
              <span style={{
                fontSize:'12px', padding:'5px 14px', borderRadius:'20px', flexShrink:0, fontWeight:'500',
                background: selectedThread.status==='new' ? '#FCEBEB' : selectedThread.status==='in_process' ? '#FAEEDA' : selectedThread.status==='testing' ? '#E3F2FD' : selectedThread.resolution_type==='rejected' ? '#F0F0F0' : '#EAF3DE',
                color: selectedThread.status==='new' ? '#791F1F' : selectedThread.status==='in_process' ? '#633806' : selectedThread.status==='testing' ? '#1565C0' : selectedThread.resolution_type==='rejected' ? '#666' : '#27500A',
              }}>
                {/* MARKER_UPLOADGEN_INPROCESS_LABEL_V1 */}
                {selectedThread.status==='new' ? 'ใหม่' : selectedThread.status==='in_process' ? 'In process' : selectedThread.status==='testing' ? (isOwner ? 'Wait to Resolve' : 'Request to Test') : selectedThread.resolution_type==='rejected' ? 'ถูกปฏิเสธ' : 'แก้ไขแล้ว'}
              </span>
              {/* MARKER_UPLOADGEN_EDIT_THREAD_BUTTON_V1 -- เฉพาะผู้แจ้งเอง + Status ยังเป็น New เท่านั้น */}
              {!isOwner && selectedThread.status === 'new' && selectedThread.created_by === (userName || currentUser?.email || '') && (
                <button onClick={() => handleOpenEditThread(selectedThread)}
                  style={{ fontSize:'13px', padding:'9px 18px', borderRadius:'20px', border:'0.5px solid #1a3a5c', background:'white', color:'#1a3a5c', cursor:'pointer', flexShrink:0, fontWeight:'500' }}>
                  แก้ไข
                </button>
              )}
              {/* MARKER_UPLOADGEN_ACCEPT_BUTTON_V1 -- โชว์เฉพาะ Status ใหม่ กดแล้วเปลี่ยนเป็นกำลังดำเนินการทันที */}
              {isOwner && selectedThread.status === 'new' && (
                <button onClick={handleAcceptThread} disabled={acceptingThread}
                  style={{ fontSize:'13px', padding:'9px 18px', borderRadius:'20px', border:'none', background:'#0C447C', color:'white', cursor:'pointer', opacity:acceptingThread?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  {acceptingThread ? '...' : 'Accept'}
                </button>
              )}
              {isOwner && selectedThread.status !== 'resolved' && (
                <button onClick={handleFinishThread} disabled={finishingThread}
                  style={{ fontSize:'13px', padding:'9px 18px', borderRadius:'20px', border:'none', background:'#27500A', color:'white', cursor:'pointer', opacity:finishingThread?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  {finishingThread ? '...' : 'Finish'}
                </button>
              )}
              {isOwner && selectedThread.status !== 'resolved' && (
                <button onClick={handleRejectThread} disabled={rejectingThread}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #d9534f', background:'white', color:'#d9534f', cursor:'pointer', opacity:rejectingThread?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  {rejectingThread ? '...' : 'Reject'}
                </button>
              )}
              {/* MARKER_UPLOADGEN_TESTING_FLOW_V1 -- ตัวเลือกเสริม ไม่บังคับ Owner ยัง Resolve ตรงได้เสมอ */}
              {isOwner && selectedThread.status === 'in_process' && (
                <button onClick={handleSendToTest} disabled={sendingToTest}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #0C447C', background:'white', color:'#0C447C', cursor:'pointer', opacity:sendingToTest?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  {sendingToTest ? '...' : 'ส่งให้ Test'}
                </button>
              )}
              {/* MARKER_UPLOADGEN_SHARE_TESTING_V1 -- Owner Share ให้คนอื่นช่วย Test ได้ตอน Status testing */}
              {isOwner && selectedThread.status === 'testing' && (
                <button onClick={handleOpenShareModal}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #0C447C', background:'white', color:'#0C447C', cursor:'pointer', flexShrink:0, fontWeight:'500' }}>
                  📤 Share
                </button>
              )}
              {/* ผู้แจ้งกระทู้เอง Test อยู่ -- Confirm Resolve ทันที / ไม่ผ่าน กลับไปแก้ต่อ (รวมคนที่ถูก Share เข้ามาด้วย) */}
              {!isOwner && selectedThread.status === 'testing' && (selectedThread.created_by === (userName || currentUser?.email || '') || selectedThread.isSharedWithMe) && (
                <>
                  <button onClick={handleConfirmResolve} disabled={confirmingResolve || rejectingTest}
                    style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'none', background:'#27500A', color:'white', cursor:'pointer', opacity:(confirmingResolve||rejectingTest)?0.6:1, flexShrink:0, fontWeight:'500' }}>
                    {confirmingResolve ? '...' : '✓ Confirm - งานเสร็จสมบูรณ์'}
                  </button>
                  <button onClick={handleOpenRejectTestModal} disabled={confirmingResolve || rejectingTest}
                    style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #d9534f', background:'white', color:'#d9534f', cursor:'pointer', opacity:(confirmingResolve||rejectingTest)?0.6:1, flexShrink:0, fontWeight:'500' }}>
                    ไม่ผ่าน กลับไปแก้ต่อ
                  </button>
                </>
              )}
              {/* MARKER_UPLOADGEN_SHARE_TESTING_V1 -- เจ้าของกระทู้เองก็ Share เพิ่มคนอื่นได้ระหว่าง Test */}
              {!isOwner && selectedThread.status === 'testing' && selectedThread.created_by === (userName || currentUser?.email || '') && (
                <button onClick={handleOpenShareModal}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #0C447C', background:'white', color:'#0C447C', cursor:'pointer', flexShrink:0, fontWeight:'500' }}>
                  📤 Share
                </button>
              )}
              {isOwner && selectedThread.status === 'in_process' && !selectedThread.on_hold && (
                <button onClick={handleOpenHoldModal} disabled={holdingThread}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #d0a020', background:'white', color:'#8a6d1a', cursor:'pointer', opacity:holdingThread?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  🔒 Hold
                </button>
              )}
              {isOwner && selectedThread.status === 'in_process' && selectedThread.on_hold && (
                <button onClick={handleUnholdThread} disabled={unholdingThread}
                  style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #999', background:'#f5f5f5', color:'#555', cursor:'pointer', opacity:unholdingThread?0.6:1, flexShrink:0, fontWeight:'500' }}>
                  {unholdingThread ? '...' : 'ปลด Hold'}
                </button>
              )}
              {/* MARKER_UPLOADGEN_AGREE_BUTTON_POSITION_V1 -- ปุ่มเล็กติดข้าง Badge (แทน Bar เต็มความกว้าง) */}
              {/* MARKER_UPLOADGEN_AGREEMENT_PERUSER_V1 -- เช็คคำตอบของตัวเอง ไม่เช็คระดับกระทู้ */}
              {!isOwner && selectedThread.status === 'resolved' && !selectedThread.myAgreementResponse && isAgreementWindowOpen(selectedThread) && (
                <>
                  <button onClick={handleAgreeThread} disabled={agreeingThread || disagreeingThread}
                    style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'none', background:'#27500A', color:'white', cursor:'pointer', opacity:(agreeingThread||disagreeingThread)?0.6:1, flexShrink:0, fontWeight:'500' }}>
                    {agreeingThread ? '...' : '✓ Agree'}
                  </button>
                  <button onClick={handleDisagreeThread} disabled={agreeingThread || disagreeingThread}
                    style={{ fontSize:'13px', padding:'9px 14px', borderRadius:'20px', border:'0.5px solid #d9534f', background:'white', color:'#d9534f', cursor:'pointer', opacity:(agreeingThread||disagreeingThread)?0.6:1, flexShrink:0, fontWeight:'500' }}>
                    {disagreeingThread ? '...' : 'Disagree'}
                  </button>
                </>
              )}
            </div>
            {selectedThread.on_hold && (
              <div style={{ padding:'8px 20px', background:'#FFF8E1', borderBottom:'0.5px solid #eee', fontSize:'12px', color:'#8a6d1a' }}>
                🔒 Hold: {selectedThread.hold_reason || '-'}
              </div>
            )}
            {selectedThread.ref_log_number && (
              <div style={{ padding:'8px 20px', background:'#EEF4FB', borderBottom:'0.5px solid #eee', fontSize:'12px', color:'#0C447C' }}>
                🔗 อ้างอิงจาก: <span style={{ fontFamily:'monospace', fontWeight:'600' }}>{selectedThread.ref_log_number}</span>
              </div>
            )}
            {/* MARKER_UPLOADGEN_AGREE_BUTTON_POSITION_V1 -- ย้ายปุ่มไปติด Badge ในหัวแล้ว ลบ Bar เต็มความกว้างออก */}

            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:'20px', padding:'24px 20px', background:'#fafbfc' }}>
              {(() => {
                const postImages = threadImages.filter(img => !img.sub_ref_id);
                return (
                  <div style={{ display:'flex', gap:'10px', maxWidth:'75%' }}>
                    <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'#E6F1FB', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'500', color:'#0C447C', flexShrink:0 }}>
                      {(selectedThread.created_by||'?').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ minWidth:0 }}>
                      {/* MARKER_SUPPORT_THREAD_SHOW_TIME_V1 */}
                      <div style={{ fontSize:'12px', color:'#999', marginBottom:'5px' }}>{selectedThread.created_by} · {formatDateTime(selectedThread.created_at)}</div>
                      <div style={{ background:'white', border:'0.5px solid #e8e8e8', borderRadius:'16px', borderTopLeftRadius:'4px', padding:'12px 14px' }}>
                        <div style={{ fontSize:'13px', color:'#333', lineHeight:'1.6', whiteSpace:'pre-wrap', marginBottom: postImages.length>0 ? '10px' : '0' }}>{selectedThread.body}</div>
                        {postImages.length > 0 && (
                          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                            {postImages.map(img => (
                              <img key={img.id} src={threadImageUrls[img.id]} alt="แนบ" onClick={()=>setLightboxImageUrl(threadImageUrls[img.id])}
                                style={{ width:'110px', height:'78px', borderRadius:'10px', objectFit:'cover', border:'0.5px solid #ddd', cursor:'pointer' }}/>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {threadComments.map(c => {
                const isFromCreator = c.username === selectedThread.created_by;
                const commentImages = threadImages.filter(img => img.sub_ref_id === c.id);
                return (
                  <div key={c.id} style={{ display:'flex', gap:'10px', maxWidth:'75%', marginLeft: isFromCreator?'0':'auto', flexDirection: isFromCreator?'row':'row-reverse' }}>
                    <div style={{ width:'32px', height:'32px', borderRadius:'50%', background: isFromCreator?'#E6F1FB':'#27500A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'500', color: isFromCreator?'#0C447C':'white', flexShrink:0 }}>
                      {(c.username||'?').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:'12px', color:'#999', marginBottom:'5px', textAlign: isFromCreator?'left':'right' }}>{c.username}{!isFromCreator?' (Owner)':''} · {formatDateTime(c.created_at)}</div>
                      <div style={{
                        background: isFromCreator?'white':'#27500A', border: isFromCreator?'0.5px solid #e8e8e8':'none', borderRadius:'16px', padding:'12px 14px',
                        borderTopLeftRadius: isFromCreator?'4px':'16px', borderTopRightRadius: isFromCreator?'16px':'4px',
                      }}>
                        <div style={{ fontSize:'13px', color: isFromCreator?'#333':'white', lineHeight:'1.6', whiteSpace:'pre-wrap', marginBottom: commentImages.length>0 ? '8px' : '0' }}>{c.message}</div>
                        {commentImages.length > 0 && (
                          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                            {commentImages.map(img => (
                              <img key={img.id} src={threadImageUrls[img.id]} alt="แนบ" onClick={()=>setLightboxImageUrl(threadImageUrls[img.id])}
                                style={{ width:'100px', height:'70px', borderRadius:'10px', objectFit:'cover', border: isFromCreator?'0.5px solid #ddd':'0.5px solid rgba(255,255,255,0.4)', cursor:'pointer' }}/>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {threadComments.length === 0 && (
                <div style={{ fontSize:'12px', color:'#bbb', textAlign:'center', padding:'10px' }}>ยังไม่มีการตอบกลับ</div>
              )}
            </div>

            {selectedThread.status !== 'resolved' && (
              <div style={{ borderTop:'0.5px solid #eee', padding:'14px 20px', flexShrink:0, background:'white' }}>
                <div style={{ display:'flex', alignItems:'flex-end', gap:'8px' }}>
                  {/* MARKER_SUPPORT_REMOVE_ATTACH_BUTTON_V1 */}
                  {/* ── ตัดปุ่ม "แนบรูป" ออก เพราะ Paste (Ctrl+V) ครอบคลุมแล้ว — เหลือแค่ Thumbnail + ปุ่มลบเผื่อ Paste ผิด ── */}
                  {newCommentAttachments.length > 0 && (
                    <div style={{ display:'flex', gap:'6px', flexShrink:0 }}>
                      {newCommentAttachments.map((a,i)=>(
                        <div key={i} style={{ position:'relative', flexShrink:0 }}>
                          <img src={a.data} alt={a.name} style={{ width:'36px',height:'36px',borderRadius:'6px',objectFit:'cover',border:'0.5px solid #ddd' }}/>
                          <button onClick={()=>setNewCommentAttachments(prev=>prev.filter((_,j)=>j!==i))}
                            style={{ position:'absolute',top:'-5px',right:'-5px',width:'15px',height:'15px',borderRadius:'50%',border:'none',background:'#c0392b',color:'white',cursor:'pointer',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea value={newCommentText} onChange={e=>setNewCommentText(e.target.value)} onPaste={e=>handleImagePaste(e, newCommentAttachments, setNewCommentAttachments)}
                    onKeyDown={e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                    rows={1} placeholder="พิมพ์ข้อความตอบกลับ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่, Paste รูปได้เลย)"
                    style={{ flex:1, padding:'10px 16px', borderRadius:'20px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box', resize:'none' }}/>
                  <button onClick={handlePostComment} disabled={postingComment}
                    style={{ fontSize:'13px', padding:'10px 20px', borderRadius:'20px', border:'none', background:'#1a3a5c', color:'white', cursor:'pointer', opacity:postingComment?0.6:1, flexShrink:0, fontWeight:'500' }}>
                    {postingComment ? '...' : 'ส่ง'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {activeTab==='support' && !selectedThread && (
      <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px' }}>
          <div style={{ display:'flex', gap:'6px' }}>
            {/* MARKER_UPLOADGEN_BACKLOG_TAB_V1 -- Backlog โชว์เฉพาะ Owner เห็น */}
            {[['new','New'],['in_process','In process'],['resolved','Resolve'], ...(isOwner ? [['backlog','Backlog']] : [])].map(([key,label]) => (
              <button key={key} onClick={()=>setSupportStatusTab(key)}
                style={{ display:'flex', alignItems:'center', gap:'6px', padding:'7px 14px', borderRadius:'8px', border: supportStatusTab===key?'0.5px solid #1a3a5c':'0.5px solid #e0e0e0', background: supportStatusTab===key?'#f0f6ff':'white', fontSize:'13px', fontWeight: supportStatusTab===key?'600':'400', color: supportStatusTab===key?'#1a3a5c':'#666', cursor:'pointer' }}>
                {label}
                <span style={{ fontSize:'11px', color:'#999', background:'#f0f0f0', padding:'1px 6px', borderRadius:'10px' }}>{supportCounts[key]}</span>
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={()=>setShowExportReport(true)}
              style={{ display:'flex', alignItems:'center', gap:'6px', background:'white', color:'#555', border:'0.5px solid #d0d0d0', padding:'8px 14px', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
              📄 Export Report
            </button>
            {isOwner && (
              <button onClick={()=>setShowRecycleBin(true)}
                style={{ display:'flex', alignItems:'center', gap:'6px', background:'white', color:'#555', border:'0.5px solid #d0d0d0', padding:'8px 14px', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
                🗑️ Recycle Bin
              </button>
            )}
            <button onClick={()=>setShowNewThreadForm(true)}
              style={{ display:'flex', alignItems:'center', gap:'6px', background:'#1a3a5c', color:'white', border:'none', padding:'8px 14px', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
              + ตั้งกระทู้ใหม่
            </button>
          </div>
        </div>

        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <input value={supportSearchQuery} onChange={e=>setSupportSearchQuery(e.target.value)} placeholder="🔍 ค้นหาหัวข้อ, รายละเอียด, ผู้ตั้ง..."
            style={{ width:'280px', maxWidth:'100%', padding:'7px 12px', borderRadius:'8px', border:'0.5px solid #e0e0e0', fontSize:'13px', boxSizing:'border-box' }}/>
          <select value={supportMenuFilter} onChange={e=>setSupportMenuFilter(e.target.value)}
            style={{ padding:'7px 12px', borderRadius:'8px', border:'0.5px solid #e0e0e0', fontSize:'13px', color:'#555', background:'white', cursor:'pointer' }}>
            <option value="">ทุกเมนู</option>
            {MENU_SOURCE_OPTIONS.map(m => <option key={m} value={m}>{MENU_SOURCE_ICONS[m] || '🧩'} {m}</option>)}
          </select>
        </div>

        {supportLoading ? (
          <div style={{ textAlign:'center', padding:'40px', color:'#999', fontSize:'13px' }}>กำลังโหลด...</div>
        ) : filteredSupportThreads.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px', color:'#999', fontSize:'13px' }}>ยังไม่มีกระทู้ในสถานะนี้</div>
        ) : (
// MARKER_SUPPORT_LIST_INBOX_STYLE_V1
          <div style={{ display:'flex', flexDirection:'column', border:'0.5px solid #e8e8e8', borderRadius:'10px', overflow:'hidden' }}>
            {/* MARKER_SUPPORT_LIST_CREATOR_COLUMN_V1 */}
            <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 14px', background:'#f7f9fb', borderBottom:'0.5px solid #e8e8e8' }}>
              <div style={{ width:'26px', flexShrink:0 }}></div>
              <div style={{ flex:1, minWidth:0, fontSize:'11px', fontWeight:'600', color:'#888' }}>หัวข้อ / ข้อความล่าสุด</div>
              <div style={{ width:'90px', flexShrink:0, fontSize:'11px', fontWeight:'600', color:'#888' }}>ผู้สร้าง</div>
              <div style={{ width:'80px', flexShrink:0, fontSize:'11px', fontWeight:'600', color:'#888' }}>วันที่สร้าง</div>
              <div style={{ width:'100px', flexShrink:0, fontSize:'11px', fontWeight:'600', color:'#888' }}>เมนู</div>
              <div style={{ width:'100px', flexShrink:0, fontSize:'11px', fontWeight:'600', color:'#888' }}>อัปเดตล่าสุด</div>
              <div style={{ width:'34px', flexShrink:0 }}></div>
            </div>
            <div>
              {sortedFilteredSupportThreads.map((t, i) => {
                const unread = isThreadUnread(t);
                const previewText = t.last_message ? `${t.last_message_by}: ${t.last_message}` : t.body;
                return (
                  <div key={t.id} onClick={()=>openThreadDetail(t.id)}
                    /* MARKER_UPLOADGEN_SEVERITY_ROW_HIGHLIGHT_V1 */
                    style={{
                      display:'flex', alignItems:'center', gap:'10px', padding:'10px 14px',
                      borderBottom: i<sortedFilteredSupportThreads.length-1?'0.5px solid #f0f0f0':'none',
                      // MARKER_UPLOADGEN_RESOLVED_GREEN_HIGHLIGHT_V1 -- Resolve เขียวทั้งหมด (จบงานสำเร็จ) / Backlog ขาว (แค่เก็บเข้าคลังเก่า)
                      borderLeft: t.status==='testing' ? '3px solid #1565C0' : (isBacklogThread(t) ? '3px solid transparent' : (t.status==='resolved' ? '3px solid #27500A' : (SEVERITY_MAP[t.severity] ? `3px solid ${SEVERITY_MAP[t.severity].color}` : '3px solid transparent'))),
                      cursor:'pointer',
                      background: t.status==='testing' ? '#E3F2FD' : (isBacklogThread(t) ? 'white' : (t.status==='resolved' ? '#EAF3DE' : (SEVERITY_MAP[t.severity] ? SEVERITY_MAP[t.severity].bg : (unread ? '#E6F1FB' : 'white')))),
                    }}>
                    <div style={{ width:'26px', height:'26px', borderRadius:'50%', background:'#E6F1FB', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'500', color:'#0C447C', flexShrink:0 }}>
                      {(t.created_by||'?').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <span title={t.menu_source} style={{ flexShrink:0, fontSize:'11px' }}>{MENU_SOURCE_ICONS[t.menu_source] || '🧩'}</span>
                        {t.log_number && <span style={{ fontSize:'10px', color:'#999', fontFamily:'monospace', flexShrink:0 }}>{t.log_number}</span>}
                        <span style={{ fontSize:'12px', fontWeight: unread?'600':'500', color:'#1a3a5c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</span>
                        {/* MARKER_SUPPORT_REJECT_LIST_BADGE_V1 */}
                        {t.status==='resolved' && t.resolution_type==='rejected' && (
                          <span style={{ fontSize:'9px', fontWeight:'600', background:'#F0F0F0', color:'#666', padding:'1px 8px', borderRadius:'8px', flexShrink:0 }}>ถูกปฏิเสธ</span>
                        )}
                        {/* MARKER_UPLOADGEN_LIST_ROW_TESTING_OVERRIDE_V1 -- Tag Wait to Resolve / Request to Test */}
                        {t.status==='testing' && (
                          <span style={{ fontSize:'9px', fontWeight:'600', background:'#1565C0', color:'white', padding:'1px 8px', borderRadius:'8px', flexShrink:0 }}>
                            {isOwner ? 'Wait to Resolve' : 'Request to Test'}
                          </span>
                        )}
                        {unread && (
                          <span style={{ fontSize:'9px', background:'#378ADD', color:'white', padding:'1px 6px', borderRadius:'8px', flexShrink:0 }}>New</span>
                        )}
                      </div>
                      {/* MARKER_SUPPORT_SEVERITY_REPLACE_PREVIEW_V1 */}
                      {t.status==='new' && SEVERITY_MAP[t.severity] ? (
                        <p style={{ fontSize:'11px', color:SEVERITY_MAP[t.severity].color, margin:'2px 0 0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:'500' }}>
                          {SEVERITY_MAP[t.severity].label} — {SEVERITY_MAP[t.severity].desc}
                        </p>
                      ) : (
                        <p style={{ fontSize:'11px', color:'#888', margin:'2px 0 0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{previewText}</p>
                      )}
                    </div>
                    <div style={{ width:'90px', flexShrink:0, fontSize:'11px', color:'#666', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.created_by}</div>
                    <div style={{ width:'80px', flexShrink:0, fontSize:'11px', color:'#999' }}>{formatDate(t.created_at)}</div>
                    <div style={{ width:'100px', flexShrink:0, fontSize:'11px', color:'#666', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.menu_source}</div>
                    <div style={{ width:'100px', flexShrink:0, fontSize:'10px', color:'#999' }}>{t.last_activity_at ? formatDateTime(t.last_activity_at) : '-'}</div>
                    <div style={{ width:'34px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'flex-end' }}>
                      {canDeleteThread(t) && (
                        <button onClick={e=>{ e.stopPropagation(); handleDeleteThread(t.id); }} disabled={deletingThreadId===t.id}
                          style={{ fontSize:'11px', padding:'2px 6px', borderRadius:'6px', border:'0.5px solid #f0c0c0', background:'#FCEBEB', color:'#791F1F', cursor:'pointer', opacity:deletingThreadId===t.id?0.5:1 }}>
                          {deletingThreadId===t.id ? '...' : '🗑️'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {showNewThreadForm && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {/* MARKER_UPLOADGEN_NEWTHREAD_FORM_SIZE_V1 */}
          <div style={{ background:'white', borderRadius:'12px', width:'640px', maxWidth:'92vw', maxHeight:'85vh', overflowY:'auto', padding:'24px' }}>
            <div style={{ fontSize:'16px', fontWeight:'600', color:'#1a3a5c', marginBottom:'16px' }}>{editingThreadId ? 'แก้ไขกระทู้' : 'ตั้งกระทู้ใหม่'}</div>

            {newThreadRefLogNumber && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px', padding:'8px 12px', background:'#EEF4FB', border:'0.5px solid #c5d8f0', borderRadius:'8px', marginBottom:'12px' }}>
                <span style={{ fontSize:'12px', color:'#0C447C' }}>
                  🔗 อ้างอิงจาก: <span style={{ fontFamily:'monospace', fontWeight:'600' }}>{newThreadRefLogNumber}</span>
                  {newThreadRefTitle && <span style={{ color:'#666' }}> — {newThreadRefTitle}</span>}
                </span>
                <button type="button" onClick={()=>{ setNewThreadRefLogNumber(''); setNewThreadRefTitle(''); }}
                  style={{ background:'none', border:'none', color:'#999', cursor:'pointer', fontSize:'14px', lineHeight:1, flexShrink:0 }}>×</button>
              </div>
            )}

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>หัวข้อ</label>
              <input value={newThreadTitle} onChange={e=>setNewThreadTitle(e.target.value)} placeholder="เช่น ปุ่ม Export กดไม่ติด"
                style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box' }}/>
            </div>

            {/* MARKER_SUPPORT_SEVERITY_COMPACT_UI_V1 */}
            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'6px' }}>ระดับความสำคัญ</label>
              <div style={{ display:'flex', gap:'6px' }}>
                {SEVERITY_LEVELS.map(s => (
                  <button key={s.value} type="button" onClick={()=>setNewThreadSeverity(s.value)} title={s.desc}
                    style={{ flex:1, fontSize:'12px', fontWeight:'600', padding:'8px 4px', borderRadius:'8px', border: newThreadSeverity===s.value ? `1.5px solid ${s.color}` : '0.5px solid #ddd', background: newThreadSeverity===s.value ? s.bg : 'white', color: newThreadSeverity===s.value ? s.color : '#888', cursor:'pointer' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>มาจากเมนูไหน</label>
              <select value={newThreadMenuSource} onChange={e=>setNewThreadMenuSource(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px' }}>
                <option value="">เลือกเมนู</option>
                {MENU_SOURCE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>รายละเอียด</label>
              {/* MARKER_UPLOADGEN_NEWTHREAD_BODY_TALLER_V1 */}
              <textarea value={newThreadBody} onChange={e=>setNewThreadBody(e.target.value)} onPaste={e=>handleImagePaste(e, newThreadAttachments, setNewThreadAttachments)} rows={16} placeholder="อธิบายปัญหาที่พบ... (Paste รูปได้เลย)"
                style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box', resize:'vertical' }}/>
            </div>

            <div style={{ marginBottom:'20px' }}>
              <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>แนบรูป (สูงสุด 5 รูป)</label>
              {/* MARKER_UPLOADGEN_EDIT_THREAD_EXISTING_IMAGES_V1 -- รูปเดิมจาก Server (Edit Mode เท่านั้น) */}
              {existingImages.length > 0 && (
                <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
                  {existingImages.map(img => (
                    <div key={img.id} style={{ position:'relative', flexShrink:0 }}>
                      <img src={existingImageUrls[img.id]} alt="แนบเดิม"
                        style={{ width:'40px', height:'40px', borderRadius:'4px', objectFit:'cover', border:'0.5px solid #ddd' }}/>
                      <button onClick={()=>handleDeleteExistingImage(img.id)} disabled={deletingImageId===img.id}
                        style={{ position:'absolute', top:'-4px', right:'-4px', width:'16px', height:'16px', borderRadius:'50%', border:'none', background:'#c0392b', color:'white', cursor:'pointer', fontSize:'10px', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1, opacity: deletingImageId===img.id?0.5:1 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <SupportAttachDropZone attachments={newThreadAttachments} setAttachments={setNewThreadAttachments} maxImages={5 - existingImages.length}/>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button onClick={()=>{ setShowNewThreadForm(false); setEditingThreadId(''); setExistingImages([]); setExistingImageUrls({}); }} disabled={creatingThread}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={handleCreateThread} disabled={creatingThread}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', cursor:'pointer', opacity:creatingThread?0.6:1 }}>
                {creatingThread ? 'กำลังบันทึก...' : (editingThreadId ? 'บันทึกการแก้ไข' : 'ตั้งกระทู้')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHoldModal && (
        <div onClick={()=>setShowHoldModal(false)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:10001, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:'12px', width:'380px', maxWidth:'90vw', padding:'20px' }}>
            <div style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', marginBottom:'10px' }}>🔒 Hold กระทู้นี้</div>
            <textarea value={holdReasonInput} onChange={e=>setHoldReasonInput(e.target.value)} placeholder="ระบุเหตุผล (บังคับกรอก)" rows={3}
              style={{ width:'100%', padding:'10px', borderRadius:'8px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' }}/>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'16px' }}>
              <button onClick={()=>setShowHoldModal(false)} disabled={holdingThread}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={handleConfirmHold} disabled={holdingThread}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#8a6d1a', color:'white', cursor:'pointer', opacity:holdingThread?0.6:1 }}>
                {holdingThread ? 'กำลัง Hold...' : 'ยืนยัน Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectTestModal && (
        <div onClick={()=>setShowRejectTestModal(false)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:10001, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:'12px', width:'380px', maxWidth:'90vw', padding:'20px' }}>
            <div style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', marginBottom:'10px' }}>❌ Test ไม่ผ่าน — กลับไปแก้ต่อ</div>
            <textarea value={rejectTestReasonInput} onChange={e=>setRejectTestReasonInput(e.target.value)} placeholder="ระบุเหตุผล (บังคับกรอก)" rows={3}
              style={{ width:'100%', padding:'10px', borderRadius:'8px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' }}/>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'16px' }}>
              <button onClick={()=>setShowRejectTestModal(false)} disabled={rejectingTest}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={handleConfirmRejectTest} disabled={rejectingTest}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#d9534f', color:'white', cursor:'pointer', opacity:rejectingTest?0.6:1 }}>
                {rejectingTest ? 'กำลังส่ง...' : 'ยืนยันตีกลับ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MARKER_UPLOADGEN_SHARE_TESTING_V1 */}
      {showShareModal && (
        <div onClick={()=>setShowShareModal(false)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:10001, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:'12px', width:'380px', maxWidth:'90vw', padding:'20px', maxHeight:'80vh', display:'flex', flexDirection:'column' }}>
            <div style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', marginBottom:'4px' }}>📤 Share ให้ช่วย Test</div>
            <div style={{ fontSize:'11px', color:'#999', marginBottom:'12px' }}>เลือกได้มากกว่า 1 คน (เฉพาะคนที่มีสิทธิ์เมนูเดียวกัน และยังไม่เคยถูก Share)</div>
            <div style={{ flex:1, overflowY:'auto', border:'0.5px solid #eee', borderRadius:'8px', padding:'6px' }}>
              {shareCandidatesLoading ? (
                <div style={{ textAlign:'center', padding:'20px', color:'#999', fontSize:'12px' }}>กำลังโหลด...</div>
              ) : shareCandidates.length === 0 ? (
                <div style={{ textAlign:'center', padding:'20px', color:'#999', fontSize:'12px' }}>ไม่มีคนที่ Share ได้แล้ว</div>
              ) : (
                shareCandidates.map(c => (
                  <label key={c.username} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 10px', borderRadius:'6px', cursor:'pointer', fontSize:'13px', color:'#333' }}>
                    <input type="checkbox" checked={selectedShareUsernames.includes(c.username)} onChange={()=>toggleShareUsername(c.username)} />
                    {c.username}
                  </label>
                ))
              )}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'16px' }}>
              <button onClick={()=>setShowShareModal(false)} disabled={sharingThread}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={handleConfirmShare} disabled={sharingThread || selectedShareUsernames.length === 0}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#0C447C', color:'white', cursor:'pointer', opacity:(sharingThread || selectedShareUsernames.length === 0)?0.6:1 }}>
                {sharingThread ? 'กำลังส่ง...' : `Share (${selectedShareUsernames.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div onClick={()=>setConfirmDialog(null)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:10001, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:'12px', width:'360px', maxWidth:'90vw', padding:'20px' }}>
            <p style={{ fontSize:'14px', color:'#333', margin:'0 0 20px', lineHeight:'1.6' }}>{confirmDialog.message}</p>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button onClick={()=>setConfirmDialog(null)}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={confirmDialog.onConfirm}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', cursor:'pointer' }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {lightboxImageUrl && (
        <div onClick={()=>setLightboxImageUrl(null)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.85)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out' }}>
          <img src={lightboxImageUrl} alt="แนบ (ขยาย)" onClick={e=>e.stopPropagation()}
            style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius:'8px', boxShadow:'0 4px 30px rgba(0,0,0,0.5)' }}/>
          <button onClick={()=>setLightboxImageUrl(null)}
            style={{ position:'absolute', top:'20px', right:'20px', width:'36px', height:'36px', borderRadius:'50%', border:'none', background:'rgba(255,255,255,0.9)', color:'#333', fontSize:'18px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>
      )}

      {showExportReport && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'white', borderRadius:'12px', width:'420px', maxWidth:'90vw', padding:'24px' }}>
            <div style={{ fontSize:'16px', fontWeight:'600', color:'#1a3a5c', marginBottom:'6px' }}>📄 Export Report</div>
            <div style={{ fontSize:'11px', color:'#999', marginBottom:'16px' }}>Download เป็น Word ทันที ไม่เก็บไฟล์ไว้บน Server</div>

            <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>จากวันที่</label>
                <input type="date" value={exportFrom} onChange={e=>setExportFrom(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box' }}/>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>ถึงวันที่</label>
                <input type="date" value={exportTo} onChange={e=>setExportTo(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px', boxSizing:'border-box' }}/>
              </div>
            </div>

            {isOwner && (
              <div style={{ marginBottom:'20px' }}>
                <label style={{ fontSize:'12px', color:'#666', display:'block', marginBottom:'4px' }}>กรองเฉพาะผู้ตั้ง (ไม่บังคับ)</label>
                <select value={exportFilterUser} onChange={e=>setExportFilterUser(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'13px' }}>
                  <option value="">ทุกคน</option>
                  {supportReportUserOptions.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button onClick={()=>setShowExportReport(false)} disabled={exportingReport}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ยกเลิก</button>
              <button onClick={handleExportReport} disabled={exportingReport}
                style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', cursor:'pointer', opacity:exportingReport?0.6:1 }}>
                {exportingReport ? 'กำลัง Export...' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecycleBin && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'white', borderRadius:'12px', width:'560px', maxWidth:'90vw', maxHeight:'85vh', overflowY:'auto', padding:'24px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
              <div style={{ fontSize:'16px', fontWeight:'600', color:'#1a3a5c' }}>🗑️ Recycle Bin</div>
              <button onClick={()=>setShowRecycleBin(false)} style={{ fontSize:'13px', padding:'4px 10px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#555', cursor:'pointer' }}>ปิด</button>
            </div>
            <div style={{ fontSize:'11px', color:'#999', marginBottom:'16px' }}>กระทู้ที่ถูกลบจะอยู่ที่นี่ 3 วัน ก่อนถูกลบถาวรอัตโนมัติ</div>

            {recycleBinLoading ? (
              <div style={{ textAlign:'center', padding:'30px', color:'#999', fontSize:'13px' }}>กำลังโหลด...</div>
            ) : recycleBinThreads.length === 0 ? (
              <div style={{ textAlign:'center', padding:'30px', color:'#999', fontSize:'13px' }}>ไม่มีกระทู้ใน Recycle Bin</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {recycleBinThreads.map(t => (
                  <div key={t.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 14px', border:'0.5px solid #f0f0f0', borderRadius:'8px' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>{t.title}</div>
                      <div style={{ fontSize:'11px', color:'#999', marginTop:'2px' }}>{t.created_by} · ลบเมื่อ {formatDate(t.deleted_at)}</div>
                    </div>
                    <button onClick={()=>handleRestoreThread(t.id)}
                      style={{ fontSize:'11px', padding:'5px 12px', borderRadius:'6px', border:'0.5px solid #b5d4f4', background:'#E6F1FB', color:'#0C447C', cursor:'pointer', flexShrink:0, fontWeight:'500' }}>
                      ↻ กู้คืน
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showHandlerDetail && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'white', borderRadius:'12px', width:'600px', maxWidth:'90vw', maxHeight:'85vh', overflowY:'auto', padding:'28px' }}>
            <div style={{ fontSize:'18px', fontWeight:'600', color:'#1a3a5c', marginBottom:'4px' }}>📧 Outlook Handler</div>
            <div style={{ fontSize:'13px', color:'#888', marginBottom:'20px' }}>เครื่องมือเปิด Outlook Draft อัตโนมัติ — ติดตั้งครั้งเดียวใช้ได้ทุกเมนู</div>

            <div style={{ background:'#f7f9fb', borderRadius:'8px', padding:'12px 16px', marginBottom:'20px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:'#1a3a5c', marginBottom:'6px' }}>ไฟล์นี้มีไว้ทำอะไร?</div>
              <div style={{ fontSize:'13px', color:'#555', lineHeight:'1.7' }}>เป็น "ตัวกลาง" ที่ทำให้เว็บ FASTAPN สั่งเปิด Outlook พร้อม To/CC/Subject/เนื้อหา และไฟล์แนบให้อัตโนมัติ แทนการต้อง copy ข้อมูลไปวางเองทีละช่อง ติดตั้งครั้งเดียวที่เครื่อง ใช้ได้กับทุกเมนูที่มีปุ่ม "เปิด Outlook Draft"</div>
            </div>

            <div style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', marginBottom:'10px' }}>⬇ ยังไม่เคย Download — ติดตั้งครั้งแรก</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'20px' }}>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#E6F1FB', color:'#1a3a5c', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>1</span><span style={{ fontSize:'13px', color:'#444' }}>กดปุ่ม <b>Download</b> ด้านบน — จะได้ไฟล์ .zip</span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#E6F1FB', color:'#1a3a5c', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>2</span><span style={{ fontSize:'13px', color:'#444' }}>แตกไฟล์ zip (คลิกขวา → Extract All)</span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#E6F1FB', color:'#1a3a5c', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>3</span><span style={{ fontSize:'13px', color:'#444' }}>ดับเบิลคลิกไฟล์ <code style={{background:'#eee',padding:'1px 5px',borderRadius:'4px'}}>setup-fastapn-outlook.bat</code></span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#E6F1FB', color:'#1a3a5c', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>4</span><span style={{ fontSize:'13px', color:'#444' }}>รอจนขึ้น "ติดตั้งสำเร็จ!" แล้วกด Enter ปิดหน้าต่าง</span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#E6F1FB', color:'#1a3a5c', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>5</span><span style={{ fontSize:'13px', color:'#444' }}>กลับไปกดปุ่ม "เปิด Outlook Draft" ที่เมนูได้เลย</span></div>
            </div>

            <div style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', marginBottom:'10px' }}>↻ ติดตั้งไปแล้ว — อยากได้เวอร์ชันล่าสุด</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'8px' }}>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#f0f0f0', color:'#888', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>1</span><span style={{ fontSize:'13px', color:'#444' }}>กดปุ่ม <b>Update</b> — จะได้ไฟล์เดี่ยว <code style={{background:'#eee',padding:'1px 5px',borderRadius:'4px'}}>fastapn-outlook.ps1</code> (ไม่ใช่ zip)</span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#f0f0f0', color:'#888', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>2</span><span style={{ fontSize:'13px', color:'#444' }}>เอาไฟล์ที่ได้ไปวางทับที่ <code style={{background:'#eee',padding:'1px 5px',borderRadius:'4px'}}>D:\apps\fastapn-outlook.ps1</code></span></div>
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}><span style={{ width:'20px', height:'20px', borderRadius:'50%', background:'#f0f0f0', color:'#888', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>3</span><span style={{ fontSize:'13px', color:'#444' }}>ไม่ต้อง import registry ใหม่ — ของเดิมยังใช้ได้ต่อเนื่อง</span></div>
            </div>
            <div style={{ fontSize:'12px', color:'#aaa', marginBottom:'20px' }}>💡 ใช้ Update เมื่อรู้ว่ามีการแก้ไข/ปรับปรุงตัว Handler โดยไม่ต้องติดตั้งใหม่ทั้งหมด</div>

            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button onClick={()=>setShowHandlerDetail(false)} style={{ fontSize:'13px', padding:'8px 16px', borderRadius:'6px', border:'0.5px solid #d0d0d0', background:'white', color:'#1a3a5c', cursor:'pointer' }}>← Back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentCenter;
// MARKER_SUPPORT_LIST_FULLHEIGHT_V1

// MARKER_SUPPORT_SEARCH_NARROW_V1