import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, redirectUrl, isConfigured } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { canPublish } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Set when Google sent us back with a rejection (e.g. not on the roster). */
  authError: string | null
  clearAuthError: () => void
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  isAdmin: boolean
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * The database trigger rejects anyone who is not on the roster, which
 * surfaces here as an opaque "Database error saving new user". Translate it.
 */
function readCallbackError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  const query = new URLSearchParams(window.location.search)
  const raw =
    hash.get('error_description') ??
    query.get('error_description') ??
    hash.get('error') ??
    query.get('error')
  if (!raw) return null

  const decoded = decodeURIComponent(raw.replace(/\+/g, ' '))
  if (/not_on_roster|Database error saving new user|unexpected_failure/i.test(decoded)) {
    return 'That account is not on the Key Club roster. Sign in with your school address, or ask an officer to add you.'
  }
  if (/access_denied/i.test(decoded)) return 'Sign-in was cancelled.'
  return decoded
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Read the callback error before anything else strips the URL.
  useEffect(() => {
    const err = readCallbackError()
    if (err) {
      setAuthError(err)
      window.history.replaceState({}, '', window.location.pathname + '#/login')
    }
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (!mounted.current) return
    if (error) {
      console.error('Could not load profile', error)
      setProfile(null)
      return
    }
    setProfile(data as Profile | null)
  }, [])

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted.current) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      if (mounted.current) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted.current) return
      setSession(next)
      if (next?.user) {
        // Deferred: calling back into supabase-js from inside this callback
        // can deadlock the client's internal lock.
        setTimeout(() => void loadProfile(next.user.id), 0)
      } else {
        setProfile(null)
      }
      if (event === 'SIGNED_OUT') setAuthError(null)
    })

    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = useCallback(async () => {
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) setAuthError(error.message)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      authError,
      clearAuthError: () => setAuthError(null),
      signIn,
      signOut,
      refreshProfile,
      isAdmin: canPublish(profile?.role),
    }),
    [session, profile, loading, authError, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
