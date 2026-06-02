import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from './AuthContext';

export function useUserRole() {
  const { currentUser } = useAuth();
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.email) { setRole('viewer'); setLoading(false); return; }
    getDocs(query(collection(db, 'User'), where('email', '==', currentUser.email)))
      .then(snap => {
        const data = snap.docs[0]?.data();
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
