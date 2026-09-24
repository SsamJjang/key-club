import { supabase } from './supabase'

/**
 * Everything an image goes through between "someone picked a file" and "it is
 * a URL in a post".
 *
 * Phones hand us 12-megapixel HEIC/JPEG files with the photo stored sideways
 * and the GPS position of the student's house in the EXIF. Shipping those
 * as-is makes a 40-photo event gallery a 150 MB page and leaks location data.
 * So every raster image is decoded, turned upright, scaled down, re-encoded
 * (which drops all metadata) and uploaded twice: a large copy for the lightbox
 * and a small one for grids and cards. A tiny blurred preview and the average
 * colour ride along in the post itself, so tiles have something to show
 * before the network catches up.
 *
 * There is no size limit on the way in — a 30 MB camera original is fine,
 * because what leaves the browser is a few hundred KB.
 */

/** Longest edge of the lightbox copy. Sharp on a 4K screen at full size. */
const FULL_EDGE = 2400
/** Longest edge of the grid/card copy. Covers a 3-column grid on a retina laptop. */
const THUMB_EDGE = 960
/** The blurred placeholder. Tiny on purpose: it is stored inline in the post. */
const LQIP_EDGE = 20

export interface ProcessedImage {
  full: Blob
  /** Absent when the full copy is already small (or animated) — use `full`. */
  thumb: Blob | null
  ext: string
  width: number
  height: number
  /** data: URL of a ~20px version, shown blurred while the real one loads. */
  lqip: string
  /** Average colour, e.g. "#6b7f92". The frame's background before anything loads. */
  color: string
}

export interface UploadedImage {
  src: string
  thumb: string
  w: number
  h: number
  lqip: string
  color: string
  /** The file's name minus extension — a starting point for alt text. */
  name: string
}

export type UploadStage = 'queued' | 'processing' | 'uploading' | 'done' | 'error'

export interface UploadProgress {
  id: string
  file: File
  stage: UploadStage
  /** Object URL for an instant local preview while the upload runs. */
  preview: string
  error?: string
  result?: UploadedImage
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

type Source = ImageBitmap | HTMLImageElement

function sourceSize(s: Source) {
  return s instanceof HTMLImageElement
    ? { w: s.naturalWidth, h: s.naturalHeight }
    : { w: s.width, h: s.height }
}

function loadElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode'))
    img.src = url
  })
}

/**
 * createImageBitmap with `imageOrientation: 'from-image'` applies the EXIF
 * rotation, which is the whole reason phone photos show up sideways. An <img>
 * element does the same in every current browser, so it is the fallback.
 */
async function decode(file: File): Promise<Source> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through — Safari refuses some options, some formats need <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await loadElement(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isHeic(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
}

// ---------------------------------------------------------------------------
// Resizing & encoding
// ---------------------------------------------------------------------------

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function fit(w: number, h: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/**
 * Canvas downscaling in one jump from 4000px to 400px skips most of the
 * source pixels and shimmers. Halving repeatedly until the last step is
 * under 2× keeps it as clean as a proper resampler.
 */
function resize(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number) {
  let cur: CanvasImageSource = src
  let cw = sw
  let ch = sh

  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.round(cw / 2)
    const nh = Math.round(ch / 2)
    const step = canvas(nw, nh)
    const ctx = step.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
    cur = step
    cw = nw
    ch = nh
  }

  const out = canvas(tw, th)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th)
  return out
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality))
}

let webpSupport: Promise<boolean> | null = null
/** Older Safari silently hands back a PNG when asked for WebP. */
function canEncodeWebp() {
  webpSupport ??= toBlob(canvas(2, 2), 'image/webp', 0.8).then((b) => b?.type === 'image/webp')
  return webpSupport
}

function hasAlpha(c: HTMLCanvasElement) {
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
  return false
}

function averageColor(c: HTMLCanvasElement) {
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    if (a < 0.1) continue
    r += data[i] * a
    g += data[i + 1] * a
    b += data[i + 2] * a
    n += a
  }
  if (!n) return '#8a94a6'
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

async function encode(c: HTMLCanvasElement, alpha: boolean, quality: number) {
  if (await canEncodeWebp()) {
    const b = await toBlob(c, 'image/webp', quality)
    if (b) return { blob: b, ext: 'webp' }
  }
  // No WebP: JPEG unless there is transparency to keep.
  const type = alpha ? 'image/png' : 'image/jpeg'
  const b = await toBlob(c, type, alpha ? undefined : quality)
  if (!b) throw new Error('encode')
  return { blob: b, ext: alpha ? 'png' : 'jpg' }
}

// ---------------------------------------------------------------------------
// Public: processing
// ---------------------------------------------------------------------------

export function readableError(file: File, err: unknown): string {
  if (isHeic(file)) {
    return 'This browser can’t open iPhone HEIC photos. Open it in Photos and share/export as JPEG, or upload from Safari.'
  }
  if (err instanceof Error && err.message === 'decode') {
    return 'That file couldn’t be read as an image. It may be damaged or an unsupported format.'
  }
  return err instanceof Error ? err.message : 'Something went wrong with that image.'
}

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(heic|heif|avif|webp|jpe?g|png|gif|bmp|svg)$/i.test(file.name)
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const type = file.type.toLowerCase()

  // Animated GIFs and SVGs lose what makes them what they are on a canvas,
  // so they go up untouched. We still measure them for layout.
  if (type === 'image/gif' || type === 'image/svg+xml') {
    const url = URL.createObjectURL(file)
    try {
      const img = await loadElement(url)
      const w = img.naturalWidth || 800
      const h = img.naturalHeight || 600
      const small = fit(w, h, LQIP_EDGE)
      const tiny = resize(img, w, h, small.w, small.h)
      return {
        full: file,
        thumb: null,
        ext: type === 'image/gif' ? 'gif' : 'svg',
        width: w,
        height: h,
        lqip: tiny.toDataURL('image/png'),
        color: averageColor(tiny),
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const source = await decode(file)
  const { w, h } = sourceSize(source)
  if (!w || !h) throw new Error('decode')

  const full = fit(w, h, FULL_EDGE)
  const fullCanvas = resize(source, w, h, full.w, full.h)

  const tinySize = fit(full.w, full.h, LQIP_EDGE)
  const tiny = resize(fullCanvas, full.w, full.h, tinySize.w, tinySize.h)
  const alpha = hasAlpha(tiny)

  const fullOut = await encode(fullCanvas, alpha, 0.86)

  let thumb: Blob | null = null
  if (Math.max(full.w, full.h) > THUMB_EDGE * 1.25) {
    const t = fit(full.w, full.h, THUMB_EDGE)
    thumb = (await encode(resize(fullCanvas, full.w, full.h, t.w, t.h), alpha, 0.8)).blob
  }

  if (source instanceof ImageBitmap) source.close()

  return {
    full: fullOut.blob,
    thumb,
    ext: fullOut.ext,
    width: full.w,
    height: full.h,
    lqip: (await canEncodeWebp()) ? tiny.toDataURL('image/webp', 0.5) : tiny.toDataURL('image/jpeg', 0.5),
    color: averageColor(tiny),
  }
}

// ---------------------------------------------------------------------------
// Public: uploading
// ---------------------------------------------------------------------------

// How many uploads are running anywhere on the page. The post editor holds
// Save until this is zero, so nobody publishes a gallery with holes in it.
let active = 0
const listeners = new Set<() => void>()
function track(delta: number) {
  active += delta
  listeners.forEach((l) => l())
}
export const uploadTracker = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  get: () => active,
}

async function put(bucket: string, path: string, blob: Blob) {
  // Two retries: school wifi drops the odd request, and one lost photo out
  // of forty is exactly the kind of failure nobody notices until later.
  let last: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      cacheControl: '31536000',
      contentType: blob.type || undefined,
      upsert: false,
    })
    if (!error) return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
    last = new Error(error.message)
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
  }
  throw last ?? new Error('Upload failed')
}

export async function uploadImage(
  file: File,
  { bucket = 'post-images', folder = 'body' }: { bucket?: string; folder?: string } = {},
  onStage?: (stage: UploadStage) => void,
): Promise<UploadedImage> {
  track(1)
  try {
    return await uploadOne(file, bucket, folder, onStage)
  } finally {
    track(-1)
  }
}

async function uploadOne(
  file: File,
  bucket: string,
  folder: string,
  onStage?: (stage: UploadStage) => void,
): Promise<UploadedImage> {
  onStage?.('processing')
  const p = await processImage(file)

  onStage?.('uploading')
  const id = crypto.randomUUID()
  const base = `${folder ? `${folder}/` : ''}${id}`
  const [src, thumb] = await Promise.all([
    put(bucket, `${base}.${p.ext}`, p.full),
    p.thumb ? put(bucket, `${base}-sm.${p.ext}`, p.thumb) : Promise.resolve(null),
  ])

  onStage?.('done')
  return {
    src,
    thumb: thumb ?? src,
    w: p.width,
    h: p.height,
    lqip: p.lqip,
    color: p.color,
    name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(),
  }
}

/**
 * Uploads any number of files, a few at a time, reporting each one's stage.
 * Results come back in the order the files were given, whatever order they
 * finish in; failures are reported per file and never stop the rest.
 */
export async function uploadMany(
  files: File[],
  opts: { bucket?: string; folder?: string; concurrency?: number },
  onProgress: (items: UploadProgress[]) => void,
  /** Called once per finished file, strictly in the order the files were given. */
  onReady?: (image: UploadedImage, index: number) => void,
): Promise<UploadProgress[]> {
  const items: UploadProgress[] = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    stage: 'queued',
    preview: URL.createObjectURL(file),
  }))
  const emit = () => onProgress(items.map((i) => ({ ...i })))
  emit()

  // Photos appear in the post as they finish, but never out of order: a
  // finished file waits for any slower one picked before it.
  let committed = 0
  const flush = () => {
    while (committed < items.length && (items[committed].stage === 'done' || items[committed].stage === 'error')) {
      const it = items[committed]
      if (it.result) onReady?.(it.result, committed)
      committed++
    }
  }

  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      try {
        item.result = await uploadImage(item.file, opts, (stage) => {
          item.stage = stage
          emit()
        })
      } catch (err) {
        item.stage = 'error'
        item.error = readableError(item.file, err)
        emit()
      }
      flush()
    }
  }

  // Counted as one upload for the whole batch, so queued files hold Save too.
  track(1)
  try {
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, items.length) }, worker))
  } finally {
    track(-1)
  }
  for (const i of items) URL.revokeObjectURL(i.preview)
  return items
}

/** Image files out of a drop or paste, ignoring whatever else came along. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter(isImageFile)
}
