import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { flushAllSync } from './syncRegistry';
import { subscribeWs, broadcastWs, setWsUsername } from '../wsManager';
import { db } from '../lib/db';

const AuthContext = createContext();
const API_URL = process.env.REACT_APP_API_URL;
const TOKEN_KEY = 'fastapn_token';
const IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser]       = useState(null);
  const [userRole, setUserRole]             = useState(null);
  const [userName, setUserName]             = useState(null);
  const [userPermissions, setUserPermissions] = useState(null);
  const [authReady, setAuthReady]           = useState(false);
  const idleTimer = useRef(null);

  // ── helpers ──────────────────────────────────────────────────────────────────
  const apiFetch = async (path, options = {}) => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    return res;
  };

  const setUserState = (user) => {
    setCurrentUser(user ? { email: user.email, id: user.id } : null);
    setUserRole(user?.role || null);
    setUserName(user?.username || null);
    setUserPermissions(user?.permissions || null);
    // ── ไม่ต้องเรียก mergeDocAccessOverrides อีกแล้ว ──
    // ── user.permissions.docAccess มาพร้อม Response แล้ว (Backend getDocAccess()) ──
    // MARKER_AUTHCONTEXT_WSUSERNAME_V1 -- แจ้ง wsManager ว่า Username คือใคร สำหรับ WS Connection
    setWsUsername(user?.username || null);
  };

  const clearUserState = () => {
    setCurrentUser(null);
    setUserRole(null);
    setUserName(null);
    setUserPermissions(null);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('fastapn_cache');
    sessionStorage.removeItem('fastapn_cache_time');
    // MARKER_AUTHCONTEXT_WSUSERNAME_V1 -- เคลียร์ Username ฝั่ง wsManager ด้วย
    setWsUsername(null);
  };

  // MARKER_AUTHCONTEXT_GLOBAL_401_LISTENER_V1
  // -- ดักฟัง Event กลางจาก db.js เมื่อ Request ไหนก็ตามเจอ 401 -- Token หลุด/หมดอายุ/ถูกลบ
  // -- Force Logout ทันที (ไม่เรียก /auth/logout เพราะ Token ใช้ไม่ได้อยู่แล้ว ยิงไปก็ได้ 401 ซ้ำ) --
  useEffect(() => {
    const handleUnauthorized = () => clearUserState();
    window.addEventListener('fastapn:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('fastapn:unauthorized', handleUnauthorized);
  }, []);

  // ── idle timeout ─────────────────────────────────────────────────────────────
  const resetIdleTimer = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => logout(), IDLE_TIMEOUT);
  };

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer));
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // ── Real-time: ฟัง 'doc_access_updated' — Admin ให้/ตัดสิทธิ์ Document Center ──
  // ── ให้ session ที่ Login ค้างอยู่เห็นผลทันที ไม่ต้อง Logout/Login ใหม่หรือ ──
  // ── Refresh หน้าเอง (ฝั่งส่งอยู่ที่ UserManagement.js/App.js — broadcastWs) ──
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const unsubscribe = subscribeWs(['doc_access_updated'], () => {
      refreshUserPermissions();
    });
    return unsubscribe;
  }, [currentUser?.id]);

  // MARKER_AUTHCONTEXT_PERMISSION_REALTIME_V1
  // ── Real-time: ฟัง 'user_permissions_updated' — Admin เปลี่ยน Permission ──
  // ── ตัวฐาน (VAT/Manual/IE/GL/I-Pro/Function) ให้ Session ที่ Login ค้างอยู่ ──
  // ── เห็นผลทันที ไม่ต้อง Logout/Login ใหม่ (ฝั่งส่งอยู่ที่ UserManagement.js) ──
  const refreshUserPermissions = async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const { user } = await res.json();
        setUserState(user);
      }
    } catch (e) { console.error('[refreshUserPermissions]', e); }
  };

  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const unsubscribe = subscribeWs(['user_permissions_updated'], (event, payload) => {
      if (String(payload.user_id) === String(currentUser.id)) refreshUserPermissions();
    });
    return unsubscribe;
  }, [currentUser?.id]);

  // MARKER_AUTHCONTEXT_FORCE_LOGOUT_ON_DELETE_V1
  // ── Real-time: ฟัง 'user_deleted' — Admin ลบ User คนนี้ออกจากระบบไปแล้ว ──
  // ── ต้อง Force Logout ทันที กัน Session เก่าใช้งานต่อได้ทั้งที่ไม่มีตัวตน ──
  // ── ในระบบแล้ว (ฝั่งส่งอยู่ที่ UserManagement.js — broadcastWs) ───────────
  useEffect(() => {
    if (!currentUser?.email) return undefined;
    const unsubscribe = subscribeWs(['user_deleted'], (event, payload) => {
      if (String(payload.email || '').toLowerCase() === String(currentUser.email || '').toLowerCase()) {
        logout();
      }
    });
    return unsubscribe;
  }, [currentUser?.email]);

  // ── init: restore session from token ─────────────────────────────────────────
  useEffect(() => {
    const APP_VERSION = '2.0.0';
    const storedVersion = localStorage.getItem('fastapn_version');
    if (storedVersion !== APP_VERSION) {
      localStorage.clear();
      localStorage.setItem('fastapn_version', APP_VERSION);
    }

    const init = async () => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (!token) { setAuthReady(true); return; }
      try {
        const res = await apiFetch('/auth/me');
        if (res.ok) {
          const { user } = await res.json();
          setUserState(user);
          resetIdleTimer();
        } else {
          clearUserState();
        }
      } catch {
        clearUserState();
      } finally {
        setAuthReady(true);
      }
    };

    init();
  }, []);

  // ── login ─────────────────────────────────────────────────────────────────────
const login = async (email, password) => {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');

  sessionStorage.setItem(TOKEN_KEY, data.token);

  if (!data.must_change_password) {
    setUserState(data.user);
    resetIdleTimer();
  }

  return data;
};  

  // ── completeLogin ─────────────────────────────────────────────────────────────
  const completeLogin = (user) => {
    setUserState(user);
    resetIdleTimer();
  };


  // ── logout ────────────────────────────────────────────────────────────────────
  const logout = async () => {
    await flushAllSync();
    // MARKER_AUTHCONTEXT_TEAM_STATUS_REALTIME_LOGOUT_V1
    // -- เดิม Logout ไม่เคยลบ Session ออกจาก menu_active_sessions เลย -- Row เดิมค้างด้วย
    // -- last_seen ล่าสุด (ไม่เกิน 30 วิ) ทำให้ User อื่นเห็นว่ายัง Online อยู่จนกว่า
    // -- จะครบ Cutoff 5 นาทีเอง -- ต้องลบทันที + Broadcast ให้ Home Refresh ทันที
    const me = userName || currentUser?.email || '';
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
    if (me) {
      try {
        await db.from('menu_active_sessions').delete().eq('id', me);
      } catch (e) { console.error('[logout] clear menu_active_sessions', e); }
      broadcastWs('team_status_updated', { username: me, online: false });
    }
    clearUserState();
  };

  const value = {
    currentUser,
    userRole,
    userName,
    userPermissions,
    authReady,
    login,
    logout,
    completeLogin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}