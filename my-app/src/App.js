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
import Profile from './pages/Profile';
import './App.css';
import { useUserRole } from './contexts/useUserRole';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return width;
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

const getBuildVersion = () => {
  const d = new Date(Number(process.env.REACT_APP_BUILD_TIME));
  if (isNaN(d.getTime())) return 'Link3ase · System';
  return `Link3ase · v${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
};

function MainApp() {
  const [activePage, setActivePage] = useState('ap-controller');
  const [showProfile, setShowProfile] = useState(false);
  // Step 1 & 5: Default = true (200px), Step 3: false (56px เมื่อ Flyout เปิด)
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [openMenu, setOpenMenu] = useState(null);
  const closeTimerRef = useRef(null);
  const sidebarRef = useRef(null);
  const { currentUser, userRole, userName, logout } = useAuth();
  const { isOwner } = useUserRole();
  const screenWidth = useWindowWidth();

  useEffect(() => {
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarExpanded(true); // กลับ Default = 200px
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!currentUser) return <Login />;

  const isAdmin = isOwner;
  const roleColor = { Owner: '#5DCAA5', Admin: '#e74c3c', Editor: '#0F6E56', Viewer: '#888' };
  const initial = (userName || currentUser.email || '?')[0].toUpperCase();

  const handleProfileIconClick = () => {
    if (isAdmin) selectPage('users');
    else setShowProfile(true);
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  const startCloseTimer = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setSidebarExpanded(true); // กลับ Default = 200px
      setOpenMenu(null);
    }, 300);
  };

  // Step 2 & 4: Hover Sidebar → ขยาย 200px + ปิด Flyout
  const handleSidebarEnter = () => {
    clearCloseTimer();
    setSidebarExpanded(true);
    setOpenMenu(null);
  };

  // Step 3: Hover Master Data → พับ 56px + เปิด Flyout
  const handleMasterEnter = () => {
    clearCloseTimer();
    setSidebarExpanded(false);
    setOpenMenu('master');
  };

  // Flyout Hover → ยกเลิกการปิด
  const handleFlyoutEnter = () => {
    clearCloseTimer();
  };

  // Hover ออก → รอ 300ms แล้วกลับ Default
  const handleMouseLeave = () => {
    startCloseTimer();
  };

  // Step 5: คลิกเลือก → กลับ Default 200px + ปิด Flyout
  const selectPage = (id) => {
    setActivePage(id);
    setSidebarExpanded(true);
    setOpenMenu(null);
  };

  const FUNCTION_MENUS = [
    { id: 'ap-controller',   icon: '🧾', label: 'AP Controller' },
    { id: 'vat-controller',  icon: '💹', label: 'VAT Controller' },
    { id: 'i-expense',       icon: '💸', label: 'I-Expense' },
    { id: 'gl-functional',   icon: '📊', label: 'GL Functional' },
    { id: 'i-pro-interface', icon: '🔗', label: 'I-Pro Interface' },
  ];

  const MASTER_PAGES = ['bu-info','bu-branch','coa-costcenter','coa-account','coa-subaccount','itemcode','vendor-code','vendor-category'];
  const isMasterActive = MASTER_PAGES.includes(activePage);

  const renderPage = () => {
    switch (activePage) {
      case 'ap-controller':   return <PlaceholderPage title="AP Controller" icon="🧾" />;
      case 'vat-controller':  return <PlaceholderPage title="VAT Controller" icon="💹" />;
      case 'i-expense':       return <PlaceholderPage title="I-Expense" icon="💸" />;
      case 'gl-functional':   return <PlaceholderPage title="GL Functional" icon="📊" />;
      case 'i-pro-interface': return <PlaceholderPage title="I-Pro Interface" icon="🔗" />;
      case 'bu-info':         return <BusinessUnit activeSubTab="info" onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'bu-branch':       return <BusinessUnit activeSubTab="branch" onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'coa-costcenter':  return <ChartOfAccounts activeSubTab="costcenter" onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-account':     return <ChartOfAccounts activeSubTab="account" onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-subaccount':  return <ChartOfAccounts activeSubTab="subaccount" onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'vendor-code':     return <VendorMaster activeSubTab="code" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} />;
      case 'vendor-category': return <VendorMaster activeSubTab="category" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} />;
      case 'itemcode':        return <ItemCodeList />;
      case 'upload':          return <UploadGen />;
      case 'users':           return <UserManagement />;
      default:                return <PlaceholderPage title="AP Controller" icon="🧾" />;
    }
  };

  const sidebarW = sidebarExpanded ? 200 : 56;

  const navItem = (id, icon, label) => (
    <div key={id}
      onClick={() => selectPage(id)}
      title={!sidebarExpanded ? label : ''}
      style={{
        height: '38px', display: 'flex', alignItems: 'center',
        justifyContent: sidebarExpanded ? 'flex-start' : 'center',
        padding: sidebarExpanded ? '0 16px' : '0',
        gap: '8px', cursor: 'pointer', fontSize: '13px',
        borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent',
        background: activePage === id ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: activePage === id ? 'white' : 'rgba(255,255,255,0.7)',
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
      {sidebarExpanded && <span>{label}</span>}
    </div>
  );

  const fpSub = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{
        padding: '7px 16px 7px 36px', fontSize: '12px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '8px',
        borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent',
        background: activePage === id ? '#f0faf6' : 'transparent',
        color: activePage === id ? '#0F6E56' : '#555',
        fontWeight: activePage === id ? '500' : '400',
      }}>
      <span>{icon}</span> {label}
    </div>
  );

  const fpItem = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{
        padding: '8px 16px', fontSize: '13px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent',
        background: activePage === id ? '#f0faf6' : 'transparent',
        color: activePage === id ? '#0F6E56' : '#333',
        fontWeight: activePage === id ? '500' : '400',
      }}>
      <span>{icon}</span> {label}
    </div>
  );

  const fpGroup = (icon, label) => (
    <div style={{ padding: '8px 16px 3px', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {icon} {label}
    </div>
  );

  const fpDiv = () => <div style={{ height: '0.5px', background: '#e8eaf0', margin: '4px 16px' }} />;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>

      <div ref={sidebarRef}
        style={{ position: 'relative', zIndex: 30, display: 'flex', flexShrink: 0 }}
        onMouseLeave={handleMouseLeave}>

        {/* Sidebar */}
        <div
          onMouseEnter={handleSidebarEnter}
          style={{
            width: `${sidebarW}px`, minWidth: `${sidebarW}px`,
            background: '#1a3a5c', color: 'white',
            display: 'flex', flexDirection: 'column',
            transition: 'width 0.2s ease, min-width 0.2s ease',
            overflow: 'hidden',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
          }}>

          {/* Logo */}
          <div style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'flex-start' : 'center', gap: '10px', overflow: 'hidden', flexShrink: 0 }}>
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

            {/* Master Data */}
            <div
              onMouseEnter={handleMasterEnter}
              title={!sidebarExpanded ? 'Master Data' : ''}
              style={{
                height: '38px', display: 'flex', alignItems: 'center',
                justifyContent: sidebarExpanded ? 'space-between' : 'center',
                padding: sidebarExpanded ? '0 16px' : '0',
                cursor: 'pointer', fontSize: sidebarExpanded ? '11px' : '16px',
                fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase',
                borderLeft: isMasterActive || openMenu === 'master' ? '3px solid #5DCAA5' : '3px solid transparent',
                background: openMenu === 'master' ? 'rgba(93,202,165,0.12)' : isMasterActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: isMasterActive || openMenu === 'master' ? '#5DCAA5' : 'rgba(255,255,255,0.4)',
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}>
              {sidebarExpanded
                ? <><span>📦 Master Data</span><span style={{ fontSize: '10px' }}>▸</span></>
                : <span>📦</span>
              }
            </div>

            <div style={{ margin: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
            {navItem('upload', '📤', 'Upload & Gen')}
          </nav>

          {/* Bottom */}
          <div style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: sidebarExpanded ? 'stretch' : 'center', gap: '8px', flexShrink: 0 }}>
            {sidebarExpanded ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName || currentUser.email}</div>
                    <div style={{ fontSize: '11px', color: roleColor[userRole] || '#fff', fontWeight: '500' }}>{userRole}</div>
                  </div>
                  <button onClick={handleProfileIconClick}
                    style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <UserIcon />
                  </button>
                </div>
                <button onClick={logout}
                  style={{ width: '100%', padding: '7px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', color: '#e74c3c', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <LogoutIcon /> Logout
                </button>
              </>
            ) : (
              <>
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
          <div
            onMouseEnter={handleFlyoutEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              position: 'absolute', left: '56px', top: 0, bottom: 0,
              width: '180px', background: 'white',
              borderRight: '0.5px solid #e8eaf0',
              zIndex: 20, display: 'flex', flexDirection: 'column',
              boxShadow: '4px 0 12px rgba(0,0,0,0.08)',
            }}>
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
              {fpSub('vendor-code', '🏭', 'Code')}
              {fpSub('vendor-category', '🗂️', 'Category')}
              {fpDiv()}
              {fpItem('itemcode', '🔖', 'Item Code')}
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', background: '#f5f5f5', minWidth: 0, marginLeft: openMenu === 'master' ? '180px' : '0', transition: 'margin-left 0.2s ease' }}>
        {renderPage()}
      </div>

      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
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