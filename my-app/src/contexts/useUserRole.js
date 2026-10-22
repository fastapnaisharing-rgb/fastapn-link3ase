import { useAuth } from './AuthContext';

export function useUserRole() {
  const { userRole, authReady } = useAuth();

  const role = (userRole || 'Viewer').toLowerCase();

  const isOwner  = role === 'owner';
  const isAdmin  = role === 'admin'  || isOwner;
  const isEditor = role === 'editor' || isAdmin;
  const isViewer = true;
  const isGuest  = role === 'guest'; // MARKER_GUEST_ROLE_V1

  return { role, loading: !authReady, isOwner, isAdmin, isEditor, isViewer, isGuest };
}