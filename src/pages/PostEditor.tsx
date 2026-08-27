import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ColorPicker from '../components/ColorPicker'
import EventSchedule from '../components/EventSchedule'
import ImageUpload from '../components/ImageUpload'
import RichTextEditor from '../components/RichTextEditor'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Category, Post } from '../lib/types'
import { slugify } from '../lib/format'
import { isColorKey, type EventColorKey } from '../lib/eventColors'
import { BLANK_SCHEDULE, fromPost, toPayload, type ScheduleForm } from '../lib/schedule'
import { Notice, PageHeader, Spinner } from '../components/ui'

const BLANK = {
  title: '',
  slug: '',
  summary: '',
  body: '',
  // Events are the overwhelming majority of what gets posted, and they have
  // the most fields to fill in — so they are what the form opens on.
  category: 'event' as Category,
  cover_url: '',
  pinned: false,
  published: false,
  location: '',
  service_hours: '',
  hours_tbd: false,
  capacity: '',
  signup_open: true,
  color: null as EventColorKey | null,
  calendar_label: '',
}

export default function PostEditor() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [form, setForm] = useState(BLANK)
  // Clicking an empty day or hour on the calendar lands here with the slot
  // already filled in, which is the difference between "add an event" being
  // a chore and being a click.
  const [schedule, setSchedule] = useState<ScheduleForm>(() =>
    isNew
      ? {
          ...BLANK_SCHEDULE,
          start_date: params.get('date') ?? '',
          start_time: params.get('time') ?? '',
        }
      : BLANK_SCHEDULE,
  )
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
            location: p.location ?? '',
            service_hours: p.service_hours != null ? String(p.service_hours) : '',
            hours_tbd: p.hours_tbd,
            capacity: p.capacity != null ? String(p.capacity) : '',
            signup_open: p.signup_open,
            color: isColorKey(p.color) ? p.color : null,
            calendar_label: p.calendar_label ?? '',
          })
          setSchedule(fromPost(p))
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

    // A news post or notice keeps none of the event columns, so switching an
    // event back to "News article" clears its dates rather than leaving them
    // to haunt the calendar.
    const dates = isEvent
      ? toPayload(schedule)
      : { starts_at: null, ends_at: null, event_dates: null, recurrence_note: null, all_day: false }

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
      ...dates,
      location: isEvent ? form.location.trim() || null : null,
      // TBD and a number are mutually exclusive — the database enforces it too.
      service_hours: isEvent && !form.hours_tbd && form.service_hours ? Number(form.service_hours) : null,
      hours_tbd: isEvent && form.hours_tbd,
      capacity: isEvent && form.capacity ? Number(form.capacity) : null,
      signup_open: isEvent ? form.signup_open : true,
      // Colour is a calendar concern, so it travels with events only.
      color: isEvent ? form.color : null,
      calendar_label: isEvent ? form.calendar_label.trim() || null : null,
    }

    const { error } = isNew
      ? await supabase.from('posts').insert(payload)
      : await supabase.from('posts').update(payload).eq('id', id!)

    if (error) {
      // PGRST204 is "I don't know that column". For this form it almost
      // always means a migration has not been run yet, and the raw message
      // ("Could not find the 'color' column of 'posts'") sends people
      // hunting through the app instead of the SQL editor.
      const missing = error.code === 'PGRST204' && /color|calendar_label/.test(error.message)

      setError(
        error.code === '23505'
          ? 'That slug is already taken — pick a different one.'
          : missing
            ? 'The database is missing the event-colour columns. Run supabase/006_event_colors.sql in the Supabase SQL editor, then reload this page. (If you just ran it, run NOTIFY pgrst, \'reload schema\'; too — the API caches the schema.)'
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
        title={isNew ? 'New event' : form.title || 'Untitled'}
        subtitle="Events, news, and notices all live here. Switch Type to News or Notice for a post with no date."
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
                  <option value="event">Event</option>
                  <option value="news">News article</option>
                  <option value="notice">Notice</option>
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
              <h2 className="label">When</h2>
              <EventSchedule value={schedule} onChange={setSchedule} />

              <div className="border-t border-[var(--line)] pt-4">
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
                    value={form.hours_tbd ? '' : form.service_hours}
                    disabled={form.hours_tbd}
                    placeholder={form.hours_tbd ? 'TBD' : 'None'}
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
                  checked={form.hours_tbd}
                  onChange={(e) => setForm({ ...form, hours_tbd: e.target.checked })}
                  className="size-4"
                />
                <span>
                  Service hours are TBD
                  <span className="block text-xs muted">
                    Shows “TBD” instead of a number, so members still sign up.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.signup_open}
                  onChange={(e) => setForm({ ...form, signup_open: e.target.checked })}
                  className="size-4"
                />
                Sign-ups open
              </label>

              <div className="border-t border-[var(--line)] pt-4">
                <ColorPicker
                  value={form.color}
                  label={form.calendar_label}
                  onChange={(color) => setForm({ ...form, color })}
                  onLabel={(calendar_label) => setForm({ ...form, calendar_label })}
                />
              </div>
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
