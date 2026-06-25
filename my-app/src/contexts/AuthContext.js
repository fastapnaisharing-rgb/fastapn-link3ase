import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { flushAllSync } from './syncRegistry';

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
  };

  const clearUserState = () => {
    setCurrentUser(null);
    setUserRole(null);
    setUserName(null);
    setUserPermissions(null);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('fastapn_cache');
    sessionStorage.removeItem('fastapn_cache_time');
  };

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

  // ── logout ────────────────────────────────────────────────────────────────────
  const logout = async () => {
    await flushAllSync();
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
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
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
