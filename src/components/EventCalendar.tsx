import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Post } from '../lib/types'
import { formatTime, hasEnded } from '../lib/format'

export interface CalendarEvent extends Post {
  going: number
  mine: boolean
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local YYYY-MM-DD. Never toISOString here — it shifts the day by timezone. */
function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function fromKey(key: string) {
  return new Date(`${key}T00:00:00`)
}

type Status = 'past' | 'going' | 'full' | 'closed' | 'open'

function statusOf(event: CalendarEvent): Status {
  if (hasEnded(event)) return 'past'
  if (event.mine) return 'going'
  if (event.capacity && event.going >= event.capacity) return 'full'
  if (!event.signup_open) return 'closed'
  return 'open'
}

const CHIP: Record<Status, string> = {
  past: 'bg-[var(--surface)] muted',
  going: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  full: 'bg-navy-100 text-navy-700 dark:bg-navy-800 dark:text-navy-200',
  closed: 'bg-navy-100 text-navy-700 dark:bg-navy-800 dark:text-navy-200',
  open: 'bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-200',
}

const DOT: Record<Status, string> = {
  past: 'bg-[var(--ink-soft)]',
  going: 'bg-emerald-500',
  full: 'bg-navy-400',
  closed: 'bg-navy-400',
  open: 'bg-gold-400',
}

/** A "add this to my own calendar" link, so members actually turn up. */
function googleCalendarUrl(event: CalendarEvent) {
  if (!event.starts_at) return null
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '')
  const start = new Date(event.starts_at)
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 36e5)

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${stamp(start.toISOString())}/${stamp(end.toISOString())}`,
    details: event.summary ?? '',
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function EventDetail({
  event,
  onRsvp,
  busy,
}: {
  event: CalendarEvent
  onRsvp: (event: CalendarEvent) => void
  busy: boolean
}) {
  const status = statusOf(event)
  const spotsLeft = event.capacity ? Math.max(0, event.capacity - event.going) : null
  const pct = event.capacity ? Math.min(100, (event.going / event.capacity) * 100) : 0
  const gcal = googleCalendarUrl(event)

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-1 size-2.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <Link
            to={`/post/${event.slug}`}
            className="font-[family-name:var(--font-display)] text-lg font-semibold leading-snug hover:underline"
          >
            {event.title}
          </Link>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm muted">
            {event.starts_at && (
              <span>
                🕒 {formatTime(event.starts_at)}
                {event.ends_at && ` – ${formatTime(event.ends_at)}`}
              </span>
            )}
            {event.location && <span>📍 {event.location}</span>}
            {event.service_hours ? <span>⏱️ {event.service_hours} hrs</span> : null}
          </p>

          {event.summary && <p className="mt-2 text-sm">{event.summary}</p>}

          {/* How full it is — the nudge to sign up. */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {event.going} {event.going === 1 ? 'member' : 'members'} going
              </span>
              {spotsLeft !== null && (
                <span className={spotsLeft === 0 ? 'muted' : 'font-semibold text-gold-600 dark:text-gold-300'}>
                  {spotsLeft === 0 ? 'Full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
                </span>
              )}
            </div>
            {event.capacity ? (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
                <div
                  className={`h-full rounded-full ${spotsLeft === 0 ? 'bg-navy-400' : 'bg-gold-400'}`}
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRsvp(event)}
              disabled={busy || (status !== 'open' && status !== 'going')}
              className={`btn py-1.5 text-sm ${event.mine ? 'btn-ghost' : 'btn-primary'}`}
            >
              {busy
                ? 'Saving…'
                : event.mine
                  ? '✓ You’re going — cancel'
                  : status === 'past'
                    ? 'Already happened'
                    : status === 'full'
                      ? 'Full'
                      : status === 'closed'
                        ? 'Sign-ups closed'
                        : 'Count me in'}
            </button>

            {gcal && status !== 'past' && (
              <a
                href={gcal}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost py-1.5 text-sm"
              >
                Add to my calendar
              </a>
            )}

            <Link to={`/post/${event.slug}`} className="btn btn-ghost py-1.5 text-sm">
              Details
            </Link>
          </div>
        </div>
      </div>
    </article>
  )
}

export default function EventCalendar({
  events,
  onRsvp,
  busyId,
  isAdmin = false,
}: {
  events: CalendarEvent[]
  onRsvp: (event: CalendarEvent) => void
  busyId: string | null
  isAdmin?: boolean
}) {
  const today = new Date()
  const [cursor, setCursor] = useState(() => startOfMonth(today))
  const [selected, setSelected] = useState<string>(dayKey(today))
  const gridRef = useRef<HTMLDivElement>(null)
  const [focusDay, setFocusDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      if (!event.starts_at) continue
      const key = dayKey(new Date(event.starts_at))
      const list = map.get(key)
      if (list) list.push(event)
      else map.set(key, [event])
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
    }
    return map
  }, [events])

  const cells = useMemo(() => {
    const first = startOfMonth(cursor)
    const gridStart = new Date(first)
    gridStart.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + i)
      return date
    })
  }, [cursor])

  // Keep the selected day reachable when the month changes.
  useEffect(() => {
    const sel = fromKey(selected)
    if (sel.getMonth() !== cursor.getMonth() || sel.getFullYear() !== cursor.getFullYear()) {
      setSelected(dayKey(startOfMonth(cursor)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  const undated = events.filter((e) => !e.starts_at)
  const selectedEvents = byDay.get(selected) ?? []
  const todayKey = dayKey(today)

  const monthEvents = useMemo(
    () =>
      events.filter((e) => {
        if (!e.starts_at) return false
        const d = new Date(e.starts_at)
        return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear()
      }),
    [events, cursor],
  )

  const monthGoing = monthEvents.filter((e) => e.mine).length
  const monthOpen = monthEvents.filter((e) => statusOf(e) === 'open').length

  const nextEvent = useMemo(
    () =>
      events
        .filter((e) => e.starts_at && !hasEnded(e))
        .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))[0],
    [events],
  )

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  function moveSelection(days: number) {
    const next = fromKey(selected)
    next.setDate(next.getDate() + days)
    setSelected(dayKey(next))
    setFocusDay(dayKey(next))
    if (next.getMonth() !== cursor.getMonth() || next.getFullYear() !== cursor.getFullYear()) {
      setCursor(startOfMonth(next))
    }
  }

  // Focus follows arrow-key navigation so screen readers keep up.
  useEffect(() => {
    if (!focusDay) return
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)
    el?.focus()
    setFocusDay(null)
  }, [focusDay, cells])

  function onKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (e.key in moves) {
      e.preventDefault()
      moveSelection(moves[e.key])
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      shiftMonth(-1)
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      shiftMonth(1)
    }
  }

  return (
    <div>
      <div className="card overflow-hidden">
        {/* Month header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="btn btn-ghost px-3 py-1.5"
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="btn btn-ghost px-3 py-1.5"
              aria-label="Next month"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => {
                setCursor(startOfMonth(today))
                setSelected(todayKey)
              }}
              className="btn btn-ghost ml-1 py-1.5 text-sm"
            >
              Today
            </button>
          </div>

          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>

          <p className="text-xs muted">
            {monthEvents.length === 0
              ? 'No events this month'
              : `${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'}${
                  monthGoing ? ` · you’re in ${monthGoing}` : ''
                }${monthOpen ? ` · ${monthOpen} open` : ''}`}
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--line)] px-4 py-2 text-[11px] muted">
          {(
            [
              ['open', 'Open for sign-ups'],
              ['going', 'You’re going'],
              ['full', 'Full or closed'],
              ['past', 'Past'],
            ] as [Status, string][]
          ).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${DOT[key]}`} aria-hidden />
              {label}
            </span>
          ))}
          <span className="ml-auto hidden sm:inline">Arrow keys to move · Enter to open</span>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 border-b border-[var(--line)]">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide muted"
            >
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{day[0]}</span>
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-7"
          role="grid"
          onKeyDown={onKeyDown}
          aria-label="Event calendar"
        >
          {cells.map((date) => {
            const key = dayKey(date)
            const dayEvents = byDay.get(key) ?? []
            const inMonth = date.getMonth() === cursor.getMonth()
            const isToday = key === todayKey
            const isSelected = key === selected

            return (
              <button
                type="button"
                key={key}
                data-day={key}
                role="gridcell"
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelected(key)}
                aria-selected={isSelected}
                aria-label={`${date.toDateString()}, ${dayEvents.length} event${
                  dayEvents.length === 1 ? '' : 's'
                }`}
                className={`min-h-16 border-b border-r border-[var(--line)] p-1.5 text-left align-top transition sm:min-h-28 ${
                  inMonth ? '' : 'opacity-40'
                } ${
                  isSelected
                    ? 'bg-navy-50 ring-2 ring-inset ring-navy-400 dark:bg-navy-800'
                    : 'hover:bg-[var(--surface)]'
                }`}
              >
                <span
                  className={`inline-grid size-6 place-items-center rounded-full text-xs font-semibold ${
                    isToday ? 'bg-navy-600 text-white' : ''
                  }`}
                >
                  {date.getDate()}
                </span>

                <div className="mt-1 hidden space-y-0.5 sm:block">
                  {dayEvents.slice(0, 3).map((event) => {
                    const status = statusOf(event)
                    return (
                      <div
                        key={event.id}
                        className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ${CHIP[status]}`}
                      >
                        {status === 'going' && <span aria-hidden>✓</span>}
                        <span className="truncate">{event.title}</span>
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <div className="px-1 text-[10px] font-semibold muted">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>

                {dayEvents.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {dayEvents.slice(0, 4).map((event) => (
                      <span
                        key={event.id}
                        className={`size-1.5 rounded-full ${DOT[statusOf(event)]}`}
                        aria-hidden
                      />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {monthEvents.length === 0 && nextEvent?.starts_at && (
        <div className="mt-4 text-center">
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => {
              const d = new Date(nextEvent.starts_at!)
              setCursor(startOfMonth(d))
              setSelected(dayKey(d))
            }}
          >
            Jump to the next event →{' '}
            {new Date(nextEvent.starts_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </button>
        </div>
      )}

      {/* Selected day */}
      <div className="mt-6">
        <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
          {fromKey(selected).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </h3>

        {selectedEvents.length === 0 ? (
          <div className="card px-5 py-6 text-sm muted">
            Nothing scheduled this day.
            {isAdmin && (
              <>
                {' '}
                <Link to="/admin/posts/new" className="font-semibold underline">
                  Add an event
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {selectedEvents.map((event) => (
              <EventDetail
                key={event.id}
                event={event}
                onRsvp={onRsvp}
                busy={busyId === event.id}
              />
            ))}
          </div>
        )}
      </div>

      {undated.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
            No date set yet
          </h3>
          <div className="space-y-3">
            {undated.map((event) => (
              <EventDetail
                key={event.id}
                event={event}
                onRsvp={onRsvp}
                busy={busyId === event.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
