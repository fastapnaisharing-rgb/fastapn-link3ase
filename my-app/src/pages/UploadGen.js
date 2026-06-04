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

function DocumentCenter() {
  const { currentUser, userName } = useAuth();
  const { isOwner, isAdmin } = useUserRole();
  const [userRoleData, setUserRoleData] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [fileCounts, setFileCounts] = useState({});
  const [requests, setRequests] = useState([]); // access_requests ของ user นี้
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState({}); // { folderKey: true/false }
  const [toast, setToast] = useState(null);

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('*')
        .eq('email', currentUser.email)
        .single();
      setUserRoleData(roleData);

      if (roleData?.id) {
        const [{ data: ovData }, { data: reqData }] = await Promise.all([
          supabase.from('doc_access_override').select('*').eq('user_id', roleData.id),
          supabase.from('access_requests').select('*').eq('requester_id', roleData.id),
        ]);
        setOverrides(ovData || []);
        setRequests(reqData || []);
      }

      setFileCounts({ ap: 0, vat: 0, ie: 0, gl: 0, ipro: 0 });
    } catch (err) {
      console.error('fetchData error:', err);
    }
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
      // check ว่า pending อยู่แล้วไหม
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
    } catch (err) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
    setRequesting(prev => ({ ...prev, [folder.key]: false }));
  };

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>📁 Document Center</h2>
        <div style={{ color: '#888', fontSize: '13px' }}>กำลังโหลด...</div>
      </div>
    );
  }

  const accessibleCount = DOC_FOLDERS.filter(f => canAccess(f)).length;

  return (
    <div style={{ padding: '20px' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
          background: toast.type === 'error' ? '#FCEBEB' : toast.type === 'info' ? '#e8f0fb' : '#EAF3DE',
          color: toast.type === 'error' ? '#791F1F' : toast.type === 'info' ? '#1a3a5c' : '#27500A',
          border: `0.5px solid ${toast.type === 'error' ? '#f7c1c1' : toast.type === 'info' ? '#b5d4f4' : '#97C459'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>{toast.msg}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 4px' }}>📁 Document Center</h2>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {accessibleCount} โฟลเดอร์ที่เข้าถึงได้ จากทั้งหมด {DOC_FOLDERS.length} โฟลเดอร์
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {DOC_FOLDERS.map(folder => {
          const accessible = canAccess(folder);
          const count = fileCounts[folder.key] ?? 0;
          const reqStatus = getRequestStatus(folder.key);
          const isRequesting = requesting[folder.key];

          return (
            <div key={folder.key}
              style={{
                background: 'white',
                border: `0.5px solid ${accessible ? '#e8e8e8' : '#f0f0f0'}`,
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                cursor: accessible ? 'pointer' : 'default',
                opacity: accessible ? 1 : 0.6,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => { if (accessible) e.currentTarget.style.borderColor = '#1a3a5c'; }}
              onMouseLeave={e => { if (accessible) e.currentTarget.style.borderColor = accessible ? '#e8e8e8' : '#f0f0f0'; }}
            >
              {/* Icon */}
              <div style={{
                width: '42px', height: '42px', borderRadius: '8px',
                background: accessible ? folder.color : '#f5f5f5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', flexShrink: 0,
              }}>
                {accessible ? folder.icon : '🔒'}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: '500', color: accessible ? '#1a3a5c' : '#999', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {folder.label}
                  {!accessible && reqStatus === 'pending' && (
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#FFF3CD', color: '#856404', fontWeight: '500' }}>
                      ⏳ รออนุมัติ
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#888' }}>{folder.desc}</div>
              </div>

              {/* File count */}
              <span style={{
                fontSize: '11px', padding: '3px 10px', borderRadius: '20px',
                background: accessible ? folder.color : '#f5f5f5',
                color: accessible ? folder.textColor : '#aaa',
                display: 'flex', alignItems: 'center', gap: '4px',
                flexShrink: 0, whiteSpace: 'nowrap',
              }}>
                📄 {count} ไฟล์
              </span>

              {/* Last update placeholder */}
              <span style={{ fontSize: '11px', color: '#aaa', flexShrink: 0, minWidth: '80px', textAlign: 'right' }}>—</span>

              {accessible ? (
                <>
                  <button
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: '11px', padding: '5px 12px', borderRadius: '6px',
                      border: '0.5px solid #ddd', background: 'white', color: '#555',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                    }}>
                    ⬆ Upload
                  </button>
                  <span style={{ fontSize: '16px', color: '#aaa', flexShrink: 0 }}>›</span>
                </>
              ) : (
                <>
                  {/* Request Access button */}
                  {reqStatus === 'pending' ? (
                    <button disabled style={{
                      fontSize: '11px', padding: '5px 12px', borderRadius: '6px',
                      border: '0.5px solid #FFF3CD', background: '#FFF9E6', color: '#856404',
                      cursor: 'default', flexShrink: 0,
                    }}>
                      ⏳ รออนุมัติ
                    </button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); handleRequestAccess(folder); }}
                      disabled={isRequesting}
                      style={{
                        fontSize: '11px', padding: '5px 12px', borderRadius: '6px',
                        border: '0.5px solid #b5d4f4', background: '#E6F1FB', color: '#0C447C',
                        cursor: 'pointer', flexShrink: 0, fontWeight: '500',
                        opacity: isRequesting ? 0.6 : 1,
                      }}>
                      {isRequesting ? 'กำลังส่ง...' : '🔑 ขอสิทธิ์'}
                    </button>
                  )}
                  <span style={{ fontSize: '16px', color: '#ddd', flexShrink: 0 }}>🔒</span>
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