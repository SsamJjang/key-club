import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { ClubSettings, HoursEntry } from '../lib/types'
import { formatDate } from '../lib/format'
import { EmptyState, Notice, PageHeader, Spinner, Stat } from '../components/ui'

/**
 * Read-only for members: officers enter hours, so there is nothing to submit
 * here. This is the record and the progress bar.
 */
export default function Hours() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<HoursEntry[]>([])
  const [settings, setSettings] = useState<ClubSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    Promise.all([
      supabase
        .from('hours_log')
        .select('*, post:posts!post_id(id, slug, title)')
        .eq('user_id', profile.id)
        .order('served_on', { ascending: false }),
      supabase.from('club_settings').select('*').single(),
    ]).then(([logRes, settingsRes]) => {
      if (cancelled) return
      setEntries((logRes.data as HoursEntry[]) ?? [])
      setSettings(settingsRes.data as ClubSettings | null)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [profile])

  if (loading) return <Spinner />

  const approved = entries
    .filter((e) => e.status === 'approved')
    .reduce((s, e) => s + Number(e.hours), 0)
  const goal = Number(settings?.hours_goal ?? 50)
  const pct = goal > 0 ? Math.min(100, Math.round((approved / goal) * 100)) : 0
  const remaining = Math.max(0, goal - approved)

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Service"
        title="My hours"
        subtitle="Every hour an officer has recorded for you this year."
      />

      <section className="card mb-8 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="font-[family-name:var(--font-display)] text-4xl font-semibold">
              {approved.toFixed(1)}
            </span>
            <span className="ml-2 text-lg muted">/ {goal} hours</span>
          </div>
          <span className="text-sm font-semibold text-navy-600 dark:text-navy-200">
            {pct}% complete
          </span>
        </div>

        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--surface)]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-all ${
              remaining === 0 ? 'bg-emerald-500' : 'bg-gold-400'
            }`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>

        <p className="mt-3 text-sm muted">
          {remaining === 0
            ? `You’ve hit the ${goal}-hour goal. Thank you for showing up. 🎉`
            : `${remaining.toFixed(1)} hour${remaining === 1 ? '' : 's'} to go.`}
        </p>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Stat value={entries.length} label="Entries" />
        <Stat value={goal} label="Yearly goal" />
      </div>

      <div className="mb-6">
        <Notice>
          Officers record hours after each event — there is nothing to submit here. If something
          looks wrong or missing, tell an officer within two weeks of the event.
        </Notice>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="⏱️" title="No hours recorded yet">
          Sign up for an event, show up, and an officer will log it here.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-[family-name:var(--font-display)] text-xl font-semibold">
                  {Number(e.hours).toFixed(1)} hrs
                </span>
                {e.status !== 'approved' && (
                  <span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-600 dark:bg-gold-600/25 dark:text-gold-200">
                    {e.status}
                  </span>
                )}
                <span className="ml-auto text-sm muted">{formatDate(e.served_on)}</span>
              </div>
              <p className="mt-2 text-sm">{e.description}</p>
              {e.post && <p className="mt-1 text-xs muted">Event: {e.post.title}</p>}
              {e.review_note && (
                <p className="mt-2 text-xs italic muted">Officer note: {e.review_note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
