import { dayKey, fromDayKey } from './format'
import type { Post } from './types'

/**
 * Event scheduling, kept as pure functions so the editor's UI stays dumb.
 *
 * The model is deliberately a finite list of dates rather than a recurrence
 * rule. A school year ends, so "every Wednesday" always means "every
 * Wednesday until some date an officer can name" — and a stored list is
 * something they can read back, edit one date out of, and trust.
 */

/**
 * once   — a single day.
 * rule   — "every N days / weeks / months", generated up to an end.
 * custom — a hand-picked list of dates.
 */
export type RepeatMode = 'once' | 'rule' | 'custom'

export type Freq = 'day' | 'week' | 'month'

/**
 * How a monthly rule lands: on the same day number (the 15th), on the same
 * nth weekday (the 3rd Wednesday), or on the last such weekday.
 */
export type MonthlyBy = 'day' | 'nth' | 'last'

export interface ScheduleForm {
  /** YYYY-MM-DD, or '' when the date is genuinely not known yet. */
  start_date: string
  /** HH:mm, or '' for "date known, time to be announced". */
  start_time: string
  end_time: string
  repeat: RepeatMode
  /** Rule only: the unit, and every how many of them. */
  freq: Freq
  interval: number
  /** Weekly rules: 0 = Sunday … 6 = Saturday. Empty = the start's weekday. */
  weekdays: number[]
  monthly_by: MonthlyBy
  /** Rule only: stop on a date, or after a number of occurrences. */
  ends: 'until' | 'count'
  repeat_until: string
  count: number
  /** Every date in a hand-picked series, including the first. */
  custom_dates: string[]
}

export const BLANK_SCHEDULE: ScheduleForm = {
  start_date: '',
  start_time: '',
  end_time: '',
  repeat: 'once',
  freq: 'week',
  interval: 1,
  weekdays: [],
  monthly_by: 'day',
  ends: 'until',
  repeat_until: '',
  count: 10,
  custom_dates: [],
}

/** A term's worth of weeks — the default horizon when "every week" is picked. */
export const DEFAULT_WEEKS = 12

/**
 * Hard ceiling on generated dates. Not a real limit for a club calendar;
 * it exists so a fat-fingered "until 2099" cannot write 30,000 array entries.
 */
export const MAX_OCCURRENCES = 200

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Whole days between two local dates, immune to DST shifts. */
function daysBetween(a: Date, b: Date) {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      864e5,
  )
}

/** 1 for the first Wednesday of the month, 3 for the third … */
export function nthOfMonth(key: string) {
  return Math.ceil(fromDayKey(key).getDate() / 7)
}

/** True when no later same weekday exists in this month. */
export function isLastOfMonth(key: string) {
  const d = fromDayKey(key)
  const next = new Date(d)
  next.setDate(d.getDate() + 7)
  return next.getMonth() !== d.getMonth()
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth']

function ordinalDay(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

/** The date in (year, month) a monthly rule lands on, or null to skip it. */
function monthlyDate(start: Date, year: number, month: number, by: MonthlyBy): Date | null {
  if (by === 'day') {
    const d = new Date(year, month, start.getDate())
    // The 31st in a 30-day month doesn't exist — skip it, as Google does.
    return d.getMonth() === ((month % 12) + 12) % 12 ? d : null
  }
  const weekday = start.getDay()
  if (by === 'last') {
    const d = new Date(year, month + 1, 0)
    d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7))
    return d
  }
  const n = Math.ceil(start.getDate() / 7)
  const d = new Date(year, month, 1)
  const target = d.getMonth()
  d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (n - 1) * 7)
  // A 5th Wednesday only exists in some months.
  return d.getMonth() === target ? d : null
}

/** The rule's dates. Stops at the end date or count, and at MAX_OCCURRENCES. */
function ruleDates(form: ScheduleForm): string[] {
  const start = fromDayKey(form.start_date)
  const every = Math.max(1, Math.floor(form.interval) || 1)
  const byCount = form.ends === 'count'
  const limit = byCount ? Math.min(MAX_OCCURRENCES, Math.max(1, Math.floor(form.count) || 1)) : MAX_OCCURRENCES
  // No end date means no series yet — the editor asks for one rather than
  // silently inventing a horizon.
  if (!byCount && (!form.repeat_until || form.repeat_until < form.start_date)) return [form.start_date]
  const end = byCount ? null : fromDayKey(form.repeat_until)
  const within = (d: Date) => !end || d <= end

  const out: string[] = []

  if (form.freq === 'day') {
    const d = new Date(start)
    while (within(d) && out.length < limit) {
      out.push(dayKey(d))
      d.setDate(d.getDate() + every)
    }
    return out
  }

  if (form.freq === 'week') {
    // No weekday chips picked means "the start's weekday", which is what
    // someone choosing "weekly" without touching them almost always means.
    const days = form.weekdays.length > 0 ? form.weekdays : [start.getDay()]
    // Weeks run Sunday–Saturday, counted from the start date's week.
    const week0 = new Date(start)
    week0.setDate(start.getDate() - start.getDay())
    const d = new Date(start)
    for (let guard = 0; within(d) && out.length < limit && guard < 3700 * every; guard++) {
      const week = Math.floor(daysBetween(week0, d) / 7)
      if (week % every === 0 && days.includes(d.getDay())) out.push(dayKey(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }

  for (let m = 0; out.length < limit && m < 1200; m += every) {
    const d = monthlyDate(start, start.getFullYear(), start.getMonth() + m, form.monthly_by)
    if (!d) continue
    if (!within(d)) break
    if (d >= start) out.push(dayKey(d))
  }
  return out
}

/** A plain-English line for a rule: "Every 2 weeks on Tue & Thu until Dec 17". */
export function describeRule(form: ScheduleForm): string {
  if (!form.start_date) return ''
  const every = Math.max(1, Math.floor(form.interval) || 1)
  const start = fromDayKey(form.start_date)
  let line =
    every === 1
      ? { day: 'Daily', week: 'Weekly', month: 'Monthly' }[form.freq]
      : `Every ${every} ${form.freq}s`

  if (form.freq === 'week') {
    const days = form.weekdays.length > 0 ? form.weekdays : [start.getDay()]
    const weekdaysOnly = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
    if (weekdaysOnly && every === 1) line = 'Every weekday'
    else line += weekdaysOnly ? ' on weekdays' : ` on ${listNames(days.map((d) => WEEKDAY_LABELS[d]))}`
  } else if (form.freq === 'month') {
    const wd = WEEKDAY_NAMES[start.getDay()]
    line +=
      form.monthly_by === 'day'
        ? ` on the ${ordinalDay(start.getDate())}`
        : form.monthly_by === 'last'
          ? ` on the last ${wd}`
          : ` on the ${ORDINAL[nthOfMonth(form.start_date)]} ${wd}`
  }

  if (form.ends === 'count') line += `, ${Math.max(1, Math.floor(form.count) || 1)} times`
  else if (form.repeat_until) line += ` until ${shortDate(form.repeat_until)}`
  return line
}

/**
 * The ready-made choices offered for a start date, as Google Calendar does.
 * Each is just a filled-in rule, still editable afterwards.
 */
export interface RepeatPreset {
  id: string
  label: string
  patch: Partial<ScheduleForm>
}

export function repeatPresets(startDate: string): RepeatPreset[] {
  if (!startDate) return []
  const d = fromDayKey(startDate)
  const wd = d.getDay()
  const name = WEEKDAY_NAMES[wd]
  const rule = (p: Partial<ScheduleForm>): Partial<ScheduleForm> => ({
    repeat: 'rule',
    interval: 1,
    weekdays: [],
    monthly_by: 'day',
    ...p,
  })
  const out: RepeatPreset[] = [
    { id: 'daily', label: 'Daily', patch: rule({ freq: 'day' }) },
    { id: 'weekly', label: `Weekly on ${name}`, patch: rule({ freq: 'week', weekdays: [wd] }) },
    { id: 'biweekly', label: `Every 2 weeks on ${name}`, patch: rule({ freq: 'week', interval: 2, weekdays: [wd] }) },
    {
      id: 'monthly-nth',
      label: `Monthly on the ${ORDINAL[nthOfMonth(startDate)]} ${name}`,
      patch: rule({ freq: 'month', monthly_by: 'nth' }),
    },
  ]
  if (isLastOfMonth(startDate)) {
    out.push({ id: 'monthly-last', label: `Monthly on the last ${name}`, patch: rule({ freq: 'month', monthly_by: 'last' }) })
  }
  out.push(
    { id: 'monthly-day', label: `Monthly on the ${ordinalDay(d.getDate())}`, patch: rule({ freq: 'month', monthly_by: 'day' }) },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', patch: rule({ freq: 'week', weekdays: [1, 2, 3, 4, 5] }) },
  )
  return out
}

/** Which preset the form matches: 'once', 'custom', a preset id, or 'rule' when hand-tuned. */
export function matchPreset(form: ScheduleForm): string {
  if (form.repeat !== 'rule') return form.repeat
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x))
  const days =
    form.weekdays.length > 0 || !form.start_date ? form.weekdays : [fromDayKey(form.start_date).getDay()]
  const hit = repeatPresets(form.start_date).find((p) => {
    const t = p.patch
    if (t.freq !== form.freq || t.interval !== form.interval) return false
    if (form.freq === 'week') return same(t.weekdays ?? [], days)
    if (form.freq === 'month') return t.monthly_by === form.monthly_by
    return true
  })
  return hit?.id ?? 'rule'
}

/** A sensible default end for a new rule: a term of weeks, a school year of months. */
export function defaultUntil(startDate: string, freq: Freq) {
  if (!startDate) return ''
  if (freq === 'month') {
    const d = fromDayKey(startDate)
    d.setMonth(d.getMonth() + 9)
    return dayKey(d)
  }
  return addDays(startDate, DEFAULT_WEEKS * 7)
}

/** Apply a preset id (or 'once' / 'custom' / 'rule') to the form. */
export function applyPreset(form: ScheduleForm, id: string): ScheduleForm {
  if (id === 'once') return { ...form, repeat: 'once' }
  if (id === 'custom') {
    return {
      ...form,
      repeat: 'custom',
      custom_dates: form.custom_dates.length > 0 ? form.custom_dates : form.start_date ? [form.start_date] : [],
    }
  }
  const preset = repeatPresets(form.start_date).find((p) => p.id === id)
  // 'rule' with no preset: open the builder on whatever the form holds,
  // defaulting to weekly.
  const next: ScheduleForm = preset ? { ...form, ...preset.patch } : { ...form, repeat: 'rule' }
  if (!next.repeat_until) next.repeat_until = defaultUntil(next.start_date, next.freq)
  return next
}

export function addDays(key: string, days: number) {
  const d = fromDayKey(key)
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/** The concrete list of dates this form describes, sorted and deduplicated. */
export function generateDates(form: ScheduleForm): string[] {
  if (form.repeat === 'custom') {
    return [...new Set(form.custom_dates.filter(Boolean))].sort()
  }

  if (!form.start_date) return []

  if (form.repeat === 'rule') return ruleDates(form)

  return [form.start_date]
}

function shortDate(key: string) {
  return fromDayKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** True when the dates are an unbroken run — "Sep 12, 13, 14". */
function isConsecutive(dates: string[]) {
  return dates.every((d, i) => i === 0 || d === addDays(dates[i - 1], 1))
}

function listNames(names: string[]) {
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/**
 * True when the dates are exactly "every <these weekdays>" across their own
 * span, with no week skipped — which is what lets a series reopened from the
 * database still describe itself as "Every Wed" instead of "12 dates".
 */
function weeklyPattern(dates: string[]): number[] | null {
  const days = [...new Set(dates.map((d) => fromDayKey(d).getDay()))].sort()
  const expected = generateDates({
    ...BLANK_SCHEDULE,
    start_date: dates[0],
    repeat: 'rule',
    freq: 'week',
    weekdays: days,
    repeat_until: dates[dates.length - 1],
  })
  const same = expected.length === dates.length && expected.every((d, i) => d === dates[i])
  return same ? days : null
}

/**
 * The one-line summary stored on the post and shown on cards and calendars.
 * Derived from the dates themselves, not from how they were entered, so an
 * event edited later still describes itself correctly. Returns '' for a
 * single occurrence, which needs no explaining.
 */
export function describeSchedule(dates: string[]): string {
  if (dates.length <= 1) return ''

  const last = shortDate(dates[dates.length - 1])

  if (isConsecutive(dates)) {
    return `${dates.length} days, ${shortDate(dates[0])}–${last}`
  }

  const weekly = weeklyPattern(dates)
  if (weekly) {
    return `Every ${listNames(weekly.map((d) => WEEKDAY_LABELS[d]))} until ${last}`
  }

  return `${dates.length} dates, ${shortDate(dates[0])} – ${last}`
}

/** Combines a YYYY-MM-DD and an optional HH:mm into a local Date. */
function at(key: string, time: string) {
  const d = fromDayKey(key)
  if (time) {
    const [h, m] = time.split(':').map(Number)
    d.setHours(h || 0, m || 0, 0, 0)
  }
  return d
}

export interface SchedulePayload {
  starts_at: string | null
  ends_at: string | null
  event_dates: string[] | null
  recurrence_note: string | null
  all_day: boolean
}

/**
 * Form -> the columns on `posts`.
 *
 * The rule that matters: a date with no time still saves. `starts_at` lands
 * on midnight local and `all_day` records that the clock time is not real,
 * so nothing downstream prints a misleading "12:00 AM".
 */
export function toPayload(form: ScheduleForm): SchedulePayload {
  const dates = generateDates(form)

  if (dates.length === 0) {
    return {
      starts_at: null,
      ends_at: null,
      event_dates: null,
      recurrence_note: null,
      all_day: false,
    }
  }

  const first = dates[0]
  const starts = at(first, form.start_time)

  let ends: Date | null = null
  if (form.end_time) {
    ends = at(first, form.end_time)
    // An end before the start reads as running past midnight, not as a typo.
    if (ends <= starts) ends.setDate(ends.getDate() + 1)
  }

  return {
    starts_at: starts.toISOString(),
    ends_at: ends ? ends.toISOString() : null,
    event_dates: dates.length > 1 ? dates : null,
    // A rule describes itself exactly ("Every 2 weeks on Tue"); a hand-picked
    // list is summarised from the dates.
    recurrence_note:
      dates.length > 1 ? (form.repeat === 'rule' ? describeRule(form) : describeSchedule(dates)) || null : null,
    all_day: !form.start_time,
  }
}

/** The columns on `posts` -> form, for editing an existing event. */
export function fromPost(post: Post): ScheduleForm {
  const dates = post.event_dates ?? []
  const start = post.starts_at ? new Date(post.starts_at) : null
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = (d: Date | null) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '')

  // A stored series is reopened as a hand-picked list. The dates round-trip
  // exactly, which a regenerated weekly rule could not promise once someone
  // has deleted a single week for a holiday.
  const repeat: RepeatMode = dates.length > 1 ? 'custom' : 'once'

  return {
    ...BLANK_SCHEDULE,
    start_date: start ? dayKey(start) : '',
    start_time: post.all_day || !start ? '' : clock(start),
    end_time: post.all_day || !post.ends_at ? '' : clock(new Date(post.ends_at)),
    repeat,
    custom_dates: dates,
  }
}
