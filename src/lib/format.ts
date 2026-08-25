export function formatDate(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "in 3 days", "2 weeks ago" — for feed timestamps. */
export function relative(iso: string | null | undefined) {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536e6],
    ['month', 2592e6],
    ['week', 6048e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
  ]
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}

type Dated = {
  starts_at: string | null
  ends_at: string | null
  event_dates?: string[] | null
  all_day?: boolean | null
}

/** Local YYYY-MM-DD. Never toISOString here — it shifts the day by timezone. */
export function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "2026-09-03" -> local midnight that day, not UTC midnight. */
export function fromDayKey(key: string) {
  return new Date(`${key}T00:00:00`)
}

/**
 * Every date this event happens on, as local Date objects carrying the
 * series' shared time of day.
 *
 * A one-off event returns its single start; a series returns each stored
 * date with starts_at's clock time grafted on; an undated event returns [].
 * Everything that draws an event on a calendar or asks "is it over" goes
 * through here, so recurrence never has to be special-cased twice.
 */
export function occurrences(post: Dated): Date[] {
  const dates = post.event_dates
  if (dates && dates.length > 0) {
    const start = post.starts_at ? new Date(post.starts_at) : null
    return dates
      .map((key) => {
        const d = fromDayKey(key)
        if (start && !post.all_day) {
          d.setHours(start.getHours(), start.getMinutes(), 0, 0)
        }
        return d
      })
      .sort((a, b) => a.getTime() - b.getTime())
  }
  return post.starts_at ? [new Date(post.starts_at)] : []
}

/** The next occurrence still to come, or null once the whole series is done. */
export function nextOccurrence(post: Dated): Date | null {
  const now = Date.now()
  return occurrences(post).find((d) => d.getTime() >= now) ?? null
}

/** How long one occurrence runs, in ms — used to project ends_at onto later dates. */
function durationMs(post: Dated) {
  if (!post.starts_at || !post.ends_at) return 0
  return Math.max(0, new Date(post.ends_at).getTime() - new Date(post.starts_at).getTime())
}

/**
 * True only when the event has a date AND its LAST occurrence is past.
 *
 * Two things this deliberately does not do. An undated event ("ongoing
 * canned food drive") has NOT ended — treating a missing date as "over" is
 * what used to lock sign-ups on every event whose date field was left
 * blank. And a weekly series is not over until its final week, so a
 * Wednesday tutoring block stays open all term.
 */
export function hasEnded(post: Dated) {
  const all = occurrences(post)
  if (all.length === 0) return false
  const last = all[all.length - 1].getTime() + durationMs(post)
  return last < Date.now()
}

/** Anything that has not ended, including undated events. */
export function isUpcoming(post: Dated) {
  return !hasEnded(post)
}

/**
 * Whether one date of a series is already over — which is what greys out a
 * single Wednesday while the rest of the term stays open. An all-day date
 * runs until midnight rather than expiring at 00:00 the moment it starts.
 */
export function occurrenceEnded(post: Dated, date: Date) {
  const end = new Date(date)
  if (post.all_day || !post.starts_at) end.setHours(23, 59, 59, 999)
  else end.setTime(end.getTime() + durationMs(post))
  return end.getTime() < Date.now()
}

/** True when this event happens on more than one day. */
export function isRecurring(post: Dated) {
  return (post.event_dates?.length ?? 0) > 1
}

/**
 * The date line for an event: "Sat, Sep 12" when the time is still unknown,
 * "Sat, Sep 12 · 3:00 PM" once it is set, "" when even the date is open.
 */
export function formatOccurrence(date: Date | null, allDay?: boolean | null) {
  if (!date) return ''
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  if (allDay) return day
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

/** "3 hrs", "TBD", or "" when the event awards no hours at all. */
export function formatServiceHours(post: { service_hours: number | null; hours_tbd?: boolean | null }) {
  if (post.hours_tbd) return 'TBD'
  return post.service_hours ? `${post.service_hours} hrs` : ''
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function slugify(title: string) {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'post'
}

export function gradeLabel(grade: number | null | undefined) {
  if (!grade) return null
  return { 9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior' }[grade] ?? `Grade ${grade}`
}

/** Formats a phone number as (123) 456-7890 when it looks like a US number. */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}
