import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from './AuthContext';

export function useUserRole() {
  const { currentUser } = useAuth();
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.email) {
      setRole('viewer');
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('user_roles')
      .select('role')
      .eq('email', currentUser.email)
      .single()
      .then(({ data, error }) => {
        if (error) { setRole('viewer'); return; }
        setRole((data?.role || 'Viewer').toLowerCase());
      })
      .catch(() => setRole('viewer'))
      .finally(() => setLoading(false));
  }, [currentUser?.email]); // ← track email โดยตรง ไม่ใช่ object

  const isOwner  = role === 'owner';
  const isAdmin  = role === 'admin'  || isOwner;
  const isEditor = role === 'editor' || isAdmin;
  const isViewer = true;

  return { role, loading, isOwner, isAdmin, isEditor, isViewer };
}