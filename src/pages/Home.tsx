import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Post } from '../lib/types'
import { formatDateTime, gradeLabel } from '../lib/format'
import PostCard from '../components/PostCard'
import { CategoryBadge, EmptyState, Notice, Spinner, Stat } from '../components/ui'

const POST_SELECT = '*, author:profiles!author_id(id, full_name, avatar_url, title)'

export default function Home() {
  const { profile, isAdmin } = useAuth()
  const [pinned, setPinned] = useState<Post | null>(null)
  const [news, setNews] = useState<Post[]>([])
  const [events, setEvents] = useState<Post[]>([])
  const [stats, setStats] = useState({ members: 0, hours: 0, signups: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const nowIso = new Date().toISOString()

      const [pinnedRes, newsRes, eventsRes, membersRes, hoursRes, signupRes] = await Promise.all([
        supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('published', true)
          .eq('pinned', true)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('published', true)
          .in('category', ['news', 'notice'])
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('published', true)
          .eq('category', 'event')
          .gte('starts_at', nowIso)
          .order('starts_at', { ascending: true })
          .limit(3),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('member_hours').select('approved_hours'),
        profile
          ? supabase
              .from('event_signups')
              .select('post_id', { count: 'exact', head: true })
              .eq('user_id', profile.id)
          : Promise.resolve({ count: 0, error: null }),
      ])

      if (cancelled) return

      const firstError = [pinnedRes, newsRes, eventsRes].find((r) => r.error)?.error
      if (firstError) setError(firstError.message)

      setPinned((pinnedRes.data?.[0] as Post) ?? null)
      setNews((newsRes.data as Post[]) ?? [])
      setEvents((eventsRes.data as Post[]) ?? [])
      setStats({
        members: membersRes.count ?? 0,
        hours:
          (hoursRes.data as { approved_hours: number }[] | null)?.reduce(
            (sum, row) => sum + Number(row.approved_hours ?? 0),
            0,
          ) ?? 0,
        signups: signupRes.count ?? 0,
      })
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  if (loading) return <Spinner label="Loading the club" />

  const firstName = profile?.full_name.split(' ')[0] ?? 'there'
  const standing =
    profile?.title ??
    [
      gradeLabel(profile?.grade),
      profile?.graduation_year ? `Class of ${profile.graduation_year}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="rise space-y-12">
      {error && <Notice tone="error">{error}</Notice>}

      {/* Greeting */}
      <section className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-500 dark:text-gold-300">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight sm:text-5xl">
            Hey, {firstName}.
          </h1>
          <p className="mt-2 text-sm muted">{standing || 'Welcome back'}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:w-auto">
          <Stat value={stats.members} label="Members" />
          <Stat value={stats.hours.toFixed(0)} label="Club hours" />
          <Stat value={stats.signups} label="Your RSVPs" />
        </div>
      </section>

      {/* Pinned */}
      {pinned && (
        <section>
          <Link
            to={`/post/${pinned.slug}`}
            className="card group block overflow-hidden border-gold-300 transition hover:border-gold-400 dark:border-gold-600/50"
          >
            <div className="grid md:grid-cols-[1.4fr_1fr]">
              <div className="p-7">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gold-500 dark:text-gold-300">
                    📌 Pinned
                  </span>
                  <CategoryBadge category={pinned.category} />
                </div>
                <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
                  {pinned.title}
                </h2>
                {pinned.summary && <p className="mt-3 text-sm muted">{pinned.summary}</p>}
                {pinned.starts_at && (
                  <p className="mt-4 text-sm font-medium text-navy-600 dark:text-navy-200">
                    🗓️ {formatDateTime(pinned.starts_at)}
                  </p>
                )}
                <span className="mt-6 inline-block text-sm font-semibold text-navy-600 group-hover:underline dark:text-navy-200">
                  Read more →
                </span>
              </div>
              {pinned.cover_url && (
                <img
                  src={pinned.cover_url}
                  alt=""
                  className="h-full max-h-64 w-full object-cover md:max-h-none"
                />
              )}
            </div>
          </Link>
        </section>
      )}

      {/* Upcoming events */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
            Coming up
          </h2>
          <Link to="/events" className="text-sm font-semibold text-navy-600 hover:underline dark:text-navy-200">
            All events →
          </Link>
        </div>

        {events.length === 0 ? (
          <EmptyState icon="🗓️" title="Nothing on the calendar yet">
            {isAdmin
              ? 'Post an event from the admin page and it will show up here.'
              : 'Check back soon — officers post events as they get scheduled.'}
          </EmptyState>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <PostCard key={e.id} post={e} />
            ))}
          </div>
        )}
      </section>

      {/* Latest news */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
            Latest news
          </h2>
          <Link to="/news" className="text-sm font-semibold text-navy-600 hover:underline dark:text-navy-200">
            All news →
          </Link>
        </div>

        {news.length === 0 ? (
          <EmptyState icon="📰" title="No articles yet" />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {news.map((n) => (
              <PostCard key={n.id} post={n} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
