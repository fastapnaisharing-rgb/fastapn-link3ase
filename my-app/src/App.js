import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataCacheProvider } from './contexts/DataCacheContext';
import Login from './pages/Login';
import ItemCodeList from './pages/ItemCodeList';
import BusinessUnit from './pages/BusinessUnit';
import ChartOfAccounts from './pages/ChartOfAccounts';
import VendorMaster from './pages/VendorMaster';
import UploadGen from './pages/UploadGen';
import UserManagement from './pages/UserManagement';
import './App.css';
import { useUserRole } from './contexts/useUserRole';
import { supabase } from './supabase';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return width;
}

function NoAccessPage() {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⛔</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>ไม่มีสิทธิ์เข้าถึงหน้านี้ครับ</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>กรุณาติดต่อ Owner เพื่อขอสิทธิ์เพิ่มเติม</div>
    </div>
  );
}

function PlaceholderPage({ title, icon }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>{icon}</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>อยู่ระหว่างการพัฒนา</div>
    </div>
  );
}

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
  </svg>
);

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);

const DOC_FOLDER_LABELS = { ap: 'AP Manual', vat: 'VAT Control', ie: 'I-Expense', gl: 'GL Report', ipro: 'I-Pro Interface' };

function BellModal({ requests, isOwner, onApprove, onReject, onClose, onGoAccess }) {
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const pendingReqs = requests.filter(r => r.status === 'pending');
  const handledReqs = requests.filter(r => r.status !== 'pending');

  const formatTime = (ts) => {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000 / 60);
    if (diff < 60) return `${diff} นาทีที่แล้ว`;
    if (diff < 1440) return `${Math.floor(diff/60)} ชั่วโมงที่แล้ว`;
    return 'เมื่อวาน';
  };

  const hoursLeft = (ts) => {
    if (!ts) return '';
    const left = Math.ceil((new Date(ts).getTime() + 24*60*60*1000 - Date.now()) / (1000*60*60));
    return left > 0 ? `หายใน ${left} ชม.` : 'กำลังจะหาย';
  };

  const visibleRequests = isOwner ? requests : requests;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '460px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', fontWeight: '500', color: '#1a3a5c' }}>🔔 การแจ้งเตือน</span>
            {pendingCount > 0 && (
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#FCEBEB', color: '#791F1F', fontWeight: '500' }}>
                {pendingCount} รออนุมัติ
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {visibleRequests.length === 0 && (
            <div style={{ padding: '48px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔔</div>
              ไม่มีการแจ้งเตือน
            </div>
          )}
          {pendingReqs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>รออนุมัติ</span>
              </div>
              {pendingReqs.map(req => {
                const folderLabel = DOC_FOLDER_LABELS[req.folder_key] || req.folder_key;
                const initial = (req.requester_name || '?')[0].toUpperCase();
                return (
                  <div key={req.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', background: '#f8fbff' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#e8f0fb', color: '#0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c', marginBottom: '2px' }}>
                          {isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: isOwner ? '10px' : '0' }}>
                          {req.requester_name} · {formatTime(req.created_at)}
                        </div>
                        {isOwner && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => onApprove(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#EAF3DE', color: '#27500A', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>✅ อนุมัติ</button>
                            <button onClick={() => onReject(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>❌ ปฏิเสธ</button>
                          </div>
                        )}
                        {!isOwner && (
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#FFF3CD', color: '#856404' }}>⏳ รออนุมัติ</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {handledReqs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>จัดการแล้ว</span>
              </div>
              {handledReqs.map(req => {
                const folderLabel = DOC_FOLDER_LABELS[req.folder_key] || req.folder_key;
                const initial = (req.requester_name || '?')[0].toUpperCase();
                const isApproved = req.status === 'approved';
                return (
                  <div key={req.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#f5f5f5', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#555', marginBottom: '4px' }}>
                          {isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: isApproved ? '#EAF3DE' : '#FCEBEB', color: isApproved ? '#27500A' : '#791F1F' }}>
                            {isApproved ? `✅ อนุมัติโดย ${req.handled_by}` : `❌ ปฏิเสธโดย ${req.handled_by}`}
                          </span>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>{hoursLeft(req.handled_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: '#aaa' }}>จัดการแล้วจะหายอัตโนมัติใน 24 ชม.</span>
          {isOwner && (
            <button onClick={onGoAccess} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #1a3a5c', background: 'white', color: '#1a3a5c', cursor: 'pointer', fontWeight: '500' }}>
              ไป Access Control →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const getBuildVersion = () => {
  const d = new Date(Number(process.env.REACT_APP_BUILD_TIME));
  if (isNaN(d.getTime())) return 'Link3ase · System';
  return `Link3ase · v${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
};

function MainApp() {
  const [activePage, setActivePage] = useState('ap-controller');
  const [showBell, setShowBell] = useState(false);
  const [requests, setRequests] = useState([]);
  const [maintenanceMenus, setMaintenanceMenus] = useState([]);
  const bellRef = React.useRef(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [openMenu, setOpenMenu] = useState(null);
  const closeTimerRef = useRef(null);
  const sidebarRef = useRef(null);
  const { currentUser, userRole, userName, logout, userPermissions } = useAuth();
  const { isOwner } = useUserRole();
  const screenWidth = useWindowWidth();

  useEffect(() => {
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarExpanded(true);
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchRequests();
    const interval = setInterval(fetchRequests, 30000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const fetchRequests = async () => {
    try {
      const { data } = await supabase.from('access_requests').select('*').order('created_at', { ascending: false });
      setRequests(data || []);
    } catch (err) { console.error('fetchRequests error:', err); }
  };

  useEffect(() => {
    if (!currentUser) return;
    const checkMaintenance = async () => {
      try {
        const { data } = await supabase.from('system_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_menus']);
        if (data) {
          const fullMode = data.find(d => d.key === 'maintenance_mode');
          const menusRow = data.find(d => d.key === 'maintenance_menus');
          if (fullMode?.value === 'true' && !isOwner) { await logout(); return; }
          try { setMaintenanceMenus(JSON.parse(menusRow?.value || '[]')); } catch { setMaintenanceMenus([]); }
        }
      } catch (err) { console.error('maintenance check error:', err); }
    };
    checkMaintenance();
    const interval = setInterval(checkMaintenance, 30000);
    return () => clearInterval(interval);
  }, [currentUser, isOwner]);

  const handleApprove = async (req) => {
    try {
      await supabase.from('doc_access_override').upsert({
        user_id: req.requester_id, folder_key: req.folder_key, allowed: true,
        updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,folder_key' });
      await supabase.from('access_requests').update({
        status: 'approved', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
      }).eq('id', req.id);
      fetchRequests();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleReject = async (req) => {
    try {
      await supabase.from('access_requests').update({
        status: 'rejected', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
      }).eq('id', req.id);
      fetchRequests();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  };

  useEffect(() => {
    if (!currentUser) return;
    const IDLE_TIMEOUT = 60 * 60 * 1000;
    let timer = null;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => { await logout(); }, IDLE_TIMEOUT);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [currentUser]);

  if (!currentUser) return <Login />;

  const isAdmin = isOwner;
  const roleColor = { Owner: '#5DCAA5', Admin: '#e74c3c', Editor: '#0F6E56', Viewer: '#888' };
  const initial = (userName || currentUser.email || '?')[0].toUpperCase();

  const handleProfileIconClick = () => { selectPage('users'); };
  const clearCloseTimer = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  const startCloseTimer = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => { setSidebarExpanded(true); setOpenMenu(null); }, 300);
  };
  const handleSidebarEnter  = () => { clearCloseTimer(); setSidebarExpanded(true); setOpenMenu(null); };
  const handleMasterEnter   = () => { clearCloseTimer(); setSidebarExpanded(false); setOpenMenu('master'); };
  const handleFlyoutEnter   = () => { clearCloseTimer(); };
  const handleMouseLeave    = () => { startCloseTimer(); };
  const selectPage = (id) => { setActivePage(id); setSidebarExpanded(true); setOpenMenu(null); };

  const ALL_FUNCTION_MENUS = [
    { id: 'ap-controller',   icon: '🧾', label: 'AP Controller',   permKey: 'VAT'   },
    { id: 'vat-controller',  icon: '💹', label: 'VAT Controller',  permKey: 'VAT'   },
    { id: 'i-expense',       icon: '💸', label: 'I-Expense',       permKey: 'IE'    },
    { id: 'gl-functional',   icon: '📊', label: 'GL Functional',   permKey: 'GL'    },
    { id: 'i-pro-interface', icon: '🔗', label: 'I-Pro Interface', permKey: 'I-Pro' },
  ];
  const FUNCTION_MENUS = isOwner
    ? ALL_FUNCTION_MENUS.filter(m => !maintenanceMenus.includes(m.id))
    : ALL_FUNCTION_MENUS.filter(m => userPermissions?.[m.permKey] === true && !maintenanceMenus.includes(m.id));

  const MASTER_PAGES = ['bu-info','bu-branch','coa-costcenter','coa-account','coa-subaccount','itemcode','vendor-apcode','vendor-smcode','vendor-category'];
  const isMasterActive = MASTER_PAGES.includes(activePage);

  // ✅ FIX 1: เพิ่ม flyoutOpen prop ให้ VendorMaster
  const renderPage = () => {
    switch (activePage) {
      case 'ap-controller':   return (isOwner || userPermissions?.['VAT'])   ? <PlaceholderPage title="AP Controller" icon="🧾" />   : <NoAccessPage />;
      case 'vat-controller':  return (isOwner || userPermissions?.['VAT'])   ? <PlaceholderPage title="VAT Controller" icon="💹" />  : <NoAccessPage />;
      case 'i-expense':       return (isOwner || userPermissions?.['IE'])    ? <PlaceholderPage title="I-Expense" icon="💸" />       : <NoAccessPage />;
      case 'gl-functional':   return (isOwner || userPermissions?.['GL'])    ? <PlaceholderPage title="GL Functional" icon="📊" />   : <NoAccessPage />;
      case 'i-pro-interface': return (isOwner || userPermissions?.['I-Pro']) ? <PlaceholderPage title="I-Pro Interface" icon="🔗" /> : <NoAccessPage />;
      case 'bu-info':         return <BusinessUnit activeSubTab="info" onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'bu-branch':       return <BusinessUnit activeSubTab="branch" onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'coa-costcenter':  return <ChartOfAccounts activeSubTab="costcenter" onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-account':     return <ChartOfAccounts activeSubTab="account"    onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-subaccount':  return <ChartOfAccounts activeSubTab="subaccount" onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'vendor-apcode':   return <VendorMaster activeSubTab="apcode" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'vendor-smcode':   return <VendorMaster activeSubTab="smcode" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'vendor-category': return <VendorMaster activeSubTab="category" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'itemcode':        return <ItemCodeList />;
      case 'upload':          return <UploadGen />;
      case 'users':           return <UserManagement />;
      default:                return <PlaceholderPage title="AP Controller" icon="🧾" />;
    }
  };

  const sidebarW = sidebarExpanded ? 220 : 56;

  const navItem = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)} title={!sidebarExpanded ? label : ''}
      style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'flex-start' : 'center', padding: sidebarExpanded ? '0 16px' : '0', gap: '8px', cursor: 'pointer', fontSize: '13px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? 'rgba(255,255,255,0.1)' : 'transparent', color: activePage === id ? 'white' : 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
      {sidebarExpanded && <span>{label}</span>}
    </div>
  );

  const fpSub = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{ padding: '7px 16px 7px 36px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? '#f0faf6' : 'transparent', color: activePage === id ? '#0F6E56' : '#555', fontWeight: activePage === id ? '500' : '400' }}>
      <span>{icon}</span> {label}
    </div>
  );

  const fpItem = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{ padding: '8px 16px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? '#f0faf6' : 'transparent', color: activePage === id ? '#0F6E56' : '#333', fontWeight: activePage === id ? '500' : '400' }}>
      <span>{icon}</span> {label}
    </div>
  );

  const fpGroup = (icon, label) => (
    <div style={{ padding: '8px 16px 3px', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{icon} {label}</div>
  );

  const fpDiv = () => <div style={{ height: '0.5px', background: '#e8eaf0', margin: '4px 16px' }} />;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>

      <div ref={sidebarRef} style={{ position: 'relative', zIndex: 30, display: 'flex', flexShrink: 0 }} onMouseLeave={handleMouseLeave}>

        {/* Sidebar */}
        <div
          style={{ width: `${sidebarW}px`, minWidth: `${sidebarW}px`, background: '#1a3a5c', color: 'white', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease, min-width 0.2s ease', overflow: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {/* Logo */}
          <div onMouseEnter={handleSidebarEnter} style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'flex-start' : 'center', gap: '10px', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5DCAA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#1a3a5c', flexShrink: 0 }}>{initial}</div>
            {sidebarExpanded && (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>FAST<span style={{ color: '#5DCAA5' }}>APN</span></div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{getBuildVersion()}</div>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {sidebarExpanded && (
              <div style={{ padding: '6px 16px', fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Functions</div>
            )}
            {FUNCTION_MENUS.map(m => navItem(m.id, m.icon, m.label))}
            <div style={{ margin: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
            <div onClick={handleMasterEnter} title={!sidebarExpanded ? 'Master Data' : ''}
              style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'space-between' : 'center', padding: sidebarExpanded ? '0 16px' : '0', cursor: 'pointer', fontSize: sidebarExpanded ? '11px' : '16px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', borderLeft: isMasterActive || openMenu === 'master' ? '3px solid #5DCAA5' : '3px solid transparent', background: openMenu === 'master' ? 'rgba(93,202,165,0.12)' : isMasterActive ? 'rgba(255,255,255,0.08)' : 'transparent', color: isMasterActive || openMenu === 'master' ? '#5DCAA5' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {sidebarExpanded ? <><span>📦 Master Data</span><span style={{ fontSize: '10px' }}>▸</span></> : <span>📦</span>}
            </div>
            <div style={{ margin: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
            {navItem('upload', '📁', 'Document Center')}
          </nav>

          {/* Bottom */}
          <div onMouseEnter={handleSidebarEnter} style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: sidebarExpanded ? 'stretch' : 'center', gap: '8px', flexShrink: 0 }}>
            {sidebarExpanded ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName || currentUser.email}</div>
                    <div style={{ fontSize: '11px', color: roleColor[userRole] || '#fff', fontWeight: '500' }}>{userRole}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button onClick={() => setShowBell(v => !v)}
                      style={{ background: showBell ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${showBell ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: showBell ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <BellIcon />
                      {requests.filter(r => r.status === 'pending').length > 0 && (
                        <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', background: '#e74c3c', borderRadius: '50%', fontSize: '9px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '500', border: '1.5px solid #1a3a5c' }}>
                          {Math.min(requests.filter(r => r.status === 'pending').length, 9)}
                        </span>
                      )}
                    </button>
                    <button onClick={handleProfileIconClick}
                      style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <UserIcon />
                    </button>
                  </div>
                </div>
                <button onClick={logout} style={{ width: '100%', padding: '7px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', color: '#e74c3c', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <LogoutIcon /> Logout
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setShowBell(v => !v)}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <BellIcon />
                  {requests.filter(r => r.status === 'pending').length > 0 && (
                    <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '8px', height: '8px', background: '#e74c3c', borderRadius: '50%', border: '1.5px solid #1a3a5c' }} />
                  )}
                </button>
                <button onClick={handleProfileIconClick}
                  style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserIcon />
                </button>
                <button onClick={logout}
                  style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: '#e74c3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LogoutIcon />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Flyout Panel */}
        {openMenu === 'master' && (
          <div onMouseEnter={handleFlyoutEnter} onMouseLeave={handleMouseLeave}
            style={{ position: 'absolute', left: '56px', top: 0, bottom: 0, width: '164px', background: 'white', borderRight: '0.5px solid #e8eaf0', zIndex: 20, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 12px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '0.5px solid #e8eaf0' }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>📦 Master Data</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
              {fpGroup('🏢', 'Business Unit')}
              {fpSub('bu-info', '📋', 'Info')}
              {fpSub('bu-branch', '🏪', 'Branch')}
              {fpDiv()}
              {fpGroup('💰', 'Chart of Accounts')}
              {fpSub('coa-costcenter', '🏷️', 'Cost Center')}
              {fpSub('coa-account', '📒', 'Account')}
              {fpSub('coa-subaccount', '🔖', 'Sub Account')}
              {fpDiv()}
              {fpGroup('👥', 'Vendor Master')}
              {fpSub('vendor-apcode', '🏭', 'AP-Code')}   // เปลี่ยนจาก vendor-code
              {fpSub('vendor-smcode', '🔖', 'SM-Code')}   // เพิ่มใหม่
              {fpSub('vendor-category', '🗂️', 'Category')}
              {fpDiv()}
              {fpItem('itemcode', '🔖', 'Item Code')}
            </div>
          </div>
        )}
      </div>

      {/* ✅ FIX 2: overflow:'hidden' แทน 'auto' → scroll อยู่ใน component เอง */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#f5f5f5', minWidth: 0, marginLeft: openMenu === 'master' ? '164px' : '0', transition: 'margin-left 0.2s ease' }}>
        {renderPage()}
      </div>

      {showBell && <BellModal requests={requests} isOwner={isOwner} onApprove={handleApprove} onReject={handleReject} onClose={() => setShowBell(false)} onGoAccess={() => { selectPage('users'); setShowBell(false); }} />}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <DataCacheProvider>
        <MainApp />
      </DataCacheProvider>
    </AuthProvider>
  );
}

export default App;