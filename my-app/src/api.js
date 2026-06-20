import { supabase } from './supabase'; // ← ใช้ Supabase จริงสำหรับ auth

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }

  return res.status === 204 ? null : res.json();
}