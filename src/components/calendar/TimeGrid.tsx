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
const GUTTER = '4rem'

/** "GMT+9", for the corner above the hour gutter. */
function zoneLabel() {
  const mins = -new Date().getTimezoneOffset()
  const h = Math.trunc(mins / 60)
  const m = Math.abs(mins % 60)
  return `GMT${h >= 0 ? '+' : ''}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/**
 * Google Calendar's week and day views: weekday and big date on top, an
 * all-day strip, then a scrolling hour grid with a red line at the current
 * time. Officers click an empty slot to start an event at that time.
 */
export default function TimeGrid({
  days,
  byDay,
  userId,
  isAdmin,
  onOpen,
  onDay,
  onCreate,
}: {
  days: Date[]
  byDay: Map<string, Instance[]>
  userId: string | null
  isAdmin: boolean
  onOpen: (instance: Instance, rect: DOMRect) => void
  onDay: (date: Date) => void
  onCreate: (date: Date) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => nowFraction())

  const visible = useMemo(() => days.flatMap((d) => byDay.get(dayKey(d)) ?? []), [days, byDay])
  const [firstBusy] = useMemo(() => busyHours(visible), [visible])
  const single = days.length === 1

  // Open scrolled to the morning, or earlier if something starts earlier.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = Math.max(0, Math.min(7, firstBusy) * HOUR_PX - 8)
  }, [firstBusy, days])

  useEffect(() => {
    const id = setInterval(() => setNow(nowFraction()), 60_000)
    return () => clearInterval(id)
  }, [])

  // The header rows sit outside the scroller, so they need the scrollbar's
  // width as right padding to keep their columns over the grid's.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () =>
      rootRef.current?.style.setProperty('--sbw', `${el.offsetWidth - el.clientWidth}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const columns = `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`

  function createAt(date: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (!isAdmin || e.target !== e.currentTarget) return
    const y = e.nativeEvent.offsetY
    const halfHours = Math.floor(y / (HOUR_PX / 2))
    const at = new Date(date)
    at.setHours(Math.floor(halfHours / 2), (halfHours % 2) * 30, 0, 0)
    onCreate(at)
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col select-none">
      {/* Day headers */}
      <div className="grid shrink-0 pr-[var(--sbw,0px)]" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((date) => {
          const today = isToday(date)
          return (
            <div key={dayKey(date)} className={`flex flex-col pt-2 ${single ? 'items-start pl-2' : 'items-center'}`}>
              <span
                className={`text-[11px] font-medium uppercase tracking-wide ${
                  today ? 'text-navy-600 dark:text-navy-200' : 'muted'
                }`}
              >
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <button
                type="button"
                onClick={() => onDay(date)}
                aria-current={today ? 'date' : undefined}
                className={`mt-0.5 grid size-11 place-items-center rounded-full text-2xl transition ${
                  today
                    ? 'bg-navy-600 text-white dark:bg-navy-300 dark:text-navy-950'
                    : 'hover:bg-[var(--surface-2)]'
                }`}
              >
                {date.getDate()}
              </button>
            </div>
          )
        })}
      </div>

      {/* All-day strip */}
      <div
        className="grid shrink-0 border-b border-[var(--line)] pr-[var(--sbw,0px)]"
        style={{ gridTemplateColumns: columns }}
      >
        <div className="self-end pb-1 pr-2 text-right text-[10px] muted">{zoneLabel()}</div>
        {days.map((date) => {
          const list = (byDay.get(dayKey(date)) ?? []).filter((i) => i.allDay)
          return (
            <div key={dayKey(date)} className="min-h-6 min-w-0 border-l border-[var(--line)] px-0.5 pb-1 pt-1">
              {list.map((instance) => {
                const status = statusOf(instance.event, instance.start, userId)
                return (
                  <button
                    key={instance.id}
                    type="button"
                    data-ec={colorOf(instance.event)}
                    onClick={(e) => onOpen(instance, e.currentTarget.getBoundingClientRect())}
                    className={`ec-solid mb-0.5 flex h-5 w-full items-center truncate rounded px-1.5 text-left text-xs font-medium hover:brightness-105 ${
                      status === 'past' ? 'ec-past' : ''
                    }`}
                  >
                    <span className="truncate">{instance.event.title}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="cal-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: columns, height: DAY_PX }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] muted"
                style={{ top: hour * HOUR_PX }}
              >
                {formatHour(hour)}
              </span>
            ))}
          </div>

          {days.map((date) => {
            const list = byDay.get(dayKey(date)) ?? []
            const placed = layoutDay(list)
            const today = isToday(date)

            return (
              <div
                key={dayKey(date)}
                onClick={(e) => createAt(date, e)}
                className={`relative border-l border-[var(--line)] ${isAdmin ? 'cursor-pointer' : ''}`}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${HOUR_PX}px)`,
                }}
              >
                {today && (
                  <div
                    className="cal-now pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: now * DAY_PX }}
                    aria-hidden
                  />
                )}

                {placed.map(({ instance, left, width, top, height }) => {
                  const status = statusOf(instance.event, instance.start, userId)
                  const px = height * DAY_PX
                  // Google cascades collisions: every column but the last
                  // reaches under its right-hand neighbour, which (starting
                  // later, so drawn later) sits on top.
                  const span = left + width >= 0.999 ? width : Math.min(1 - left, width * 1.7)
                  const short = px < 40
                  const end =
                    instance.event.ends_at && sameDay(instance.start, instance.end)
                      ? ` – ${shortTime(instance.end)}`
                      : ''
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      data-ec={colorOf(instance.event)}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(instance, e.currentTarget.getBoundingClientRect())
                      }}
                      style={{
                        top: top * DAY_PX + 1,
                        height: Math.max(18, px - 2),
                        left: `calc(${left * 100}% + 1px)`,
                        width: `calc(${span * 100}% - 8px)`,
                      }}
                      className={`absolute z-10 overflow-hidden rounded-md px-1.5 text-left text-xs leading-tight shadow-sm ring-1 ring-[var(--card)] transition hover:z-30 hover:shadow-md ${
                        status === 'going' ? 'ec-solid' : 'ec-soft'
                      } ${status === 'past' ? 'ec-past' : ''} ${short ? 'py-0' : 'py-1'}`}
                    >
                      {short ? (
                        <span className="block truncate">
                          <span className="font-medium">{instance.event.title}</span>, {shortTime(instance.start)}
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-medium">{instance.event.title}</span>
                          <span className="block truncate opacity-90">
                            {shortTime(instance.start)}
                            {end}
                          </span>
                          {px > 64 && instance.event.location && (
                            <span className="block truncate opacity-90">{instance.event.location}</span>
                          )}
                        </>
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
