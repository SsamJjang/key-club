import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { HoursEntry, Post } from '../lib/types'
import { formatDate } from '../lib/format'
import {
  Avatar,
  CategoryBadge,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  Stat,
} from '../components/ui'

type Tab = 'posts' | 'hours' | 'roster'

export default function Admin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('posts')
  const [posts, setPosts] = useState<Post[]>([])
  const [pending, setPending] = useState<HoursEntry[]>([])
  const [roster, setRoster] = useState<
    { email: string; full_name: string; role: string; active: boolean; grade: number | null }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [postRes, hoursRes, rosterRes] = await Promise.all([
      supabase.from('posts').select('*').order('created_at', { ascending: false }),
      supabase
        .from('hours_log')
        .select('*, profile:profiles!user_id(id, full_name, avatar_url, grade), post:posts!post_id(id, slug, title)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      supabase.from('members').select('email, full_name, role, active, grade').order('full_name'),
    ])

    if (postRes.error) setError(postRes.error.message)
    setPosts((postRes.data as Post[]) ?? [])
    setPending((hoursRes.data as HoursEntry[]) ?? [])
    setRoster((rosterRes.data as typeof roster) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function togglePublish(post: Post) {
    await supabase.from('posts').update({ published: !post.published }).eq('id', post.id)
    await load()
  }

  async function togglePin(post: Post) {
    await supabase.from('posts').update({ pinned: !post.pinned }).eq('id', post.id)
    await load()
  }

  async function removePost(post: Post) {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return
    await supabase.from('posts').delete().eq('id', post.id)
    await load()
  }

  async function review(entry: HoursEntry, status: 'approved' | 'rejected') {
    await supabase
      .from('hours_log')
      .update({
        status,
        reviewed_by: profile?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
    await load()
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'posts', label: 'Posts', count: posts.length },
    { key: 'hours', label: 'Hours queue', count: pending.length },
    { key: 'roster', label: 'Roster', count: roster.length },
  ]

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Officers only"
        title="Admin"
        subtitle="Write the news, approve service hours, check who is on the roster."
        action={
          <Link to="/admin/posts/new" className="btn btn-primary">
            + New post
          </Link>
        }
      />

      <div className="mb-8 grid grid-cols-3 gap-3">
        <Stat value={posts.filter((p) => p.published).length} label="Published" />
        <Stat value={posts.filter((p) => !p.published).length} label="Drafts" />
        <Stat value={pending.length} label="Hours to review" />
      </div>

      <div className="mb-6 inline-flex rounded-xl border border-[var(--line)] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-navy-600 text-white' : 'muted'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : tab === 'posts' ? (
        posts.length === 0 ? (
          <EmptyState icon="✍️" title="No posts yet">
            Write the club’s first article.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryBadge category={p.category} />
                    {p.pinned && <span className="text-xs">📌</span>}
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide ${
                        p.published ? 'text-emerald-600 dark:text-emerald-300' : 'muted'
                      }`}
                    >
                      {p.published ? 'Live' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-semibold">{p.title}</p>
                  <p className="text-xs muted">
                    {formatDate(p.created_at)} · /{p.slug}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void togglePin(p)} className="btn btn-ghost py-1 text-xs">
                    {p.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button type="button" onClick={() => void togglePublish(p)} className="btn btn-ghost py-1 text-xs">
                    {p.published ? 'Unpublish' : 'Publish'}
                  </button>
                  <Link to={`/admin/posts/${p.id}`} className="btn btn-ghost py-1 text-xs">
                    Edit
                  </Link>
                  <button type="button" onClick={() => void removePost(p)} className="btn btn-danger py-1 text-xs">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === 'hours' ? (
        pending.length === 0 ? (
          <EmptyState icon="✅" title="Queue is clear">
            Every submitted entry has been reviewed.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {pending.map((h) => (
              <li key={h.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={h.profile?.full_name ?? '?'} url={h.profile?.avatar_url} size={36} />
                  <div>
                    <p className="font-semibold">{h.profile?.full_name ?? 'Member'}</p>
                    <p className="text-xs muted">
                      {Number(h.hours).toFixed(1)} hrs · {formatDate(h.served_on)}
                      {h.post ? ` · ${h.post.title}` : ''}
                    </p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button type="button" onClick={() => void review(h, 'approved')} className="btn btn-primary py-1 text-xs">
                      Approve
                    </button>
                    <button type="button" onClick={() => void review(h, 'rejected')} className="btn btn-danger py-1 text-xs">
                      Reject
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm">{h.description}</p>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <Notice>
            The roster is the allowlist, and it is edited in Supabase Studio → Table Editor →{' '}
            <code>members</code>. Adding a row lets that email sign in; unchecking{' '}
            <code>active</code> locks them out on their next request.
          </Notice>
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left">
                  {['Name', 'Email', 'Grade', 'Role', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((m) => (
                  <tr key={m.email} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2.5 font-medium">{m.full_name}</td>
                    <td className="px-4 py-2.5 muted">{m.email}</td>
                    <td className="px-4 py-2.5">{m.grade ?? '—'}</td>
                    <td className="px-4 py-2.5 capitalize">{m.role}</td>
                    <td className="px-4 py-2.5">
                      {m.active ? (
                        <span className="text-emerald-600 dark:text-emerald-300">Active</span>
                      ) : (
                        <span className="muted">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
