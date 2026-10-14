import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { CalendarEvent, Instance } from '../../lib/calendar'
import { groupByDay, instanceTime, isToday, statusOf } from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'
import { fromDayKey } from '../../lib/format'

/**
 * Google Calendar's Schedule view — also what search results look like:
 * one row per day that has something, the date in a left column, then
 * dot · time · title for each event.
 */
export default function AgendaView({
  instances,
  undatedEvents = [],
  userId,
  onOpen,
  empty,
}: {
  instances: Instance[]
  undatedEvents?: CalendarEvent[]
  userId: string | null
  onOpen: (instance: Instance, rect: DOMRect) => void
  empty: string
}) {
  const days = useMemo(() => [...groupByDay(instances).entries()], [instances])

  if (days.length === 0 && undatedEvents.length === 0) {
    return <p className="px-6 py-16 text-center muted">{empty}</p>
  }

  let lastMonth = ''

  return (
    <div className="cal-scroll h-full overflow-y-auto px-2 py-2 sm:px-4">
      {days.map(([key, list]) => {
        const date = fromDayKey(key)
        const today = isToday(date)
        const month = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        const newMonth = month !== lastMonth
        lastMonth = month

        return (
          <div key={key}>
            {newMonth && (
              <p className="px-2 pb-1 pt-4 text-sm font-medium muted first:pt-1">{month}</p>
            )}
            <div className="flex gap-2 border-b border-[var(--line)] py-1.5 last:border-b-0">
              <div className="flex w-[4.5rem] shrink-0 items-start gap-1.5 pt-1 sm:w-24">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-xl ${
                    today ? 'bg-navy-600 text-white dark:bg-navy-300 dark:text-navy-950' : ''
                  }`}
                >
                  {date.getDate()}
                </span>
                <span
                  className={`pt-1.5 text-[11px] font-medium uppercase leading-tight ${
                    today ? 'text-navy-600 dark:text-navy-200' : 'muted'
                  }`}
                >
                  {date.toLocaleDateString(undefined, { month: 'short' })},{' '}
                  {date.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
              </div>

              <ul className="min-w-0 flex-1">
                {list.map((instance) => {
                  const status = statusOf(instance.event, instance.start, userId)
                  return (
                    <li key={instance.id}>
                      <button
                        type="button"
                        data-ec={colorOf(instance.event)}
                        onClick={(e) => onOpen(instance, e.currentTarget.getBoundingClientRect())}
                        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition sm:rounded-full hover:bg-[var(--surface-2)] ${
                          status === 'past' ? 'opacity-55' : ''
                        }`}
                      >
                        <span
                          className={`size-3 shrink-0 rounded-full ${status === 'going' ? 'ec-dot' : 'ec-ring'}`}
                          aria-hidden
                        />
                        {/* Phones stack title over time, as the Google app does. */}
                        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                          <span className="order-2 shrink-0 text-xs tabular-nums muted sm:order-1 sm:w-36 sm:text-sm">
                            {instance.allDay ? 'All day' : instanceTime(instance)}
                          </span>
                          <span className="order-1 min-w-0 truncate font-medium sm:order-2 sm:flex-1">
                            {instance.event.title}
                            {instance.event.location && (
                              <span className="hidden font-normal muted md:inline"> · {instance.event.location}</span>
                            )}
                          </span>
                        </span>
                        {status === 'going' && (
                          <span className="hidden shrink-0 text-xs font-medium text-emerald-700 sm:inline dark:text-emerald-300">
                            Going
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )
      })}

      {undatedEvents.length > 0 && (
        <div className="pt-4">
          <p className="px-2 pb-1 text-sm font-medium muted">No date yet</p>
          <ul>
            {undatedEvents.map((event) => (
              <li key={event.id}>
                <Link
                  to={`/post/${event.slug}`}
                  data-ec={colorOf(event)}
                  className="flex items-center gap-3 rounded-full px-3 py-2 text-sm transition hover:bg-[var(--surface-2)] sm:ml-24"
                >
                  <span className="ec-ring size-3 shrink-0 rounded-full" aria-hidden />
                  <span className="w-24 shrink-0 text-xs muted sm:w-36 sm:text-sm">Date TBA</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
