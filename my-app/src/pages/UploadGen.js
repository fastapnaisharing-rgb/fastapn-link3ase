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


function AddFileModal({ folder, onClose, onSave, userName, currentUser }) {
  const [docType, setDocType] = React.useState('APN01');
  const [tab, setTab] = React.useState('paste');
  const [pasteText, setPasteText] = React.useState('');
  const [parsedRows, setParsedRows] = React.useState([]);
  const [parsedHeaders, setParsedHeaders] = React.useState([]);
  const [fileQueue, setFileQueue] = React.useState([]);
  const [serialCode, setSerialCode] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);
  const [attachments, setAttachments] = React.useState([]); // max 3 รูป
  const [dragOver, setDragOver] = React.useState(false);

  const DOC_TYPE_MAP = { APN01:'Invoice_Register', AP07:'Input_Tax_Invoice', AP09:'Input_Tax_Invoice', TRANS:'Transaction_AP' };

  const genSerial = (bu, type) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2,'0');
    const yy=String(now.getFullYear()).slice(2),mm=p(now.getMonth()+1),dd=p(now.getDate()),hh=p(now.getHours()),mi=p(now.getMinutes());
    return `${bu||'XX'}_${DOC_TYPE_MAP[type]||type}_${type}-${yy}${mm}${dd}_${hh}${mi}`;
  };

  const parseTabText = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { headers:[], rows:[] };
    const headers = lines[0].split('	').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cells = line.split('	'); const row={};
      headers.forEach((h,i) => { row[h]=(cells[i]||'').trim(); });
      return row;
    });
    return { headers, rows };
  };

  const handlePaste = (text) => {
    setPasteText(text);
    if (text.trim().length < 5) { setParsedRows([]); return; }
    const { headers, rows } = parseTabText(text);
    setParsedHeaders(headers); setParsedRows(rows);
    if (!serialCode) {
      const bv = rows[0]?.['Batch Name'] || rows[0]?.['[ ]'] || '';
      const m = bv.match(/^([A-Z]{2,6})-/);
      const bu = m ? m[1] : '';
      setSerialCode(genSerial(bu, docType));
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

  const detectDocType = (fileName) => {
    if (/APN01/i.test(fileName)) return 'APN01';
    if (/AP07/i.test(fileName)) return 'AP07';
    if (/AP09/i.test(fileName)) return 'AP09';
    if (/TRANS/i.test(fileName)) return 'TRANS';
    return docType;
  };

  const handleFiles = (fileList) => {
    const files = Array.from(fileList);
    setFileQueue(files.map(f => ({
      name: f.name,
      serialCode: f.name.replace(/\.[^.]+$/,''),
      rows: [],
      bu: f.name.split('_')[0] || '',
      detectedType: detectDocType(f.name),
      status: 'ready',
    })));
  };

  const handleSave = async () => {
    if (tab === 'paste') {
      if (!serialCode.trim()) { setError('กรุณาระบุ Serial code'); return; }
      if (parsedRows.length === 0) { setError('กรุณาวางข้อมูลก่อน'); return; }
      if (!['APN01','AP07','AP09','TRANS'].includes(docType)) { setError('ไม่สามารถ Generate ได้ เนื่องจากประเภทเอกสารนี้ยังไม่มีในระบบ'); return; }
      setSaving(true);
      try {
        const now = new Date().toISOString();
        const buCode = serialCode.trim().split('_')[0] || null;
        // Lookup bu_code_name จาก company_list
        let buCodeName = null;
        if (buCode) {
          const { data: buData } = await db.from('company_list').select('bu_code_name,bu_name_full').eq('bu', buCode).single();
          buCodeName = buData?.bu_code_name || buData?.bu_name_full || null;
        }
        const { error: err } = await db.from('doc_collection').insert([{
          serial_code: serialCode.trim(),
          bu_code: buCode,
          bu_code_name: buCodeName,
          doc_type: docType,
          doc_name: DOC_TYPE_MAP[docType]||docType, rows: parsedRows,
          attachments: attachments,
          source: 'upload', file_date: now.split('T')[0],
          uploaded_by: userName||currentUser?.email||'',
          created_at: now, updated_at: now,
        }]);
        if (err) throw err;
        onSave(); onClose();
      } catch (err) { setError('เกิดข้อผิดพลาด: '+err.message); }
      setSaving(false);
    } else {
      const readyFiles = fileQueue.filter(f => f.status==='ready');
      if (readyFiles.length===0) { setError('ไม่มีไฟล์ที่พร้อมบันทึก'); return; }
      setSaving(true); setSaveProgress(0);
      let done = 0;
      for (const f of readyFiles) {
        try {
          const now = new Date().toISOString();
          const { error: err } = await db.from('doc_collection').insert([{
            serial_code: f.serialCode, doc_type: f.detectedType||docType,
            doc_name: DOC_TYPE_MAP[f.detectedType||docType]||docType,
            rows: f.rows, bu_code: f.bu, source: 'upload',
            file_date: now.split('T')[0],
            uploaded_by: userName||currentUser?.email||'',
            created_at: now, updated_at: now,
          }]);
          if (err) throw err;
          setFileQueue(prev => prev.map(p => p.name===f.name?{...p,status:'done'}:p));
        } catch (err) {
          setFileQueue(prev => prev.map(p => p.name===f.name?{...p,status:'error',error:err.message}:p));
        }
        done++; setSaveProgress(Math.round(done/readyFiles.length*100));
      }
      setSaving(false);
      setTimeout(() => { onSave(); onClose(); }, 800);
    }
  };

  const docTypes = [{key:'APN01',label:'APN01'},{key:'AP07',label:'AP07'},{key:'AP09',label:'AP09'},{key:'TRANS',label:'TRANS'}];
  const S = {
    overlay: { position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999 },
    modal: { background:'white',borderRadius:'12px',width:'1080px',maxHeight:'96vh',display:'flex',flexDirection:'column',overflow:'hidden' },
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
        <div style={{ padding:'10px 18px',borderBottom:'0.5px solid #f0f0f0',background:'#f8f9fa',flexShrink:0 }}>
          <div style={{ fontSize:'11px',color:'#888',marginBottom:'6px' }}>ประเภทเอกสาร</div>
          <div style={{ display:'flex',gap:'6px',flexWrap:'wrap' }}>
            {docTypes.map(dt => (<span key={dt.key} style={S.pill(docType===dt.key)} onClick={()=>{setDocType(dt.key);setSerialCode('');}}>{dt.label}</span>))}
          </div>
        </div>
        <div style={{ padding:'14px 18px',overflowY:'auto',flex:1 }}>
          {error && <div style={{ background:'#FCEBEB',color:'#791F1F',padding:'7px 12px',borderRadius:'6px',fontSize:'12px',marginBottom:'10px' }}>{error}</div>}
          <div style={{ display:'flex',marginBottom:'10px' }}>
            <button style={{ ...S.tab(tab==='paste'),borderRadius:'6px 0 0 6px' }} onClick={()=>setTab('paste')}>📋 วางจาก Excel/Sheet</button>
            <button style={{ ...S.tab(tab==='file'),borderRadius:'0 6px 6px 0',borderLeft:'none' }} onClick={()=>setTab('file')}>📎 แนบไฟล์ Excel (หลายไฟล์)</button>
          </div>
          {tab==='paste' ? (
            <div>
              {parsedRows.length === 0 ? (
                <textarea placeholder="คลิกแล้ววาง (Ctrl+V) ข้อมูลจาก Excel หรือ Google Sheet ที่นี่ — ระบบจะแยกคอลัมน์ตาม Tab ให้อัตโนมัติ"
                  style={{ width:'100%',height:'300px',fontSize:'11px',borderRadius:'6px',border:'0.5px solid #d0d0d0',padding:'8px',boxSizing:'border-box',resize:'none',fontFamily:'monospace',lineHeight:1.5,whiteSpace:'pre',overflowX:'auto' }}
                  value={pasteText} onChange={e=>handlePaste(e.target.value)}/>
              ) : (
                <div>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 10px',background:'#EAF3DE',borderRadius:'6px 6px 0 0',fontSize:'11px',color:'#27500A' }}>
                    <span>✅ detect ได้ {parsedRows.length} แถว {parsedHeaders.length} คอลัมน์</span>
                    <button onClick={()=>{setPasteText('');setParsedRows([]);setParsedHeaders([]);setSerialCode('');}} style={{ fontSize:'10px',padding:'2px 8px',borderRadius:'4px',border:'0.5px solid #aaa',background:'white',cursor:'pointer',color:'#555' }}>✕ ล้าง</button>
                  </div>
                  <div style={{ overflowX:'auto',overflowY:'auto',maxHeight:'480px',border:'0.5px solid #d0d0d0',borderTop:'none',borderRadius:'0 0 6px 6px' }}>
                    <table style={{ borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap',minWidth:'100%' }}>
                      <thead>
                        <tr>{parsedHeaders.map((h,i)=>(
                          <th key={i} style={{ padding:'5px 10px',background:'#1a3a5c',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'left',borderRight:'0.5px solid rgba(255,255,255,0.15)',position:'sticky',top:0,zIndex:1 }}>{h||'-'}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row,i)=>(
                          <tr key={i} style={{ background:i%2===0?'white':'#f8f9fa' }}
                            onMouseEnter={e=>e.currentTarget.style.background='#f0f6ff'}
                            onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'white':'#f8f9fa'}>
                            {parsedHeaders.map((h,j)=>(
                              <td key={j} style={{ padding:'4px 10px',borderRight:'0.5px solid #f0f0f0',borderBottom:'0.5px solid #f0f0f0',color:'#333' }}>{row[h]||''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div>
              <div
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#f0f6ff';e.currentTarget.style.borderColor='#1a3a5c';}}
                onDragLeave={e=>{e.currentTarget.style.background='#fafafa';e.currentTarget.style.borderColor='#d0d0d0';}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.background='#fafafa';e.currentTarget.style.borderColor='#d0d0d0';handleFiles(e.dataTransfer.files);}}
                onClick={()=>fileRef.current?.click()}
                style={{ border:'1.5px dashed #d0d0d0',borderRadius:'8px',height:'300px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',background:'#fafafa',transition:'all .15s',gap:'8px' }}>
                {fileQueue.length === 0 ? (
                  <>
                    <div style={{ fontSize:'32px' }}>📊</div>
                    <div style={{ fontSize:'12px',fontWeight:'500',color:'#1a3a5c' }}>ลากไฟล์มาวาง หรือคลิกเลือก</div>
                    <div style={{ fontSize:'11px',color:'#aaa' }}>.xlsx, .xls — เลือกได้หลายไฟล์พร้อมกัน</div>
                  </>
                ) : (
                  <div style={{ width:'100%',height:'100%',display:'flex',gap:'0',overflow:'hidden',borderRadius:'7px' }}>
                    <div style={{ flex:'0 0 40%',background:'#1a3a5c',display:'flex',flexDirection:'column',justifyContent:'center',padding:'16px 20px',gap:'6px',overflowY:'auto' }}>
                      {fileQueue.map((f,i)=>(
                        <div key={i} style={{ display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'5px',background:'rgba(255,255,255,0.08)' }}>
                          <span style={{ fontSize:'16px' }}>{f.status==='done'?'✅':f.status==='error'?'❌':'📄'}</span>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontSize:'10px',color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{f.name}</div>
                            <div style={{ fontSize:'9px',color:'rgba(255,255,255,0.6)' }}>BU: {f.bu||'-'} · {f.detectedType}</div>
                          </div>
                        </div>
                      ))}
                      {fileQueue.length < 10 && (
                        <div style={{ fontSize:'10px',color:'rgba(255,255,255,0.4)',textAlign:'center',marginTop:'4px' }}>+ คลิกเพื่อเพิ่มไฟล์</div>
                      )}
                    </div>
                    <div style={{ flex:1,padding:'16px',overflowY:'auto',background:'white' }}>
                      <div style={{ fontSize:'11px',fontWeight:'500',color:'#1a3a5c',marginBottom:'8px' }}>ตัวอย่างข้อมูล: {fileQueue[0]?.name}</div>
                      {fileQueue[0]?.rows?.length > 0 ? (
                        <table style={{ borderCollapse:'collapse',fontSize:'10px',width:'100%' }}>
                          <thead>
                            <tr>{Object.keys(fileQueue[0].rows[0]||{}).slice(0,5).map((h,i)=>(
                              <th key={i} style={{ padding:'3px 8px',background:'#f0f0f0',fontSize:'10px',textAlign:'left',borderBottom:'0.5px solid #ddd',whiteSpace:'nowrap' }}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {fileQueue[0].rows.slice(0,5).map((row,i)=>(
                              <tr key={i}>
                                {Object.keys(fileQueue[0].rows[0]||{}).slice(0,5).map((h,j)=>(
                                  <td key={j} style={{ padding:'3px 8px',borderBottom:'0.5px solid #f0f0f0',fontSize:'10px',whiteSpace:'nowrap',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis' }}>{row[h]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{ fontSize:'11px',color:'#aaa',textAlign:'center',marginTop:'20px' }}>อ่านข้อมูลจากไฟล์ .xlsx จำเป็นต้องใช้ SheetJS</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display:'none' }} onChange={e=>handleFiles(e.target.files)}/>
              {fileQueue.length>0 && (
                <div style={{ marginTop:'10px',border:'0.5px solid #e8e8e8',borderRadius:'6px',overflow:'hidden' }}>
                  <div style={{ padding:'6px 10px',background:'#f8f9fa',fontSize:'11px',color:'#888',borderBottom:'0.5px solid #e8e8e8' }}>
                    {fileQueue.length} ไฟล์ — {fileQueue.filter(f=>f.status==='ready').length} พร้อม / {fileQueue.filter(f=>f.status==='done').length} บันทึกแล้ว
                  </div>
                  {fileQueue.map((f,i) => (
                    <div key={i} style={{ display:'flex',alignItems:'center',gap:'8px',padding:'7px 10px',borderBottom:'0.5px solid #f0f0f0',fontSize:'11px' }}>
                      <span>{f.status==='done'?'✅':f.status==='error'?'❌':'📄'}</span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontWeight:'500',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#1a3a5c' }}>{f.name}</div>
                        <div style={{ fontSize:'10px',color:'#aaa' }}>BU: {f.bu||'-'} · {f.detectedType}</div>
                      </div>
                      {f.status==='ready' && <input value={f.serialCode} onChange={e=>setFileQueue(prev=>prev.map((p,j)=>j===i?{...p,serialCode:e.target.value}:p))} style={{ ...S.inp,width:'200px',fontSize:'10px' }}/>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

              <div
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
              </div>

        </div>
        <div style={{ padding:'10px 18px',borderTop:'0.5px solid #f0f0f0',background:'#f8f9fa',display:'flex',alignItems:'center',gap:'10px',flexShrink:0 }}>
          <label style={{ fontSize:'11px',color:'#888',whiteSpace:'nowrap',flexShrink:0 }}>Serial Code</label>
          <input style={{ ...S.inp,flex:1,fontFamily:'monospace',fontSize:'11px' }} value={serialCode} onChange={e=>setSerialCode(e.target.value)} placeholder="generate อัตโนมัติเมื่อ detect BU ได้"/>
          <div style={{ display:'flex',gap:'8px',alignItems:'center',flexShrink:0,marginLeft:'auto' }}>
            {saving&&saveProgress>0 && <span style={{ fontSize:'11px',color:'#1a3a5c',fontWeight:'500' }}>{saveProgress}%</span>}
            <button style={{ padding:'6px 14px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',fontSize:'12px',cursor:'pointer',color:'#555' }} onClick={onClose}>ยกเลิก</button>
            <button style={{ padding:'6px 16px',borderRadius:'6px',border:'none',background:saving?'#ccc':'#1a3a5c',color:'white',fontSize:'12px',cursor:'pointer',fontWeight:'500' }} onClick={handleSave} disabled={saving}>
              {saving?`กำลังบันทึก... ${saveProgress}%`:'💾 บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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

  // Map raw rows → display rows ตาม APN01 format
  // [ ] = "AP Manual..6920740506.589801.....24-JUL-26.No.20-JUL-26.."
  // split('.') → filter ตัวเลขล้วน → [0]=GR, [1]=Branch
  const mappedRows = rawRows.map(r => {
    const invAmt = parseFloat(String(r['Invoice Amount']||'0').replace(/,/g,''))||0;
    const gross = invAmt;
    const bracketParts = String(r['[ ]']||'').split('.').map(p=>p.trim()).filter(p=>p);
    const numParts = bracketParts.filter(p=>/^\d+$/.test(p));
    const grNo   = numParts[0] || '';
    const branch = numParts[1] || '';
    return {
      'Branch': branch,
      'Vendor Name': r['Supplier']||'',
      'GR Transaction No.': grNo,
      'Invoice Number': r['Invoice Num']||'',
      'Receive Date': r['Invoice Date']||'',
      'รายการ': r['Description']||'',
      'มูลค่าก่อนภาษี': gross||'',
      'มูลค่าภาษี': parseFloat(String(r['Tax Amount']||'0').replace(/,/g,''))||'',
      'มูลค่ารวม': invAmt||'',
      'Batch Name': r['Batch Name']||'',
    };
  });

  const COLS = ['Branch','Vendor Name','GR Transaction No.','Invoice Number','Receive Date','รายการ','มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม','Batch Name'];
  const COL_W = {'Branch':'80px','Vendor Name':'160px','GR Transaction No.':'140px','Invoice Number':'160px','Receive Date':'110px','รายการ':'auto','มูลค่าก่อนภาษี':'120px','มูลค่าภาษี':'110px','มูลค่ารวม':'120px','Batch Name':'170px'};
  const NUM_COLS = ['มูลค่าก่อนภาษี','มูลค่าภาษี','มูลค่ารวม'];

  const totalAmt = mappedRows.reduce((s,r)=>s+(parseFloat(r['มูลค่าก่อนภาษี'])||0),0);
  const totalVat = mappedRows.reduce((s,r)=>s+(parseFloat(r['มูลค่าภาษี'])||0),0);
  const totalAll = mappedRows.reduce((s,r)=>s+(parseFloat(r['มูลค่ารวม'])||0),0);
  const receiveDate = rawRows[0]?.['Invoice Date']||file.file_date||'';

  const S = {
    overlay:{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000},
    modal:{background:'white',borderRadius:'12px',width:window.innerWidth<=1366?'calc(100vw - 40px)':'calc(100vw - 200px)',maxWidth:window.innerWidth<=1366?'calc(100vw - 40px)':'calc(100vw - 200px)',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden'},
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
            <button style={{padding:'5px 12px',fontSize:'11px',borderRadius:'6px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',color:'#555'}}>⬇ Download</button>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'22px',color:'#aaa',lineHeight:1}}>×</button>
          </div>
        </div>

        <div style={{padding:'10px 20px',background:'#f8f9fa',borderBottom:'0.5px solid #e8e8e8',flexShrink:0,position:'sticky',top:0,zIndex:3}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 40px'}}>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>DOC TYPE</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.doc_type}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>BU CODE</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.bu_code_name||file.bu_code||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>ชื่อผู้ประกอบการ</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.bu_code_name||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>Receive Date</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{fmtDate(receiveDate)}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>อัพโหลดโดย</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{file.uploaded_by||'-'}</span></div>
            <div style={{display:'flex',alignItems:'center'}}><span style={S.hlabel}>จำนวนรายการ</span><span style={{fontSize:'11px',color:'#888'}}>:</span><span style={S.hval}>{mappedRows.length} รายการ</span></div>
          </div>
        </div>

        <div style={{overflowX:'auto',overflowY:'auto',flex:1}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px',tableLayout:'auto'}}>
            <thead>
              <tr>
                {COLS.map((h,i)=>(
                  <th key={i} style={{...S.th,width:COL_W[h]==='auto'?undefined:COL_W[h],minWidth:COL_W[h]||'80px',textAlign:NUM_COLS.includes(h)?'right':'left'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappedRows.map((row,i)=>(
                <tr key={i} style={{background:i%2===0?'white':'#f8fbff'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f0f6ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'white':'#f8fbff'}>
                  {COLS.map((h,j)=>(
                    <td key={j} style={{...S.td,textAlign:NUM_COLS.includes(h)?'right':'left',maxWidth:h==='รายการ'?'320px':undefined,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:h==='รายการ'?'nowrap':'normal'}}>
                      {NUM_COLS.includes(h) ? fmtNum(row[h]) : h==='Receive Date' ? fmtDate(row[h]) : (row[h]||'')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{padding:'8px 20px',borderTop:'0.5px solid #f0f0f0',background:'#f8f9fa',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <span style={{fontSize:'11px',color:'#888'}}>ยอดรวมทั้งหมด</span>
          <span style={{fontSize:'13px',fontWeight:'500',color:'#1a3a5c'}}>{totalAll>0?totalAll.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):fmtNum(totalAmt)}</span>
        </div>
      </div>
    </div>
  );
}


function FolderDetail({ folder, onBack, userName, currentUser, canDelete }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('APN01');
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewFile, setViewFile] = useState(null);

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

  const handleDelete = async (file) => {
    try {
      await db.from('doc_collection').delete().eq('id', file.id);
      await logActivity('delete_file', file.serial_code, { folder:folder.key });
      setConfirmDelete(null); fetchFiles();
    } catch(e){ alert('ลบไม่สำเร็จ: '+e.message); }
  };

  const filtered = files.filter(f => {
    const matchTab = activeTab==='TRANS' ? ['TRANS','STORE'].includes(f.doc_type) : f.doc_type===activeTab;
    const matchSearch = !search || (() => {
      const q = search.toLowerCase();
      return f.serial_code?.toLowerCase().includes(q) ||
        f.bu_code?.toLowerCase().includes(q) ||
        (Array.isArray(f.rows) && f.rows.some(row =>
          Object.values(row).some(v => String(v||'').toLowerCase().includes(q))
        ));
    })();
    return matchTab && matchSearch;
  });

  const tabCount = (key) => files.filter(f => key==='TRANS'?['TRANS','STORE'].includes(f.doc_type):f.doc_type===key).length;
  const fmtDate = (d) => { if(!d)return'-'; const dt=new Date(d); return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getFullYear()).slice(2)}`; };
  const fmtNum = (n) => n!=null&&!isNaN(n)&&Number(n)!==0 ? Number(n).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}) : '-';

  const S = {
    th: { padding:'8px 12px',fontSize:'11px',color:'rgba(255,255,255,0.85)',fontWeight:'500',textAlign:'left',background:'#1a3a5c',whiteSpace:'nowrap' },
    td: { padding:'8px 12px',fontSize:'11px',borderBottom:'0.5px solid #f0f0f0',verticalAlign:'middle' },
    tab: (a) => ({ padding:'7px 16px',fontSize:'12px',cursor:'pointer',border:'none',borderBottom:a?'2px solid #1a3a5c':'2px solid transparent',background:'transparent',color:a?'#1a3a5c':'#888',fontWeight:a?'500':'400',marginBottom:'-1px',whiteSpace:'nowrap' }),
  };

  return (
    <div style={{ padding:'20px' }}>
      <div style={{ display:'flex',alignItems:'center',gap:'8px',marginBottom:'16px' }}>
        <button onClick={onBack} style={{ background:'none',border:'none',cursor:'pointer',color:'#888',fontSize:'13px',padding:0 }}>← Document Center</button>
        <span style={{ color:'#ddd' }}>/</span>
        <span style={{ fontSize:'13px',fontWeight:'500',color:'#1a3a5c' }}>{folder.label}</span>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:'12px',marginBottom:'14px' }}>
        <div style={{ width:'42px',height:'42px',borderRadius:'8px',background:folder.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',flexShrink:0 }}>{folder.icon}</div>
        <div>
          <div style={{ fontSize:'16px',fontWeight:'600',color:'#1a3a5c' }}>{folder.label}</div>
          <div style={{ fontSize:'12px',color:'#888' }}>{files.length} รายการทั้งหมด</div>
        </div>
      </div>
      <div style={{ display:'flex',gap:'8px',marginBottom:'12px',alignItems:'center' }}>
        <input placeholder="Search Serial code, BU..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{ width:'25%',padding:'6px 10px',borderRadius:'6px',border:'0.5px solid #ddd',fontSize:'12px' }}/>
        {search && <button onClick={()=>setSearch('')} style={{ padding:'6px 10px',borderRadius:'6px',border:'0.5px solid #ddd',fontSize:'12px',cursor:'pointer',background:'#f5f5f5' }}>✕</button>}
        <div style={{ flex:1 }}/>
        <button onClick={()=>setShowAdd(true)} style={{ padding:'7px 14px',borderRadius:'6px',border:'none',background:'#1a3a5c',color:'white',fontSize:'13px',cursor:'pointer',fontWeight:'500' }}>+ เพิ่มไฟล์</button>
      </div>
      <div style={{ borderBottom:'1px solid #e8e8e8',display:'flex' }}>
        {TABS.map(t => (
          <button key={t.key} style={S.tab(activeTab===t.key)} onClick={()=>setActiveTab(t.key)}>
            {t.label}
            <span style={{ marginLeft:'5px',fontSize:'10px',background:activeTab===t.key?'#1a3a5c':'#e8e8e8',color:activeTab===t.key?'white':'#888',padding:'1px 5px',borderRadius:'20px' }}>{tabCount(t.key)}</span>
          </button>
        ))}
      </div>
      <div style={{ background:'white',borderRadius:'0 0 8px 8px',border:'0.5px solid #e8e8e8',borderTop:'none',overflow:'auto' }}>
        {loading ? (
          <div style={{ padding:'40px',textAlign:'center',color:'#aaa',fontSize:'13px' }}>กำลังโหลด...</div>
        ) : filtered.length===0 ? (
          <div style={{ padding:'32px',textAlign:'center',color:'#aaa',fontSize:'12px' }}>
            {search ? 'ไม่พบรายการที่ค้นหา' : `ยังไม่มีรายการ ${activeTab}`}
          </div>
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
                const totalAmt = rows.reduce((s,r)=>s+(parseFloat(r['Gross Value']||r['มูลค่าก่อนภาษี']||r['Invoice Amount']||0)),0);
                const totalVat = rows.reduce((s,r)=>s+(parseFloat(r['Vat Value']||r['มูลค่าภาษี']||r['Tax Amount']||0)),0);
                const totalAll = rows.reduce((s,r)=>s+(parseFloat(r['Total Value']||r['มูลค่ารวม']||0)),0);
                const receiveDate = rows[0]?.['Receive Date']||file.file_date||'';
                const attachCount = Array.isArray(file.attachments)?file.attachments.length:0;
                return (
                  <tr key={file.id} onMouseEnter={e=>e.currentTarget.style.background='#f8fbff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                    <td style={S.td}>
                      <div style={{ fontWeight:'500',color:'#1a3a5c',maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }} title={file.serial_code}>{file.serial_code}</div>
                      </td>
                    <td style={{ ...S.td,fontSize:'10px',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#555' }} title={file.bu_code_name||''}>{file.bu_code_name||'-'}</td>
                    <td style={{ ...S.td,textAlign:'center' }}><span style={{ display:'inline-block',padding:'2px 7px',borderRadius:'4px',fontSize:'10px',fontWeight:'500',background:'#e8f0fb',color:'#1a3a5c' }}>{file.bu_code||'-'}</span></td>
                    <td style={S.td}>{fmtDate(receiveDate)}</td>
                    <td style={{ ...S.td,textAlign:'right' }}>{fmtNum(totalAmt)}</td>
                    <td style={{ ...S.td,textAlign:'right' }}>{fmtNum(totalVat)}</td>
                    <td style={{ ...S.td,textAlign:'right',fontWeight:'500' }}>{(totalAll||totalAmt+totalVat)>0?'฿'+fmtNum(totalAll||totalAmt+totalVat):'-'}</td>
                    <td style={{ ...S.td,textAlign:'center' }}>
                      <div style={{ display:'flex',gap:'4px',justifyContent:'center',alignItems:'center' }}>
                        {Array.isArray(file.attachments)&&file.attachments.length>0 ? (
                          <>
                            {file.attachments.slice(0,3).map((a,i)=>(
                              <img key={i} src={a.data} alt={a.name} title={a.name}
                                style={{ width:'32px',height:'32px',borderRadius:'4px',objectFit:'cover',border:'0.5px solid #ddd',cursor:'pointer' }}/>
                            ))}
                            {file.attachments.length>3&&<span style={{ fontSize:'10px',color:'#aaa' }}>+{file.attachments.length-3}</span>}
                          </>
                        ) : <span style={{ fontSize:'10px',color:'#ccc' }}>-</span>}
                      </div>
                    </td>
                    
                    <td style={{ ...S.td,textAlign:'center' }}>
                      <div style={{ display:'inline-flex',gap:'4px' }}>
                        <button title="ดู" onClick={()=>setViewFile(file)} style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'12px' }}>👁</button>
                        <button title="Download" style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'12px' }}>⬇</button>
                        <button title="Attachment" style={{ width:'26px',height:'26px',borderRadius:'4px',border:'0.5px solid #ddd',background:'white',cursor:'pointer',fontSize:'12px' }}>📎</button>
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
      </div>
      {viewFile && <DocDetailModal file={viewFile} onClose={()=>setViewFile(null)}/>}
      {showAdd && <AddFileModal folder={folder} onClose={()=>setShowAdd(false)} onSave={()=>{setShowAdd(false);fetchFiles();}} userName={userName} currentUser={currentUser}/>}
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
      <FolderDetail
        folder={activeFolder}
        onBack={() => { setActiveFolder(null); fetchData(); }}
        userName={userName}
        currentUser={currentUser}
        canDelete={isOwner || isAdmin}
      />
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
    <div style={{ padding:'20px' }}>
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