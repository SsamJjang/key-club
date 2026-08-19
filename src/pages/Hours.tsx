import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { HoursEntry, HoursStatus, Post } from '../lib/types'
import { formatDate } from '../lib/format'
import { EmptyState, Notice, PageHeader, Spinner, Stat } from '../components/ui'

const STATUS_STYLE: Record<HoursStatus, string> = {
  pending: 'bg-gold-100 text-gold-600 dark:bg-gold-600/25 dark:text-gold-200',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200',
}

export default function Hours() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<HoursEntry[]>([])
  const [events, setEvents] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({
    hours: '',
    description: '',
    served_on: new Date().toISOString().slice(0, 10),
    post_id: '',
  })

  const load = useCallback(async () => {
    if (!profile) return
    const [logRes, eventRes] = await Promise.all([
      supabase
        .from('hours_log')
        .select('*, post:posts!post_id(id, slug, title)')
        .eq('user_id', profile.id)
        .order('served_on', { ascending: false }),
      supabase
        .from('posts')
        .select('id, slug, title, starts_at')
        .eq('category', 'event')
        .eq('published', true)
        .order('starts_at', { ascending: false })
        .limit(50),
    ])
    setEntries((logRes.data as HoursEntry[]) ?? [])
    setEvents((eventRes.data as Post[]) ?? [])
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase.from('hours_log').insert({
      user_id: profile.id,
      post_id: form.post_id || null,
      hours: Number(form.hours),
      description: form.description.trim(),
      served_on: form.served_on,
      status: 'pending',
    })

    if (error) setMsg({ tone: 'error', text: error.message })
    else {
      setMsg({ tone: 'success', text: 'Submitted — an officer will review it.' })
      setForm({ hours: '', description: '', served_on: form.served_on, post_id: '' })
      await load()
    }
    setSaving(false)
  }

  async function withdraw(id: string) {
    await supabase.from('hours_log').delete().eq('id', id)
    await load()
  }

  const total = (status: HoursStatus) =>
    entries.filter((e) => e.status === status).reduce((s, e) => s + Number(e.hours), 0)

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Service"
        title="My hours"
        subtitle="Log what you served. An officer approves it, and the approved total shows on your profile."
      />

      <div className="mb-8 grid grid-cols-3 gap-3">
        <Stat value={total('approved').toFixed(1)} label="Approved" />
        <Stat value={total('pending').toFixed(1)} label="Pending" />
        <Stat value={entries.length} label="Entries" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <form onSubmit={submit} className="card h-fit space-y-4 p-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Log service hours
          </h2>

          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="hours">Hours</label>
              <input
                id="hours"
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
              <label className="label" htmlFor="served">Date served</label>
              <input
                id="served"
                type="date"
                required
                className="field"
                value={form.served_on}
                onChange={(e) => setForm({ ...form, served_on: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="event">Related event (optional)</label>
            <select
              id="event"
              className="field"
              value={form.post_id}
              onChange={(e) => setForm({ ...form, post_id: e.target.value })}
            >
              <option value="">Not tied to a club event</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="desc">What did you do?</label>
            <textarea
              id="desc"
              rows={4}
              required
              className="field resize-y"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Sorted donations at the food bank with the Saturday crew."
            />
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={saving}>
            {saving ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>

        <section>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-xl font-semibold">
            History
          </h2>
          {loading ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <EmptyState icon="⏱️" title="No hours logged yet">
              Submit your first entry with the form.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {entries.map((e) => (
                <li key={e.id} className="card p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-[family-name:var(--font-display)] text-xl font-semibold">
                      {Number(e.hours).toFixed(1)} hrs
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[e.status]}`}
                    >
                      {e.status}
                    </span>
                    <span className="ml-auto text-sm muted">{formatDate(e.served_on)}</span>
                  </div>
                  <p className="mt-2 text-sm">{e.description}</p>
                  {e.post && <p className="mt-1 text-xs muted">Event: {e.post.title}</p>}
                  {e.review_note && (
                    <p className="mt-2 text-xs italic muted">Officer note: {e.review_note}</p>
                  )}
                  {e.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => void withdraw(e.id)}
                      className="btn btn-danger mt-3 py-1 text-xs"
                    >
                      Withdraw
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
