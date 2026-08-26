import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Post } from '../lib/types'
import { addSignup, distinctMembers, removeSignup, signupKey } from '../lib/rsvp'
import { Notice, PageHeader, Spinner } from '../components/ui'
import EventCalendar from '../components/EventCalendar'
import type { CalendarEvent } from '../components/EventCalendar'

/**
 * The calendar page.
 *
 * Deliberately thin: it loads events and sign-ups and hands both to the
 * calendar. The list view that used to live here is now the calendar's
 * own Schedule view, so there is one place events are rendered and one
 * set of filters that applies to all of them.
 */
export default function Events() {
  const { profile, isAdmin } = useAuth()
  const [rows, setRows] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [eventsRes, signupsRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*')
        .eq('published', true)
        .eq('category', 'event')
        .order('starts_at', { ascending: true }),
      supabase.from('event_signups').select('post_id, user_id, occurs_on'),
    ])

    if (eventsRes.error) setError(eventsRes.error.message)

    const signups =
      (signupsRes.data as { post_id: string; user_id: string; occurs_on: string | null }[]) ?? []
    const events = (eventsRes.data as Post[]) ?? []

    setRows(
      events.map((e) => {
        const mine = signups.filter((s) => s.post_id === e.id)
        return {
          ...e,
          // A member down for five dates of a series is still one member going.
          going: distinctMembers(mine),
          mine: mine.some((s) => s.user_id === profile?.id),
          signups: mine,
        }
      }),
    )
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * RSVP straight from the calendar, so signing up never costs a page
   * load. `day` is the occurrence that was clicked; for a series it
   * decides which date the sign-up is for, and is ignored for a one-date
   * event.
   */
  const toggleRsvp = useCallback(
    async (event: CalendarEvent, day: Date | null) => {
      if (!profile) return
      setBusyId(event.id)
      setError(null)

      const key = signupKey(event, day)
      const has = event.signups.some((s) => s.user_id === profile.id && s.occurs_on === key)

      const { error } = has
        ? await removeSignup(event.id, profile.id, key)
        : await addSignup(event.id, profile.id, key)

      if (error) setError(error.message)
      await load()
      setBusyId(null)
    },
    [profile, load],
  )

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Calendar"
        title="Events"
        subtitle="Service projects, meetings, and everything worth showing up for. Click any event to sign up without leaving the grid."
      />

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <EventCalendar
          events={rows}
          onRsvp={toggleRsvp}
          busyId={busyId}
          isAdmin={isAdmin}
          userId={profile?.id ?? null}
        />
      )}
    </div>
  )
}
