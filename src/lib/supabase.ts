import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.warn(
    'Supabase is not configured. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Where Google sends the browser back to: always the app root, whatever page
 * the member was on, so the one URL in Supabase's redirect allow-list keeps
 * working. The page they were heading for is remembered separately.
 */
export function redirectUrl() {
  return window.location.origin + import.meta.env.BASE_URL
}

/** sessionStorage key for "send me back here after Google". */
export const RETURN_TO_KEY = 'kc:return-to'
