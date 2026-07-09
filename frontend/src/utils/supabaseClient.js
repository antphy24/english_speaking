import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment.')
}

const projectId = supabaseUrl ? supabaseUrl.split('//')[1].split('.')[0] : 'default';

export const supabaseStudent = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: `sb-${projectId}-student-auth-token` }
})

export const supabaseTeacher = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: `sb-${projectId}-teacher-auth-token` }
})

export const supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: `sb-${projectId}-admin-auth-token` }
})

// Keep default export for backwards compatibility in case we missed a file
export const supabase = supabaseStudent;
