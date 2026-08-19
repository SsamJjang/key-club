import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

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
}: {
  bucket: 'post-images' | 'avatars'
  folder?: string
  value: string
  onChange: (url: string) => void
  label?: string
  hint?: string
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

  return (
    <div>
      <span className="label">{label}</span>

      {value && (
        <img
          src={value}
          alt=""
          className="mb-3 max-h-40 w-full rounded-xl border border-[var(--line)] object-cover"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
        </button>
        {value && (
          <button type="button" className="btn btn-danger" onClick={() => onChange('')}>
            Remove
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

      <input
        className="field mt-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…or paste an image URL"
      />

      {hint && <p className="mt-1 text-xs muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  )
}
