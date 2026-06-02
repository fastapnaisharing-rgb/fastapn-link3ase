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

  const logout = async () => {
    sessionStorage.removeItem('fastapn_cache');
    sessionStorage.removeItem('fastapn_cache_time');
    await supabase.auth.signOut();
  };

  const fetchUserRole = async (email) => {
    if (!email) { setUserRole(null); setUserName(null); return; }
    try {
      const { data } = await supabase
        .from('user_roles')
        .select('role, username')
        .eq('email', email)
        .single();
      setUserRole(data?.role || null);
      setUserName(data?.username || null);
    } catch {
      setUserRole(null);
      setUserName(null);
    }
  };

  useEffect(() => {
    // ล้าง token เก่า Firebase ที่อาจค้างอยู่
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('firebase:') || key.includes('firebaseLocalStorage')) {
        localStorage.removeItem(key);
      }
    });

    let mounted = true;

    // Timeout 3 วิ ถ้า loading ยังค้างอยู่
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      const user = session?.user || null;
      setCurrentUser(user);
      await fetchUserRole(user?.email);
      clearTimeout(timeout);
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      clearTimeout(timeout);
      setCurrentUser(null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      const user = session?.user || null;
      setCurrentUser(user);
      await fetchUserRole(user?.email);
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem('fastapn_cache');
        sessionStorage.removeItem('fastapn_cache_time');
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const value = { currentUser, userRole, userName, login, logout };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}