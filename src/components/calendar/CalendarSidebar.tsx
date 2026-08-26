import { useMemo } from 'react'
import MiniMonth from './MiniMonth'
import type { CalendarEvent, CalendarFilters } from '../../lib/calendar'
import { filtersActive } from '../../lib/calendar'
import {
  EVENT_COLORS,
  colorLabel,
  colorOf,
  labelForColor,
  type EventColorKey,
} from '../../lib/eventColors'

export interface CalendarSettings {
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number
  showWeekends: boolean
  showWeekNumbers: boolean
  workHours: [number, number]
}

/**
 * The left rail: where you are, and what you are looking at.
 *
 * Everything here narrows the view rather than changing data, so it is
 * safe to poke at — and every control writes straight through to the
 * grid with no Apply button, because a filter you have to confirm is a
 * filter nobody uses.
 */
export default function CalendarSidebar({
  cursor,
  selected,
  counts,
  events,
  filters,
  settings,
  onPick,
  onFilters,
  onSettings,
  onExport,
}: {
  cursor: Date
  selected: string
  counts: Map<string, number>
  /** Unfiltered, so the colour list does not shrink as you filter by it. */
  events: CalendarEvent[]
  filters: CalendarFilters
  settings: CalendarSettings
  onPick: (date: Date) => void
  onFilters: (next: CalendarFilters) => void
  onSettings: (next: CalendarSettings) => void
  onExport: () => void
}) {
  /** Only colours actually in use get a row — an empty legend teaches nothing. */
  const used = useMemo(() => {
    const tally = new Map<EventColorKey, number>()
    for (const event of events) {
      const key = colorOf(event)
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    return EVENT_COLORS.filter((c) => tally.has(c.key)).map((c) => ({
      ...c,
      count: tally.get(c.key) ?? 0,
      label: labelForColor(c.key, events),
    }))
  }, [events])

  function toggleColor(key: EventColorKey) {
    const has = filters.colors.includes(key)
    onFilters({
      ...filters,
      colors: has ? filters.colors.filter((c) => c !== key) : [...filters.colors, key],
    })
  }

  const toggles: [keyof CalendarFilters, string, string][] = [
    ['mineOnly', 'Only what I’m signed up for', 'Your own schedule, nothing else.'],
    ['openOnly', 'Only open sign-ups', 'Hides full, closed, and finished events.'],
    ['hoursOnly', 'Only events with service hours', 'For when you are chasing a total.'],
    ['hidePast', 'Hide past dates', 'Clears out weeks that have already happened.'],
  ]

  return (
    <div className="space-y-5">
      <div className="card p-3">
        <MiniMonth
          cursor={cursor}
          selected={selected}
          counts={counts}
          weekStart={settings.weekStart}
          onPick={onPick}
        />
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="label mb-0">Filters</h3>
          {filtersActive(filters) && (
            <button
              type="button"
              onClick={() =>
                onFilters({
                  query: '',
                  colors: [],
                  mineOnly: false,
                  openOnly: false,
                  hoursOnly: false,
                  hidePast: false,
                })
              }
              className="text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-2">
          {toggles.map(([key, label, hint]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={Boolean(filters[key])}
                onChange={(e) => onFilters({ ...filters, [key]: e.target.checked })}
              />
              <span>
                {label}
                <span className="block text-xs muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {used.length > 0 && (
        <div className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h3 className="label mb-0">Colours</h3>
            {filters.colors.length > 0 && (
              <button
                type="button"
                onClick={() => onFilters({ ...filters, colors: [] })}
                className="text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200"
              >
                Show all
              </button>
            )}
          </div>
          <p className="text-xs muted">
            Click a colour to show only it. Officers set the colour on each event.
          </p>
          <ul className="space-y-0.5">
            {used.map((color) => {
              const on = filters.colors.length === 0 || filters.colors.includes(color.key)
              return (
                <li key={color.key}>
                  <button
                    type="button"
                    data-ec={color.key}
                    onClick={() => toggleColor(color.key)}
                    aria-pressed={filters.colors.includes(color.key)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-[var(--surface)] ${
                      on ? '' : 'opacity-40'
                    }`}
                  >
                    <span
                      className={`size-3.5 shrink-0 rounded ${on ? 'ec-dot' : 'border-2 border-[var(--ec)]'}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {color.label}
                      {/* Two colours can share a meaning — "Service" in
                          basil and in tomato — so the paint gets named too
                          whenever it is not already the label. */}
                      {color.label !== colorLabel(color.key) && (
                        <span className="text-xs muted"> · {colorLabel(color.key)}</span>
                      )}
                    </span>
                    <span className="text-xs muted">{color.count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="card space-y-3 p-4">
        <h3 className="label mb-0">View options</h3>

        <label className="flex items-center justify-between gap-3 text-sm">
          Week starts on
          <select
            className="field w-28 py-1"
            value={settings.weekStart}
            onChange={(e) => onSettings({ ...settings, weekStart: Number(e.target.value) })}
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.showWeekends}
            onChange={(e) => onSettings({ ...settings, showWeekends: e.target.checked })}
          />
          Show weekends
        </label>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.showWeekNumbers}
            onChange={(e) => onSettings({ ...settings, showWeekNumbers: e.target.checked })}
          />
          Show week numbers
        </label>

        <div>
          <span className="label">Shaded day</span>
          <div className="flex items-center gap-2 text-sm">
            <select
              className="field py-1"
              value={settings.workHours[0]}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  workHours: [Number(e.target.value), settings.workHours[1]],
                })
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
            <span className="muted">to</span>
            <select
              className="field py-1"
              value={settings.workHours[1]}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  workHours: [settings.workHours[0], Number(e.target.value)],
                })
              }
            >
              {Array.from({ length: 25 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-xs muted">
            Hours outside this range are dimmed in the week and day views.
          </p>
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <h3 className="label mb-0">Export</h3>
        <p className="text-xs muted">
          Downloads everything currently showing — filters included — as one .ics file you can
          import into Google, Outlook, or Apple Calendar.
        </p>
        <button type="button" className="btn btn-ghost w-full text-sm" onClick={onExport}>
          Download this calendar
        </button>
      </div>
    </div>
  )
}
