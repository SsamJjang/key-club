import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isConfigured } from '../lib/supabase'
import { Notice, Spinner } from '../components/ui'
import Logo, { LogoWordmark } from '../components/Logo'

export default function Login() {
  const { session, loading, authError, signIn } = useAuth()
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner label="Checking your membership" />
  if (session) return <Navigate to="/" replace />

  async function handleSignIn() {
    setBusy(true)
    await signIn()
    setBusy(false)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Left: the pitch */}
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-navy-600/40 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-gold-500/20 blur-3xl"
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <Logo size={44} tone="light" />
          <span className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Key Club
          </span>
        </div>

        <div className="relative">
          <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[1.05] tracking-tight">
            Caring — our&nbsp;way of&nbsp;life.
          </h1>
          <p className="mt-6 max-w-md text-navy-200">
            The official GCS Key Club website. Events, news, and volunteers in a glance. Sign in with your school email to continue.
          </p>
        </div>

        <dl className="relative grid grid-cols-3 gap-4 text-sm">
          {[
            ['Events', 'Sign up in a tap'],
            ['Hours', 'Logged and verified'],
            ['Members', 'Everyone, one page'],
          ].map(([term, desc]) => (
            <div key={term}>
              <dt className="font-semibold text-gold-300">{term}</dt>
              <dd className="mt-0.5 text-navy-200">{desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Right: the door */}
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm rise">
          <div className="mb-8 lg:hidden">
            <LogoWordmark size={36} />
          </div>

          <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            Welcome back
          </h2>
          <p className="mt-2 text-sm muted">
            Members only. Your email has to be on the club roster — there is no sign-up form.
          </p>

          {!isConfigured && (
            <div className="mt-6">
              <Notice tone="error">
                Supabase isn’t configured. Copy <code>.env.example</code> to <code>.env</code> and
                add your project URL and anon key.
              </Notice>
            </div>
          )}

          {authError && (
            <div className="mt-6">
              <Notice tone="error">{authError}</Notice>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={busy || !isConfigured}
            className="btn btn-ghost mt-8 w-full py-3 text-base"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.64 6.16-4.64Z"
              />
            </svg>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>

          <p className="mt-6 text-xs muted">
            Not on the roster? Ask a club officer to add you, then sign in again.
          </p>
        </div>
      </div>
    </div>
  )
}
