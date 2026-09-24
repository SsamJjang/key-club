import { useEffect, useRef, useState } from 'react'
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type ReactNodeViewProps } from '@tiptap/react'
import {
  ASPECTS,
  LAYOUTS,
  PATTERNS,
  applyPattern,
  arrangeCollage,
  clamp,
  ensureBoxes,
  newGallery,
  parseGallery,
  serializeGallery,
  type CaptionMode,
  type CollageArrangement,
  type FrameStyle,
  type Gallery as GalleryData,
  type GalleryImage,
  type GalleryLayout,
} from '../../lib/gallery'
import { readableError, uploadImage, uploadMany, type UploadedImage, type UploadProgress } from '../../lib/images'
import Gallery from './Gallery'
import FocusPicker from './FocusPicker'

/**
 * The two image blocks the post editor knows:
 *
 *  - `figure`  one photo, with a caption, a width and an alignment
 *              (centre, wide, or floated left/right with text wrapping).
 *  - `gallery` any number of photos in any layout — see lib/gallery.ts.
 *
 * Files handed to the editor (toolbar, paste, drop) are parked here under a
 * token while their node is created; the node view picks them up on mount
 * and uploads them, showing progress in place.
 */

const pending = new Map<string, File[]>()
const FOLDER = 'body'

/** "Use as cover" in the editor talks to the post form through this event. */
export const COVER_EVENT = 'kc:set-cover'

function toImage(u: UploadedImage): GalleryImage {
  return {
    id: crypto.randomUUID(),
    src: u.src,
    thumb: u.thumb !== u.src ? u.thumb : undefined,
    w: u.w,
    h: u.h,
    lqip: u.lqip,
    color: u.color,
    alt: '',
    caption: '',
    fx: 50,
    fy: 50,
    cs: 1,
    rs: 1,
  }
}

function withImages(g: GalleryData, images: GalleryImage[]): GalleryData {
  let next = applyPattern(g.pattern, images, g.columns)
  if (g.layout === 'collage') next = ensureBoxes({ ...g, images: next })
  return { ...g, images: next }
}

// ---------------------------------------------------------------------------
// Insertion helpers (toolbar, paste, drop)
// ---------------------------------------------------------------------------

export function insertImages(editor: Editor, files: File[], opts: { at?: number; gallery?: boolean } = {}) {
  if (!files.length) return
  const token = crypto.randomUUID()
  pending.set(token, files)
  const asGallery = opts.gallery || files.length > 1
  const content = asGallery
    ? { type: 'gallery', attrs: { data: newGallery([]), pending: token, count: files.length } }
    : { type: 'figure', attrs: { pending: token } }
  const chain = editor.chain().focus()
  if (opts.at != null) chain.insertContentAt(opts.at, content).run()
  else chain.insertContent(content).run()
}

function moveBlock(editor: Editor, getPos: () => number | undefined, dir: -1 | 1) {
  const pos = getPos()
  if (typeof pos !== 'number') return
  const { state } = editor
  const node = state.doc.nodeAt(pos)
  if (!node) return
  const $pos = state.doc.resolve(pos)
  const index = $pos.index()
  const parent = $pos.parent
  if (dir === -1 && index === 0) return
  if (dir === 1 && index >= parent.childCount - 1) return

  const tr = state.tr
  if (dir === -1) {
    const prev = parent.child(index - 1)
    tr.delete(pos, pos + node.nodeSize).insert(pos - prev.nodeSize, node)
  } else {
    const next = parent.child(index + 1)
    tr.insert(pos + node.nodeSize + next.nodeSize, node).delete(pos, pos + node.nodeSize)
  }
  editor.view.dispatch(tr.scrollIntoView())
}

// ---------------------------------------------------------------------------
// Small UI atoms for the node views
// ---------------------------------------------------------------------------

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="kc-seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={o.value === value ? 'is-on' : ''}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide muted">{label}</span>
      {children}
    </label>
  )
}

function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix = 'px',
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="kc-range flex-1"
      />
      <span className="w-10 text-right text-xs tabular-nums muted">
        {Math.round(value)}
        {suffix}
      </span>
    </span>
  )
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--line)]" aria-label={label}>
      <button type="button" className="px-2.5 py-1 hover:bg-[var(--surface)] disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Less ${label}`}>
        −
      </button>
      <span className="w-7 text-center text-sm tabular-nums">{value}</span>
      <button type="button" className="px-2.5 py-1 hover:bg-[var(--surface)] disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
        +
      </button>
    </span>
  )
}

/** Tiny line drawings of each layout for the picker. */
function LayoutIcon({ id }: { id: GalleryLayout }) {
  const r = (x: number, y: number, w: number, h: number, k?: number) => (
    <rect key={`${x}${y}${w}${h}${k ?? ''}`} x={x} y={y} width={w} height={h} rx={1.2} />
  )
  const shapes: Record<GalleryLayout, React.ReactNode> = {
    grid: [r(1, 1, 10, 10), r(13, 1, 4.5, 4.5), r(19.5, 1, 4.5, 4.5), r(13, 6.5, 11, 4.5), r(1, 13, 7, 6), r(9.5, 13, 7, 6), r(18, 13, 6, 6)],
    masonry: [r(1, 1, 7, 10), r(1, 12.5, 7, 6.5), r(9.5, 1, 7, 6), r(9.5, 8.5, 7, 10.5), r(18, 1, 6, 8), r(18, 10.5, 6, 8.5)],
    justified: [r(1, 1, 9, 5.5), r(11.5, 1, 12.5, 5.5), r(1, 8, 14, 5.5), r(16.5, 8, 7.5, 5.5), r(1, 15, 6, 4), r(8.5, 15, 8, 4)],
    carousel: [r(1, 4, 3, 10), r(6, 2, 13, 14), r(21, 4, 3, 10), <circle key="d1" cx="10.5" cy="18.5" r=".9" />, <circle key="d2" cx="13" cy="18.5" r=".9" />, <circle key="d3" cx="15.5" cy="18.5" r=".9" />],
    spotlight: [r(1, 1, 23, 12), r(1, 15, 5, 4), r(7, 15, 5, 4), r(13, 15, 5, 4), r(19, 15, 5, 4)],
    collage: [
      <rect key="a" x="2" y="3" width="9" height="7" rx="1" transform="rotate(-8 6 6)" />,
      <rect key="b" x="12" y="2" width="10" height="8" rx="1" transform="rotate(6 17 6)" />,
      <rect key="c" x="6" y="10" width="11" height="8" rx="1" transform="rotate(3 11 14)" />,
    ],
    compare: [r(1, 1, 23, 18), <line key="l" x1="12.5" y1="1" x2="12.5" y2="19" strokeWidth="1.5" />, <circle key="c" cx="12.5" cy="10" r="2.4" />],
  }
  return (
    <svg viewBox="0 0 25 20" className="h-5 w-6 stroke-current" strokeWidth={1} aria-hidden>
      {shapes[id]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Gallery node view
// ---------------------------------------------------------------------------

function GalleryView({ node, editor, getPos, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const g: GalleryData = node.attrs.data ?? newGallery()
  const [selected, setSelected] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [seed, setSeed] = useState(7)
  const [showSettings, setShowSettings] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  /** Always edits the gallery as it is in the document right now. */
  function mutate(fn: (g: GalleryData) => GalleryData) {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const current = editor.state.doc.nodeAt(pos)
    if (!current || current.type.name !== 'gallery') return
    updateAttributes({ data: fn(current.attrs.data ?? newGallery()) })
  }
  const set = (patch: Partial<GalleryData>) => mutate((cur) => ({ ...cur, ...patch }))
  const setImage = (id: string, patch: Partial<GalleryImage>) =>
    mutate((cur) => ({ ...cur, images: cur.images.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))

  function upload(files: File[]) {
    if (!files.length) return
    const ids = new Set<string>()
    void uploadMany(
      files,
      { folder: FOLDER },
      (items) => {
        items.forEach((i) => ids.add(i.id))
        setUploads((prev) => [...prev.filter((p) => !ids.has(p.id)), ...items])
      },
      (img) => mutate((cur) => withImages(cur, [...cur.images, toImage(img)])),
    ).then((items) => {
      // Finished ones leave the tray; failures stay so they can be read.
      setUploads((prev) => prev.filter((p) => !ids.has(p.id) || p.stage === 'error'))
      if (items.some((i) => i.stage === 'error')) setShowSettings(true)
    })
  }

  // Pick up files parked by insertImages().
  useEffect(() => {
    const token = node.attrs.pending as string | null
    if (!token) return
    const files = pending.get(token)
    pending.delete(token)
    updateAttributes({ pending: null, count: null })
    if (files) upload(files)
    // Runs once per token; `upload` reads fresh state through mutate().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.pending])

  const sel = g.images.find((i) => i.id === selected) ?? null
  const selIndex = sel ? g.images.indexOf(sel) : -1
  const busy = uploads.filter((u) => u.stage !== 'done' && u.stage !== 'error')
  const failed = uploads.filter((u) => u.stage === 'error')
  const doneCount = uploads.filter((u) => u.stage === 'done').length
  const expecting = (node.attrs.count as number | null) ?? 0

  function move(from: number, to: number) {
    mutate((cur) => {
      if (to < 0 || to >= cur.images.length || from === to) return cur
      const images = [...cur.images]
      const [it] = images.splice(from, 1)
      images.splice(to, 0, it)
      return { ...cur, images: applyPattern(cur.pattern, images, cur.columns) }
    })
  }

  function setLayout(layout: GalleryLayout) {
    mutate((cur) => {
      const next = { ...cur, layout }
      if (layout === 'collage') next.images = ensureBoxes(next)
      // A square slide or before/after rarely suits photos; start them wide.
      if ((layout === 'carousel' || layout === 'spotlight') && cur.aspect === 1) next.aspect = 3 / 2
      if (layout === 'compare' && cur.aspect === 1) next.aspect = 0
      return next
    })
  }

  function arrange(mode: CollageArrangement, s = seed) {
    mutate((cur) => ({ ...cur, images: arrangeCollage(cur.images, cur.canvas, mode, s) }))
  }

  const isGrid = g.layout === 'grid'
  const isCollage = g.layout === 'collage'
  const shapeOptions = ASPECTS.filter((a) => a.value !== 0 || g.layout === 'compare')

  return (
    <NodeViewWrapper
      className="kc-gallery-editor not-prose"
      data-drag-handle=""
      contentEditable={false}
      onDragOver={(e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) setDragOver(false)
      }}
      onDrop={(e: React.DragEvent) => {
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
        if (!files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        upload(files)
      }}
      onPaste={(e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
        if (!files.length) return
        e.preventDefault()
        upload(files)
      }}
    >
      {/* ---- header -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-sm font-semibold">
          🖼️ Gallery
          <span className="ml-1.5 font-normal muted">
            {g.images.length} photo{g.images.length === 1 ? '' : 's'}
            {busy.length > 0 && ` · uploading ${busy.length}`}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="kc-chip" onClick={() => fileRef.current?.click()}>
            + Add photos
          </button>
          <button type="button" className="kc-chip" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            {showSettings ? 'Hide options' : 'Options'}
          </button>
          <button type="button" className="kc-icon" title="Move gallery up" aria-label="Move gallery up" onClick={() => moveBlock(editor, getPos, -1)}>
            ↑
          </button>
          <button type="button" className="kc-icon" title="Move gallery down" aria-label="Move gallery down" onClick={() => moveBlock(editor, getPos, 1)}>
            ↓
          </button>
          <button
            type="button"
            className="kc-icon text-red-600 dark:text-red-300"
            title="Delete gallery"
            aria-label="Delete gallery"
            onClick={() => {
              if (!g.images.length || window.confirm(`Remove this gallery and its ${g.images.length} photos from the post?`)) deleteNode()
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ---- layout + settings -------------------------------------- */}
      {showSettings && (
        <div className="space-y-3 border-b border-[var(--line)] px-3 py-3">
          <div className="kc-scroll-x -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.hint}
                onClick={() => setLayout(l.id)}
                aria-pressed={g.layout === l.id}
                className={`kc-layout-btn ${g.layout === l.id ? 'is-on' : ''}`}
              >
                <LayoutIcon id={l.id} />
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs muted">{LAYOUTS.find((l) => l.id === g.layout)?.hint}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Heading (optional)" wide>
              <input
                className="field py-1.5 text-sm"
                value={g.title ?? ''}
                placeholder="Photos from the day"
                onChange={(e) => set({ title: e.target.value })}
              />
            </Field>

            {(isGrid || g.layout === 'masonry') && (
              <Field label="Columns">
                <Seg
                  label="Columns"
                  value={g.columns}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
                  onChange={(columns) => mutate((cur) => ({ ...cur, columns, images: applyPattern(cur.pattern, cur.images, columns) }))}
                />
              </Field>
            )}

            {isGrid && (
              <Field label="Pattern" wide>
                <div className="flex flex-wrap gap-1">
                  {PATTERNS.filter((p) => p.id !== 'custom' || g.pattern === 'custom').map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`kc-chip ${g.pattern === p.id ? 'is-on' : ''}`}
                      onClick={() => mutate((cur) => ({ ...cur, pattern: p.id, images: applyPattern(p.id, cur.images, cur.columns) }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="mt-1 block text-[11px] muted">Or click a photo and drag its corner handle to span more cells.</span>
              </Field>
            )}

            {(isGrid || g.layout === 'carousel' || g.layout === 'spotlight' || g.layout === 'compare') && (
              <Field label={isGrid ? 'Cell shape' : 'Shape'}>
                <select className="field py-1.5 text-sm" value={g.aspect} onChange={(e) => set({ aspect: +e.target.value })}>
                  {shapeOptions.map((a) => (
                    <option key={a.label} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {g.layout === 'justified' && (
              <Field label="Row height">
                <Range value={g.rowHeight} min={100} max={420} step={10} onChange={(rowHeight) => set({ rowHeight })} />
              </Field>
            )}

            {g.layout === 'carousel' && (
              <Field label="Autoplay">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={g.autoplay} onChange={(e) => set({ autoplay: e.target.checked })} />
                  Advance every few seconds
                </label>
              </Field>
            )}

            {isCollage && (
              <>
                <Field label="Canvas shape">
                  <select
                    className="field py-1.5 text-sm"
                    value={g.canvas}
                    onChange={(e) => set({ canvas: +e.target.value })}
                  >
                    <option value={2}>Panorama 2:1</option>
                    <option value={1.6}>Wide 16:10</option>
                    <option value={4 / 3}>4:3</option>
                    <option value={1}>Square</option>
                    <option value={0.75}>Tall 3:4</option>
                  </select>
                </Field>
                <Field label="Arrange">
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        ['scatter', 'Scatter'],
                        ['tidy', 'Tidy'],
                        ['overlap', 'Fan'],
                        ['stack', 'Pile'],
                      ] as [CollageArrangement, string][]
                    ).map(([m, label]) => (
                      <button key={m} type="button" className="kc-chip" onClick={() => arrange(m)}>
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="kc-chip"
                      title="A new random scatter"
                      onClick={() => {
                        const s = Math.floor(Math.random() * 1e6) + 1
                        setSeed(s)
                        arrange('scatter', s)
                      }}
                    >
                      🎲 Shuffle
                    </button>
                  </div>
                </Field>
              </>
            )}

            {g.layout !== 'compare' && (
              <>
                <Field label="Spacing">
                  <Range value={g.gap} min={0} max={32} onChange={(gap) => set({ gap })} />
                </Field>
                <Field label="Corners">
                  <Range value={g.radius} min={0} max={32} onChange={(radius) => set({ radius })} />
                </Field>
                <Field label="Captions">
                  <select className="field py-1.5 text-sm" value={g.captions} onChange={(e) => set({ captions: e.target.value as CaptionMode })}>
                    <option value="hover">On hover</option>
                    <option value="overlay">Always, over the photo</option>
                    <option value="below">Below the photo</option>
                    <option value="none">Hidden</option>
                  </select>
                </Field>
                <Field label="Frame">
                  <Seg<FrameStyle>
                    label="Frame"
                    value={g.frame}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'border', label: 'Border' },
                      { value: 'polaroid', label: 'Polaroid' },
                    ]}
                    onChange={(frame) => set({ frame })}
                  />
                </Field>
              </>
            )}
            {g.layout === 'compare' && (
              <p className="text-xs muted sm:col-span-2">
                Uses the first two photos — drag to reorder in the strip below. Their captions become the “Before” and “After” labels.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- live preview -------------------------------------------- */}
      <div className={`relative p-3 ${dragOver ? 'kc-drop-on' : ''}`}>
        {g.images.length ? (
          <Gallery
            gallery={g}
            edit={{
              selected,
              select: setSelected,
              setSpan: (id, cs, rs) =>
                mutate((cur) => ({
                  ...cur,
                  pattern: 'custom',
                  images: cur.images.map((i) => (i.id === id ? { ...i, cs, rs } : i)),
                })),
              setBox: (id, box) => setImage(id, { box }),
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--line)] px-4 py-10 text-center transition hover:border-navy-300"
          >
            <span className="text-3xl" aria-hidden>
              {busy.length || expecting ? '⏳' : '🖼️'}
            </span>
            <span className="text-sm font-semibold">
              {busy.length || expecting ? `Preparing ${Math.max(busy.length, expecting)} photos…` : 'Drop photos here, or click to choose'}
            </span>
            <span className="text-xs muted">As many as you like · any size · phone photos are straightened and shrunk automatically</span>
          </button>
        )}
        {dragOver && (
          <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-navy-400 bg-navy-50/80 text-sm font-semibold text-navy-700 dark:bg-navy-900/80 dark:text-navy-100">
            Drop to add to this gallery
          </div>
        )}
      </div>

      {/* ---- upload progress ----------------------------------------- */}
      {(busy.length > 0 || failed.length > 0) && (
        <div className="space-y-2 px-3 pb-3">
          {busy.length > 0 && (
            <div>
              <div className="flex justify-between text-xs muted">
                <span>
                  Processing & uploading · {doneCount} of {uploads.length - failed.length} done
                </span>
                <span>{busy.filter((b) => b.stage === 'processing').length ? 'shrinking & straightening…' : 'sending…'}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full rounded-full bg-gold-400 transition-[width]"
                  style={{ width: `${Math.max(4, (doneCount / Math.max(1, uploads.length - failed.length)) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {failed.map((f) => (
            <div key={f.id} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <span className="font-semibold">{f.file.name}:</span>
              <span className="flex-1">{f.error}</span>
              <button type="button" className="font-semibold hover:underline" onClick={() => setUploads((u) => u.filter((x) => x.id !== f.id))}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---- photo strip: order + selection -------------------------- */}
      {(g.images.length > 0 || busy.length > 0) && (
        <div className="border-t border-[var(--line)] px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide muted">
            <span>Order · drag to rearrange, click to edit</span>
            {g.images.length > 1 && (
              <span className="flex gap-2 normal-case tracking-normal">
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => mutate((cur) => ({ ...cur, images: applyPattern(cur.pattern, [...cur.images].reverse(), cur.columns) }))}
                >
                  Reverse
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() =>
                    mutate((cur) => {
                      const images = [...cur.images]
                      for (let i = images.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1))
                        ;[images[i], images[j]] = [images[j], images[i]]
                      }
                      return { ...cur, images: applyPattern(cur.pattern, images, cur.columns) }
                    })
                  }
                >
                  Shuffle
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  setDragIndex(i)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/x-kc-tile', String(i))
                }}
                onDragOver={(e) => {
                  if (dragIndex !== null) {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                }}
                onDrop={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  e.stopPropagation()
                  move(dragIndex, i)
                  setDragIndex(null)
                }}
                onDragEnd={() => setDragIndex(null)}
                onClick={() => setSelected(selected === img.id ? null : img.id)}
                className={`kc-strip-tile ${selected === img.id ? 'is-on' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
                aria-label={`Photo ${i + 1}${img.caption ? `: ${img.caption}` : ''}`}
                aria-pressed={selected === img.id}
              >
                <img src={img.thumb ?? img.src} alt="" className="size-full object-cover" style={{ objectPosition: `${img.fx ?? 50}% ${img.fy ?? 50}%` }} />
                <span className="kc-strip-num">{i + 1}</span>
                {!img.alt && <span className="kc-strip-flag" title="No alt text yet" />}
              </button>
            ))}
            {busy.map((u) => (
              <span key={u.id} className="kc-strip-tile is-busy" title={`${u.file.name} — ${u.stage}`}>
                <img src={u.preview} alt="" className="size-full object-cover opacity-50" />
                <span className="kc-spinner" />
              </span>
            ))}
            <button type="button" onClick={() => fileRef.current?.click()} className="kc-strip-tile kc-strip-add" aria-label="Add photos">
              +
            </button>
          </div>
        </div>
      )}

      {/* ---- selected photo ------------------------------------------ */}
      {sel && (
        <div className="grid gap-4 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:grid-cols-[minmax(0,15rem)_1fr]">
          <FocusPicker
            src={sel.thumb ?? sel.src}
            fx={sel.fx ?? 50}
            fy={sel.fy ?? 50}
            onChange={(fx, fy) => setImage(sel.id, { fx, fy })}
            previews={[g.aspect || 1, 16 / 9]}
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                Photo {selIndex + 1} of {g.images.length}
              </span>
              <button type="button" className="kc-icon" onClick={() => setSelected(null)} aria-label="Close photo settings">
                ✕
              </button>
            </div>
            <Field label="Caption">
              <input
                className="field py-1.5 text-sm"
                value={sel.caption ?? ''}
                placeholder={g.layout === 'compare' ? (selIndex === 0 ? 'Before' : 'After') : 'What’s happening here?'}
                onChange={(e) => setImage(sel.id, { caption: e.target.value })}
              />
            </Field>
            <Field label="Alt text — describes the photo for screen readers">
              <input
                className="field py-1.5 text-sm"
                value={sel.alt ?? ''}
                placeholder="Five members sorting canned food at the food bank"
                onChange={(e) => setImage(sel.id, { alt: e.target.value })}
              />
            </Field>

            {isGrid && (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-2">
                  <span className="muted">Wide</span>
                  <Stepper
                    label="columns"
                    value={sel.cs ?? 1}
                    min={1}
                    max={g.columns}
                    onChange={(cs) => mutate((cur) => ({ ...cur, pattern: 'custom', images: cur.images.map((i) => (i.id === sel.id ? { ...i, cs } : i)) }))}
                  />
                </span>
                <span className="flex items-center gap-2">
                  <span className="muted">Tall</span>
                  <Stepper
                    label="rows"
                    value={sel.rs ?? 1}
                    min={1}
                    max={6}
                    onChange={(rs) => mutate((cur) => ({ ...cur, pattern: 'custom', images: cur.images.map((i) => (i.id === sel.id ? { ...i, rs } : i)) }))}
                  />
                </span>
              </div>
            )}

            {isCollage && sel.box && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tilt">
                  <Range value={sel.box.r} min={-45} max={45} suffix="°" onChange={(r) => setImage(sel.id, { box: { ...sel.box!, r } })} />
                </Field>
                <Field label="Size">
                  <Range
                    value={sel.box.w}
                    min={8}
                    max={100}
                    suffix="%"
                    onChange={(w) => setImage(sel.id, { box: { ...sel.box!, w, h: sel.box!.h * (w / sel.box!.w) } })}
                  />
                </Field>
                <div className="flex flex-wrap gap-1 sm:col-span-2">
                  <button
                    type="button"
                    className="kc-chip"
                    onClick={() => setImage(sel.id, { box: { ...sel.box!, z: Math.max(...g.images.map((i) => i.box?.z ?? 0)) + 1 } })}
                  >
                    Bring to front
                  </button>
                  <button
                    type="button"
                    className="kc-chip"
                    onClick={() => setImage(sel.id, { box: { ...sel.box!, z: Math.min(...g.images.map((i) => i.box?.z ?? 0)) - 1 } })}
                  >
                    Send to back
                  </button>
                  <button
                    type="button"
                    className="kc-chip"
                    onClick={() => setImage(sel.id, { box: { ...sel.box!, r: 0, h: (sel.box!.w * g.canvas) / (sel.w / sel.h) } })}
                  >
                    Straighten & uncrop
                  </button>
                </div>
                <p className="text-[11px] muted sm:col-span-2">
                  On the canvas: drag to move, corner to resize (Shift crops freely), top dot to rotate (Shift snaps to 15°).
                </p>
              </div>
            )}

            {!isCollage && g.layout !== 'compare' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={!!sel.contain} onChange={(e) => setImage(sel.id, { contain: e.target.checked })} />
                Show the whole photo (no cropping)
              </label>
            )}

            <div className="flex flex-wrap gap-1 pt-1">
              <button type="button" className="kc-chip" disabled={selIndex === 0} onClick={() => move(selIndex, selIndex - 1)}>
                ← Earlier
              </button>
              <button type="button" className="kc-chip" disabled={selIndex === g.images.length - 1} onClick={() => move(selIndex, selIndex + 1)}>
                Later →
              </button>
              <button type="button" className="kc-chip" disabled={selIndex === 0} onClick={() => move(selIndex, 0)}>
                Make first
              </button>
              <button
                type="button"
                className="kc-chip"
                onClick={() => window.dispatchEvent(new CustomEvent(COVER_EVENT, { detail: sel.src }))}
                title="Use this photo as the post's cover image"
              >
                ★ Use as cover
              </button>
              <button
                type="button"
                className="kc-chip text-red-600 dark:text-red-300"
                onClick={() => {
                  const next = g.images[selIndex + 1] ?? g.images[selIndex - 1]
                  mutate((cur) => withImages(cur, cur.images.filter((i) => i.id !== sel.id)))
                  setSelected(next?.id ?? null)
                }}
              >
                Remove photo
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </NodeViewWrapper>
  )
}

export const GalleryNode = Node.create({
  name: 'gallery',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => parseGallery(el.getAttribute('data-kc-gallery')),
        renderHTML: () => ({}),
      },
      // Editor-only: files waiting to upload, and how many, for the placeholder.
      pending: { default: null, rendered: false },
      count: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-kc-gallery]' }]
  },

  renderHTML({ node }) {
    const g: GalleryData = node.attrs.data ?? newGallery()
    // The figures are a fallback for anything that can't read the JSON.
    return [
      'div',
      { 'data-kc-gallery': serializeGallery(g), class: 'kc-gallery-static' },
      ...g.images.map((i) => [
        'figure',
        {},
        ['img', { src: i.thumb ?? i.src, 'data-full': i.src, alt: i.alt ?? '', width: String(i.w), height: String(i.h), loading: 'lazy' }],
        ...(i.caption ? [['figcaption', {}, i.caption]] : []),
      ]),
    ] as unknown as [string, Record<string, string>]
  },

  addNodeView() {
    return ReactNodeViewRenderer(GalleryView, {
      // Everything inside is our own UI — ProseMirror keeps its hands off.
      stopEvent: () => true,
      ignoreMutation: () => true,
    })
  },
})

// ---------------------------------------------------------------------------
// Figure (single photo) node view
// ---------------------------------------------------------------------------

type Align = 'center' | 'wide' | 'left' | 'right'

function FigureView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const a = node.attrs as {
    src: string | null
    thumb: string | null
    alt: string
    caption: string
    width: number
    align: Align
    w: number | null
    h: number | null
    lqip: string | null
    color: string | null
    fx: number
    fy: number
    pending: string | null
  }
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFocus, setShowFocus] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setError(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    try {
      const u = await uploadImage(file, { folder: FOLDER })
      updateAttributes({
        src: u.src,
        thumb: u.thumb !== u.src ? u.thumb : null,
        w: u.w,
        h: u.h,
        lqip: u.lqip,
        color: u.color,
        fx: 50,
        fy: 50,
      })
    } catch (err) {
      setError(readableError(file, err))
    } finally {
      URL.revokeObjectURL(url)
      setPreview(null)
    }
  }

  useEffect(() => {
    const token = a.pending
    if (!token) return
    const files = pending.get(token)
    pending.delete(token)
    updateAttributes({ pending: null })
    if (files?.[0]) void upload(files[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.pending])

  /** Drag either edge; the figure stays centred/anchored and snaps to 5%. */
  function startResize(e: React.PointerEvent, side: 'left' | 'right') {
    e.preventDefault()
    e.stopPropagation()
    const figure = boxRef.current?.closest('figure') as HTMLElement | null
    const parent = figure?.parentElement
    if (!figure || !parent) return
    const full = parent.clientWidth
    const startW = figure.getBoundingClientRect().width
    const sx = e.clientX
    const centred = a.align === 'center'
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      let dx = ev.clientX - sx
      if (side === 'left') dx = -dx
      if (centred) dx *= 2
      const pct = clamp(Math.round((((startW + dx) / full) * 100) / 5) * 5, 15, 100)
      figure.style.setProperty('--kc-w', `${pct}%`)
      figure.dataset.live = `${pct}%`
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      const pct = parseInt(figure.style.getPropertyValue('--kc-w')) || a.width
      delete figure.dataset.live
      updateAttributes({ width: pct })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  function toGallery() {
    const pos = getPos()
    if (typeof pos !== 'number' || !a.src) return
    const img: GalleryImage = {
      id: crypto.randomUUID(),
      src: a.src,
      thumb: a.thumb ?? undefined,
      w: a.w ?? 1200,
      h: a.h ?? 900,
      alt: a.alt,
      caption: a.caption,
      lqip: a.lqip ?? undefined,
      color: a.color ?? undefined,
      fx: a.fx,
      fy: a.fy,
    }
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'gallery', attrs: { data: newGallery([img]) } })
      .run()
  }

  const src = preview ?? a.thumb ?? a.src
  const width = a.align === 'wide' ? 100 : a.width

  return (
    <NodeViewWrapper
      as="figure"
      data-kc-figure=""
      data-align={a.align}
      className={`kc-figure ${selected ? 'is-selected' : ''}`}
      style={{ '--kc-w': `${width}%` } as React.CSSProperties}
    >
      <div ref={boxRef} className="kc-figure-media relative" data-drag-handle="">
        {src ? (
          <img
            src={src}
            alt={a.alt}
            width={a.w ?? undefined}
            height={a.h ?? undefined}
            draggable={false}
            style={{ background: a.color ?? undefined }}
            className={preview ? 'opacity-60' : ''}
          />
        ) : (
          <div className="grid aspect-[16/9] place-items-center rounded-2xl bg-[var(--surface)] text-sm muted">
            {error ? 'Upload failed' : 'Preparing photo…'}
          </div>
        )}
        {preview && <span className="kc-spinner" />}

        {selected && src && !preview && (
          <>
            {a.align !== 'wide' && (
              <>
                <span className="kc-edge kc-edge-l" onPointerDown={(e) => startResize(e, 'left')} aria-hidden />
                <span className="kc-edge kc-edge-r" onPointerDown={(e) => startResize(e, 'right')} aria-hidden />
              </>
            )}
            <div className="kc-figure-bar" contentEditable={false}>
              {(
                [
                  ['left', '⬅︎', 'Float left, text wraps'],
                  ['center', '⬌', 'Centred'],
                  ['right', '➡︎', 'Float right, text wraps'],
                  ['wide', '⤢', 'Extra wide'],
                ] as [Align, string, string][]
              ).map(([al, icon, title]) => (
                <button
                  key={al}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={a.align === al}
                  className={a.align === al ? 'is-on' : ''}
                  onClick={() =>
                    updateAttributes({
                      align: al,
                      width: (al === 'left' || al === 'right') && a.width > 60 ? 45 : a.width,
                    })
                  }
                >
                  {icon}
                </button>
              ))}
              <span className="kc-bar-sep" />
              {[33, 50, 75, 100].map((w) => (
                <button
                  key={w}
                  type="button"
                  disabled={a.align === 'wide'}
                  className={a.width === w && a.align !== 'wide' ? 'is-on' : ''}
                  onClick={() => updateAttributes({ width: w })}
                  title={`${w}% width`}
                >
                  {w === 33 ? '⅓' : w === 50 ? '½' : w === 75 ? '¾' : 'Full'}
                </button>
              ))}
              <span className="kc-bar-sep" />
              <button type="button" onClick={() => setShowFocus((s) => !s)} className={showFocus ? 'is-on' : ''} title="Alt text for screen readers">
                Alt
              </button>
              <button type="button" onClick={toGallery} title="Turn into a gallery so you can add more photos">
                +Gallery
              </button>
              <button type="button" onClick={() => replaceRef.current?.click()} title="Replace photo">
                ⟳
              </button>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(COVER_EVENT, { detail: a.src }))} title="Use as the post’s cover">
                ★
              </button>
              <button type="button" onClick={() => moveBlock(editor, getPos, -1)} title="Move up">
                ↑
              </button>
              <button type="button" onClick={() => moveBlock(editor, getPos, 1)} title="Move down">
                ↓
              </button>
              <button type="button" onClick={deleteNode} title="Delete photo" className="text-red-600 dark:text-red-300">
                ✕
              </button>
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}

      {(selected || a.caption) && (
        <input
          className="kc-caption-input"
          value={a.caption}
          placeholder="Add a caption…"
          onChange={(e) => updateAttributes({ caption: e.target.value })}
        />
      )}
      {selected && showFocus && a.src && (
        <div className="mt-2 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-left">
          <input
            className="field py-1.5 text-sm"
            value={a.alt}
            placeholder="Alt text: describe the photo for screen readers"
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
        </div>
      )}

      <input
        ref={replaceRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
    </NodeViewWrapper>
  )
}

export const FigureNode = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      thumb: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      width: { default: 100 },
      align: { default: 'center' },
      w: { default: null },
      h: { default: null },
      lqip: { default: null },
      color: { default: null },
      fx: { default: 50 },
      fy: { default: 50 },
      pending: { default: null, rendered: false },
    }
  },

  parseHTML() {
    const num = (v: string | null) => (v && Number.isFinite(+v) ? +v : null)
    return [
      {
        tag: 'figure[data-kc-figure]',
        getAttrs: (el) => {
          const img = el.querySelector('img')
          if (!img) return false
          const full = img.getAttribute('data-full')
          const shown = img.getAttribute('src')
          const w = /--kc-w:\s*(\d+)%/.exec(el.getAttribute('style') ?? '')
          return {
            src: full || shown,
            thumb: full && shown !== full ? shown : null,
            alt: img.getAttribute('alt') ?? '',
            caption: el.querySelector('figcaption')?.textContent ?? '',
            width: w ? +w[1] : 100,
            align: (['center', 'wide', 'left', 'right'] as const).find((x) => x === el.getAttribute('data-align')) ?? 'center',
            w: num(img.getAttribute('width')),
            h: num(img.getAttribute('height')),
            lqip: img.getAttribute('data-lqip'),
            color: img.getAttribute('data-color'),
            fx: num(img.getAttribute('data-fx')) ?? 50,
            fy: num(img.getAttribute('data-fy')) ?? 50,
          }
        },
      },
      // Posts written before figures existed: a bare <img>.
      {
        tag: 'img[src]',
        priority: 40,
        getAttrs: (el) => ({ src: el.getAttribute('src'), alt: el.getAttribute('alt') ?? '' }),
      },
    ]
  },

  renderHTML({ node }) {
    const a = node.attrs
    if (!a.src) return ['figure', { 'data-kc-figure': '', 'data-pending': '' }]
    const img: Record<string, string> = {
      src: a.thumb ?? a.src,
      'data-full': a.src,
      alt: a.alt ?? '',
      loading: 'lazy',
      decoding: 'async',
    }
    if (a.w) img.width = String(a.w)
    if (a.h) img.height = String(a.h)
    if (a.lqip) img['data-lqip'] = a.lqip
    if (a.color) img['data-color'] = a.color
    if (a.color) img.style = `background:${a.color}`
    return [
      'figure',
      { 'data-kc-figure': '', 'data-align': a.align, style: `--kc-w:${a.align === 'wide' ? 100 : a.width}%` },
      ['img', img],
      ...(a.caption ? [['figcaption', {}, a.caption]] : []),
    ] as unknown as [string, Record<string, string>]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView, {
      // Let our inputs and handles work; everything else (selecting,
      // dragging the figure around the document) stays ProseMirror's.
      stopEvent: ({ event }) => {
        const t = event.target as HTMLElement | null
        return !!t?.closest?.('input, textarea, select, button, .kc-edge, .kc-figure-bar')
      },
    })
  },
})
