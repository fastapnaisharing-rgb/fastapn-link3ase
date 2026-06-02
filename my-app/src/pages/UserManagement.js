import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

const PERMISSIONS = ['VAT', 'I-Pro', 'GL', 'IE', 'Function', 'Manual'];

const DEFAULT_PERMISSIONS = {
  Owner:  { VAT: true, 'I-Pro': true, GL: true, IE: true, Function: true, Manual: true },
  Admin:  { VAT: true, 'I-Pro': true, GL: true, IE: true, Function: true, Manual: true },
  Editor: { VAT: true, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: true },
  Viewer: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false }
};

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
);

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', username: '', role: 'Editor' });
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState(null);
  const { currentUser } = useAuth();
  const { isOwner } = useUserRole();

  const fetchUsers = async () => {
    const ROLE_ORDER = { Owner: 1, Admin: 2, Editor: 3, Viewer: 4 };
    const { data } = await supabase.from('user_roles').select('*');
    const sorted = (data || []).sort((a, b) => (ROLE_ORDER[a.role] || 5) - (ROLE_ORDER[b.role] || 5));
    setUsers(sorted);
  };

  useEffect(() => { fetchUsers(); }, []);

  if (!isOwner) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>⛔ คุณไม่มีสิทธิ์เข้าถึงหน้านี้ครับ</div>;
  }

  const saveUser = async (user) => {
    const { error } = await supabase.from('user_roles').update({
      role: user.role,
      permissions: user.permissions,
      updated_by: currentUser?.email,
    }).eq('id', user.id);
    if (error) { setError('บันทึกไม่สำเร็จ: ' + error.message); return; }
    setSavedId(user.id);
    setTimeout(() => setSavedId(null), 2000);
  };

  const handleRoleChange = (id, newRole) => {
    const perms = DEFAULT_PERMISSIONS[newRole] || DEFAULT_PERMISSIONS.Editor;
    setUsers(prev => {
      const updated = prev.map(u => u.id === id ? { ...u, role: newRole, permissions: perms } : u);
      saveUser(updated.find(u => u.id === id));
      return updated;
    });
  };

  const handlePermissionChange = (id, perm, value) => {
    setUsers(prev => {
      const updated = prev.map(u => u.id !== id ? u : { ...u, permissions: { ...(u.permissions || {}), [perm]: value } });
      saveUser(updated.find(u => u.id === id));
      return updated;
    });
  };

  const handleAdd = async () => {
    setError('');
    try {
      const perms = DEFAULT_PERMISSIONS[form.role] || DEFAULT_PERMISSIONS.Editor;

      // 1. สร้าง user ผ่าน Edge Function (ไม่ auto-login)
      const { data: fnData, error: authError } = await supabase.functions.invoke('create-user', {
        body: { email: form.email, password: form.password },
      });
      if (authError) throw authError;
      if (fnData?.error) throw new Error(fnData.error);

      // 2. เพิ่มใน user_roles
      const { error: roleError } = await supabase.from('user_roles').insert([{
        email: form.email,
        username: form.username.trim().toLowerCase(),
        role: form.role,
        permissions: perms,
        updated_by: currentUser?.email,
        updated_at: new Date().toISOString(),
      }]);
      if (roleError) throw roleError;

      setShowForm(false);
      setForm({ email: '', password: '', username: '', role: 'Editor' });
      fetchUsers();
    } catch (err) {
      setError('เกิดข้อผิดพลาด: ' + err.message);
    }
  };

  // ลบทั้ง Supabase Auth และ user_roles พร้อมกัน
  const handleDelete = async () => {
    try {
      // 1. ลบจาก Supabase Auth ผ่าน Edge Function
      const { data: fnData, error: fnError } = await supabase.functions.invoke('delete-user', {
        body: { email: deleteTarget.email },
      });
      if (fnError) throw fnError;
      if (fnData?.error) throw new Error(fnData.error);

      // 2. ลบจาก user_roles
      const { error: roleError } = await supabase.from('user_roles').delete().eq('id', deleteTarget.id);
      if (roleError) throw roleError;

      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      setError('เกิดข้อผิดพลาด: ' + err.message);
    }
  };

  const roleColor = { Owner: '#27500A', Admin: '#1a3a5c', Editor: '#0F6E56', Viewer: '#888' };
  const roleBg = { Owner: '#EAF3DE', Admin: '#e8f0fb', Editor: '#f0faf6', Viewer: '#f5f5f5' };

  const S = {
    container: { padding: '20px' },
    topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
    btn: { padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' },
    wrap: { background: 'white', borderRadius: '8px', overflow: 'auto' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '900px' },
    th: { background: '#1a3a5c', color: 'white', padding: '10px 12px', textAlign: 'center', fontWeight: '500', whiteSpace: 'nowrap' },
    thLeft: { background: '#1a3a5c', color: 'white', padding: '10px 12px', textAlign: 'left', fontWeight: '500' },
    td: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'center', verticalAlign: 'middle' },
    tdLeft: { padding: '8px 12px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'left', verticalAlign: 'middle' },
    yes: { background: '#EAF3DE', color: '#27500A', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', border: 'none', cursor: 'pointer', width: '52px' },
    no: { background: '#FCEBEB', color: '#791F1F', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500', border: 'none', cursor: 'pointer', width: '52px' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px', boxSizing: 'border-box' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '10px', padding: '24px', width: '420px', maxHeight: '90vh', overflowY: 'auto' },
    iconBtn: (color) => ({ background: 'none', border: 'none', cursor: 'pointer', color, padding: '4px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center' }),
  };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <h2 style={{ fontSize: '16px', fontWeight: '600' }}>👤 User Management</h2>
        <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setError(''); }}>+ Add User</button>
      </div>

      {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

      <div style={S.wrap}>
        <table style={S.table}>
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
            {users.map(u => {
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
                      <select value={u.role || 'Editor'} onChange={e => handleRoleChange(u.id, e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '12px', color: roleColor[u.role] || '#333', fontWeight: '500', background: roleBg[u.role] || 'white' }}>
                        <option>Owner</option>
                        <option>Admin</option>
                        <option>Editor</option>
                        <option>Viewer</option>
                      </select>
                    ) : (
                      <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: roleBg[u.role] || '#eee', color: roleColor[u.role] || '#333', fontWeight: '500' }}>
                        {u.role || 'Editor'}
                      </span>
                    )}
                  </td>
                  {PERMISSIONS.map(p => {
                    const val = u.permissions?.[p] ?? false;
                    return (
                      <td key={p} style={S.td}>
                        <button style={val ? S.yes : S.no} onClick={() => handlePermissionChange(u.id, p, !val)}>
                          {val ? 'Yes' : 'No'}
                        </button>
                      </td>
                    );
                  })}
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {savedId === u.id && <span style={{ fontSize: '11px', color: '#0F6E56' }}>✅</span>}
                      {canDelete && (
                        <button style={S.iconBtn('#c0392b')} title="ลบ" onClick={() => setDeleteTarget(u)}>
                          <IconTrash />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Add New User</h3>
            {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '8px', borderRadius: '6px', marginBottom: '10px', fontSize: '12px' }}>{error}</div>}
            {[['username', 'Username', 'text'], ['email', 'Email', 'email'], ['password', 'Password', 'password']].map(([key, label, type]) => (
              <div key={key}>
                <label style={{ fontSize: '12px', color: '#666' }}>{label}</label>
                <input style={S.input} type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>Role</label>
              <select style={S.input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option>Owner</option>
                <option>Admin</option>
                <option>Editor</option>
                <option>Viewer</option>
              </select>
            </div>
            <div style={{ background: '#f8f8f8', borderRadius: '6px', padding: '10px', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Permission เริ่มต้น ({form.role})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {PERMISSIONS.map(p => (
                  <span key={p} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: DEFAULT_PERMISSIONS[form.role]?.[p] ? '#EAF3DE' : '#FCEBEB', color: DEFAULT_PERMISSIONS[form.role]?.[p] ? '#27500A' : '#791F1F' }}>
                    {p}: {DEFAULT_PERMISSIONS[form.role]?.[p] ? 'Yes' : 'No'}
                  </span>
                ))}
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
            <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px' }}>
              ต้องการลบ <strong>{deleteTarget.username}</strong> ({deleteTarget.email}) ออกจากระบบใช่ไหมครับ?
            </p>
            <div style={{ background: '#EAF3DE', border: '0.5px solid #97C459', borderRadius: '6px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#27500A' }}>
              ✅ ระบบจะลบออกจากทั้ง Supabase Auth และระบบพร้อมกันเลยครับ
            </div>
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