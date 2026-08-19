import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { BoardPosition, MemberHours, Post, Profile } from '../lib/types'
import { formatDate, formatPhone, gradeLabel } from '../lib/format'
import { Avatar, BoardBadge, EmptyState, RoleBadge, Spinner, Stat } from '../components/ui'

export default function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [hours, setHours] = useState<MemberHours | null>(null)
  const [events, setEvents] = useState<Post[]>([])
  const [board, setBoard] = useState<BoardPosition | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!id) return

    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('member_hours').select('*').eq('user_id', id).maybeSingle(),
      supabase.from('event_signups').select('post:posts!post_id(*)').eq('user_id', id),
      supabase.from('board_positions').select('*'),
    ]).then(([p, h, s, b]) => {
      if (cancelled) return
      const found = p.data as Profile | null
      setProfile(found)
      setBoard(
        ((b.data as BoardPosition[]) ?? []).find((x) => x.id === found?.board_position) ?? null,
      )
      setHours(h.data as MemberHours | null)
      setEvents(
        ((s.data as { post: Post | null }[] | null) ?? [])
          .map((row) => row.post)
          .filter((post): post is Post => Boolean(post))
          .sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? '')),
      )
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <Spinner />
  if (!profile) return <EmptyState icon="🕳️" title="No such member" />

  return (
    <div className="rise mx-auto max-w-3xl">
      <Link to="/directory" className="text-sm font-semibold muted hover:underline">
        ← Back to members
      </Link>

      <header className="mt-6 flex flex-wrap items-center gap-5">
        <Avatar name={profile.full_name} url={profile.avatar_url} size={88} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              {profile.full_name}
            </h1>
            <BoardBadge label={board?.label} />
            <RoleBadge role={profile.role} />
          </div>
          <p className="mt-1 text-sm muted">
            {[
              profile.title,
              gradeLabel(profile.grade),
              profile.graduation_year ? `Class of ${profile.graduation_year}` : null,
              profile.pronouns,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      {profile.bio && <p className="mt-6 text-sm leading-relaxed">{profile.bio}</p>}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={Number(hours?.approved_hours ?? 0).toFixed(1)} label="Hours served" />
        <Stat value={events.length} label="Events joined" />
        <Stat value={gradeLabel(profile.grade) ?? '—'} label="Grade" />
        <Stat value={profile.graduation_year ?? '—'} label="Grad year" />
      </div>

      <section className="card mt-8 p-6">
        <h2 className="label">Contact</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 muted">Email</dt>
            <dd>
              <a href={`mailto:${profile.email}`} className="hover:underline">
                {profile.email}
              </a>
            </dd>
          </div>
          {profile.phone && (
            <div className="flex gap-3">
              <dt className="w-20 muted">Phone</dt>
              <dd>
                <a href={`tel:${profile.phone}`} className="hover:underline">
                  {formatPhone(profile.phone)}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl font-semibold">
          Events attended
        </h2>
        {events.length === 0 ? (
          <EmptyState icon="🗓️" title="No events yet" />
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/post/${e.slug}`}
                  className="card flex items-center justify-between gap-4 px-5 py-3 text-sm transition hover:border-navy-300"
                >
                  <span className="font-medium">{e.title}</span>
                  <span className="muted">{formatDate(e.starts_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
