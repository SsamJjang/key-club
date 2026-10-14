import { useRef } from 'react'
import type { Instance } from '../../lib/calendar'
import { Chip } from './MonthView'
import { useFloating } from './EventPopover'
import { IconButton } from './icons'

/** The card behind "N more" in month view: every event on one day. */
export default function DayPopover({
  date,
  list,
  anchor,
  userId,
  onOpen,
  onDay,
  onClose,
}: {
  date: Date
  list: Instance[]
  anchor: DOMRect
  userId: string | null
  onOpen: (instance: Instance, rect: DOMRect) => void
  onDay: (date: Date) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { sheet, style } = useFloating(ref, anchor, 240, onClose, true)

  return (
    <>
      {sheet && <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={onClose} />}
      <div
        ref={ref}
        role="dialog"
        aria-label={date.toDateString()}
        style={style}
        className={`cal-popover z-50 overflow-y-auto p-2 ${
          sheet ? 'fixed inset-x-0 bottom-0 max-h-[75vh] rounded-b-none' : 'fixed max-h-[70vh]'
        }`}
      >
        <div className="relative mb-2 flex flex-col items-center">
          <span className="text-[11px] font-medium uppercase tracking-wide muted">
            {date.toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
          <button
            type="button"
            onClick={() => onDay(date)}
            className="grid size-11 place-items-center rounded-full text-2xl transition hover:bg-[var(--surface-2)]"
          >
            {date.getDate()}
          </button>
          <IconButton icon="close" label="Close" size="size-8" onClick={onClose} className="absolute right-0 top-0" />
        </div>
        {list.map((instance) => (
          <Chip key={instance.id} instance={instance} userId={userId} height={24} onOpen={onOpen} />
        ))}
      </div>
    </>
  )
}
