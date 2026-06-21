import { useAuth } from './AuthContext';

export function useUserRole() {
  const { userRole, authReady } = useAuth();

  const role = (userRole || 'Viewer').toLowerCase();

  const isOwner  = role === 'owner';
  const isAdmin  = role === 'admin'  || isOwner;
  const isEditor = role === 'editor' || isAdmin;
  const isViewer = true;

  return { role, loading: !authReady, isOwner, isAdmin, isEditor, isViewer };
}