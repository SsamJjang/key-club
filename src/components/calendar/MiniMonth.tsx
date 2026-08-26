import { useMemo, useState } from 'react'
import {
  WEEKDAY_SHORT,
  addMonths,
  dayKey,
  isToday,
  monthCells,
  startOfMonth,
} from '../../lib/calendar'

/**
 * The little month in the sidebar.
 *
 * It exists to move you somewhere far away without losing the big view —
 * so it browses independently of the main cursor and only jumps the
 * calendar when you actually click a day. Density dots tell you which
 * days are worth the trip.
 */
export default function MiniMonth({
  cursor,
  selected,
  counts,
  weekStart,
  onPick,
}: {
  /** Which month the main view is showing — the mini month follows it. */
  cursor: Date
  selected: string
  /** dayKey -> number of events, for the density dots. */
  counts: Map<string, number>
  weekStart: number
  onPick: (date: Date) => void
}) {
  const [offset, setOffset] = useState(0)

  // Browsing the mini month is temporary: changing the main month resets it,
  // so the sidebar never quietly drifts away from what you are looking at.
  const shown = useMemo(() => addMonths(startOfMonth(cursor), offset), [cursor, offset])
  const cells = useMemo(() => monthCells(shown, weekStart), [shown, weekStart])
  const labels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7]),
    [weekStart],
  )

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">
          {shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            className="grid size-6 place-items-center rounded-full text-xs muted transition hover:bg-[var(--surface)]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            className="grid size-6 place-items-center rounded-full text-xs muted transition hover:bg-[var(--surface)]"
            aria-label="Next month"
          >
            ›
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {labels.map((label) => (
          <span key={label} className="text-[10px] font-semibold uppercase muted">
            {label[0]}
          </span>
        ))}

        {cells.slice(0, 42).map((date) => {
          const key = dayKey(date)
          const inMonth = date.getMonth() === shown.getMonth()
          const count = counts.get(key) ?? 0
          const active = key === selected
          const today = isToday(date)

          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                onPick(date)
                setOffset(0)
              }}
              aria-current={today ? 'date' : undefined}
              className={`relative mx-auto grid size-7 place-items-center rounded-full text-[11px] transition ${
                active
                  ? 'bg-navy-600 font-semibold text-white'
                  : today
                    ? 'font-bold text-navy-600 dark:text-navy-200'
                    : inMonth
                      ? 'hover:bg-[var(--surface)]'
                      : 'muted opacity-45 hover:bg-[var(--surface)]'
              }`}
            >
              {date.getDate()}
              {count > 0 && !active && (
                <span
                  className="absolute bottom-0.5 size-1 rounded-full bg-navy-400"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
