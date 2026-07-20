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
function AddFileModal({ folder, onClose, onSave, userName, currentUser }) {
  const [docType, setDocType] = React.useState('APN01');
  const [tab, setTab] = React.useState('paste');
  const [pasteText, setPasteText] = React.useState('');
  const [parsedRows, setParsedRows] = React.useState([]);
  const [parsedHeaders, setParsedHeaders] = React.useState([]);
  const [fileName, setFileName] = React.useState('');
  const [serialCode, setSerialCode] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);

  const DOC_TYPE_MAP = { APN01:'Invoice_Register', AP07:'Input_Tax_Invoice', AP09:'Input_Tax_Invoice', TRANS:'Transaction_AP', STORE:'Doc_Collection' };

  const genSerial = React.useCallback((bu='', type=docType) => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const dd = String(now.getDate()).padStart(2,'0');
    const hh = String(now.getHours()).padStart(2,'0');
    const mi = String(now.getMinutes()).padStart(2,'0');
    const label = DOC_TYPE_MAP[type] || type;
    return `${bu||'XX'}_${label}_${type}-${yy}${mm}${dd}_${hh}${mi}`;
  }, [docType]);

  React.useEffect(() => { setSerialCode(genSerial()); }, [docType]);

  const cleanCompanyName = (s) => s
    .replace(/Co\.,\s*Ltd\./gi,'Co,Ltd').replace(/Co\.,\s*Ltd/gi,'Co,Ltd')
    .replace(/บจก\.\s*/g,'บจก ').replace(/บมจ\.\s*/g,'บมจ ').replace(/จำกัด\s*\./g,'จำกัด ');

  const parseTabText = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { headers:[], rows:[] };
    const headers = lines[0].split('	').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cells = line.split('	');
      const row = {};
      headers.forEach((h,i) => { row[h] = (cells[i]||'').trim(); });
      return row;
    });
    return { headers, rows };
  };

  const handlePaste = (text) => {
    setPasteText(text);
    if (text.trim().length < 5) { setParsedRows([]); return; }
    const { headers, rows } = parseTabText(text);
    setParsedHeaders(headers);
    setParsedRows(rows);
    // auto-detect BU จาก Batch Name
    const batchCol = rows[0]?.['Batch Name'] || rows[0]?.['[ ]'] || '';
    const buMatch = batchCol.match(/^([A-Z]{2,6})-/);
    if (buMatch) setSerialCode(genSerial(buMatch[1], docType));
  };

  const handleFileRead = (file) => {
    setFileName(file.name);
    const nameWithout = file.name.replace(/\.[^.]+$/,'');
    setSerialCode(nameWithout);
  };

  const handleSave = async () => {
    if (!serialCode.trim()) { setError('กรุณาระบุ Serial code'); return; }
    if (parsedRows.length === 0 && !fileName) { setError('กรุณาวางข้อมูลหรือแนบไฟล์ก่อน'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error: err } = await db.from('doc_collection').insert([{
        serial_code: serialCode.trim(),
        doc_type: docType,
        doc_name: DOC_TYPE_MAP[docType] || docType,
        rows: parsedRows,
        source: 'upload',
        file_date: new Date().toISOString().split('T')[0],
        uploaded_by: userName || currentUser?.email || '',
        created_at: now,
        updated_at: now,
      }]);
      if (err) throw err;
      onSave();
      onClose();
    } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
    setSaving(false);
  };

  const S = {
    overlay: { position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 },
    modal: { background:'white', borderRadius:'12px', width:'560px', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden' },
    pill: (sel) => ({ display:'inline-flex', alignItems:'center', gap:'5px', padding:'4px 12px', borderRadius:'20px', fontSize:'11px', cursor:'pointer', border:'0.5px solid', borderColor: sel?'#1a3a5c':'#ddd', background: sel?'#1a3a5c':'#f5f5f5', color: sel?'white':'#555', transition:'all .15s', userSelect:'none' }),
    tab: (sel) => ({ flex:1, padding:'7px', fontSize:'12px', border:'0.5px solid #ddd', background: sel?'white':'#f5f5f5', color: sel?'#1a3a5c':'#888', cursor:'pointer', fontWeight: sel?'500':'400' }),
    inp: { padding:'5px 8px', borderRadius:'6px', border:'0.5px solid #d0d0d0', fontSize:'12px', width:'100%', boxSizing:'border-box', height:'30px' },
  };

  const docTypes = [
    { key:'APN01', label:'APN01' }, { key:'AP07', label:'AP07' },
    { key:'AP09', label:'AP09' }, { key:'TRANS', label:'TRANS' }, { key:'STORE', label:'เก็บลง DB' },
  ];

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ padding:'14px 18px', borderBottom:'0.5px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ width:'26px', height:'26px', borderRadius:'6px', background:folder.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px' }}>{folder.icon}</div>
            <span style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>เพิ่มไฟล์ใน {folder.label}</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#888' }}>×</button>
        </div>

        <div style={{ padding:'10px 18px', borderBottom:'0.5px solid #f0f0f0', background:'#f8f9fa', flexShrink:0 }}>
          <div style={{ fontSize:'11px', color:'#888', marginBottom:'6px' }}>ประเภทเอกสาร</div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {docTypes.map(dt => (
              <span key={dt.key} style={S.pill(docType===dt.key)} onClick={() => setDocType(dt.key)}>{dt.label}</span>
            ))}
          </div>
        </div>

        <div style={{ padding:'14px 18px', overflowY:'auto', flex:1 }}>
          {error && <div style={{ background:'#FCEBEB', color:'#791F1F', padding:'7px 12px', borderRadius:'6px', fontSize:'12px', marginBottom:'10px' }}>{error}</div>}

          <div style={{ display:'flex', marginBottom:'10px' }}>
            <button style={{ ...S.tab(tab==='paste'), borderRadius:'6px 0 0 6px' }} onClick={() => setTab('paste')}>📋 วางจาก Excel/Sheet</button>
            <button style={{ ...S.tab(tab==='file'), borderRadius:'0 6px 6px 0', borderLeft:'none' }} onClick={() => setTab('file')}>📎 แนบไฟล์ Excel</button>
          </div>

          {tab === 'paste' ? (
            <div>
              <textarea
                placeholder='คลิกแล้ววาง (Ctrl+V) ข้อมูลจาก Excel หรือ Google Sheet ที่นี่ — ระบบจะแยกคอลัมน์ตาม Tab ให้อัตโนมัติเหมือน Paste เข้า Excel จริง'
                style={{ width:'100%', height:'160px', fontSize:'11px', borderRadius:'6px', border:'0.5px solid #d0d0d0', padding:'8px', boxSizing:'border-box', resize:'none', fontFamily:'monospace', lineHeight:1.5 }}
                value={pasteText}
                onChange={e => handlePaste(e.target.value)}
              />
              {parsedRows.length > 0 && (
                <div style={{ marginTop:'6px', padding:'6px 10px', background:'#EAF3DE', borderRadius:'6px', fontSize:'11px', color:'#27500A' }}>
                  ✅ detect ได้ {parsedRows.length} แถว {parsedHeaders.length} คอลัมน์ — พร้อม parse
                </div>
              )}
            </div>
          ) : (
            <div>
              <div onClick={() => fileRef.current?.click()} style={{ border:'1.5px dashed #d0d0d0', borderRadius:'8px', padding:'28px 16px', textAlign:'center', cursor:'pointer', background:'#fafafa' }}>
                <div style={{ fontSize:'28px', marginBottom:'6px' }}>📊</div>
                <div style={{ fontSize:'12px', fontWeight:'500', color:'#1a3a5c' }}>{fileName || 'ลากไฟล์มาวาง หรือคลิกเลือก'}</div>
                <div style={{ fontSize:'11px', color:'#aaa', marginTop:'3px' }}>.xlsx, .xls เท่านั้น</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={e => e.target.files[0] && handleFileRead(e.target.files[0])} />
            </div>
          )}

          <div style={{ marginTop:'12px' }}>
            <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'3px' }}>Serial code (ชื่อไฟล์)</label>
            <input style={S.inp} value={serialCode} onChange={e => setSerialCode(e.target.value)} />
          </div>

          <div style={{ marginTop:'12px', padding:'8px 12px', background:'#f8f9fa', borderRadius:'6px', fontSize:'11px', color:'#888' }}>
            📎 รูปหลักฐานสามารถเพิ่มเติมได้ภายหลังผ่าน Attachment
          </div>
        </div>

        <div style={{ padding:'10px 18px', borderTop:'0.5px solid #f0f0f0', background:'#f8f9fa', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ fontSize:'11px', color:'#aaa', fontFamily:'monospace' }}>
            จะบันทึกเป็น: <span style={{ color:'#555' }}>{serialCode||'—'}.xlsx</span>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button style={{ padding:'6px 14px', borderRadius:'6px', border:'0.5px solid #ddd', background:'white', fontSize:'12px', cursor:'pointer', color:'#555' }} onClick={onClose}>ยกเลิก</button>
            <button style={{ padding:'6px 16px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', fontSize:'12px', cursor:'pointer', fontWeight:'500' }} onClick={handleSave} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Detail ────────────────────────────────────────────────────────────
function FolderDetail({ folder, onBack, userName, currentUser, canDelete }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortBy, setSortBy] = useState('uploaded_at');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const PAGE_SIZE = 20;

  const logActivity = async (action, target, detail = {}) => {
    try {
      await db.from('activity_log').insert([{
        user_email: currentUser?.email || '',
        username: userName || currentUser?.email || '',
        action,
        target,
        detail,
        created_at: new Date().toISOString(),
      }]);
    } catch (err) { console.error('log error:', err); }
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await db
        .from('doc_files')
        .select('*')
        .eq('folder_key', folder.key)
        .order(sortBy, { ascending: sortBy === 'file_name' });
      setFiles(data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [folder.key, sortBy]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleDelete = async (file) => {
    try {
      await db.from('doc_files').delete().eq('id', file.id);
      await logActivity('delete_file', file.file_name, { folder: folder.key });
      setConfirmDelete(null);
      fetchFiles();
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleOpen = (url, fileName) => {
    if (!url) { alert('ยังไม่มี SharePoint URL ครับ'); return; }
    logActivity('open_file', fileName || url, { folder: folder.key });
    window.open(url, '_blank');
  };

  const handleDownload = (url, fileName) => {
    if (!url) { alert('ยังไม่มี SharePoint URL ครับ\n(รอเชื่อม API บริษัทก่อนครับ)'); return; }
    logActivity('download_file', fileName || url, { folder: folder.key });
    // TODO: เชื่อม Windows Server API เพื่อ download จริง
    window.open(url, '_blank');
  };

  const filtered = files
    .filter(f => {
      const matchSearch = !search || f.file_name?.toLowerCase().includes(search.toLowerCase()) || f.description?.toLowerCase().includes(search.toLowerCase());
      const matchType = !filterType || f.file_type === filterType;
      return matchSearch && matchType;
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const fileTypes = [...new Set(files.map(f => f.file_type).filter(Boolean))];

  const S = {
    th: { padding:'8px 12px', fontSize:'11px', color:'rgba(255,255,255,0.8)', fontWeight:'500', textAlign:'left', background:'#1a3a5c', whiteSpace:'nowrap' },
    td: { padding:'9px 12px', fontSize:'12px', borderBottom:'0.5px solid #f0f0f0', verticalAlign:'middle' },
    actionBtn: { width:'28px', height:'28px', borderRadius:'6px', border:'0.5px solid #e8e8e8', background:'white', display:'inline-flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:'13px' },
  };

  return (
    <div style={{ padding:'20px' }}>
      {/* Breadcrumb */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:'13px', display:'flex', alignItems:'center', gap:'4px', padding:0 }}>
          ← Document Center
        </button>
        <span style={{ color:'#ddd' }}>/</span>
        <span style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>{folder.label}</span>
      </div>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px', flexWrap:'wrap', gap:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'42px', height:'42px', borderRadius:'8px', background:folder.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', flexShrink:0 }}>{folder.icon}</div>
          <div>
            <div style={{ fontSize:'16px', fontWeight:'600', color:'#1a3a5c' }}>{folder.label}</div>
            <div style={{ fontSize:'12px', color:'#888' }}>{files.length} ไฟล์ทั้งหมด</div>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)}
          style={{ padding:'7px 14px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', fontSize:'13px', cursor:'pointer', display:'flex', alignItems:'center', gap:'6px', fontWeight:'500' }}>
          + เพิ่มไฟล์
        </button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
        <input placeholder="Search ไฟล์..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ flex:1, minWidth:'160px', padding:'6px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px' }} />
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
          style={{ padding:'6px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', background:'white' }}>
          <option value="">ทุกประเภท</option>
          {fileTypes.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding:'6px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', background:'white' }}>
          <option value="uploaded_at">ล่าสุด</option>
          <option value="file_name">ชื่อ A-Z</option>
        </select>
        {(search || filterType) && (
          <button onClick={() => { setSearch(''); setFilterType(''); setPage(1); }}
            style={{ padding:'6px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', cursor:'pointer', background:'#f5f5f5', color:'#555' }}>
            ✕ ล้าง
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background:'white', borderRadius:'8px', border:'0.5px solid #e8e8e8', overflow:'auto' }}>
        {loading ? (
          <div style={{ padding:'40px', textAlign:'center', color:'#aaa', fontSize:'13px' }}>กำลังโหลด...</div>
        ) : paged.length === 0 ? (
          <div style={{ padding:'48px', textAlign:'center', color:'#aaa' }}>
            <div style={{ fontSize:'32px', marginBottom:'8px' }}>📂</div>
            <div style={{ fontSize:'13px' }}>{search || filterType ? 'ไม่พบไฟล์ที่ค้นหา' : 'ยังไม่มีไฟล์ในโฟลเดอร์นี้'}</div>
            {!search && !filterType && <button onClick={() => setShowAdd(true)} style={{ marginTop:'12px', padding:'6px 14px', borderRadius:'6px', border:'none', background:'#1a3a5c', color:'white', fontSize:'12px', cursor:'pointer' }}>+ เพิ่มไฟล์แรก</button>}
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px', minWidth:'700px' }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width:'36px' }}></th>
                <th style={S.th}>ชื่อไฟล์</th>
                <th style={{ ...S.th, width:'80px' }}>ประเภท</th>
                <th style={{ ...S.th, width:'80px' }}>ขนาด</th>
                <th style={{ ...S.th, width:'100px' }}>อัปโหลดโดย</th>
                <th style={{ ...S.th, width:'90px' }}>วันที่</th>
                <th style={{ ...S.th, width:'110px', textAlign:'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(file => {
                const typeStyle = getFileTypeStyle(file.file_name);
                return (
                  <tr key={file.id} style={{ background:'white' }}
                    onMouseEnter={e => e.currentTarget.style.background='#f8fbff'}
                    onMouseLeave={e => e.currentTarget.style.background='white'}>
                    <td style={{ ...S.td, padding:'8px 10px' }}>
                      <div style={{ width:'30px', height:'30px', borderRadius:'6px', background:typeStyle.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>
                        {typeStyle.icon}
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontWeight:'500', color:'#1a3a5c', marginBottom:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'280px' }}>
                        {file.file_name}
                      </div>
                      {file.description && <div style={{ fontSize:'11px', color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'280px' }}>{file.description}</div>}
                    </td>
                    <td style={S.td}>
                      {file.file_type && (
                        <span style={{ fontSize:'10px', padding:'2px 7px', borderRadius:'20px', background:typeStyle.bg, color:typeStyle.color, fontWeight:'500' }}>
                          {file.file_type.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td style={{ ...S.td, color:'#888' }}>{formatFileSize(file.file_size)}</td>
                    <td style={{ ...S.td, color:'#888' }}>{file.uploaded_by || '—'}</td>
                    <td style={{ ...S.td, color:'#888' }}>{formatDate(file.uploaded_at)}</td>
                    <td style={{ ...S.td, textAlign:'center' }}>
                      <div style={{ display:'inline-flex', gap:'4px' }}>
                        <button onClick={() => handleOpen(file.sharepoint_url, file.file_name)} style={S.actionBtn} title="เปิดใน SharePoint">🔗</button>
                        <button onClick={() => handleDownload(file.sharepoint_url, file.file_name)} style={S.actionBtn} title="Download">⬇️</button>
                        {canDelete && <button onClick={() => setConfirmDelete(file)} style={{ ...S.actionBtn, borderColor:'#f7c1c1' }} title="ลบ">🗑️</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'10px', padding:'0 4px' }}>
          <span style={{ fontSize:'12px', color:'#888' }}>แสดง {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, filtered.length)} จาก {filtered.length} ไฟล์</span>
          <div style={{ display:'flex', gap:'4px' }}>
            <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
              style={{ padding:'4px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', cursor:page===1?'default':'pointer', opacity:page===1?0.5:1, background:'white' }}>←</button>
            {[...Array(totalPages)].map((_,i) => (
              <button key={i} onClick={() => setPage(i+1)}
                style={{ padding:'4px 10px', borderRadius:'6px', border:'none', fontSize:'12px', cursor:'pointer', background:page===i+1?'#1a3a5c':'white', color:page===i+1?'white':'#333', border: page===i+1?'none':'0.5px solid #ddd' }}>
                {i+1}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}
              style={{ padding:'4px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', cursor:page===totalPages?'default':'pointer', opacity:page===totalPages?0.5:1, background:'white' }}>→</button>
          </div>
        </div>
      )}

      {/* Add File Modal */}
      {showAdd && <AddFileModal folder={folder} onClose={() => setShowAdd(false)} onSave={async (fileName) => { await logActivity('add_file', fileName || '', { folder: folder.key }); fetchFiles(); }} userName={userName} currentUser={currentUser} />}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }}>
          <div style={{ background:'white', borderRadius:'10px', padding:'24px', width:'360px' }}>
            <h3 style={{ fontSize:'14px', marginBottom:'10px' }}>🗑️ ยืนยันการลบ</h3>
            <p style={{ fontSize:'13px', color:'#555', marginBottom:'16px' }}>ต้องการลบ <strong>{confirmDelete.file_name}</strong> ออกจากระบบ? (ไฟล์จริงใน SharePoint ยังอยู่)</p>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#f0f0f0', color:'#555', fontSize:'13px' }}>ยกเลิก</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#c0392b', color:'white', fontSize:'13px', fontWeight:'500' }}>ลบ</button>
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
  const [activeFolder, setActiveFolder] = useState(null); // folder ที่กำลังเปิดอยู่

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
      // fetch file counts per folder
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

  // ── Real-time: ได้รับ Permission หรือ Access ใหม่ -> fetchData() สดทันที ──
  // ── ไม่ต้อง Refresh หน้าเอง (ฝั่งส่งอยู่ที่ UserManagement.js/App.js) ─────
  useEffect(() => {
    const unsubscribe = subscribeWs(['doc_access_updated', 'user_permissions_updated'], () => fetchData());
    return unsubscribe;
  }, [fetchData]);

  const canAccess = (folder) => {
    // Owner เข้าได้ทุกกล่องเสมอ
    if (isOwner) return true;

    // Admin / Editor / Viewer — ต้องมี override หรือ permission เท่านั้น
    const override = overrides.find(o => o.folder_key === folder.key);
    if (override) return override.allowed;
    return userRoleData?.permissions?.[folder.permKey] ?? false;
  };

  // MARKER_UPLOADGEN_AUTOBACK_V1
  // ── Auto Back to Document Center — ถ้ากำลังเปิดดู Folder ที่เพิ่งโดนตัดสิทธิ์ ──
  // ── ไปพอดี (Owner/Admin ปิด Access ระหว่างที่ยังเปิดหน้านี้ค้างอยู่) ──────────
  useEffect(() => {
    if (activeFolder && !canAccess(activeFolder)) {
      setActiveFolder(null);
      showToast('สิทธิ์เข้าถึงโฟลเดอร์นี้ถูกยกเลิกแล้ว', 'error');
    }
  }, [overrides, userRoleData, activeFolder]);

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
      // ── Broadcast แบบ Real-time — Owner/Admin เห็นคำขอใหม่ทันที ไม่ต้อง ──
      // ── รอ Poll 30 วิ (ฝั่งรับอยู่ที่ App.js — fetchRequests) ─────────────
      broadcastWs('access_request_new', { folder_key: folder.key, requester_name: userName || currentUser?.email || '' });
      showToast(`ส่งคำขอ "${folder.label}" แล้วครับ รออนุมัติจาก Owner/Admin`);
    } catch (err) { showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'); }
    setRequesting(prev => ({ ...prev, [folder.key]: false }));
  };

  // ─── Render Folder Detail ──────────────────────────────────────────────────
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
                <>
                  <span style={{ fontSize:'16px', color:'#aaa', flexShrink:0 }}>›</span>
                </>
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