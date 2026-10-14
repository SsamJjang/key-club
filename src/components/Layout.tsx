import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './ui'
import { LogoWordmark } from './Logo'

const LINKS = [
  { to: '/', label: 'Home', end: true, icon: 'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/news', label: 'News', icon: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5' },
  { to: '/events', label: 'Events', icon: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/directory', label: 'Members', icon: 'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20c.7-3.6 3.2-5.5 6.5-5.5s5.8 1.9 6.5 5.5M16 4.5a3 3 0 0 1 0 6M18 14.5c2 .6 3.2 2.4 3.5 5.5' },
  { to: '/hours', label: 'Hours', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2' },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function AccountMenu() {
  const { profile, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!profile) return null

  const badge = profile.board?.label ?? (profile.role !== 'member' ? profile.role : null)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-[var(--line)] p-1 text-sm font-medium transition hover:border-[var(--line-strong)] sm:pr-3"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={profile.full_name} url={profile.avatar_url} size={28} />
        <span className="hidden sm:inline">{profile.full_name.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="card rise absolute right-0 top-11 z-50 w-64 overflow-hidden p-1.5 shadow-[var(--shadow-lg)]" role="menu">
          <div className="px-3 py-2.5">
            <p className="truncate font-semibold">{profile.full_name}</p>
            <p className="truncate text-xs muted">{profile.email}</p>
            {badge && (
              <span className="tag mt-2 bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-200">{badge}</span>
            )}
          </div>
          <div className="my-1 border-t border-[var(--line)]" />
          <MenuLink to="/me">My profile</MenuLink>
          {isAdmin && <MenuLink to="/admin">Admin</MenuLink>}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-[var(--surface-2)] dark:text-red-300"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function MenuLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} role="menuitem" className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--surface-2)]">
      {children}
    </Link>
  )
}

export default function Layout() {
  const { isAdmin } = useAuth()
  const location = useLocation()
  // The calendar is an app screen, not a page: edge to edge, no footer.
  const fullBleed = location.pathname === '/events'

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link to="/" className="shrink-0" aria-label="Key Club home">
            <LogoWordmark size={34} />
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="tag bg-[image:var(--gold)] text-[var(--gold-ink)]">Admin</span>
              </NavLink>
            )}
          </nav>

          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      {fullBleed ? (
        <main className="w-full">
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 sm:px-6 sm:pt-10 md:pb-16">
          <Outlet />
        </main>
      )}

      <footer className={`hidden border-t border-[var(--line)] ${fullBleed ? '' : 'md:block'}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm">
          <LogoWordmark size={24} />
          <p className="faint">Caring — our way of life.</p>
        </div>
      </footer>

      {/* Phone tab bar — thumbs live at the bottom. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-5">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold ${
                  isActive ? 'text-navy-600 dark:text-gold-300' : 'muted'
                }`
              }
            >
              <NavIcon d={l.icon} />
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
