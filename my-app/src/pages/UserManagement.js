  import React, { useState, useEffect, useMemo } from 'react';
  import { db } from '../lib/db';
  import { apiFetch } from '../api';
  import { useAuth } from '../contexts/AuthContext';
  import { useUserRole } from '../contexts/useUserRole';
  import DeployMonitor from './DeployMonitor';

  const PERMISSIONS = ['VAT', 'I-Pro', 'GL', 'IE', 'Function', 'Manual'];

  const DEFAULT_PERMISSIONS = {
    Owner:  { VAT: true, 'I-Pro': true, GL: true, IE: true, Function: true, Manual: true },
    Admin:  { VAT: true, 'I-Pro': true, GL: true, IE: true, Function: true, Manual: true },
    Editor: { VAT: true, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: true },
    Viewer: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false }
  };

  const TABLE_LABELS = {
    itemcode_list: 'Item Code', supplier_list: 'Vendor', vendor_category: 'Vendor Category',
    account_list: 'Account', cpc_list: 'Cost Center', sub_acc_list: 'Sub Account',
    branch_list: 'Branch', company_list: 'Company',
  };

  const HARD_DELETE_TABLES = [];
  
  const DOC_FOLDERS = [
    { key: 'ap',   label: 'AP Manual',      icon: '🧾', permKey: 'VAT',   color: '#E6F1FB', textColor: '#0C447C' },
    { key: 'vat',  label: 'VAT Control',    icon: '🧮', permKey: 'VAT',   color: '#EAF3DE', textColor: '#27500A' },
    { key: 'ie',   label: 'I-Expense',      icon: '💸', permKey: 'IE',    color: '#FAEEDA', textColor: '#633806' },
    { key: 'gl',   label: 'GL Report',      icon: '📊', permKey: 'GL',    color: '#EEEDFE', textColor: '#3C3489' },
    { key: 'ipro', label: 'I-Pro Interface',icon: '🔗', permKey: 'I-Pro', color: '#FAECE7', textColor: '#712B13' },
  ];

  const IconTrash = () => ( 
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  );

  function getDaysLeft(deletedAt) {
    const deleted = new Date(deletedAt);
    const expiry = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000);
    return Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));
  }

  function DaysLeftBadge({ deletedAt }) {
    const days = getDaysLeft(deletedAt);
    if (days > 14) return null;
    const bg = days <= 7 ? '#FCEBEB' : '#FFF3CD';
    const color = days <= 7 ? '#791F1F' : '#856404';
    return <span style={{ background: bg, color, fontSize: '10px', padding: '1px 6px', borderRadius: '20px', marginLeft: '4px', fontWeight: '500' }}>{days <= 0 ? 'หมดอายุ' : `${days} วัน`}</span>;
  }

  function Toggle({ value, onChange, disabled, override }) {
    const bg = disabled ? '#e0e0e0' : override === 'block' ? '#e74c3c' : value ? '#0F6E56' : '#ccc';
    return (
      <div onClick={() => !disabled && onChange(!value)}
        style={{ width: '36px', height: '20px', borderRadius: '10px', background: bg, position: 'relative', cursor: disabled ? 'default' : 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: value ? '19px' : '3px', transition: 'left 0.2s' }} />
      </div>
    );
  }

  const FUNCTION_MENU_LIST = [
    { id: 'ap-controller',   icon: '🧾', label: 'AP Controller',   color: '#E6F1FB' },
    { id: 'vat-controller',  icon: '💹', label: 'VAT Controller',  color: '#EAF3DE' },
    { id: 'i-expense',       icon: '💸', label: 'I-Expense',       color: '#FAEEDA' },
    { id: 'gl-functional',   icon: '📊', label: 'GL Functional',   color: '#EEEDFE' },
    { id: 'i-pro-interface', icon: '🔗', label: 'I-Pro Interface', color: '#FAECE7' },
  ];

  function MaintenanceSection({ currentUser, userName }) {
    const [fullMaintenance, setFullMaintenance] = useState(false);
    const [maintenanceMsg, setMaintenanceMsg] = useState('ระบบปิดปรับปรุงชั่วคราว กรุณารอสักครู่');
    const [selectiveMaintenance, setSelectiveMaintenance] = useState(false);
    const [maintenanceMenus, setMaintenanceMenus] = useState([]);
    const [confirmFull, setConfirmFull] = useState(false);
    const [savingMsg, setSavingMsg] = useState(false);

    const fetchSettings = async () => {
      const { data } = await db.from('system_settings').select('*');
      if (data) {
        const full = data.find(d => d.key === 'maintenance_mode');
        const msg = data.find(d => d.key === 'maintenance_message');
        const menus = data.find(d => d.key === 'maintenance_menus');
        if (full) setFullMaintenance(full.value === 'true');
        if (msg) setMaintenanceMsg(msg.value || '');
        if (menus) {
          try {
            const parsed = JSON.parse(menus.value || '[]');
            setMaintenanceMenus(parsed);
            setSelectiveMaintenance(parsed.length > 0);
          } catch { setMaintenanceMenus([]); }
        }
      }
    };

    useEffect(() => { fetchSettings(); }, []);

    const saveSetting = async (key, value) => {
      await db.from('system_settings').upsert(
        [{ key, value: String(value), updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString() }],
        { onConflict: 'key' }
      );
    };

    const handleFullToggle = () => {
      if (!fullMaintenance) setConfirmFull(true);
      else { saveSetting('maintenance_mode', 'false'); setFullMaintenance(false); }
    };

    const handleSelectiveToggle = async (newVal) => {
      setSelectiveMaintenance(newVal);
      if (!newVal) { setMaintenanceMenus([]); await saveSetting('maintenance_menus', '[]'); }
    };

    const handleMenuToggle = async (menuId) => {
      const newMenus = maintenanceMenus.includes(menuId)
        ? maintenanceMenus.filter(m => m !== menuId)
        : [...maintenanceMenus, menuId];
      setMaintenanceMenus(newMenus);
      await saveSetting('maintenance_menus', JSON.stringify(newMenus));
    };

    const handleConfirmFull = async () => {
      await saveSetting('maintenance_mode', 'true');
      setFullMaintenance(true); setConfirmFull(false);
    };

    const ToggleSwitch = ({ value, onChange, color }) => (
      <div onClick={() => onChange(!value)}
        style={{ width: '44px', height: '24px', borderRadius: '12px', background: value ? (color || '#0F6E56') : '#ccc', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: value ? '23px' : '3px', transition: 'left 0.2s' }} />
      </div>
    );

    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>🔧 System Maintenance</div>
        <div style={{ background: fullMaintenance ? '#FCEBEB' : 'white', border: `0.5px solid ${fullMaintenance ? '#f7c1c1' : '#e8e8e8'}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: fullMaintenance ? '#791F1F' : '#1a3a5c', marginBottom: '2px' }}>🔒 Full Maintenance</div>
              <div style={{ fontSize: '11px', color: fullMaintenance ? '#e74c3c' : '#888' }}>
                {fullMaintenance ? '⚠️ ระบบปิดอยู่ — เฉพาะ Owner เข้าได้' : 'ปิดทั้งระบบ — ทุกคนถูก Logout ยกเว้น Owner'}
              </div>
            </div>
            <ToggleSwitch value={fullMaintenance} onChange={handleFullToggle} color="#e74c3c" />
          </div>
          {fullMaintenance && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '0.5px solid #f7c1c1', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input value={maintenanceMsg} onChange={e => setMaintenanceMsg(e.target.value)}
                onBlur={async () => { setSavingMsg(true); await saveSetting('maintenance_message', maintenanceMsg); setSavingMsg(false); }}
                placeholder="ข้อความแสดงให้ User เห็น"
                style={{ flex: 1, padding: '5px 10px', borderRadius: '6px', border: '0.5px solid #f7c1c1', fontSize: '12px', background: 'white' }} />
              {savingMsg && <span style={{ fontSize: '11px', color: '#0F6E56' }}>✅</span>}
            </div>
          )}
        </div>
        <div style={{ background: 'white', border: `0.5px solid ${selectiveMaintenance ? '#ffc107' : '#e8e8e8'}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: selectiveMaintenance ? '12px' : '0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c', marginBottom: '2px' }}>⚙️ Selective Maintenance</div>
              <div style={{ fontSize: '11px', color: '#888' }}>
                {selectiveMaintenance ? `ปิด ${maintenanceMenus.length} Function — คนอื่นยังใช้งานส่วนอื่นได้` : 'ปิดเฉพาะบาง Function — ไม่ต้อง Logout ใคร'}
              </div>
            </div>
            <ToggleSwitch value={selectiveMaintenance} onChange={handleSelectiveToggle} color="#856404" />
          </div>
          {selectiveMaintenance && (
            <div style={{ borderTop: '0.5px solid #f5f5f5', paddingTop: '10px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>Tick เพื่อปิดชั่วคราว — save อัตโนมัติ:</div>
              {FUNCTION_MENU_LIST.map(menu => {
                const isOff = maintenanceMenus.includes(menu.id);
                return (
                  <div key={menu.id} onClick={() => handleMenuToggle(menu.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', background: isOff ? '#fffdf0' : 'transparent', marginBottom: '2px' }}
                    onMouseEnter={e => { if (!isOff) e.currentTarget.style.background = '#f8f9fa'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isOff ? '#fffdf0' : 'transparent'; }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: `1.5px solid ${isOff ? '#e74c3c' : '#ddd'}`, background: isOff ? '#e74c3c' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isOff && <span style={{ color: 'white', fontSize: '11px', lineHeight: 1 }}>✓</span>}
                    </div>
                    <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: isOff ? '#f5f5f5' : menu.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{menu.icon}</div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '12px', color: isOff ? '#888' : '#333', textDecoration: isOff ? 'line-through' : 'none' }}>{menu.label}</span>
                      {isOff && <span style={{ marginLeft: '8px', fontSize: '10px', padding: '1px 6px', borderRadius: '20px', background: '#FFF3CD', color: '#856404' }}>🔧 Maintain</span>}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px', paddingTop: '6px', borderTop: '0.5px solid #f5f5f5' }}>
                💡 Menu ที่ปิดจะซ่อนใน Sidebar ทันที — ไม่ต้อง Logout ใคร
              </div>
            </div>
          )}
        </div>
        {confirmFull && (
          <div style={{ position: 'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }}>
            <div style={{ background:'white', borderRadius:'10px', padding:'24px', width:'380px' }}>
              <h3 style={{ fontSize:'15px', marginBottom:'12px', color:'#791F1F' }}>⚠️ เปิด Full Maintenance</h3>
              <p style={{ fontSize:'13px', color:'#555', marginBottom:'16px' }}>ระบบจะ <strong>ปิดการเข้าถึง</strong> ทุกคน ยกเว้น Owner — ผู้ใช้ที่ login อยู่จะถูก Logout อัตโนมัติภายใน 30 วินาที</p>
              <div style={{ background:'#FFF3CD', border:'0.5px solid #ffc107', borderRadius:'6px', padding:'10px 12px', marginBottom:'16px', fontSize:'12px', color:'#856404' }}>
                💡 ตรวจสอบให้แน่ใจว่าไม่มีใครกำลังทำงานสำคัญอยู่ก่อน
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
                <button onClick={() => setConfirmFull(false)} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#f0f0f0', color:'#555', fontSize:'13px' }}>ยกเลิก</button>
                <button onClick={handleConfirmFull} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#c0392b', color:'white', fontSize:'13px', fontWeight:'500' }}>🔒 เปิด Full Maintenance</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function AccessControlTab({ users, currentUser, userName }) {
    const [overrides, setOverrides] = useState([]);
    const [openFolder, setOpenFolder] = useState(null);
    const [saving, setSaving] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});

    const fetchOverrides = async () => {
      const { data } = await db.from('doc_access_override').select('*');
      setOverrides(data || []);
    };

    useEffect(() => { fetchOverrides(); }, []);



    const getEffective = (user, folderKey) => {
      const folder = DOC_FOLDERS.find(f => f.key === folderKey);

      // ✅ FIX: Owner / Admin เข้าได้เสมอ (ignore override)
      if (user.role === 'Owner') {
        return { allowed: true, hasOverride: false };
      }

      // Admin และ role อื่น — ใช้ permission + override ปกติ
      const baseAccess = user.permissions?.[folder?.permKey] ?? false;

      const override = overrides.find(
        o => o.user_id === user.id && o.folder_key === folderKey
      );

      if (override) {
        return {
          allowed: override.allowed,
          hasOverride: override.allowed !== baseAccess,
        };
      }

      return { allowed: baseAccess, hasOverride: false };
    };



    const getPendingValue = (userId, folderKey) => {
      const key = `${userId}_${folderKey}`;
      if (pendingChanges[key] !== undefined) return pendingChanges[key];
      const user = users.find(u => u.id === userId);
      if (!user) return false;
      return getEffective(user, folderKey).allowed;
    };

    const handleToggle = (userId, folderKey, newValue) => {
      const key = `${userId}_${folderKey}`;
      setPendingChanges(prev => ({ ...prev, [key]: newValue }));
    };

    const handleSaveFolder = async (folderKey) => {
      setSaving(true);
      try {
        const folderChanges = Object.entries(pendingChanges)
          .filter(([k]) => k.endsWith(`_${folderKey}`))
          .map(([k, v]) => ({ userId: k.replace(`_${folderKey}`, ''), allowed: v }));
        for (const { userId, allowed } of folderChanges) {
          const { error } = await db.from('doc_access_override').upsert({
            user_id: userId, folder_key: folderKey, allowed,
            updated_by: userName || currentUser?.email || '',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,folder_key' });
          if (error) throw error;
        }
        setPendingChanges(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => { if (k.endsWith(`_${folderKey}`)) delete next[k]; });
          return next;
        });
        await fetchOverrides();
        setOpenFolder(null);
      } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
      setSaving(false);
    };

    const hasPendingForFolder = (folderKey) => Object.keys(pendingChanges).some(k => k.endsWith(`_${folderKey}`));
    const nonOwnerUsers = users.filter(u => u.role !== 'Owner');

    return (
      <div style={{ paddingTop: '8px' }}>
        <MaintenanceSection currentUser={currentUser} userName={userName} />
        <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', margin: '12px 0 8px' }}>🔐 Document Center Access</div>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px', background: '#f8f9fa', padding: '8px 12px', borderRadius: '6px' }}>
          Override สิทธิ์เข้าถึงแต่ละโฟลเดอร์ได้ — กด ⚙️ เพื่อตั้งค่า
        </div>
        {DOC_FOLDERS.map(folder => {
          const isOpen = openFolder === folder.key;
          const canAccess = nonOwnerUsers.filter(u => getPendingValue(u.id, folder.key));
          const noAccess = nonOwnerUsers.filter(u => !getPendingValue(u.id, folder.key));
          const hasPending = hasPendingForFolder(folder.key);
          return (
            <div key={folder.key} style={{ marginBottom: '8px' }}>
              <div style={{ background: 'white', border: `0.5px solid ${isOpen ? '#1a3a5c' : '#e8e8e8'}`, borderRadius: isOpen ? '8px 8px 0 0' : '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: folder.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>{folder.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>{folder.label}</div>
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                    เข้าถึงได้ {canAccess.length} คน · ไม่มีสิทธิ์ {noAccess.length} คน
                    {hasPending && <span style={{ marginLeft: '6px', color: '#856404', background: '#FFF3CD', padding: '1px 6px', borderRadius: '10px', fontSize: '10px' }}>มีการเปลี่ยนแปลง</span>}
                  </div>
                </div>
                <button onClick={() => setOpenFolder(isOpen ? null : folder.key)}
                  style={{ padding: '5px 10px', borderRadius: '6px', border: `0.5px solid ${isOpen ? '#1a3a5c' : '#ddd'}`, background: isOpen ? '#1a3a5c' : 'white', color: isOpen ? 'white' : '#555', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  ⚙️ {isOpen ? 'ปิด' : 'ตั้งค่า'}
                </button>
              </div>
              {isOpen && (
                <div style={{ background: 'white', border: '0.5px solid #1a3a5c', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '14px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '500', color: '#27500A', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>✅ เข้าถึงได้</div>
                      {canAccess.length === 0 && <div style={{ fontSize: '12px', color: '#aaa' }}>ไม่มี</div>}
                      {canAccess.map(u => {
                        const { hasOverride } = getEffective(u, folder.key);
                        const isPending = pendingChanges[`${u.id}_${folder.key}`] !== undefined;
                        return (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '0.5px solid #f0f0f0' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#EAF3DE', color: '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '500', flexShrink: 0 }}>
                              {(u.username || u.email || '?')[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '12px', fontWeight: '500', color: '#333' }}>{u.username || u.email}</div>
                              <div style={{ fontSize: '10px', color: '#888' }}>
                                {u.role} · {folder.permKey}={u.permissions?.[folder.permKey] ? 'Yes' : 'No'}
                                {(hasOverride || isPending) && <span style={{ marginLeft: '4px', color: '#0F6E56' }}>override</span>}
                              </div>
                            </div>
                            <Toggle value={true} onChange={(v) => handleToggle(u.id, folder.key, v)} />
                          </div>
                        );
                      })}
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '500', color: '#791F1F', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>🚫 ไม่มีสิทธิ์</div>
                      {noAccess.length === 0 && <div style={{ fontSize: '12px', color: '#aaa' }}>ไม่มี</div>}
                      {noAccess.map(u => {
                        const { hasOverride } = getEffective(u, folder.key);
                        const isPending = pendingChanges[`${u.id}_${folder.key}`] !== undefined;
                        return (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '0.5px solid #f0f0f0' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f5f5f5', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '500', flexShrink: 0 }}>
                              {(u.username || u.email || '?')[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '12px', fontWeight: '500', color: '#555' }}>{u.username || u.email}</div>
                              <div style={{ fontSize: '10px', color: '#888' }}>
                                {u.role} · {folder.permKey}={u.permissions?.[folder.permKey] ? 'Yes' : 'No'}
                                {(hasOverride || isPending) && <span style={{ marginLeft: '4px', color: '#e74c3c' }}>override</span>}
                              </div>
                            </div>
                            <Toggle value={false} onChange={(v) => handleToggle(u.id, folder.key, v)} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ borderTop: '0.5px solid #f0f0f0', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#888' }}>💡 Toggle เปิด/ปิด แล้วกด บันทึก — Owner/Admin เข้าได้เสมอ</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setOpenFolder(null); setPendingChanges(prev => { const next = { ...prev }; Object.keys(next).forEach(k => { if (k.endsWith(`_${folder.key}`)) delete next[k]; }); return next; }); }}
                        style={{ padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '12px', cursor: 'pointer' }}>ยกเลิก</button>
                      <button onClick={() => handleSaveFolder(folder.key)} disabled={saving || !hasPending}
                        style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: hasPending ? '#1a3a5c' : '#ccc', color: 'white', fontSize: '12px', cursor: hasPending ? 'pointer' : 'default', fontWeight: '500' }}>
                        {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Recycle Bin Tab ──────────────────────────────────────────────────────────
  function RecycleBinTab({ currentUser, userName, fetchBinCount }) {
    const [bins, setBins] = useState([]);
    const [selected, setSelected] = useState([]);
    const [filterTable, setFilterTable] = useState('');
    const [filterBy, setFilterBy] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [viewItem, setViewItem] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressLabel, setProgressLabel] = useState('');
    const [progressDone, setProgressDone] = useState(0);

    const fetchBins = async () => {
      let allData = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await db
          .from('recycle_bin')
          .select('*')
          .order('deleted_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        allData = [...allData, ...data];
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setBins(allData);
    };
      
useEffect(() => {
  fetchBins();
  fetchBinCount();

  // polling แทน realtime (refresh ทุก 30 วินาที)
  const interval = setInterval(() => {
    fetchBins();
    fetchBinCount();
  }, 30000);

  return () => clearInterval(interval);
}, []);


    const deletedByOptions = useMemo(() => [...new Set(bins.map(b => b.deleted_by).filter(Boolean))], [bins]);

    const filtered = useMemo(() => bins.filter(b => {
      if (filterTable && b.source_table !== filterTable) return false;
      if (filterBy && b.deleted_by !== filterBy) return false;
      if (fromDate && new Date(b.deleted_at) < new Date(fromDate)) return false;
      if (toDate && new Date(b.deleted_at) > new Date(toDate + 'T23:59:59')) return false;
      return true;
    }), [bins, filterTable, filterBy, fromDate, toDate]);

    const allSelected = filtered.length > 0 && filtered.every(i => selected.includes(i.id));
    const someSelected = filtered.some(i => selected.includes(i.id)) && !allSelected;

    const toggleSelectAll = () => {
      if (allSelected) {
        // uncheck ทั้งหมด
        setSelected([]);
      } else {
        // เลือกทั้งหมดใน filtered
        setSelected(filtered.map(i => i.id));
      }
    };

    const toggleOne = (id) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);


    const handleRestore = async (item) => {
      setLoading(true);
      try {
        const data = { ...item.data };
        delete data.deleted;
        delete data.deleted_by;
        delete data.deleted_at;
        const { error } = await db
          .from(item.source_table)
          .insert([{ ...data, id: item.source_id }]);
        if (error) throw error;
        await db.from('recycle_bin').delete().eq('id', item.id);
        setSelected(prev => prev.filter(s => s !== item.id));
        fetchBins();
        fetchBinCount();
        alert('✅ Restore สำเร็จ');
      } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
      setLoading(false);
    };


    // ✅ Batch Restore — group by table, batch .in() ทีละ 100

    const handleBulkRestore = async () => {
      setLoading(true);
      setProgress(0);
      setProgressDone(0);
      setProgressLabel('');
      try {
        const targets = bins.filter(b => selected.includes(b.id));
        const total = targets.length;
        let done = 0;
        const grouped = {};
        targets.forEach(item => {
          if (!grouped[item.source_table]) grouped[item.source_table] = [];
          grouped[item.source_table].push(item);
        });
        const BATCH = 500;
        for (const [table, items] of Object.entries(grouped)) {
          setProgressLabel(`กำลัง Restore ${TABLE_LABELS[table] || table}`);
          for (let i = 0; i < items.length; i += BATCH) {
            const chunk = items.slice(i, i + BATCH);
            const rows = chunk.map(item => {
              const data = { ...item.data };
              delete data.deleted;
              delete data.deleted_by;
              delete data.deleted_at;
              return { ...data, id: item.source_id };
            });
            const { error } = await db.from(table).insert(rows);
            if (error) throw error;
            done += chunk.length;
            setProgressDone(done);
            setProgress(Math.round((done / total) * 100));
          }
        }
        const binIds = targets.map(b => b.id);
        for (let i = 0; i < binIds.length; i += 500) {
          const { error } = await db.from('recycle_bin').delete().in('id', binIds.slice(i, i + 500));
          if (error) throw error;
        }
        setSelected([]);
        fetchBins();
        fetchBinCount();
        alert(`✅ Restore สำเร็จ ${total} รายการ`);
      } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
      setLoading(false);
      setProgress(0);
      setProgressDone(0);
      setProgressLabel('');
    };


    const handleDeletePermanent = async (item) => {
      setLoading(true);
      try {
        // ข้าม delete source สำหรับ hard-delete tables
        if (!HARD_DELETE_TABLES.includes(item.source_table)) {
          await db.from(item.source_table).delete().eq('id', item.source_id);
        }
        await db.from('recycle_bin').delete().eq('id', item.id);
        setConfirmDelete(null);
        setSelected(prev => prev.filter(s => s !== item.id));
        fetchBins();
        fetchBinCount();
      } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
      setLoading(false);
    };
    // ✅ Batch Permanent Delete — group by table, batch .in() ทีละ 100
      const handleBulkDeletePermanent = async () => {
      setLoading(true);
      setProgress(0);
      setProgressDone(0);
      setProgressLabel('');
      try {
        const targets = bins.filter(b => selected.includes(b.id));
        const total = targets.length;
        let done = 0;
        const byTable = {};
        targets.forEach(item => {
          if (!byTable[item.source_table]) byTable[item.source_table] = [];
          byTable[item.source_table].push(item.source_id);
        });
        const BATCH = 500;
        for (const [table, ids] of Object.entries(byTable)) {
          // ข้าม hard-delete tables
          if (HARD_DELETE_TABLES.includes(table)) {
            done += ids.length;
            setProgressDone(done);
            setProgress(Math.round((done / total) * 100));
            continue;
          }
          setProgressLabel(`กำลังลบ ${TABLE_LABELS[table] || table}`);
          for (let i = 0; i < ids.length; i += BATCH) {
            const chunk = ids.slice(i, i + BATCH);
            const { error } = await db.from(table).delete().in('id', chunk);
            if (error) throw error;
            done += chunk.length;
            setProgressDone(done);
            setProgress(Math.round((done / total) * 100));
          }
        }
        const binIds = targets.map(b => b.id);
        for (let i = 0; i < binIds.length; i += 500) {
          const { error } = await db.from('recycle_bin').delete().in('id', binIds.slice(i, i + 500));
          if (error) throw error;
        }
        setSelected([]);
        setConfirmBulkDelete(false);
        fetchBins();
        fetchBinCount();
        alert(`✅ ลบถาวรสำเร็จ ${total} รายการ`);
      } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
      setLoading(false);
      setProgress(0);
      setProgressDone(0);
      setProgressLabel('');
    };

    const formatDate = (val) => {
      if (!val) return '-';
      const d = new Date(new Date(val).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    const S = {
      th: { background: '#1a3a5c', color: 'white', padding: '9px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' },
      thCenter: { background: '#1a3a5c', color: 'white', padding: '9px 12px', textAlign: 'center', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' },
      td: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', fontSize: '12px', verticalAlign: 'middle' },
      tdCenter: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', fontSize: '12px', verticalAlign: 'middle', textAlign: 'center' },
      btn: (bg, color, border) => ({ padding: '3px 10px', borderRadius: '5px', border: `0.5px solid ${border||bg}`, fontSize: '11px', cursor: 'pointer', background: bg, color, fontWeight: '500' }),
      filterSelect: { padding: '5px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white' },
    };

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', flexWrap: 'wrap', borderBottom: '0.5px solid #f0f0f0' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>{filtered.length} รายการ</span>
          {selected.length > 0 && (
            <>
              <button onClick={handleBulkRestore} disabled={loading}
                style={{ padding: '4px 12px', borderRadius: '6px', border: '0.5px solid #97C459', fontSize: '12px', cursor: 'pointer', background: '#EAF3DE', color: '#27500A', fontWeight: '500' }}>
                {loading ? `↩ Restoring... ${progress}%` : `↩ Restore ${selected.length} รายการ`}
              </button>
              <button onClick={() => setConfirmBulkDelete(true)} disabled={loading}
                style={{ padding: '4px 12px', borderRadius: '6px', border: '0.5px solid #f7c1c1', fontSize: '12px',
                cursor: loading ? 'default' : 'pointer',
                background: '#FCEBEB', color: loading ? '#f7c1c1' : '#791F1F', fontWeight: '500' }}>
                🗑️ ลบถาวร {selected.length} รายการ
              </button>
                {selected.length > 0 && selected.length < filtered.length && (
                  <button onClick={() => setSelected(filtered.map(i => i.id))}
                    style={{ fontSize: '12px', color: '#1a3a5c', background: '#e8f0fb', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
                    เลือกทั้งหมด {filtered.length} รายการ
                  </button>
                )}
              <button onClick={() => setSelected([])}
                style={{ padding: '4px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: 'pointer', background: '#f5f5f5', color: '#555' }}>
                ✕ ยกเลิก
              </button>
            </>
          )}
          
          <select value={filterTable} onChange={e => setFilterTable(e.target.value)} style={S.filterSelect}>
            <option value="">Table ทั้งหมด</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterBy} onChange={e => setFilterBy(e.target.value)} style={S.filterSelect}>
            <option value="">ลบโดย ทั้งหมด</option>
            {deletedByOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>จาก</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ ...S.filterSelect, width: '140px' }} />
            <span style={{ fontSize: '12px', color: '#888' }}>ถึง</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ ...S.filterSelect, width: '140px' }} />
          </div>
          {(filterTable || filterBy || fromDate || toDate) && (
            <button onClick={() => { setFilterTable(''); setFilterBy(''); setFromDate(''); setToDate(''); }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: 'pointer', background: '#f5f5f5', color: '#555' }}>✕ ล้าง</button>
          )}
        </div>

        <div style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px', border: '0.5px solid #e8e8e8', borderTop: 'none' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '800px' }}>
            <thead>
              <tr>
                <th style={{ ...S.thCenter, width: '36px' }}>
                  <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll}
                    />
                </th>
                <th style={{ ...S.th, width: '110px' }}>Table</th>
                <th style={{ ...S.th, width: '130px' }}>Key</th>
                <th style={S.th}>ข้อมูลหลัก</th>
                <th style={{ ...S.th, width: '100px' }}>ลบโดย</th>
                <th style={{ ...S.th, width: '150px' }}>ลบเมื่อ</th>
                <th style={{ ...S.thCenter, width: '160px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>ไม่มีรายการใน Recycle Bin</td></tr>}
              {filtered.map(item => {
                const label = TABLE_LABELS[item.source_table] || item.source_table;
                const daysLeft = getDaysLeft(item.deleted_at);
                const isSelected = selected.includes(item.id);
                return (
                  <tr key={item.id} style={{ background: isSelected ? '#f0f7ff' : daysLeft <= 7 ? '#fffdf5' : 'white' }}>
                    <td style={S.tdCenter}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(item.id)} />
                    </td>
                    <td style={S.td}><span style={{ background: '#f0f0f0', color: '#555', fontSize: '10px', padding: '2px 8px', borderRadius: '20px' }}>{label}</span></td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '11px' }}>{item.source_key || '-'}</td>
                    <td style={{ ...S.td, color: '#666', fontSize: '11px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.data?.description || item.data?.['Account_Name'] || item.data?.Name || item.data?.['THAI COMPANY NAME'] || item.data?.['Branch Code'] || JSON.stringify(item.data).slice(0,60) + '...'}
                    </td>
                    <td style={{ ...S.td, fontSize: '11px' }}>{item.deleted_by || '-'}</td>
                    <td style={{ ...S.td, fontSize: '11px' }}>{formatDate(item.deleted_at)}<DaysLeftBadge deletedAt={item.deleted_at} /></td>
                    <td style={S.tdCenter}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button onClick={() => setViewItem(item)} style={S.btn('#f5f5f5','#555','#ddd')}>🔍 ดู</button>
                        <button onClick={() => handleRestore(item)} disabled={loading} style={S.btn('#EAF3DE','#27500A','#97C459')}>↩</button>
                        <button onClick={() => setConfirmDelete(item)} disabled={loading} style={S.btn('#FCEBEB','#791F1F','#f7c1c1')}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {viewItem && (
          <div style={{ position: 'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }}>
            <div style={{ background:'white', borderRadius:'10px', padding:'20px', width:'480px', maxHeight:'80vh', display:'flex', flexDirection:'column' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                <h3 style={{ fontSize:'14px', margin:0 }}>🔍 {TABLE_LABELS[viewItem.source_table]} — {viewItem.source_key}</h3>
                <button onClick={() => setViewItem(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#888' }}>×</button>
              </div>
              <div style={{ overflowY:'auto', flex:1, background:'#f8f9fa', borderRadius:'6px', padding:'12px' }}>
                {Object.entries(viewItem.data || {}).filter(([k]) => !['deleted','deleted_by','deleted_at'].includes(k)).map(([k,v]) => (
                  <div key={k} style={{ display:'flex', gap:'8px', padding:'4px 0', borderBottom:'0.5px solid #eee', fontSize:'12px' }}>
                    <span style={{ color:'#888', minWidth:'130px', flexShrink:0 }}>{k}</span>
                    <span style={{ color:'#333' }}>{String(v||'-')}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:'8px', marginTop:'12px', justifyContent:'flex-end' }}>
                <button onClick={() => { handleRestore(viewItem); setViewItem(null); }} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#EAF3DE', color:'#27500A', fontSize:'13px', fontWeight:'500' }}>↩ Restore</button>
                <button onClick={() => setViewItem(null)} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#f0f0f0', color:'#555', fontSize:'13px' }}>Close</button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }}>
            <div style={{ background:'white', borderRadius:'10px', padding:'24px', width:'380px' }}>
              <h3 style={{ fontSize:'15px', marginBottom:'12px' }}>🗑️ ลบถาวร</h3>
              <p style={{ fontSize:'13px', color:'#555', marginBottom:'16px' }}>ต้องการลบ <strong>{confirmDelete.source_key}</strong> จาก <strong>{TABLE_LABELS[confirmDelete.source_table]}</strong> ถาวรหรือไม่?</p>
              <div style={{ background:'#FCEBEB', border:'0.5px solid #f7c1c1', borderRadius:'6px', padding:'10px 12px', marginBottom:'16px', fontSize:'12px', color:'#791F1F' }}>⚠️ ไม่สามารถกู้คืนได้</div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
                <button onClick={() => setConfirmDelete(null)} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#f0f0f0', color:'#555', fontSize:'13px' }}>Cancel</button>
                <button onClick={() => handleDeletePermanent(confirmDelete)} disabled={loading} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', background:'#c0392b', color:'white', fontSize:'13px', fontWeight:'500' }}>ลบถาวร</button>
              </div>
            </div>
          </div>
        )}

        {confirmBulkDelete && (
          <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }}>
            <div style={{ background:'white', borderRadius:'10px', padding:'24px', width:'380px' }}>
              <h3 style={{ fontSize:'15px', marginBottom:'12px' }}>🗑️ ลบถาวร {selected.length} รายการ</h3>

              {!loading ? (
                <>
                  <p style={{ fontSize:'13px', color:'#555', marginBottom:'16px' }}>ต้องการลบ <strong>{selected.length} รายการ</strong> ถาวรหรือไม่?</p>
                  <div style={{ background:'#FCEBEB', border:'0.5px solid #f7c1c1', borderRadius:'6px', padding:'10px 12px', marginBottom:'16px', fontSize:'12px', color:'#791F1F' }}>⚠️ ไม่สามารถกู้คืนได้ทั้งหมด</div>
                </>
              ) : (
                <>
                  <p style={{ fontSize:'13px', color:'#555', marginBottom:'16px' }}>กำลังดำเนินการ กรุณารอสักครู่...</p>
                  <div style={{ marginBottom:'16px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                      <span style={{ fontSize:'12px', color:'#555' }}>{progressLabel}</span>
                      <span style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>{progress}%</span>
                    </div>
                    <div style={{ background:'#f0f0f0', borderRadius:'20px', height:'8px', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:'20px', background:'linear-gradient(90deg, #5DCAA5, #1a3a5c)', width:`${progress}%`, transition:'width 0.3s ease' }}/>
                    </div>
                    <div style={{ fontSize:'11px', color:'#888', marginTop:'5px', textAlign:'right' }}>{progressDone} / {selected.length} รายการ</div>
                  </div>
                </>
              )}

              <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
                <button onClick={() => setConfirmBulkDelete(false)} disabled={loading} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor: loading ? 'default':'pointer', background:'#f0f0f0', color: loading ? '#ccc':'#555', fontSize:'13px' }}>Cancel</button>
                <button onClick={handleBulkDeletePermanent} disabled={loading} style={{ padding:'7px 14px', borderRadius:'6px', border:'none', cursor: loading ? 'default':'pointer', background: loading ? '#ccc':'#c0392b', color:'white', fontSize:'13px', fontWeight:'500' }}>
                  {loading ? 'กำลังลบ...' : 'ลบถาวรทั้งหมด'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const FOLDER_PERM_MAP = { ap: 'VAT', vat: 'VAT', ie: 'IE', gl: 'GL', ipro: 'I-Pro' };

  function ActivityLogTab({ currentUserRole, currentUserPermissions }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterAction, setFilterAction] = useState('');
    const [filterUser, setFilterUser] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const isOwner = currentUserRole === 'Owner';

    const ACTION_LABELS = {
      login: { label: 'Login', bg: '#EAF3DE', color: '#27500A', icon: '🔑' },
      logout: { label: 'Logout', bg: '#f5f5f5', color: '#555', icon: '🚪' },
      LOGIN: { label: 'Login', bg: '#EAF3DE', color: '#27500A', icon: '🔑' },
      BATCH_SEND: { label: 'Batch Send', bg: '#E6F1FB', color: '#0C447C', icon: '📤' },
      BATCH_ACCEPT: { label: 'Batch Accept', bg: '#EAF3DE', color: '#27500A', icon: '✅' },
      BATCH_REJECT: { label: 'Batch Reject', bg: '#FCEBEB', color: '#791F1F', icon: '❌' },
      ACCESS_APPROVE: { label: 'Access Approve', bg: '#EAF3DE', color: '#27500A', icon: '🔓' },
      ACCESS_REJECT: { label: 'Access Reject', bg: '#FCEBEB', color: '#791F1F', icon: '🚫' },
      open_file: { label: 'เปิดไฟล์', bg: '#E6F1FB', color: '#0C447C', icon: '🔗' },
      download_file: { label: 'Download', bg: '#e8f0fb', color: '#1a3a5c', icon: '⬇️' },
      add_file: { label: 'เพิ่มไฟล์', bg: '#EAF3DE', color: '#27500A', icon: '➕' },
      delete_file: { label: 'ลบไฟล์', bg: '#FCEBEB', color: '#791F1F', icon: '🗑️' },
      maintenance_on: { label: 'เปิด Maintenance', bg: '#FCEBEB', color: '#791F1F', icon: '🔧' },
      maintenance_off: { label: 'ปิด Maintenance', bg: '#EAF3DE', color: '#27500A', icon: '✅' },
    };

    const canSeeLog = (log) => {
      if (isOwner) return true;
      if (['login', 'logout', 'maintenance_on', 'maintenance_off'].includes(log.action)) return true;
      const folderKey = log.detail?.folder;
      if (folderKey) {
        const permKey = FOLDER_PERM_MAP[folderKey];
        return permKey ? (currentUserPermissions?.[permKey] === true) : false;
      }
      return true;
    };

    const fetchLogs = async () => {
      setLoading(true);
      try {
        const data = await apiFetch('/activity_log?order=created_at.desc&limit=200');
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) { console.error(err); }
      setLoading(false);
    };

    useEffect(() => { fetchLogs(); }, []);

    const userOptions = [...new Set(logs.map(l => l.username).filter(Boolean))];
    const filtered = logs.filter(log => {
      if (!canSeeLog(log)) return false;
      if (filterAction && log.action !== filterAction) return false;
      if (filterUser && log.username !== filterUser) return false;
      if (fromDate && new Date(log.created_at) < new Date(fromDate)) return false;
      if (toDate && new Date(log.created_at) > new Date(toDate + 'T23:59:59')) return false;
      return true;
    });

    const formatDate = (val) => {
      if (!val) return '-';
      const d = new Date(new Date(val).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    const S = {
      th: { background: '#1a3a5c', color: 'white', padding: '9px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' },
      td: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', fontSize: '12px', verticalAlign: 'middle' },
      filterSelect: { padding: '5px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white' },
    };

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0 8px', flexWrap: 'wrap', borderBottom: '0.5px solid #f0f0f0', marginBottom: '0' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>{filtered.length} รายการ</span>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={S.filterSelect}>
            <option value="">Action ทั้งหมด</option>
            <option value="BATCH_SEND">📤 Batch Send</option>
            <option value="BATCH_ACCEPT">✅ Batch Accept</option>
            <option value="BATCH_REJECT">❌ Batch Reject</option>
            <option value="LOGIN">🔑 Login</option>
            <option value="ACCESS_APPROVE">🔓 Access Approve</option>
            <option value="ACCESS_REJECT">🚫 Access Reject</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={S.filterSelect}>
            <option value="">User ทั้งหมด</option>
            {userOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>จาก</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ ...S.filterSelect, width: '140px' }} />
            <span style={{ fontSize: '12px', color: '#888' }}>ถึง</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ ...S.filterSelect, width: '140px' }} />
          </div>
          {(filterAction || filterUser || fromDate || toDate) && (
            <button onClick={() => { setFilterAction(''); setFilterUser(''); setFromDate(''); setToDate(''); }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: 'pointer', background: '#f5f5f5', color: '#555' }}>✕ ล้าง</button>
          )}
          <button onClick={fetchLogs} style={{ padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: 'pointer', background: 'white', color: '#555', marginLeft: 'auto' }}>🔄 Refresh</button>
          {!isOwner && <span style={{ fontSize: '11px', color: '#888', background: '#f8f9fa', padding: '3px 8px', borderRadius: '20px' }}>📋 แสดงเฉพาะ Log ที่คุณมีสิทธิ์</span>}
        </div>
        <div style={{ overflowX: 'auto', border: '0.5px solid #e8e8e8', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '700px' }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: '130px' }}>เวลา</th>
                <th style={{ ...S.th, width: '90px' }}>User</th>
                <th style={{ ...S.th, width: '80px' }}>Module</th>
                <th style={{ ...S.th, width: '120px' }}>Action</th>
                <th style={S.th}>รายละเอียด</th>
                <th style={{ ...S.th, width: '100px' }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#aaa' }}>กำลังโหลด...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>ยังไม่มี Activity Log ครับ</td></tr>}
              {!loading && filtered.map(log => {
                const actionInfo = ACTION_LABELS[log.action] || { label: log.action, bg: '#f5f5f5', color: '#555', icon: '📝' };
                return (
                  <tr key={log.id} style={{ background: 'white' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fbff'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <td style={{ ...S.td, color: '#888', fontSize: '11px' }}>{formatDate(log.created_at)}</td>
                    <td style={S.td}>
                      <div style={{ fontWeight: '500', color: '#1a3a5c' }}>{log.username || '—'}</div>
                    </td>
                    <td style={S.td}>
                      {log.module ? (
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: '#e8f0fb', color: '#0C447C', fontWeight: '500' }}>{log.module}</span>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: actionInfo.bg, color: actionInfo.color, fontWeight: '500', whiteSpace: 'nowrap' }}>
                        {actionInfo.icon} {actionInfo.label}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: '#555', fontSize: '11px' }}>
                      {(() => {
                        const d = typeof log.detail === 'string' ? (() => { try { return JSON.parse(log.detail); } catch { return {}; } })() : (log.detail || {});
                        if (d.count) return `${d.count} invoices${d.note ? ` · "${d.note}"` : ''}`;
                        return log.target || '—';
                      })()}
                    </td>
                    <td style={S.td}>
                      {log.received_by ? (
                        <span style={{ fontSize: '11px', color: '#0C447C', fontWeight: '500' }}>{log.received_by}</span>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function ProfileInline({ currentUser, userName }) {
    const [username, setUsername] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [error, setError] = React.useState('');
    const [success, setSuccess] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const fileRef = React.useRef();
    const [avatarPreview, setAvatarPreview] = React.useState(null);
    const [currentUsername, setCurrentUsername] = React.useState('');

    React.useEffect(() => {
      const fetchUser = async () => {
        const { data } = await db.from('user_roles').select('username').eq('email', currentUser?.email).single();
        if (data) { setCurrentUsername(data.username || ''); setUsername(data.username || ''); }
      };
      fetchUser();
    }, []);

    const handleAvatarChange = (e) => {
      const file = e.target.files[0];
      if (file) { const reader = new FileReader(); reader.onloadend = () => setAvatarPreview(reader.result); reader.readAsDataURL(file); }
    };

    const handleSave = async () => {
      setError(''); setSuccess('');
      if (newPassword && newPassword !== confirmPassword) { setError('Password ใหม่ไม่ตรงกันครับ'); return; }
      if (newPassword && newPassword.length < 6) { setError('Password ต้องมีอย่างน้อย 6 ตัวอักษรครับ'); return; }
      setLoading(true);
      try {
        if (newPassword) {
          const res = await apiFetch('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ newPassword }),
          });
          if (!res?.ok) throw new Error(res?.error || 'เปลี่ยน password ไม่สำเร็จ');
        }
        const { error: roleError } = await db.from('user_roles').update({ username: username.trim().toLowerCase() }).eq('email', currentUser?.email);
        if (roleError) throw roleError;
        setSuccess('บันทึกข้อมูลสำเร็จแล้วครับ!');
        setNewPassword(''); setConfirmPassword('');
      } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
      setLoading(false);
    };

    const initials = (currentUsername || currentUser?.email || '?')[0].toUpperCase();
    const S = {
      label: { display: 'block', fontSize: '12px', color: '#666', marginBottom: '5px', fontWeight: '500' },
      input: { width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', marginBottom: '14px', boxSizing: 'border-box' },
    };

    return (
      <div style={{ maxWidth: '480px' }}>
        {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '10px', borderRadius: '8px', fontSize: '12px', marginBottom: '14px' }}>{error}</div>}
        {success && <div style={{ background: '#EAF3DE', color: '#27500A', padding: '10px', borderRadius: '8px', fontSize: '12px', marginBottom: '14px' }}>{success}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', padding: '14px 16px', background: 'white', borderRadius: '10px', border: '0.5px solid #e8e8e8' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="avatar" style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #e0e0e0' }} />
              : <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: '600', color: 'white' }}>{initials}</div>
            }
            <button onClick={() => fileRef.current.click()}
              style={{ position: 'absolute', bottom: 0, right: 0, width: '22px', height: '22px', borderRadius: '50%', background: '#5DCAA5', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'white', lineHeight: 1 }}>+</button>
          </div>
          <input type="file" accept="image/*" ref={fileRef} onChange={handleAvatarChange} style={{ display: 'none' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>{currentUsername || currentUser?.email}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>Admin</div>
            <div style={{ fontSize: '11px', color: '#aaa' }}>{currentUser?.email}</div>
          </div>
        </div>
        <div style={{ background: 'white', borderRadius: '10px', border: '0.5px solid #e8e8e8', padding: '16px 20px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a3a5c', marginBottom: '12px' }}>ข้อมูลทั่วไป</div>
          <label style={S.label}>Username</label>
          <input style={S.input} value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" />
          <label style={S.label}>Email</label>
          <input style={{ ...S.input, background: '#f5f5f5', color: '#999', cursor: 'not-allowed', marginBottom: '0' }}
            type="email" value={currentUser?.email || ''} disabled />
        </div>
        <div style={{ background: 'white', borderRadius: '10px', border: '0.5px solid #e8e8e8', padding: '16px 20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a3a5c', marginBottom: '12px' }}>เปลี่ยน Password</div>
          <label style={S.label}>Password ใหม่</label>
          <input style={S.input} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" />
          <label style={S.label}>ยืนยัน Password ใหม่</label>
          <input style={{ ...S.input, marginBottom: 0 }} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="พิมพ์ Password ใหม่อีกครั้ง" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSave} disabled={loading}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>
            {loading ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    );
  }

  function AdminView({ currentUser, userName, userRole, userPermissions, S }) {
    const [tab, setTab] = React.useState('profile');
    return (
      <div style={S.container}>
        <div style={S.topbar}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>⚙️ System Console</h2>
        </div>
        <div style={{ borderBottom: '2px solid #e8e8e8', display: 'flex', marginBottom: '0' }}>
          <button style={S.tabBtn(tab === 'profile')} onClick={() => setTab('profile')}>👤 Profile</button>
          <button style={S.tabBtn(tab === 'activity')} onClick={() => setTab('activity')}>📋 Activity Log</button>
        </div>
        <div style={{ paddingTop: '16px' }}>
          {tab === 'profile' && <ProfileInline currentUser={currentUser} userName={userName} />}
          {tab === 'activity' && <ActivityLogTab currentUserRole={userRole} currentUserPermissions={userPermissions} />}
        </div>
      </div>
    );
  }

  // ─── Main ─────────────────────────────────────────────────────────────────────
  function UserManagement() {
    const [tab, setTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [userSearch, setUserSearch] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [binCount, setBinCount] = useState(0);
    const [showForm, setShowForm] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [form, setForm] = useState({ email: '', password: '', username: '', role: 'Editor' });
    const [error, setError] = useState('');
    const [savedId, setSavedId] = useState(null);
    const { currentUser, userName, userPermissions } = useAuth();
    const { isOwner } = useUserRole();
    const { userRole } = useAuth();

    const filteredUsers = users.filter(u => {
      const matchSearch = !userSearch || (u.username?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase()));
      const matchRole = !filterRole || u.role === filterRole;
      return matchSearch && matchRole;
    });

    const fetchUsers = async () => {
      const ROLE_ORDER = { Owner: 1, Admin: 2, Editor: 3, Viewer: 4 };
      const { data } = await db.from('user_roles').select('*');
      const sorted = (data || []).sort((a, b) => (ROLE_ORDER[a.role]||5) - (ROLE_ORDER[b.role]||5));
      setUsers(sorted);
    };

    const fetchBinCount = async () => {
      const { count } = await db.from('recycle_bin').select('*', { count: 'exact', head: true });
      setBinCount(count || 0);
    };

    useEffect(() => { fetchUsers(); fetchBinCount(); }, []);

    const S = {
      container: { padding: '20px' },
      topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
      btn: { padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' },
      th: { background: '#1a3a5c', color: 'white', padding: '10px 12px', textAlign: 'center', fontWeight: '500', whiteSpace: 'nowrap' },
      thLeft: { background: '#1a3a5c', color: 'white', padding: '10px 12px', textAlign: 'left', fontWeight: '500' },
      td: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center', verticalAlign: 'middle' },
      tdLeft: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'left', verticalAlign: 'middle' },
      yes: { background: '#EAF3DE', color: '#27500A', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', border: 'none', cursor: 'pointer', width: '52px' },
      no: { background: '#FCEBEB', color: '#791F1F', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', border: 'none', cursor: 'pointer', width: '52px' },
      input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box' },
      overlay: { position: 'fixed', top:0, left:0, right:0, bottom:0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
      modal: { background: 'white', borderRadius: '10px', padding: '24px', width: '420px', maxHeight: '90vh', overflowY: 'auto' },
      iconBtn: (color) => ({ background: 'none', border: 'none', cursor: 'pointer', color, padding: '4px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center' }),
      tabBtn: (active) => ({ padding: '8px 20px', fontSize: '13px', cursor: 'pointer', color: active ? '#1a3a5c' : '#888', borderBottom: active ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom: '-2px', background: 'transparent', border: 'none', fontWeight: active ? '500' : '400', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }),
    };

    const isAdmin = !isOwner && userRole === 'Admin';

    if (!isOwner && !isAdmin) {
      return (
        <div style={S.container}>
          <div style={S.topbar}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>👤 Profile</h2>
          </div>
          <ProfileInline currentUser={currentUser} userName={userName} />
        </div>
      );
    }

    if (isAdmin) {
      return <AdminView currentUser={currentUser} userName={userName} userRole={userRole} userPermissions={userPermissions} S={S} />;
    }

    const saveUser = async (user) => {
      const { error } = await db.from('user_roles').update({ role: user.role, permissions: user.permissions, updated_by: currentUser?.email }).eq('id', user.id);
      if (error) { setError('บันทึกไม่สำเร็จ: ' + error.message); return; }
      setSavedId(user.id);
      setTimeout(() => setSavedId(null), 2000);
    };

    const handleRoleChange = (id, newRole) => {
      setUsers(prev => {
        const updated = prev.map(u => u.id === id
          ? { ...u, role: newRole }  // ← ไม่แตะ permissions
          : u
        );
        saveUser(updated.find(u => u.id === id));
        return updated;
      });
    };

    const handlePermissionChange = (id, perm, value) => {
      setUsers(prev => { const updated = prev.map(u => u.id !== id ? u : { ...u, permissions: { ...(u.permissions||{}), [perm]: value } }); saveUser(updated.find(u => u.id === id)); return updated; });
    };

  const handleAdd = async () => {
    setError('');
    try {
      const result = await apiFetch('/auth/admin/create-user', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          email:    form.email,
          password: form.password,
          role:     form.role,
        }),
      });
      if (!result?.ok) throw new Error(result?.error || 'สร้าง user ไม่สำเร็จ');
      setShowForm(false); setForm({ email: '', password: '', username: '', role: 'Editor' }); fetchUsers();
    } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
  };

  const handleDelete = async () => {
    try {
      const result = await apiFetch('/auth/admin/delete-user', {
        method: 'DELETE',
        body: JSON.stringify({ email: deleteTarget.email }),
      });
      if (!result?.ok) throw new Error(result?.error || 'ลบ user ไม่สำเร็จ');
      setDeleteTarget(null); fetchUsers();
    } catch (err) { setError('เกิดข้อผิดพลาด: ' + err.message); }
  };

    const roleColor = { Owner: '#27500A', Admin: '#1a3a5c', Editor: '#0F6E56', Viewer: '#888' };
    const roleBg = { Owner: '#EAF3DE', Admin: '#e8f0fb', Editor: '#f0faf6', Viewer: '#f5f5f5' };

    return (
      <div style={S.container}>
        <div style={S.topbar}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>⚙️ System Console</h2>
          {tab === 'users' && <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setError(''); }}>+ Add User</button>}
        </div>

        {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        <div style={{ borderBottom: '2px solid #e8e8e8', display: 'flex', marginBottom: '0' }}>
          <button style={S.tabBtn(tab === 'users')} onClick={() => setTab('users')}>
            👥 Users
            <span style={{ background: tab==='users'?'#1a3a5c':'#e8e8e8', color: tab==='users'?'white':'#888', fontSize: '10px', padding: '1px 6px', borderRadius: '20px' }}>{users.length}</span>
          </button>
          <button style={S.tabBtn(tab === 'access')} onClick={() => setTab('access')}>🔐 Access Control</button>
          <button style={S.tabBtn(tab === 'recycle')} onClick={() => setTab('recycle')}>
            🗑️ Recycle Bin
            {binCount > 0 && <span style={{ background: tab==='recycle'?'#1a3a5c':'#FCEBEB', color: tab==='recycle'?'white':'#791F1F', fontSize: '10px', padding: '1px 6px', borderRadius: '20px' }}>{binCount}</span>}
          </button>
          <button style={S.tabBtn(tab === 'activity')} onClick={() => setTab('activity')}>📋 Activity Log</button>
          {isOwner && (
            <button style={S.tabBtn(tab === 'deploy')} onClick={() => setTab('deploy')}>🚀 Deploy</button>
          )}
        </div>

        {tab === 'users' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0 6px', flexWrap: 'wrap' }}>
              <input placeholder="Search username, email..." value={userSearch} onChange={e => setUserSearch(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', width: '220px' }} />
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', background: 'white', cursor: 'pointer' }}>
                <option value=''>Role ทั้งหมด</option>
                <option value='Owner'>Owner</option>
                <option value='Admin'>Admin</option>
                <option value='Editor'>Editor</option>
                <option value='Viewer'>Viewer</option>
              </select>
              {(userSearch || filterRole) && (
                <button onClick={() => { setUserSearch(''); setFilterRole(''); }}
                  style={{ padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', fontSize: '12px', cursor: 'pointer', background: '#f5f5f5', color: '#555' }}>✕ ล้าง</button>
              )}
              <span style={{ fontSize: '12px', color: '#888' }}>{filteredUsers.length} / {users.length} คน</span>
            </div>
            <div style={{ background: 'white', borderRadius: '0 0 8px 8px', overflow: 'auto', border: '0.5px solid #e8e8e8', borderTop: 'none' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th style={S.thLeft}>Username</th>
                    <th style={S.thLeft}>Email</th>
                    <th style={S.th}>Role</th>
                    {PERMISSIONS.map(p => <th key={p} style={S.th}>{p}</th>)}
                    <th style={S.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const isMe = u.email === currentUser?.email;
                    const isTargetOwner = u.role === 'Owner';
                    const canChangeRole = !isMe && !isTargetOwner;
                    const canDelete = !isMe && !isTargetOwner;
                    return (
                      <tr key={u.id} style={{ background: isMe ? '#f8fbff' : 'white' }}>
                        <td style={S.tdLeft}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {u.username || '-'}
                            {isMe && <span style={{ fontSize: '10px', background: '#e8f0fb', color: '#1a3a5c', padding: '1px 6px', borderRadius: '20px' }}>คุณ</span>}
                          </div>
                        </td>
                        <td style={S.tdLeft}>{u.email}</td>
                        <td style={S.td}>
                          {canChangeRole ? (
                            <select value={u.role||'Editor'} onChange={e => handleRoleChange(u.id, e.target.value)}
                              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '12px', color: roleColor[u.role]||'#333', fontWeight: '500', background: roleBg[u.role]||'white' }}>
                              <option>Admin</option><option>Editor</option><option>Viewer</option>
                            </select>
                          ) : (
                            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: roleBg[u.role]||'#eee', color: roleColor[u.role]||'#333', fontWeight: '500' }}>{u.role||'Editor'}</span>
                          )}
                        </td>
                        {PERMISSIONS.map(p => {
                          const val = u.permissions?.[p] ?? false;
                          return <td key={p} style={S.td}><button style={val ? S.yes : S.no} onClick={() => handlePermissionChange(u.id, p, !val)}>{val ? 'Yes' : 'No'}</button></td>;
                        })}
                        <td style={S.td}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            {savedId === u.id && <span style={{ fontSize: '11px', color: '#0F6E56' }}>✅</span>}
                            {canDelete && <button style={S.iconBtn('#c0392b')} title="ลบ" onClick={() => setDeleteTarget(u)}><IconTrash /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'access' && <AccessControlTab users={users} currentUser={currentUser} userName={userName} />}
        {tab === 'activity' && <ActivityLogTab currentUserRole={userRole} currentUserPermissions={userPermissions} />}
        {tab === 'recycle' && <RecycleBinTab currentUser={currentUser} userName={userName} fetchBinCount={fetchBinCount} />}
        {tab === 'deploy' && isOwner && (() => { document.body.style.overflow = 'hidden'; return null; })()}
        {tab !== 'deploy' && (() => { document.body.style.overflow = ''; return null; })()}
        {tab === 'deploy' && isOwner && (
          <div style={{ position: 'fixed', top: '88px', left: '220px', right: 0, bottom: 0, zIndex: 10, overflow: 'hidden' }}>
            <DeployMonitor inline />
          </div>
        )}

        {showForm && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Add New User</h3>
              {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '8px', borderRadius: '6px', marginBottom: '10px', fontSize: '12px' }}>{error}</div>}
              {[['username','Username','text'],['email','Email','email'],['password','Password','password']].map(([key,label,type]) => (
                <div key={key}><label style={{ fontSize: '12px', color: '#666' }}>{label}</label><input style={S.input} type={type} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})} /></div>
              ))}
              <div><label style={{ fontSize: '12px', color: '#666' }}>Role</label>
                <select style={S.input} value={form.role} onChange={e => setForm({...form,role:e.target.value})}><option>Admin</option><option>Editor</option><option>Viewer</option></select>
              </div>
              <div style={{ background: '#f8f8f8', borderRadius: '6px', padding: '10px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Permission เริ่มต้น ({form.role})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {PERMISSIONS.map(p => <span key={p} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: DEFAULT_PERMISSIONS[form.role]?.[p] ? '#EAF3DE' : '#FCEBEB', color: DEFAULT_PERMISSIONS[form.role]?.[p] ? '#27500A' : '#791F1F' }}>{p}: {DEFAULT_PERMISSIONS[form.role]?.[p] ? 'Yes' : 'No'}</span>)}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={() => setShowForm(false)}>Cancel</button>
                <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={handleAdd}>Save</button>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div style={S.overlay}>
            <div style={{ ...S.modal, width: '380px' }}>
              <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>🗑️ ยืนยันการลบ</h3>
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px' }}>ต้องการลบ <strong>{deleteTarget.username}</strong> ({deleteTarget.email}) ออกจากระบบใช่ไหมครับ?</p>
              <div style={{ background: '#EAF3DE', border: '0.5px solid #97C459', borderRadius: '6px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#27500A' }}>✅ ระบบจะลบ user ออกจากระบบทันทีครับ</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button style={{ ...S.btn, background: '#c0392b', color: 'white' }} onClick={handleDelete}>ลบ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  export default UserManagement;
