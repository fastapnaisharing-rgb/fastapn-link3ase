import React, { useState } from 'react';
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

function PlaceholderPage({ title, icon }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>{icon}</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>อยู่ระหว่างการพัฒนา</div>
    </div>
  );
}

function MainApp() {
  const [activePage, setActivePage] = useState('ap-controller');
  const [showProfile, setShowProfile] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [buOpen, setBuOpen] = useState(false);
  const [coaOpen, setCoaOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const { currentUser, userRole, userName, logout } = useAuth();

  if (!currentUser) return <Login />;

  const isAdmin = currentUser?.email === 'lekarn@central.co.th';

  const handleProfileIconClick = () => {
    if (isAdmin) setActivePage('users');
    else setShowProfile(true);
  };

  const FUNCTION_MENUS = [
    { id: 'ap-controller',   icon: '🧾', label: 'AP Controller' },
    { id: 'vat-controller',  icon: '💹', label: 'VAT Controller' },
    { id: 'i-expense',       icon: '💸', label: 'I-Expense' },
    { id: 'gl-functional',   icon: '📊', label: 'GL Functional' },
    { id: 'i-pro-interface', icon: '🔗', label: 'I-Pro Interface' },
  ];

  const MASTER_PAGES = ['bu-info','bu-branch','coa-costcenter','coa-account','coa-subaccount','itemcode','vendor-code','vendor-category'];
  const FUNCTION_PAGES = FUNCTION_MENUS.map(m => m.id);

  const isMasterActive = MASTER_PAGES.includes(activePage);
  const isFunctionActive = FUNCTION_PAGES.includes(activePage);
  const isBuActive = ['bu-info','bu-branch'].includes(activePage);
  const isCoaActive = ['coa-costcenter','coa-account','coa-subaccount'].includes(activePage);
  const isVendorActive = ['vendor-code','vendor-category'].includes(activePage);

  const roleColor = { Admin: '#e74c3c', Editor: '#0F6E56', Viewer: '#888' };
  const initial = (userName || currentUser.email || '?')[0].toUpperCase();

  const renderPage = () => {
    switch (activePage) {
      // Function Menus — Placeholder
      case 'ap-controller':   return <PlaceholderPage title="AP Controller" icon="🧾" />;
      case 'vat-controller':  return <PlaceholderPage title="VAT Controller" icon="💹" />;
      case 'i-expense':       return <PlaceholderPage title="I-Expense" icon="💸" />;
      case 'gl-functional':   return <PlaceholderPage title="GL Functional" icon="📊" />;
      case 'i-pro-interface': return <PlaceholderPage title="I-Pro Interface" icon="🔗" />;
      // Master Data
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

  const navItem = (id, icon, label, indent = 16) => (
    <div key={id} onClick={() => setActivePage(id)}
      style={{ padding: `9px 16px 9px ${indent}px`, cursor: 'pointer', fontSize: '13px', background: activePage === id ? 'rgba(255,255,255,0.1)' : 'transparent', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', color: activePage === id ? 'white' : 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '8px' }}>
      {icon} {label}
    </div>
  );

  const subNavItem = (id, icon, label) => (
    <div key={id} onClick={() => setActivePage(id)}
      style={{ padding: '7px 16px 7px 44px', cursor: 'pointer', fontSize: '12px', background: activePage === id ? 'rgba(93,202,165,0.08)' : 'transparent', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', color: activePage === id ? '#5DCAA5' : 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: '6px' }}>
      {icon} {label}
    </div>
  );

  const groupItem = (isActive, isOpen, onClick, icon, label) => (
    <div onClick={onClick}
      style={{ padding: '9px 16px 9px 28px', cursor: 'pointer', fontSize: '13px', background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent', borderLeft: isActive ? '3px solid #5DCAA5' : '3px solid transparent', color: isActive ? 'white' : 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span>{icon} {label}</span>
      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{isOpen ? '▾' : '▸'}</span>
    </div>
  );

  const sectionLabel = (label, isActive) => (
    <div style={{ padding: '10px 16px', fontSize: '11px', fontWeight: '600', color: isActive ? '#5DCAA5' : 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', textTransform: 'uppercase', userSelect: 'none' }}>
      {label}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>

      {/* Sidebar */}
      <div style={{ width: '200px', background: '#1a3a5c', color: 'white', display: 'flex', flexDirection: 'column' }}>

        {/* Logo */}
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>FAST<span style={{ color: '#5DCAA5' }}>APN</span></div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Link3ase · System</div>
            </div>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#5DCAA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: '700', color: '#1a3a5c', border: '2px solid rgba(255,255,255,0.3)' }}>
              {initial}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>

          {/* Function Menus */}
          {sectionLabel('Functions', isFunctionActive)}
          {FUNCTION_MENUS.map(m => navItem(m.id, m.icon, m.label))}

          <div style={{ margin: '6px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

          {/* Master Data */}
          <div onClick={() => setMasterOpen(o => !o)}
            style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', color: isMasterActive ? '#5DCAA5' : 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            <span>📦 Master Data</span>
            <span style={{ fontSize: '10px' }}>{masterOpen ? '▲' : '▼'}</span>
          </div>

          {masterOpen && (
            <>
              {groupItem(isBuActive, buOpen, () => { setBuOpen(o => !o); if (!isBuActive) setActivePage('bu-info'); }, '🏢', 'Business Unit')}
              {buOpen && (
                <>
                  {subNavItem('bu-info', '📋', 'Info')}
                  {subNavItem('bu-branch', '🏪', 'Branch')}
                </>
              )}

              {groupItem(isCoaActive, coaOpen, () => { setCoaOpen(o => !o); if (!isCoaActive) setActivePage('coa-costcenter'); }, '💰', 'Chart of Accounts')}
              {coaOpen && (
                <>
                  {subNavItem('coa-costcenter', '🏷️', 'Cost Center')}
                  {subNavItem('coa-account', '📒', 'Account')}
                  {subNavItem('coa-subaccount', '🔖', 'Sub Account')}
                </>
              )}

              {groupItem(isVendorActive, vendorOpen, () => { setVendorOpen(o => !o); if (!isVendorActive) setActivePage('vendor-code'); }, '👥', 'Vendor Master')}
              {vendorOpen && (
                <>
                  {subNavItem('vendor-code', '🏭', 'Code')}
                  {subNavItem('vendor-category', '🗂️', 'Category')}
                </>
              )}

              {navItem('itemcode', '🔖', 'Item Code', 28)}
            </>
          )}

          <div style={{ margin: '6px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

          {/* Upload & Gen */}
          {navItem('upload', '📤', 'Upload & Gen')}

        </nav>

        {/* Bottom */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName || currentUser.email}</div>
              <div style={{ fontSize: '11px', color: roleColor[userRole] || '#fff', fontWeight: '500', marginTop: '1px' }}>{userRole}</div>
            </div>
            <button onClick={handleProfileIconClick}
              title={isAdmin ? 'User Management' : 'Profile & Settings'}
              style={{ background: activePage === 'users' && isAdmin ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' && isAdmin ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: activePage === 'users' && isAdmin ? '#5DCAA5' : 'rgba(255,255,255,0.8)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </button>
          </div>
          <button onClick={logout} style={{ width: '100%', padding: '7px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'rgba(255,255,255,0.7)', fontSize: '12px', cursor: 'pointer' }}>
            Logout
          </button>
        </div>

      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', background: '#f5f5f5' }}>
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