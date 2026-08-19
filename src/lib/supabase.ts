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
 * Where Google sends the browser back to. Hash routing means the app lives
 * at the document root no matter which host serves it, so the origin plus
 * the deploy sub-path is exactly right.
 */
export function redirectUrl() {
  // The current document path is, by definition, where the app is served
  // from — root on Cloudflare Pages, /key-club/ on a GitHub Pages project
  // site. Drop the hash so Supabase gets a clean callback target.
  return window.location.origin + window.location.pathname
}
