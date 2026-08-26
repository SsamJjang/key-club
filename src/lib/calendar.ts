import { dayKey, fromDayKey, hasEnded, isRecurring, occurrenceEnded, occurrences } from './format'
import type { SignupRow } from './rsvp'
import type { Post } from './types'
import { colorOf, type EventColorKey } from './eventColors'

/**
 * The calendar's arithmetic, kept out of the components.
 *
 * The central idea is the OCCURRENCE, not the event. A Wednesday tutoring
 * block is one row in the database and twelve things on the calendar, and
 * every view — month, week, day, agenda — wants the twelve. So everything
 * here works in `Instance`s: one event on one specific day, with real
 * start and end clock times, ready to be positioned or listed.
 */

export interface CalendarEvent extends Post {
  /** Distinct members attending at least one date. */
  going: number
  /** Signed up for at least one date. */
  mine: boolean
  /** Raw rows, so a single day can count just its own date. */
  signups: SignupRow[]
}

export interface Instance {
  /** Stable across renders: one event on one day. */
  id: string
  event: CalendarEvent
  start: Date
  end: Date
  /** True when the day is known but the clock time is not. */
  allDay: boolean
  /** Local YYYY-MM-DD of `start`. */
  key: string
}

export type ViewMode = 'month' | 'week' | 'day' | 'agenda'

export type Status = 'past' | 'going' | 'full' | 'closed' | 'open'

export const MINUTES_PER_DAY = 1440
/** Pixel height of one hour in the week and day grids. */
export const HOUR_PX = 48
/** Anything shorter than this still gets a readable chip. */
const MIN_SLOT_MINUTES = 20
/** How long an event runs when no end time was given. */
const DEFAULT_DURATION_MS = 36e5

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function addDaysTo(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** The Sunday (or Monday, per `weekStart`) on or before `date`. */
export function startOfWeek(date: Date, weekStart: number) {
  const d = startOfDay(date)
  const shift = (d.getDay() - weekStart + 7) % 7
  d.setDate(d.getDate() - shift)
  return d
}

export function sameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b)
}

export function isToday(date: Date) {
  return dayKey(date) === dayKey(new Date())
}

export function isWeekend(date: Date) {
  const d = date.getDay()
  return d === 0 || d === 6
}

/** The seven (or five) columns a week view shows. */
export function weekDays(anchor: Date, weekStart: number, includeWeekends = true) {
  const first = startOfWeek(anchor, weekStart)
  const days = Array.from({ length: 7 }, (_, i) => addDaysTo(first, i))
  return includeWeekends ? days : days.filter((d) => !isWeekend(d))
}

/**
 * The six-row grid a month view shows: always whole weeks, always starting
 * on the configured first day, so the columns line up with the weekday
 * header no matter which day the month begins on. Fixed at six rows
 * because a grid that changes height month to month makes the whole page
 * jump when you click "next".
 */
export function monthCells(cursor: Date, weekStart: number) {
  const gridStart = startOfWeek(startOfMonth(cursor), weekStart)
  return Array.from({ length: 42 }, (_, i) => addDaysTo(gridStart, i))
}

/** ISO-8601 week number — what a work calendar puts down the left edge. */
export function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7)
}

// ---------------------------------------------------------------------
// Occurrences -> instances
// ---------------------------------------------------------------------

function durationMs(event: CalendarEvent) {
  if (!event.starts_at || !event.ends_at) return DEFAULT_DURATION_MS
  const span = new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()
  return span > 0 ? span : DEFAULT_DURATION_MS
}

/** Every day this event lands on, as positioned instances. */
export function instancesOf(event: CalendarEvent): Instance[] {
  const span = durationMs(event)
  return occurrences(event).map((start) => {
    const key = dayKey(start)
    const end = event.all_day ? endOfDay(start) : new Date(start.getTime() + span)
    return { id: `${event.id}:${key}`, event, start, end, allDay: !!event.all_day, key }
  })
}

/** Instances falling inside [from, to], sorted for display. */
export function expand(events: CalendarEvent[], from: Date, to: Date): Instance[] {
  const lo = startOfDay(from).getTime()
  const hi = endOfDay(to).getTime()
  const out: Instance[] = []
  for (const event of events) {
    for (const instance of instancesOf(event)) {
      const at = instance.start.getTime()
      if (at >= lo && at <= hi) out.push(instance)
    }
  }
  return sortInstances(out)
}

/**
 * All-day first, then by start time, then alphabetically. The last
 * tie-break matters more than it looks: without it, two events at the same
 * time swap places on every re-render.
 */
export function sortInstances(list: Instance[]) {
  return [...list].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    const t = a.start.getTime() - b.start.getTime()
    if (t !== 0) return t
    return a.event.title.localeCompare(b.event.title)
  })
}

/**
 * Instances grouped by local day key — the shape every grid wants.
 *
 * The map is rebuilt in date order rather than in the order instances
 * arrived. `sortInstances` floats all-day events to the front, which is
 * right WITHIN a day and wrong across them: without this, a schedule view
 * would open with an all-day event three weeks out sitting above today.
 */
export function groupByDay(list: Instance[]) {
  const buckets = new Map<string, Instance[]>()
  for (const instance of list) {
    const day = buckets.get(instance.key)
    if (day) day.push(instance)
    else buckets.set(instance.key, [instance])
  }
  return new Map(
    [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, day]) => [key, sortInstances(day)] as const),
  )
}

/** Events with no date at all — a standing food drive, an unscheduled idea. */
export function undated(events: CalendarEvent[]) {
  return events.filter((e) => occurrences(e).length === 0)
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

/**
 * Status is per-date for a series: a member can be down for the 9th and
 * not the 16th, and last week's session is grey while the rest of the term
 * is still open. `day` null means "the event as a whole".
 */
export function statusOf(event: CalendarEvent, day: Date | null, userId: string | null): Status {
  const series = isRecurring(event)
  const key = series && day ? dayKey(day) : null
  const rows = key ? event.signups.filter((s) => s.occurs_on === key) : event.signups
  const mine = userId ? rows.some((s) => s.user_id === userId) : event.mine

  const past = series && day ? occurrenceEnded(event, day) : hasEnded(event)
  if (past) return 'past'
  if (mine) return 'going'
  // Capacity is per date for a series — twenty spots at each session.
  if (event.capacity && rows.length >= event.capacity) return 'full'
  if (!event.signup_open) return 'closed'
  return 'open'
}

export const STATUS_LABEL: Record<Status, string> = {
  past: 'Past',
  going: 'You are going',
  full: 'Full',
  closed: 'Sign-ups closed',
  open: 'Open for sign-ups',
}

/** Sign-up numbers for one instance — a series counts only its own date. */
export function rowsFor(instance: Instance, userId: string | null) {
  const { event, key } = instance
  const rows = isRecurring(event) ? event.signups.filter((s) => s.occurs_on === key) : event.signups
  return {
    rows,
    going: rows.length,
    mine: userId ? rows.some((s) => s.user_id === userId) : event.mine,
    spotsLeft: event.capacity ? Math.max(0, event.capacity - rows.length) : null,
  }
}

// ---------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------

export interface CalendarFilters {
  query: string
  /** Empty = every colour. Otherwise only these. */
  colors: EventColorKey[]
  mineOnly: boolean
  openOnly: boolean
  hoursOnly: boolean
  hidePast: boolean
}

export const BLANK_FILTERS: CalendarFilters = {
  query: '',
  colors: [],
  mineOnly: false,
  openOnly: false,
  hoursOnly: false,
  hidePast: false,
}

export function filtersActive(f: CalendarFilters) {
  return (
    f.query.trim() !== '' ||
    f.colors.length > 0 ||
    f.mineOnly ||
    f.openOnly ||
    f.hoursOnly ||
    f.hidePast
  )
}

function matchesQuery(event: CalendarEvent, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    event.title,
    event.summary,
    event.location,
    event.calendar_label,
    event.recurrence_note,
  ]
  return fields.some((field) => !!field && field.toLowerCase().includes(q))
}

/**
 * Filters apply to WHOLE EVENTS, not instances — so a weekly series either
 * belongs on the filtered calendar or it does not, and never flickers in
 * and out week by week. The one exception is "hide past", which is
 * genuinely per-date and handled by `filterInstances`.
 */
export function filterEvents(
  events: CalendarEvent[],
  filters: CalendarFilters,
  userId: string | null,
) {
  return events.filter((event) => {
    if (!matchesQuery(event, filters.query)) return false
    if (filters.colors.length > 0 && !filters.colors.includes(colorOf(event))) return false
    const mine = userId ? event.signups.some((s) => s.user_id === userId) : event.mine
    if (filters.mineOnly && !mine) return false
    if (filters.openOnly && statusOf(event, null, userId) !== 'open') return false
    if (filters.hoursOnly && !event.hours_tbd && !event.service_hours) return false
    if (filters.hidePast && hasEnded(event)) return false
    return true
  })
}

/** Drops individual past dates, for the views that offer to hide them. */
export function filterInstances(list: Instance[], filters: CalendarFilters) {
  if (!filters.hidePast) return list
  return list.filter((i) => !occurrenceEnded(i.event, i.start))
}

// ---------------------------------------------------------------------
// Time-grid layout
// ---------------------------------------------------------------------

export interface Placed {
  instance: Instance
  /** Fractions of the day column, 0–1. */
  left: number
  width: number
  /** Fractions of the day's height, 0–1. */
  top: number
  height: number
}

function minutesInto(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Side-by-side placement for overlapping events, the way every calendar
 * does it: walk the day in start order, break it into clusters that
 * genuinely overlap, and give each cluster the narrowest column count that
 * fits. Events that do not collide keep the full width.
 */
export function layoutDay(list: Instance[]): Placed[] {
  const timed = sortInstances(list.filter((i) => !i.allDay))
  const placed: Placed[] = []

  let cluster: Instance[] = []
  let clusterEnd = -1

  const endMinutes = (instance: Instance) =>
    Math.max(
      minutesInto(instance.start) + MIN_SLOT_MINUTES,
      sameDay(instance.start, instance.end) ? minutesInto(instance.end) : MINUTES_PER_DAY,
    )

  const flush = () => {
    if (cluster.length === 0) return

    // Greedy column assignment: the first column whose last event has ended.
    const columns: Instance[][] = []
    const columnOf = new Map<string, number>()
    for (const instance of cluster) {
      const from = minutesInto(instance.start)
      let index = columns.findIndex((col) => endMinutes(col[col.length - 1]) <= from)
      if (index === -1) {
        columns.push([instance])
        index = columns.length - 1
      } else {
        columns[index].push(instance)
      }
      columnOf.set(instance.id, index)
    }

    for (const instance of cluster) {
      const col = columnOf.get(instance.id) ?? 0
      const top = minutesInto(instance.start)
      const height = Math.max(MIN_SLOT_MINUTES, endMinutes(instance) - top)
      placed.push({
        instance,
        left: col / columns.length,
        width: 1 / columns.length,
        top: top / MINUTES_PER_DAY,
        height: Math.min(1 - top / MINUTES_PER_DAY, height / MINUTES_PER_DAY),
      })
    }

    cluster = []
    clusterEnd = -1
  }

  for (const instance of timed) {
    if (cluster.length > 0 && minutesInto(instance.start) >= clusterEnd) flush()
    cluster.push(instance)
    clusterEnd = Math.max(clusterEnd, endMinutes(instance))
  }
  flush()

  return placed
}

/**
 * The earliest and latest hour the visible events touch, padded — so a
 * calendar whose events all sit between 3 and 6 PM does not open on a
 * screenful of empty midnight.
 */
export function busyHours(list: Instance[]): [number, number] {
  const timed = list.filter((i) => !i.allDay)
  if (timed.length === 0) return [7, 21]
  const first = Math.min(...timed.map((i) => i.start.getHours()))
  const last = Math.max(...timed.map((i) => i.end.getHours() + (i.end.getMinutes() ? 1 : 0)))
  return [Math.max(0, first - 1), Math.min(24, Math.max(last + 1, first + 6))]
}

/** Where the "now" line sits, as a fraction of the day. */
export function nowFraction() {
  const now = new Date()
  return minutesInto(now) / MINUTES_PER_DAY
}

export function formatHour(hour: number) {
  if (hour === 0 || hour === 24) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

/** "3:00 – 4:30 PM", or "Time TBA" when only the day is known. */
export function instanceTime(instance: Instance) {
  if (instance.allDay) return 'Time TBA'
  const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return instance.event.ends_at
    ? `${clock(instance.start)} – ${clock(instance.end)}`
    : clock(instance.start)
}

/** The compact time a chip shows: "3 PM", "3:30 PM". */
export function shortTime(date: Date) {
  const minutes = date.getMinutes()
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    ...(minutes ? { minute: '2-digit' } : {}),
  })
}

export { dayKey, fromDayKey }
