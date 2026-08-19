import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'

/**
 * Gate for every signed-in page.
 *
 * A session with no readable profile means the account exists in auth but
 * the roster row is gone or deactivated — RLS is denying reads. That is a
 * revoked member, not a loading state.
 */
export default function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode
  adminOnly?: boolean
}) {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="Checking your membership" />

  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (!profile) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-4xl" aria-hidden>
          🔒
        </div>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-semibold">
          Your membership is inactive
        </h1>
        <p className="mt-2 text-sm muted">
          This account is signed in but is no longer on the Key Club roster. Ask an officer to
          reactivate it.
        </p>
        <button type="button" className="btn btn-ghost mt-6" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  if (adminOnly && !isAdmin) return <Navigate to="/" replace />

  return <>{children}</>
}
