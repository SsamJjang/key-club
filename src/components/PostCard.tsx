import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { bodyImages } from '../lib/gallery'
import type { Post } from '../lib/types'
import { formatOccurrence, nextOccurrence, occurrences, relative } from '../lib/format'
import { Avatar, CategoryBadge } from './ui'
import CoverImage from './CoverImage'

export default function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const isEvent = post.category === 'event'
  const all = occurrences(post)
  const when = nextOccurrence(post) ?? all[all.length - 1] ?? null
  const photos = useMemo(() => (compact ? [] : bodyImages(post.body)), [post.body, compact])

  return (
    <article className="card group overflow-hidden transition hover:border-navy-300 dark:hover:border-navy-600">
      <Link to={`/post/${post.slug}`} className="block">
        {!compact && (post.cover_url || photos.length > 0) && (
          <div className="relative">
            {post.cover_url ? (
              <CoverImage
                src={post.cover_url}
                className="aspect-[16/9] w-full border-b border-[var(--line)] transition group-hover:brightness-105"
              />
            ) : (
              // No cover, but the post has photos: a small mosaic of them.
              <div
                className={`grid aspect-[16/9] w-full gap-0.5 overflow-hidden border-b border-[var(--line)] bg-[var(--line)] ${
                  photos.length >= 3 ? 'grid-cols-[2fr_1fr] grid-rows-2' : photos.length === 2 ? 'grid-cols-2' : ''
                }`}
              >
                {photos.slice(0, 3).map((p, i) => (
                  <img
                    key={p.src}
                    src={p.thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={`size-full object-cover ${
                      photos.length >= 3 && i === 0 ? 'row-span-2' : ''
                    }`}
                  />
                ))}
              </div>
            )}
            {photos.length > 1 && (
              <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                📷 {photos.length}
              </span>
            )}
          </div>
        )}
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={post.category} />
            {post.pinned && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gold-500 dark:text-gold-300">
                📌 Pinned
              </span>
            )}
            {!post.published && (
              <span className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide muted">
                Draft
              </span>
            )}
          </div>

          <h3 className="mt-3 font-[family-name:var(--font-display)] text-lg font-semibold leading-snug tracking-tight transition group-hover:text-navy-600 dark:group-hover:text-navy-200">
            {post.title}
          </h3>

          {post.summary && <p className="mt-2 line-clamp-2 text-sm muted">{post.summary}</p>}

          {isEvent && when && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-navy-600 dark:text-navy-200">
              <span>🗓️ {formatOccurrence(when, post.all_day)}</span>
              {post.recurrence_note && (
                <span className="muted font-normal">🔁 {post.recurrence_note}</span>
              )}
              {post.location && <span className="muted font-normal">📍 {post.location}</span>}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2 text-xs muted">
            {post.author && (
              <>
                <Avatar name={post.author.full_name} url={post.author.avatar_url} size={20} />
                <span>{post.author.full_name}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <time dateTime={post.created_at}>{relative(post.created_at)}</time>
          </div>
        </div>
      </Link>
    </article>
  )
}
