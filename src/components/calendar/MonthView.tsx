import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Instance } from '../../lib/calendar'
import { WEEKDAY_SHORT, dayKey, isToday, monthCells, shortTime, statusOf } from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'
import type { Draft } from './QuickCreate'

/**
 * Google Calendar's month view: the grid fills the screen, rows share the
 * height evenly, and each cell shows as many events as fit before
 * collapsing the rest into "N more".
 *
 * All-day events are filled bars; timed ones are a dot, a time and a title.
 * A filled dot / solid bar means you are going; a hollow one means you
 * have not signed up — Google's "needs a response" look.
 */
export default function MonthView({
  cursor,
  weekStart,
  byDay,
  userId,
  isAdmin,
  onOpen,
  onDay,
  onMore,
  onCreate,
  draft = null,
}: {
  cursor: Date
  weekStart: number
  byDay: Map<string, Instance[]>
  userId: string | null
  isAdmin: boolean
  onOpen: (instance: Instance, rect: DOMRect) => void
  /** The date number was clicked: open that day. */
  onDay: (date: Date) => void
  onMore: (date: Date, rect: DOMRect) => void
  onCreate: (date: Date, rect: DOMRect) => void
  /** The unsaved event the quick-create card is editing. */
  draft?: Draft | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 700 })

  // Trailing weeks that fall entirely in the next month are dropped, so a
  // month is five rows when it fits in five — as Google does.
  const cells = useMemo(() => {
    const all = monthCells(cursor, weekStart)
    const rows = Math.ceil(all.length / 7)
    const out = all.slice(0, rows * 7)
    while (out.length > 35 && out[out.length - 7].getMonth() !== cursor.getMonth()) {
      out.splice(out.length - 7, 7)
    }
    return out
  }, [cursor, weekStart])
  const rows = cells.length / 7

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const narrow = size.w < 640
  const chipH = narrow ? 17 : 22
  const rowH = size.h / rows

  return (
    <div
      ref={ref}
      className="grid h-full min-h-0 grid-cols-7 select-none"
      style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      role="grid"
      aria-label={cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
    >
      {cells.map((date, index) => {
        const key = dayKey(date)
        const list = byDay.get(key) ?? []
        const inMonth = date.getMonth() === cursor.getMonth()
        const today = isToday(date)
        const firstRow = index < 7
        const drafting = !!draft && dayKey(draft.start) === key

        // Room for chips once the date (and, on row one, the weekday) is drawn.
        const head = (firstRow ? 44 : 30) + 4
        const fit = Math.max(0, Math.floor((rowH - head) / chipH) - (drafting ? 1 : 0))
        const shown = list.length > fit ? list.slice(0, Math.max(0, fit - 1)) : list
        const extra = list.length - shown.length

        const label =
          date.getDate() === 1
            ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : String(date.getDate())

        return (
          <div
            key={key}
            role="gridcell"
            onClick={(e) => {
              if (isAdmin && e.target === e.currentTarget) onCreate(date, e.currentTarget.getBoundingClientRect())
            }}
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-[var(--line)] pb-1 ${
              index % 7 === 6 ? 'border-r-0' : ''
            } ${isAdmin ? 'cursor-pointer' : ''}`}
          >
            <div className="pointer-events-none flex flex-col items-center pt-1.5">
              {firstRow && (
                <span className="mb-0.5 text-[11px] font-medium uppercase tracking-wide muted">
                  {narrow
                    ? WEEKDAY_SHORT[(weekStart + index) % 7][0]
                    : WEEKDAY_SHORT[(weekStart + index) % 7]}
                </span>
              )}
              <button
                type="button"
                onClick={() => onDay(date)}
                aria-current={today ? 'date' : undefined}
                aria-label={date.toDateString()}
                className={`pointer-events-auto grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-medium transition ${
                  today
                    ? 'bg-navy-600 text-white dark:bg-navy-300 dark:text-navy-950'
                    : inMonth
                      ? 'hover:bg-[var(--surface-2)]'
                      : 'text-[var(--ink-faint)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {label}
              </button>
            </div>

            <div className="pointer-events-none mt-0.5 min-w-0 px-1 [&>*]:pointer-events-auto">
              {drafting && draft && (
                <div
                  data-ec={draft.color ?? 'peacock'}
                  className={`ec-solid flex items-center truncate rounded font-medium shadow ${
                    narrow ? 'px-0.5 text-[10px]' : 'px-1.5 text-xs'
                  }`}
                  style={{ height: chipH - 2, marginBottom: 2 }}
                >
                  {!draft.allDay && !narrow && <span className="mr-1.5 opacity-90">{shortTime(draft.start)}</span>}
                  {draft.title || '(No title)'}
                </div>
              )}
              {shown.map((instance) => (
                <Chip
                  key={instance.id}
                  instance={instance}
                  userId={userId}
                  narrow={narrow}
                  height={chipH}
                  onOpen={onOpen}
                />
              ))}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={(e) => onMore(date, e.currentTarget.getBoundingClientRect())}
                  className={`block w-full truncate rounded px-1.5 text-left font-medium transition hover:bg-[var(--surface-2)] ${
                    narrow ? 'text-[10px]' : 'text-xs'
                  }`}
                  style={{ height: chipH, lineHeight: `${chipH}px` }}
                >
                  {narrow ? `+${extra}` : `${extra} more`}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One event in a month cell — or in the "N more" card. */
export function Chip({
  instance,
  userId,
  narrow = false,
  height = 22,
  onOpen,
}: {
  instance: Instance
  userId: string | null
  narrow?: boolean
  height?: number
  onOpen: (instance: Instance, rect: DOMRect) => void
}) {
  const status = statusOf(instance.event, instance.start, userId)
  const going = status === 'going'
  const past = status === 'past'
  const bar = instance.allDay || narrow

  return (
    <button
      type="button"
      data-ec={colorOf(instance.event)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(instance, e.currentTarget.getBoundingClientRect())
      }}
      title={`${instance.allDay ? '' : `${shortTime(instance.start)} `}${instance.event.title}`}
      style={{ height: height - 2, marginBottom: 2 }}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded text-left transition ${
        narrow ? 'px-0.5 text-[10px]' : 'px-1.5 text-xs'
      } ${
        bar
          ? `${going || instance.allDay ? 'ec-solid' : 'ec-soft'} font-medium hover:brightness-105`
          : 'hover:bg-[var(--surface-2)]'
      } ${past ? 'ec-past' : ''}`}
    >
      {!bar && (
        <span
          className={`size-2 shrink-0 rounded-full ${going ? 'ec-dot' : 'ec-ring'}`}
          aria-hidden
        />
      )}
      {!bar && <span className="shrink-0 tabular-nums muted">{shortTime(instance.start)}</span>}
      <span
        className={`${narrow ? 'overflow-hidden whitespace-nowrap' : 'truncate'} ${bar ? '' : 'font-medium'}`}
      >
        {instance.event.title}
      </span>
    </button>
  )
}
