import { supabase } from './supabase'
import { dayKey, isRecurring, occurrences } from './format'
import type { Post } from './types'

/**
 * Sign-ups, which are per-date once an event repeats.
 *
 * `occurs_on` is null for a single-date event and for one with no date yet —
 * "I'm coming to this event" needs no date to disambiguate. A series stores
 * one row per date the member picked, so nothing has to guess whether an
 * empty date means "all of them" or "none of them".
 */

export type SignupRow = { user_id: string; occurs_on: string | null }

/** The date key a sign-up should carry, given what the member clicked. */
export function signupKey(post: Post, date: Date | null): string | null {
  return isRecurring(post) && date ? dayKey(date) : null
}

/** Rows that count towards a given date — for a series, only that date's. */
export function signupsOn<T extends SignupRow>(post: Post, rows: T[], date: Date | null): T[] {
  if (!isRecurring(post)) return rows
  if (!date) return rows
  const key = dayKey(date)
  return rows.filter((r) => r.occurs_on === key)
}

/** Distinct members attending at least one date. */
export function distinctMembers(rows: SignupRow[]) {
  return new Set(rows.map((r) => r.user_id)).size
}

/** How many dates of this event a given member has said yes to. */
export function datesFor(rows: SignupRow[], userId: string) {
  return rows.filter((r) => r.user_id === userId).length
}

export async function addSignup(postId: string, userId: string, occursOn: string | null) {
  return supabase.from('event_signups').insert({
    post_id: postId,
    user_id: userId,
    occurs_on: occursOn,
  })
}

export async function removeSignup(postId: string, userId: string, occursOn: string | null) {
  const q = supabase.from('event_signups').delete().eq('post_id', postId).eq('user_id', userId)
  // .eq() against null matches nothing in PostgREST — null needs .is().
  return occursOn === null ? q.is('occurs_on', null) : q.eq('occurs_on', occursOn)
}

/** Sign up for every date of a series that has not already happened. */
export async function addRemainingDates(post: Post, userId: string, existing: SignupRow[]) {
  const taken = new Set(existing.filter((r) => r.user_id === userId).map((r) => r.occurs_on))
  const rows = occurrences(post)
    .filter((d) => d.getTime() >= Date.now())
    .map((d) => dayKey(d))
    .filter((key) => !taken.has(key))
    .map((key) => ({ post_id: post.id, user_id: userId, occurs_on: key }))

  if (rows.length === 0) return { error: null, added: 0 }
  const { error } = await supabase.from('event_signups').insert(rows)
  return { error, added: rows.length }
}

/** Drop every date this member is signed up for on this event. */
export async function removeAllSignups(postId: string, userId: string) {
  return supabase.from('event_signups').delete().eq('post_id', postId).eq('user_id', userId)
}
