import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ImageUpload from '../components/ImageUpload'
import RichTextEditor from '../components/RichTextEditor'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Category, Post } from '../lib/types'
import { slugify } from '../lib/format'
import { Notice, PageHeader, Spinner } from '../components/ui'

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const BLANK = {
  title: '',
  slug: '',
  summary: '',
  body: '',
  category: 'news' as Category,
  cover_url: '',
  pinned: false,
  published: false,
  starts_at: '',
  ends_at: '',
  location: '',
  service_hours: '',
  capacity: '',
  signup_open: true,
}

export default function PostEditor() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState(BLANK)
  const [slugTouched, setSlugTouched] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    let cancelled = false

    supabase
      .from('posts')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        const p = data as Post | null
        if (p) {
          setForm({
            title: p.title,
            slug: p.slug,
            summary: p.summary ?? '',
            body: p.body,
            category: p.category,
            cover_url: p.cover_url ?? '',
            pinned: p.pinned,
            published: p.published,
            starts_at: toLocalInput(p.starts_at),
            ends_at: toLocalInput(p.ends_at),
            location: p.location ?? '',
            service_hours: p.service_hours != null ? String(p.service_hours) : '',
            capacity: p.capacity != null ? String(p.capacity) : '',
            signup_open: p.signup_open,
          })
          setSlugTouched(true)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, isNew])

  const isEvent = form.category === 'event'


  function setTitle(title: string) {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }))
  }

  async function save(publish?: boolean) {
    setSaving(true)
    setError(null)

    const payload = {
      title: form.title.trim(),
      slug: (form.slug.trim() || slugify(form.title)).toLowerCase(),
      summary: form.summary.trim() || null,
      body: form.body,
      category: form.category,
      cover_url: form.cover_url.trim() || null,
      pinned: form.pinned,
      published: publish ?? form.published,
      author_id: profile?.id ?? null,
      starts_at: isEvent && form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: isEvent && form.ends_at ? new Date(form.ends_at).toISOString() : null,
      location: isEvent ? form.location.trim() || null : null,
      service_hours: isEvent && form.service_hours ? Number(form.service_hours) : null,
      capacity: isEvent && form.capacity ? Number(form.capacity) : null,
      signup_open: isEvent ? form.signup_open : true,
    }

    const { error } = isNew
      ? await supabase.from('posts').insert(payload)
      : await supabase.from('posts').update(payload).eq('id', id!)

    if (error) {
      setError(
        error.code === '23505'
          ? 'That slug is already taken — pick a different one.'
          : error.message,
      )
      setSaving(false)
      return
    }

    navigate('/admin')
  }

  if (loading) return <Spinner />

  return (
    <div className="rise">
      <PageHeader
        eyebrow={isNew ? 'New' : 'Editing'}
        title={isNew ? 'Write a post' : form.title || 'Untitled'}
        subtitle="News, notices, and events all live here. Pick Event to unlock date, location, and sign-ups."
        action={
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/admin')}>
            Cancel
          </button>
        }
      />

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="grid gap-8 lg:grid-cols-[1.5fr_1fr]"
      >
        <div className="space-y-5">
          <div className="card space-y-5 p-6">
            <div>
              <label className="label" htmlFor="title">Title</label>
              <input
                id="title"
                required
                className="field"
                value={form.title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fall food drive wraps up with 1,200 cans"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="category">Type</label>
                <select
                  id="category"
                  className="field"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                >
                  <option value="news">News article</option>
                  <option value="notice">Notice</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="slug">URL slug</label>
                <input
                  id="slug"
                  className="field"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setForm({ ...form, slug: e.target.value })
                  }}
                  placeholder="fall-food-drive"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="summary">Summary</label>
              <input
                id="summary"
                className="field"
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                placeholder="One sentence for the card and the top of the article."
              />
            </div>

            <div>
              <span className="label">Body</span>
              <RichTextEditor
                value={form.body}
                onChange={(html) => setForm((f) => ({ ...f, body: html }))}
                placeholder="Write the story. Use the toolbar for headings, bold, lists, links, and images."
              />
              <p className="mt-1 text-xs muted">
                Formatting works like a document — select text, then click a button. Ctrl+B, Ctrl+I,
                and Ctrl+U work too.
              </p>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="card space-y-4 p-6">
            <h2 className="label">Publishing</h2>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setForm({ ...form, published: e.target.checked })}
                className="size-4"
              />
              Published (visible to all members)
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                className="size-4"
              />
              Pin to the top of the home page
            </label>
            <ImageUpload
              bucket="post-images"
              folder="covers"
              label="Cover image"
              value={form.cover_url}
              onChange={(url) => setForm({ ...form, cover_url: url })}
              hint="Shown on cards and at the top of the article."
            />
          </div>

          {isEvent && (
            <div className="card space-y-4 p-6">
              <h2 className="label">Event details</h2>
              <div>
                <label className="label" htmlFor="starts">Starts</label>
                <input
                  id="starts"
                  type="datetime-local"
                  className="field"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="ends">Ends</label>
                <input
                  id="ends"
                  type="datetime-local"
                  className="field"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="location">Location</label>
                <input
                  id="location"
                  className="field"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Community food bank"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="sh">Service hours</label>
                  <input
                    id="sh"
                    type="number"
                    step="0.5"
                    min="0"
                    className="field"
                    value={form.service_hours}
                    onChange={(e) => setForm({ ...form, service_hours: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="cap">Capacity</label>
                  <input
                    id="cap"
                    type="number"
                    min="1"
                    className="field"
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    placeholder="No limit"
                  />
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.signup_open}
                  onChange={(e) => setForm({ ...form, signup_open: e.target.checked })}
                  className="size-4"
                />
                Sign-ups open
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn btn-ghost flex-1" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={saving}
              onClick={() => void save(true)}
            >
              Save & publish
            </button>
          </div>
        </aside>
      </form>
    </div>
  )
}
