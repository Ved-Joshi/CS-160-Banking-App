import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!url || !anonKey) {
  // Fail fast in dev to avoid silent misconfiguration
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to your .env file.');
}

export const supabase = createClient(url, anonKey);
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

// Temporary debug: log app_metadata (including roles) to the console on load.
supabase.auth.getSession().then(({ data }) => {
  // eslint-disable-next-line no-console
  console.log('supabase app_metadata', data.session?.user?.app_metadata);
});
