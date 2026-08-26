import type { Category } from './types'

/**
 * The event palette.
 *
 * Named colours rather than hex codes, for the same reason Google
 * Calendar uses them: a fixed vocabulary is something you can filter by,
 * legend, and keep readable on both themes. The hex here is the *seed* —
 * the stylesheet mixes it against the surface to produce the chip fill
 * and text colour, so one value covers light and dark.
 */

export type EventColorKey =
  | 'tomato'
  | 'flamingo'
  | 'tangerine'
  | 'banana'
  | 'sage'
  | 'basil'
  | 'peacock'
  | 'blueberry'
  | 'lavender'
  | 'grape'
  | 'graphite'

export interface EventColor {
  key: EventColorKey
  label: string
  hex: string
}

export const EVENT_COLORS: EventColor[] = [
  { key: 'tomato', label: 'Tomato', hex: '#d93025' },
  { key: 'flamingo', label: 'Flamingo', hex: '#e2756b' },
  { key: 'tangerine', label: 'Tangerine', hex: '#ef6c1a' },
  { key: 'banana', label: 'Banana', hex: '#d99e00' },
  { key: 'sage', label: 'Sage', hex: '#33b679' },
  { key: 'basil', label: 'Basil', hex: '#0b8043' },
  { key: 'peacock', label: 'Peacock', hex: '#0288d1' },
  { key: 'blueberry', label: 'Blueberry', hex: '#3f51b5' },
  { key: 'lavender', label: 'Lavender', hex: '#7986cb' },
  { key: 'grape', label: 'Grape', hex: '#8e24aa' },
  { key: 'graphite', label: 'Graphite', hex: '#5f6368' },
]

const BY_KEY = new Map(EVENT_COLORS.map((c) => [c.key, c]))

/**
 * What an uncoloured post shows as. Events default to the club blue;
 * news and notices only ever appear on the calendar as context, so they
 * stay deliberately quiet.
 */
const CATEGORY_DEFAULT: Record<Category, EventColorKey> = {
  event: 'peacock',
  news: 'graphite',
  notice: 'banana',
}

export function isColorKey(value: unknown): value is EventColorKey {
  return typeof value === 'string' && BY_KEY.has(value as EventColorKey)
}

/** The colour to paint a post with — its own, or its category's default. */
export function colorOf(post: { color?: string | null; category?: Category }): EventColorKey {
  if (isColorKey(post.color)) return post.color
  return CATEGORY_DEFAULT[post.category ?? 'event'] ?? 'peacock'
}

export function colorLabel(key: EventColorKey) {
  return BY_KEY.get(key)?.label ?? 'Peacock'
}

export function colorHex(key: EventColorKey) {
  return BY_KEY.get(key)?.hex ?? '#0288d1'
}

/**
 * What a colour is being USED for on this calendar.
 *
 * Officers can put a word on a colour — "Service", "Board" — and that
 * word is what the legend and the filter list show. Derived from the
 * events themselves rather than stored in a second table, so renaming a
 * colour's meaning is one edit on one event away and never goes stale.
 */
export function labelForColor(
  key: EventColorKey,
  events: { color?: string | null; category?: Category; calendar_label?: string | null }[],
) {
  const named = events.find((e) => colorOf(e) === key && e.calendar_label?.trim())
  return named?.calendar_label?.trim() || colorLabel(key)
}
