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
  const { currentUser } = useAuth();
  const { isOwner, isAdmin } = useUserRole();
  const [userRole, setUserRole] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [fileCounts, setFileCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. fetch user role + permissions
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('*')
        .eq('email', currentUser.email)
        .single();
      setUserRole(roleData);

      // 2. fetch overrides for this user
      if (roleData?.id) {
        const { data: ovData } = await supabase
          .from('doc_access_override')
          .select('*')
          .eq('user_id', roleData.id);
        setOverrides(ovData || []);
      }

      // 3. fetch file counts per folder (future: from doc storage table)
      // placeholder — will be real when doc storage is implemented
      setFileCounts({ ap: 0, vat: 0, ie: 0, gl: 0, ipro: 0 });
    } catch (err) {
      console.error('fetchData error:', err);
    }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const canAccess = (folder) => {
    // Owner และ Admin เข้าได้เสมอ
    if (isOwner || isAdmin) return true;

    // Check override ก่อน
    const override = overrides.find(o => o.folder_key === folder.key);
    if (override) return override.allowed;

    // fallback ใช้ permission ปกติ
    return userRole?.permissions?.[folder.permKey] ?? false;
  };

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>📁 Document Center</h2>
        <div style={{ color: '#888', fontSize: '13px' }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 4px' }}>📁 Document Center</h2>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {DOC_FOLDERS.filter(f => canAccess(f)).length} โฟลเดอร์ที่เข้าถึงได้
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {DOC_FOLDERS.map(folder => {
          const accessible = canAccess(folder);
          const count = fileCounts[folder.key] ?? 0;

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
                cursor: accessible ? 'pointer' : 'not-allowed',
                opacity: accessible ? 1 : 0.45,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => { if (accessible) e.currentTarget.style.borderColor = '#1a3a5c'; }}
              onMouseLeave={e => { if (accessible) e.currentTarget.style.borderColor = '#e8e8e8'; }}
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
                <div style={{ fontSize: '14px', fontWeight: '500', color: accessible ? '#1a3a5c' : '#999', marginBottom: '2px' }}>
                  {folder.label}
                  {!accessible && (
                    <span style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: '#f5f5f5', color: '#999', fontWeight: '400' }}>
                      ไม่มีสิทธิ์
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

              {/* Last update */}
              <span style={{ fontSize: '11px', color: '#aaa', flexShrink: 0, minWidth: '80px', textAlign: 'right' }}>
                {accessible ? '—' : '—'}
              </span>

              {/* Upload btn */}
              <button
                onClick={e => { e.stopPropagation(); }}
                disabled={!accessible}
                style={{
                  fontSize: '11px', padding: '5px 12px', borderRadius: '6px',
                  border: `0.5px solid ${accessible ? '#ddd' : '#f0f0f0'}`,
                  background: accessible ? 'white' : '#f9f9f9',
                  color: accessible ? '#555' : '#ccc',
                  cursor: accessible ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                }}>
                ⬆ Upload
              </button>

              {/* Arrow or Lock */}
              <span style={{ fontSize: '16px', color: accessible ? '#aaa' : '#ddd', flexShrink: 0 }}>
                {accessible ? '›' : '🔒'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Info note */}
      <div style={{ marginTop: '16px', padding: '10px 14px', background: '#f8f9fa', borderRadius: '8px', fontSize: '11px', color: '#888' }}>
        💡 หากต้องการเข้าถึงโฟลเดอร์ที่ถูกล็อก กรุณาติดต่อ Owner เพื่อขอสิทธิ์เพิ่มเติมครับ
      </div>
    </div>
  );
}

export default DocumentCenter;