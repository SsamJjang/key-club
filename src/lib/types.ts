export type Role = 'member' | 'officer' | 'admin'
export type Category = 'news' | 'notice' | 'event'
export type HoursStatus = 'pending' | 'approved' | 'rejected'

export interface BoardPosition {
  id: string
  label: string
  sort_order: number
}

export interface Profile {
  id: string
  email: string
  full_name: string
  grade: number | null
  graduation_year: number | null
  phone: string | null
  role: Role
  board_position: string | null
  board?: BoardPosition | null
  avatar_url: string | null
  pronouns: string | null
  title: string | null
  bio: string | null
  created_at: string
  updated_at: string
}

export interface Member {
  email: string
  full_name: string
  grade: number | null
  graduation_year: number | null
  phone: string | null
  role: Role
  board_position: string | null
  active: boolean
  notes: string | null
  created_at: string
}

export interface Post {
  id: string
  slug: string
  title: string
  summary: string | null
  body: string
  category: Category
  cover_url: string | null
  pinned: boolean
  published: boolean
  author_id: string | null
  starts_at: string | null
  ends_at: string | null
  /** Every date in the series, the first included. Null/empty = one occurrence. */
  event_dates: string[] | null
  /** Display-only sentence describing the series, e.g. "Every Wed until Dec 17". */
  recurrence_note: string | null
  /** Date known, time not. starts_at is midnight local; render no time. */
  all_day: boolean
  location: string | null
  service_hours: number | null
  /** Hours are coming but undecided — distinct from service_hours being null. */
  hours_tbd: boolean
  capacity: number | null
  signup_open: boolean
  /**
   * One of the named palette colours in `lib/eventColors`. Null means the
   * category's default. The calendar filters and legends on this, so it is
   * an organising tool rather than decoration.
   */
  color: string | null
  /** What the colour MEANS here — "Service", "Board meeting". Optional. */
  calendar_label: string | null
  created_at: string
  updated_at: string
  author?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'title'> | null
}

export interface EventSignup {
  id: string
  post_id: string
  user_id: string
  /**
   * Which date of a series this is for. Null means "the event" — the shape
   * for a single-date event, and for one with no date set yet.
   */
  occurs_on: string | null
  status: 'going' | 'waitlist'
  attended: boolean
  created_at: string
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grade'> | null
}

export interface HoursEntry {
  id: string
  user_id: string
  post_id: string | null
  hours: number
  description: string
  served_on: string
  status: HoursStatus
  review_note: string | null
  reviewed_by: string | null
  created_by: string | null
  reviewed_at: string | null
  created_at: string
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grade'> | null
  post?: Pick<Post, 'id' | 'slug' | 'title'> | null
}

export interface MemberHours {
  user_id: string
  approved_hours: number
  pending_hours: number
}

export interface FundraiserEntry {
  id: string
  user_id: string
  post_id: string | null
  activity: string
  participated_on: string
  note: string | null
  created_by: string | null
  created_at: string
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grade'> | null
  post?: Pick<Post, 'id' | 'slug' | 'title'> | null
}

/** One member's standing against the per-semester fundraiser requirement. */
export interface MemberFundraisers {
  user_id: string
  /** "Fall 2026", "Spring 2027" — the window being measured. */
  semester: string
  semester_count: number
  total_count: number
  last_participated_on: string | null
  required: number
  requirement_met: boolean
}

export const ROLE_LABEL: Record<Role, string> = {
  member: 'Member',
  officer: 'Officer',
  admin: 'Admin',
}

export const CATEGORY_LABEL: Record<Category, string> = {
  news: 'News',
  notice: 'Notice',
  event: 'Event',
}

export function canPublish(role: Role | undefined) {
  return role === 'admin' || role === 'officer'
}

export interface ClubSettings {
  id: boolean
  club_name: string
  school_year: string
  hours_goal: number
  /** Current school year's semester boundaries, 'YYYY-MM-DD'. */
  fall_semester_start: string
  spring_semester_start: string
  /** Fundraiser activities each member must join per semester. */
  fundraisers_required: number
  email_from: string
  email_reply_to: string | null
  weekly_email_enabled: boolean
  site_url: string | null
}
