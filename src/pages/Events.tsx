import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Post } from '../lib/types'
import { formatOccurrence, formatServiceHours, hasEnded, nextOccurrence, occurrences } from '../lib/format'
import { addSignup, datesFor, distinctMembers, removeSignup, signupKey } from '../lib/rsvp'
import { EmptyState, Notice, PageHeader, Spinner } from '../components/ui'
import EventCalendar from '../components/EventCalendar'
import type { CalendarEvent } from '../components/EventCalendar'

type EventRow = CalendarEvent

export default function Events() {
  const { profile, isAdmin } = useAuth()
  const [rows, setRows] = useState<EventRow[]>([])
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [view, setView] = useState<'list' | 'calendar'>(
    () => (localStorage.getItem('kc-events-view') as 'list' | 'calendar') ?? 'calendar',
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [eventsRes, signupsRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*')
        .eq('published', true)
        .eq('category', 'event')
        .order('starts_at', { ascending: true }),
      supabase.from('event_signups').select('post_id, user_id, occurs_on'),
    ])

    if (eventsRes.error) setError(eventsRes.error.message)

    const signups =
      (signupsRes.data as { post_id: string; user_id: string; occurs_on: string | null }[]) ?? []
    const events = (eventsRes.data as Post[]) ?? []

    setRows(
      events.map((e) => {
        const rows = signups.filter((s) => s.post_id === e.id)
        return {
          ...e,
          // A member down for five dates of a series is still one member going.
          going: distinctMembers(rows),
          mine: rows.some((s) => s.user_id === profile?.id),
          signups: rows,
        }
      }),
    )
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    void load()
  }, [load])

  // RSVP straight from the calendar, so signing up never costs a page load.
  // `day` is the date cell that was clicked; for a series it decides which
  // occurrence the sign-up is for, and is ignored for a one-date event.
  const toggleRsvp = useCallback(
    async (event: EventRow, day: Date | null) => {
      if (!profile) return
      setBusyId(event.id)
      setError(null)

      const key = signupKey(event, day)
      const has = event.signups.some((s) => s.user_id === profile.id && s.occurs_on === key)

      const { error } = has
        ? await removeSignup(event.id, profile.id, key)
        : await addSignup(event.id, profile.id, key)

      if (error) setError(error.message)
      await load()
      setBusyId(null)
    },
    [profile, load],
  )

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
        <EventCalendar
          events={rows}
          onRsvp={toggleRsvp}
          busyId={busyId}
          isAdmin={isAdmin}
          userId={profile?.id ?? null}
        />
      ) : list.length === 0 ? (
        <EmptyState icon="🗓️" title={`No ${tab} events`}>
          {tab === 'upcoming'
            ? 'Officers will post the next service project here.'
            : 'Past events show up here once they wrap.'}
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {list.map((e) => {
            // The badge shows the occurrence that matters to the reader: the
            // next one still to come, or the final one for a series that is
            // already over.
            const all = occurrences(e)
            const when = tab === 'upcoming' ? (nextOccurrence(e) ?? all[0]) : all[all.length - 1]
            const hours = formatServiceHours(e)

            return (
            <li key={e.id}>
              <Link
                to={`/post/${e.slug}`}
                className="card group flex flex-wrap items-center gap-5 p-5 transition hover:border-navy-300 dark:hover:border-navy-600"
              >
                <div className="w-16 shrink-0 rounded-xl bg-navy-50 py-2 text-center dark:bg-navy-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-500 dark:text-navy-200">
                    {when ? when.toLocaleDateString(undefined, { month: 'short' }) : '—'}
                  </div>
                  <div className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-none">
                    {when ? when.getDate() : '·'}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold leading-snug transition group-hover:text-navy-600 dark:group-hover:text-navy-200">
                    {e.title}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm muted">
                    {when ? (
                      <span>{formatOccurrence(when, e.all_day)}</span>
                    ) : (
                      <span>Date to be announced</span>
                    )}
                    {e.recurrence_note && <span>🔁 {e.recurrence_note}</span>}
                    {e.location && <span>📍 {e.location}</span>}
                    {hours && <span>⏱️ {hours}</span>}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <span className="muted">
                    {e.going}
                    {e.capacity ? ` / ${e.capacity}` : ''} going
                  </span>
                  {e.mine && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                      {all.length > 1
                        ? `You’re in · ${datesFor(e.signups, profile?.id ?? '')}/${all.length} dates`
                        : 'You’re in'}
                    </span>
                  )}
                </div>
              </Link>
            </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
