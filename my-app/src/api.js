const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export async function apiFetch(path, options = {}) {
  const token = sessionStorage.getItem('fastapn_token');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }

  return res.status === 204 ? null : res.json();
}