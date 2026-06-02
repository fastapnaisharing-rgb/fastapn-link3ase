import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://tpmdixdgvvgwiqodvcrk.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_DiL5SGeQKmNkj4QRTHkBbA_Ukj-OJO4';
const SUPABASE_SERVICE_KEY = process.env.REACT_APP_SUPABASE_SERVICE_KEY || '';

// Public client — ใช้ทั่วทั้งแอป
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin client — ใช้เฉพาะ UserManagement (create/delete auth user)
// ถ้าไม่มี SERVICE_KEY จะ fallback ใช้ anon key (admin functions จะ fail แต่ build ผ่าน)
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);