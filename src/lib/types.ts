export type Role = 'member' | 'officer' | 'admin'
export type Category = 'news' | 'notice' | 'event'
export type HoursStatus = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  email: string
  full_name: string
  grade: number | null
  graduation_year: number | null
  phone: string | null
  role: Role
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
  location: string | null
  service_hours: number | null
  capacity: number | null
  signup_open: boolean
  created_at: string
  updated_at: string
  author?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'title'> | null
}

export interface EventSignup {
  post_id: string
  user_id: string
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
  email_from: string
  email_reply_to: string | null
  weekly_email_enabled: boolean
  site_url: string | null
}
