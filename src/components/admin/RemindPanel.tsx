import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Post } from '../../lib/types'
import { dayKey, formatDate, formatOccurrence, isRecurring, occurrences } from '../../lib/format'

export interface EventReminder {
  id: string
  post_id: string
  occurs_on: string | null
  audience: 'signed_up' | 'members'
  note: string | null
  status: 'queued' | 'sending' | 'sent' | 'failed'
  requested_at: string
  sent_at: string | null
  recipients: number
  detail: string | null
}

type Audience = EventReminder['audience']

/** The dates still ahead, soonest first. */
export function upcomingDates(post: Post) {
  const now = Date.now()
  return occurrences(post).filter((d) => d.getTime() >= now - 12 * 3600 * 1000)
}

/**
 * The form under an event's row: which date, who gets it, an optional note.
 * Sending only queues a row — the Apps Script picks it up within a minute.
 */
export function RemindPanel({
  post,
  onQueued,
  onClose,
}: {
  post: Post
  onQueued: () => void
  onClose: () => void
}) {
  const dates = useMemo(() => upcomingDates(post), [post])
  const series = isRecurring(post)
  const officersOnly = post.audience === 'officers'

  const [occursOn, setOccursOn] = useState(dates[0] ? dayKey(dates[0]) : '')
  const [audience, setAudience] = useState<Audience>('signed_up')
  const [note, setNote] = useState('')
  const [counts, setCounts] = useState<{ signed: number | null; members: number | null }>({
    signed: null,
    members: null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let signed = supabase
      .from('event_signups')
      .select('user_id', { count: 'exact', head: true })
      .eq('post_id', post.id)
      .eq('status', 'going')
    if (series && occursOn) signed = signed.eq('occurs_on', occursOn)

    let members = supabase
      .from('members')
      .select('email', { count: 'exact', head: true })
      .eq('active', true)
    if (officersOnly) members = members.in('role', ['officer', 'admin'])

    void Promise.all([signed, members]).then(([s, m]) => {
      if (live) setCounts({ signed: s.count ?? 0, members: m.count ?? 0 })
    })
    return () => {
      live = false
    }
  }, [post.id, series, occursOn, officersOnly])

  const total = audience === 'signed_up' ? counts.signed : counts.members

  async function send() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('event_reminders').insert({
      post_id: post.id,
      occurs_on: occursOn || null,
      audience,
      note: note.trim() || null,
    })
    setSaving(false)
    if (error) {
      setError(
        error.code === '23505'
          ? 'A reminder for this event is already on its way.'
          : error.message,
      )
      return
    }
    onQueued()
  }

  const option = (value: Audience, label: string, count: number | null) => (
    <label
      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
        audience === value
          ? 'border-transparent bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-50'
          : 'border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <input
        type="radio"
        name={`aud-${post.id}`}
        className="size-4"
        checked={audience === value}
        onChange={() => setAudience(value)}
      />
      <span className="flex-1">{label}</span>
      <span className="text-xs muted">{count ?? '…'}</span>
    </label>
  )

  return (
    <div className="w-full space-y-3 border-t border-[var(--line)] pt-4">
      {series && dates.length > 1 && (
        <div>
          <label className="label">Which date</label>
          <select className="field" value={occursOn} onChange={(e) => setOccursOn(e.target.value)}>
            {dates.map((d) => (
              <option key={dayKey(d)} value={dayKey(d)}>
                {formatOccurrence(d, post.all_day)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className="label">Email</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          {option('signed_up', series ? 'Signed up for that date' : 'Everyone signed up', counts.signed)}
          {option('members', officersOnly ? 'All officers' : 'All active members', counts.members)}
        </div>
        {audience === 'members' && (
          <p className="mt-1 text-xs muted">
            People already signed up get “see you there”; everyone else gets a nudge to sign up.
          </p>
        )}
      </div>

      <div>
        <label className="label">Note (optional)</label>
        <textarea
          rows={2}
          maxLength={1000}
          className="field resize-y"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Bring gloves and a water bottle. We meet at the front gate."
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary py-1.5 text-sm"
          disabled={saving || !total}
          onClick={() => void send()}
        >
          {saving
            ? 'Queuing…'
            : total === 0
              ? 'Nobody to email'
              : `Email ${total ?? ''} ${total === 1 ? 'person' : 'people'}`}
        </button>
        <button type="button" className="btn btn-ghost py-1.5 text-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One line under the title: where the latest reminder stands. */
export function ReminderStatus({
  reminder,
  onCancel,
}: {
  reminder: EventReminder
  onCancel: () => void
}) {
  const when = reminder.occurs_on ? ` for ${formatDate(reminder.occurs_on + 'T12:00:00')}` : ''
  switch (reminder.status) {
    case 'queued':
      return (
        <p className="text-xs text-navy-600 dark:text-navy-200">
          ✉️ Reminder{when} queued. It goes out within a minute.{' '}
          <button type="button" className="font-semibold hover:underline" onClick={onCancel}>
            Cancel
          </button>
        </p>
      )
    case 'sending':
      return <p className="text-xs text-navy-600 dark:text-navy-200">✉️ Sending reminder{when}…</p>
    case 'sent':
      return (
        <p className="text-xs muted">
          ✉️ Reminded {formatDate(reminder.sent_at ?? reminder.requested_at)}
          {when} · {reminder.recipients} {reminder.recipients === 1 ? 'person' : 'people'}
          {reminder.detail && <span className="block text-gold-600 dark:text-gold-200">{reminder.detail}</span>}
        </p>
      )
    case 'failed':
      return (
        <p className="text-xs text-red-600 dark:text-red-300">
          ✉️ Reminder{when} failed{reminder.detail ? `: ${reminder.detail}` : '.'}
        </p>
      )
  }
}
