import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Post } from '../lib/types'
import { formatDate, formatTime, hasEnded } from '../lib/format'
import { EmptyState, Notice, PageHeader, Spinner } from '../components/ui'
import EventCalendar from '../components/EventCalendar'

interface EventRow extends Post {
  going: number
  mine: boolean
}

export default function Events() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<EventRow[]>([])
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [view, setView] = useState<'list' | 'calendar'>(
    () => (localStorage.getItem('kc-events-view') as 'list' | 'calendar') ?? 'calendar',
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [eventsRes, signupsRes] = await Promise.all([
        supabase
          .from('posts')
          .select('*')
          .eq('published', true)
          .eq('category', 'event')
          .order('starts_at', { ascending: true }),
        supabase.from('event_signups').select('post_id, user_id'),
      ])

      if (cancelled) return
      if (eventsRes.error) setError(eventsRes.error.message)

      const signups = (signupsRes.data as { post_id: string; user_id: string }[]) ?? []
      const events = (eventsRes.data as Post[]) ?? []

      setRows(
        events.map((e) => ({
          ...e,
          going: signups.filter((s) => s.post_id === e.id).length,
          mine: signups.some((s) => s.post_id === e.id && s.user_id === profile?.id),
        })),
      )
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [profile?.id])

  const { upcoming, past } = useMemo(
    () => ({
      upcoming: rows.filter((e) => !hasEnded(e)),
      past: rows.filter(hasEnded).reverse(),
    }),
    [rows],
  )

  function chooseView(next: 'list' | 'calendar') {
    setView(next)
    localStorage.setItem('kc-events-view', next)
  }

  const list = tab === 'upcoming' ? upcoming : past

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Calendar"
        title="Events"
        subtitle="Service projects, meetings, and everything worth showing up for."
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-[var(--line)] p-1">
          {([
            ['calendar', '🗓️ Calendar'],
            ['list', '☰ List'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseView(key)}
              aria-pressed={view === key}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                view === key ? 'bg-navy-600 text-white' : 'muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'list' && (
          <div className="inline-flex rounded-xl border border-[var(--line)] p-1">
            {(['upcoming', 'past'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t ? 'bg-navy-600 text-white' : 'muted'
                }`}
              >
                {t} ({t === 'upcoming' ? upcoming.length : past.length})
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : view === 'calendar' ? (
        <EventCalendar events={rows} />
      ) : list.length === 0 ? (
        <EmptyState icon="🗓️" title={`No ${tab} events`}>
          {tab === 'upcoming'
            ? 'Officers will post the next service project here.'
            : 'Past events show up here once they wrap.'}
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {list.map((e) => (
            <li key={e.id}>
              <Link
                to={`/post/${e.slug}`}
                className="card group flex flex-wrap items-center gap-5 p-5 transition hover:border-navy-300 dark:hover:border-navy-600"
              >
                <div className="w-16 shrink-0 rounded-xl bg-navy-50 py-2 text-center dark:bg-navy-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-500 dark:text-navy-200">
                    {e.starts_at
                      ? new Date(e.starts_at).toLocaleDateString(undefined, { month: 'short' })
                      : '—'}
                  </div>
                  <div className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-none">
                    {e.starts_at ? new Date(e.starts_at).getDate() : '·'}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold leading-snug transition group-hover:text-navy-600 dark:group-hover:text-navy-200">
                    {e.title}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm muted">
                    {e.starts_at && <span>{formatDate(e.starts_at)} · {formatTime(e.starts_at)}</span>}
                    {e.location && <span>📍 {e.location}</span>}
                    {e.service_hours ? <span>⏱️ {e.service_hours} hrs</span> : null}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <span className="muted">
                    {e.going}
                    {e.capacity ? ` / ${e.capacity}` : ''} going
                  </span>
                  {e.mine && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                      You’re in
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
