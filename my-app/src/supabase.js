import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://tpmdixdgvvgwiqodvcrk.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_DiL5SGeQKmNkj4QRTHkBbA_Ukj-OJO4';
const SUPABASE_SERVICE_KEY = process.env.REACT_APP_SUPABASE_SERVICE_KEY || '';

// ✅ ใช้ sessionStorage → ปิด tab แล้วต้อง login ใหม่ทันที
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'fastapn-auth',
    storage: window.sessionStorage,
  }
});

// Admin client — ไม่ต้องแก้
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'fastapn-admin' } }
);