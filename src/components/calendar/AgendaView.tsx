import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Instance } from '../../lib/calendar'
import { groupByDay, instanceTime, isToday, rowsFor, statusOf } from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'
import { formatServiceHours, fromDayKey } from '../../lib/format'

/**
 * The schedule list.
 *
 * This is the view for planning rather than browsing: no grid, no empty
 * days, just what is coming in the order it is coming, with enough on
 * each row to decide whether to sign up without opening anything.
 */
export default function AgendaView({
  instances,
  undatedEvents,
  userId,
  onOpen,
  rangeLabel,
  showHeaders = true,
}: {
  instances: Instance[]
  undatedEvents: Instance['event'][]
  userId: string | null
  onOpen: (instance: Instance, rect: DOMRect) => void
  rangeLabel: string
  /** Off when the surrounding page already names the day — no echo. */
  showHeaders?: boolean
}) {
  const days = useMemo(() => [...groupByDay(instances).entries()], [instances])

  if (days.length === 0 && undatedEvents.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="text-3xl" aria-hidden>
          🗓️
        </div>
        <p className="mt-3 font-semibold">Nothing {rangeLabel}</p>
        <p className="mt-1 text-sm muted">
          Try widening the range, or clearing the filters in the sidebar.
        </p>
      </div>
    )
  }

  return (
    <div className="cal-scroll max-h-[70vh] overflow-y-auto">
      {days.map(([key, list]) => {
        const date = fromDayKey(key)
        const today = isToday(date)

        return (
          <section key={key} className="border-b border-[var(--line)] last:border-b-0">
            {showHeaders && (
            <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-[var(--line)] bg-[var(--card)] px-4 py-1.5">
              <span
                className={`text-sm font-semibold ${today ? 'text-navy-600 dark:text-navy-200' : ''}`}
              >
                {date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              {today && (
                <span className="rounded-full bg-navy-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Today
                </span>
              )}
              <span className="ml-auto text-xs muted">
                {list.length} {list.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            )}

            <ul>
              {list.map((instance) => {
                const { event } = instance
                const status = statusOf(event, instance.start, userId)
                const { going, mine, spotsLeft } = rowsFor(instance, userId)
                const hours = formatServiceHours(event)

                return (
                  <li key={instance.id}>
                    <button
                      type="button"
                      data-ec={colorOf(event)}
                      onClick={(e) => onOpen(instance, e.currentTarget.getBoundingClientRect())}
                      className={`ec-rule flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-[var(--surface)] ${
                        status === 'past' ? 'opacity-55' : ''
                      }`}
                    >
                      <span className="w-32 shrink-0 text-xs font-semibold tabular-nums muted">
                        {instanceTime(instance)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {mine && <span aria-hidden>✓ </span>}
                          {event.title}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs muted">
                          {event.calendar_label && (
                            <span className="ec-text font-semibold">{event.calendar_label}</span>
                          )}
                          {event.location && <span>📍 {event.location}</span>}
                          {hours && <span>⏱️ {hours}</span>}
                          {event.recurrence_note && <span>🔁 {event.recurrence_note}</span>}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="muted">
                          {going}
                          {event.capacity ? `/${event.capacity}` : ''} going
                        </span>
                        {status === 'open' && spotsLeft !== null && spotsLeft <= 3 && (
                          <span className="rounded-full bg-gold-100 px-2 py-0.5 font-semibold text-gold-600 dark:bg-gold-500/20 dark:text-gold-200">
                            {spotsLeft} left
                          </span>
                        )}
                        {status === 'closed' && <span className="muted">Closed</span>}
                        {status === 'full' && <span className="muted">Full</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {undatedEvents.length > 0 && (
        <section>
          {showHeaders && (
            <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--card)] px-4 py-1.5 text-sm font-semibold">
              No date set yet
            </div>
          )}
          <ul>
            {undatedEvents.map((event) => (
              <li key={event.id}>
                <Link
                  to={`/post/${event.slug}`}
                  data-ec={colorOf(event)}
                  className="ec-rule flex items-center gap-4 px-4 py-3 transition hover:bg-[var(--surface)]"
                >
                  <span className="w-32 shrink-0 text-xs font-semibold muted">Date TBA</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                  <span className="shrink-0 text-xs muted">{event.going} interested</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
