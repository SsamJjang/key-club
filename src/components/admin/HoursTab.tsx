import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { HoursEntry, Post, Profile } from '../../lib/types'
import { dayKey, formatDate, isRecurring, occurrences } from '../../lib/format'
import type { SignupRow } from '../../lib/rsvp'
import { Avatar, EmptyState, Notice, Spinner } from '../ui'

/**
 * Officers enter hours on members' behalf — members cannot submit their own.
 * Awarding for an event pre-selects everyone who signed up.
 */
export default function HoursTab() {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [events, setEvents] = useState<Post[]>([])
  const [recent, setRecent] = useState<HoursEntry[]>([])
  const [eventSignups, setEventSignups] = useState<SignupRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({
    hours: '',
    description: '',
    served_on: new Date().toISOString().slice(0, 10),
    post_id: '',
  })

  const load = useCallback(async () => {
    const [profileRes, eventRes, recentRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase
        .from('posts')
        .select('*')
        .eq('category', 'event')
        .order('starts_at', { ascending: false })
        .limit(50),
      supabase
        .from('hours_log')
        .select('*, profile:profiles!user_id(id, full_name, avatar_url, grade)')
        .order('created_at', { ascending: false })
        .limit(25),
    ])
    setProfiles((profileRes.data as Profile[]) ?? [])
    setEvents((eventRes.data as Post[]) ?? [])
    setRecent((recentRes.data as HoursEntry[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Picking an event pre-fills its hours, description, date, and attendees.
  async function pickEvent(postId: string) {
    setForm((f) => ({ ...f, post_id: postId }))
    setEventSignups([])
    if (!postId) return

    const event = events.find((e) => e.id === postId)
    if (!event) return

    const { data } = await supabase
      .from('event_signups')
      .select('user_id, occurs_on')
      .eq('post_id', postId)
    const rows = (data as SignupRow[]) ?? []
    setEventSignups(rows)

    // For a series, default to the most recent date that has already
    // happened — that is the session being logged. An event whose hours are
    // still TBD has no number to prefill, so whatever is typed stays.
    const all = occurrences(event)
    const past = all.filter((d) => d.getTime() <= Date.now())
    const served = past[past.length - 1] ?? all[0] ?? null
    const servedKey = served ? dayKey(served) : form.served_on

    setSelected(new Set(attendeesFor(event, rows, servedKey)))
    setForm((f) => ({
      ...f,
      post_id: postId,
      hours: event.service_hours != null ? String(event.service_hours) : f.hours,
      description: f.description || event.title,
      served_on: servedKey,
    }))
  }

  /**
   * Who signed up for the date being logged. A one-date event has no date on
   * its sign-ups, so everyone counts; a series narrows to that day's list.
   */
  function attendeesFor(event: Post, rows: SignupRow[], servedOn: string) {
    const forDate = isRecurring(event) ? rows.filter((r) => r.occurs_on === servedOn) : rows
    return forDate.map((r) => r.user_id)
  }

  /** Re-apply the sign-up list after the officer changes the date by hand. */
  function reselectForDate() {
    const event = events.find((e) => e.id === form.post_id)
    if (!event) return
    setSelected(new Set(attendeesFor(event, eventSignups, form.served_on)))
  }

  const pickedEvent = events.find((e) => e.id === form.post_id) ?? null
  const dateAttendees = pickedEvent
    ? attendeesFor(pickedEvent, eventSignups, form.served_on).length
    : 0

  async function award(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0) {
      setMsg({ tone: 'error', text: 'Pick at least one member.' })
      return
    }
    setSaving(true)
    setMsg(null)

    const rows = [...selected].map((userId) => ({
      user_id: userId,
      post_id: form.post_id || null,
      hours: Number(form.hours),
      description: form.description.trim(),
      served_on: form.served_on,
      status: 'approved',
      created_by: profile?.id ?? null,
      reviewed_by: profile?.id ?? null,
      reviewed_at: new Date().toISOString(),
    }))

    const { error } = await supabase.from('hours_log').insert(rows)

    if (error) setMsg({ tone: 'error', text: error.message })
    else {
      setMsg({
        tone: 'success',
        text: `Logged ${form.hours} hrs for ${rows.length} member${rows.length === 1 ? '' : 's'}.`,
      })
      setSelected(new Set())
      setForm({ hours: '', description: '', served_on: form.served_on, post_id: '' })
      await load()
    }
    setSaving(false)
  }

  async function remove(entry: HoursEntry) {
    if (!window.confirm(`Delete ${entry.hours} hrs for ${entry.profile?.full_name}?`)) return
    await supabase.from('hours_log').delete().eq('id', entry.id)
    await load()
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return profiles.filter((p) => !q || p.full_name.toLowerCase().includes(q))
  }, [profiles, query])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <Spinner />

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <form onSubmit={award} className="card h-fit space-y-4 p-6">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Log hours for members
        </h3>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <div>
          <label className="label">Event (optional — fills everything in)</label>
          <select
            className="field"
            value={form.post_id}
            onChange={(e) => void pickEvent(e.target.value)}
          >
            <option value="">Not tied to a club event</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
                {ev.recurrence_note
                  ? ` — ${ev.recurrence_note}`
                  : ev.starts_at
                    ? ` — ${formatDate(ev.starts_at)}`
                    : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs muted">
            {pickedEvent && isRecurring(pickedEvent)
              ? 'This event repeats — the members below are the ones who signed up for the date served.'
              : 'Choosing an event selects everyone who signed up for it.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Hours each</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="24"
              required
              className="field"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Date served</label>
            <input
              type="date"
              required
              className="field"
              value={form.served_on}
              onChange={(e) => setForm({ ...form, served_on: e.target.value })}
            />
          </div>
        </div>

        {/* Changing the date by hand does not silently rewrite a selection the
            officer may have already adjusted — it offers instead. */}
        {pickedEvent && isRecurring(pickedEvent) && (
          <button
            type="button"
            onClick={reselectForDate}
            className="btn btn-ghost w-full py-1.5 text-xs"
          >
            Select the {dateAttendees} member{dateAttendees === 1 ? '' : 's'} signed up for{' '}
            {formatDate(form.served_on)}
          </button>
        )}

        <div>
          <label className="label">What they did</label>
          <textarea
            rows={3}
            required
            className="field resize-y"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Sorted donations at the food bank."
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="label mb-0">Members ({selected.size} selected)</span>
            <div className="flex gap-3 text-xs font-semibold">
              <button
                type="button"
                className="text-navy-600 hover:underline dark:text-navy-200"
                onClick={() => setSelected(new Set(visible.map((p) => p.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-navy-600 hover:underline dark:text-navy-200"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>

          <input
            type="search"
            className="field mt-2"
            placeholder="Filter members…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <ul className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--line)]">
            {visible.map((p) => (
              <li key={p.id} className="border-b border-[var(--line)] last:border-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <Avatar name={p.full_name} url={p.avatar_url} size={26} />
                  <span className="flex-1 truncate">{p.full_name}</span>
                  <span className="text-xs muted">{p.grade ?? ''}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={saving}>
          {saving ? 'Logging…' : `Log hours for ${selected.size} member${selected.size === 1 ? '' : 's'}`}
        </button>
      </form>

      <section>
        <h3 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold">
          Recently logged
        </h3>
        {recent.length === 0 ? (
          <EmptyState icon="⏱️" title="No hours logged yet" />
        ) : (
          <ul className="space-y-2">
            {recent.map((h) => (
              <li key={h.id} className="card flex items-center gap-3 p-4">
                <Avatar name={h.profile?.full_name ?? '?'} url={h.profile?.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.profile?.full_name}</p>
                  <p className="truncate text-xs muted">
                    {Number(h.hours).toFixed(1)} hrs · {formatDate(h.served_on)} · {h.description}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger py-1 text-xs"
                  onClick={() => void remove(h)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
