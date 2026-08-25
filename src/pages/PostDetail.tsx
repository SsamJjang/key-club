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
  const mine = signups.some((s) => s.user_id === profile?.id)
  // Capacity counts people, not seats-per-date: a series with room for 20 means
  // 20 members on the project, however many sessions each of them makes.
  const full = Boolean(post?.capacity && distinctMembers(signups) >= post.capacity)

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

  // One entry per member for the "who's going" list — a member with five
  // dates in a series is still one person on the roster.
  const roster = signups.filter(
    (s, i) => signups.findIndex((o) => o.user_id === s.user_id) === i,
  )

  // Three independent reasons a member can't join, each with its own message —
  // "closed" for all of them is what made this confusing to debug.
  const ended = hasEnded(post)
  const closed = !post.signup_open
  const canJoin = isEvent && !ended && !closed && !full

  const rsvpLabel = busy
    ? 'Saving…'
    : mine
      ? 'Cancel my spot'
      : ended
        ? 'This event has passed'
        : closed
          ? 'Sign-ups are closed'
          : full
            ? 'Event is full'
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
                {distinctMembers(signups)}
                {post.capacity ? ` of ${post.capacity} spots` : ' members'}
              </dd>
            </div>
          </dl>

          {/* A series is picked date by date. Nobody can make every Wednesday
              of a term, and asking them to commit to all or nothing is how you
              end up with an empty sign-up list. */}
          {series && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="label mb-0">Which dates can you make?</p>
                <p className="text-xs muted">
                  {myDates > 0
                    ? `You’re down for ${myDates} of ${dates.length}`
                    : `${dates.length} dates — pick any`}
                </p>
              </div>

              <ul className="mt-3 flex flex-wrap gap-1.5">
                {dates.map((d) => {
                  const key = dayKey(d)
                  const done = d.getTime() < Date.now()
                  const going = signups.filter((s) => s.occurs_on === key)
                  const isMine = going.some((s) => s.user_id === profile?.id)
                  const locked = busy || done || closed || (!isMine && full)

                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => void toggleRsvp(key)}
                        disabled={locked}
                        aria-pressed={isMine}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          done
                            ? 'cursor-not-allowed border-[var(--line)] muted line-through'
                            : isMine
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                              : 'border-[var(--line)] hover:border-navy-400 disabled:cursor-not-allowed disabled:opacity-50'
                        }`}
                      >
                        {isMine && <span aria-hidden>✓</span>}
                        {d.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {going.length > 0 && (
                          <span className={isMine ? 'opacity-70' : 'muted'}>· {going.length}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost py-1.5 text-xs"
                  onClick={() => void selectAllDates()}
                  disabled={busy || !canJoin}
                >
                  Select every remaining date
                </button>
                {myDates > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost py-1.5 text-xs"
                    onClick={() => void clearMyDates()}
                    disabled={busy}
                  >
                    Clear mine
                  </button>
                )}
                <span className="text-xs muted">
                  The number on a date is how many members are coming that day.
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          {/* A series has no single yes/no — its answer is the date chips
              above. Only a one-date event gets the plain button. */}
          {!series && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void toggleRsvp(null)}
                disabled={busy || (!canJoin && !mine)}
                className={`btn ${mine ? 'btn-ghost' : 'btn-primary'}`}
              >
                {rsvpLabel}
              </button>
              {mine ? (
                <span className="text-sm text-emerald-700 dark:text-emerald-300">
                  You’re signed up. See you there.
                </span>
              ) : (
                !canJoin && (
                  <span className="text-sm muted">
                    {ended
                      ? 'Sign-ups end once the event is over.'
                      : closed
                        ? 'An officer has closed sign-ups for this event.'
                        : 'Every spot has been taken.'}
                  </span>
                )
              )}
            </div>
          )}

          {series && !canJoin && (
            <p className="mt-4 text-sm muted">
              {ended
                ? 'This series has finished — its dates are locked.'
                : closed
                  ? 'An officer has closed sign-ups for this event.'
                  : 'Every spot has been taken.'}
            </p>
          )}

          {roster.length > 0 && (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <p className="label">Who’s going</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {roster.map((s) => {
                  const count = datesFor(signups, s.user_id)
                  return (
                    <li key={s.user_id}>
                      <Link
                        to={`/members/${s.user_id}`}
                        className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-1 pr-3 text-sm transition hover:border-navy-300"
                      >
                        <Avatar
                          name={s.profile?.full_name ?? '?'}
                          url={s.profile?.avatar_url}
                          size={24}
                        />
                        {s.profile?.full_name ?? 'Member'}
                        {series && (
                          <span className="text-xs muted">
                            {count} date{count === 1 ? '' : 's'}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="prose-club mt-10" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  )
}
