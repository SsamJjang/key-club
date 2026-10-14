import { useMemo, useState } from 'react'
import { WEEKDAY_SHORT, addMonths, dayKey, isToday, monthCells, startOfMonth } from '../../lib/calendar'
import { IconButton } from './icons'

/**
 * The little month in the sidebar, as in Google Calendar: browses on its
 * own, jumps the main view only when a day is clicked. Today is a filled
 * circle, the selected day a soft one.
 */
export default function MiniMonth({
  cursor,
  selected,
  weekStart,
  onPick,
}: {
  cursor: Date
  selected: string
  weekStart: number
  onPick: (date: Date) => void
}) {
  const [offset, setOffset] = useState(0)
  const [lastCursor, setLastCursor] = useState(cursor)

  // Following the main view resets any browsing done here.
  if (lastCursor.getTime() !== cursor.getTime()) {
    setLastCursor(cursor)
    setOffset(0)
  }

  const shown = useMemo(() => addMonths(startOfMonth(cursor), offset), [cursor, offset])
  const cells = useMemo(() => monthCells(shown, weekStart).slice(0, 42), [shown, weekStart])
  const labels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7][0]),
    [weekStart],
  )

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between pl-2">
        <span className="text-sm font-medium">
          {shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <span className="flex items-center">
          <IconButton icon="left" label="Previous month" size="size-7" onClick={() => setOffset((o) => o - 1)} />
          <IconButton icon="right" label="Next month" size="size-7" onClick={() => setOffset((o) => o + 1)} />
        </span>
      </div>

      <div className="grid grid-cols-7 text-center">
        {labels.map((label, i) => (
          <span key={i} className="grid h-6 place-items-center text-[10px] font-medium muted">
            {label}
          </span>
        ))}
        {cells.map((date) => {
          const key = dayKey(date)
          const inMonth = date.getMonth() === shown.getMonth()
          const today = isToday(date)
          const active = key === selected && !today
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(date)}
              aria-current={today ? 'date' : undefined}
              className={`mx-auto grid size-7 place-items-center rounded-full text-[11px] transition ${
                today
                  ? 'bg-navy-600 font-semibold text-white dark:bg-navy-300 dark:text-navy-950'
                  : active
                    ? 'bg-navy-100 font-semibold text-navy-800 dark:bg-navy-700 dark:text-navy-50'
                    : inMonth
                      ? 'hover:bg-[var(--surface-2)]'
                      : 'text-[var(--ink-faint)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
