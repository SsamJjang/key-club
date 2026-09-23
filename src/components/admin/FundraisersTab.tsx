import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { FundraiserEntry, MemberFundraisers, Post, Profile } from '../../lib/types'
import { dayKey, formatDate, occurrences } from '../../lib/format'
import { Avatar, EmptyState, Notice, Spinner } from '../ui'

/**
 * Officers record who took part in a fundraiser. Every member needs at least
 * one per semester; the standing list shows who still does.
 */
export default function FundraisersTab() {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [events, setEvents] = useState<Post[]>([])
  const [recent, setRecent] = useState<FundraiserEntry[]>([])
  const [standing, setStanding] = useState<Map<string, MemberFundraisers>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({
    activity: '',
    participated_on: new Date().toISOString().slice(0, 10),
    note: '',
    post_id: '',
  })

  const load = useCallback(async () => {
    const [profileRes, eventRes, recentRes, standingRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase
        .from('posts')
        .select('*')
        .eq('category', 'event')
        .order('starts_at', { ascending: false })
        .limit(50),
      supabase
        .from('fundraiser_log')
        .select('*, profile:profiles!user_id(id, full_name, avatar_url, grade)')
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('member_fundraisers').select('*'),
    ])
    setProfiles((profileRes.data as Profile[]) ?? [])
    setEvents((eventRes.data as Post[]) ?? [])
    setRecent((recentRes.data as FundraiserEntry[]) ?? [])
    setStanding(
      new Map(((standingRes.data as MemberFundraisers[]) ?? []).map((s) => [s.user_id, s])),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Picking an event fills the activity and date, and selects its sign-ups.
  async function pickEvent(postId: string) {
    setForm((f) => ({ ...f, post_id: postId }))
    if (!postId) return
    const event = events.find((e) => e.id === postId)
    if (!event) return

    const { data } = await supabase.from('event_signups').select('user_id').eq('post_id', postId)
    setSelected(new Set(((data as { user_id: string }[]) ?? []).map((r) => r.user_id)))

    const all = occurrences(event)
    const past = all.filter((d) => d.getTime() <= Date.now())
    const on = past[past.length - 1] ?? all[0] ?? null
    setForm((f) => ({
      ...f,
      post_id: postId,
      activity: f.activity || event.title,
      participated_on: on ? dayKey(on) : f.participated_on,
    }))
  }

  async function record(e: React.FormEvent) {
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
      activity: form.activity.trim(),
      participated_on: form.participated_on,
      note: form.note.trim() || null,
      created_by: profile?.id ?? null,
    }))

    const { error } = await supabase.from('fundraiser_log').insert(rows)

    if (error) setMsg({ tone: 'error', text: error.message })
    else {
      setMsg({
        tone: 'success',
        text: `Recorded “${form.activity.trim()}” for ${rows.length} member${rows.length === 1 ? '' : 's'}.`,
      })
      setSelected(new Set())
      setForm({ activity: '', participated_on: form.participated_on, note: '', post_id: '' })
      await load()
    }
    setSaving(false)
  }

  async function remove(entry: FundraiserEntry) {
    if (!window.confirm(`Remove “${entry.activity}” for ${entry.profile?.full_name}?`)) return
    await supabase.from('fundraiser_log').delete().eq('id', entry.id)
    await load()
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return profiles.filter(
      (p) =>
        (!q || p.full_name.toLowerCase().includes(q)) &&
        (!onlyOutstanding || !standing.get(p.id)?.requirement_met),
    )
  }, [profiles, query, onlyOutstanding, standing])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <Spinner />

  const semester = standing.values().next().value?.semester ?? 'This semester'
  const outstanding = profiles.filter((p) => !standing.get(p.id)?.requirement_met)

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <form onSubmit={record} className="card h-fit space-y-4 p-6">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Record a fundraiser
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
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Activity</label>
            <input
              required
              className="field"
              value={form.activity}
              onChange={(e) => setForm({ ...form, activity: e.target.value })}
              placeholder="Bake sale"
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              required
              className="field"
              value={form.participated_on}
              onChange={(e) => setForm({ ...form, participated_on: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Note (optional)</label>
          <input
            className="field"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Ran the drinks table."
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
          <label className="mt-2 flex items-center gap-2 text-xs muted">
            <input
              type="checkbox"
              className="size-3.5"
              checked={onlyOutstanding}
              onChange={(e) => setOnlyOutstanding(e.target.checked)}
            />
            Only members who still need one for {semester}
          </label>

          <ul className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--line)]">
            {visible.map((p) => {
              const met = standing.get(p.id)?.requirement_met
              return (
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
                    {met && (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        ✓ done
                      </span>
                    )}
                    <span className="text-xs muted">{p.grade ?? ''}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={saving}>
          {saving
            ? 'Recording…'
            : `Record for ${selected.size} member${selected.size === 1 ? '' : 's'}`}
        </button>
      </form>

      <div className="space-y-8">
        <section>
          <h3 className="mb-1 font-[family-name:var(--font-display)] text-lg font-semibold">
            Still needed · {semester}
          </h3>
          <p className="mb-4 text-sm muted">
            {profiles.length - outstanding.length} of {profiles.length} signed-in members have met
            the requirement. Members who have never signed in aren’t listed here.
          </p>
          {outstanding.length === 0 ? (
            <Notice tone="success">Everyone has done a fundraiser this semester.</Notice>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {outstanding.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-1 pr-3 text-sm"
                >
                  <Avatar name={p.full_name} url={p.avatar_url} size={22} />
                  {p.full_name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold">
            Recently recorded
          </h3>
          {recent.length === 0 ? (
            <EmptyState icon="🎟️" title="No fundraisers recorded yet" />
          ) : (
            <ul className="space-y-2">
              {recent.map((f) => (
                <li key={f.id} className="card flex items-center gap-3 p-4">
                  <Avatar name={f.profile?.full_name ?? '?'} url={f.profile?.avatar_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.profile?.full_name}</p>
                    <p className="truncate text-xs muted">
                      {f.activity} · {formatDate(f.participated_on)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger py-1 text-xs"
                    onClick={() => void remove(f)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
