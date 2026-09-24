import { useRef } from 'react'
import { clamp } from '../../lib/gallery'

/**
 * Click or drag on the photo to mark what matters in it. Every crop of the
 * photo — square tiles, wide cards, the 2:1 post header — keeps that spot
 * in frame. The small previews show the crops it is going to be seen in.
 */
export default function FocusPicker({
  src,
  fx,
  fy,
  onChange,
  previews = [1, 16 / 9],
}: {
  src: string
  fx: number
  fy: number
  onChange: (fx: number, fy: number) => void
  /** Aspect ratios to preview the crop at. */
  previews?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  function set(e: React.PointerEvent) {
    const img = ref.current?.querySelector('img')
    if (!img) return
    const r = img.getBoundingClientRect()
    onChange(
      Math.round(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100)),
      Math.round(clamp(((e.clientY - r.top) / r.height) * 100, 0, 100)),
    )
  }

  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 2
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    onChange(clamp(fx + m[0], 0, 100), clamp(fy + m[1], 0, 100))
  }

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="relative grid touch-none select-none place-items-center overflow-hidden rounded-lg bg-[var(--surface)]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          set(e)
        }}
        onPointerMove={(e) => e.buttons && set(e)}
      >
        <div className="relative inline-block cursor-crosshair">
          <img src={src} alt="" draggable={false} className="block max-h-56 w-auto max-w-full" />
          <span
            role="slider"
            tabIndex={0}
            aria-label="Focus point"
            aria-valuetext={`${fx}% across, ${fy}% down`}
            onKeyDown={onKey}
            className="kc-focus-dot absolute size-6 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${fx}%`, top: `${fy}%` }}
          />
        </div>
      </div>
      {previews.length > 0 && (
        <div className="flex items-end gap-2">
          {previews.map((r) => (
            <div
              key={r}
              className="overflow-hidden rounded-md border border-[var(--line)]"
              style={{ aspectRatio: String(r), height: 44 }}
              title="How it crops"
            >
              <img src={src} alt="" className="size-full object-cover" style={{ objectPosition: `${fx}% ${fy}%` }} />
            </div>
          ))}
          <span className="pb-0.5 text-[11px] muted">How it crops · arrow keys nudge</span>
        </div>
      )}
    </div>
  )
}
