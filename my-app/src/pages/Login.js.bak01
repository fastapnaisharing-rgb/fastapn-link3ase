import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const EMAILJS_SERVICE_ID = 'service_yuwj8rv';
const EMAILJS_TEMPLATE_ID = 'template_pkr3hrc';
const EMAILJS_PUBLIC_KEY = '15CbmTCQhpAihatXV';

function Login() {
  const [mode, setMode] = useState('login');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password
  const [showForgot, setShowForgot] = useState(false);
  const [forgotInput, setForgotInput] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Change password (must_change_password)
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changeToken, setChangeToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);

  // Sign up
  const [signupForm, setSignupForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);

  const { login, completeLogin } = useAuth();

  // resolve username -> email via backend
  const resolveEmail = async (input) => {
    const val = input.trim().toLowerCase();
    if (val.includes('@')) return val;
    const res = await fetch(`${API}/api/auth/resolve-username?username=${encodeURIComponent(val)}`);
    const data = await res.json();
    if (!data.email) throw new Error('ไม่พบ Username นี้ในระบบครับ');
    return data.email;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const resolvedEmail = await resolveEmail(emailOrUsername);
      const result = await login(resolvedEmail, password);
      if (result?.must_change_password) {
        setChangeToken(result.token);
        setShowChangePassword(true);
      }
    } catch (err) {
      setError(err.message === 'ไม่พบ Username นี้ในระบบครับ'
        ? err.message
        : 'Email/Username หรือ Password ไม่ถูกต้องครับ');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!forgotInput.trim()) { setError('กรุณากรอก Email ครับ'); return; }
    const input = forgotInput.trim().toLowerCase();
    if (!input.includes('@')) { setError('กรุณากรอก Email ครับ (ไม่รองรับ Username)'); return; }
    setForgotLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      if (!data.otp) {
        setSuccess('หากมี Email นี้ในระบบ จะได้รับ OTP ทาง Email ครับ');
        setShowForgot(false); setForgotInput('');
        setForgotLoading(false);
        return;
      }
      const expireTime = new Date(Date.now() + 15 * 60 * 1000).toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit'
      });
      const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            email: data.email,
            passcode: data.otp,
            time: expireTime,
          },
        }),
      });
      if (!emailRes.ok) throw new Error('ส่ง Email ไม่สำเร็จ กรุณาลองใหม่ครับ');
      setSuccess('ส่ง OTP ไปที่ Email แล้วครับ กรุณาตรวจสอบ Inbox แล้วใช้ OTP นั้น Login');
      setShowForgot(false); setForgotInput('');
    } catch (err) {
      setError(err.message);
    }
    setForgotLoading(false);
  };

  const handleChangePassword = async () => {
    setError('');
    if (newPassword.length < 6) { setError('Password ต้องมีอย่างน้อย 6 ตัวอักษรครับ'); return; }
    if (newPassword !== confirmNewPassword) { setError('Password ไม่ตรงกันครับ'); return; }
    setChangeLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${changeToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      const meRes = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${changeToken}` },
      });
      if (meRes.ok) {
        const { user } = await meRes.json();
        completeLogin(user);
      }
      setShowChangePassword(false);
    } catch (err) {
      setError(err.message);
    }
    setChangeLoading(false);
  };

  const handleSignup = async () => {
    setError('');
    if (!signupForm.username.trim()) { setError('กรุณากรอก Username ครับ'); return; }
    if (!signupForm.email.trim() || !signupForm.email.includes('@')) { setError('กรุณากรอก Email ให้ถูกต้องครับ'); return; }
    if (signupForm.password.length < 6) { setError('Password ต้องมีอย่างน้อย 6 ตัวอักษรครับ'); return; }
    if (signupForm.password !== signupForm.confirmPassword) { setError('Password ไม่ตรงกันครับ'); return; }
    setSignupLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: signupForm.username.trim().toLowerCase(),
          email: signupForm.email.trim().toLowerCase(),
          password: signupForm.password,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      setSuccess('ส่งคำขอสำเร็จแล้วครับ รอ Owner Approve ก่อน Login ได้เลย');
      setSignupForm({ username: '', email: '', password: '', confirmPassword: '' });
      setMode('login');
    } catch (err) {
      setError(err.message);
    }
    setSignupLoading(false);
  };

  const switchMode = (m) => {
    setMode(m); setError(''); setSuccess('');
    setEmailOrUsername(''); setPassword('');
    setShowPassword(false);
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
    page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fc' },
    card: { background: 'white', borderRadius: '16px', padding: '40px', width: '380px', boxShadow: 'none', border: '0.5px solid #e8eaf0', position: 'relative', overflow: 'hidden' },
    logo: { textAlign: 'center', marginBottom: '24px' },
    logoText: { fontSize: '24px', fontWeight: 'bold', color: '#1a3a5c' },
    logoSub: { fontSize: '12px', color: '#888', marginTop: '4px' },
    tabs: { display: 'flex', background: '#f7f8fc', borderRadius: '8px', padding: '4px', marginBottom: '24px' },
    tab: (active) => ({ flex: 1, padding: '8px', textAlign: 'center', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', border: 'none', background: active ? '#1a3a5c' : 'transparent', color: active ? 'white' : '#666' }),
    label: { display: 'block', fontSize: '13px', color: '#555', marginBottom: '6px', fontWeight: '500' },
    input: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e8eaf0', fontSize: '14px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box', background: '#fafbfc' },
    btn: { width: '100%', padding: '12px', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', marginTop: '4px' },
    error: { background: '#FCEBEB', color: '#791F1F', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
    success: { background: '#EAF3DE', color: '#27500A', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '12px', padding: '28px', width: '360px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' },
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #1a3a5c, #5DCAA5)' }} />
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
            <input style={S.input} type="text" value={emailOrUsername} onChange={e => setEmailOrUsername(e.target.value)} placeholder="email@example.com หรือ username" required />
            <label style={S.label}>Password / OTP</label>
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <input style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              <button type="button" onClick={() => setShowPassword(p => !p)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <span onClick={() => { setShowForgot(true); setError(''); setForgotInput(''); }} style={{ fontSize: '12px', color: '#5DCAA5', cursor: 'pointer', textDecoration: 'underline' }}>ลืม Password?</span>
            </div>
            <button style={S.btn} type="submit" disabled={loading}>{loading ? 'กำลัง Login...' : 'Login'}</button>
          </form>
        ) : (
          <div>
            <label style={S.label}>Username</label>
            <input style={S.input} type="text" value={signupForm.username} onChange={e => setSignupForm({...signupForm, username: e.target.value})} placeholder="username" />
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={signupForm.email} onChange={e => setSignupForm({...signupForm, email: e.target.value})} placeholder="email@example.com" />
            <label style={S.label}>Password</label>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }} type={showSignupPassword ? 'text' : 'password'} value={signupForm.password} onChange={e => setSignupForm({...signupForm, password: e.target.value})} placeholder="อย่างน้อย 6 ตัวอักษร" />
              <button type="button" onClick={() => setShowSignupPassword(p => !p)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showSignupPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <label style={S.label}>Confirm Password</label>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }} type={showSignupConfirm ? 'text' : 'password'} value={signupForm.confirmPassword} onChange={e => setSignupForm({...signupForm, confirmPassword: e.target.value})} placeholder="พิมพ์ Password อีกครั้ง" />
              <button type="button" onClick={() => setShowSignupConfirm(p => !p)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showSignupConfirm ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <button style={S.btn} onClick={handleSignup} disabled={signupLoading}>{signupLoading ? 'กำลังส่งคำขอ...' : 'Sign up'}</button>
            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px', color: '#888' }}>หลัง Sign up รอ Owner Approve ก่อน Login ได้ครับ</div>
          </div>
        )}
      </div>

      {showForgot && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '8px', fontSize: '15px' }}>🔑 ลืม Password</h3>
            <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>กรอก Email แล้วระบบจะส่ง OTP ไปให้ครับ นำ OTP มา Login แทน Password ได้เลย</p>
            {error && <div style={S.error}>{error}</div>}
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '6px' }}>Email</label>
            <input style={S.input} type="email" value={forgotInput} onChange={e => setForgotInput(e.target.value)} placeholder="email@example.com" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#f0f0f0' }} onClick={() => { setShowForgot(false); setError(''); }}>Cancel</button>
              <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#1a3a5c', color: 'white' }} onClick={handleForgotPassword} disabled={forgotLoading}>
                {forgotLoading ? 'กำลังส่ง...' : 'ส่ง OTP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangePassword && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '8px', fontSize: '15px' }}>🔒 ตั้ง Password ใหม่</h3>
            <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>กรุณาตั้ง Password ใหม่ก่อนเข้าใช้งานระบบครับ</p>
            {error && <div style={S.error}>{error}</div>}
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '6px' }}>Password ใหม่</label>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                style={{ ...S.input, marginBottom: 0, paddingRight: '40px' }}
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
              />
              <button type="button" onClick={() => setShowNewPassword(p => !p)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px', display: 'flex', alignItems: 'center' }}>
                {showNewPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '6px' }}>ยืนยัน Password ใหม่</label>
            <input
              style={S.input}
              type="password"
              value={confirmNewPassword}
              onChange={e => setConfirmNewPassword(e.target.value)}
              placeholder="พิมพ์ Password อีกครั้ง"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: '#1a3a5c', color: 'white' }} onClick={handleChangePassword} disabled={changeLoading}>
                {changeLoading ? 'กำลังบันทึก...' : 'บันทึก Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Login;
