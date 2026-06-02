import React, { useState, useEffect, useRef, useCallback } from 'react';
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

function MainApp() {
  const [activePage, setActivePage] = useState('ap-controller');
  const [showProfile, setShowProfile] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const closeTimerRef = useRef(null);
  const sidebarRef = useRef(null);
  const { currentUser, userRole, userName, logout } = useAuth();
  const { isOwner } = useUserRole();
  const screenWidth = useWindowWidth();

  if (!currentUser) return <Login />;

  const isAdmin = isOwner;
  const isLargeScreen = screenWidth >= 1200;

  const roleColor = { Owner: '#5DCAA5', Admin: '#e74c3c', Editor: '#0F6E56', Viewer: '#888' };
  const initial = (userName || currentUser.email || '?')[0].toUpperCase();

  const handleProfileIconClick = () => {
    if (isAdmin) setActivePage('users');
    else setShowProfile(true);
  };

  // Hover เข้า → เปิดทันที
  const handleMouseEnter = (menuId) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenMenu(menuId);
  };

  // Hover ออก → รอ 300ms แล้วค่อยปิด
  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setOpenMenu(null);
    }, 300);
  };

  // Flyout เอง Hover เข้า → ยกเลิกการปิด
  const handleFlyoutEnter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  // คลิกเลือก → ปิดทันที
  const selectPage = (id) => {
    setActivePage(id);
    setOpenMenu(null);
  };

  // คลิกนอก → ปิดทันที
  useEffect(() => {
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
      case 'coa-costcenter':  return <ChartOfAccounts activeSubTab="costcenter" onSubTabChange={sub => setActivePage(`coa-${sub}`)} />;
      case 'coa-account':     return <ChartOfAccounts activeSubTab="account" onSubTabChange={sub => setActivePage(`coa-${sub}`)} />;
      case 'coa-subaccount':  return <ChartOfAccounts activeSubTab="subaccount" onSubTabChange={sub => setActivePage(`coa-${sub}`)} />;
      case 'vendor-code':     return <VendorMaster activeSubTab="code" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} />;
      case 'vendor-category': return <VendorMaster activeSubTab="category" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} />;
      case 'itemcode':        return <ItemCodeList />;
      case 'upload':          return <UploadGen />;
      case 'users':           return <UserManagement />;
      default:                return <PlaceholderPage title="AP Controller" icon="🧾" />;
    }
  };

  // Sidebar Icon Item
  const sideIcon = (id, icon, label) => (
    <div key={id}
      onClick={() => selectPage(id)}
      onMouseEnter={() => handleMouseEnter(id)}
      onMouseLeave={handleMouseLeave}
      title={label}
      style={{
        width: '100%', height: '40px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '18px', cursor: 'pointer',
        borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent',
        background: activePage === id ? 'rgba(255,255,255,0.1)' : 'transparent',
        transition: 'background 0.15s',
      }}>
      {icon}
    </div>
  );

  // Flyout Sub Item
  const fpSub = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{
        padding: '7px 16px 7px 38px', fontSize: '12px', cursor: 'pointer',
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

  const fpGroupHeader = (icon, label) => (
    <div style={{ padding: '8px 16px 4px', fontSize: '11px', fontWeight: '500', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {icon} {label}
    </div>
  );

  const fpDivider = () => (
    <div style={{ height: '0.5px', background: '#e8eaf0', margin: '4px 16px' }} />
  );

  // Flyout Panel Component
  const FlyoutPanel = ({ menuId, title, icon, children }) => {
    if (openMenu !== menuId) return null;
    return (
      <div
        onMouseEnter={handleFlyoutEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'absolute', left: '56px', top: 0, bottom: 0,
          width: '200px', background: 'white',
          borderRight: '0.5px solid #e8eaf0',
          zIndex: 20, display: 'flex', flexDirection: 'column',
          boxShadow: '4px 0 12px rgba(0,0,0,0.08)',
        }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '0.5px solid #e8eaf0' }}>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{icon}</span> {title}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
          {children}
        </div>
      </div>
    );
  };

  // Large Screen — Flyout แบบขยาย (Sidebar กว้าง + Flyout สำหรับ Master)
  // Small Screen — Icon เล็ก + Flyout ทุก Menu
  const sidebarContent = isLargeScreen ? (
    // จอใหญ่ — Sidebar ขยาย + Flyout เฉพาะ Master Data
    <div style={{
      width: '200px', minWidth: '200px', background: '#1a3a5c', color: 'white',
      display: 'flex', flexDirection: 'column',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5DCAA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#1a3a5c', flexShrink: 0 }}>{initial}</div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>FAST<span style={{ color: '#5DCAA5' }}>APN</span></div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Link3ase · System</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div style={{ padding: '8px 16px', fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Functions</div>
        {FUNCTION_MENUS.map(m => (
          <div key={m.id} onClick={() => selectPage(m.id)}
            style={{ padding: '7px 16px', cursor: 'pointer', fontSize: '13px', background: activePage === m.id ? 'rgba(255,255,255,0.1)' : 'transparent', borderLeft: activePage === m.id ? '3px solid #5DCAA5' : '3px solid transparent', color: activePage === m.id ? 'white' : 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{m.icon}</span> {m.label}
          </div>
        ))}
        <div style={{ margin: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
        <div
          onMouseEnter={() => handleMouseEnter('master')}
          onMouseLeave={handleMouseLeave}
          style={{ padding: '8px 16px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', color: isMasterActive || openMenu === 'master' ? '#5DCAA5' : 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.5px', textTransform: 'uppercase', background: openMenu === 'master' ? 'rgba(93,202,165,0.1)' : 'transparent' }}>
          <span>📦 Master Data</span>
          <span style={{ fontSize: '10px' }}>▸</span>
        </div>
        <div style={{ margin: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
        <div onClick={() => selectPage('upload')}
          style={{ padding: '7px 16px', cursor: 'pointer', fontSize: '13px', background: activePage === 'upload' ? 'rgba(255,255,255,0.1)' : 'transparent', borderLeft: activePage === 'upload' ? '3px solid #5DCAA5' : '3px solid transparent', color: activePage === 'upload' ? 'white' : 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📤</span> Upload & Gen
        </div>
      </nav>
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
      </div>
    </div>
  ) : (
    // จอเล็ก — Icon เล็ก
    <div style={{
      width: '56px', minWidth: '56px', background: '#1a3a5c', color: 'white',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      <div style={{ width: '100%', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5DCAA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#1a3a5c' }}>{initial}</div>
      </div>
      <div style={{ flex: 1, width: '100%', padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', padding: '4px 0' }}>FN</div>
        {FUNCTION_MENUS.map(m => sideIcon(m.id, m.icon, m.label))}
        <div style={{ width: '32px', height: '0.5px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        <div
          onMouseEnter={() => handleMouseEnter('master')}
          onMouseLeave={handleMouseLeave}
          title="Master Data"
          style={{ width: '100%', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', cursor: 'pointer', borderLeft: isMasterActive || openMenu === 'master' ? '3px solid #5DCAA5' : '3px solid transparent', background: openMenu === 'master' ? 'rgba(93,202,165,0.15)' : isMasterActive ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
          📦
        </div>
        <div style={{ width: '32px', height: '0.5px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        {sideIcon('upload', '📤', 'Upload & Gen')}
      </div>
      <div style={{ width: '100%', padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <button onClick={handleProfileIconClick}
          style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <UserIcon />
        </button>
        <button onClick={logout}
          style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: '#e74c3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LogoutIcon />
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <div ref={sidebarRef} style={{ position: 'relative', zIndex: 30, display: 'flex', flexShrink: 0 }}>
        {sidebarContent}

        {/* Flyout Panel — Master Data (ใช้ทั้ง 2 แบบ) */}
        <FlyoutPanel menuId="master" title="Master Data" icon="📦">
          {fpGroupHeader('🏢', 'Business Unit')}
          {fpSub('bu-info', '📋', 'Info')}
          {fpSub('bu-branch', '🏪', 'Branch')}
          {fpDivider()}
          {fpGroupHeader('💰', 'Chart of Accounts')}
          {fpSub('coa-costcenter', '🏷️', 'Cost Center')}
          {fpSub('coa-account', '📒', 'Account')}
          {fpSub('coa-subaccount', '🔖', 'Sub Account')}
          {fpDivider()}
          {fpGroupHeader('👥', 'Vendor Master')}
          {fpSub('vendor-code', '🏭', 'Code')}
          {fpSub('vendor-category', '🗂️', 'Category')}
          {fpDivider()}
          {fpItem('itemcode', '🔖', 'Item Code')}
        </FlyoutPanel>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: '#f5f5f5', minWidth: 0 }}>
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
