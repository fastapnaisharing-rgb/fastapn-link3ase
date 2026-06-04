import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState(null);
  const [userPermissions, setUserPermissions] = useState(null); // ✅ เพิ่ม
  const [authReady, setAuthReady] = useState(false);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const logout = async () => {
    sessionStorage.removeItem('fastapn_cache');
    sessionStorage.removeItem('fastapn_cache_time');
    await supabase.auth.signOut();
  };

  // cache email เพื่อกัน fetchUserRole ยิงซ้ำ
  let lastEmail = null;

  const fetchUserRole = async (email) => {
    if (!email || email === lastEmail) return;
    lastEmail = email;
    try {
      const { data } = await supabase
        .from('user_roles')
        .select('role, username, permissions') // ✅ เพิ่ม permissions
        .eq('email', email)
        .maybeSingle();
      setUserRole(data?.role || null);
      setUserName(data?.username || null);
      setUserPermissions(data?.permissions || null); // ✅ set permissions
    } catch (err) {
      console.error('fetchUserRole error:', err);
      setUserRole(null);
      setUserName(null);
      setUserPermissions(null);
    }
  };

  useEffect(() => {
    // ล้าง localStorage เก่าถ้า version เปลี่ยน
    const APP_VERSION = '1.0.1';
    const storedVersion = localStorage.getItem('fastapn_version');
    if (storedVersion !== APP_VERSION) {
      const authData = localStorage.getItem('fastapn-auth');
      localStorage.clear();
      if (authData) localStorage.setItem('fastapn-auth', authData);
      localStorage.setItem('fastapn_version', APP_VERSION);
    }

    let isMounted = true;

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        const user = session?.user || null;
        setCurrentUser(user);
        if (user?.email) fetchUserRole(user.email);
      } catch (err) {
        console.error('INIT ERROR:', err);
        if (isMounted) setCurrentUser(null);
      } finally {
        if (isMounted) setAuthReady(true);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      const user = session?.user || null;
      setCurrentUser(user);
      if (user?.email) fetchUserRole(user.email);
      else {
        lastEmail = null;
        setUserRole(null);
        setUserName(null);
        setUserPermissions(null); // ✅ clear permissions ตอน logout
      }
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem('fastapn_cache');
        sessionStorage.removeItem('fastapn_cache_time');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ✅ เพิ่ม userPermissions ใน value
  const value = { currentUser, userRole, userName, userPermissions, login, logout, authReady };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}