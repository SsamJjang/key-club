import { useEffect, useMemo, useRef, useState } from 'react'
import type { Instance } from '../../lib/calendar'
import {
  HOUR_PX,
  busyHours,
  dayKey,
  formatHour,
  isToday,
  layoutDay,
  nowFraction,
  sameDay,
  shortTime,
  statusOf,
} from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'

const DAY_PX = 24 * HOUR_PX

/**
 * The week and day views — one component, because a day view is a week
 * view with one column and there is no second set of bugs worth owning.
 *
 * Three things carry the usability here: events are laid out side by side
 * when they collide (so a double-booked afternoon looks double-booked),
 * a red line tracks the current time, and the grid opens scrolled to the
 * hours that actually have something in them rather than to midnight.
 */
export default function TimeGrid({
  days,
  byDay,
  userId,
  isAdmin,
  selected,
  workHours,
  onSelect,
  onOpen,
  onCreate,
}: {
  days: Date[]
  byDay: Map<string, Instance[]>
  userId: string | null
  isAdmin: boolean
  selected: string
  /** Start and end of the shaded working day, in hours. */
  workHours: [number, number]
  onSelect: (key: string) => void
  onOpen: (instance: Instance, rect: DOMRect) => void
  onCreate: (date: Date) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => nowFraction())

  const visible = useMemo(
    () => days.flatMap((d) => byDay.get(dayKey(d)) ?? []),
    [days, byDay],
  )

  const [from] = useMemo(() => busyHours(visible), [visible])

  // Open on the first hour that has something in it. Deliberately runs on
  // every change of days, so paging a week forward re-aims the scroll.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = Math.max(0, from * HOUR_PX - 8)
  }, [from, days])

  // The now-line only has to be right to the minute.
  useEffect(() => {
    const id = setInterval(() => setNow(nowFraction()), 60_000)
    return () => clearInterval(id)
  }, [])

  const columns = `4rem repeat(${days.length}, minmax(0, 1fr))`
  const anyAllDay = days.some((d) => (byDay.get(dayKey(d)) ?? []).some((i) => i.allDay))

  return (
    <div className="cal-grid overflow-hidden">
      {/* Day headers */}
      <div
        className="grid border-b border-[var(--line)]"
        style={{ gridTemplateColumns: columns }}
      >
        <div className="border-r border-[var(--line)]" />
        {days.map((date) => {
          const key = dayKey(date)
          const today = isToday(date)
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={`border-r border-[var(--line)] px-1 py-2 text-center transition hover:bg-[var(--surface)] ${
                key === selected ? 'bg-[var(--surface)]' : ''
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide muted">
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div
                className={`mx-auto mt-0.5 grid size-8 place-items-center rounded-full font-[family-name:var(--font-display)] text-lg font-semibold ${
                  today ? 'bg-navy-600 text-white' : ''
                }`}
              >
                {date.getDate()}
              </div>
            </button>
          )
        })}
      </div>

      {/* All-day / time-TBA row. Only rendered when something needs it. */}
      {anyAllDay && (
        <div
          className="grid border-b border-[var(--line)]"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="border-r border-[var(--line)] px-2 py-1.5 text-right text-[10px] font-semibold uppercase muted">
            All day
          </div>
          {days.map((date) => {
            const list = (byDay.get(dayKey(date)) ?? []).filter((i) => i.allDay)
            return (
              <div
                key={dayKey(date)}
                className="space-y-0.5 border-r border-[var(--line)] p-1"
              >
                {list.map((instance) => {
                  const status = statusOf(instance.event, instance.start, userId)
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      data-ec={colorOf(instance.event)}
                      onClick={(e) => onOpen(instance, e.currentTarget.getBoundingClientRect())}
                      className={`ec-soft flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ${
                        status === 'past' ? 'ec-past' : ''
                      } ${status === 'going' ? 'ec-going' : ''}`}
                    >
                      {status === 'going' && <span aria-hidden>✓</span>}
                      <span className="truncate">{instance.event.title}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* The hour grid */}
      <div ref={scrollRef} className="cal-scroll max-h-[62vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          {/* Hour gutter */}
          <div className="relative border-r border-[var(--line)]" style={{ height: DAY_PX }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium muted"
                style={{ top: hour * HOUR_PX }}
              >
                {hour === 0 ? '' : formatHour(hour)}
              </div>
            ))}
          </div>

          {days.map((date) => {
            const list = byDay.get(dayKey(date)) ?? []
            const placed = layoutDay(list)
            const today = isToday(date)

            return (
              <div
                key={dayKey(date)}
                className="relative border-r border-[var(--line)]"
                style={{ height: DAY_PX }}
              >
                {/* Hour lines, plus the off-hours shading behind them. */}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className={`absolute inset-x-0 cal-hour-line ${
                      hour < workHours[0] || hour >= workHours[1] ? 'cal-offhours' : ''
                    }`}
                    style={{ top: hour * HOUR_PX, height: HOUR_PX }}
                  >
                    {isAdmin && (
                      <button
                        type="button"
                        className="size-full"
                        aria-label={`New event ${date.toDateString()} at ${formatHour(hour)}`}
                        onClick={() => {
                          const at = new Date(date)
                          at.setHours(hour, 0, 0, 0)
                          onCreate(at)
                        }}
                      />
                    )}
                  </div>
                ))}

                {today && (
                  <div
                    className="cal-now pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: now * DAY_PX }}
                    aria-hidden
                  />
                )}

                {placed.map(({ instance, left, width, top, height }) => {
                  const status = statusOf(instance.event, instance.start, userId)
                  const tall = height * DAY_PX > 34
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      data-ec={colorOf(instance.event)}
                      onClick={(e) => onOpen(instance, e.currentTarget.getBoundingClientRect())}
                      style={{
                        top: top * DAY_PX,
                        height: Math.max(18, height * DAY_PX - 2),
                        left: `calc(${left * 100}% + 2px)`,
                        width: `calc(${width * 100}% - 4px)`,
                      }}
                      className={`ec-solid absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-110 ${
                        status === 'past' ? 'ec-past' : ''
                      }`}
                    >
                      <span className="block truncate font-semibold">
                        {status === 'going' && <span aria-hidden>✓ </span>}
                        {instance.event.title}
                      </span>
                      {tall && (
                        <span className="block truncate opacity-90">
                          {shortTime(instance.start)}
                          {instance.event.ends_at && !sameDay(instance.start, instance.end)
                            ? ''
                            : instance.event.ends_at
                              ? ` – ${shortTime(instance.end)}`
                              : ''}
                          {instance.event.location ? ` · ${instance.event.location}` : ''}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
