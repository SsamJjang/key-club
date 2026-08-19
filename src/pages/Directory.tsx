import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { BoardPosition, MemberHours, Profile, Role } from '../lib/types'
import { gradeLabel } from '../lib/format'
import {
  Avatar,
  BoardBadge,
  EmptyState,
  Notice,
  PageHeader,
  RoleBadge,
  Spinner,
} from '../components/ui'

type SortKey = 'name' | 'grade' | 'hours'

export default function Directory() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [hours, setHours] = useState<Record<string, number>>({})
  const [positions, setPositions] = useState<BoardPosition[]>([])
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<'all' | string>('all')
  const [role, setRole] = useState<'all' | Role>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('member_hours').select('*'),
      supabase.from('board_positions').select('*').order('sort_order'),
    ]).then(([profileRes, hoursRes, positionRes]) => {
      if (cancelled) return
      if (profileRes.error) setError(profileRes.error.message)
      setProfiles((profileRes.data as Profile[]) ?? [])
      setPositions((positionRes.data as BoardPosition[]) ?? [])
      setHours(
        Object.fromEntries(
          ((hoursRes.data as MemberHours[]) ?? []).map((h) => [h.user_id, Number(h.approved_hours)]),
        ),
      )
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = profiles.filter((p) => {
      if (grade !== 'all' && String(p.grade ?? '') !== grade) return false
      if (role !== 'all' && p.role !== role) return false
      if (!q) return true
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q)
      )
    })

    return filtered.sort((a, b) => {
      if (sort === 'hours') return (hours[b.id] ?? 0) - (hours[a.id] ?? 0)
      if (sort === 'grade') return (b.grade ?? 0) - (a.grade ?? 0) || a.full_name.localeCompare(b.full_name)
      return a.full_name.localeCompare(b.full_name)
    })
  }, [profiles, query, grade, role, sort, hours])

  const positionById = useMemo(
    () => Object.fromEntries(positions.map((p) => [p.id, p])),
    [positions],
  )

  // The elected board, in constitutional order.
  const board = useMemo(
    () =>
      profiles
        .filter((p) => p.board_position && positionById[p.board_position])
        .sort(
          (a, b) =>
            positionById[a.board_position!].sort_order - positionById[b.board_position!].sort_order,
        ),
    [profiles, positionById],
  )

  return (
    <div className="rise">
      <PageHeader
        eyebrow="Directory"
        title="Members"
        subtitle={`${profiles.length} ${profiles.length === 1 ? 'person' : 'people'} on the roster.`}
      />

      {board.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            This year’s board
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {board.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/members/${p.id}`}
                  className="card flex h-full flex-col items-center gap-3 p-5 text-center transition hover:border-gold-400"
                >
                  <Avatar name={p.full_name} url={p.avatar_url} size={64} />
                  <div>
                    <p className="font-semibold">{p.full_name}</p>
                    <div className="mt-1.5 flex justify-center">
                      <BoardBadge label={positionById[p.board_position!]?.label} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="field lg:col-span-2"
          aria-label="Search members"
        />
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="field"
          aria-label="Filter by grade"
        >
          <option value="all">All grades</option>
          {[9, 10, 11, 12].map((g) => (
            <option key={g} value={g}>
              {gradeLabel(g)}
            </option>
          ))}
        </select>
        <div className="flex gap-3">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'all' | Role)}
            className="field"
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            <option value="member">Members</option>
            <option value="officer">Officers</option>
            <option value="admin">Admins</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="field"
            aria-label="Sort"
          >
            <option value="name">A–Z</option>
            <option value="grade">By grade</option>
            <option value="hours">By hours</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState icon="🔍" title="No members match that">
          Clear the filters to see the whole roster.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id}>
              <Link
                to={`/members/${p.id}`}
                className="card flex h-full items-start gap-4 p-5 transition hover:border-navy-300 dark:hover:border-navy-600"
              >
                <Avatar name={p.full_name} url={p.avatar_url} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{p.full_name}</p>
                    {p.board_position ? (
                      <BoardBadge label={positionById[p.board_position]?.label} />
                    ) : (
                      <RoleBadge role={p.role} />
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm muted">
                    {p.title ??
                      [
                        gradeLabel(p.grade),
                        p.graduation_year ? `’${String(p.graduation_year).slice(2)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                  </p>
                  <p className="mt-2 text-xs font-medium text-navy-600 dark:text-navy-200">
                    {(hours[p.id] ?? 0).toFixed(1)} hrs served
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
