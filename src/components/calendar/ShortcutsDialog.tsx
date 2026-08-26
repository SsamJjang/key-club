import { useEffect } from 'react'

const GROUPS: [string, [string, string][]][] = [
  [
    'Move around',
    [
      ['T', 'Jump to today'],
      ['N  or  →', 'Next month / week / day'],
      ['P  or  ←', 'Previous period'],
      ['↑ ↓ ← →', 'Move a day at a time in the month grid'],
    ],
  ],
  [
    'Switch view',
    [
      ['D', 'Day'],
      ['W', 'Week'],
      ['M', 'Month'],
      ['A', 'Schedule'],
    ],
  ],
  [
    'Do things',
    [
      ['/', 'Search events'],
      ['F', 'Show or hide the filters sidebar'],
      ['C', 'New event (officers)'],
      ['Esc', 'Close whatever is open'],
      ['?', 'This list'],
    ],
  ],
]

/** The shortcut sheet — the thing that tells people shortcuts exist at all. */
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="cal-popover w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-full text-sm muted transition hover:bg-[var(--surface)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {GROUPS.map(([title, rows]) => (
            <div key={title}>
              <h3 className="label">{title}</h3>
              <ul className="space-y-1.5">
                {rows.map(([keys, what]) => (
                  <li key={keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="muted">{what}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.split('  ').map((k, i) => (
                        <span key={i} className={k.trim() === 'or' ? 'text-xs muted' : 'kbd'}>
                          {k.trim()}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs muted">
          Shortcuts are off while you are typing in a field, so you can search for “Meeting”
          without the M sending you to the month view.
        </p>
      </div>
    </div>
  )
}
