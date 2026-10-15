import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isConfigured } from '../lib/supabase'
import { Notice, Spinner } from '../components/ui'
import Logo from '../components/Logo'

const PERKS: [string, string, string][] = [
  ['🤝', 'Find ways to serve', 'Sign up for service projects in a tap.'],
  ['⏱️', 'See your hours', 'Every approved hour, toward your goal.'],
  ['📣', 'Stay in the loop', 'News and notices from the board.'],
]

/**
 * The front door, in the same warm look as Home: one card in the middle of
 * a soft navy-to-gold wash, the club's mark and motto above it.
 */
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
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-gradient-to-br from-navy-50 via-[var(--surface)] to-gold-100/70 px-5 py-12 dark:from-navy-950 dark:via-navy-950 dark:to-navy-900">
      {/* The club seal, oversized and faint, behind everything. */}
      <Logo size={720} className="pointer-events-none absolute -bottom-56 -right-56 opacity-[0.04]" />

      <main className="rise relative my-auto flex w-full max-w-md flex-col items-center text-center">
        <Logo size={88} />
        <p className="eyebrow mt-5">GCS Key Club</p>
        <h1 className="display mt-3 text-5xl sm:text-6xl">Welcome.</h1>
        <p className="mt-4 font-[family-name:var(--font-display)] text-xl italic text-navy-700 dark:text-navy-200">
          “Caring — our way of life.”
        </p>

        <div className="card mt-10 w-full p-7 text-left sm:p-8">
          <h2 className="text-lg font-semibold">Sign in to the club</h2>
          <p className="mt-1 text-sm muted">For Key Club members only. Use your school Google account.</p>

          {!isConfigured && (
            <div className="mt-5">
              <Notice tone="error">
                Supabase isn’t configured. Copy <code>.env.example</code> to <code>.env</code> and add your
                project URL and anon key.
              </Notice>
            </div>
          )}

          {authError && (
            <div className="mt-5">
              <Notice tone="error">{authError}</Notice>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={busy || !isConfigured}
            className="btn btn-ghost mt-6 w-full py-3 text-base"
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

          <p className="mt-5 text-xs muted">
            Not on the roster yet? Ask a club officer to add you, then sign in again.
          </p>
        </div>

        <ul className="mt-10 grid w-full gap-4 text-left sm:grid-cols-3 sm:text-center">
          {PERKS.map(([icon, title, desc]) => (
            <li key={title} className="flex items-start gap-3 sm:flex-col sm:items-center sm:gap-1.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--card)] text-lg shadow-sm" aria-hidden>
                {icon}
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs muted">{desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
