import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface LightboxItem {
  src: string
  thumb?: string
  alt?: string
  caption?: string
  w?: number
  h?: number
  lqip?: string
}

const MAX_ZOOM = 5
const SLIDE_MS = 4000

/**
 * Full-screen photo viewer.
 *
 *  ← / →, swipe          previous / next
 *  wheel, pinch, + / −    zoom (towards the pointer)
 *  double-click / tap     toggle 2.5× zoom at that spot
 *  drag while zoomed      pan
 *  swipe down, Esc        close
 *  Space                  slideshow
 */
export default function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: LightboxItem[]
  index: number
  onClose: () => void
  onIndex?: (i: number) => void
}) {
  const [i, setI] = useState(index)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [playing, setPlaying] = useState(false)
  const [chrome, setChrome] = useState(true)
  const stageRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)

  const n = items.length
  const item = items[i]

  // Scale and pan live in refs too, so gesture maths always reads the
  // latest values without waiting for a render.
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const setView = useCallback((s: number, p: { x: number; y: number }) => {
    scaleRef.current = s
    panRef.current = p
    setScale(s)
    setPan(p)
  }, [])

  const go = useCallback(
    (to: number) => {
      const next = ((to % n) + n) % n
      setI(next)
      setView(1, { x: 0, y: 0 })
      onIndex?.(next)
    },
    [n, onIndex, setView],
  )

  // ---- page lock + focus ------------------------------------------------
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [])

  // ---- neighbours preload, so arrowing through never shows a blank -------
  useEffect(() => {
    for (const d of [1, -1, 2]) {
      const it = items[(i + d + n) % n]
      if (it) new Image().src = it.src
    }
  }, [i, items, n])

  // Keep the active thumbnail in view.
  useEffect(() => {
    thumbsRef.current
      ?.querySelector<HTMLElement>(`[data-i="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [i])

  // ---- slideshow --------------------------------------------------------
  useEffect(() => {
    if (!playing || n < 2) return
    const t = setTimeout(() => go(i + 1), SLIDE_MS)
    return () => clearTimeout(t)
  }, [playing, i, n, go])

  // ---- zoom helpers -----------------------------------------------------
  const zoomAt = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const prev = scaleRef.current
      const s = Math.min(MAX_ZOOM, Math.max(1, next))
      if (s === 1) return setView(1, { x: 0, y: 0 })
      const p = panRef.current
      const r = stageRef.current?.getBoundingClientRect()
      if (r && cx != null && cy != null) {
        // Keep the point under the cursor fixed while scaling.
        const ox = cx - r.left - r.width / 2
        const oy = cy - r.top - r.height / 2
        setView(s, { x: ox - ((ox - p.x) * s) / prev, y: oy - ((oy - p.y) * s) / prev })
      } else {
        setView(s, { x: (p.x * s) / prev, y: (p.y * s) / prev })
      }
    },
    [setView],
  )

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(i + 1)
      else if (e.key === 'ArrowLeft') go(i - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(n - 1)
      else if (e.key === '+' || e.key === '=') zoomAt(scaleRef.current * 1.5)
      else if (e.key === '-') zoomAt(scaleRef.current / 1.5)
      else if (e.key === '0') zoomAt(1)
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else return
      setChrome(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, i, n, onClose, zoomAt])

  // ---- wheel (needs a non-passive listener to stop page zoom) -----------
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      zoomAt(scaleRef.current * factor, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---- pointers: swipe, pan, pinch --------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    startX: number
    startY: number
    panX: number
    panY: number
    pinchDist?: number
    pinchScale?: number
    moved: boolean
    t: number
  } | null>(null)
  const lastTap = useRef(0)

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button,a')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      gesture.current = {
        ...(gesture.current ?? { startX: 0, startY: 0, panX: panRef.current.x, panY: panRef.current.y, moved: true, t: Date.now() }),
        pinchDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        pinchScale: scaleRef.current,
      }
      setDrag({ x: 0, y: 0 })
    } else {
      gesture.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
        moved: false,
        t: Date.now(),
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]

    if (pts.length === 2 && g.pinchDist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const cx = (pts[0].x + pts[1].x) / 2
      const cy = (pts[0].y + pts[1].y) / 2
      zoomAt((g.pinchScale ?? 1) * (d / g.pinchDist), cx, cy)
      return
    }

    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true
    if (scaleRef.current > 1) setView(scaleRef.current, { x: g.panX + dx, y: g.panY + dy })
    else setDrag({ x: dx, y: Math.max(0, dy) * (Math.abs(dy) > Math.abs(dx) ? 1 : 0) })
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (g && pointers.current.size === 1) {
      // One finger of a pinch lifted: carry on panning from where the other is.
      const [rest] = [...pointers.current.values()]
      gesture.current = { ...g, startX: rest.x, startY: rest.y, panX: panRef.current.x, panY: panRef.current.y, pinchDist: undefined }
      return
    }
    if (!g || pointers.current.size > 0) return
    gesture.current = null

    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    setDrag({ x: 0, y: 0 })

    if (!g.moved) {
      // Tap: double → zoom toggle; single → show/hide the chrome.
      const now = Date.now()
      if (now - lastTap.current < 280) {
        zoomAt(scale > 1 ? 1 : 2.5, e.clientX, e.clientY)
        lastTap.current = 0
      } else {
        lastTap.current = now
        const target = e.target as HTMLElement
        // A tap on the dark backdrop (not the photo) closes, like every
        // other viewer people have used.
        if (scale === 1 && !target.closest('img')) {
          setTimeout(() => lastTap.current && onClose(), 280)
        } else {
          setTimeout(() => lastTap.current && setChrome((c) => !c), 280)
        }
      }
      return
    }

    if (scale > 1) return
    const fast = Date.now() - g.t < 300
    if (dy > 120 && Math.abs(dy) > Math.abs(dx)) onClose()
    else if (dx < -60 || (fast && dx < -25)) go(i + 1)
    else if (dx > 60 || (fast && dx > 25)) go(i - 1)
  }

  if (!item) return null

  const isLoaded = loaded[item.src]
  const dragging = drag.x !== 0 || drag.y !== 0
  const fade = drag.y ? Math.max(0.35, 1 - drag.y / 400) : 1

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${i + 1} of ${n}`}
      tabIndex={-1}
      className="kc-lightbox fixed inset-0 z-[100] flex flex-col text-white outline-none"
      style={{ background: `rgb(4 10 22 / ${0.94 * fade})` }}
    >
      {/* Top bar */}
      <div
        className={`relative z-10 flex items-center gap-2 px-3 py-2 transition-opacity sm:px-5 ${
          chrome ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <span className="text-sm tabular-nums text-white/70">
          {i + 1} / {n}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {n > 1 && (
            <LbButton
              label={playing ? 'Pause slideshow (Space)' : 'Play slideshow (Space)'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? '❚❚' : '▶'}
            </LbButton>
          )}
          <LbButton label="Zoom out (−)" onClick={() => zoomAt(scale / 1.5)} disabled={scale <= 1}>
            −
          </LbButton>
          <LbButton label="Zoom in (+)" onClick={() => zoomAt(scale * 1.5)} disabled={scale >= MAX_ZOOM}>
            +
          </LbButton>
          <a
            href={item.src}
            target="_blank"
            rel="noreferrer"
            className="grid size-10 place-items-center rounded-full text-lg text-white/85 transition hover:bg-white/10 hover:text-white"
            title="Open full size in a new tab"
            aria-label="Open full size in a new tab"
          >
            ↗
          </a>
          <LbButton label="Close (Esc)" onClick={onClose}>
            ✕
          </LbButton>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        className="relative flex-1 touch-none select-none overflow-hidden"
        style={{ cursor: scale > 1 ? 'grab' : 'zoom-in' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute inset-0 flex items-center justify-center p-2 sm:p-6"
          style={{
            transform: `translate(${drag.x}px, ${drag.y}px)`,
            transition: dragging ? 'none' : 'transform 0.25s ease',
          }}
        >
          {/* Blurred low-res first, then the thumb, then the full image. */}
          {!isLoaded && (item.lqip || item.thumb) && (
            <img
              src={item.thumb ?? item.lqip}
              alt=""
              aria-hidden
              className="absolute max-h-full max-w-full object-contain blur-sm"
              style={
                item.w && item.h
                  ? { aspectRatio: `${item.w} / ${item.h}`, height: '100%', width: 'auto' }
                  : undefined
              }
            />
          )}
          <img
            key={item.src}
            src={item.src}
            alt={item.alt ?? ''}
            draggable={false}
            onLoad={() => setLoaded((l) => ({ ...l, [item.src]: true }))}
            className="relative max-h-full max-w-full object-contain shadow-2xl"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: gesture.current ? 'none' : 'transform 0.2s ease, opacity 0.3s ease',
              opacity: isLoaded ? 1 : 0,
            }}
          />
        </div>

        {n > 1 && chrome && (
          <>
            <button
              type="button"
              onClick={() => go(i - 1)}
              className="absolute left-2 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-2xl backdrop-blur transition hover:bg-black/50 sm:grid"
              aria-label="Previous photo (←)"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(i + 1)}
              className="absolute right-2 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-2xl backdrop-blur transition hover:bg-black/50 sm:grid"
              aria-label="Next photo (→)"
            >
              ›
            </button>
          </>
        )}
        {playing && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
            <div key={i} className="kc-lb-progress h-full bg-gold-300" style={{ animationDuration: `${SLIDE_MS}ms` }} />
          </div>
        )}
      </div>

      {/* Caption + filmstrip */}
      <div
        className={`relative z-10 transition-opacity ${chrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {(item.caption || item.alt) && (
          <p className="mx-auto max-w-3xl px-4 pt-3 text-center text-sm leading-relaxed text-white/90">
            {item.caption || item.alt}
          </p>
        )}
        {n > 1 && (
          <div ref={thumbsRef} className="kc-scroll-x flex gap-1.5 overflow-x-auto px-4 py-3">
            <div className="mx-auto flex gap-1.5">
              {items.map((it, k) => (
                <button
                  key={`${it.src}-${k}`}
                  data-i={k}
                  type="button"
                  onClick={() => go(k)}
                  aria-label={`Photo ${k + 1}`}
                  aria-current={k === i}
                  className={`relative size-12 shrink-0 overflow-hidden rounded-md transition sm:size-14 ${
                    k === i ? 'ring-2 ring-gold-300 ring-offset-2 ring-offset-black' : 'opacity-50 hover:opacity-90'
                  }`}
                >
                  <img src={it.thumb ?? it.src} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function LbButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full text-lg text-white/85 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  )
}
