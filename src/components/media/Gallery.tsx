import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { clamp, ensureBoxes, type CollageBox, type Gallery as GalleryData, type GalleryImage } from '../../lib/gallery'
import Lightbox from './Lightbox'

/**
 * Draws a gallery in any of its layouts. The same component renders the
 * published post and the live preview inside the editor; `edit` switches
 * tile clicks from "open the viewer" to "select for editing" and turns on
 * the direct-manipulation handles (grid spans, collage move/resize/rotate).
 */

export interface GalleryEditHooks {
  selected: string | null
  select: (id: string | null) => void
  setSpan: (id: string, cs: number, rs: number) => void
  setBox: (id: string, box: CollageBox) => void
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Real pixel widths for srcset, so a small tile never pulls the 2400px copy. */
function srcSet(img: GalleryImage) {
  if (!img.thumb || img.thumb === img.src) return undefined
  const long = Math.max(img.w, img.h)
  const thumbW = Math.round((img.w / long) * Math.min(long, 960))
  return `${img.thumb} ${thumbW}w, ${img.src} ${img.w}w`
}

function Photo({
  img,
  fit = 'cover',
  sizes,
  eager,
  className = '',
}: {
  img: GalleryImage
  fit?: 'cover' | 'contain'
  sizes?: number
  eager?: boolean
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const contain = fit === 'contain' || img.contain
  const pos = `${img.fx ?? 50}% ${img.fy ?? 50}%`

  return (
    <div
      className={`kc-photo absolute inset-0 overflow-hidden ${className}`}
      style={{ background: img.color ?? 'var(--surface)' }}
    >
      {(contain || !loaded) && img.lqip && (
        <img
          src={img.lqip}
          alt=""
          aria-hidden
          className={`absolute inset-0 size-full scale-110 object-cover blur-xl ${contain ? 'opacity-60' : ''}`}
        />
      )}
      <img
        src={img.thumb ?? img.src}
        srcSet={srcSet(img)}
        sizes={sizes ? `${Math.ceil(sizes)}px` : undefined}
        alt={img.alt ?? ''}
        width={img.w}
        height={img.h}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className="relative size-full transition-opacity duration-500"
        style={{ objectFit: contain ? 'contain' : 'cover', objectPosition: pos, opacity: loaded ? 1 : 0 }}
      />
    </div>
  )
}

/**
 * One photo in a frame: the photo, its caption (in whichever style the
 * gallery uses) and the optional border or polaroid mat.
 */
function Tile({
  img,
  g,
  sizes,
  onOpen,
  selected,
  style,
  className = '',
  aspect,
  fit,
  eager,
  children,
}: {
  img: GalleryImage
  g: GalleryData
  sizes?: number
  onOpen?: () => void
  selected?: boolean
  style?: CSSProperties
  className?: string
  /** Fixed shape for the photo area; omit to fill the parent's height. */
  aspect?: number
  fit?: 'cover' | 'contain'
  eager?: boolean
  children?: ReactNode
}) {
  const caption = img.caption?.trim()
  const framed = g.frame !== 'none'
  const polaroid = g.frame === 'polaroid'
  const inner = Math.max(0, g.radius - (framed ? 4 : 0))
  const showBelow = caption && (g.captions === 'below' || polaroid)
  const overlay = caption && !polaroid && (g.captions === 'overlay' || g.captions === 'hover')

  return (
    <figure
      className={`kc-tile group/tile relative flex flex-col ${framed ? 'kc-framed' : ''} ${
        polaroid ? 'kc-polaroid' : ''
      } ${selected ? 'kc-selected' : ''} ${className}`}
      style={{ borderRadius: g.radius, ...style }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="kc-tile-hit relative block w-full flex-1 cursor-zoom-in overflow-hidden text-left"
        style={{ borderRadius: inner, aspectRatio: aspect ? String(aspect) : undefined }}
        aria-label={img.alt || caption || 'Open photo'}
      >
        <Photo img={img} sizes={sizes} fit={fit} eager={eager} className="kc-zoom" />
        {overlay && (
          <figcaption
            className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2.5 pt-8 text-[13px] leading-snug text-white transition ${
              g.captions === 'hover'
                ? 'opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100'
                : ''
            }`}
          >
            {caption}
          </figcaption>
        )}
      </button>
      {showBelow && (
        <figcaption
          className={`${polaroid ? 'kc-polaroid-caption' : 'px-1 pt-2 text-[13px] leading-snug muted'} line-clamp-3`}
        >
          {caption}
        </figcaption>
      )}
      {children}
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function GridLayout({
  g,
  width,
  open,
  edit,
}: {
  g: GalleryData
  width: number
  open: (i: number) => void
  edit?: GalleryEditHooks
}) {
  // Columns step down on narrow screens so tiles never get thumbnail-small.
  const cols = clamp(Math.floor((width + g.gap) / 110), 1, g.columns)
  const cellW = (width - g.gap * (cols - 1)) / cols
  const rowH = cellW / (g.aspect || 4 / 3)

  function startSpanDrag(e: React.PointerEvent, img: GalleryImage) {
    if (!edit) return
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const cs0 = Math.min(img.cs ?? 1, cols)
    const rs0 = img.rs ?? 1
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let last = `${cs0}x${rs0}`

    const move = (ev: PointerEvent) => {
      const cs = clamp(Math.round(cs0 + (ev.clientX - sx) / (cellW + g.gap)), 1, cols)
      const rs = clamp(Math.round(rs0 + (ev.clientY - sy) / (rowH + g.gap)), 1, 6)
      // Only whole-cell changes reach the document.
      if (`${cs}x${rs}` === last) return
      last = `${cs}x${rs}`
      edit!.setSpan(img.id, cs, rs)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowH}px`,
        gridAutoFlow: 'dense',
        gap: g.gap,
      }}
    >
      {g.images.map((img, i) => {
        const cs = Math.min(img.cs ?? 1, cols)
        const rs = img.rs ?? 1
        const selected = edit?.selected === img.id
        return (
          <Tile
            key={img.id}
            img={img}
            g={g}
            sizes={cellW * cs}
            onOpen={() => open(i)}
            selected={selected}
            style={{ gridColumn: `span ${cs}`, gridRow: `span ${rs}` }}
          >
            {selected && (
              <span
                role="slider"
                aria-label="Drag to resize tile"
                aria-valuetext={`${cs} by ${rs}`}
                onPointerDown={(e) => startSpanDrag(e, img)}
                className="kc-handle absolute -bottom-1.5 -right-1.5 z-10 size-5 cursor-nwse-resize"
              />
            )}
            {edit && (cs > 1 || rs > 1) && (
              <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {cs}×{rs}
              </span>
            )}
          </Tile>
        )
      })}
    </div>
  )
}

function MasonryLayout({ g, width, open, edit }: LayoutProps) {
  const cols = clamp(Math.floor((width + g.gap) / 150), 1, g.columns)
  const colW = (width - g.gap * (cols - 1)) / cols

  // Shortest-column-first placement, so columns end level and reading
  // order runs left-to-right across the top rather than down column one.
  const columns = useMemo(() => {
    const out: { img: GalleryImage; i: number }[][] = Array.from({ length: cols }, () => [])
    const heights = new Array(cols).fill(0)
    g.images.forEach((img, i) => {
      const c = heights.indexOf(Math.min(...heights))
      out[c].push({ img, i })
      heights[c] += img.h / img.w + 0.02
    })
    return out
  }, [g.images, cols])

  return (
    <div className="flex items-start" style={{ gap: g.gap }}>
      {columns.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col" style={{ gap: g.gap }}>
          {col.map(({ img, i }) => (
            <Tile
              key={img.id}
              img={img}
              g={g}
              aspect={img.w / img.h}
              sizes={colW}
              onOpen={() => open(i)}
              selected={edit?.selected === img.id}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function JustifiedLayout({ g, width, open, edit }: LayoutProps) {
  const target = Math.min(g.rowHeight, Math.max(120, width * 0.55))

  // Greedy line breaking: fill a row until it would be too short, then scale
  // it so it ends exactly at the right edge. Every photo stays uncropped.
  const rows = useMemo(() => {
    const out: { items: { img: GalleryImage; i: number }[]; h: number }[] = []
    let row: { img: GalleryImage; i: number }[] = []
    let ratio = 0
    g.images.forEach((img, i) => {
      row.push({ img, i })
      ratio += img.w / img.h
      const h = (width - g.gap * (row.length - 1)) / ratio
      if (h <= target) {
        out.push({ items: row, h })
        row = []
        ratio = 0
      }
    })
    if (row.length) out.push({ items: row, h: Math.min(target, (width - g.gap * (row.length - 1)) / ratio) })
    return out
  }, [g.images, g.gap, width, target])

  return (
    <div className="flex flex-col" style={{ gap: g.gap }}>
      {rows.map((row, r) => (
        <div key={r} className="flex" style={{ gap: g.gap, height: row.h }}>
          {row.items.map(({ img, i }) => (
            <Tile
              key={img.id}
              img={img}
              g={{ ...g, captions: g.captions === 'below' ? 'overlay' : g.captions }}
              sizes={row.h * (img.w / img.h)}
              onOpen={() => open(i)}
              selected={edit?.selected === img.id}
              style={{ width: row.h * (img.w / img.h), flex: 'none' }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function CarouselLayout({ g, width, open, edit, active, setActive }: LayoutProps & Pager) {
  const track = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const n = g.images.length
  // A sliver of the next photo on wide screens says "there's more".
  const peek = width >= 560 && n > 1
  const slideW = peek ? width * 0.86 : width
  const aspect = g.aspect || 3 / 2

  const scrollTo = useCallback(
    (i: number) => {
      const el = track.current
      if (!el) return
      const k = ((i % n) + n) % n
      const slide = el.children[k] as HTMLElement | undefined
      el.scrollTo({ left: slide ? slide.offsetLeft - el.offsetLeft - (peek ? (width - slideW) / 2 : 0) : 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
    },
    [n, peek, width, slideW],
  )

  useEffect(() => {
    const el = track.current
    if (!el) return
    let t: ReturnType<typeof setTimeout>
    const onScroll = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const center = el.scrollLeft + el.clientWidth / 2
        let best = 0
        let dist = Infinity
        Array.from(el.children).forEach((c, k) => {
          const h = c as HTMLElement
          const d = Math.abs(h.offsetLeft - el.offsetLeft + h.clientWidth / 2 - center)
          if (d < dist) {
            dist = d
            best = k
          }
        })
        setActive(best)
      }, 60)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [setActive])

  useEffect(() => {
    if (!g.autoplay || paused || edit || n < 2 || reducedMotion()) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') scrollTo(active + 1)
    }, 4500)
    return () => clearInterval(t)
  }, [g.autoplay, paused, edit, n, active, scrollTo])

  // Selecting a photo in the editor's tray brings it into view here.
  useEffect(() => {
    if (!edit?.selected) return
    const k = g.images.findIndex((i) => i.id === edit.selected)
    if (k >= 0 && k !== active) scrollTo(k)
  }, [edit?.selected])

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') scrollTo(active + 1)
        if (e.key === 'ArrowLeft') scrollTo(active - 1)
      }}
    >
      <div
        ref={track}
        className="kc-scroll-x flex snap-x snap-mandatory overflow-x-auto"
        style={{ gap: g.gap, scrollPaddingInline: peek ? (width - slideW) / 2 : 0, paddingInline: peek ? (width - slideW) / 2 : 0 }}
      >
        {g.images.map((img, i) => (
          <div
            key={img.id}
            className={`shrink-0 snap-center transition duration-300 ${peek && i !== active ? 'scale-[0.96] opacity-60' : ''}`}
            style={{ width: slideW }}
          >
            <Tile
              img={img}
              g={g}
              aspect={aspect}
              sizes={slideW}
              eager={i < 2}
              onOpen={() => (i === active || edit ? open(i) : scrollTo(i))}
              selected={edit?.selected === img.id}
            />
          </div>
        ))}
      </div>

      {n > 1 && (
        <>
          <button
            type="button"
            onClick={() => scrollTo(active - 1)}
            className="kc-nav left-3"
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scrollTo(active + 1)}
            className="kc-nav right-3"
            aria-label="Next photo"
          >
            ›
          </button>
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {n <= 14 ? (
              g.images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => scrollTo(i)}
                  aria-label={`Go to photo ${i + 1}`}
                  aria-current={i === active}
                  className={`h-1.5 rounded-full transition-all ${
                    i === active ? 'w-5 bg-navy-500 dark:bg-navy-300' : 'w-1.5 bg-[var(--line)] hover:bg-navy-300'
                  }`}
                />
              ))
            ) : (
              <span className="text-xs tabular-nums muted">
                {active + 1} / {n}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SpotlightLayout({ g, width, open, edit, active, setActive }: LayoutProps & Pager) {
  const n = g.images.length
  const img = g.images[Math.min(active, n - 1)]
  const strip = useRef<HTMLDivElement>(null)
  const thumb = width < 480 ? 56 : 72

  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [active])

  useEffect(() => {
    if (!edit?.selected) return
    const k = g.images.findIndex((i) => i.id === edit.selected)
    if (k >= 0) setActive(k)
  }, [edit?.selected, g.images, setActive])

  if (!img) return null

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setActive((active + 1) % n)
        if (e.key === 'ArrowLeft') setActive((active - 1 + n) % n)
      }}
    >
      <div className="relative">
        {/* Keyed so each change cross-fades in. */}
        <Tile
          key={img.id}
          img={img}
          g={g}
          aspect={g.aspect || 3 / 2}
          sizes={width}
          eager
          onOpen={() => open(active)}
          selected={edit?.selected === img.id}
          className="kc-fade"
        />
        {n > 1 && (
          <>
            <button type="button" className="kc-nav left-3" aria-label="Previous photo" onClick={() => setActive((active - 1 + n) % n)}>
              ‹
            </button>
            <button type="button" className="kc-nav right-3" aria-label="Next photo" onClick={() => setActive((active + 1) % n)}>
              ›
            </button>
          </>
        )}
      </div>
      {n > 1 && (
        <div ref={strip} className="kc-scroll-x mt-2 flex overflow-x-auto pb-1" style={{ gap: Math.max(4, g.gap / 1.5) }}>
          {g.images.map((it, i) => (
            <button
              key={it.id}
              data-i={i}
              type="button"
              onClick={() => {
                setActive(i)
                edit?.select(it.id)
              }}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
              className={`relative shrink-0 overflow-hidden transition ${
                i === active ? 'ring-2 ring-navy-500 ring-offset-2 ring-offset-[var(--card)] dark:ring-navy-300' : 'opacity-60 hover:opacity-100'
              }`}
              style={{ width: thumb, height: thumb, borderRadius: Math.min(g.radius, 10) }}
            >
              <Photo img={it} sizes={thumb * 2} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CollageLayout({ g, width, open, edit }: LayoutProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const images = useMemo(() => ensureBoxes(g), [g])
  // While a tile is being dragged it moves locally; the gallery (and the
  // document) only hears about it once, when the pointer is released.
  const [draft, setDraft] = useState<{ id: string; box: CollageBox } | null>(null)
  const height = width / g.canvas

  function begin(e: React.PointerEvent, img: GalleryImage, mode: 'move' | 'resize' | 'rotate') {
    if (!edit || !img.box) return
    e.preventDefault()
    e.stopPropagation()
    edit.select(img.id)
    const rect = canvasRef.current!.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const b0 = { ...img.box }
    const topZ = Math.max(...images.map((i) => i.box?.z ?? 0))
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let latest = b0
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - start.x) / rect.width) * 100
      const dy = ((ev.clientY - start.y) / rect.height) * 100
      if (Math.abs(dx) + Math.abs(dy) > 0.3) moved = true
      if (mode === 'move') {
        latest = { ...b0, x: clamp(b0.x + dx, -b0.w / 2, 100 - b0.w / 2), y: clamp(b0.y + dy, -b0.h / 2, 100 - b0.h / 2) }
      } else if (mode === 'resize') {
        // Keeps the tile's shape unless Shift is held, which crops freely.
        let w = clamp(b0.w + dx, 6, 140)
        let h = clamp(b0.h + dy, 6, 140)
        if (!ev.shiftKey) {
          const ratio = b0.w / b0.h
          if (Math.abs(dx) > Math.abs(dy)) h = w / ratio
          else w = h * ratio
        }
        latest = { ...b0, w, h }
      } else {
        const cx = rect.left + ((b0.x + b0.w / 2) / 100) * rect.width
        const cy = rect.top + ((b0.y + b0.h / 2) / 100) * rect.height
        let r = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
        if (r > 180) r -= 360
        // Snap to straight within 3°.
        if (Math.abs(r) < 3) r = 0
        latest = { ...b0, r: ev.shiftKey ? Math.round(r / 15) * 15 : r }
      }
      setDraft({ id: img.id, box: latest })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDraft(null)
      // Whatever is touched comes to the front.
      if (moved || b0.z < topZ) edit.setBox(img.id, { ...latest, z: b0.z < topZ ? topZ + 1 : b0.z })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={canvasRef}
      className={`kc-collage relative ${edit ? 'kc-collage-edit' : ''}`}
      style={{ height, borderRadius: Math.min(g.radius, 16) }}
      onPointerDown={(e) => {
        if (edit && e.target === e.currentTarget) edit.select(null)
      }}
    >
      {images.map((img, i) => {
        const box = draft?.id === img.id ? draft.box : img.box!
        const selected = edit?.selected === img.id
        return (
          <div
            key={img.id}
            className={`kc-collage-item absolute ${edit ? 'cursor-move touch-none' : ''}`}
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.w}%`,
              height: `${box.h}%`,
              transform: `rotate(${box.r}deg)`,
              zIndex: selected ? 9999 : box.z,
            }}
            onPointerDown={edit ? (e) => begin(e, img, 'move') : undefined}
          >
            <Tile
              img={img}
              g={g}
              sizes={(box.w / 100) * width}
              onOpen={edit ? undefined : () => open(i)}
              selected={selected}
              className="size-full shadow-lg"
            >
              {selected && (
                <>
                  <span
                    aria-hidden
                    onPointerDown={(e) => begin(e, img, 'resize')}
                    className="kc-handle absolute -bottom-2 -right-2 z-10 size-5 cursor-nwse-resize"
                  />
                  <span
                    aria-hidden
                    onPointerDown={(e) => begin(e, img, 'rotate')}
                    className="kc-handle kc-rotate absolute -top-7 left-1/2 z-10 size-5 -translate-x-1/2 cursor-grab"
                  />
                </>
              )}
            </Tile>
          </div>
        )
      })}
    </div>
  )
}

function CompareLayout({ g, width }: LayoutProps) {
  const [a, b] = g.images
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)
  if (!a || !b) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm muted">
        Before / after needs two photos.
      </p>
    )
  }
  const aspect = g.aspect || a.w / a.h

  function fromPointer(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect()
    setPos(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100))
  }

  return (
    <div
      ref={ref}
      className="kc-compare relative touch-pan-y select-none overflow-hidden"
      style={{ aspectRatio: String(aspect), borderRadius: g.radius }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        fromPointer(e)
      }}
      onPointerMove={(e) => e.buttons && fromPointer(e)}
    >
      <Photo img={b} sizes={width} eager />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <Photo img={a} sizes={width} eager />
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
        {a.caption?.trim() || 'Before'}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
        {b.caption?.trim() || 'After'}
      </span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_12px_rgb(0_0_0/0.5)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-sm font-bold text-navy-900 shadow-lg">
          ‹ ›
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(+e.target.value)}
        aria-label="Before / after position"
        className="kc-compare-range absolute inset-0 size-full opacity-0"
      />
    </div>
  )
}

interface LayoutProps {
  g: GalleryData
  width: number
  open: (i: number) => void
  edit?: GalleryEditHooks
}
interface Pager {
  active: number
  setActive: React.Dispatch<React.SetStateAction<number>>
}

// ---------------------------------------------------------------------------

export default function Gallery({ gallery: g, edit }: { gallery: GalleryData; edit?: GalleryEditHooks }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [active, setActive] = useState(0)

  const open = useCallback(
    (i: number) => {
      if (edit) edit.select(g.images[i]?.id ?? null)
      else setLightbox(i)
    },
    [edit, g.images],
  )

  const items = useMemo(
    () =>
      g.images.map((i) => ({
        src: i.src,
        thumb: i.thumb,
        alt: i.alt,
        caption: i.caption,
        w: i.w,
        h: i.h,
        lqip: i.lqip,
      })),
    [g.images],
  )

  if (!g.images.length) return null
  const props = { g, width, open, edit }

  return (
    <div className="kc-gallery not-prose" data-layout={g.layout}>
      {g.title?.trim() && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="kc-gallery-title">{g.title}</h3>
          {g.layout !== 'compare' && (
            <button type="button" className="text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200" onClick={() => setLightbox(0)}>
              View all {g.images.length} →
            </button>
          )}
        </div>
      )}
      {/* Sized by the page, never by the photos: layouts measure this box
          and size tiles from it, so its width must not depend on them. */}
      <div ref={ref} className="kc-measure">
        {width > 0 &&
          (g.layout === 'masonry' ? (
            <MasonryLayout {...props} />
          ) : g.layout === 'justified' ? (
            <JustifiedLayout {...props} />
          ) : g.layout === 'carousel' ? (
            <CarouselLayout {...props} active={active} setActive={setActive} />
          ) : g.layout === 'spotlight' ? (
            <SpotlightLayout {...props} active={active} setActive={setActive} />
          ) : g.layout === 'collage' ? (
            <CollageLayout {...props} />
          ) : g.layout === 'compare' ? (
            <CompareLayout {...props} />
          ) : (
            <GridLayout {...props} />
          ))}
      </div>
      {lightbox !== null && (
        <Lightbox
          items={items}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={g.layout === 'spotlight' ? setActive : undefined}
        />
      )}
    </div>
  )
}

export { Photo }
