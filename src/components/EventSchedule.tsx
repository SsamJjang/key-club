import { useMemo, useState } from 'react'
import {
  DEFAULT_WEEKS,
  MAX_OCCURRENCES,
  WEEKDAY_LABELS,
  addDays,
  describeSchedule,
  generateDates,
  type RepeatMode,
  type ScheduleForm,
} from '../lib/schedule'
import { fromDayKey } from '../lib/format'

const MODES: [RepeatMode, string, string][] = [
  ['once', 'Just once', 'A single day.'],
  ['weekly', 'Every week', 'Same weekday every week until a date you pick.'],
  ['custom', 'Pick dates', 'A run of days, or any set of dates you choose.'],
]

function longDate(key: string) {
  return fromDayKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * The date half of the event editor.
 *
 * Two deliberate choices. Date and time are separate inputs, because a
 * single datetime-local yields nothing at all until BOTH halves are filled
 * — which is how events with a known date used to save with no date. And
 * "every week" always asks for an end date: the series is stored as a real
 * list of days, so it has to stop somewhere an officer names.
 */
export default function EventSchedule({
  value,
  onChange,
}: {
  value: ScheduleForm
  onChange: (next: ScheduleForm) => void
}) {
  const [newDate, setNewDate] = useState('')
  const [showAll, setShowAll] = useState(false)

  const dates = useMemo(() => generateDates(value), [value])
  const note = useMemo(() => describeSchedule(dates), [dates])

  function set(patch: Partial<ScheduleForm>) {
    onChange({ ...value, ...patch })
  }

  function setMode(repeat: RepeatMode) {
    if (repeat === 'weekly') {
      const base = value.start_date || ''
      set({
        repeat,
        // Pre-fill a term's worth so the field is never an empty demand.
        repeat_until: value.repeat_until || (base ? addDays(base, DEFAULT_WEEKS * 7) : ''),
        weekdays: value.weekdays.length > 0 ? value.weekdays : base ? [fromDayKey(base).getDay()] : [],
      })
    } else if (repeat === 'custom') {
      set({
        repeat,
        custom_dates:
          value.custom_dates.length > 0
            ? value.custom_dates
            : value.start_date
              ? [value.start_date]
              : [],
      })
    } else {
      set({ repeat })
    }
  }

  function toggleWeekday(day: number) {
    const has = value.weekdays.includes(day)
    set({
      weekdays: has ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day].sort(),
    })
  }

  function addCustomDate() {
    if (!newDate || value.custom_dates.includes(newDate)) return
    set({ custom_dates: [...value.custom_dates, newDate].sort() })
    setNewDate('')
  }

  /** "Sep 12 + the next 2 days" — the fast path for a multi-day fundraiser. */
  function addRun(days: number) {
    const from = value.custom_dates[value.custom_dates.length - 1] ?? value.start_date
    if (!from) return
    const next = Array.from({ length: days }, (_, i) => addDays(from, i + 1))
    set({ custom_dates: [...new Set([...value.custom_dates, ...next])].sort() })
  }

  const shown = showAll ? dates : dates.slice(0, 8)

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="start-date">Date</label>
        <input
          id="start-date"
          type="date"
          className="field"
          value={value.start_date}
          onChange={(e) => {
            const start_date = e.target.value
            // Keep a hand-picked list anchored to the date above it.
            const custom_dates =
              value.repeat === 'custom' && value.custom_dates.length <= 1 && start_date
                ? [start_date]
                : value.custom_dates
            set({ start_date, custom_dates })
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="start-time">Start time</label>
          <input
            id="start-time"
            type="time"
            className="field"
            value={value.start_time}
            onChange={(e) => set({ start_time: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="end-time">End time</label>
          <input
            id="end-time"
            type="time"
            className="field"
            value={value.end_time}
            disabled={!value.start_time}
            onChange={(e) => set({ end_time: e.target.value })}
          />
        </div>
      </div>

      <p className="text-xs muted">
        {value.start_time
          ? 'Leave the end time blank if it’s open-ended.'
          : 'Times are optional — a date on its own saves fine and shows as “time TBA”.'}
      </p>

      <div>
        <span className="label">Repeats</span>
        <div className="grid gap-1.5">
          {MODES.map(([mode, label, hint]) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition ${
                value.repeat === mode
                  ? 'border-navy-400 bg-navy-50 dark:bg-navy-800'
                  : 'border-[var(--line)] hover:border-navy-300'
              }`}
            >
              <input
                type="radio"
                name="repeat"
                className="mt-0.5 size-4"
                checked={value.repeat === mode}
                onChange={() => setMode(mode)}
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {value.repeat === 'weekly' && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          <div>
            <span className="label">On these days</span>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = value.weekdays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    aria-pressed={on}
                    className={`size-9 rounded-lg text-xs font-semibold transition ${
                      on
                        ? 'bg-navy-600 text-white'
                        : 'border border-[var(--line)] muted hover:border-navy-300'
                    }`}
                  >
                    {label[0]}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="until">Until</label>
            <input
              id="until"
              type="date"
              className="field"
              min={value.start_date || undefined}
              value={value.repeat_until}
              onChange={(e) => set({ repeat_until: e.target.value })}
            />
          </div>

          {!value.start_date && (
            <p className="text-xs muted">Set the start date above and the weeks will fill in.</p>
          )}
        </div>
      )}

      {value.repeat === 'custom' && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          {value.custom_dates.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {value.custom_dates.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => set({ custom_dates: value.custom_dates.filter((d) => d !== key) })}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--line)] py-1 pl-3 pr-2 text-xs font-medium transition hover:border-navy-300"
                    title={`Remove ${longDate(key)}`}
                  >
                    {longDate(key)}
                    <span aria-hidden className="muted">×</span>
                    <span className="sr-only">Remove</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label className="label" htmlFor="add-date">Add a date</label>
              <input
                id="add-date"
                type="date"
                className="field"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomDate()
                  }
                }}
              />
            </div>
            <button type="button" className="btn btn-ghost" onClick={addCustomDate} disabled={!newDate}>
              Add
            </button>
          </div>

          {(value.custom_dates.length > 0 || value.start_date) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="muted">Quick add:</span>
              {[1, 2, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn btn-ghost px-2.5 py-1 text-xs"
                  onClick={() => addRun(n)}
                >
                  + next {n} day{n === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* What actually gets saved. Shown always, because a generated series
          is only trustworthy if you can see the dates it produced. */}
      {dates.length > 1 && (
        <div className="rounded-lg bg-[var(--surface)] p-3">
          <p className="text-sm font-medium">
            {note} <span className="muted">· {dates.length} dates</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs muted">
            {shown.map((key) => (
              <li key={key}>{longDate(key)}</li>
            ))}
          </ul>
          {dates.length > shown.length && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200"
              onClick={() => setShowAll(true)}
            >
              Show all {dates.length}
            </button>
          )}
          {dates.length >= MAX_OCCURRENCES && (
            <p className="mt-2 text-xs font-medium text-gold-600 dark:text-gold-300">
              Capped at {MAX_OCCURRENCES} dates — bring the end date closer.
            </p>
          )}
        </div>
      )}

      {dates.length === 0 && (
        <p className="text-xs muted">
          No date yet? That’s fine — the event saves and shows under “No date set yet”.
        </p>
      )}
    </div>
  )
}
