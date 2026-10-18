import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { EventAbsence, Post } from '../lib/types'
import { dayKey, formatOccurrence, occurrenceEnded, occurrences } from '../lib/format'
import { removeSignup, signupKey } from '../lib/rsvp'
import { ADVANCE_HOURS, KIND_LABEL, sentLine } from '../lib/absence'
import { EmptyState, Notice, PageHeader, Spinner } from '../components/ui'

/**
 * "I can't go" / "I'll be late" for an upcoming event or meeting.
 *
 * One notice per member per date — saying "late" after "can't go" replaces
 * it. Notices are private to the member and officers, who read them in
 * Admin → Absences and on each event's page and calendar card.
 */

type Kind = EventAbsence['kind']

/** One date of one event — a series contributes a row per remaining date. */
type Slot = {
  id: string
  post: Post
  at: Date
  /** What gets stored in occurs_on: null for a single-date event. */
  key: string | null
}

const slotId = (postId: string, key: string | null) => `${postId}:${key ?? ''}`

export default function Absent() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [posts, setPosts] = useState<Post[]>([])
  const [absences, setAbsences] = useState<EventAbsence[]>([])
  const [mySignups, setMySignups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('absent')
  const [arrives, setArrives] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    const [postsRes, absRes, signRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*')
        .eq('published', true)
        .in('category', ['event', 'meeting'])
        .order('starts_at', { ascending: true }),
      // Only your own, even for officers — this page is the member's side.
      supabase.from('event_absences').select('*').eq('user_id', profile.id),
      supabase.from('event_signups').select('post_id, occurs_on').eq('user_id', profile.id),
    ])
    if (postsRes.error || absRes.error) setError((postsRes.error ?? absRes.error)!.message)
    setPosts((postsRes.data as Post[]) ?? [])
    setAbsences((absRes.data as EventAbsence[]) ?? [])
    setMySignups(
      new Set(
        ((signRes.data as { post_id: string; occurs_on: string | null }[]) ?? []).map((s) =>
          slotId(s.post_id, s.occurs_on),
        ),
      ),
    )
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  // Every date still to come, soonest first. Undated events are left out:
  // there's no "when" to miss yet.
  const slots = useMemo<Slot[]>(() => {
    const out: Slot[] = []
    for (const post of posts) {
      for (const at of occurrences(post)) {
        if (occurrenceEnded(post, at)) continue
        const key = signupKey(post, at)
        out.push({ id: slotId(post.id, key), post, at, key })
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime())
  }, [posts])

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots])

  const mine = useMemo(() => {
    const m = new Map<string, EventAbsence>()
    for (const a of absences) if (a.user_id === profile?.id) m.set(slotId(a.post_id, a.occurs_on), a)
    return m
  }, [absences, profile?.id])

  // ?event=<slug>[&date=YYYY-MM-DD] preselects that event (that date, or
  // its next one) — for the links on event pages and calendar cards.
  useEffect(() => {
    const slug = params.get('event')
    if (!slug || selected || slots.length === 0) return
    const date = params.get('date')
    const ofEvent = slots.filter((s) => s.post.slug === slug)
    const first = ofEvent.find((s) => s.key === date) ?? ofEvent[0]
    if (first) pick(first.id)
    // pick reads `mine`, which is ready whenever slots are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, slots])

  function pick(id: string) {
    setSelected(id)
    setDone(null)
    setError(null)
    const existing = mine.get(id)
    setKind(existing?.kind ?? 'absent')
    setArrives(existing?.arrives ?? '')
    setReason(existing?.reason ?? '')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const slot = selected ? slotById.get(selected) : null
    if (!slot || !profile) return
    setSaving(true)
    setError(null)

    const row = {
      post_id: slot.post.id,
      user_id: profile.id,
      occurs_on: slot.key,
      kind,
      arrives: kind === 'late' ? arrives.trim() || null : null,
      reason: reason.trim() || null,
    }
    const existing = mine.get(slot.id)
    // The unique index is on an expression, which PostgREST can't upsert
    // against — so update the row we already know about, or insert.
    const res = existing
      ? await supabase.from('event_absences').update(row).eq('id', existing.id)
      : await supabase.from('event_absences').insert(row)

    if (res.error) {
      setError(res.error.message)
      setSaving(false)
      return
    }

    // Can't go but still on the sign-up list would hold a spot someone
    // else could use, and tell officers to expect them.
    let unsigned = false
    if (kind === 'absent' && mySignups.has(slot.id)) {
      const { error: rmErr } = await removeSignup(slot.post.id, profile.id, slot.key)
      unsigned = !rmErr
    }

    setDone(
      `${kind === 'absent' ? 'Got it — officers know you can’t make' : 'Got it — officers know you’ll be late to'} ${slot.post.title}.` +
        (unsigned ? ' You’ve been taken off the sign-up list for that date.' : ''),
    )
    setSaving(false)
    setSelected(null)
    if (params.has('event')) setParams({}, { replace: true })
    await load()
  }

  async function withdraw(a: EventAbsence) {
    const { error: err } = await supabase.from('event_absences').delete().eq('id', a.id)
    if (err) setError(err.message)
    else {
      if (selected === slotId(a.post_id, a.occurs_on)) setSelected(null)
      await load()
    }
  }

  if (loading) return <Spinner />

  const current = selected ? slotById.get(selected) : null
  const myUpcoming = [...mine.entries()]
    .filter(([id]) => slotById.has(id))
    .sort(([a], [b]) => slotById.get(a)!.at.getTime() - slotById.get(b)!.at.getTime())
  return (
    <div className="rise">
      <PageHeader
        eyebrow="Attendance"
        title="Can’t make it?"
        subtitle="Let the officers know ahead of time if you’ll miss an event or meeting, or show up late."
      />

      {done && (
        <div className="mb-6">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {slots.length === 0 ? (
        <EmptyState icon="📅" title="Nothing coming up">
          There are no upcoming events or meetings on the calendar.
        </EmptyState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section>
            <p className="label">1 · Pick the event</p>
            <ul className="card divide-y divide-[var(--line)] overflow-hidden" role="radiogroup" aria-label="Upcoming events">
              {slots.map((s) => {
                const on = s.id === selected
                const notice = mine.get(s.id)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pick(s.id)}
                      className={`flex w-full items-center gap-4 px-4 py-3 text-left transition ${
                        on ? 'bg-navy-50 dark:bg-navy-800/60' : 'hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <DateChip at={s.at} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{s.post.title}</span>
                        <span className="block truncate text-sm muted">
                          {formatOccurrence(s.at, s.post.all_day)}
                          {s.post.location ? ` · ${s.post.location}` : ''}
                        </span>
                      </span>
                      {notice && (
                        <span className="tag shrink-0 bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-200">
                          {notice.kind === 'absent' ? 'Out' : 'Late'}
                        </span>
                      )}
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                          on ? 'border-navy-600 dark:border-gold-300' : 'border-[var(--line-strong)]'
                        }`}
                        aria-hidden
                      >
                        {on && <span className="size-2.5 rounded-full bg-navy-600 dark:bg-gold-300" />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="label">2 · Tell us what’s up</p>
            {current ? (
              <form onSubmit={submit} className="card space-y-5 p-5">
                <div>
                  <p className="font-semibold">{current.post.title}</p>
                  <p className="text-sm muted">{formatOccurrence(current.at, current.post.all_day)}</p>
                </div>

                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What’s happening">
                  {(['absent', 'late'] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                        kind === k
                          ? 'border-navy-600 bg-navy-600 text-white dark:border-gold-300 dark:bg-gold-300 dark:text-navy-900'
                          : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                      }`}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>

                {kind === 'late' && (
                  <div>
                    <label className="label" htmlFor="arrives">Getting there around</label>
                    <input
                      id="arrives"
                      className="field"
                      maxLength={60}
                      value={arrives}
                      onChange={(e) => setArrives(e.target.value)}
                      placeholder="4:15, after practice…"
                    />
                  </div>
                )}

                <div>
                  <label className="label" htmlFor="reason">
                    Reason <span className="normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="reason"
                    rows={3}
                    maxLength={500}
                    className="field resize-y"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Only officers see this."
                  />
                </div>

                {current.at.getTime() - Date.now() < ADVANCE_HOURS * 36e5 &&
                  mine.get(current.id)?.kind !== kind && (
                    <p className="text-xs text-red-700 dark:text-red-300">
                      This is less than {ADVANCE_HOURS} hours away, so officers will see it as short notice.
                    </p>
                  )}

                {kind === 'absent' && mySignups.has(current.id) && (
                  <p className="text-xs muted">You’re signed up for this — sending will take you off the list.</p>
                )}

                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
                    {saving ? 'Sending…' : mine.has(current.id) ? 'Update' : 'Let them know'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="card p-5 text-sm muted">Choose an event or meeting from the list.</div>
            )}

            {myUpcoming.length > 0 && (
              <div className="mt-8">
                <p className="label">Already sent</p>
                <ul className="card divide-y divide-[var(--line)]">
                  {myUpcoming.map(([id, a]) => {
                    const s = slotById.get(id)!
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{s.post.title}</span>
                          <span className="block truncate muted">
                            {formatOccurrence(s.at, s.post.all_day)} · {KIND_LABEL[a.kind]}
                            {a.arrives ? ` (${a.arrives})` : ''}
                          </span>
                          <span className="block truncate text-xs faint">{sentLine(s.post, a)}</span>
                        </span>
                        <button type="button" className="text-xs font-semibold muted hover:text-[var(--ink)]" onClick={() => pick(id)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-600 hover:underline dark:text-red-300"
                          onClick={() => void withdraw(a)}
                        >
                          Undo
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function DateChip({ at }: { at: Date }) {
  const today = dayKey(new Date()) === dayKey(at)
  return (
    <span
      className={`grid w-12 shrink-0 place-items-center rounded-xl border py-1.5 leading-none ${
        today ? 'border-gold-400 bg-gold-100 dark:bg-gold-500/20' : 'border-[var(--line)]'
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider muted">
        {at.toLocaleDateString(undefined, { month: 'short' })}
      </span>
      <span className="display num mt-0.5 text-xl">{at.getDate()}</span>
    </span>
  )
}
