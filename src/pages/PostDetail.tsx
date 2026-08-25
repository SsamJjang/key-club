import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { EventSignup, Post } from '../lib/types'
import {
  dayKey,
  formatDate,
  formatOccurrence,
  formatServiceHours,
  formatTime,
  hasEnded,
  isRecurring,
  nextOccurrence,
  occurrenceEnded,
  occurrences,
} from '../lib/format'
import {
  addRemainingDates,
  addSignup,
  datesFor,
  distinctMembers,
  removeAllSignups,
  removeSignup,
} from '../lib/rsvp'
import { renderBody } from '../lib/markdown'
import { Avatar, CategoryBadge, EmptyState, Notice, Spinner } from '../components/ui'

export default function PostDetail() {
  const { slug } = useParams<{ slug: string }>()
  const { profile, isAdmin } = useAuth()
  const [post, setPost] = useState<Post | null>(null)
  /** Which date of a series is on screen. Null = "whichever is next up". */
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [signups, setSignups] = useState<EventSignup[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSignups = useCallback(async (postId: string) => {
    const { data } = await supabase
      .from('event_signups')
      .select('*, profile:profiles!user_id(id, full_name, avatar_url, grade)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setSignups((data as EventSignup[]) ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!slug) return

    async function load() {
      const { data, error } = await supabase
        .from('posts')
        .select('*, author:profiles!author_id(id, full_name, avatar_url, title)')
        .eq('slug', slug!)
        .maybeSingle()

      if (cancelled) return
      if (error) setError(error.message)
      const found = data as Post | null
      setPost(found)
      setLoading(false)
      if (found?.category === 'event') await loadSignups(found.id)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [slug, loadSignups])

  const html = useMemo(() => (post ? renderBody(post.body) : ''), [post])

  /**
   * Toggle one date of a series, or the whole event when it only has one date
   * (`key` null). Everything the member clicks routes through here.
   */
  async function toggleRsvp(key: string | null) {
    if (!post || !profile) return
    setBusy(true)
    setError(null)

    const has = signups.some((s) => s.user_id === profile.id && s.occurs_on === key)
    const { error } = has
      ? await removeSignup(post.id, profile.id, key)
      : await addSignup(post.id, profile.id, key)

    if (error) setError(error.message)
    await loadSignups(post.id)
    setBusy(false)
  }

  async function selectAllDates() {
    if (!post || !profile) return
    setBusy(true)
    setError(null)
    const { error } = await addRemainingDates(post, profile.id, signups)
    if (error) setError(error.message)
    await loadSignups(post.id)
    setBusy(false)
  }

  async function clearMyDates() {
    if (!post || !profile) return
    setBusy(true)
    setError(null)
    const { error } = await removeAllSignups(post.id, profile.id)
    if (error) setError(error.message)
    await loadSignups(post.id)
    setBusy(false)
  }

  if (loading) return <Spinner />
  if (!post) {
    return (
      <EmptyState icon="🕳️" title="That post doesn’t exist">
        It may have been unpublished. <Link to="/news" className="underline">Back to the feed</Link>.
      </EmptyState>
    )
  }

  const isEvent = post.category === 'event'
  const dates = occurrences(post)
  const series = isRecurring(post)
  // For a series, the next date still to come; once it's over, the last one.
  const when = nextOccurrence(post) ?? dates[dates.length - 1] ?? null
  const hours = formatServiceHours(post)
  const myDates = profile ? datesFor(signups, profile.id) : 0

  // ---- the date on screen -------------------------------------------
  // Everything below — the spots bar, the roster, the button — describes
  // this one date. A single-date event has exactly one, so the same code
  // path draws both and there is no second layout to keep in sync.
  const shownDate = series
    ? (dates.find((d) => dayKey(d) === pickedDate) ?? when)
    : when
  const shownKey = series && shownDate ? dayKey(shownDate) : null

  const dateRows = series ? signups.filter((s) => s.occurs_on === shownKey) : signups
  const dateGoing = dateRows.length
  const dateMine = dateRows.some((s) => s.user_id === profile?.id)

  // Capacity is per date for a series: twenty spots means twenty at each
  // session, not twenty people spread across the term.
  const dateFull = Boolean(post.capacity && dateGoing >= post.capacity)
  const spotsLeft = post.capacity ? Math.max(0, post.capacity - dateGoing) : null
  const pct = post.capacity ? Math.min(100, (dateGoing / post.capacity) * 100) : 0

  // Three independent reasons a member can't join, each with its own message —
  // "closed" for all of them is what made this confusing to debug.
  const ended = series && shownDate ? occurrenceEnded(post, shownDate) : hasEnded(post)
  const closed = !post.signup_open
  const canJoin = isEvent && !ended && !closed && !dateFull

  const rsvpLabel = busy
    ? 'Saving…'
    : dateMine
      ? 'Cancel my spot'
      : ended
        ? series
          ? 'This date has passed'
          : 'This event has passed'
        : closed
          ? 'Sign-ups are closed'
          : dateFull
            ? series
              ? 'This date is full'
              : 'Event is full'
            : "I'm going"

  return (
    <article className="rise mx-auto max-w-3xl">
      <Link to="/news" className="text-sm font-semibold muted hover:underline">
        ← Back to the feed
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={post.category} />
          {post.pinned && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gold-500 dark:text-gold-300">
              📌 Pinned
            </span>
          )}
          {!post.published && (
            <span className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide muted">
              Draft — only officers can see this
            </span>
          )}
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {post.title}
        </h1>

        {post.summary && <p className="mt-3 text-lg muted">{post.summary}</p>}

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm muted">
          {post.author && (
            <Link to={`/members/${post.author.id}`} className="flex items-center gap-2 hover:underline">
              <Avatar name={post.author.full_name} url={post.author.avatar_url} size={28} />
              <span className="font-medium text-[var(--ink)]">{post.author.full_name}</span>
            </Link>
          )}
          <span aria-hidden>·</span>
          <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
          {isAdmin && (
            <>
              <span aria-hidden>·</span>
              <Link to={`/admin/posts/${post.id}`} className="font-semibold text-navy-600 hover:underline dark:text-navy-200">
                Edit
              </Link>
            </>
          )}
        </div>
      </header>

      {post.cover_url && (
        <img src={post.cover_url} alt="" className="mt-8 w-full rounded-2xl object-cover" />
      )}

      {isEvent && (
        <section className="card mt-8 p-6">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="label">When</dt>
              <dd className="font-medium">
                {when ? (
                  <>
                    {formatOccurrence(when, post.all_day)}
                    {post.ends_at && !post.all_day && ` – ${formatTime(post.ends_at)}`}
                    {post.all_day && <span className="muted"> · time TBA</span>}
                  </>
                ) : (
                  <span className="muted">Date to be announced</span>
                )}
                {post.recurrence_note && (
                  <span className="mt-0.5 block text-sm font-normal muted">
                    🔁 {post.recurrence_note}
                  </span>
                )}
              </dd>
            </div>
            {post.location && (
              <div>
                <dt className="label">Where</dt>
                <dd className="font-medium">{post.location}</dd>
              </div>
            )}
            {hours ? (
              <div>
                <dt className="label">Service hours</dt>
                <dd className="font-medium">
                  {hours}
                  {post.hours_tbd && (
                    <span className="ml-2 text-sm font-normal muted">announced closer to the day</span>
                  )}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="label">Signed up</dt>
              <dd className="font-medium">
                {series ? (
                  <>
                    {distinctMembers(signups)} members
                    <span className="muted"> across {dates.length} dates</span>
                  </>
                ) : (
                  <>
                    {dateGoing}
                    {post.capacity ? ` of ${post.capacity} spots` : ' members'}
                  </>
                )}
              </dd>
            </div>
          </dl>

          {/* The date switcher. Picking a tab changes which date the panel
              below describes — it does not sign you up. The ✓ shows the dates
              you are already down for, so your whole selection stays visible
              while you move between them. */}
          {series && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="label mb-0">Pick a date</p>
                <p className="text-xs muted">
                  {myDates > 0
                    ? `You’re down for ${myDates} of ${dates.length}`
                    : `${dates.length} dates — sign up for any`}
                </p>
              </div>

              <div
                role="tablist"
                aria-label="Event dates"
                className="mt-3 flex gap-1.5 overflow-x-auto pb-1"
              >
                {dates.map((d) => {
                  const key = dayKey(d)
                  const done = occurrenceEnded(post, d)
                  const rows = signups.filter((s) => s.occurs_on === key)
                  const isMine = rows.some((s) => s.user_id === profile?.id)
                  const active = key === shownKey

                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPickedDate(key)}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-navy-600 bg-navy-600 text-white'
                          : done
                            ? 'border-[var(--line)] muted line-through'
                            : 'border-[var(--line)] hover:border-navy-400'
                      }`}
                    >
                      {isMine && <span aria-hidden>✓</span>}
                      {d.toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      <span className={active ? 'opacity-70' : 'muted'}>· {rows.length}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          {/* One panel, describing the date on screen. A single-date event
              renders it too — it just has no tabs above it to switch. */}
          <div className={series ? 'mt-4 rounded-xl bg-[var(--surface)] p-5' : 'mt-6'}>
            {series && shownDate && (
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
                {shownDate.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
                {!post.all_day && (
                  <span className="ml-2 text-sm font-normal muted">
                    {formatTime(post.starts_at)}
                    {post.ends_at && ` – ${formatTime(post.ends_at)}`}
                  </span>
                )}
              </p>
            )}

            {/* How full this date is — the nudge to sign up. */}
            <div className={series ? 'mt-3' : ''}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {dateGoing} {dateGoing === 1 ? 'member' : 'members'} going
                </span>
                {spotsLeft !== null && (
                  <span
                    className={
                      spotsLeft === 0 ? 'muted' : 'font-semibold text-gold-600 dark:text-gold-300'
                    }
                  >
                    {dateGoing} of {post.capacity} spots
                    {spotsLeft === 0 ? ' · full' : ` · ${spotsLeft} left`}
                  </span>
                )}
              </div>
              {post.capacity ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      spotsLeft === 0 ? 'bg-navy-400' : 'bg-gold-400'
                    }`}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void toggleRsvp(shownKey)}
                disabled={busy || (!canJoin && !dateMine)}
                className={`btn ${dateMine ? 'btn-ghost' : 'btn-primary'}`}
              >
                {rsvpLabel}
              </button>

              {series && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost py-1.5 text-sm"
                    onClick={() => void selectAllDates()}
                    disabled={busy || closed}
                  >
                    Every remaining date
                  </button>
                  {myDates > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost py-1.5 text-sm"
                      onClick={() => void clearMyDates()}
                      disabled={busy}
                    >
                      Clear mine
                    </button>
                  )}
                </>
              )}

              {dateMine ? (
                <span className="text-sm text-emerald-700 dark:text-emerald-300">
                  You’re signed up. See you there.
                </span>
              ) : (
                !canJoin && (
                  <span className="text-sm muted">
                    {ended
                      ? series
                        ? 'This date has already happened.'
                        : 'Sign-ups end once the event is over.'
                      : closed
                        ? 'An officer has closed sign-ups for this event.'
                        : 'Every spot has been taken.'}
                  </span>
                )
              )}
            </div>

            {/* Exactly who is coming on the date above. */}
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <p className="label">
                Who’s coming
                {series && shownDate && (
                  <span className="normal-case tracking-normal">
                    {' '}
                    on {shownDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </p>
              {dateRows.length === 0 ? (
                <p className="mt-2 text-sm muted">
                  Nobody yet{canJoin ? ' — be the first.' : '.'}
                </p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {dateRows.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/members/${s.user_id}`}
                        className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pl-1 pr-3 text-sm transition hover:border-navy-300"
                      >
                        <Avatar
                          name={s.profile?.full_name ?? '?'}
                          url={s.profile?.avatar_url}
                          size={24}
                        />
                        {s.profile?.full_name ?? 'Member'}
                        {s.user_id === profile?.id && (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            you
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="prose-club mt-10" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  )
}
