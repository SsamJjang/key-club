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

export type RepeatMode = 'once' | 'weekly' | 'custom'

export interface ScheduleForm {
  /** YYYY-MM-DD, or '' when the date is genuinely not known yet. */
  start_date: string
  /** HH:mm, or '' for "date known, time to be announced". */
  start_time: string
  end_time: string
  repeat: RepeatMode
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  repeat_until: string
  /** Every date in a hand-picked series, including the first. */
  custom_dates: string[]
}

export const BLANK_SCHEDULE: ScheduleForm = {
  start_date: '',
  start_time: '',
  end_time: '',
  repeat: 'once',
  weekdays: [],
  repeat_until: '',
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

  if (form.repeat === 'weekly') {
    // No end date means no series yet — the editor says so rather than
    // silently inventing a horizon.
    if (!form.repeat_until || form.repeat_until < form.start_date) return [form.start_date]

    // An empty weekday selection means "the same weekday as the start date",
    // which is what someone picking "every week" without touching the day
    // chips almost always means.
    const days = form.weekdays.length > 0
      ? form.weekdays
      : [fromDayKey(form.start_date).getDay()]

    const out: string[] = []
    const cursor = fromDayKey(form.start_date)
    const end = fromDayKey(form.repeat_until)

    while (cursor <= end && out.length < MAX_OCCURRENCES) {
      if (days.includes(cursor.getDay())) out.push(dayKey(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }

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
    repeat: 'weekly',
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
    recurrence_note: describeSchedule(dates) || null,
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
    start_date: start ? dayKey(start) : '',
    start_time: post.all_day || !start ? '' : clock(start),
    end_time: post.all_day || !post.ends_at ? '' : clock(new Date(post.ends_at)),
    repeat,
    weekdays: [],
    repeat_until: '',
    custom_dates: dates,
  }
}
