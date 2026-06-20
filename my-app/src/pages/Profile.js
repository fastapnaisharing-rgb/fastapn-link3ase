import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db as supabase } from '../lib/db';

function Profile({ onClose }) {
  const { currentUser } = useAuth();
  const fileRef = useRef();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');

  React.useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('username')
        .eq('email', currentUser?.email)
        .single();
      if (data) {
        setCurrentUsername(data.username || '');
        setUsername(data.username || '');
      }
    };
    fetchUser();
  }, []);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    if (newPassword && newPassword !== confirmPassword) {
      setError('Password ใหม่ไม่ตรงกันครับ');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError('Password ต้องมีอย่างน้อย 6 ตัวอักษรครับ');
      return;
    }
    setLoading(true);
    try {
      // เปลี่ยน Password
      if (newPassword) {
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
        if (pwError) throw pwError;
      }

      // เปลี่ยน Email
      if (email !== currentUser?.email) {
        const { error: emailError } = await supabase.auth.updateUser({ email });
        if (emailError) throw emailError;
      }

      // อัปเดต Username ใน user_roles
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ username: username.trim().toLowerCase() })
        .eq('email', currentUser?.email);
      if (roleError) throw roleError;

      setSuccess('บันทึกข้อมูลสำเร็จแล้วครับ!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError('เกิดข้อผิดพลาด: ' + err.message);
    }
    setLoading(false);
  };

  const initials = (currentUsername || currentUser?.email || '?')[0].toUpperCase();

  const S = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '12px', padding: '28px', width: '420px', maxHeight: '90vh', overflowY: 'auto' },
    label: { display: 'block', fontSize: '12px', color: '#666', marginBottom: '5px', fontWeight: '500' },
    input: { width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', marginBottom: '14px', boxSizing: 'border-box' },
    btn: { padding: '7px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px' },
    section: { borderTop: '0.5px solid #eee', paddingTop: '16px', marginTop: '4px' },
    sectionTitle: { fontSize: '13px', fontWeight: '600', color: '#1a3a5c', marginBottom: '12px' }
  };

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>👤 Profile</h2>
          <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={onClose}>✕</button>
        </div>

        {error && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '10px', borderRadius: '8px', fontSize: '12px', marginBottom: '14px' }}>{error}</div>}
        {success && <div style={{ background: '#EAF3DE', color: '#27500A', padding: '10px', borderRadius: '8px', fontSize: '12px', marginBottom: '14px' }}>{success}</div>}

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="avatar" style={{ width: '72px', height: '72px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #e0e0e0' }} />
              : <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#1a3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: '600', color: 'white', margin: '0 auto' }}>{initials}</div>
            }
            <button onClick={() => fileRef.current.click()}
              style={{ position: 'absolute', bottom: 0, right: 0, width: '24px', height: '24px', borderRadius: '50%', background: '#5DCAA5', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'white' }}>+</button>
          </div>
          <input type="file" accept="image/*" ref={fileRef} onChange={handleAvatarChange} style={{ display: 'none' }} />
          <div style={{ fontSize: '11px', color: '#999', marginTop: '6px' }}>กดที่ + เพื่อเปลี่ยนรูปครับ</div>
        </div>

        <div style={S.sectionTitle}>ข้อมูลทั่วไป</div>
        <label style={S.label}>Username</label>
        <input style={S.input} value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" />
        <label style={S.label}>Email</label>
        <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />

        <div style={S.section}>
          <div style={S.sectionTitle}>เปลี่ยน Password</div>
          <label style={S.label}>Password ใหม่</label>
          <input style={S.input} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" />
          <label style={S.label}>ยืนยัน Password ใหม่</label>
          <input style={S.input} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="พิมพ์ Password ใหม่อีกครั้ง" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={onClose}>Cancel</button>
          <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={handleSave} disabled={loading}>
            {loading ? 'กำลังบันทึก...' : '💾 Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Profile;
