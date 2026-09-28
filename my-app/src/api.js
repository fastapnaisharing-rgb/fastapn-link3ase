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
    // MARKER_APIFETCH_SURFACE_DEBUG_DETAIL_V1 -- Backend (genericTable.js) ส่ง debug_message/debug_detail/debug_code
    // มาด้วยตอน 500 อยู่แล้ว แต่เดิม apiFetch ทิ้งไปหมด เหลือแค่ err.error ("Internal server error" เฉยๆ)
    // ทำให้เห็นแค่ Error กลางๆ ไม่รู้สาเหตุจริงจาก Postgres -- แก้ให้โผล่ Detail จริงมาด้วย
    const detailParts = [err.debug_message, err.debug_detail, err.debug_code].filter(Boolean);
    const message = err.error || 'Request failed';
    throw new Error(detailParts.length ? `${message} — ${detailParts.join(' | ')}` : message);
  }

  return res.status === 204 ? null : res.json();
}