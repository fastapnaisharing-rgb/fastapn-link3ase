import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://tpmdixdgvvgwiqodvcrk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DiL5SGeQKmNkj4QRTHkBbA_Ukj-OJO4'; // ← ใส่ Publishable Key ตรงนี้

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
