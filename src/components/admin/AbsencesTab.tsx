import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { EventAbsence, Post } from '../../lib/types'
import { formatOccurrence, occurrenceEnded } from '../../lib/format'
import { inAdvance, loadAbsences, startOf } from '../../lib/absence'
import AbsenceList from '../AbsenceList'
import { EmptyState, Notice, Spinner } from '../ui'

type Group = { id: string; post: Post; at: Date | null; rows: EventAbsence[] }

/**
 * Every "can't make it" / "running late" notice, grouped by event date.
 * Upcoming is what officers plan around; Past is the record of who gave
 * notice and how early.
 */
export default function AbsencesTab() {
  const [posts, setPosts] = useState<Map<string, Post>>(new Map())
  const [absences, setAbsences] = useState<EventAbsence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadAbsences(),
      supabase.from('posts').select('*').in('category', ['event', 'meeting']),
    ]).then(([abs, postsRes]) => {
      if (cancelled) return
      if (abs.error || postsRes.error) setError((abs.error ?? postsRes.error)!.message)
      setAbsences(abs.rows)
      setPosts(new Map(((postsRes.data as Post[]) ?? []).map((p) => [p.id, p])))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => {
    const byId = new Map<string, Group>()
    for (const a of absences) {
      const post = posts.get(a.post_id)
      if (!post) continue
      const id = `${a.post_id}:${a.occurs_on ?? ''}`
      let g = byId.get(id)
      if (!g) {
        g = { id, post, at: startOf(post, a.occurs_on), rows: [] }
        byId.set(id, g)
      }
      g.rows.push(a)
    }
    const all = [...byId.values()]
    // Undated events count as upcoming: they haven't happened yet.
    const past = (g: Group) => (g.at ? occurrenceEnded(g.post, g.at) : false)
    const t = (g: Group) => g.at?.getTime() ?? Infinity
    return when === 'upcoming'
      ? all.filter((g) => !past(g)).sort((a, b) => t(a) - t(b))
      : all.filter(past).sort((a, b) => t(b) - t(a))
  }, [absences, posts, when])

  if (loading) return <Spinner />

  return (
    <div>
      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="mb-5 kc-seg" role="tablist" aria-label="Which notices">
        {(['upcoming', 'past'] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={when === w}
            className={when === w ? 'is-on' : ''}
            onClick={() => setWhen(w)}
          >
            {w === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon="🙌" title={when === 'upcoming' ? 'Everyone’s coming' : 'No past notices'}>
          {when === 'upcoming'
            ? 'Nobody has said they’ll miss or be late to anything coming up.'
            : 'Notices for events that already happened will show up here.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const out = g.rows.filter((r) => r.kind === 'absent').length
            const late = g.rows.length - out
            const short = g.rows.filter((r) => inAdvance(g.post, r) === false).length
            return (
              <li key={g.id} className="card p-5">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/post/${g.post.slug}`} className="font-semibold hover:underline">
                      {g.post.title}
                    </Link>
                    <p className="text-sm muted">
                      {g.at ? formatOccurrence(g.at, g.post.all_day) : 'Date not set'}
                    </p>
                  </div>
                  <p className="text-xs muted">
                    {out > 0 && `${out} out`}
                    {out > 0 && late > 0 && ' · '}
                    {late > 0 && `${late} late`}
                    {short > 0 && ` · ${short} short notice`}
                  </p>
                </div>
                <AbsenceList post={g.post} rows={g.rows} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
