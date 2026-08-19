import { Link } from 'react-router-dom'
import type { Post } from '../lib/types'
import { formatDateTime, relative } from '../lib/format'
import { Avatar, CategoryBadge } from './ui'

export default function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const isEvent = post.category === 'event'

  return (
    <article className="card group overflow-hidden transition hover:border-navy-300 dark:hover:border-navy-600">
      <Link to={`/post/${post.slug}`} className="block">
        {post.cover_url && !compact && (
          <img
            src={post.cover_url}
            alt=""
            loading="lazy"
            className="h-44 w-full object-cover transition group-hover:opacity-95"
          />
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

          {isEvent && post.starts_at && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-navy-600 dark:text-navy-200">
              <span>🗓️ {formatDateTime(post.starts_at)}</span>
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
