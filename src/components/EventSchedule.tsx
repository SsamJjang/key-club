import { useMemo, useState } from 'react'
import {
  MAX_OCCURRENCES,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  addDays,
  applyPreset,
  describeRule,
  describeSchedule,
  generateDates,
  isLastOfMonth,
  matchPreset,
  nthOfMonth,
  repeatPresets,
  type Freq,
  type MonthlyBy,
  type ScheduleForm,
} from '../lib/schedule'
import { fromDayKey } from '../lib/format'

const FREQ_LABEL: Record<Freq, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth']

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
  const note = useMemo(
    () => (dates.length > 1 && value.repeat === 'rule' ? describeRule(value) : describeSchedule(dates)),
    [dates, value],
  )
  const presets = useMemo(() => repeatPresets(value.start_date), [value.start_date])
  const picked = matchPreset(value)

  function set(patch: Partial<ScheduleForm>) {
    onChange({ ...value, ...patch })
  }

  /** Moving the start date re-aims a preset ("Weekly on Wed" → "on Thu"). */
  function setStartDate(start_date: string) {
    // Keep a hand-picked list anchored to the date above it.
    const custom_dates =
      value.repeat === 'custom' && value.custom_dates.length <= 1 && start_date
        ? [start_date]
        : value.custom_dates
    const next = { ...value, start_date, custom_dates }
    const preset = matchPreset(value)
    if (value.repeat === 'rule' && preset !== 'rule' && start_date) {
      onChange(applyPreset(next, preset))
    } else onChange(next)
  }

  // No chips picked means "the start's weekday" — show it lit, and build
  // on it when another day is added.
  const shownWeekdays =
    value.weekdays.length > 0 || !value.start_date ? value.weekdays : [fromDayKey(value.start_date).getDay()]

  function toggleWeekday(day: number) {
    const has = shownWeekdays.includes(day)
    // Keep at least one day: a weekly rule on no days is no rule.
    if (has && shownWeekdays.length === 1) return
    set({
      weekdays: has ? shownWeekdays.filter((d) => d !== day) : [...shownWeekdays, day].sort(),
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
          onChange={(e) => setStartDate(e.target.value)}
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
        <select
          className="field"
          aria-label="Repeats"
          value={picked}
          onChange={(e) => onChange(applyPreset(value, e.target.value))}
        >
          <option value="once">Does not repeat</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="rule">Custom…</option>
          <option value="custom">Pick specific dates</option>
        </select>
        {!value.start_date && value.repeat !== 'custom' && (
          <p className="mt-1 text-xs muted">Set the date above to see daily, weekly and monthly options.</p>
        )}
      </div>

      {value.repeat === 'rule' && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          <div>
            <span className="label">Repeat every</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={99}
                aria-label="Interval"
                className="field w-20"
                value={value.interval}
                onChange={(e) => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              />
              <select
                className="field"
                aria-label="Unit"
                value={value.freq}
                onChange={(e) => {
                  const freq = e.target.value as Freq
                  set({ freq, weekdays: freq === 'week' ? value.weekdays : [] })
                }}
              >
                {(Object.keys(FREQ_LABEL) as Freq[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQ_LABEL[f][value.interval === 1 ? 0 : 1]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {value.freq === 'month' && value.start_date && (
            <div>
              <label className="label" htmlFor="monthly-by">On</label>
              <select
                id="monthly-by"
                className="field"
                value={value.monthly_by}
                onChange={(e) => set({ monthly_by: e.target.value as MonthlyBy })}
              >
                <option value="day">Day {fromDayKey(value.start_date).getDate()} of the month</option>
                <option value="nth">
                  The {ORDINAL[nthOfMonth(value.start_date)]} {WEEKDAY_NAMES[fromDayKey(value.start_date).getDay()]}
                </option>
                {isLastOfMonth(value.start_date) && (
                  <option value="last">The last {WEEKDAY_NAMES[fromDayKey(value.start_date).getDay()]}</option>
                )}
              </select>
            </div>
          )}

          {value.freq === 'week' && <div>
            <span className="label">On these days</span>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = shownWeekdays.includes(day)
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
          </div>}

          <div>
            <span className="label">Ends</span>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="ends"
                  className="size-4"
                  checked={value.ends === 'until'}
                  onChange={() => set({ ends: 'until' })}
                />
                <span className="w-12">On</span>
                <input
                  type="date"
                  aria-label="End date"
                  className="field"
                  min={value.start_date || undefined}
                  value={value.repeat_until}
                  disabled={value.ends !== 'until'}
                  onChange={(e) => set({ repeat_until: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="ends"
                  className="size-4"
                  checked={value.ends === 'count'}
                  onChange={() => set({ ends: 'count' })}
                />
                <span className="w-12">After</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_OCCURRENCES}
                  aria-label="Number of times"
                  className="field w-24"
                  value={value.count}
                  disabled={value.ends !== 'count'}
                  onChange={(e) => set({ count: Math.max(1, Math.min(MAX_OCCURRENCES, Number(e.target.value) || 1)) })}
                />
                <span className="muted">times</span>
              </label>
            </div>
          </div>

          {!value.start_date && (
            <p className="text-xs muted">Set the start date above and the dates will fill in.</p>
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
