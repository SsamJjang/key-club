import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { MemberHours, Post } from '../lib/types'
import { formatDate, gradeLabel } from '../lib/format'
import { Avatar, Notice, PageHeader, RoleBadge, Spinner, Stat } from '../components/ui'

export default function MyProfile() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [form, setForm] = useState({ phone: '', pronouns: '', bio: '', avatar_url: '' })
  const [hours, setHours] = useState<MemberHours | null>(null)
  const [rsvps, setRsvps] = useState<Post[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    setForm({
      phone: profile.phone ?? '',
      pronouns: profile.pronouns ?? '',
      bio: profile.bio ?? '',
      avatar_url: profile.avatar_url ?? '',
    })

    let cancelled = false
    Promise.all([
      supabase.from('member_hours').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase
        .from('event_signups')
        .select('post:posts!post_id(*)')
        .eq('user_id', profile.id),
    ]).then(([h, s]) => {
      if (cancelled) return
      setHours(h.data as MemberHours | null)
      setRsvps(
        ((s.data as { post: Post | null }[] | null) ?? [])
          .map((r) => r.post)
          .filter((p): p is Post => Boolean(p))
          .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '')),
      )
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [profile])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase
      .from('profiles')
      .update({
        phone: form.phone.trim() || null,
        pronouns: form.pronouns.trim() || null,
        bio: form.bio.trim() || null,
        avatar_url: form.avatar_url.trim() || null,
      })
      .eq('id', profile.id)

    if (error) setMsg({ tone: 'error', text: error.message })
    else {
      setMsg({ tone: 'success', text: 'Saved.' })
      await refreshProfile()
    }
    setSaving(false)
  }

  if (!profile) return <Spinner />

  const upcoming = rsvps.filter((r) => !r.starts_at || new Date(r.starts_at) >= new Date())

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Your account"
        title="My profile"
        subtitle="Name, grade, and role come from the club roster — an officer changes those. The rest is yours."
        action={
          <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-6">
          <section className="card p-6 text-center">
            <div className="flex justify-center">
              <Avatar name={profile.full_name} url={profile.avatar_url} size={96} />
            </div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                {profile.full_name}
              </h2>
              <RoleBadge role={profile.role} />
            </div>
            <p className="mt-1 text-sm muted">{profile.email}</p>
            <p className="mt-1 text-sm muted">
              {[
                gradeLabel(profile.grade),
                profile.graduation_year ? `Class of ${profile.graduation_year}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <Stat value={Number(hours?.approved_hours ?? 0).toFixed(1)} label="Approved hrs" />
            <Stat value={Number(hours?.pending_hours ?? 0).toFixed(1)} label="Pending hrs" />
          </div>

          <section className="card p-6">
            <h2 className="label">Upcoming RSVPs</h2>
            {loading ? (
              <p className="mt-3 text-sm muted">Loading…</p>
            ) : upcoming.length === 0 ? (
              <p className="mt-3 text-sm muted">
                None yet. <Link to="/events" className="underline">Browse events</Link>.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <Link to={`/post/${r.slug}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <span className="muted">{formatDate(r.starts_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <form onSubmit={save} className="card space-y-5 p-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Edit your details
          </h2>

          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="phone">Phone</label>
              <input
                id="phone"
                className="field"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="label" htmlFor="pronouns">Pronouns</label>
              <input
                id="pronouns"
                className="field"
                value={form.pronouns}
                onChange={(e) => setForm({ ...form, pronouns: e.target.value })}
                placeholder="they/them"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="avatar">Photo URL</label>
            <input
              id="avatar"
              className="field"
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              placeholder="https://…"
            />
          </div>

          <div>
            <label className="label" htmlFor="bio">About you</label>
            <textarea
              id="bio"
              rows={5}
              className="field resize-y"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="What brought you to Key Club?"
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  )
}
