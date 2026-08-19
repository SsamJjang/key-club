import type { ReactNode } from 'react'
import { initials } from '../lib/format'
import type { Category, Role } from '../lib/types'

export function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string
  url?: string | null
  size?: number
}) {
  const style = { width: size, height: size, fontSize: size * 0.36 }
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <div
      style={style}
      className="rounded-full shrink-0 grid place-items-center font-semibold bg-navy-100 text-navy-700 dark:bg-navy-800 dark:text-navy-100"
      aria-hidden
    >
      {initials(name)}
    </div>
  )
}

const CATEGORY_STYLE: Record<Category, string> = {
  news: 'bg-navy-100 text-navy-700 dark:bg-navy-800 dark:text-navy-100',
  notice: 'bg-gold-100 text-gold-600 dark:bg-gold-600/25 dark:text-gold-200',
  event: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CATEGORY_STYLE[category]}`}
    >
      {category}
    </span>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'member') return null
  return (
    <span className="inline-flex items-center rounded-full bg-gold-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-600 dark:bg-gold-500/25 dark:text-gold-200">
      {role}
    </span>
  )
}

/**
 * An elected seat — President, VP, and so on. Deliberately styled apart from
 * RoleBadge: that one is about permissions, this one is about the office.
 */
export function BoardBadge({ label }: { label?: string | null }) {
  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gold-300 bg-gold-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-600 dark:border-gold-500/40 dark:bg-gold-500/20 dark:text-gold-200">
      <span aria-hidden>★</span>
      {label}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 muted text-sm">
      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}…
    </div>
  )
}

export function EmptyState({
  icon = '📭',
  title,
  children,
}: {
  icon?: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="card px-6 py-14 text-center">
      <div className="text-3xl" aria-hidden>
        {icon}
      </div>
      <p className="mt-3 font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm muted max-w-sm mx-auto">{children}</p>}
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success'
  children: ReactNode
}) {
  const tones = {
    info: 'bg-navy-50 text-navy-700 border-navy-200 dark:bg-navy-800/60 dark:text-navy-100 dark:border-navy-700',
    error:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900',
    success:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="status">
      {children}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-500 dark:text-gold-300">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide muted">{label}</div>
    </div>
  )
}
