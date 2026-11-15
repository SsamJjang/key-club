import { useEffect, useState } from 'react'
import { splitHours } from '../lib/format'

/**
 * Hours and minutes side by side. The value going in and out is still
 * decimal hours as a string ("2.6667", or "" for nothing), so callers keep
 * storing what they always stored — officers just never have to work out
 * that 40 minutes is 0.6667.
 */
export default function HoursInput({
  value,
  onChange,
  className = 'field',
  required,
  disabled,
  placeholder,
  maxHours,
  id,
}: {
  value: string
  onChange: (hours: string) => void
  className?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  maxHours?: number
  id?: string
}) {
  const [h, setH] = useState('')
  const [m, setM] = useState('')

  // Follow the value when it changes from outside (an event prefill, a
  // reset after saving) — but not when it's just echoing what was typed.
  useEffect(() => {
    if (value === toDecimal(h, m)) return
    if (value === '' || !Number.isFinite(Number(value))) {
      setH('')
      setM('')
      return
    }
    const parts = splitHours(Number(value))
    setH(String(parts.hours))
    setM(parts.minutes ? String(parts.minutes) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function update(nextH: string, nextM: string) {
    setH(nextH)
    setM(nextM)
    onChange(toDecimal(nextH, nextM))
  }

  const empty = h === '' && m === ''

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min="0"
          max={maxHours}
          step="1"
          aria-label="Hours"
          className={`${className} pr-9`}
          value={h}
          // Either box alone is enough: "40 min" or "3 h".
          required={required && empty}
          disabled={disabled}
          placeholder={placeholder ?? '0'}
          onChange={(e) => update(e.target.value, m)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs muted">
          h
        </span>
      </div>
      <div className="relative flex-1">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max="59"
          step="1"
          aria-label="Minutes"
          className={`${className} pr-11`}
          value={m}
          disabled={disabled}
          placeholder={disabled ? '' : '0'}
          onChange={(e) => update(h, e.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs muted">
          min
        </span>
      </div>
    </div>
  )
}

/** "2", "40" → "2.6667". Both blank → "". */
function toDecimal(h: string, m: string) {
  if (h === '' && m === '') return ''
  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0)
  return String(Math.round((minutes / 60) * 10000) / 10000)
}
