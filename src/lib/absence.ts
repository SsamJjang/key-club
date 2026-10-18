import { supabase } from './supabase'
import { dayKey, isRecurring, occurrences } from './format'
import type { EventAbsence, Post } from './types'

/**
 * "Can't make it" / "Running late" notices.
 *
 * `occurs_on` follows event_signups exactly: null for a single-date event,
 * the day key for one date of a series. Anything matching a notice to a
 * date goes through `absencesOn` so that rule lives in one place.
 */

/** How far ahead a notice has to come to count as advance notice. */
export const ADVANCE_HOURS = 12

export const ABSENCE_SELECT = '*, profile:profiles!user_id(id, full_name, avatar_url, grade)'

export const KIND_LABEL: Record<EventAbsence['kind'], string> = {
  absent: 'Can’t make it',
  late: 'Running late',
}

/** The notices for one date — for a single-date event, all of them. */
export function absencesOn<T extends Pick<EventAbsence, 'occurs_on'>>(
  post: Post,
  rows: T[],
  date: Date | null,
): T[] {
  if (!isRecurring(post) || !date) return rows
  const key = dayKey(date)
  return rows.filter((r) => r.occurs_on === key)
}

/** When the date a notice is about starts. Null for an undated event. */
export function startOf(post: Post, occursOn: string | null): Date | null {
  const all = occurrences(post)
  if (occursOn === null) return all[0] ?? null
  return all.find((d) => dayKey(d) === occursOn) ?? null
}

/**
 * Whether the notice came at least ADVANCE_HOURS before the event started.
 * Null when there is no start to measure against.
 */
export function inAdvance(post: Post, a: Pick<EventAbsence, 'occurs_on' | 'sent_at'>): boolean | null {
  const start = startOf(post, a.occurs_on)
  if (!start) return null
  return start.getTime() - new Date(a.sent_at).getTime() >= ADVANCE_HOURS * 36e5
}

/** "Sent Oct 17, 9:42 PM · 19h before" — the timestamp officers read. */
export function sentLine(post: Post, a: Pick<EventAbsence, 'occurs_on' | 'sent_at'>) {
  const sent = new Date(a.sent_at)
  const stamp = sent.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const start = startOf(post, a.occurs_on)
  if (!start) return `Sent ${stamp}`
  const mins = Math.round((start.getTime() - sent.getTime()) / 6e4)
  if (mins < 0) return `Sent ${stamp} · after it started`
  const lead = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`
  return `Sent ${stamp} · ${lead} before`
}

/**
 * Decline a meeting date, or take the decline back. Declining is just a
 * "can't make it" notice, so officers see it with the rest; a "running
 * late" notice already there becomes "can't make it".
 */
export async function toggleDecline(
  postId: string,
  userId: string,
  occursOn: string | null,
  existing: Pick<EventAbsence, 'id' | 'kind'> | undefined,
) {
  if (existing?.kind === 'absent') {
    return supabase.from('event_absences').delete().eq('id', existing.id)
  }
  if (existing) {
    return supabase.from('event_absences').update({ kind: 'absent', arrives: null }).eq('id', existing.id)
  }
  return supabase
    .from('event_absences')
    .insert({ post_id: postId, user_id: userId, occurs_on: occursOn, kind: 'absent' })
}

export async function loadAbsences(postId?: string) {
  let q = supabase.from('event_absences').select(ABSENCE_SELECT).order('sent_at', { ascending: true })
  if (postId) q = q.eq('post_id', postId)
  const { data, error } = await q
  return { rows: (data as EventAbsence[]) ?? [], error }
}
