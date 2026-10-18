import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Post } from '../lib/types'
import { dayKey, formatDateTime, formatServiceHours, gradeLabel, isRecurring, nextOccurrence } from '../lib/format'
import { colorOf } from '../lib/eventColors'
import PostCard from '../components/PostCard'
import CoverImage from '../components/CoverImage'
import Logo from '../components/Logo'
import { CategoryBadge, EmptyState, Notice, SectionTitle, Spinner } from '../components/ui'

const POST_SELECT = '*, author:profiles!author_id(id, full_name, avatar_url, title)'

type Signup = { post_id: string; user_id: string; occurs_on: string | null }
type Upcoming = { post: Post; at: Date; going: number; mine: boolean; spotsLeft: number | null }

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { profile, isAdmin } = useAuth()
  const [pinned, setPinned] = useState<Post | null>(null)
  const [news, setNews] = useState<Post[]>([])
  const [events, setEvents] = useState<Post[]>([])
  const [signups, setSignups] = useState<Signup[]>([])
  const [club, setClub] = useState({ members: 0, hours: 0 })
  const [mine, setMine] = useState({ hours: 0, goal: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [pinnedRes, newsRes, eventsRes, signupRes, membersRes, hoursRes, settingsRes] = await Promise.all([
        supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('published', true)
          .eq('pinned', true)
          .neq('category', 'meeting')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('published', true)
          .in('category', ['news', 'notice'])
          .order('created_at', { ascending: false })
          .limit(4),
        // Every event, not just ones starting after now: a weekly series that
        // began last month still has dates coming up.
        supabase.from('posts').select(POST_SELECT).eq('published', true).eq('category', 'event'),
        supabase.from('event_signups').select('post_id, user_id, occurs_on'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('member_hours').select('user_id, approved_hours'),
        supabase.from('club_settings').select('hours_goal').maybeSingle(),
      ])

      if (cancelled) return

      const firstError = [pinnedRes, newsRes, eventsRes].find((r) => r.error)?.error
      if (firstError) setError(firstError.message)

      const hours = (hoursRes.data as { user_id: string; approved_hours: number }[] | null) ?? []
      setPinned((pinnedRes.data?.[0] as Post) ?? null)
      setNews((newsRes.data as Post[]) ?? [])
      setEvents((eventsRes.data as Post[]) ?? [])
      setSignups((signupRes.data as Signup[]) ?? [])
      setClub({
        members: membersRes.count ?? 0,
        hours: hours.reduce((sum, row) => sum + Number(row.approved_hours ?? 0), 0),
      })
      setMine({
        hours: Number(hours.find((r) => r.user_id === profile?.id)?.approved_hours ?? 0),
        goal: Number((settingsRes.data as { hours_goal: number } | null)?.hours_goal ?? 0),
      })
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  // Each upcoming event at its next date, with that date's sign-ups.
  const upcoming = useMemo<Upcoming[]>(
    () =>
      events
        .map((post) => ({ post, at: nextOccurrence(post) }))
        .filter((x): x is { post: Post; at: Date } => x.at !== null)
        .map(({ post, at }) => {
          const key = isRecurring(post) ? dayKey(at) : null
          const rows = signups.filter((s) => s.post_id === post.id && (key === null || s.occurs_on === key))
          return {
            post,
            at,
            going: rows.length,
            mine: rows.some((s) => s.user_id === profile?.id),
            spotsLeft: post.capacity ? Math.max(0, post.capacity - rows.length) : null,
          }
        })
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [events, signups, profile?.id],
  )

  if (loading) return <Spinner label="Loading the club" />

  const firstName = profile?.full_name.split(' ')[0] ?? 'there'
  const standing =
    profile?.title ??
    [gradeLabel(profile?.grade), profile?.graduation_year ? `Class of ${profile.graduation_year}` : null]
      .filter(Boolean)
      .join(' · ')

  const myNext = upcoming.filter((u) => u.mine)
  // Ways to serve: still open, not already yours, not full — and events that
  // give service hours before the rest (a meeting is not a way to serve).
  const open = upcoming.filter((u) => !u.mine && u.post.signup_open && u.spotsLeft !== 0)
  const gives = (u: Upcoming) => !!(u.post.service_hours || u.post.hours_tbd)
  const toHelp = [...open.filter(gives), ...open.filter((u) => !gives(u))].slice(0, 3)

  return (
    <div className="space-y-16">
      {error && <Notice tone="error">{error}</Notice>}

      {/* ---------------- Welcome ---------------- */}
      <section className="rise relative overflow-hidden rounded-[28px] border border-navy-100 bg-gradient-to-br from-navy-50 via-[var(--card)] to-gold-100/60 dark:border-navy-800 dark:from-navy-900 dark:via-navy-900 dark:to-navy-800">
        <Logo
          size={420}
          className="pointer-events-none absolute -right-24 -top-16 hidden opacity-[0.05] lg:block"
        />

        <div className="relative grid gap-10 p-7 sm:p-12 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="display mt-3 text-[clamp(2.6rem,6vw,4.5rem)]">
              {greeting()}, {firstName}.
            </h1>
            {standing && <p className="mt-3 muted">{standing}</p>}
            <p className="mt-6 max-w-md font-[family-name:var(--font-display)] text-xl italic text-navy-700 dark:text-navy-200">
              “Caring — our way of life.”
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/events" className="btn btn-primary">
                Find a way to serve
              </Link>
              <Link to="/hours" className="btn btn-ghost">
                My hours
              </Link>
            </div>
          </div>

          <MyService hours={mine.hours} goal={mine.goal} next={myNext} />
        </div>
      </section>

      {/* ---------------- Together ---------------- */}
      {club.hours > 0 && (
        <section className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Together this year</p>
          <p className="display mt-3 text-3xl leading-snug sm:text-4xl">
            Our {club.members} members have given{' '}
            <span className="text-navy-600 dark:text-gold-300">{Math.round(club.hours)} hours</span> of service
            to our community.
          </p>
        </section>
      )}

      {/* ---------------- Ways to serve ---------------- */}
      <section>
        <SectionTitle eyebrow="Spots open" title="Ways to serve" link={{ to: '/events', label: 'Full calendar' }} />
        {toHelp.length === 0 ? (
          <EmptyState icon="🤝" title={upcoming.length ? 'You’re signed up for everything open' : 'Nothing open right now'}>
            {isAdmin
              ? 'Post an event from the admin page and it will show up here.'
              : 'Officers post new service projects as they are planned — check back soon.'}
          </EmptyState>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {toHelp.map((u) => (
              <ServeCard key={u.post.id} item={u} />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Pinned ---------------- */}
      {pinned && (
        <section>
          <Link to={`/post/${pinned.slug}`} className="card group block overflow-hidden transition hover:-translate-y-0.5">
            <div className="grid md:grid-cols-[1.25fr_1fr]">
              <div className="order-2 flex flex-col p-7 sm:p-9 md:order-1">
                <div className="flex items-center gap-2">
                  <span className="tag bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-200">📌 Pinned</span>
                  <CategoryBadge category={pinned.category} />
                </div>
                <h2 className="display mt-4 text-3xl sm:text-4xl">{pinned.title}</h2>
                {pinned.summary && <p className="mt-3 muted">{pinned.summary}</p>}
                {pinned.starts_at && (
                  <p className="mt-4 text-sm font-medium text-navy-600 dark:text-navy-200">
                    🗓️ {formatDateTime(pinned.starts_at)}
                  </p>
                )}
                <span className="mt-6 inline-block text-sm font-semibold text-navy-600 group-hover:underline md:mt-auto md:pt-6 dark:text-navy-200">
                  Read more →
                </span>
              </div>
              {pinned.cover_url && (
                <CoverImage
                  src={pinned.cover_url}
                  ratio={4 / 3}
                  eager
                  className="order-1 aspect-[16/9] w-full md:order-2 md:aspect-auto md:h-full md:min-h-64"
                />
              )}
            </div>
          </Link>
        </section>
      )}

      {/* ---------------- News ---------------- */}
      <section>
        <SectionTitle eyebrow="From the board" title="Club news" link={{ to: '/news', label: 'All news' }} />
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

/** A small calendar-page tile: month over day. */
function DateTile({ at, className = '' }: { at: Date; className?: string }) {
  return (
    <div className={`w-14 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] text-center ${className}`}>
      <div className="bg-navy-600 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-navy-500">
        {at.toLocaleDateString(undefined, { month: 'short' })}
      </div>
      <div className="display num py-1 text-2xl">{at.getDate()}</div>
    </div>
  )
}

/** The member's own year: a ring toward the hours goal, and where they're headed next. */
function MyService({ hours, goal, next }: { hours: number; goal: number; next: Upcoming[] }) {
  const pct = goal > 0 ? Math.min(1, hours / goal) : 0
  const r = 34
  const c = 2 * Math.PI * r

  return (
    <div className="card p-6">
      <p className="eyebrow">Your service this year</p>
      <div className="mt-4 flex items-center gap-5">
        <svg viewBox="0 0 80 80" className="size-24 shrink-0 -rotate-90" aria-hidden>
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-[var(--surface-2)]" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="stroke-gold-400 transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <div>
          <p className="display num text-4xl">
            {hours % 1 ? hours.toFixed(1) : hours}
            {goal > 0 && <span className="text-lg font-normal muted"> / {goal}</span>}
          </p>
          <p className="text-sm muted">
            {goal > 0
              ? hours >= goal
                ? 'Goal reached — thank you!'
                : `${(goal - hours) % 1 ? (goal - hours).toFixed(1) : goal - hours} hours to your goal`
              : 'approved service hours'}
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--line)] pt-4">
        {next.length === 0 ? (
          <p className="text-sm muted">
            You’re not signed up for anything yet.{' '}
            <Link to="/events" className="font-semibold text-navy-600 hover:underline dark:text-navy-200">
              Pick an event →
            </Link>
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider muted">
              You’re signed up for {next.length} upcoming
            </p>
            <Link to={`/post/${next[0].post.slug}`} className="group mt-3 flex items-center gap-3">
              <DateTile at={next[0].at} />
              <div className="min-w-0">
                <p className="truncate font-semibold group-hover:underline">{next[0].post.title}</p>
                <p className="truncate text-sm muted">
                  {next[0].post.all_day
                    ? next[0].at.toLocaleDateString(undefined, { weekday: 'long' })
                    : next[0].at.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
                  {next[0].post.location && ` · ${next[0].post.location}`}
                </p>
              </div>
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

/** An open service opportunity: when, where, what it gives, and how much room is left. */
function ServeCard({ item }: { item: Upcoming }) {
  const { post, at, going, spotsLeft } = item
  const hours = formatServiceHours(post)
  const filled = post.capacity ? Math.min(100, (going / post.capacity) * 100) : 0

  return (
    <Link
      to={`/post/${post.slug}`}
      data-ec={colorOf(post)}
      className="card group flex flex-col p-5 transition hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-4">
        <DateTile at={at} />
        <div className="min-w-0">
          <h3 className="display text-xl leading-tight group-hover:text-navy-600 dark:group-hover:text-navy-200">
            {post.title}
          </h3>
          <p className="mt-1 text-sm muted">
            {post.all_day
              ? at.toLocaleDateString(undefined, { weekday: 'long' })
              : at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            {post.location && ` · ${post.location}`}
          </p>
        </div>
      </div>

      {post.summary && <p className="mt-4 line-clamp-2 text-sm">{post.summary}</p>}

      <div className="mt-auto pt-5">
        {post.capacity ? (
          <>
            <div className="flex justify-between text-xs">
              <span className="muted">{going} going</span>
              <span className="font-semibold text-gold-600 dark:text-gold-300">
                {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full bg-gold-400" style={{ width: `${Math.max(filled, 4)}%` }} />
            </div>
          </>
        ) : (
          <p className="text-xs muted">{going ? `${going} going · ` : ''}Open to everyone</p>
        )}
        <div className="mt-4 flex items-center justify-between text-sm">
          {hours ? (
            <span className="tag bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
              {hours === 'TBD' ? 'Hours TBD' : `${hours} of service`}
            </span>
          ) : (
            <span />
          )}
          <span className="font-semibold text-navy-600 group-hover:underline dark:text-navy-200">Sign up →</span>
        </div>
      </div>
    </Link>
  )
}
