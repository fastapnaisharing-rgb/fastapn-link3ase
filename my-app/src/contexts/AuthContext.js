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
  const [loading, setLoading] = useState(true);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const clearCache = () => {
    sessionStorage.removeItem('fastapn_cache');
    sessionStorage.removeItem('fastapn_cache_time');
  };

  const logout = async () => {
    clearCache();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const fetchUserRole = async (email) => {
    if (!email) { setUserRole(null); setUserName(null); return; }
    const { data } = await supabase
      .from('user_roles')
      .select('role, username')
      .eq('email', email)
      .single();
    setUserRole(data?.role || null);
    setUserName(data?.username || null);
  };

  useEffect(() => {
    // ล้าง token เก่าทุกประเภทที่อาจค้างอยู่
    Object.keys(localStorage).forEach(key => {
      if (
        key.startsWith('firebase:') ||
        key.includes('firebaseLocalStorage') ||
        (key.includes('supabase') && key !== 'fastapn-auth')
      ) {
        localStorage.removeItem(key);
      }
    });

    // ดึง session ปัจจุบัน
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // session เสียหาย — ล้างแล้ว logout
        supabase.auth.signOut();
        setCurrentUser(null);
        setLoading(false);
        return;
      }
      const user = session?.user || null;
      setCurrentUser(user);
      fetchUserRole(user?.email).finally(() => setLoading(false));
    }).catch(() => {
      setCurrentUser(null);
      setLoading(false);
    });

    // Subscribe session changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user || null;
      setCurrentUser(user);
      await fetchUserRole(user?.email);
      // clear cache เมื่อ logout หรือ token หมดอายุ
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        sessionStorage.removeItem('fastapn_cache');
        sessionStorage.removeItem('fastapn_cache_time');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = { currentUser, userRole, userName, login, logout };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}