import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { Avatar } from './ui'

type Pickable = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grade' | 'email'>

/**
 * Officer-only search box that puts a member on the date on screen.
 *
 * Only active roster members are offered — RLS (011) refuses anyone else,
 * so listing them would just be a button that errors.
 */
export default function AddMemberPicker({
  exclude,
  disabled,
  onPick,
}: {
  /** Already on this date — not offered again. */
  exclude: Set<string>
  disabled?: boolean
  onPick: (userId: string) => void
}) {
  const [people, setPeople] = useState<Pickable[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [{ data: profiles }, { data: roster }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, grade, email').order('full_name'),
        supabase.from('members').select('email').eq('active', true),
      ])
      if (cancelled) return
      const active = new Set(((roster as { email: string }[]) ?? []).map((m) => m.email.toLowerCase()))
      setPeople(((profiles as Pickable[]) ?? []).filter((p) => active.has(p.email.toLowerCase())))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people
      .filter((p) => !exclude.has(p.id))
      .filter((p) => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [people, exclude, query])

  function pick(id: string) {
    onPick(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative mt-3 max-w-sm">
      <input
        type="search"
        className="field py-1.5 text-sm"
        placeholder="Add a member…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Long enough for a click on a result to land before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault()
            pick(matches[0].id)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && query.trim() && (
        <ul className="card absolute z-20 mt-1 w-full overflow-hidden p-1 shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm muted">No one to add by that name.</li>
          ) : (
            matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--surface)]"
                >
                  <Avatar name={p.full_name} url={p.avatar_url} size={24} />
                  <span className="flex-1">{p.full_name}</span>
                  {p.grade && <span className="text-xs muted">Gr {p.grade}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
