import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';
// MARKER_UPLOADGEN_DOCACCESS_FIX_V1
import { broadcastWs, subscribeWs } from '../wsManager';

const DOC_FOLDERS = [
  { key: 'ap',   label: 'AP Manual',       icon: '🧾', permKey: 'Manual', color: '#E6F1FB', textColor: '#0C447C', desc: 'ใบวางบิล, ใบเสร็จ, หนังสือยืนยัน' },
  { key: 'vat',  label: 'VAT Control',     icon: '🧮', permKey: 'VAT',   color: '#EAF3DE', textColor: '#27500A', desc: 'ใบกำกับภาษี, รายงาน PP30' },
  { key: 'ie',   label: 'I-Expense',       icon: '💸', permKey: 'IE',    color: '#FAEEDA', textColor: '#633806', desc: 'ใบเบิกค่าใช้จ่าย, ค่าเดินทาง, ค่าที่พัก' },
  { key: 'gl',   label: 'GL Report',       icon: '📊', permKey: 'GL',    color: '#EEEDFE', textColor: '#3C3489', desc: 'รายงาน GL บัญชีแยกประเภท' },
  { key: 'ipro', label: 'I-Pro Interface', icon: '🔗', permKey: 'I-Pro', color: '#FAECE7', textColor: '#712B13', desc: 'เอกสาร interface ระบบ · spec, mapping' },
];

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
function parseAP09RowsFromRaw(rawRows) {
  return rawRows
    .filter(r => {
      const parts = String(r['[ ]'] || '').split('.').map(p => p.trim());
      return parts.some(p => p.toLowerCase() === 'yes');
    })
    .map(r => {
      const parts  = String(r['[ ]'] || '').split('.').map(p => p.trim());
      const yesIdx = parts.findIndex(p => p.toLowerCase() === 'yes');

      // Branch: ดึงจาก [ ] เหมือน APN01 — numParts[1] คือ GL เช่น "010101"
      const bracketParts = parts.filter(p => p);
      const numParts = bracketParts.filter(p => /^\d+$/.test(p));
      const branch   = numParts[1] || '';

      // Vendor Name: ชื่อเจ้าของใบกำกับอยู่ที่ parts[1]
      // ถ้าว่าง (แถวค่าดำเนินการ DHL เอง) → ใช้ r['Supplier']
      const taxVendor = (parts[1] || '').trim() || r['Supplier'] || r['Vendor Name'] || '';

      // ข้อมูลหลัง Yes
      const receiveDate = yesIdx >= 0 ? (parts[yesIdx + 1] || '').trim() : '';
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

  // Poll status ทุก 5 วินาที สำหรับ pending/processing
  React.useEffect(() => {
    const hasPending = pdfQueue.some(x => x.status === 'pending' || x.status === 'ocring');
    if (!hasPending) return;
    const interval = setInterval(async () => {
      const pendingIds = pdfQueue.filter(x => x.status === 'pending' || x.status === 'ocring').map(x => x.id).filter(Boolean);
      if (!pendingIds.length) { clearInterval(interval); return; }
      try {
        const token = sessionStorage.getItem('fastapn_token');
        const results = await Promise.all(
          pendingIds.map(id =>
            fetch(`http://10.101.87.126:4000/api/docenter/queue/${id}/result`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(r => r.json()).catch(() => null)
          )
        );
        setPdfQueue(q => q.map(item => {
          const updated = results.find(r => r?.id === item.id);
          if (!updated) return item;
          if (updated.status === 'done') {
            const buFromName = (() => {
              const m = (item.fileName||'').replace(/[.]pdf$/i,'').match(/^([A-Z]{2,6})[_-]/);
              return m ? m[1] : '';
            })();
            const dtype  = updated.result_meta?.doc_type || docType;
            const serial = updated.result_data?.serial_code || genSerial?.(buFromName||'XX', dtype) || item.fileName;
            return { ...item, status:'done', result: updated.result_data, serial, error:'' };
          }
          if (updated.status === 'error') return { ...item, status:'error', error: updated.error_msg || 'OCR ล้มเหลว' };
          if (updated.status === 'ocring') return { ...item, status:'ocring' };
          return item;
        }));
      } catch(_) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [pdfQueue]);
  const [attachments, setAttachments] = React.useState([]);
  const [pdfError, setPdfError]       = React.useState('');
  const pdfInputRef                   = React.useRef();
  const attachInputRef                = React.useRef();

  const runOcr = async (file, idx, retryCount = 0, rotation = 0) => {
    setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'ocring', error:''} : x));
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const fd = new FormData(); fd.append('file', file);
      if (rotation) fd.append('rotation', String(rotation));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000); // 5 นาที (รอ server queue ได้)
      let res;
      try {
        res = await fetch('http://10.101.87.126:4000/api/docenter/ocr-pdf', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'OCR ล้มเหลว');
      const buShort = data.metadata?.bu_short || data.metadata?.bu_code?.split('-')[0]?.trim() || '';
      const dtype   = data.doc_type || data.metadata?.doc_type || docType;
      // Lookup bu จาก company_list เพื่อเอา bu code (MPS, LKS) มา genSerial
      // ดึง BU จากชื่อไฟล์ — รองรับทั้ง "MPS_..." และ "MPS - APN01 - ..."
      const nameNoExt = file.name.replace(/\.pdf$/i, '');
      const buFromName = (() => {
        const m1 = nameNoExt.match(/^([A-Z]{2,6})_/);
        if (m1) return m1[1];
        const m2 = nameNoExt.match(/^([A-Z]{2,6})[ -]/);
        if (m2) return m2[1];
        return '';
      })();
      let buCode = buFromName || buShort || 'XX';
      // Lookup company_list ด้วย bu_code_name ถ้ามี buShort (0568)
      if (buShort && !buFromName) {
        try {
          const r = await db.from('company_list').select('bu').ilike('bu_code_name', buShort + '%').maybeSingle();
          if (r?.data?.bu) buCode = r.data.bu;
        } catch(_) {}
      }
      const serial = genSerial ? genSerial(buCode, dtype) : (data.serial_code || file.name);
      setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'done', result:data, serial} : x));
      if (idx === 0 || selected === idx) {
        setSelected(idx);
        setSerialCode(serial);
      }
    } catch(err) {
      const msg = err.name === 'AbortError' ? 'หมดเวลา — server ใช้เวลานานเกิน 5 นาที' : err.message;
      // retry เฉพาะ network error (ไม่ใช่ abort หรือ server error)
      if (retryCount === 0 && err.name !== 'AbortError' && err.message === 'Failed to fetch') {
        setPdfQueue(q => q.map((x,i) => i===idx ? {...x, status:'ocring', error:'กำลัง retry...'} : x));
        await new Promise(r => setTimeout(r, 3000));
        return runOcr(file, idx, 1);
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
                    {item.status==='done' ? `${item.result?.total_rows||0} รายการ · ${item.result?.pages||0} หน้า` :
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

function AddFileModal({ folder, onClose, onSave, userName, currentUser }) {
  const [docType, setDocType] = React.useState('APN01');
  const [tab, setTab] = React.useState('paste');
  // pdfQueue อยู่ที่นี่ เพื่อให้สลับ tab แล้วไม่หาย
  const [pdfQueue, setPdfQueue] = React.useState([]);
  const [pdfSelected, setPdfSelected] = React.useState(null);
  const [pasteText, setPasteText] = React.useState('');
  const [parsedRows, setParsedRows] = React.useState([]);
  const [parsedHeaders, setParsedHeaders] = React.useState([]);
  const [fileQueue, setFileQueue] = React.useState([]);
  const [selectedFileIdx, setSelectedFileIdx] = React.useState(0);
  const [serialCode, setSerialCode] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const [formatWarning, setFormatWarning] = React.useState('');
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
  const genSerial = (bu, type) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2,'0');
    const yy=String(now.getFullYear()).slice(2),mm=p(now.getMonth()+1),dd=p(now.getDate()),hh=p(now.getHours()),mi=p(now.getMinutes());
    return `${bu||'XX'}_${DOC_TYPE_MAP[type]||type}_${type}-${yy}${mm}${dd}.${hh}${mi}`;
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

  const handlePaste = (text) => {
    setPasteText(text);
    if (text.trim().length < 5) { setParsedRows([]); return; }
    // ── เช็ค Scientific Notation จาก raw text ก่อน parse ──
    const rawLines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    const rawHeaders = rawLines[0]?.split('\t').map(h=>h.trim())||[];
    const invIdx = rawHeaders.indexOf('Invoice Num');
    if (invIdx >= 0) {
      const sciRows = rawLines.slice(1).filter(line => {
        const cells = line.split('\t');
        return /^-?\d+\.?\d*[eE][+-]?\d+$/.test((cells[invIdx]||'').trim());
      });
      if (sciRows.length > 0) {
        const sample = (sciRows[0].split('\t')[invIdx]||'').trim();
        setFormatWarning(`⚠️ พบ Invoice Number ${sciRows.length} รายการที่ผิด Format (เช่น "${sample}") — กรุณาเปิดไฟล์ Excel แก้ Format column Invoice Num เป็น Number แล้ว Copy ใหม่`);
      } else {
        setFormatWarning('');
      }
    }
    const { headers, rows } = parseTabText(text);
    setParsedHeaders(headers); setParsedRows(rows);
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
      detectedType: detectDocType(f.name),
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
          const detectedType = metaDocType || detectDocType(file.name);
          const serial = file.name.replace(/\.[^.]+$/, ''); // ใช้ชื่อไฟล์ตัด .xlsx เป็น serial_code
          setFileQueue(prev => prev.map((f, i) => i === idx ? {
            ...f, rows, headers, loading: false,
            bu, serialCode: serial, detectedType,
            metaBuCode, metaBuName, metaReceiveDate,
          } : f));
          if (idx === 0 && serial) setSerialCode(serial);
        } catch (err) {
          setFileQueue(prev => prev.map((f, i) => i === idx ? { ...f, loading: false, status: 'error', error: 'อ่านไฟล์ไม่ได้: ' + err.message } : f));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const handleSave = async () => {
    // ── Tab paste: ไฟล์ดิบ → Gen APN01 + AP09 เสมอ ──────────────────────
    if (tab === 'paste') {
      if (!serialCode.trim()) { setError('กรุณาระบุ Serial code'); return; }
      if (parsedRows.length === 0) { setError('กรุณาวางข้อมูลก่อน'); return; }
      // เช็ค Scientific Notation
      const sciRows = parsedRows.filter(r => /^-?\d+\.?\d*[eE][+-]?\d+$/.test(String(r['Invoice Num']||'')));
      if (sciRows.length > 0) {
        alert(`❌ ไม่สามารถบันทึกได้\n\nพบ Invoice Number ${sciRows.length} รายการที่ผิด Format (เช่น "${sciRows[0]['Invoice Num']}")\n\nกรุณาเปิดไฟล์ Excel → Format column Invoice Num เป็น Number → Copy ใหม่`);
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
        // Duplicate check — serial + doc_type เท่านั้น
        const dupAPN01 = await checkDuplicateSerial(db, serial, 'APN01');
        if (dupAPN01) { setError(`Serial "${serial}" (APN01) มีในระบบแล้ว`); setSaving(false); return; }

        // Insert APN01 — ทุก rows (ข้อมูลตั้งหนี้)
        const { error: err } = await db.from('doc_collection').insert([{
          serial_code:  serial,
          bu_code:      buCode,
          bu_code_name: buCodeName,
          bu_name:      buNameThai,
          doc_type:     'APN01',
          doc_name:     DOC_TYPE_MAP['APN01'],
          rows:         parsedRows,
          attachments:  attachments,
          source:       'upload',
          file_date:    now.split('T')[0],
          uploaded_by:  userName || currentUser?.email || '',
          created_at:   now,
          updated_at:   now,
        }]);
        if (err) throw err;

        // Insert AP09 — เฉพาะแถวที่มี Yes (ใบกำกับภาษี) คนละประเภทกับ APN01 ไม่ใช่ duplicate
        const ap09Rows = parseAP09RowsFromRaw(parsedRows);
        if (ap09Rows.length > 0) {
          // serial AP09 = แทน APN01→AP09 และ Invoice Register→Input Tax Invoice
          const ap09Serial = serial
            .replace('APN01', 'AP09')
            .replace('Invoice Register', 'Input Tax Invoice');
          const finalAP09Serial = ap09Serial !== serial ? ap09Serial : serial + '_AP09';
          const dupAP09 = await checkDuplicateSerial(db, finalAP09Serial, 'AP09');
          if (!dupAP09) {
            const ap09Now = new Date().toISOString();
            await db.from('doc_collection').insert([{
              serial_code:  finalAP09Serial,
              bu_code:      buCode,
              bu_code_name: buCodeName,
              bu_name:      buNameThai,
              doc_type:     'AP09',
              doc_name:     DOC_TYPE_MAP['AP09'],
              rows:         ap09Rows,
              attachments:  [],
              source:       'upload',
              file_date:    ap09Now.split('T')[0],
              uploaded_by:  userName || currentUser?.email || '',
              created_at:   ap09Now,
              updated_at:   ap09Now,
            }]);
          }
        }
        onSave(); onClose();
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
          const serial      = f.serialCode; // ชื่อไฟล์ตัด .xlsx = serial ตายตัว
          const docType     = f.detectedType || 'APN01';
          const buCodeShort = f.bu || (f.metaBuCode ? f.metaBuCode.split('-')[0].trim() : '');
          let buNameThai    = f.metaBuName || null;
          let buCodeName    = f.metaBuCode || null;
          if (buCodeShort) {
            const { data: buData } = await db.from('company_list').select('bu_code_name,"THAI COMPANY NAME"').eq('bu', buCodeShort).maybeSingle();
            if (buData?.['THAI COMPANY NAME']) buNameThai = buData['THAI COMPANY NAME'];
            if (buData?.bu_code_name) buCodeName = buData.bu_code_name;
          }
          // Duplicate check — serial + doc_type เท่านั้น
          const dup = await checkDuplicateSerial(db, serial, docType);
          if (dup) {
            setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'error', error:`Serial "${serial}" (${docType}) มีในระบบแล้ว` } : p));
            done++; setSaveProgress(Math.round(done / readyFiles.length * 100));
            continue;
          }
          console.log('[insert] serial:', serial, 'docType:', docType, 'bu:', buCodeShort, 'rows:', f.rows?.length, 'metaBuCode:', f.metaBuCode, 'metaReceiveDate:', f.metaReceiveDate);
          const insertPayload = {
            serial_code:  serial,
            doc_type:     docType,
            doc_name:     DOC_TYPE_MAP[docType] || docType,
            rows:         f.rows,
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
          setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'done' } : p));
        } catch (err) {
          console.error('[insert catch]', err);
          setFileQueue(prev => prev.map(p => p.name === f.name ? { ...p, status:'error', error:err.message } : p));
          setError('Insert error: ' + err.message);
        }
        done++; setSaveProgress(Math.round(done / readyFiles.length * 100));
      }
      setSaving(false);
      setTimeout(() => { onSave(); onClose(); }, 800);
    }
  };

  // docTypes ไม่จำเป็นแล้ว — Tab บอก intent ครบ (paste=raw→APN01+AP09, file=finished, pdf=OCR)
  const S = {
    overlay: { position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999 },
    modal: { background:'white',borderRadius:'12px',width:'calc(100vw - 80px)',maxWidth:'1400px',height:'92vh',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden' },
    pill: (sel) => ({ display:'inline-flex',alignItems:'center',padding:'4px 12px',borderRadius:'20px',fontSize:'11px',cursor:'pointer',border:'0.5px solid',borderColor:sel?'#1a3a5c':'#ddd',background:sel?'#1a3a5c':'#f5f5f5',color:sel?'white':'#555',userSelect:'none' }),
    tab: (sel) => ({ flex:1,padding:'7px',fontSize:'12px',border:'0.5px solid #ddd',background:sel?'white':'#f5f5f5',color:sel?'#1a3a5c':'#888',cursor:'pointer',fontWeight:sel?'500':'400' }),
    inp: { padding:'5px 8px',borderRadius:'6px',border:'0.5px solid #d0d0d0',fontSize:'12px',width:'100%',boxSizing:'border-box',height:'30px' },
  };

  return (
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
              <span style={{ fontSize:'11px',padding:'2px 10px',borderRadius:'20px',background:'#1a3a5c',color:'white' }}>APN01</span>
              {ap09Count > 0 && (
                <span style={{ fontSize:'11px',padding:'2px 10px',borderRadius:'20px',background:'#0F6E56',color:'white' }}>AP09 ({ap09Count} รายการ)</span>
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
              {parsedRows.length === 0 ? (
                <textarea placeholder="คลิกแล้ววาง (Ctrl+V) ข้อมูลจาก Excel หรือ Google Sheet ที่นี่ — ระบบจะแยกคอลัมน์ตาม Tab ให้อัตโนมัติ"
                  style={{ flex:1, width:'100%', minHeight:'200px', fontSize:'11px',borderRadius:'6px',border:'0.5px solid #d0d0d0',padding:'8px',boxSizing:'border-box',resize:'none',fontFamily:'monospace',lineHeight:1.5,whiteSpace:'pre',overflowX:'auto' }}
                  value={pasteText} onChange={e=>handlePaste(e.target.value)}/>
              ) : (
                <div>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 10px',background: formatWarning ? '#FCEBEB' : '#EAF3DE',borderRadius:'6px 6px 0 0',fontSize:'11px',color: formatWarning ? '#791F1F' : '#27500A' }}>
                    <span>{formatWarning ? `⚠️ detect ได้ ${parsedRows.length} แถว — มี Format ผิด ${parsedRows.filter(r=>/^-?\d+\.?\d*[eE][+-]?\d+$/.test(String(r['Invoice Num']||''))).length} รายการ` : `✅ detect ได้ ${parsedRows.length} แถว${docType==='AP09'?' (มีใบกำกับ '+parsedRows.filter(r=>String(r['[ ]']||'').split('.').some(s=>s.trim().toLowerCase()==='yes')).length+' รายการ)':''} ${parsedHeaders.length} คอลัมน์`}</span>
                    <button onClick={()=>{setPasteText('');setParsedRows([]);setParsedHeaders([]);setSerialCode('');setFormatWarning('');}} style={{ fontSize:'10px',padding:'2px 8px',borderRadius:'4px',border:'0.5px solid #aaa',background:'white',cursor:'pointer',color:'#555' }}>✕ ล้าง</button>
                  </div>
                  <div style={{ overflowX:'auto',overflowY:'auto',maxHeight:'480px',border:'0.5px solid #d0d0d0',borderTop:'none',borderRadius:'0 0 6px 6px' }}>
                    <table style={{ borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%' }}>
                      <thead>
                        <tr>{parsedHeaders.map((h,i)=>(
                          <th key={i} style={{ padding:'5px 10px',background:'#1a3a5c',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'left',borderRight:'0.5px solid rgba(255,255,255,0.15)',position:'sticky',top:0,zIndex:1 }}>{h||'-'}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {(docType === 'AP09'
                ? parsedRows.filter(r => String(r['[ ]']||'').split('.').some(s=>s.trim().toLowerCase()==='yes'))
                : parsedRows
              ).map((row,i)=>{
                          const hasSci = /^-?\d+\.?\d*[eE][+-]?\d+$/.test(String(row['Invoice Num']||''));
                          const rowBg = hasSci ? '#FCEBEB' : i%2===0 ? 'white' : '#f8f9fa';
                          return (
                          <tr key={i} style={{ background: rowBg }}
                            onMouseEnter={e=>e.currentTarget.style.background=hasSci?'#f7d0d0':'#f0f6ff'}
                            onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                            {parsedHeaders.map((h,j)=>(
                              <td key={j} style={{ padding:'4px 10px',borderRight:'0.5px solid #f0f0f0',borderBottom:'0.5px solid #f0f0f0',color: hasSci && h==='Invoice Num' ? '#c0392b' : '#333', fontWeight: hasSci && h==='Invoice Num' ? '600' : 'normal' }}>{row[h]||''}</td>
                            ))}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
                      <div style={{padding:'6px 12px',borderBottom:'0.5px solid #f0f0f0',fontSize:'11px',fontWeight:'500',color:'#1a3a5c',display:'flex',justifyContent:'space-between'}}>
                        <span>{sel.name}</span><span style={{fontWeight:'400',color:'#aaa',fontSize:'10px'}}>{sel.rows.length} แถว · {sel.headers.length} คอลัมน์</span>
                      </div>
                      <div style={{flex:1,overflowX:'auto',overflowY:'auto'}}>
                        <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%'}}>
                          <thead><tr>{sel.headers.map((h,i)=>(<th key={i} style={{padding:'5px 10px',background:'#1a3a5c',color:'rgba(255,255,255,0.9)',fontWeight:'500',textAlign:'left',borderRight:'0.5px solid rgba(255,255,255,0.1)',position:'sticky',top:0,zIndex:1}}>{h}</th>))}</tr></thead>
                          <tbody>{sel.rows.map((row,i)=>(<tr key={i} style={{background:i%2===0?'white':'#f8f9fa'}}>{sel.headers.map((h,j)=>(<td key={j} style={{padding:'4px 10px',borderBottom:'0.5px solid #f0f0f0'}}>{row[h]||''}</td>))}</tr>))}</tbody>
                        </table>
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

        {tab !== 'pdf' && <div
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#f0f6ff';e.currentTarget.style.borderColor='#1a3a5c';}}
                  onDragLeave={e=>{e.currentTarget.style.background='#fafafa';e.currentTarget.style.borderColor='#d0d0d0';}}
                  onDrop={e=>{
                    e.preventDefault();
                    e.currentTarget.style.background='#fafafa';
                    e.currentTarget.style.borderColor='#d0d0d0';
                    const imgs = Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'));
                    if(attachments.length + imgs.length > 3){alert('แนบได้สูงสุด 3 รูปครับ');return;}
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
                      if(attachments.length+imgs.length>3){alert('แนบได้สูงสุด 3 รูปครับ');return;}
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
            <button style={{ padding:'6px 16px',borderRadius:'6px',border:'none',background:saving?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500' }}
              onClick={handleSave} disabled={saving}>
              {saving?`กำลังบันทึก...${saveProgress>0?` ${saveProgress}%`:'`'}`:'💾 บันทึก'}
            </button>
          </div>
        </div>}
      </div>
    </div>
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
      const bracketParts = String(r['[ ]']||'').split('.').map(p=>p.trim()).filter(p=>p);
      const numParts = bracketParts.filter(p=>/\d+/.test(p) && !/[^\d]/.test(p));
      return {
        'Branch':             numParts[1] || '',
        'Vendor Name':        r['Supplier']||'',
        'GR Transaction No.': numParts[0] || '',
        'Invoice Number':     r['Invoice Num']||'',
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

function DocDetailModal({ file, onClose }) {
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
              {mappedRows.map((row,i)=>(
                <tr key={i} style={{background:i%2===0?'white':'#f8fbff'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f0f6ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'white':'#f8fbff'}>
                  {COLS.map((h,j)=>(
                    <td key={j} style={{...S.td,textAlign:NUM_COLS.includes(h)?'right':'left',whiteSpace:'nowrap'}}>
                      {NUM_COLS.includes(h) ? fmtNum(row[h]) : (h==='Receive Date'||h==='Tax Invoice Date') ? fmtDate(row[h]) : (row[h]||'')}
                    </td>
                  ))}
                </tr>
              ))}
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
    </div>
  );
}

function FolderDetail({ folder, onBack, userName, currentUser, canDelete, isOwner, isAdmin }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('APN01');
  const [buFilter, setBuFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('updated_desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewFile, setViewFile] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { attachments:[], index:0 }
  const [attachModal, setAttachModal] = useState(null); // file object ที่กำลังแก้ไข attachment
  const [showQueue, setShowQueue] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [queueBadge, setQueueBadge] = useState(0);
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
      const { data } = await db.from('doc_collection').select('*').order('created_at',{ ascending:false });
      setFiles(data||[]);
    } catch(e){ console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

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
    const es = new EventSource(`${API_Q}/queue/stream`);
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

  const handleDelete = async (file) => {
    try {
      await db.from('doc_collection').delete().eq('id', file.id);
      await logActivity('delete_file', file.serial_code, { folder:folder.key });
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
                return (
                  <tr key={file.id} onMouseEnter={e=>e.currentTarget.style.background='#f8fbff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                    <td style={S.td}>
                      <div style={{ fontWeight:'500',color:'#1a3a5c',maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }} title={file.serial_code}>{file.serial_code}</div>
                      </td>
                    <td style={{ ...S.td,fontSize:'10px',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#555' }} title={file.bu_code_name||''}>{file.bu_code_name||'-'}</td>
                    <td style={{ ...S.td,textAlign:'center' }}>{(() => { const c=getBuColor(file.bu_code); return <span style={{ display:'inline-block',padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:'700',background:c.bg,color:c.color,border:`1px solid ${c.border}`,letterSpacing:'0.3px' }}>{file.bu_code||'-'}</span>; })()}</td>
                    <td style={S.td}>{fmtDate(receiveDate)}</td>
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
                        {canDelete && <button title="ลบ" onClick={()=>setConfirmDelete(file)} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #f7c1c1',background:'#FCEBEB',cursor:'pointer',fontSize:'12px' }}>🗑</button>}
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
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {viewFile && <DocDetailModal file={viewFile} onClose={()=>setViewFile(null)}/>}
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
      {showAdd && <AddFileModal folder={folder} onClose={()=>setShowAdd(false)} onSave={()=>{setShowAdd(false);fetchFiles();fetchQueue();}} userName={userName} currentUser={currentUser}/>}

      {/* ── Queue Modal ── */}
      {showQueue && (() => {
        const myItems  = queueItems.filter(q => ['pending','ocring','waiting_ap','error'].includes(q.status));
        const allActive = queueItems.filter(q => ['pending','ocring','waiting_ap','error'].includes(q.status));
        const items    = queueTab === 'my' ? myItems : allActive;
        const pendingCount = queueItems.filter(q=>['pending','ocring','waiting_ap'].includes(q.status)).length;
        const movePriority = async (id, dir) => {
          const token = sessionStorage.getItem('fastapn_token');
          await fetch(`${API_Q}/queue/${id}/priority`, {
            method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ direction: dir }),
          });
          fetchQueue();
        };
        return (
          <div style={{ position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1500 }}
            onClick={()=>setShowQueue(false)}>
            <div onClick={e=>e.stopPropagation()}
              style={{ background:'white',borderRadius:'12px',width:'560px',maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}>
              {/* Header */}
              <div style={{ padding:'12px 16px',background:'#1a3a5c',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0 }}>
                <span style={{ fontSize:'13px',fontWeight:'500',color:'white' }}>🔔 OCR Queue {pendingCount > 0 && <span style={{ background:'#E24B4A',borderRadius:'50%',width:'16px',height:'16px',fontSize:'10px',display:'inline-flex',alignItems:'center',justifyContent:'center',marginLeft:'6px' }}>{pendingCount}</span>}</span>
                <button onClick={()=>setShowQueue(false)} style={{ background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'rgba(255,255,255,0.7)' }}>×</button>
              </div>
              {/* Tabs */}
              <div style={{ display:'flex',borderBottom:'0.5px solid #f0f0f0',background:'#f8f9fa',flexShrink:0 }}>
                <button onClick={()=>setQueueTab('my')} style={{ flex:1,padding:'8px',fontSize:'12px',border:'none',background:'none',borderBottom: queueTab==='my'?'2px solid #1a3a5c':'2px solid transparent',color: queueTab==='my'?'#1a3a5c':'#888',cursor:'pointer',fontWeight: queueTab==='my'?'500':'400' }}>
                  My Queue {myItems.length > 0 && <span style={{ background:'#E24B4A',color:'white',borderRadius:'50%',width:'14px',height:'14px',fontSize:'9px',display:'inline-flex',alignItems:'center',justifyContent:'center',marginLeft:'3px' }}>{myItems.length}</span>}
                </button>
                {(isOwner || isAdmin) && (
                  <button onClick={()=>setQueueTab('all')} style={{ flex:1,padding:'8px',fontSize:'12px',border:'none',background:'none',borderBottom: queueTab==='all'?'2px solid #854F0B':'2px solid transparent',color: queueTab==='all'?'#854F0B':'#888',cursor:'pointer',fontWeight: queueTab==='all'?'500':'400' }}>
                    All Queue
                  </button>
                )}
              </div>
              {/* hint priority */}
              {(isOwner || isAdmin) && queueTab === 'all' && (
                <div style={{ padding:'5px 14px',background:'#fffbf0',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',color:'#856404',flexShrink:0 }}>
                  กด ↑ เพื่อเลื่อน priority ขึ้น — item กำลังรันไม่สามารถเลื่อนได้
                </div>
              )}
              {/* List */}
              <div style={{ flex:1,overflowY:'auto' }}>
                {items.length === 0 ? (
                  <div style={{ textAlign:'center',color:'#aaa',padding:'40px',fontSize:'13px' }}>ไม่มีรายการ</div>
                ) : items.map((q, qi) => {
                  const pos = q.queue_position || (qi+1);
                  const statusIcon = q.status==='done'?'✅':q.status==='ocring'?'🔄':q.status==='error'?'❌':q.status==='waiting_ap'?'⏸️':'⏳';
                  const statusBg = q.status==='ocring'?'#CCE5FF':q.status==='done'?'#D4EDDA':q.status==='error'?'#F8D7DA':q.status==='waiting_ap'?'#F3E5F5':'#f0f0f0';
                  const statusColor = q.status==='ocring'?'#004085':q.status==='done'?'#155724':q.status==='error'?'#721C24':q.status==='waiting_ap'?'#4A148C':'#666';
                  const statusLabel = q.status==='ocring'?'กำลัง OCR':q.status==='done'?'เสร็จ':q.status==='error'?'ผิดพลาด':q.status==='waiting_ap'?'รอ AP OCR':'รอคิว';
                  return (
                  <div key={q.id} style={{ padding:'10px 14px',borderBottom:'0.5px solid #f5f5f5',display:'flex',alignItems:'center',gap:'10px',background: q.status==='ocring'?'#f0f8ff':q.status==='done'?'#f0fff4':'white' }}>
                    {/* queue position badge */}
                    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0,minWidth:'28px' }}>
                      <span style={{ fontSize:'9px',fontWeight:'700',color:'#aaa' }}>#{pos}</span>
                      <span style={{ fontSize:'10px',fontWeight:'600',minWidth:'20px',height:'20px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:statusBg,color:statusColor,marginTop:'1px' }}>
                        {q.status==='done'?'✓':q.status==='error'?'!':pos}
                      </span>
                    </div>
                    <span style={{ fontSize:'16px' }}>{statusIcon}</span>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{q.file_name}</div>
                      <div style={{ fontSize:'10px',color:'#888',marginTop:'2px',display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center' }}>
                        <span style={{ background:statusBg,color:statusColor,padding:'1px 5px',borderRadius:'3px',fontWeight:'500' }}>{statusLabel}</span>
                        {queueTab==='all' && <span style={{ background:'#EAF3DE',color:'#27500A',padding:'1px 5px',borderRadius:'3px' }}>{q.uploaded_by}</span>}
                        <span>{new Date(q.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>
                        <span style={{ background:'#E6F1FB',color:'#0C447C',padding:'1px 5px',borderRadius:'3px' }}>{q.menu_id||'AP Manual'}</span>
                        {q.status==='error' && <span style={{ color:'#c0392b' }}>{q.error_msg}</span>}
                      </div>
                    </div>
                    <div style={{ display:'flex',gap:'4px',flexShrink:0 }}>
                      {/* priority ↑ เฉพาะ Owner/Admin ใน All Queue และเฉพาะ pending */}
                      {(isOwner || isAdmin) && queueTab==='all' && ['pending','waiting_ap'].includes(q.status) && (
                        <button onClick={()=>movePriority(q.id,'up')} title="เลื่อน priority ขึ้น"
                          style={{ padding:'3px 8px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',fontSize:'11px',cursor:'pointer',color:'#555' }}>↑</button>
                      )}
                      <button onClick={async()=>{
                        const token = sessionStorage.getItem('fastapn_token');
                        await fetch(`${API_Q}/queue/${q.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
                        fetchQueue();
                      }} style={{ padding:'3px 8px',borderRadius:'4px',border:'0.5px solid #f7c1c1',background:'#FCEBEB',color:'#c0392b',fontSize:'11px',cursor:'pointer' }}>✕</button>
                    </div>
                  </div>
                  );
                })}
              </div>
              {/* Footer */}
              <div style={{ padding:'8px 14px',borderTop:'0.5px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0 }}>
                <span style={{ fontSize:'11px',color:'#888' }}>
                  {queueItems.filter(q=>q.status==='ocring').length > 0 ? `กำลัง OCR ${queueItems.filter(q=>q.status==='ocring').length} ไฟล์` : `${pendingCount} รอ`}
                </span>
                <button onClick={fetchQueue} style={{ padding:'4px 10px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'11px' }}>🔄 Refresh</button>
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
function DocumentCenter() {
  const { currentUser, userName } = useAuth();
  const { isOwner, isAdmin } = useUserRole();
  const [userRoleData, setUserRoleData] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [fileCounts, setFileCounts] = useState({});
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState({});
  const [toast, setToast] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { data: roleData } = await db.from('user_roles').select('*').eq('email', currentUser.email).single();
      setUserRoleData(roleData);
      if (roleData?.id) {
        const [{ data: ovData }, { data: reqData }] = await Promise.all([
          db.from('doc_access_override').select('*').eq('user_id', roleData.id),
          db.from('access_requests').select('*').eq('requester_id', roleData.id),
        ]);
        setOverrides(ovData || []);
        setRequests(reqData || []);
      }
      const { data: countData } = await db.from('doc_files').select('folder_key');
      if (countData) {
        const counts = {};
        countData.forEach(r => { counts[r.folder_key] = (counts[r.folder_key] || 0) + 1; });
        setFileCounts(counts);
      }
    } catch (err) { console.error('fetchData error:', err); }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    const override = overrides.find(o => o.folder_key === folder.key);
    if (override) return override.allowed;
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

  if (activeFolder) {
    return (
      <div style={{ display:'flex',flexDirection:'column',flex:1,height:'100%',overflow:'hidden',position:'relative' }}>
        <FolderDetail
          folder={activeFolder}
          onBack={() => { setActiveFolder(null); fetchData(); }}
          userName={userName}
          currentUser={currentUser}
          canDelete={isOwner || isAdmin}
          isOwner={isOwner}
          isAdmin={isAdmin}
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

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'16px' }}>
        <div>
          <h2 style={{ fontSize:'16px', fontWeight:'600', margin:'0 0 4px' }}>📁 Document Center</h2>
          <p style={{ fontSize:'12px', color:'#888', margin:0 }}>{accessibleCount} โฟลเดอร์ที่เข้าถึงได้ จากทั้งหมด {DOC_FOLDERS.length} โฟลเดอร์</p>
        </div>
      </div>

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
                📄 {count} ไฟล์
              </span>

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
    </div>
  );
}

export default DocumentCenter;