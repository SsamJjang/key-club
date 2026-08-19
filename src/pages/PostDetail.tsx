import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { EventSignup, Post } from '../lib/types'
import { formatDate, formatDateTime, formatTime, isUpcoming } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
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

  const html = useMemo(() => (post ? renderMarkdown(post.body) : ''), [post])
  const mine = signups.some((s) => s.user_id === profile?.id)
  const full = Boolean(post?.capacity && signups.length >= post.capacity)

  async function toggleRsvp() {
    if (!post || !profile) return
    setBusy(true)
    setError(null)

    if (mine) {
      const { error } = await supabase
        .from('event_signups')
        .delete()
        .eq('post_id', post.id)
        .eq('user_id', profile.id)
      if (error) setError(error.message)
    } else {
      const { error } = await supabase
        .from('event_signups')
        .insert({ post_id: post.id, user_id: profile.id })
      if (error) setError(error.message)
    }

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
  const open = isEvent && post.signup_open && isUpcoming(post)

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
                {formatDateTime(post.starts_at)}
                {post.ends_at && ` – ${formatTime(post.ends_at)}`}
              </dd>
            </div>
            {post.location && (
              <div>
                <dt className="label">Where</dt>
                <dd className="font-medium">{post.location}</dd>
              </div>
            )}
            {post.service_hours ? (
              <div>
                <dt className="label">Service hours</dt>
                <dd className="font-medium">{post.service_hours} hrs</dd>
              </div>
            ) : null}
            <div>
              <dt className="label">Signed up</dt>
              <dd className="font-medium">
                {signups.length}
                {post.capacity ? ` of ${post.capacity} spots` : ' members'}
              </dd>
            </div>
          </dl>

          {error && (
            <div className="mt-5">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void toggleRsvp()}
              disabled={busy || (!open && !mine) || (full && !mine)}
              className={`btn ${mine ? 'btn-ghost' : 'btn-primary'}`}
            >
              {busy
                ? 'Saving…'
                : mine
                  ? 'Cancel my spot'
                  : full
                    ? 'Event is full'
                    : open
                      ? "I'm going"
                      : 'Sign-ups closed'}
            </button>
            {mine && (
              <span className="text-sm text-emerald-700 dark:text-emerald-300">
                You’re signed up. See you there.
              </span>
            )}
          </div>

          {signups.length > 0 && (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <p className="label">Who’s going</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {signups.map((s) => (
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
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="prose-club mt-10" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  )
}
