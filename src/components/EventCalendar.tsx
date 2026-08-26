import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MonthView from './calendar/MonthView'
import TimeGrid from './calendar/TimeGrid'
import AgendaView from './calendar/AgendaView'
import EventPopover from './calendar/EventPopover'
import ShortcutsDialog from './calendar/ShortcutsDialog'
import CalendarSidebar, { type CalendarSettings } from './calendar/CalendarSidebar'
import {
  BLANK_FILTERS,
  addDaysTo,
  addMonths,
  dayKey,
  expand,
  filterEvents,
  filterInstances,
  filtersActive,
  fromDayKey,
  groupByDay,
  instancesOf,
  monthCells,
  startOfDay,
  startOfMonth,
  statusOf,
  undated,
  weekDays,
  type CalendarEvent,
  type CalendarFilters,
  type Instance,
  type ViewMode,
} from '../lib/calendar'
import { downloadIcs, icsForEvents } from '../lib/ics'
import { nextOccurrence } from '../lib/format'

export type { CalendarEvent } from '../lib/calendar'

const VIEWS: [ViewMode, string, string][] = [
  ['day', 'Day', 'D'],
  ['week', 'Week', 'W'],
  ['month', 'Month', 'M'],
  ['agenda', 'Schedule', 'A'],
]

/** How far ahead the schedule view looks. A term, roughly. */
const AGENDA_DAYS = 120

const DEFAULT_SETTINGS: CalendarSettings = {
  weekStart: 0,
  showWeekends: true,
  showWeekNumbers: false,
  workHours: [8, 18],
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Private browsing. Losing a view preference is not worth an error. */
  }
}

/**
 * The club calendar.
 *
 * Built on the three things that make a work calendar usable: one anchor
 * date that each view interprets its own way, filters that narrow rather
 * than navigate, and a click that answers your question in place instead
 * of taking you to another page. Everything below is assembly — the
 * arithmetic lives in `lib/calendar`.
 */
export default function EventCalendar({
  events,
  onRsvp,
  busyId,
  isAdmin = false,
  userId = null,
  clubName = 'Key Club',
}: {
  events: CalendarEvent[]
  onRsvp: (event: CalendarEvent, day: Date | null) => void
  busyId: string | null
  isAdmin?: boolean
  /** Who is looking — decides which dates read as "you're in". */
  userId?: string | null
  clubName?: string
}) {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('kc-cal-view') as ViewMode) || 'month',
  )
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [selected, setSelected] = useState(() => dayKey(new Date()))
  const [filters, setFilters] = useState<CalendarFilters>(() =>
    loadJson('kc-cal-filters', BLANK_FILTERS),
  )
  const [settings, setSettings] = useState<CalendarSettings>(() =>
    loadJson('kc-cal-settings', DEFAULT_SETTINGS),
  )
  const [sidebar, setSidebar] = useState(() => localStorage.getItem('kc-cal-rail') !== 'closed')
  const [openId, setOpenId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [shortcuts, setShortcuts] = useState(false)

  useEffect(() => localStorage.setItem('kc-cal-view', view), [view])
  useEffect(() => save('kc-cal-filters', filters), [filters])
  useEffect(() => save('kc-cal-settings', settings), [settings])
  useEffect(() => localStorage.setItem('kc-cal-rail', sidebar ? 'open' : 'closed'), [sidebar])

  // -------------------------------------------------------------------
  // What is on screen
  // -------------------------------------------------------------------

  const filtered = useMemo(() => filterEvents(events, filters, userId), [events, filters, userId])

  const days = useMemo(() => {
    if (view === 'week') return weekDays(cursor, settings.weekStart, settings.showWeekends)
    if (view === 'day') return [fromDayKey(selected)]
    return []
  }, [view, cursor, selected, settings.weekStart, settings.showWeekends])

  const [from, to] = useMemo((): [Date, Date] => {
    if (view === 'month') {
      const cells = monthCells(cursor, settings.weekStart)
      return [cells[0], cells[cells.length - 1]]
    }
    if (view === 'agenda') {
      const start = startOfDay(cursor)
      return [start, addDaysTo(start, AGENDA_DAYS)]
    }
    const all = days.length > 0 ? days : [fromDayKey(selected)]
    return [all[0], all[all.length - 1]]
  }, [view, cursor, selected, days, settings.weekStart])

  const instances = useMemo(
    () => filterInstances(expand(filtered, from, to), filters),
    [filtered, from, to, filters],
  )

  const byDay = useMemo(() => groupByDay(instances), [instances])

  /** Density dots in the mini month need the whole year, not this month. */
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const event of filtered) {
      for (const instance of instancesOf(event)) {
        map.set(instance.key, (map.get(instance.key) ?? 0) + 1)
      }
    }
    return map
  }, [filtered])

  /** Every instance by id, so an open popover survives a reload of the data. */
  const index = useMemo(() => {
    const map = new Map<string, Instance>()
    for (const event of events) for (const i of instancesOf(event)) map.set(i.id, i)
    return map
  }, [events])

  const open = openId ? (index.get(openId) ?? null) : null
  useEffect(() => {
    if (openId && !index.has(openId)) setOpenId(null)
  }, [openId, index])

  // -------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------

  const goToday = useCallback(() => {
    const now = new Date()
    setCursor(startOfDay(now))
    setSelected(dayKey(now))
  }, [])

  const shift = useCallback(
    (delta: number) => {
      setCursor((c) => {
        if (view === 'month') return addMonths(c, delta)
        if (view === 'week') return addDaysTo(c, delta * 7)
        if (view === 'agenda') return addDaysTo(c, delta * 30)
        return addDaysTo(c, delta)
      })
      if (view === 'day') setSelected((s) => dayKey(addDaysTo(fromDayKey(s), delta)))
    },
    [view],
  )

  const selectDay = useCallback((key: string) => {
    setSelected(key)
    setOpenId(null)
  }, [])

  const moveSelection = useCallback(
    (step: number) => {
      const next = addDaysTo(fromDayKey(selected), step)
      setSelected(dayKey(next))
      if (view === 'month') {
        if (next.getMonth() !== cursor.getMonth()) setCursor(startOfMonth(next))
      } else {
        setCursor(next)
      }
    },
    [selected, cursor, view],
  )

  const jumpTo = useCallback(
    (date: Date) => {
      setCursor(view === 'month' ? startOfMonth(date) : startOfDay(date))
      setSelected(dayKey(date))
      setOpenId(null)
    },
    [view],
  )

  const createOn = useCallback(
    (date: Date) => {
      const params = new URLSearchParams({ date: dayKey(date) })
      if (date.getHours() !== 0) {
        params.set('time', `${String(date.getHours()).padStart(2, '0')}:00`)
      }
      navigate(`/admin/posts/new?${params.toString()}`)
    },
    [navigate],
  )

  // Keep the selected day inside the month being shown, so "the selected
  // day" is always something you can actually see.
  useEffect(() => {
    if (view !== 'month') return
    const sel = fromDayKey(selected)
    if (sel.getMonth() !== cursor.getMonth() || sel.getFullYear() !== cursor.getFullYear()) {
      const today = new Date()
      const sameMonth =
        today.getMonth() === cursor.getMonth() && today.getFullYear() === cursor.getFullYear()
      setSelected(dayKey(sameMonth ? today : startOfMonth(cursor)))
    }
  }, [cursor, view, selected])

  // -------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

      if (typing) {
        // Escape gets you out of the search box without touching the view.
        if (e.key === 'Escape') target.blur()
        return
      }

      // Inside the month grid, the arrows belong to the grid.
      const inGrid = !!target?.closest('[role="grid"]')

      switch (e.key) {
        case 't':
        case 'T':
          goToday()
          break
        case 'd':
        case 'D':
          setView('day')
          break
        case 'w':
        case 'W':
          setView('week')
          break
        case 'm':
        case 'M':
          setView('month')
          break
        case 'a':
        case 'A':
          setView('agenda')
          break
        case 'n':
          shift(1)
          break
        case 'p':
          shift(-1)
          break
        case 'ArrowRight':
          if (inGrid) return
          shift(1)
          break
        case 'ArrowLeft':
          if (inGrid) return
          shift(-1)
          break
        case 'f':
        case 'F':
          setSidebar((s) => !s)
          break
        case 'c':
        case 'C':
          if (isAdmin) createOn(fromDayKey(selected))
          break
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          break
        case '?':
          setShortcuts(true)
          break
        case 'Escape':
          setOpenId(null)
          setShortcuts(false)
          break
        default:
          return
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [goToday, shift, isAdmin, createOn, selected])

  // -------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------

  const title = useMemo(() => {
    if (view === 'month')
      return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

    if (view === 'day')
      return fromDayKey(selected).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })

    if (view === 'agenda')
      return `${from.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} – ${to.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`

    const first = days[0] ?? from
    const last = days[days.length - 1] ?? to
    const sameMonth = first.getMonth() === last.getMonth()
    return `${first.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })} – ${last.toLocaleDateString(
      undefined,
      sameMonth
        ? { day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' },
    )}`
  }, [view, cursor, selected, days, from, to])

  const summary = useMemo(() => {
    const seen = new Set(instances.map((i) => i.event.id))
    const list = filtered.filter((e) => seen.has(e.id))
    if (list.length === 0) return 'Nothing scheduled here'
    const mine = list.filter((e) =>
      userId ? e.signups.some((s) => s.user_id === userId) : e.mine,
    ).length
    const openCount = list.filter((e) => statusOf(e, null, userId) === 'open').length
    return [
      `${list.length} event${list.length === 1 ? '' : 's'}`,
      mine ? `you’re in ${mine}` : '',
      openCount ? `${openCount} open` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }, [instances, filtered, userId])

  const nextUp = useMemo(() => {
    const dated = filtered
      .map((e) => ({ event: e, when: nextOccurrence(e) }))
      .filter((x): x is { event: CalendarEvent; when: Date } => x.when !== null)
    return dated.sort((a, b) => a.when.getTime() - b.when.getTime())[0] ?? null
  }, [filtered])

  const selectedList = byDay.get(selected) ?? []
  const noDate = useMemo(() => undated(filtered), [filtered])

  function openInstance(instance: Instance, rect: DOMRect) {
    setAnchor(rect)
    setOpenId(instance.id)
  }

  function exportAll() {
    downloadIcs(
      `${clubName.toLowerCase().replace(/\s+/g, '-')}-calendar`,
      icsForEvents(filtered, `${clubName} calendar`),
    )
  }

  // -------------------------------------------------------------------

  return (
    <div className={`grid gap-6 ${sidebar ? 'lg:grid-cols-[17rem_minmax(0,1fr)]' : ''}`}>
      {sidebar && (
        <aside className="no-print order-2 lg:order-1">
          <CalendarSidebar
            cursor={cursor}
            selected={selected}
            counts={counts}
            events={events}
            filters={filters}
            settings={settings}
            onPick={jumpTo}
            onFilters={setFilters}
            onSettings={setSettings}
            onExport={exportAll}
          />
        </aside>
      )}

      <div className="order-1 min-w-0 lg:order-2">
        {/* Toolbar */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebar((s) => !s)}
            className="btn btn-ghost px-2.5 py-1.5"
            aria-label={sidebar ? 'Hide the sidebar' : 'Show the sidebar'}
            title="Sidebar (F)"
          >
            ☰
          </button>

          <button type="button" onClick={goToday} className="btn btn-ghost py-1.5 text-sm">
            Today
          </button>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="grid size-8 place-items-center rounded-lg transition hover:bg-[var(--surface)]"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              className="grid size-8 place-items-center rounded-lg transition hover:bg-[var(--surface)]"
              aria-label="Next"
            >
              ›
            </button>
          </div>

          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold sm:text-xl">
            {title}
          </h2>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search events</span>
              <input
                ref={searchRef}
                type="search"
                value={filters.query}
                onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                placeholder="Search  /"
                className="field w-40 py-1.5 pl-8 sm:w-56"
              />
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm muted">
                🔍
              </span>
            </label>

            <div className="inline-flex rounded-xl border border-[var(--line)] p-0.5">
              {VIEWS.map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  title={`${label} (${hint})`}
                  className={`rounded-lg px-2.5 py-1 text-sm font-medium transition sm:px-3 ${
                    view === key ? 'bg-navy-600 text-white' : 'muted hover:text-[var(--ink)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => createOn(fromDayKey(selected))}
                className="btn btn-primary py-1.5 text-sm"
                title="New event (C)"
              >
                + Event
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="btn btn-ghost px-2.5 py-1.5"
              title="Print this view"
              aria-label="Print"
            >
              🖨
            </button>

            <button
              type="button"
              onClick={() => setShortcuts(true)}
              className="btn btn-ghost px-2.5 py-1.5"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
        </div>

        {filtersActive(filters) && (
          <div className="no-print mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="muted">Filtered:</span>
            {filters.query.trim() && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">
                “{filters.query.trim()}”
              </span>
            )}
            {filters.colors.length > 0 && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">
                {filters.colors.length} colour{filters.colors.length === 1 ? '' : 's'}
              </span>
            )}
            {filters.mineOnly && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">Mine only</span>
            )}
            {filters.openOnly && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">Open sign-ups</span>
            )}
            {filters.hoursOnly && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">Service hours</span>
            )}
            {filters.hidePast && (
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1">Upcoming only</span>
            )}
            <button
              type="button"
              onClick={() => setFilters(BLANK_FILTERS)}
              className="font-semibold text-navy-600 hover:underline dark:text-navy-200"
            >
              Clear
            </button>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2 text-xs muted">
            <span>{summary}</span>
            <span className="no-print hidden sm:inline">
              Press <span className="kbd">?</span> for shortcuts
            </span>
          </div>

          {view === 'month' && (
            <MonthView
              cursor={cursor}
              weekStart={settings.weekStart}
              selected={selected}
              byDay={byDay}
              userId={userId}
              isAdmin={isAdmin}
              showWeekNumbers={settings.showWeekNumbers}
              onSelect={selectDay}
              onNavigate={moveSelection}
              onOpen={openInstance}
              onMore={(date) => {
                setSelected(dayKey(date))
                setView('day')
              }}
              onCreate={createOn}
            />
          )}

          {(view === 'week' || view === 'day') && (
            <TimeGrid
              days={days}
              byDay={byDay}
              userId={userId}
              isAdmin={isAdmin}
              selected={selected}
              workHours={settings.workHours}
              onSelect={selectDay}
              onOpen={openInstance}
              onCreate={createOn}
            />
          )}

          {view === 'agenda' && (
            <AgendaView
              instances={instances}
              undatedEvents={noDate}
              userId={userId}
              onOpen={openInstance}
              rangeLabel="in the next few months"
            />
          )}
        </div>

        {instances.length === 0 && nextUp && view !== 'agenda' && (
          <div className="no-print mt-4 text-center">
            <button
              type="button"
              className="btn btn-ghost text-sm"
              onClick={() => jumpTo(nextUp.when)}
            >
              Jump to the next event →{' '}
              {nextUp.when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </button>
          </div>
        )}

        {/* The selected day, spelled out under the month grid: the grid
            answers "when", this answers "what, exactly". */}
        {view === 'month' && (
          <section className="mt-6">
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
              {fromDayKey(selected).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h3>

            {selectedList.length === 0 ? (
              <div className="card px-5 py-6 text-sm muted">
                Nothing scheduled this day.
                {isAdmin && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => createOn(fromDayKey(selected))}
                      className="font-semibold underline"
                    >
                      Add an event
                    </button>
                    .
                  </>
                )}
              </div>
            ) : (
              <div className="card overflow-hidden">
                <AgendaView
                  instances={selectedList}
                  undatedEvents={[]}
                  userId={userId}
                  onOpen={openInstance}
                  rangeLabel="this day"
                  showHeaders={false}
                />
              </div>
            )}
          </section>
        )}

        {view !== 'agenda' && noDate.length > 0 && (
          <section className="mt-8">
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
              No date set yet
            </h3>
            <div className="card overflow-hidden">
              <AgendaView
                instances={[]}
                undatedEvents={noDate}
                userId={userId}
                onOpen={openInstance}
                rangeLabel="without a date"
                showHeaders={false}
              />
            </div>
          </section>
        )}
      </div>

      {open && anchor && (
        <EventPopover
          instance={open}
          anchor={anchor}
          userId={userId}
          isAdmin={isAdmin}
          busy={busyId === open.event.id}
          onRsvp={(instance) => onRsvp(instance.event, instance.start)}
          onClose={() => setOpenId(null)}
        />
      )}

      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  )
}
