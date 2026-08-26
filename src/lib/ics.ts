import { dayKey } from './format'
import type { CalendarEvent, Instance } from './calendar'
import { instancesOf } from './calendar'

/**
 * iCalendar export.
 *
 * The point is that the club calendar has to survive contact with the
 * calendar people actually live in — Google, Outlook, Apple. A .ics file
 * is the only thing all three agree on. A whole-calendar export means a
 * member imports the term once and stops checking the site to find out
 * when things are.
 *
 * A series is exported as one VEVENT per date rather than an RRULE,
 * matching how it is stored: the dates are hand-editable, so a week
 * removed for a holiday has to stay removed after export.
 */

const CRLF = '\r\n'

/** RFC 5545 escaping: commas, semicolons, backslashes and newlines. */
function esc(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Long property lines must be folded at 75 octets; a leading space continues. */
function fold(line: string) {
  if (line.length <= 74) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 74))
  rest = rest.slice(74)
  while (rest.length > 73) {
    parts.push(` ${rest.slice(0, 73)}`)
    rest = rest.slice(73)
  }
  if (rest) parts.push(` ${rest}`)
  return parts.join(CRLF)
}

function utcStamp(date: Date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

function plainDate(date: Date) {
  return dayKey(date).replace(/-/g, '')
}

/** Strips the HTML body down to something a calendar description can hold. */
function plainText(html: string | null | undefined, limit = 600) {
  if (!html) return ''
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function vevent(instance: Instance, siteUrl: string) {
  const { event, start, end, allDay } = instance
  const lines: string[] = ['BEGIN:VEVENT']

  lines.push(`UID:${event.id}-${dayKey(start)}@keyclub`)
  lines.push(`DTSTAMP:${utcStamp(new Date())}`)

  if (allDay) {
    const next = new Date(start)
    next.setDate(next.getDate() + 1) // DTEND is exclusive for all-day events.
    lines.push(`DTSTART;VALUE=DATE:${plainDate(start)}`)
    lines.push(`DTEND;VALUE=DATE:${plainDate(next)}`)
  } else {
    lines.push(`DTSTART:${utcStamp(start)}`)
    lines.push(`DTEND:${utcStamp(end)}`)
  }

  lines.push(`SUMMARY:${esc(event.title)}`)

  const details = [
    event.summary ?? plainText(event.body),
    event.service_hours ? `Service hours: ${event.service_hours}` : '',
    event.hours_tbd ? 'Service hours: TBD' : '',
    siteUrl ? `${siteUrl}#/post/${event.slug}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  if (details) lines.push(`DESCRIPTION:${esc(details)}`)
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`)
  if (event.calendar_label) lines.push(`CATEGORIES:${esc(event.calendar_label)}`)
  if (siteUrl) lines.push(`URL:${siteUrl}#/post/${event.slug}`)

  // Half an hour is enough warning to walk somewhere on a school campus.
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(event.title)}`, 'END:VALARM')
  lines.push('END:VEVENT')
  return lines
}

function wrap(body: string[], name: string) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Key Club//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    ...body,
    'END:VCALENDAR',
  ]
    .map(fold)
    .join(CRLF)
}

/** One event — every date of it, if it repeats. */
export function icsForEvent(event: CalendarEvent, on: Date | null, siteUrl = '') {
  const all = instancesOf(event)
  const chosen = on ? all.filter((i) => i.key === dayKey(on)) : all
  const list = chosen.length > 0 ? chosen : all
  return wrap(
    list.flatMap((i) => vevent(i, siteUrl)),
    event.title,
  )
}

/** Everything currently on the calendar, filters included. */
export function icsForEvents(events: CalendarEvent[], name: string, siteUrl = '') {
  return wrap(
    events.flatMap((event) => instancesOf(event).flatMap((i) => vevent(i, siteUrl))),
    name,
  )
}

export function downloadIcs(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next tick; Safari has not started the download yet.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * "Add to Google Calendar" for one occurrence.
 *
 * `on` is the date the member is looking at — for a weekly series that is
 * the specific Wednesday whose cell they clicked, not the first one back
 * in September.
 */
export function googleCalendarUrl(event: CalendarEvent, on: Date | null) {
  const first = event.starts_at ? new Date(event.starts_at) : null
  if (!first) return null

  const start = on ? new Date(on) : new Date(first)
  if (on && !event.all_day) start.setHours(first.getHours(), first.getMinutes(), 0, 0)

  let dates: string
  if (event.all_day) {
    const next = new Date(start)
    next.setDate(next.getDate() + 1) // Google's end date is exclusive.
    dates = `${plainDate(start)}/${plainDate(next)}`
  } else {
    const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
    const span = event.ends_at ? new Date(event.ends_at).getTime() - first.getTime() : 36e5
    dates = `${stamp(start)}/${stamp(new Date(start.getTime() + span))}`
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    details: event.summary ?? '',
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
