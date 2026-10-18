import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { dayKey, fromDayKey, slugify } from '../../lib/format'
import { BLANK_SCHEDULE, addDays, applyPreset, defaultUntil, repeatPresets, toPayload, type ScheduleForm } from '../../lib/schedule'
import { EVENT_COLORS, colorOf, type EventColorKey } from '../../lib/eventColors'
import type { Audience } from '../../lib/types'
import { useFloating } from './EventPopover'
import { Icon, IconButton, type IconName } from './icons'

/** The placeholder the grid draws while the quick-create card is open. */
export interface Draft {
  start: Date
  end: Date
  allDay: boolean
  title: string
  color: EventColorKey | null
  /** What was clicked; null opens the card centred. */
  anchor: DOMRect | null
}

/** What the card can make. Each is a post category with its own fields. */
type Kind = 'event' | 'meeting'

const KINDS: { key: Kind; label: string }[] = [
  { key: 'event', label: 'Event' },
  { key: 'meeting', label: 'Meeting' },
]

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'officers', label: 'Officers' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Every quarter hour of the day, as Google's time dropdowns offer. */
const SLOTS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)

function label(slot: string) {
  const [h, m] = slot.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()
}

function minutes(slot: string) {
  const [h, m] = slot.split(':').map(Number)
  return h * 60 + m
}

function duration(from: string, to: string) {
  let mins = minutes(to) - minutes(from)
  if (mins <= 0) mins += 1440
  return mins < 60 ? `${mins} mins` : `${+(mins / 60).toFixed(2)} hr${mins === 60 ? '' : 's'}`
}

/**
 * Google Calendar's quick "add event" card. Title, when, and the handful of
 * things a Key Club event needs; Save publishes it straight onto the
 * calendar, More options carries everything typed into the full editor.
 */
export default function QuickCreate({
  draft,
  userId,
  onChange,
  onClose,
  onSaved,
}: {
  draft: Draft
  userId: string | null
  onChange: (draft: Draft) => void
  onClose: () => void
  onSaved: () => void
}) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const { sheet, style } = useFloating(ref, draft.anchor, 448, onClose)

  const [kind, setKind] = useState<Kind>('event')
  const [audience, setAudience] = useState<Audience>('everyone')
  const [title, setTitle] = useState(draft.title)
  const [date, setDate] = useState(dayKey(draft.start))
  const [allDay, setAllDay] = useState(draft.allDay)
  const [start, setStart] = useState(draft.allDay ? '09:00' : hhmm(draft.start))
  const [end, setEnd] = useState(draft.allDay ? '10:00' : hhmm(draft.end))
  /** 'once' or a preset id from repeatPresets(). */
  const [repeat, setRepeat] = useState('once')
  const [until, setUntil] = useState(() => addDays(dayKey(draft.start), 7 * 11))
  const [location, setLocation] = useState('')
  const [hours, setHours] = useState('')
  const [capacity, setCapacity] = useState('')
  const [summary, setSummary] = useState('')
  const [color, setColor] = useState<EventColorKey | null>(draft.color)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Null colour means "the type's default" — peacock for events, grape for
  // meetings — so switching type repaints an untouched card.
  const shownColor = colorOf({ color, category: kind })

  // Presets follow the date: "Weekly on Wednesday" becomes "on Thursday".
  // One that no longer exists (the last Friday, moved mid-month) drops back
  // to "Does not repeat".
  const presets = useMemo(() => repeatPresets(date), [date])
  const repeatId = repeat === 'once' || presets.some((p) => p.id === repeat) ? repeat : 'once'

  function pickRepeat(id: string) {
    // Custom rules and hand-picked dates need the full editor.
    if (id === 'rule' || id === 'custom') {
      moreOptions(id)
      return
    }
    setRepeat(id)
    const freq = presets.find((p) => p.id === id)?.patch.freq
    if (freq) setUntil(defaultUntil(date, freq))
  }

  // Keep the placeholder on the grid in step with the form.
  useEffect(() => {
    const s = fromDayKey(date)
    const e = fromDayKey(date)
    if (!allDay) {
      s.setHours(...(start.split(':').map(Number) as [number, number]))
      e.setHours(...(end.split(':').map(Number) as [number, number]))
      if (e <= s) e.setDate(e.getDate() + 1)
    }
    onChange({ ...draft, start: s, end: e, allDay, title, color: shownColor })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, allDay, start, end, title, shownColor])

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true })
  }, [])

  const endOptions = useMemo(() => {
    const from = SLOTS.indexOf(start)
    return [...SLOTS.slice(from + 1), ...SLOTS.slice(0, from + 1)].slice(0, 95)
  }, [start])

  function changeStart(next: string) {
    // Moving the start keeps the length, as Google does.
    const len = (minutes(end) - minutes(start) + 1440) % 1440 || 60
    setStart(next)
    setEnd(SLOTS[((minutes(next) + len) % 1440) / 15])
  }

  const baseSchedule: ScheduleForm = {
    ...BLANK_SCHEDULE,
    start_date: date,
    start_time: allDay ? '' : start,
    end_time: allDay ? '' : end,
  }
  const schedule: ScheduleForm =
    repeatId === 'once' ? baseSchedule : { ...applyPreset(baseSchedule, repeatId), repeat_until: until }

  async function save() {
    if (!title.trim()) {
      setError('Add a title first.')
      return
    }
    setSaving(true)
    setError(null)

    const base = slugify(title)
    const payload = {
      title: title.trim(),
      summary: summary.trim() || null,
      body: '',
      category: kind,
      cover_url: null,
      pinned: false,
      published: true,
      author_id: userId,
      ...toPayload(schedule),
      location: location.trim() || null,
      // Meetings take no sign-ups and award no hours; they invite instead.
      service_hours: kind === 'event' && hours ? Number(hours) : null,
      hours_tbd: false,
      capacity: kind === 'event' && capacity ? Number(capacity) : null,
      signup_open: true,
      color,
      calendar_label: null,
      audience: kind === 'meeting' ? audience : null,
    }

    // Slugs are unique; a second "Beach cleanup" gets a short suffix.
    let { error } = await supabase.from('posts').insert({ ...payload, slug: base })
    if (error?.code === '23505') {
      ;({ error } = await supabase
        .from('posts')
        .insert({ ...payload, slug: `${base}-${Math.random().toString(36).slice(2, 6)}` }))
    }

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  function moreOptions(repeatOverride?: string) {
    const params = new URLSearchParams({ date, type: kind })
    const rep = repeatOverride ?? repeatId
    if (rep !== 'once') {
      params.set('repeat', rep)
      if (rep !== 'custom') params.set('until', until)
    }
    if (kind === 'meeting') params.set('audience', audience)
    if (!allDay) {
      params.set('time', start)
      params.set('end', end)
    }
    const extra: [string, string][] = [
      ['title', title.trim()],
      ['location', location.trim()],
      ['summary', summary.trim()],
      ['hours', kind === 'event' ? hours : ''],
      ['capacity', kind === 'event' ? capacity : ''],
      ['color', color ?? ''],
    ]
    for (const [key, value] of extra) if (value) params.set(key, value)
    navigate(`/admin/posts/new?${params.toString()}`)
  }

  const box = 'rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy-400'
  const field = `w-full ${box}`

  return (
    <>
      {sheet && <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={onClose} />}
      <div
        ref={ref}
        role="dialog"
        aria-label={kind === 'meeting' ? 'Create meeting' : 'Create event'}
        style={style}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault()
            void save()
          }
        }}
        className={`cal-popover z-50 overflow-y-auto ${
          sheet ? 'fixed inset-x-0 bottom-0 max-h-[90vh] rounded-b-none' : 'fixed max-h-[90vh]'
        }`}
      >
        <div className="flex items-center justify-end rounded-t-[1rem] bg-[var(--surface-2)] px-2 py-1">
          <IconButton icon="close" label="Close" size="size-8" onClick={onClose} />
        </div>

        <div className="px-5 pb-2 pt-3">
          <div className="pl-9">
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              className="w-full border-b border-[var(--line-strong)] bg-transparent pb-1.5 text-[1.375rem] outline-none placeholder:text-[var(--ink-faint)] focus:border-b-2 focus:border-navy-500"
            />
            <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Type">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.key}
                  onClick={() => setKind(k.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    kind === k.key
                      ? 'bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-50'
                      : 'muted hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <Row icon="clock">
            <div className="flex flex-wrap items-center gap-1.5">
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={box} />
              {!allDay && (
                <span className="flex items-center gap-1.5">
                  <select value={start} onChange={(e) => changeStart(e.target.value)} className={box}>
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                  <span className="muted">–</span>
                  <select value={end} onChange={(e) => setEnd(e.target.value)} className={`${box} max-w-40`}>
                    {endOptions.map((s) => (
                      <option key={s} value={s}>
                        {label(s)} ({duration(start, s)})
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className="size-4" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                All day
              </label>
              <select
                value={repeatId}
                onChange={(e) => pickRepeat(e.target.value)}
                className="max-w-full rounded-md bg-transparent py-1 text-sm hover:bg-[var(--surface-2)]"
              >
                <option value="once">Does not repeat</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {/* The full rule builder lives in the editor. */}
                <option value="rule">Custom…</option>
                <option value="custom">Pick specific dates…</option>
              </select>
              {repeatId !== 'once' && (
                <label className="flex items-center gap-2">
                  <span className="muted">until</span>
                  <input
                    type="date"
                    value={until}
                    min={date}
                    onChange={(e) => setUntil(e.target.value)}
                    className={`${box} py-1`}
                  />
                </label>
              )}
            </div>
          </Row>

          <Row icon="pin">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" className={field} />
          </Row>

          <Row icon="people">
            {kind === 'meeting' ? (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                <span className="muted">Invite</span>
                {AUDIENCES.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    aria-pressed={audience === a.key}
                    onClick={() => setAudience(a.key)}
                    className={`h-8 rounded-full border px-4 font-medium transition ${
                      audience === a.key
                        ? 'border-transparent bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-50'
                        : 'border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            ) : (
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Service hours"
                className={field}
              />
              <input
                type="number"
                min="1"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Spots (no limit)"
                className={field}
              />
            </div>
            )}
          </Row>

          <Row icon="notes">
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Add description"
              rows={2}
              className={`${field} resize-none`}
            />
          </Row>

          <Row icon="today">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
              {EVENT_COLORS.map((c) => {
                const on = shownColor === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={c.label}
                    data-ec={c.key}
                    onClick={() => setColor(c.key)}
                    className="ec-dot grid size-6 place-items-center rounded-full text-white transition hover:scale-110"
                  >
                    {on && <Icon name="check" className="size-3.5" />}
                  </button>
                )
              })}
            </div>
          </Row>

          {error && <p className="mt-2 pl-9 text-sm text-red-600 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">
          <button
            type="button"
            onClick={() => moreOptions()}
            className="h-9 rounded-full px-4 text-sm font-medium text-navy-600 transition hover:bg-[var(--surface-2)] dark:text-navy-200"
          >
            More options
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="h-9 rounded-full bg-navy-600 px-6 text-sm font-medium text-white transition hover:bg-navy-700 disabled:opacity-60 dark:bg-navy-300 dark:text-navy-950"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}

function Row({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="mt-3 flex gap-4">
      <span className="flex w-5 shrink-0 justify-center pt-2 muted">
        <Icon name={icon} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
