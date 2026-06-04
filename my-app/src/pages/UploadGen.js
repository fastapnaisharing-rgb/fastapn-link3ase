import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

const DOC_FOLDERS = [
  { key: 'ap',   label: 'AP Manual',       icon: '🧾', permKey: 'VAT',   color: '#E6F1FB', textColor: '#0C447C', desc: 'ใบวางบิล, ใบเสร็จ, หนังสือยืนยัน' },
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
  const [form, setForm] = useState({ file_name: '', sharepoint_url: '', description: '', file_type: '', file_size: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.file_name.trim()) { setError('กรุณากรอกชื่อไฟล์ครับ'); return; }
    if (!form.sharepoint_url.trim()) { setError('กรุณาใส่ SharePoint URL ครับ'); return; }
    setSaving(true);
    try {
      const ext = form.file_name.split('.').pop().toLowerCase();
      const { error: err } = await supabase.from('doc_files').insert([{
        folder_key: folder.key,
        file_name: form.file_name.trim(),
        sharepoint_url: form.sharepoint_url.trim(),
        description: form.description.trim() || null,
        file_type: ext || form.file_type || null,
        file_size: form.file_size ? parseInt(form.file_size) : null,
        uploaded_by: userName || currentUser?.email || '',
        uploaded_at: new Date().toISOString(),
      }]);
      if (err) throw err;
      onSave();
      onClose();
    } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
    setSaving(false);
  };

  const S = {
    overlay: { position: 'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 },
    modal: { background:'white', borderRadius:'12px', width:'480px', maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' },
    input: { padding:'7px 10px', borderRadius:'6px', border:'1px solid #ddd', fontSize:'13px', width:'100%', boxSizing:'border-box', marginBottom:'12px' },
    label: { fontSize:'12px', color:'#666', display:'block', marginBottom:'4px', fontWeight:'500' },
    btn: { padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'13px' },
  };

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ padding:'16px 20px', borderBottom:'0.5px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ width:'32px', height:'32px', borderRadius:'8px', background:folder.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px' }}>{folder.icon}</div>
            <span style={{ fontSize:'14px', fontWeight:'500', color:'#1a3a5c' }}>เพิ่มไฟล์ใน {folder.label}</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#888' }}>×</button>
        </div>
        <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
          {error && <div style={{ background:'#FCEBEB', color:'#791F1F', padding:'8px 12px', borderRadius:'6px', fontSize:'12px', marginBottom:'12px' }}>{error}</div>}
          <label style={S.label}>ชื่อไฟล์ <span style={{ color:'#e74c3c' }}>*</span></label>
          <input style={S.input} placeholder="เช่น Invoice_Jan2025.pdf" value={form.file_name} onChange={e => setForm({...form, file_name: e.target.value})} />
          <label style={S.label}>SharePoint URL <span style={{ color:'#e74c3c' }}>*</span></label>
          <input style={S.input} placeholder="https://company.sharepoint.com/..." value={form.sharepoint_url} onChange={e => setForm({...form, sharepoint_url: e.target.value})} />
          <label style={S.label}>Description</label>
          <input style={S.input} placeholder="หมายเหตุ เช่น ใบวางบิล มกราคม 2568" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <div>
              <label style={S.label}>ประเภทไฟล์</label>
              <select style={{ ...S.input, marginBottom:0 }} value={form.file_type} onChange={e => setForm({...form, file_type: e.target.value})}>
                <option value="">Auto (จากชื่อไฟล์)</option>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel</option>
                <option value="docx">Word</option>
                <option value="pptx">PowerPoint</option>
                <option value="jpg">รูปภาพ</option>
                <option value="other">อื่นๆ</option>
              </select>
            </div>
            <div>
              <label style={S.label}>ขนาดไฟล์ (bytes)</label>
              <input style={{ ...S.input, marginBottom:0 }} type="number" placeholder="เช่น 1048576" value={form.file_size} onChange={e => setForm({...form, file_size: e.target.value})} />
            </div>
          </div>
          <div style={{ background:'#f8f9fa', borderRadius:'6px', padding:'10px 12px', marginTop:'12px', fontSize:'11px', color:'#888' }}>
            💡 ระบบจะเก็บ link ไปยัง SharePoint — ไฟล์จริงยังอยู่ใน SharePoint ของบริษัท
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'0.5px solid #f0f0f0', display:'flex', justifyContent:'flex-end', gap:'8px', flexShrink:0 }}>
          <button style={{ ...S.btn, background:'#f0f0f0', color:'#555' }} onClick={onClose}>ยกเลิก</button>
          <button style={{ ...S.btn, background:'#1a3a5c', color:'white', fontWeight:'500' }} onClick={handleSave} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
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
      await supabase.from('activity_log').insert([{
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
      const { data } = await supabase
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
      await supabase.from('doc_files').delete().eq('id', file.id);
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
      const { data: roleData } = await supabase.from('user_roles').select('*').eq('email', currentUser.email).single();
      setUserRoleData(roleData);
      if (roleData?.id) {
        const [{ data: ovData }, { data: reqData }] = await Promise.all([
          supabase.from('doc_access_override').select('*').eq('user_id', roleData.id),
          supabase.from('access_requests').select('*').eq('requester_id', roleData.id),
        ]);
        setOverrides(ovData || []);
        setRequests(reqData || []);
      }
      // fetch file counts per folder
      const { data: countData } = await supabase.from('doc_files').select('folder_key');
      if (countData) {
        const counts = {};
        countData.forEach(r => { counts[r.folder_key] = (counts[r.folder_key] || 0) + 1; });
        setFileCounts(counts);
      }
    } catch (err) { console.error('fetchData error:', err); }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const canAccess = (folder) => {
    if (isOwner || isAdmin) return true;
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
      const { error } = await supabase.from('access_requests').insert([{
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