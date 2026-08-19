import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Post } from '../lib/types'
import { formatTime, hasEnded } from '../lib/format'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local YYYY-MM-DD. Never use toISOString here — it shifts across timezones. */
function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * A month view of every dated event. Six rows of seven so the grid height
 * doesn't jump between months.
 */
export default function EventCalendar({ events }: { events: Post[] }) {
  const today = new Date()
  const [cursor, setCursor] = useState(() => startOfMonth(today))
  const [selected, setSelected] = useState<string | null>(dayKey(today))

  // Events bucketed by the day they start.
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>()
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

  const undated = events.filter((e) => !e.starts_at)
  const selectedEvents = selected ? (byDay.get(selected) ?? []) : []
  const todayKey = dayKey(today)

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  return (
    <div>
      <div className="card overflow-hidden">
        {/* Month header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="btn btn-ghost px-3 py-1.5"
            aria-label="Previous month"
          >
            ←
          </button>

          <div className="text-center">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <button
              type="button"
              onClick={() => {
                setCursor(startOfMonth(today))
                setSelected(todayKey)
              }}
              className="text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200"
            >
              Today
            </button>
          </div>

          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="btn btn-ghost px-3 py-1.5"
            aria-label="Next month"
          >
            →
          </button>
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
        <div className="grid grid-cols-7">
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
                onClick={() => setSelected(key)}
                aria-pressed={isSelected}
                aria-label={`${date.toDateString()}, ${dayEvents.length} event${
                  dayEvents.length === 1 ? '' : 's'
                }`}
                className={`min-h-16 border-b border-r border-[var(--line)] p-1.5 text-left align-top transition sm:min-h-24 ${
                  inMonth ? '' : 'opacity-40'
                } ${isSelected ? 'bg-navy-50 dark:bg-navy-800' : 'hover:bg-[var(--surface)]'}`}
              >
                <span
                  className={`inline-grid size-6 place-items-center rounded-full text-xs font-semibold ${
                    isToday ? 'bg-navy-600 text-white' : ''
                  }`}
                >
                  {date.getDate()}
                </span>

                {/* Full titles on desktop, dots on phones. */}
                <div className="mt-1 hidden space-y-0.5 sm:block">
                  {dayEvents.slice(0, 2).map((event) => (
                    <div
                      key={event.id}
                      className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${
                        hasEnded(event)
                          ? 'bg-[var(--surface)] muted'
                          : 'bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-200'
                      }`}
                    >
                      {event.title}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="px-1 text-[10px] font-semibold muted">
                      +{dayEvents.length - 2} more
                    </div>
                  )}
                </div>

                {dayEvents.length > 0 && (
                  <div className="mt-1 flex gap-0.5 sm:hidden">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className="size-1.5 rounded-full bg-gold-400"
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

      {/* Selected day */}
      <div className="mt-6">
        <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
          {selected
            ? new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })
            : 'Pick a day'}
        </h3>

        {selectedEvents.length === 0 ? (
          <p className="card px-5 py-6 text-sm muted">Nothing scheduled this day.</p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map((event) => (
              <li key={event.id}>
                <Link
                  to={`/post/${event.slug}`}
                  className="card flex flex-wrap items-center gap-4 p-4 transition hover:border-navy-300 dark:hover:border-navy-600"
                >
                  <span className="text-sm font-semibold text-navy-600 dark:text-navy-200">
                    {formatTime(event.starts_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                  {event.location && (
                    <span className="text-xs muted">📍 {event.location}</span>
                  )}
                  {event.service_hours ? (
                    <span className="text-xs muted">⏱️ {event.service_hours} hrs</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {undated.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
            No date set yet
          </h3>
          <ul className="space-y-2">
            {undated.map((event) => (
              <li key={event.id}>
                <Link
                  to={`/post/${event.slug}`}
                  className="card flex items-center justify-between gap-4 p-4 text-sm transition hover:border-navy-300"
                >
                  <span className="font-medium">{event.title}</span>
                  <span className="muted">TBA</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
