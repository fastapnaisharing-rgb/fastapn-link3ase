import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from './AuthContext';

export function useUserRole() {
  const { currentUser } = useAuth();
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.email) { setRole('viewer'); setLoading(false); return; }
    supabase
      .from('user_roles')
      .select('role')
      .eq('email', currentUser.email)
      .single()
      .then(({ data }) => {
        setRole((data?.role || 'Viewer').toLowerCase());
      })
      .catch(() => setRole('viewer'))
      .finally(() => setLoading(false));
  }, [currentUser]);

  const isOwner  = role === 'owner';
  const isAdmin  = role === 'admin'  || isOwner;
  const isEditor = role === 'editor' || isAdmin;
  const isViewer = true;

  return { role, loading, isOwner, isAdmin, isEditor, isViewer };
}