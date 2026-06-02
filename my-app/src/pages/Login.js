import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabase';

function Login() {
  const [mode, setMode] = useState('login');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotInput, setForgotInput] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login } = useAuth();

  const resolveEmail = async (input) => {
    const val = input.trim().toLowerCase();
    if (val.includes('@')) return val;
    const { data } = await supabase
      .from('user_roles')
      .select('email')
      .eq('username', val)
      .single();
    if (!data) throw new Error('ไม่พบ Username นี้ในระบบครับ');
    return data.email;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const email = await resolveEmail(emailOrUsername);
      await login(email, password);
    } catch (err) {
      setError(err.message === 'ไม่พบ Username นี้ในระบบครับ'
        ? err.message
        : 'Email/Username หรือ Password ไม่ถูกต้องครับ');
    }
    setLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Password ไม่ตรงกันครับ'); return; }
    if (password.length < 6) { setError('Password ต้องมีอย่างน้อย 6 ตัวอักษรครับ'); return; }
    if (username.trim() === '') { setError('กรุณากรอก Username ครับ'); return; }
    setLoading(true);
    try {
      // เช็ค username ซ้ำ
      const { data: existing } = await supabase
        .from('user_roles')
        .select('id')
        .eq('username', username.trim().toLowerCase())
        .single();
      if (existing) { setError('Username นี้ถูกใช้งานแล้วครับ'); setLoading(false); return; }

      // สร้าง user ใน Supabase Auth
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;

      // เพิ่มใน user_roles
      const { error: roleError } = await supabase.from('user_roles').insert([{
        email: email.trim(),
        username: username.trim().toLowerCase(),
        role: 'Viewer',
        permissions: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false },
        updated_by: 'signup',
        updated_at: new Date().toISOString(),
      }]);
      if (roleError) throw roleError;

      setSuccess('สมัครสมาชิกสำเร็จแล้วครับ! กรุณา Login');
      setMode('login');
      setEmailOrUsername(''); setEmail(''); setPassword(''); setConfirmPassword(''); setUsername('');
    } catch (err) {
      setError('เกิดข้อผิดพลาด: ' + err.message);
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!forgotInput.trim()) { setError('กรุณากรอก Email หรือ Username ครับ'); return; }
    setForgotLoading(true);
    try {
      const resetEmail = await resolveEmail(forgotInput);
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setSuccess('ส่งลิงก์รีเซ็ต Password ไปที่ Email แล้วครับ กรุณาตรวจสอบ Inbox');
      setShowForgot(false); setForgotInput('');
    } catch (err) {
      setError(err.message === 'ไม่พบ Username นี้ในระบบครับ' ? err.message : 'ไม่พบ Email นี้ในระบบครับ');
    }
    setForgotLoading(false);
  };

  const switchMode = (m) => {
    setMode(m); setError(''); setSuccess('');
    setEmailOrUsername(''); setEmail(''); setPassword('');
    setConfirmPassword(''); setUsername('');
    setShowPassword(false); setShowConfirmPassword(false);
  };

  const EyeOpen = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );

  const EyeClosed = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );

  const S = {
    page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4f8' },
    card: { background: 'white', borderRadius: '12px', padding: '40px', width: '380px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' },
    logo: { textAlign: 'center', marginBottom: '24px' },
    logoText: { fontSize: '24px', fontWeight: 'bold', color: '#1a3a5c' },
    logoSub: { fontSize: '12px', color: '#888', marginTop: '4px' },
    tabs: { display: 'flex', background: '#f0f4f8', borderRadius: '8px', padding: '4px', marginBottom: '24px' },
    tab: (active) => ({ flex: 1, padding: '8px', textAlign: 'center', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', border: 'none', background: active ? '#1a3a5c' : 'transparent', color: active ? 'white' : '#666' }),
    label: { display: 'block', fontSize: '13px', color: '#555', marginBottom: '6px', fontWeight: '500' },
    input: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
    btn: { width: '100%', padding: '12px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', marginTop: '4px' },
    error: { background: '#FCEBEB', color: '#791F1F', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
    success: { background: '#EAF3DE', color: '#27500A', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '12px', padding: '28px', width: '360px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' },
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoText}>FAST<span style={{ color: '#5DCAA5' }}>APN</span></div>
          <div style={S.logoSub}>Link3ase · System</div>
        </div>

        <div style={S.tabs}>
          <button style={S.tab(mode === 'login')} onClick={() => switchMode('login')}>Login</button>
          <button style={S.tab(mode === 'signup')} onClick={() => switchMode('signup')}>Sign up</button>
        </div>

        {error && <div style={S.error}>{error}</div>}
        {success && <div style={S.success}>{success}</div>}

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <label style={S.label}>Email หรือ Username</label>
            <input
              style={S.input} type="text" value={emailOrUsername}
              onChange={e => setEmailOrUsername(e.target.value)}
              placeholder="email@example.com หรือ username" required
            />
            <label style={S.label}>Password</label>
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <input
                style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }}
                type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
              />
              <button type="button" onClick={() => setShowPassword(p => !p)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <span onClick={() => { setShowForgot(true); setError(''); setForgotInput(''); }}
                style={{ fontSize: '12px', color: '#1a3a5c', cursor: 'pointer', textDecoration: 'underline' }}>
                ลืม Password?
              </span>
            </div>
            <button style={S.btn} type="submit" disabled={loading}>
              {loading ? 'กำลัง Login...' : 'Login'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <label style={S.label}>Username</label>
            <input style={S.input} type="text" value={username}
              onChange={e => setUsername(e.target.value)} placeholder="ตัวอักษร ตัวเลข ไม่มีช่องว่าง" required />
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required />
            <label style={S.label}>Password</label>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }}
                type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" required
              />
              <button type="button" onClick={() => setShowPassword(p => !p)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <label style={S.label}>Confirm Password</label>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }}
                type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)} placeholder="พิมพ์ Password อีกครั้ง" required
              />
              <button type="button" onClick={() => setShowConfirmPassword(p => !p)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showConfirmPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <button style={S.btn} type="submit" disabled={loading}>
              {loading ? 'กำลังสมัคร...' : 'Sign up'}
            </button>
          </form>
        )}
      </div>

      {showForgot && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '8px', fontSize: '15px' }}>🔑 ลืม Password</h3>
            <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>
              กรอก Email หรือ Username แล้วระบบจะส่งลิงก์รีเซ็ต Password ไปให้ครับ
            </p>
            {error && <div style={S.error}>{error}</div>}
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '6px' }}>Email หรือ Username</label>
            <input
              style={S.input} type="text" value={forgotInput}
              onChange={e => setForgotInput(e.target.value)}
              placeholder="email@example.com หรือ username"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#f0f0f0' }}
                onClick={() => { setShowForgot(false); setError(''); }}>Cancel</button>
              <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#1a3a5c', color: 'white' }}
                onClick={handleForgotPassword} disabled={forgotLoading}>
                {forgotLoading ? 'กำลังส่ง...' : 'ส่ง Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Login;