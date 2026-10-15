import { useMemo, useState } from 'react'
import MiniMonth from './MiniMonth'
import type { CalendarEvent } from '../../lib/calendar'
import { EVENT_COLORS, colorLabel, colorOf, labelForColor, type EventColorKey } from '../../lib/eventColors'
import { Icon } from './icons'

export interface CalendarSettings {
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number
  showWeekends: boolean
}

/**
 * Google Calendar's left rail: Create, the mini month, and the list of
 * calendars with a checkbox each. Here a "calendar" is an event colour —
 * officers name them ("Service", "Meeting") by labelling an event.
 */
export default function CalendarSidebar({
  cursor,
  selected,
  weekStart,
  events,
  hidden,
  isAdmin,
  onCreate,
  onPick,
  onToggle,
  onExport,
}: {
  cursor: Date
  selected: string
  weekStart: number
  /** Unfiltered, so a hidden colour keeps its row. */
  events: CalendarEvent[]
  hidden: EventColorKey[]
  isAdmin: boolean
  onCreate: () => void
  onPick: (date: Date) => void
  onToggle: (key: EventColorKey) => void
  onExport: () => void
}) {
  const [open, setOpen] = useState(true)

  const used = useMemo(() => {
    const keys = new Set(events.map((e) => colorOf(e)))
    return EVENT_COLORS.filter((c) => keys.has(c.key)).map((c) => ({
      key: c.key,
      label: labelForColor(c.key, events),
    }))
  }, [events])

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
      {isAdmin && (
        <button
          type="button"
          onClick={onCreate}
          className="cal-create flex h-14 w-fit items-center gap-3 rounded-2xl pl-4 pr-6 text-sm font-semibold transition"
        >
          <Icon name="plus" className="size-6" />
          Create
        </button>
      )}

      <MiniMonth cursor={cursor} selected={selected} weekStart={weekStart} onPick={onPick} />

      {used.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)]"
            aria-expanded={open}
          >
            Calendars
            <Icon name="down" className={`size-5 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <ul className="mt-1">
              {used.map((c) => {
                const on = !hidden.includes(c.key)
                return (
                  <li key={c.key}>
                    <label
                      data-ec={c.key}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                      title={c.label === colorLabel(c.key) ? c.label : `${c.label} (${colorLabel(c.key)})`}
                    >
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(c.key)} />
                      <span
                        className={`grid size-[18px] shrink-0 place-items-center rounded-[3px] border-2 border-[var(--ec)] ${
                          on ? 'bg-[var(--ec)] text-white' : ''
                        }`}
                        aria-hidden
                      >
                        {on && <Icon name="check" className="size-3.5" />}
                      </span>
                      <span className="truncate">{c.label}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onExport}
        className="mt-auto flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs muted hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
      >
        <Icon name="download" className="size-4" />
        Export calendar (.ics)
      </button>
    </div>
  )
}
