import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MonthView from './calendar/MonthView'
import TimeGrid from './calendar/TimeGrid'
import AgendaView from './calendar/AgendaView'
import EventPopover from './calendar/EventPopover'
import DayPopover from './calendar/DayPopover'
import ShortcutsDialog from './calendar/ShortcutsDialog'
import CalendarSidebar, { type CalendarSettings } from './calendar/CalendarSidebar'
import QuickCreate, { type Draft } from './calendar/QuickCreate'
import { Icon, IconButton } from './calendar/icons'
import {
  BLANK_FILTERS,
  addDaysTo,
  dayKey,
  expand,
  filterEvents,
  groupByDay,
  instancesOf,
  monthCells,
  startOfDay,
  undated,
  weekDays,
  type CalendarEvent,
  type Instance,
  type ViewMode,
} from '../lib/calendar'
import { colorOf, type EventColorKey } from '../lib/eventColors'
import { downloadIcs, icsForEvents } from '../lib/ics'

export type { CalendarEvent } from '../lib/calendar'

const VIEWS: { key: ViewMode; label: string; hint: string }[] = [
  { key: 'day', label: 'Day', hint: 'D' },
  { key: 'week', label: 'Week', hint: 'W' },
  { key: 'month', label: 'Month', hint: 'M' },
  { key: 'agenda', label: 'Schedule', hint: 'A' },
]

/** How far ahead the Schedule view lists. */
const AGENDA_DAYS = 120

const DEFAULT_SETTINGS: CalendarSettings = { weekStart: 0, showWeekends: true }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const value = JSON.parse(raw) as T
    return typeof fallback === 'object' && !Array.isArray(fallback) ? { ...fallback, ...value } : value
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    /* Private browsing — a lost view preference is not worth an error. */
  }
}

/** Same day of the month, n months away, clamped (Jan 31 + 1 → Feb 28). */
function shiftMonths(date: Date, n: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), last))
  return target
}

const isPhone = () => window.innerWidth < 768

/**
 * The club calendar, laid out and behaving like Google Calendar.
 *
 * One date, `cursor`, anchors every view: month shows its month, week its
 * week, day the day itself. Clicking an event opens a card in place;
 * clicking an empty slot (officers) starts a new event there.
 */
export default function EventCalendar({
  events,
  onRsvp,
  busyId,
  isAdmin = false,
  userId = null,
  clubName = 'Key Club',
  onCreated,
}: {
  events: CalendarEvent[]
  onRsvp: (event: CalendarEvent, day: Date | null) => void
  /** An event was saved from the quick-create card: reload. */
  onCreated?: () => void
  busyId: string | null
  isAdmin?: boolean
  userId?: string | null
  clubName?: string
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('kc-cal-view') as ViewMode | null
    return saved ?? (isPhone() ? 'agenda' : 'month')
  })
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [hidden, setHidden] = useState<EventColorKey[]>(() => load('kc-cal-hidden', [] as EventColorKey[]))
  const [settings, setSettings] = useState<CalendarSettings>(() => load('kc-cal-settings', DEFAULT_SETTINGS))
  const [sidebar, setSidebar] = useState(() => localStorage.getItem('kc-cal-rail') !== 'closed')
  const [drawer, setDrawer] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [viewMenu, setViewMenu] = useState(false)
  const [gearMenu, setGearMenu] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [more, setMore] = useState<{ date: Date; rect: DOMRect } | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => save('kc-cal-view', view), [view])
  useEffect(() => save('kc-cal-hidden', hidden), [hidden])
  useEffect(() => save('kc-cal-settings', settings), [settings])
  useEffect(() => save('kc-cal-rail', sidebar ? 'open' : 'closed'), [sidebar])

  // -------------------------------------------------------------------
  // What is on screen
  // -------------------------------------------------------------------

  // Unticked calendars (colours) drop out; search narrows what is left.
  const shownEvents = useMemo(
    () =>
      filterEvents(events, { ...BLANK_FILTERS, query }, userId).filter(
        (e) => !hidden.includes(colorOf(e)),
      ),
    [events, query, userId, hidden],
  )

  const days = useMemo(() => {
    if (view === 'week') return weekDays(cursor, settings.weekStart, settings.showWeekends)
    if (view === 'day') return [cursor]
    return []
  }, [view, cursor, settings.weekStart, settings.showWeekends])

  const [from, to] = useMemo((): [Date, Date] => {
    if (view === 'month') {
      const cells = monthCells(cursor, settings.weekStart)
      return [cells[0], cells[cells.length - 1]]
    }
    if (view === 'agenda') return [cursor, addDaysTo(cursor, AGENDA_DAYS)]
    return [days[0], days[days.length - 1]]
  }, [view, cursor, days, settings.weekStart])

  const instances = useMemo(() => expand(shownEvents, from, to), [shownEvents, from, to])
  const byDay = useMemo(() => groupByDay(instances), [instances])

  /** Search looks at every date, not just the visible range — as Google's does. */
  const results = useMemo(() => {
    if (!query.trim()) return []
    return shownEvents.flatMap(instancesOf).sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [shownEvents, query])

  /** Every instance by id, so an open card survives a data reload. */
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

  const goToday = useCallback(() => setCursor(startOfDay(new Date())), [])

  const shift = useCallback(
    (delta: number) =>
      setCursor((c) => {
        if (view === 'month') return shiftMonths(c, delta)
        if (view === 'week') return addDaysTo(c, delta * 7)
        if (view === 'agenda') return addDaysTo(c, delta * 7)
        return addDaysTo(c, delta)
      }),
    [view],
  )

  const showDay = useCallback((date: Date) => {
    setCursor(startOfDay(date))
    setView('day')
    setMore(null)
    setOpenId(null)
  }, [])

  const pick = useCallback((date: Date) => {
    setCursor(startOfDay(date))
    setDrawer(false)
  }, [])

  /**
   * Opens Google's quick "add event" card. A time-grid slot gives a timed
   * hour; a month cell gives an all-day event; Create / C with no slot
   * starts on the shown day at the next whole hour, centred on screen.
   */
  const startDraft = useCallback(
    (at: Date, anchor: DOMRect | null, allDay: boolean) => {
      if (!isAdmin) return
      setOpenId(null)
      setMore(null)
      const end = new Date(at)
      end.setHours(end.getHours() + 1)
      setDraft({ start: at, end, allDay, title: '', color: null, anchor })
    },
    [isAdmin],
  )

  const createNow = useCallback(() => {
    const at = new Date(cursor)
    const now = new Date()
    at.setHours(now.getHours() + 1, 0, 0, 0)
    setDrawer(false)
    startDraft(at, null, false)
  }, [cursor, startDraft])

  const changeView = (next: ViewMode) => {
    setView(next)
    setViewMenu(false)
    setDrawer(false)
  }

  const closeSearch = () => {
    setQuery('')
    setSearching(false)
  }

  const openInstance = (instance: Instance, rect: DOMRect) => {
    setAnchor(rect)
    setOpenId(instance.id)
  }

  // -------------------------------------------------------------------
  // Keyboard — Google Calendar's own shortcuts
  // -------------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        if (e.key === 'Escape') target.blur()
        return
      }
      const views: Record<string, ViewMode> = { d: 'day', 1: 'day', w: 'week', 2: 'week', m: 'month', 3: 'month', a: 'agenda', 4: 'agenda' }
      const key = e.key.toLowerCase()
      if (key in views) setView(views[key])
      else if (key === 't') goToday()
      else if (key === 'j' || key === 'n') shift(1)
      else if (key === 'k' || key === 'p') shift(-1)
      else if (key === 'c' && isAdmin) createNow()
      else if (key === '/') {
        e.preventDefault()
        setSearching(true)
        setTimeout(() => searchRef.current?.focus(), 0)
      } else if (e.key === '?') setShortcuts(true)
      else if (e.key === 'Escape') {
        setOpenId(null)
        setMore(null)
        setDraft(null)
        setShortcuts(false)
      } else return
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [goToday, shift, isAdmin, createNow])

  // Swipe sideways on a phone to page, like the Google Calendar app.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start || view === 'agenda' || query) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1)
  }

  // -------------------------------------------------------------------
  // Header text
  // -------------------------------------------------------------------

  const title = useMemo(() => {
    if (view === 'month' || view === 'agenda')
      return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    if (view === 'day')
      return cursor.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    const first = days[0]
    const last = days[days.length - 1]
    if (first.getMonth() === last.getMonth())
      return first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const sameYear = first.getFullYear() === last.getFullYear()
    return `${first.toLocaleDateString(undefined, { month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${last.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
  }, [view, cursor, days])

  const noDate = useMemo(() => undated(shownEvents), [shownEvents])

  function exportAll() {
    downloadIcs(
      `${clubName.toLowerCase().replace(/\s+/g, '-')}-calendar`,
      icsForEvents(shownEvents, `${clubName} calendar`),
    )
  }

  const toggleColor = (key: EventColorKey) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]))

  const sidebarProps = {
    cursor,
    selected: dayKey(cursor),
    weekStart: settings.weekStart,
    events,
    hidden,
    isAdmin,
    onCreate: createNow,
    onPick: pick,
    onToggle: toggleColor,
    onExport: exportAll,
  }

  const currentView = VIEWS.find((v) => v.key === view)!

  // -------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--card)]">
      {/* ---------------- Top bar ---------------- */}
      <header className="flex h-16 shrink-0 items-center gap-1 border-b border-[var(--line)] px-2 sm:gap-2 sm:px-3">
        {searching ? (
          <>
            <IconButton icon="left" label="Back" onClick={closeSearch} />
            <label className="flex h-11 flex-1 items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3">
              <Icon name="search" className="size-5 muted" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
              {query && <IconButton icon="close" label="Clear search" size="size-8" onClick={() => setQuery('')} />}
            </label>
          </>
        ) : (
          <>
            <IconButton
              icon="menu"
              label="Main menu"
              onClick={() => (isPhone() ? setDrawer(true) : setSidebar((s) => !s))}
            />
            <button
              type="button"
              onClick={goToday}
              className="ml-1 hidden h-9 items-center rounded-full border border-[var(--line-strong)] px-4 text-sm font-medium transition hover:bg-[var(--surface-2)] md:flex"
            >
              Today
            </button>
            <div className="hidden items-center md:flex">
              <IconButton icon="left" label={`Previous ${currentView.label.toLowerCase()}`} onClick={() => shift(-1)} />
              <IconButton icon="right" label={`Next ${currentView.label.toLowerCase()}`} onClick={() => shift(1)} />
            </div>
            <h2 className="ml-1 min-w-0 truncate text-lg sm:text-[1.375rem]">{title}</h2>

            <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
              <IconButton
                icon="search"
                label="Search"
                onClick={() => {
                  setSearching(true)
                  setTimeout(() => searchRef.current?.focus(), 0)
                }}
              />
              <IconButton icon="today" label="Today" onClick={goToday} className="md:hidden" />

              <div className="relative hidden md:block">
                <IconButton icon="gear" label="Settings" onClick={() => setGearMenu((g) => !g)} />
                {gearMenu && (
                  <Menu onClose={() => setGearMenu(false)} className="w-60 p-3 text-sm">
                    <label className="flex items-center justify-between gap-3 py-1.5">
                      Week starts on
                      <select
                        className="field w-28 py-1"
                        value={settings.weekStart}
                        onChange={(e) => setSettings({ ...settings, weekStart: Number(e.target.value) })}
                      >
                        <option value={0}>Sunday</option>
                        <option value={1}>Monday</option>
                      </select>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2.5 py-1.5">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={settings.showWeekends}
                        onChange={(e) => setSettings({ ...settings, showWeekends: e.target.checked })}
                      />
                      Show weekends in week view
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setGearMenu(false)
                        setShortcuts(true)
                      }}
                      className="mt-1 w-full rounded-lg py-1.5 text-left hover:underline"
                    >
                      Keyboard shortcuts <span className="kbd ml-1">?</span>
                    </button>
                  </Menu>
                )}
              </div>

              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setViewMenu((v) => !v)}
                  className="flex h-9 items-center gap-1 rounded-full border border-[var(--line-strong)] pl-4 pr-2 text-sm font-medium transition hover:bg-[var(--surface-2)]"
                  aria-haspopup="menu"
                  aria-expanded={viewMenu}
                >
                  {currentView.label}
                  <Icon name="down" />
                </button>
                {viewMenu && (
                  <Menu onClose={() => setViewMenu(false)} className="w-44 py-2">
                    {VIEWS.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        role="menuitem"
                        onClick={() => changeView(v.key)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-[var(--surface-2)] ${
                          v.key === view ? 'bg-[var(--surface-2)] font-medium' : ''
                        }`}
                      >
                        {v.label}
                        <span className="text-xs muted">{v.hint}</span>
                      </button>
                    ))}
                  </Menu>
                )}
              </div>
            </div>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------- Sidebar (desktop) ---------------- */}
        {sidebar && (
          <aside className="hidden w-64 shrink-0 pl-3 pt-3 md:block">
            <CalendarSidebar {...sidebarProps} />
          </aside>
        )}

        {/* ---------------- The view ---------------- */}
        <main
          className={`min-h-0 min-w-0 flex-1 ${sidebar ? 'md:border-l md:border-[var(--line)]' : ''}`}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {query.trim() ? (
            <AgendaView
              instances={results}
              userId={userId}
              onOpen={openInstance}
              empty={`No events match “${query.trim()}”`}
            />
          ) : view === 'month' ? (
            <MonthView
              cursor={cursor}
              weekStart={settings.weekStart}
              byDay={byDay}
              userId={userId}
              isAdmin={isAdmin}
              onOpen={openInstance}
              onDay={showDay}
              onMore={(date, rect) => setMore({ date, rect })}
              onCreate={(date, rect) => startDraft(date, rect, true)}
              draft={draft}
            />
          ) : view === 'agenda' ? (
            <AgendaView
              instances={instances}
              undatedEvents={noDate}
              userId={userId}
              onOpen={openInstance}
              empty="Nothing scheduled in the next few months"
            />
          ) : (
            <TimeGrid
              days={days}
              byDay={byDay}
              userId={userId}
              isAdmin={isAdmin}
              onOpen={openInstance}
              onDay={showDay}
              onCreate={(at, rect) => startDraft(at, rect, false)}
              draft={draft}
            />
          )}
        </main>
      </div>

      {/* ---------------- Phone drawer ---------------- */}
      {drawer && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[var(--card)] shadow-[var(--shadow-lg)] md:hidden">
            <p className="px-5 pb-2 pt-5 text-lg font-medium">Calendar</p>
            <nav className="border-b border-[var(--line)] pb-2">
              {[...VIEWS].reverse().map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => changeView(v.key)}
                  className={`mr-3 flex w-[calc(100%-0.75rem)] items-center rounded-r-full px-5 py-3 text-left text-sm font-medium ${
                    v.key === view
                      ? 'bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-50'
                      : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 pl-3 pt-3">
              <CalendarSidebar {...sidebarProps} isAdmin={false} />
            </div>
          </aside>
        </>
      )}

      {/* Phone create button, above the tab bar. */}
      {isAdmin && (
        <button
          type="button"
          onClick={createNow}
          aria-label="Create event"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-2xl bg-[var(--card)] text-navy-600 shadow-[0_2px_6px_rgb(0_0_0/0.25),0_8px_20px_rgb(0_0_0/0.15)] md:hidden dark:text-gold-300"
        >
          <Icon name="plus" className="size-7" />
        </button>
      )}

      {more && (
        <DayPopover
          date={more.date}
          list={byDay.get(dayKey(more.date)) ?? []}
          anchor={more.rect}
          userId={userId}
          onOpen={(instance, rect) => {
            setMore(null)
            openInstance(instance, rect)
          }}
          onDay={showDay}
          onClose={() => setMore(null)}
        />
      )}

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

      {draft && (
        <QuickCreate
          draft={draft}
          userId={userId}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null)
            onCreated?.()
          }}
        />
      )}

      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  )
}

/** A dropdown under a top-bar button; closes on any outside click. */
function Menu({
  onClose,
  className = '',
  children,
}: {
  onClose: () => void
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div ref={ref} role="menu" className={`cal-popover absolute right-0 top-11 z-40 ${className}`}>
      {children}
    </div>
  )
}
