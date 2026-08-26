import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Instance } from '../../lib/calendar'
import { instanceTime, rowsFor, statusOf } from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'
import { downloadIcs, googleCalendarUrl, icsForEvent } from '../../lib/ics'
import { formatServiceHours, isRecurring } from '../../lib/format'

const GAP = 10
const WIDTH = 360

/**
 * The floating event card.
 *
 * Clicking an event should answer "what is this and am I in?" without
 * leaving the grid you are reading — that is the single biggest reason a
 * calendar feels fast. So this is a popover anchored to whatever was
 * clicked, with the RSVP right inside it, and it becomes a bottom sheet
 * on a phone where a floating card would land off-screen.
 */
export default function EventPopover({
  instance,
  anchor,
  userId,
  isAdmin,
  busy,
  onRsvp,
  onClose,
}: {
  instance: Instance
  /** Bounding rect of the chip that opened this. */
  anchor: DOMRect
  userId: string | null
  isAdmin: boolean
  busy: boolean
  onRsvp: (instance: Instance) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [sheet, setSheet] = useState(() => window.innerWidth < 640)
  const [copied, setCopied] = useState(false)

  const { event, start } = instance
  const color = colorOf(event)
  const status = statusOf(event, start, userId)
  const { going, mine, spotsLeft } = rowsFor(instance, userId)
  const series = isRecurring(event)
  const hours = formatServiceHours(event)
  const gcal = googleCalendarUrl(event, start)
  const pct = event.capacity ? Math.min(100, (going / event.capacity) * 100) : 0

  // Position after paint, when the card's real height is known.
  useLayoutEffect(() => {
    const narrow = window.innerWidth < 640
    setSheet(narrow)
    if (narrow) return

    const box = ref.current?.getBoundingClientRect()
    const height = box?.height ?? 320
    // Prefer the right of the chip, fall back to its left, then clamp.
    let left = anchor.right + GAP
    if (left + WIDTH > window.innerWidth - GAP) left = anchor.left - WIDTH - GAP
    if (left < GAP) left = Math.max(GAP, (window.innerWidth - WIDTH) / 2)

    let top = anchor.top - 8
    if (top + height > window.innerHeight - GAP) top = window.innerHeight - height - GAP
    if (top < GAP) top = GAP

    setPos({ top, left })
  }, [anchor])

  // Escape closes, and a click anywhere outside does too — the two things
  // everyone tries first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    // Deferred: the click that opened this is still propagating.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      clearTimeout(id)
    }
  }, [onClose])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#/post/${event.slug}`
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const style = sheet
    ? undefined
    : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }

  return (
    <>
      {sheet && (
        <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={onClose} />
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label={event.title}
        tabIndex={-1}
        data-ec={color}
        style={style}
        className={`cal-popover z-50 outline-none ${
          sheet
            ? 'fixed inset-x-2 bottom-2 max-h-[80vh] overflow-y-auto'
            : 'fixed max-h-[85vh] overflow-y-auto'
        }`}
      >
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4">
          <span className="ec-dot mt-1.5 size-3 shrink-0 rounded-sm" aria-hidden />
          <div className="min-w-0 flex-1">
            <Link
              to={`/post/${event.slug}`}
              className="font-[family-name:var(--font-display)] text-base font-semibold leading-snug hover:underline"
            >
              {event.title}
            </Link>
            <p className="mt-0.5 text-sm muted">
              {start.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              {' · '}
              {instanceTime(instance)}
            </p>
            {event.calendar_label && (
              <span className="ec-soft mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {event.calendar_label}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-full text-sm muted transition hover:bg-[var(--surface)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm">
          {event.recurrence_note && (
            <p className="flex gap-2 muted">
              <span aria-hidden>🔁</span>
              {event.recurrence_note}
            </p>
          )}
          {event.location && (
            <p className="flex gap-2 muted">
              <span aria-hidden>📍</span>
              {event.location}
            </p>
          )}
          {hours && (
            <p className="flex gap-2 muted">
              <span aria-hidden>⏱️</span>
              {hours} of service
            </p>
          )}
          {event.summary && <p>{event.summary}</p>}

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {going} {going === 1 ? 'member' : 'members'} going
                {series && <span className="muted"> this date</span>}
              </span>
              {spotsLeft !== null && (
                <span
                  className={
                    spotsLeft === 0 ? 'muted' : 'font-semibold text-gold-600 dark:text-gold-300'
                  }
                >
                  {spotsLeft === 0 ? 'Full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
                </span>
              )}
            </div>
            {event.capacity ? (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
                <div
                  className={`h-full rounded-full ${spotsLeft === 0 ? 'bg-navy-400' : 'bg-gold-400'}`}
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onRsvp(instance)}
              disabled={busy || (status !== 'open' && status !== 'going')}
              className={`btn py-1.5 text-sm ${mine ? 'btn-ghost' : 'btn-primary'}`}
            >
              {busy
                ? 'Saving…'
                : mine
                  ? series
                    ? '✓ In for this date — cancel'
                    : '✓ You’re going — cancel'
                  : status === 'past'
                    ? 'Already happened'
                    : status === 'full'
                      ? 'Full'
                      : status === 'closed'
                        ? 'Sign-ups closed'
                        : series
                          ? 'Count me in for this date'
                          : 'Count me in'}
            </button>

            <Link to={`/post/${event.slug}`} className="btn btn-ghost py-1.5 text-sm">
              {series ? 'All dates' : 'Details'}
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3 text-xs">
            {gcal && (
              <a
                href={gcal}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-navy-600 hover:underline dark:text-navy-200"
              >
                Add to Google
              </a>
            )}
            <button
              type="button"
              onClick={() => downloadIcs(event.slug, icsForEvent(event, series ? null : start))}
              className="font-semibold text-navy-600 hover:underline dark:text-navy-200"
            >
              Download .ics
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="font-semibold text-navy-600 hover:underline dark:text-navy-200"
            >
              {copied ? 'Link copied ✓' : 'Copy link'}
            </button>
            {isAdmin && (
              <Link
                to={`/admin/posts/${event.id}`}
                className="ml-auto font-semibold text-navy-600 hover:underline dark:text-navy-200"
              >
                Edit event
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
