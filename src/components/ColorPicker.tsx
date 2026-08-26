import { EVENT_COLORS, colorLabel, type EventColorKey } from '../lib/eventColors'

/**
 * The colour swatches in the event editor.
 *
 * A fixed palette rather than a colour input, on purpose: every one of
 * these is legible on both themes and distinguishable from the others,
 * which a free-form picker cannot promise. "No colour" is a real choice
 * and stays first, so an officer in a hurry is never forced to decide.
 */
export default function ColorPicker({
  value,
  label,
  onChange,
  onLabel,
}: {
  value: EventColorKey | null
  /** The word this colour stands for on the calendar — optional. */
  label: string
  onChange: (next: EventColorKey | null) => void
  onLabel: (next: string) => void
}) {
  return (
    <div>
      <span className="label">Colour</span>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          title="Default for this type"
          className={`grid size-7 place-items-center rounded-full border-2 border-dashed text-[10px] font-bold transition ${
            value === null
              ? 'border-navy-500 text-navy-600 dark:text-navy-200'
              : 'border-[var(--line)] muted hover:border-navy-300'
          }`}
        >
          —
        </button>

        {EVENT_COLORS.map((color) => {
          const on = value === color.key
          return (
            <button
              key={color.key}
              type="button"
              data-ec={color.key}
              onClick={() => onChange(color.key)}
              aria-pressed={on}
              aria-label={color.label}
              title={color.label}
              className={`ec-dot grid size-7 place-items-center rounded-full text-white transition ${
                on ? 'ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--card)]' : 'hover:scale-110'
              }`}
            >
              {on && <span aria-hidden>✓</span>}
            </button>
          )
        })}
      </div>

      <p className="mt-1.5 text-xs muted">
        {value ? colorLabel(value) : 'No colour — uses the default for this post type.'}
      </p>

      <div className="mt-3">
        <label className="label" htmlFor="calendar-label">
          What this colour means
        </label>
        <input
          id="calendar-label"
          className="field"
          value={label}
          maxLength={24}
          onChange={(e) => onLabel(e.target.value)}
          placeholder="Service, Board meeting, Fundraiser…"
        />
        <p className="mt-1 text-xs muted">
          Shown on the event and used to name this colour in the calendar’s filter list.
        </p>
      </div>
    </div>
  )
}
