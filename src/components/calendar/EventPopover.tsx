import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import type { Instance } from '../../lib/calendar'
import { rowsFor, statusOf } from '../../lib/calendar'
import { colorOf } from '../../lib/eventColors'
import { downloadIcs, googleCalendarUrl, icsForEvent } from '../../lib/ics'
import { formatServiceHours, isRecurring } from '../../lib/format'
import { Icon, IconButton, type IconName } from './icons'

const GAP = 8

/**
 * Places a floating card beside `anchor`, clamped to the viewport; below
 * 640px it reports `sheet` so the caller renders a bottom sheet instead.
 * Escape and a click outside both call `onClose`.
 */
export function useFloating(
  ref: RefObject<HTMLDivElement | null>,
  anchor: DOMRect,
  width: number,
  onClose: () => void,
  over = false,
) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [sheet, setSheet] = useState(() => window.innerWidth < 640)

  useLayoutEffect(() => {
    const narrow = window.innerWidth < 640
    setSheet(narrow)
    if (narrow) return
    const height = ref.current?.getBoundingClientRect().height ?? 320
    let left: number
    let top: number
    if (over) {
      // Google's "N more" card sits on top of the day it expands.
      left = anchor.left + anchor.width / 2 - width / 2
      top = anchor.top - 60
    } else {
      left = anchor.right + GAP
      if (left + width > window.innerWidth - GAP) left = anchor.left - width - GAP
      top = anchor.top - 8
    }
    left = Math.min(Math.max(GAP, left), window.innerWidth - width - GAP)
    top = Math.min(Math.max(GAP, top), window.innerHeight - height - GAP)
    setPos({ top, left })
  }, [anchor, width, over, ref])

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
    // Deferred: the click that opened the card is still propagating.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      clearTimeout(id)
    }
  }, [onClose, ref])

  const style = sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }
  return { sheet, style }
}

function Row({ icon, children }: { icon: IconName | 'swatch'; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-1.5">
      <span className="flex w-5 shrink-0 justify-center pt-0.5 muted">
        {icon === 'swatch' ? (
          <span className="ec-dot mt-1.5 size-3.5 rounded" aria-hidden />
        ) : (
          <Icon name={icon} />
        )}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  )
}

/** Google Calendar's event card, with the RSVP as "Going? Yes / No". */
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
  anchor: DOMRect
  userId: string | null
  isAdmin: boolean
  busy: boolean
  onRsvp: (instance: Instance) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { sheet, style } = useFloating(ref, anchor, 448, onClose)
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)

  const { event, start } = instance
  const status = statusOf(event, start, userId)
  const { going, mine, spotsLeft } = rowsFor(instance, userId)
  const series = isRecurring(event)
  const hours = formatServiceHours(event)
  const gcal = googleCalendarUrl(event, start)

  useEffect(() => {
    // preventScroll: focusing must not drag the time grid behind it.
    ref.current?.focus({ preventScroll: true })
  }, [])

  const dateLine = start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const timeLine = instance.allDay
    ? null
    : event.ends_at
      ? `${clock(start)} – ${clock(instance.end)}`
      : clock(start)

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#/post/${event.slug}`
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
    setMenu(false)
  }

  const canAnswer = status === 'open' || status === 'going'
  const linkIcon =
    'grid size-10 place-items-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'

  return (
    <>
      {sheet && <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={onClose} />}
      <div
        ref={ref}
        role="dialog"
        aria-label={event.title}
        tabIndex={-1}
        data-ec={colorOf(event)}
        style={style}
        className={`cal-popover z-50 overflow-y-auto outline-none ${
          sheet ? 'fixed inset-x-0 bottom-0 max-h-[85vh] rounded-b-none' : 'fixed max-h-[85vh]'
        }`}
      >
        {/* Action bar */}
        <div className="flex items-center justify-end gap-0.5 px-2 pt-2">
          {isAdmin && (
            <Link to={`/admin/posts/${event.id}`} title="Edit event" aria-label="Edit event" className={linkIcon}>
              <Icon name="edit" />
            </Link>
          )}
          <Link to={`/post/${event.slug}`} title="Open event page" aria-label="Open event page" className={linkIcon}>
            <Icon name="open" />
          </Link>
          <div className="relative">
            <IconButton icon="more" label="Options" onClick={() => setMenu((m) => !m)} />
            {menu && (
              <div className="cal-popover absolute right-0 top-11 z-10 w-56 py-2 text-sm">
                {gcal && (
                  <a
                    href={gcal}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2 hover:bg-[var(--surface-2)]"
                  >
                    Add to my Google Calendar
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    downloadIcs(event.slug, icsForEvent(event, series ? null : start))
                    setMenu(false)
                  }}
                  className="block w-full px-4 py-2 text-left hover:bg-[var(--surface-2)]"
                >
                  Download .ics
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="block w-full px-4 py-2 text-left hover:bg-[var(--surface-2)]"
                >
                  Copy link
                </button>
              </div>
            )}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className="px-5 pb-2">
          <Row icon="swatch">
            <h2 className="text-[1.375rem] leading-snug">{event.title}</h2>
            <p className="mt-1 muted">
              {dateLine}
              {timeLine && <> ⋅ {timeLine}</>}
            </p>
            {event.recurrence_note && <p className="muted">{event.recurrence_note}</p>}
          </Row>

          {event.location && (
            <Row icon="pin">
              <p className="pt-0.5">{event.location}</p>
            </Row>
          )}

          <Row icon="people">
            <p className="pt-0.5">
              {going} going{series ? ' this date' : ''}
              {spotsLeft !== null && (
                <span className="muted">
                  {' · '}
                  {spotsLeft === 0 ? 'full' : `${spotsLeft} of ${event.capacity} spots left`}
                </span>
              )}
            </p>
          </Row>

          {hours && (
            <Row icon="clock">
              <p className="pt-0.5">{hours === 'TBD' ? 'Service hours TBD' : `${hours} of service`}</p>
            </Row>
          )}

          {event.summary && (
            <Row icon="notes">
              <p className="whitespace-pre-line pt-0.5">{event.summary}</p>
            </Row>
          )}

          <Row icon="today">
            <p className="pt-0.5">{event.calendar_label || 'Key Club'}</p>
          </Row>
        </div>

        {/* RSVP */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-5 py-3 text-sm">
          {status === 'past' ? (
            <span className="muted">This event has ended{mine ? ' · you went' : ''}</span>
          ) : !canAnswer ? (
            <span className="muted">{status === 'full' ? 'This event is full' : 'Sign-ups are closed'}</span>
          ) : (
            <>
              <span className="font-medium">Going{series ? ' this date' : ''}?</span>
              <div className="flex gap-2">
                <RsvpButton on={mine} disabled={busy} onClick={() => !mine && onRsvp(instance)}>
                  Yes
                </RsvpButton>
                <RsvpButton on={!mine} disabled={busy} onClick={() => mine && onRsvp(instance)}>
                  No
                </RsvpButton>
              </div>
              {busy && <span className="text-xs muted">Saving…</span>}
            </>
          )}
          {copied && <span className="ml-auto text-xs muted">Link copied</span>}
        </div>
      </div>
    </>
  )
}

function RsvpButton({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`flex h-8 items-center gap-1 rounded-full border px-4 text-sm font-medium transition disabled:opacity-60 ${
        on
          ? 'border-transparent bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-50'
          : 'border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
      }`}
    >
      {on && <Icon name="check" className="size-4" />}
      {children}
    </button>
  )
}
