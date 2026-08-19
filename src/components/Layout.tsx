import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './ui'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/news', label: 'News' },
  { to: '/events', label: 'Events' },
  { to: '/directory', label: 'Members' },
  { to: '/hours', label: 'Hours' },
]

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('kc-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      className="btn btn-ghost px-2.5"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      <span aria-hidden>{dark ? '☀️' : '🌙'}</span>
    </button>
  )
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
    window.scrollTo(0, 0)
  }, [location.pathname])

  const links = isAdmin ? [...LINKS, { to: '/admin', label: 'Admin' }] : LINKS

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--card)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="grid size-9 place-items-center rounded-xl bg-navy-600 text-base text-white" aria-hidden>
              🗝️
            </span>
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
              Key Club
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={'end' in l ? l.end : false}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-100'
                      : 'muted hover:text-navy-600 dark:hover:text-navy-200'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeToggle />
            {profile && (
              <Link
                to="/me"
                className="hidden items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-1 pr-3 text-sm font-medium transition hover:border-navy-400 md:flex"
              >
                <Avatar name={profile.full_name} url={profile.avatar_url} size={28} />
                {profile.full_name.split(' ')[0]}
              </Link>
            )}
            <button
              type="button"
              className="btn btn-ghost px-2.5 md:hidden"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label="Toggle menu"
            >
              <span aria-hidden>{open ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-[var(--line)] px-4 py-2 md:hidden">
            {[...links, { to: '/me', label: 'My profile' }].map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={'end' in l ? (l as { end?: boolean }).end : false}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2.5 text-sm font-medium ${
                    isActive ? 'bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-100' : ''
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => void signOut()}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-300"
            >
              Sign out
            </button>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--line)] py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs muted">
          <p>Key Club — caring, our way of life.</p>
          <button type="button" onClick={() => void signOut()} className="hover:underline">
            Sign out
          </button>
        </div>
      </footer>
    </div>
  )
}
