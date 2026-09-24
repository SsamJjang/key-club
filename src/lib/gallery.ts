/**
 * Photo galleries inside post bodies.
 *
 * A gallery is one block in the editor's HTML:
 *
 *   <div data-kc-gallery="{…json…}">  <figure><img …></figure> …  </div>
 *
 * The JSON is the source of truth — layout, settings and every image with
 * its caption, focus point and tile size. The <figure>s inside are a plain
 * fallback so the post still reads if the JSON ever fails to parse, and so
 * anything that strips the page to text sees real images.
 *
 * Nothing here needs a database change: galleries live in `posts.body`.
 */

export type GalleryLayout =
  | 'grid'
  | 'masonry'
  | 'justified'
  | 'carousel'
  | 'spotlight'
  | 'collage'
  | 'compare'

export type CaptionMode = 'none' | 'below' | 'overlay' | 'hover'
export type FrameStyle = 'none' | 'border' | 'polaroid'
export type GridPattern = 'uniform' | 'hero' | 'bento' | 'feature' | 'checker' | 'diagonal' | 'custom'

/** Position on the collage canvas, all in % of the canvas so it scales. */
export interface CollageBox {
  x: number
  y: number
  w: number
  h: number
  /** Degrees. */
  r: number
  z: number
}

export interface GalleryImage {
  id: string
  src: string
  /** Smaller copy for tiles. Falls back to src. */
  thumb?: string
  w: number
  h: number
  alt?: string
  caption?: string
  lqip?: string
  color?: string
  /** Focus point in % — what stays in frame when the tile crops. */
  fx?: number
  fy?: number
  /** Grid tile size in cells. */
  cs?: number
  rs?: number
  /** Show the whole image in its tile instead of cropping to fill. */
  contain?: boolean
  box?: CollageBox
}

export interface Gallery {
  v: 1
  layout: GalleryLayout
  columns: number
  /** px */
  gap: number
  /** px */
  radius: number
  /** Cell / slide shape, width ÷ height. 0 = each image's own shape where the layout allows. */
  aspect: number
  captions: CaptionMode
  frame: FrameStyle
  pattern: GridPattern
  /** Target row height for 'justified', px. */
  rowHeight: number
  /** Collage canvas shape, width ÷ height. */
  canvas: number
  autoplay: boolean
  /** Optional heading shown above the gallery. */
  title?: string
  images: GalleryImage[]
}

export const LAYOUTS: { id: GalleryLayout; label: string; hint: string }[] = [
  { id: 'grid', label: 'Grid', hint: 'Rows and columns. Make any photo span more cells.' },
  { id: 'masonry', label: 'Masonry', hint: 'Columns of photos at their natural shape.' },
  { id: 'justified', label: 'Rows', hint: 'Full-width rows, every photo uncropped.' },
  { id: 'carousel', label: 'Carousel', hint: 'Swipe through one at a time.' },
  { id: 'spotlight', label: 'Spotlight', hint: 'One big photo with a strip to pick from.' },
  { id: 'collage', label: 'Collage', hint: 'Place, size and tilt photos anywhere.' },
  { id: 'compare', label: 'Before / after', hint: 'Drag a slider between two photos.' },
]

export const PATTERNS: { id: GridPattern; label: string }[] = [
  { id: 'uniform', label: 'Even' },
  { id: 'hero', label: 'Hero first' },
  { id: 'bento', label: 'Bento' },
  { id: 'feature', label: 'Feature rows' },
  { id: 'checker', label: 'Checkerboard' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'custom', label: 'Custom' },
]

export const ASPECTS: { value: number; label: string }[] = [
  { value: 1, label: 'Square' },
  { value: 4 / 3, label: '4:3' },
  { value: 3 / 2, label: '3:2' },
  { value: 16 / 9, label: '16:9' },
  { value: 3 / 4, label: '3:4 tall' },
  { value: 4 / 5, label: '4:5 tall' },
  { value: 0, label: 'Original' },
]

export function newGallery(images: GalleryImage[] = [], layout?: GalleryLayout): Gallery {
  const g: Gallery = {
    v: 1,
    layout: layout ?? (images.length === 2 ? 'grid' : images.length > 12 ? 'justified' : 'grid'),
    columns: images.length === 2 || images.length === 4 ? 2 : 3,
    gap: 8,
    radius: 12,
    aspect: layout === 'carousel' || layout === 'spotlight' ? 3 / 2 : images.length <= 2 ? 4 / 3 : 1,
    captions: 'hover',
    frame: 'none',
    pattern: images.length >= 5 ? 'hero' : 'uniform',
    rowHeight: 220,
    canvas: 16 / 10,
    autoplay: false,
    images: [],
  }
  g.images = applyPattern(g.pattern, images, g.columns)
  return g
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---------------------------------------------------------------------------
// Patterns — tile spans for the grid layout. `grid-auto-flow: dense` fills
// any gaps the spans leave, so every pattern works at any photo count.
// ---------------------------------------------------------------------------

function spansFor(pattern: GridPattern, i: number, cols: number): [number, number] {
  const big = Math.min(2, cols)
  switch (pattern) {
    case 'hero':
      return i === 0 ? [big, big] : [1, 1]
    case 'bento': {
      // A repeating 7-tile rhythm: big, tall, wide, then small ones.
      const cycle: [number, number][] = [[big, big], [1, 2], [1, 1], [big, 1], [1, 1], [1, 1], [1, 2]]
      return cycle[i % cycle.length]
    }
    case 'feature':
      // Every fourth photo takes a full row.
      return i % 4 === 0 ? [cols, 1] : [1, 1]
    case 'checker':
      return (Math.floor(i / 2) % 2 === 0) === (i % 2 === 0) ? [big, 1] : [1, 1]
    case 'diagonal':
      return i % (cols + 1) === 0 ? [big, big] : [1, 1]
    default:
      return [1, 1]
  }
}

export function applyPattern(pattern: GridPattern, images: GalleryImage[], cols: number): GalleryImage[] {
  if (pattern === 'custom') return images
  return images.map((img, i) => {
    const [cs, rs] = spansFor(pattern, i, cols)
    return { ...img, cs, rs }
  })
}

// ---------------------------------------------------------------------------
// Collage arrangements
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random so a re-shuffle is repeatable per seed. */
function rng(seed: number) {
  let s = seed || 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export type CollageArrangement = 'scatter' | 'tidy' | 'overlap' | 'stack'

export function arrangeCollage(
  images: GalleryImage[],
  canvas: number,
  mode: CollageArrangement,
  seed = 7,
): GalleryImage[] {
  const n = images.length
  if (!n) return images
  const rand = rng(seed)

  // Tile height in % of canvas height for a tile `w`% of canvas width.
  const hFor = (img: GalleryImage, w: number) => (w * canvas) / (img.w / img.h || 1)

  return images.map((img, i) => {
    let w: number
    let x: number
    let y: number
    let r = 0

    if (mode === 'tidy') {
      const cols = Math.ceil(Math.sqrt(n * canvas))
      const rows = Math.ceil(n / cols)
      const cw = 100 / cols
      const ch = 100 / rows
      w = cw * 0.92
      const h = Math.min(hFor(img, w), ch * 0.92)
      const col = i % cols
      const row = Math.floor(i / cols)
      x = col * cw + (cw - w) / 2
      y = row * ch + (ch - h) / 2
      return { ...img, box: { x, y, w, h, r: 0, z: i + 1 } }
    }

    if (mode === 'overlap') {
      w = clamp(150 / (n + 1), 18, 48)
      const step = n > 1 ? (100 - w) / (n - 1) : 0
      x = i * step
      const h = Math.min(hFor(img, w), 90)
      y = (100 - h) / 2 + (i % 2 ? 6 : -6)
      r = (i % 2 ? 1 : -1) * (3 + rand() * 3)
      return { ...img, box: { x, y: clamp(y, 0, 100 - h), w, h, r, z: i + 1 } }
    }

    if (mode === 'stack') {
      w = 46
      const h = Math.min(hFor(img, w), 80)
      x = 27 + (rand() - 0.5) * 16
      y = (100 - h) / 2 + (rand() - 0.5) * 12
      r = (rand() - 0.5) * 22
      return { ...img, box: { x, y, w, h, r, z: i + 1 } }
    }

    // scatter
    const cols = Math.max(1, Math.round(Math.sqrt(n * canvas)))
    const rows = Math.ceil(n / cols)
    w = clamp((100 / cols) * 1.18, 16, 60)
    const h = Math.min(hFor(img, w), (100 / rows) * 1.25)
    const col = i % cols
    const row = Math.floor(i / cols)
    x = (col / cols) * 100 + (100 / cols - w) / 2 + (rand() - 0.5) * 8
    y = (row / rows) * 100 + (100 / rows - h) / 2 + (rand() - 0.5) * 8
    r = (rand() - 0.5) * 14
    return {
      ...img,
      // Kept a little inside the edges so tilted corners aren't clipped.
      box: { x: clamp(x, 2, 98 - w), y: clamp(y, 3, 97 - h), w, h, r, z: Math.floor(rand() * n) + 1 },
    }
  })
}

/** Gives any image without a collage box one, without disturbing placed ones. */
export function ensureBoxes(g: Gallery): GalleryImage[] {
  if (g.images.every((i) => i.box)) return g.images
  const placed = arrangeCollage(g.images, g.canvas, 'scatter')
  return g.images.map((img, i) => img.box ? img : placed[i])
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

const SAFE_URL = /^(https?:\/\/|\/(?!\/))/i
const SAFE_DATA = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i

function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return clamp(n, lo, hi)
}
function str(v: unknown, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : undefined
}

/**
 * Parses the JSON out of a data attribute. Post bodies are officer input,
 * so this rebuilds every field from scratch with type and range checks —
 * nothing is spread through unexamined, and URLs must be http(s).
 */
export function parseGallery(raw: string | null | undefined): Gallery | null {
  if (!raw) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || !Array.isArray(o.images)) return null

  const layouts = LAYOUTS.map((l) => l.id) as string[]
  const images: GalleryImage[] = []
  for (const it of o.images as Record<string, unknown>[]) {
    if (!it || typeof it !== 'object') continue
    const src = str(it.src, 2000)
    if (!src || !SAFE_URL.test(src)) continue
    const thumb = str(it.thumb, 2000)
    const lqip = str(it.lqip, 4000)
    const b = it.box as Record<string, unknown> | undefined
    images.push({
      id: str(it.id, 64) || crypto.randomUUID(),
      src,
      thumb: thumb && SAFE_URL.test(thumb) ? thumb : undefined,
      w: num(it.w, 1200, 1, 20000),
      h: num(it.h, 900, 1, 20000),
      alt: str(it.alt),
      caption: str(it.caption, 1000),
      lqip: lqip && SAFE_DATA.test(lqip) ? lqip : undefined,
      color: typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : undefined,
      fx: num(it.fx, 50, 0, 100),
      fy: num(it.fy, 50, 0, 100),
      cs: Math.round(num(it.cs, 1, 1, 6)),
      rs: Math.round(num(it.rs, 1, 1, 6)),
      contain: it.contain === true,
      box:
        b && typeof b === 'object'
          ? {
              x: num(b.x, 0, -50, 150),
              y: num(b.y, 0, -50, 150),
              w: num(b.w, 30, 3, 150),
              h: num(b.h, 30, 3, 150),
              r: num(b.r, 0, -180, 180),
              z: Math.round(num(b.z, 1, 0, 9999)),
            }
          : undefined,
    })
  }

  const base = newGallery()
  return {
    v: 1,
    layout: layouts.includes(o.layout as string) ? (o.layout as GalleryLayout) : 'grid',
    columns: Math.round(num(o.columns, base.columns, 1, 6)),
    gap: num(o.gap, base.gap, 0, 40),
    radius: num(o.radius, base.radius, 0, 40),
    aspect: num(o.aspect, base.aspect, 0, 4),
    captions: (['none', 'below', 'overlay', 'hover'] as const).includes(o.captions as CaptionMode)
      ? (o.captions as CaptionMode)
      : base.captions,
    frame: (['none', 'border', 'polaroid'] as const).includes(o.frame as FrameStyle)
      ? (o.frame as FrameStyle)
      : 'none',
    pattern: PATTERNS.some((p) => p.id === o.pattern) ? (o.pattern as GridPattern) : 'custom',
    rowHeight: num(o.rowHeight, base.rowHeight, 80, 480),
    canvas: num(o.canvas, base.canvas, 0.4, 3),
    autoplay: o.autoplay === true,
    title: str(o.title, 200),
    images,
  }
}

export function serializeGallery(g: Gallery): string {
  // Round the floats so the stored HTML stays readable and small.
  const r = (n: number) => Math.round(n * 100) / 100
  return JSON.stringify({
    ...g,
    aspect: r(g.aspect),
    canvas: r(g.canvas),
    images: g.images.map((i) => ({
      ...i,
      fx: i.fx != null ? r(i.fx) : undefined,
      fy: i.fy != null ? r(i.fy) : undefined,
      box: i.box && {
        x: r(i.box.x),
        y: r(i.box.y),
        w: r(i.box.w),
        h: r(i.box.h),
        r: r(i.box.r),
        z: i.box.z,
      },
    })),
  })
}

// ---------------------------------------------------------------------------
// Reading images back out of a post body
// ---------------------------------------------------------------------------

export interface BodyImage {
  src: string
  thumb: string
}

/**
 * Every photo in a post body, galleries first-class. Used by cards (photo
 * count, a mosaic when there is no cover) and the post header.
 */
export function bodyImages(body: string | null | undefined): BodyImage[] {
  if (!body || !body.includes('<')) return []
  const doc = new DOMParser().parseFromString(body, 'text/html')
  const out: BodyImage[] = []
  const inGallery = new Set<Element>()

  doc.querySelectorAll('[data-kc-gallery]').forEach((el) => {
    el.querySelectorAll('img').forEach((i) => inGallery.add(i))
    const g = parseGallery(el.getAttribute('data-kc-gallery'))
    g?.images.forEach((i) => out.push({ src: i.src, thumb: i.thumb ?? i.src }))
  })
  doc.querySelectorAll('img').forEach((img) => {
    if (inGallery.has(img)) return
    const src = img.getAttribute('data-full') || img.getAttribute('src')
    if (src && SAFE_URL.test(src)) out.push({ src, thumb: img.getAttribute('src') ?? src })
  })
  return out
}

// ---------------------------------------------------------------------------
// Cover focus point
//
// posts.cover_url is a single text column. The focus point rides along as a
// URL fragment — "…/cover.webp#focus=50,30" — which browsers never send to
// the server, so the image loads exactly as before and old posts need no
// migration.
// ---------------------------------------------------------------------------

export function splitFocus(url: string): { src: string; fx: number; fy: number } {
  const m = /#focus=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(url)
  if (!m) return { src: url, fx: 50, fy: 50 }
  return { src: url.slice(0, m.index), fx: clamp(+m[1], 0, 100), fy: clamp(+m[2], 0, 100) }
}

export function withFocus(url: string, fx: number, fy: number): string {
  const { src } = splitFocus(url)
  if (!src) return ''
  if (Math.round(fx) === 50 && Math.round(fy) === 50) return src
  return `${src}#focus=${Math.round(fx)},${Math.round(fy)}`
}
