import { useEffect, useMemo, useRef } from 'react'
import type { Instance } from '../../lib/calendar'
import {
  WEEKDAY_SHORT,
  dayKey,
  isToday,
  isWeekend,
  isoWeek,
  monthCells,
  shortTime,
  statusOf,
} from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'

/**
 * The month grid.
 *
 * Every cell is a real button, the whole grid is one tab stop with arrow
 * keys inside it, and each event chip is its own button on top — so the
 * calendar is fully usable from the keyboard without trapping anyone in
 * forty-two tab stops.
 */
export default function MonthView({
  cursor,
  weekStart,
  selected,
  byDay,
  userId,
  isAdmin,
  showWeekNumbers,
  onSelect,
  onNavigate,
  onOpen,
  onMore,
  onCreate,
}: {
  cursor: Date
  weekStart: number
  selected: string
  byDay: Map<string, Instance[]>
  userId: string | null
  isAdmin: boolean
  showWeekNumbers: boolean
  onSelect: (key: string) => void
  onNavigate: (days: number) => void
  onOpen: (instance: Instance, rect: DOMRect) => void
  onMore: (date: Date) => void
  onCreate: (date: Date) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => monthCells(cursor, weekStart), [cursor, weekStart])
  const labels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7]),
    [weekStart],
  )

  // Follow arrow-key movement with focus, but only while the grid already
  // has it — otherwise clicking a chip would yank focus back to the cell.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !grid.contains(document.activeElement)) return
    grid.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus()
  }, [selected, cells])

  function onKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (e.key in moves) {
      e.preventDefault()
      onNavigate(moves[e.key])
    }
  }

  const columns = showWeekNumbers ? 'grid-cols-[2.25rem_repeat(7,minmax(0,1fr))]' : 'grid-cols-7'

  return (
    <div className="overflow-hidden">
      <div className={`grid ${columns} border-b border-[var(--line)]`}>
        {showWeekNumbers && <span />}
        {labels.map((label) => (
          <div
            key={label}
            className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide muted"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label[0]}</span>
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label="Month view"
        onKeyDown={onKeyDown}
        className={`grid ${columns}`}
      >
        {cells.map((date, index) => {
          const key = dayKey(date)
          const list = byDay.get(key) ?? []
          const inMonth = date.getMonth() === cursor.getMonth()
          const today = isToday(date)
          const isSelected = key === selected
          const startsRow = index % 7 === 0

          return (
            <div key={key} className="contents">
              {showWeekNumbers && startsRow && (
                <div className="grid place-items-start justify-center border-b border-r border-[var(--line)] pt-2 text-[10px] font-semibold muted">
                  {isoWeek(date)}
                </div>
              )}

              <div
                role="gridcell"
                aria-selected={isSelected}
                className={`group relative min-h-20 border-b border-r border-[var(--line)] p-1 sm:min-h-28 ${
                  inMonth ? '' : 'opacity-45'
                } ${isWeekend(date) && inMonth ? 'bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]' : ''} ${
                  isSelected ? 'ring-2 ring-inset ring-navy-400' : ''
                }`}
              >
                <button
                  type="button"
                  data-day={key}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelect(key)}
                  onDoubleClick={() => isAdmin && onCreate(date)}
                  aria-label={`${date.toDateString()}, ${list.length} event${
                    list.length === 1 ? '' : 's'
                  }`}
                  className="flex w-full items-center justify-between rounded px-0.5 text-left"
                >
                  <span
                    className={`inline-grid size-6 place-items-center rounded-full text-xs font-semibold ${
                      today ? 'bg-navy-600 text-white' : ''
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {isAdmin && (
                    <span
                      className="no-print hidden size-5 place-items-center rounded-full text-xs muted transition group-hover:grid hover:bg-[var(--surface)]"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCreate(date)
                      }}
                      role="button"
                      tabIndex={-1}
                      aria-hidden
                      title="New event on this day"
                    >
                      +
                    </span>
                  )}
                </button>

                <div className="mt-0.5 hidden space-y-0.5 sm:block">
                  {list.slice(0, 3).map((instance) => {
                    const status = statusOf(instance.event, instance.start, userId)
                    return (
                      <button
                        key={instance.id}
                        type="button"
                        data-ec={colorOf(instance.event)}
                        onClick={(e) => {
                          onSelect(key)
                          onOpen(instance, e.currentTarget.getBoundingClientRect())
                        }}
                        title={`${instance.event.title} — ${
                          instance.allDay ? 'time TBA' : shortTime(instance.start)
                        }`}
                        className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] font-medium transition hover:brightness-95 ${
                          instance.allDay ? 'ec-soft' : 'ec-soft'
                        } ${status === 'past' ? 'ec-past' : ''} ${
                          status === 'going' ? 'ec-going' : ''
                        }`}
                      >
                        {status === 'going' && <span aria-hidden>✓</span>}
                        {!instance.allDay && (
                          <span className="shrink-0 tabular-nums opacity-70">
                            {shortTime(instance.start)}
                          </span>
                        )}
                        <span className="truncate">{instance.event.title}</span>
                      </button>
                    )
                  })}

                  {list.length > 3 && (
                    <button
                      type="button"
                      onClick={() => onMore(date)}
                      className="w-full px-1 text-left text-[10px] font-semibold muted hover:underline"
                    >
                      +{list.length - 3} more
                    </button>
                  )}
                </div>

                {/* Phones get dots; three-word chips at that width are noise. */}
                {list.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 5).map((instance) => (
                      <span
                        key={instance.id}
                        data-ec={colorOf(instance.event)}
                        className={`ec-dot size-1.5 rounded-full ${
                          statusOf(instance.event, instance.start, userId) === 'past'
                            ? 'opacity-40'
                            : ''
                        }`}
                        aria-hidden
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
