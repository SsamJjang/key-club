import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { BoardPosition, Member, Role } from '../../lib/types'
import { formatPhone, gradeLabel } from '../../lib/format'
import { EmptyState, Notice, Spinner } from '../ui'

const BLANK = {
  email: '',
  full_name: '',
  grade: '',
  graduation_year: '',
  phone: '',
  role: 'member' as Role,
  board_position: '',
  active: true,
  notes: '',
}

type Draft = typeof BLANK

function toDraft(m: Member): Draft {
  return {
    email: m.email,
    full_name: m.full_name,
    grade: m.grade != null ? String(m.grade) : '',
    graduation_year: m.graduation_year != null ? String(m.graduation_year) : '',
    phone: m.phone ?? '',
    role: m.role,
    board_position: m.board_position ?? '',
    active: m.active,
    notes: m.notes ?? '',
  }
}

export default function MembersTab() {
  const { profile } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [positions, setPositions] = useState<BoardPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [memberRes, positionRes] = await Promise.all([
      supabase.from('members').select('*').order('full_name'),
      supabase.from('board_positions').select('*').order('sort_order'),
    ])
    if (memberRes.error) setMsg({ tone: 'error', text: memberRes.error.message })
    setMembers((memberRes.data as Member[]) ?? [])
    setPositions((positionRes.data as BoardPosition[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function payload(d: Draft) {
    return {
      email: d.email.trim().toLowerCase(),
      full_name: d.full_name.trim(),
      grade: d.grade ? Number(d.grade) : null,
      graduation_year: d.graduation_year ? Number(d.graduation_year) : null,
      phone: d.phone.trim() || null,
      role: d.role,
      board_position: d.board_position || null,
      active: d.active,
      notes: d.notes.trim() || null,
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)

    const body = payload(draft)
    const { error } = adding
      ? await supabase.from('members').insert(body)
      : await supabase.from('members').update(body).eq('email', editing!)

    if (error) {
      setMsg({
        tone: 'error',
        text:
          error.code === '23505'
            ? 'That email is already on the roster.'
            : `${error.message} (you cannot remove your own admin access)`,
      })
    } else {
      setMsg({ tone: 'success', text: adding ? 'Member added.' : 'Member updated.' })
      setEditing(null)
      setAdding(false)
      setDraft(BLANK)
      await load()
    }
    setSaving(false)
  }

  async function toggleActive(m: Member) {
    const { error } = await supabase
      .from('members')
      .update({ active: !m.active })
      .eq('email', m.email)
    if (error) setMsg({ tone: 'error', text: error.message })
    await load()
  }

  async function hardDelete(m: Member) {
    const ok = window.confirm(
      `Permanently remove ${m.full_name} (${m.email}) from the roster?\n\n` +
        'They lose access immediately. Their logged hours and profile stay in the ' +
        'database but become orphaned.\n\n' +
        'If you just want to revoke access, use Deactivate instead.',
    )
    if (!ok) return

    const { error } = await supabase.from('members').delete().eq('email', m.email)
    if (error) setMsg({ tone: 'error', text: error.message })
    else setMsg({ tone: 'success', text: `${m.full_name} removed.` })
    await load()
  }

  const q = query.trim().toLowerCase()
  const visible = members.filter(
    (m) => !q || m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
  )

  const form = (
    <form onSubmit={save} className="card mb-4 space-y-4 p-5">
      <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
        {adding ? 'Add a member' : `Editing ${draft.full_name || draft.email}`}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Email (their Google address)</label>
          <input
            type="email"
            required
            disabled={!adding}
            className="field disabled:opacity-60"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="student@faystonsongdo.org"
          />
        </div>
        <div>
          <label className="label">Full name</label>
          <input
            required
            className="field"
            value={draft.full_name}
            onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Grade</label>
          <select
            className="field"
            value={draft.grade}
            onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
          >
            <option value="">—</option>
            {[9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Graduation year</label>
          <input
            type="number"
            min="2000"
            max="2100"
            className="field"
            value={draft.graduation_year}
            onChange={(e) => setDraft({ ...draft, graduation_year: e.target.value })}
            placeholder="2027"
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="field"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Rank (site access)</label>
          <select
            className="field"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
          >
            <option value="member">Member</option>
            <option value="officer">Officer</option>
            <option value="admin">Admin</option>
          </select>
          <p className="mt-1 text-xs muted">Who can write posts and log hours.</p>
        </div>
        <div>
          <label className="label">Board position</label>
          <select
            className="field"
            value={draft.board_position}
            onChange={(e) => setDraft({ ...draft, board_position: e.target.value })}
          >
            <option value="">No position</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs muted">
            The elected title. Separate from rank — grants no access by itself.
          </p>
        </div>
      </div>

      <div>
        <label className="label">Notes (officers only)</label>
        <input
          className="field"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Joined mid-year, transfers from…"
        />
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={draft.active}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
        />
        Active (can sign in)
      </label>

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : adding ? 'Add member' : 'Save changes'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setAdding(false)
            setEditing(null)
            setDraft(BLANK)
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )

  return (
    <div>
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="field sm:w-72"
          placeholder="Search the roster…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!adding && !editing && (
          <button
            type="button"
            className="btn btn-primary ml-auto"
            onClick={() => {
              setAdding(true)
              setDraft(BLANK)
            }}
          >
            + Add member
          </button>
        )}
      </div>

      {(adding || editing) && form}

      <Notice>
        Adding someone here is what lets them sign in. They still have to log in with Google using
        this exact address — there is no invite email.
      </Notice>

      {loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon="👥" title="Nobody matches that" />
        </div>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left">
                {['Name', 'Email', 'Grade', 'Position', 'Rank', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const isSelf = m.email.toLowerCase() === profile?.email.toLowerCase()
                return (
                  <tr key={m.email} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {m.full_name}
                      {isSelf && <span className="ml-2 text-xs muted">(you)</span>}
                      {m.phone && (
                        <div className="text-xs muted">{formatPhone(m.phone)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 muted">{m.email}</td>
                    <td className="px-4 py-2.5">
                      {m.grade ?? '—'}
                      {m.graduation_year && (
                        <span className="muted"> · ’{String(m.graduation_year).slice(2)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {positions.find((p) => p.id === m.board_position)?.label ?? (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 capitalize">{m.role}</td>
                    <td className="px-4 py-2.5">
                      {m.active ? (
                        <span className="text-emerald-600 dark:text-emerald-300">Active</span>
                      ) : (
                        <span className="muted">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost py-1 text-xs"
                          onClick={() => {
                            setEditing(m.email)
                            setAdding(false)
                            setDraft(toDraft(m))
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost py-1 text-xs"
                          disabled={isSelf}
                          title={isSelf ? 'You cannot deactivate yourself' : undefined}
                          onClick={() => void toggleActive(m)}
                        >
                          {m.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger py-1 text-xs"
                          disabled={isSelf}
                          title={isSelf ? 'You cannot remove yourself' : undefined}
                          onClick={() => void hardDelete(m)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
