import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import CoverImage from './CoverImage'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * Uploads to a public Supabase Storage bucket and hands back the public URL.
 * Used for post covers, inline post images, and member avatars.
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)

    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1e6).toFixed(1)} MB — the limit is 5 MB.`)
      return
    }

    setBusy(true)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `${folder ? `${folder}/` : ''}${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '31536000', upsert: false })

    if (uploadError) {
      setError(uploadError.message)
      setBusy(false)
      return
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    onChange(data.publicUrl)
    setBusy(false)
  }

  const [dragging, setDragging] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const square = shape === 'square'

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void upload(file)
  }

  return (
    <div>
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
            : value
              ? 'border-transparent'
              : 'border-dashed border-[var(--line)] hover:border-navy-300 dark:hover:border-navy-600'
        } ${square ? 'mx-auto aspect-square max-w-48' : 'aspect-[16/9]'}`}
      >
        {value ? (
          <>
            <CoverImage
              key={value}
              src={value}
              ratio={square ? 1 : 16 / 9}
              eager
              className="size-full rounded-2xl"
            />
            {/* Controls float over the preview so it shows at its real framing. */}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-10 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                type="button"
                className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-navy-900 shadow hover:bg-white"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? 'Uploading…' : 'Replace'}
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
              {busy ? '⏳' : '🖼️'}
            </span>
            <span className="text-sm font-semibold">
              {busy ? 'Uploading…' : dragging ? 'Drop to upload' : 'Drop an image or click to upload'}
            </span>
            <span className="text-xs muted">PNG, JPG, GIF or WebP · up to 5 MB</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />

      {showUrl || (value && !value.includes('/storage/v1/object/public/')) ? (
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
