import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { ClubSettings, Post } from '../lib/types'
import { formatDate } from '../lib/format'
import { CategoryBadge, EmptyState, Notice, PageHeader, Spinner, Stat } from '../components/ui'
import MembersTab from '../components/admin/MembersTab'
import HoursTab from '../components/admin/HoursTab'

type Tab = 'posts' | 'hours' | 'members' | 'settings'

function SettingsTab() {
  const [settings, setSettings] = useState<ClubSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    supabase
      .from('club_settings')
      .select('*')
      .single()
      .then(({ data }) => setSettings(data as ClubSettings | null))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase
      .from('club_settings')
      .update({
        club_name: settings.club_name,
        school_year: settings.school_year,
        hours_goal: Number(settings.hours_goal),
        email_from: settings.email_from,
        email_reply_to: settings.email_reply_to || null,
        weekly_email_enabled: settings.weekly_email_enabled,
        site_url: settings.site_url || null,
      })
      .eq('id', true)

    setMsg(
      error
        ? { tone: 'error', text: error.message }
        : { tone: 'success', text: 'Settings saved.' },
    )
    setSaving(false)
  }

  if (!settings) return <Spinner />

  return (
    <form onSubmit={save} className="card max-w-2xl space-y-5 p-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Club name</label>
          <input
            className="field"
            value={settings.club_name}
            onChange={(e) => setSettings({ ...settings, club_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">School year</label>
          <input
            className="field"
            value={settings.school_year}
            onChange={(e) => setSettings({ ...settings, school_year: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Yearly hours goal</label>
          <input
            type="number"
            min="1"
            className="field"
            value={settings.hours_goal}
            onChange={(e) => setSettings({ ...settings, hours_goal: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Site URL (linked in emails)</label>
          <input
            className="field"
            value={settings.site_url ?? ''}
            onChange={(e) => setSettings({ ...settings, site_url: e.target.value })}
            placeholder="https://keyclub.pages.dev"
          />
        </div>
      </div>

      <div className="border-t border-[var(--line)] pt-5">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Weekly email
        </h3>
        <p className="mt-1 text-sm muted">
          Sends every Sunday at 9:00 PM (Asia/Seoul) to every active member, with their hours
          against the goal.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">From address</label>
            <input
              className="field"
              value={settings.email_from}
              onChange={(e) => setSettings({ ...settings, email_from: e.target.value })}
              placeholder="Key Club Hour Tracker &lt;keyclub@yourschool.org&gt;"
            />
            <p className="mt-1 text-xs muted">
              The domain must be verified in Resend or delivery will fail.
            </p>
          </div>
          <div>
            <label className="label">Reply-to (optional)</label>
            <input
              className="field"
              value={settings.email_reply_to ?? ''}
              onChange={(e) => setSettings({ ...settings, email_reply_to: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={settings.weekly_email_enabled}
              onChange={(e) =>
                setSettings({ ...settings, weekly_email_enabled: e.target.checked })
              }
            />
            Weekly email is on
          </label>
          <p className="text-xs muted">
            This is the kill switch. The cron job still fires, but the function stops immediately
            when this is off.
          </p>
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}

function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setPosts((data as Post[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function update(post: Post, patch: Partial<Post>) {
    await supabase.from('posts').update(patch).eq('id', post.id)
    await load()
  }

  async function removePost(post: Post) {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return
    await supabase.from('posts').delete().eq('id', post.id)
    await load()
  }

  if (loading) return <Spinner />
  if (error) return <Notice tone="error">{error}</Notice>

  if (posts.length === 0) {
    return (
      <EmptyState icon="✍️" title="No posts yet">
        Write the club’s first article.
      </EmptyState>
    )
  }

  return (
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
            <button
              type="button"
              onClick={() => void update(p, { pinned: !p.pinned })}
              className="btn btn-ghost py-1 text-xs"
            >
              {p.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={() => void update(p, { published: !p.published })}
              className="btn btn-ghost py-1 text-xs"
            >
              {p.published ? 'Unpublish' : 'Publish'}
            </button>
            <Link to={`/admin/posts/${p.id}`} className="btn btn-ghost py-1 text-xs">
              Edit
            </Link>
            <button
              type="button"
              onClick={() => void removePost(p)}
              className="btn btn-danger py-1 text-xs"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('posts')
  const [counts, setCounts] = useState({ posts: 0, drafts: 0, members: 0, hours: 0 })

  useEffect(() => {
    async function load() {
      const [posts, members, hours] = await Promise.all([
        supabase.from('posts').select('id, published'),
        supabase.from('members').select('email', { count: 'exact', head: true }),
        supabase.from('hours_log').select('hours'),
      ])
      const postRows = (posts.data as { published: boolean }[]) ?? []
      setCounts({
        posts: postRows.filter((p) => p.published).length,
        drafts: postRows.filter((p) => !p.published).length,
        members: members.count ?? 0,
        hours:
          ((hours.data as { hours: number }[]) ?? []).reduce((s, r) => s + Number(r.hours), 0) ?? 0,
      })
    }
    void load()
  }, [tab])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'posts', label: 'Posts' },
    { key: 'hours', label: 'Hours' },
    { key: 'members', label: 'Members' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Officers only"
        title="Admin"
        subtitle="Write the news, log service hours, manage the roster."
        action={
          <Link to="/admin/posts/new" className="btn btn-primary">
            + New post
          </Link>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={counts.posts} label="Published" />
        <Stat value={counts.drafts} label="Drafts" />
        <Stat value={counts.members} label="On roster" />
        <Stat value={counts.hours.toFixed(0)} label="Hours logged" />
      </div>

      <div className="mb-6 inline-flex flex-wrap rounded-xl border border-[var(--line)] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-navy-600 text-white' : 'muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'posts' && <PostsTab />}
      {tab === 'hours' && <HoursTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
