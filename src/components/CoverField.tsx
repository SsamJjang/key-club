import { useEffect, useRef, useState } from 'react'
import { isImageFile, readableError, uploadImage, type UploadStage } from '../lib/images'
import { clamp, splitFocus, withFocus, type BodyImage } from '../lib/gallery'
import CoverImage, { fillsFrame } from './CoverImage'

/**
 * The post's cover, edited where it will be seen: in the main column,
 * between the summary and the story, at the shape it is shown in.
 *
 * The same photo is framed three ways across the site — the 2:1 post
 * header, 16:9 cards and the 4:3 home-page feature — so the preview can be
 * switched between them. Photos that fit a frame are cropped to fill it and
 * can be repositioned by dragging; logos and odd shapes are shown whole over
 * a soft backdrop, and there is nothing to reposition.
 */

const FRAMES = [
  { id: 'header', label: 'Post header', ratio: 2 },
  { id: 'card', label: 'Card', ratio: 16 / 9 },
  { id: 'home', label: 'Home feature', ratio: 4 / 3 },
] as const
type FrameId = (typeof FRAMES)[number]['id']

const STAGE: Partial<Record<UploadStage, string>> = {
  processing: 'Straightening & shrinking…',
  uploading: 'Uploading…',
}

export default function CoverField({
  value,
  onChange,
  photos,
}: {
  value: string
  onChange: (url: string) => void
  /** Photos already in the post body — one click makes any of them the cover. */
  photos: BodyImage[]
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<FrameId>('header')
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [picking, setPicking] = useState(false)
  const [linking, setLinking] = useState(false)
  const [repositioning, setRepositioning] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const { src, fx, fy } = splitFocus(value)
  const ratio = FRAMES.find((f) => f.id === frame)!.ratio
  const fills = natural ? fillsFrame(natural.w, natural.h, ratio) : true
  const uploaded = src.includes('/storage/v1/object/public/')

  // Size of the photo, for the caption line and the fill/whole decision.
  useEffect(() => {
    setNatural(null)
    if (!src) return
    const img = new Image()
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = src
  }, [src])

  useEffect(() => {
    if (!fills) setRepositioning(false)
  }, [fills])

  async function upload(file: File) {
    setError(null)
    if (!isImageFile(file)) {
      setError('That file is not an image.')
      return
    }
    const local = URL.createObjectURL(file)
    setPreview(local)
    setPicking(false)
    try {
      const u = await uploadImage(file, { folder: 'covers' }, setStage)
      onChange(u.src)
    } catch (err) {
      setError(readableError(file, err))
    } finally {
      setStage(null)
      setPreview(null)
      URL.revokeObjectURL(local)
    }
  }

  /**
   * Dragging moves the photo, like repositioning a cover anywhere else: the
   * focus point moves opposite the pointer, scaled by how much of the photo
   * is hidden on that axis so the photo tracks the finger one-to-one.
   */
  function startReposition(e: React.PointerEvent) {
    if (!repositioning || !natural || !frameRef.current) return
    e.preventDefault()
    const box = frameRef.current.getBoundingClientRect()
    const scale = Math.max(box.width / natural.w, box.height / natural.h)
    const hiddenX = natural.w * scale - box.width
    const hiddenY = natural.h * scale - box.height
    const start = { x: e.clientX, y: e.clientY, fx, fy }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const nx = hiddenX > 1 ? clamp(start.fx - ((ev.clientX - start.x) / hiddenX) * 100, 0, 100) : 50
      const ny = hiddenY > 1 ? clamp(start.fy - ((ev.clientY - start.y) / hiddenY) * 100, 0, 100) : 50
      onChange(withFocus(src, nx, ny))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      const file = Array.from(e.dataTransfer.files).find(isImageFile)
      if (!file) return
      e.preventDefault()
      setDragging(false)
      void upload(file)
    },
  }

  const otherPhotos = photos.filter((p) => p.src !== src)

  return (
    <section
      aria-labelledby="cover-label"
      onPaste={(e) => {
        const file = Array.from(e.clipboardData.files).find(isImageFile)
        if (file) {
          e.preventDefault()
          void upload(file)
        }
      }}
    >
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <span id="cover-label" className="label mb-0">
          Cover
        </span>
        {src && !preview && (
          <div role="tablist" aria-label="Preview as" className="kc-seg kc-seg-sm">
            {FRAMES.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={frame === f.id}
                className={frame === f.id ? 'is-on' : ''}
                onClick={() => setFrame(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {preview ? (
        // ---- uploading ------------------------------------------------
        <div className="relative overflow-hidden rounded-2xl" style={{ aspectRatio: '2' }}>
          <img src={preview} alt="" className="size-full object-cover opacity-50 blur-[1px]" />
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
              <span className="kc-spinner kc-spinner-inline" />
              {STAGE[stage ?? 'processing'] ?? 'Working…'}
            </span>
          </div>
        </div>
      ) : src ? (
        // ---- has a cover ----------------------------------------------
        <div {...dropProps} className="kc-cover group relative">
          <div
            ref={frameRef}
            onPointerDown={startReposition}
            className={`relative overflow-hidden rounded-2xl border border-[var(--line)] transition-[aspect-ratio] duration-300 ${
              repositioning ? 'cursor-move touch-none select-none' : ''
            }`}
            style={{ aspectRatio: String(ratio) }}
          >
            {repositioning ? (
              <>
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                  style={{ objectPosition: `${fx}% ${fy}%` }}
                />
                <div className="kc-thirds pointer-events-none absolute inset-0" aria-hidden />
                <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  Drag the photo to reposition
                </span>
              </>
            ) : (
              <CoverImage key={`${value}-${frame}`} src={value} ratio={ratio} eager className="size-full" />
            )}

            {dragging && (
              <div className="absolute inset-0 grid place-items-center bg-navy-900/70 text-sm font-semibold text-white">
                Drop to replace the cover
              </div>
            )}

          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 text-xs leading-relaxed muted">
              <span className="font-medium text-[var(--ink)]">
                {fills ? (fx !== 50 || fy !== 50 ? 'Cropped to fill · repositioned' : 'Cropped to fill') : 'Shown whole'}
              </span>
              {!fills && <span> — its shape doesn’t suit this frame, so nothing is cut off</span>}
              <span className="block">
                {uploaded ? 'Uploaded photo' : `Linked from ${hostOf(src)}`}
                {natural && ` · ${natural.w}×${natural.h}`}
                {!uploaded && (
                  <>
                    {' · '}
                    <button type="button" className="font-semibold text-navy-600 hover:underline dark:text-navy-200" onClick={() => setLinking(true)}>
                      Edit link
                    </button>
                  </>
                )}
              </span>
            </p>

            <div className="flex shrink-0 flex-wrap gap-1.5">
              {repositioning ? (
                <>
                  <button type="button" className="kc-chip" onClick={() => onChange(withFocus(src, 50, 50))}>
                    Centre
                  </button>
                  <button type="button" className="kc-chip kc-chip-gold" onClick={() => setRepositioning(false)}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  {fills && (
                    <button type="button" className="kc-chip" onClick={() => setRepositioning(true)}>
                      Reposition
                    </button>
                  )}
                  <button type="button" className="kc-chip" onClick={() => fileRef.current?.click()}>
                    Replace
                  </button>
                  {otherPhotos.length > 0 && (
                    <button type="button" className={`kc-chip ${picking ? 'is-on' : ''}`} onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
                      From post
                    </button>
                  )}
                  <button type="button" className="kc-chip text-red-600 dark:text-red-300" onClick={() => onChange('')}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        // ---- empty ----------------------------------------------------
        <div
          {...dropProps}
          className={`kc-cover-empty flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? 'border-navy-400 bg-navy-50 dark:bg-navy-800/50' : 'border-[var(--line)]'
          }`}
        >
          <div>
            <p className="text-sm font-semibold">{dragging ? 'Drop to use as the cover' : 'Add a cover photo'}</p>
            <p className="mt-1 text-xs muted">
              It leads the post and its card on the feed. Drop or paste a photo here — any size.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-primary py-1.5 text-sm" onClick={() => fileRef.current?.click()}>
              Upload photo
            </button>
            {photos.length > 0 && (
              <button type="button" className="btn btn-ghost py-1.5 text-sm" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
                Choose from this post ({photos.length})
              </button>
            )}
            <button type="button" className="btn btn-ghost py-1.5 text-sm" onClick={() => setLinking(true)}>
              Paste a link
            </button>
          </div>
        </div>
      )}

      {/* ---- pick one of the post's own photos ------------------------- */}
      {picking && (src ? otherPhotos : photos).length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold">Photos in this post</span>
            <button type="button" className="muted hover:underline" onClick={() => setPicking(false)}>
              Close
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {(src ? otherPhotos : photos).map((p) => (
              <button
                key={p.src}
                type="button"
                onClick={() => {
                  onChange(p.src)
                  setPicking(false)
                }}
                className="aspect-square overflow-hidden rounded-lg ring-navy-400 transition hover:ring-2"
              >
                <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {linking && (
        <input
          className="field mt-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… image link"
          autoFocus
          onBlur={() => setLinking(false)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), setLinking(false))}
        />
      )}

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />
    </section>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'a link'
  }
}
