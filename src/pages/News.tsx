import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Post } from '../lib/types'
import PostCard from '../components/PostCard'
import { EmptyState, Notice, PageHeader, Spinner } from '../components/ui'

const FILTERS: { key: 'all' | Category; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'news', label: 'News' },
  { key: 'notice', label: 'Notices' },
  { key: 'event', label: 'Events' },
]

export default function News() {
  const [posts, setPosts] = useState<Post[]>([])
  const [filter, setFilter] = useState<'all' | Category>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('posts')
      .select('*, author:profiles!author_id(id, full_name, avatar_url, title)')
      .eq('published', true)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        setPosts((data as Post[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return posts.filter((p) => {
      if (filter !== 'all' && p.category !== filter) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        (p.summary ?? '').toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q)
      )
    })
  }, [posts, filter, query])

  return (
    <div className="rise">
      <PageHeader
        eyebrow="The feed"
        title="News & notices"
        subtitle="GCS Key Club events, activities, and loving heart at a glance."
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filter === f.key
                  ? 'bg-navy-600 text-white'
                  : 'border border-[var(--line)] muted hover:border-navy-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search posts…"
          className="field sm:ml-auto sm:w-64"
          aria-label="Search posts"
        />
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState icon="🔍" title="Nothing matches">
          Try a different filter or search term.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  )
}
