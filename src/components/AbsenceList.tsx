import { Link } from 'react-router-dom'
import type { EventAbsence, Post } from '../lib/types'
import { ADVANCE_HOURS, inAdvance, sentLine } from '../lib/absence'
import { Avatar } from './ui'

/** "12h+ notice" in green, "Short notice" in red — the at-a-glance split. */
export function NoticeBadge({ post, absence }: { post: Post; absence: EventAbsence }) {
  const early = inAdvance(post, absence)
  if (early === null) return null
  return (
    <span
      title={early ? `Sent at least ${ADVANCE_HOURS} hours before` : `Sent less than ${ADVANCE_HOURS} hours before`}
      className={`tag shrink-0 ${
        early
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
          : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200'
      }`}
    >
      {early ? `${ADVANCE_HOURS}h+ notice` : 'Short notice'}
    </span>
  )
}

/**
 * Officers' view of who's out or late for one event date: name, what's up,
 * reason, when it was sent and whether that was enough notice.
 */
export default function AbsenceList({
  post,
  rows,
  compact = false,
}: {
  post: Post
  rows: EventAbsence[]
  /** Calendar card: names and badges only, no reasons. */
  compact?: boolean
}) {
  const out = rows.filter((r) => r.kind === 'absent')
  const late = rows.filter((r) => r.kind === 'late')

  return (
    <div className="space-y-4">
      {[
        { label: 'Can’t make it', list: out },
        { label: 'Running late', list: late },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.label}>
            <p className="text-xs font-semibold uppercase tracking-wide muted">
              {g.label} · {g.list.length}
            </p>
            <ul className={compact ? 'mt-1.5 space-y-1.5' : 'mt-2 space-y-3'}>
              {g.list.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 text-sm">
                  <Avatar name={a.profile?.full_name ?? '?'} url={a.profile?.avatar_url} size={compact ? 22 : 30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link to={`/members/${a.user_id}`} className="font-semibold hover:underline">
                        {a.profile?.full_name ?? 'A member'}
                      </Link>
                      {a.arrives && <span className="muted">arriving {a.arrives}</span>}
                      <NoticeBadge post={post} absence={a} />
                    </div>
                    {!compact && a.reason && <p className="mt-0.5 whitespace-pre-line">{a.reason}</p>}
                    {!compact && <p className="mt-0.5 text-xs muted">{sentLine(post, a)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  )
}
