import { useRef, useState } from 'react'
import { readableError, uploadImage, isImageFile, type UploadStage } from '../lib/images'
import { splitFocus, withFocus } from '../lib/gallery'
import CoverImage from './CoverImage'
import FocusPicker from './media/FocusPicker'

const STAGE_LABEL: Partial<Record<UploadStage, string>> = {
  processing: 'Straightening & shrinking…',
  uploading: 'Uploading…',
}

/**
 * Uploads to a public Supabase Storage bucket and hands back the public URL.
 * Used for post covers and member avatars. Any size in: the photo is fixed
 * up and compressed in the browser first (see lib/images.ts).
 */
export default function ImageUpload({
  bucket,
  folder,
  value,
  onChange,
  label = 'Image',
  hint,
  shape = 'wide',
}: {
  bucket: 'post-images' | 'avatars'
  folder?: string
  value: string
  onChange: (url: string) => void
  label?: string
  hint?: string
  /** 'wide' previews as a 16:9 cover; 'square' for avatars. */
  shape?: 'wide' | 'square'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const [showFocus, setShowFocus] = useState(false)
  const square = shape === 'square'
  const busy = preview !== null
  const { src, fx, fy } = splitFocus(value)

  async function upload(file: File) {
    setError(null)
    if (!isImageFile(file)) {
      setError('That file is not an image.')
      return
    }
    const local = URL.createObjectURL(file)
    setPreview(local)
    try {
      const u = await uploadImage(file, { bucket, folder }, setStage)
      // Covers are shown large, so they keep the full copy; avatars never
      // render above a few hundred pixels, so they take the small one.
      onChange(square ? u.thumb : u.src)
      setShowFocus(false)
    } catch (err) {
      setError(readableError(file, err))
    } finally {
      setStage(null)
      setPreview(null)
      URL.revokeObjectURL(local)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer.files).find(isImageFile)
    if (file) void upload(file)
  }

  return (
    <div
      onPaste={(e) => {
        const file = Array.from(e.clipboardData.files).find(isImageFile)
        if (file) {
          e.preventDefault()
          void upload(file)
        }
      }}
    >
      <span className="label">{label}</span>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`group relative overflow-hidden rounded-2xl border-2 transition ${
          dragging
            ? 'border-navy-400 bg-navy-50 dark:bg-navy-800/60'
            : value || preview
              ? 'border-transparent'
              : 'border-dashed border-[var(--line)] hover:border-navy-300 dark:hover:border-navy-600'
        } ${square ? 'mx-auto aspect-square max-w-48' : 'aspect-[16/9]'}`}
      >
        {preview ? (
          <>
            <img src={preview} alt="" className="size-full rounded-2xl object-cover opacity-60" />
            <div className="absolute inset-0 grid place-items-center">
              <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white">
                <span className="kc-spinner kc-spinner-inline" />
                {STAGE_LABEL[stage ?? 'processing'] ?? 'Working…'}
              </span>
            </div>
          </>
        ) : value ? (
          <>
            <CoverImage key={value} src={value} ratio={square ? 1 : 16 / 9} eager className="size-full rounded-2xl" />
            {/* Controls float over the preview so it shows at its real framing. */}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-10 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              {!square && (
                <button
                  type="button"
                  className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-navy-900 shadow hover:bg-white"
                  onClick={() => setShowFocus((s) => !s)}
                >
                  {showFocus ? 'Done' : 'Focus'}
                </button>
              )}
              <button
                type="button"
                className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-navy-900 shadow hover:bg-white"
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-600"
                onClick={() => onChange('')}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center"
          >
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-full bg-navy-50 text-xl text-navy-600 transition group-hover:scale-105 dark:bg-navy-800 dark:text-navy-200"
            >
              🖼️
            </span>
            <span className="text-sm font-semibold">
              {dragging ? 'Drop to upload' : 'Drop, paste, or click to upload'}
            </span>
            <span className="text-xs muted">Any photo, any size — it’s straightened and compressed for you</span>
          </button>
        )}
      </div>

      {showFocus && value && !square && (
        <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
          <p className="mb-2 text-xs muted">Click the part of the photo that must never be cropped out.</p>
          <FocusPicker src={src} fx={fx} fy={fy} onChange={(x, y) => onChange(withFocus(value, x, y))} previews={[16 / 9, 2, 4 / 3]} />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />

      {showUrl || (value && !src.includes('/storage/v1/object/public/')) ? (
        <input
          className="field mt-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste an image URL"
          autoFocus={showUrl && !value}
        />
      ) : (
        <button
          type="button"
          className="mt-2 text-xs font-semibold text-navy-600 hover:underline dark:text-navy-200"
          onClick={() => setShowUrl(true)}
        >
          …or paste an image URL
        </button>
      )}

      {hint && <p className="mt-1 text-xs muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  )
}
