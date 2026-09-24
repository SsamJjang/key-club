import { useMemo, useState } from 'react'
import { parseGallery, type Gallery as GalleryData } from '../../lib/gallery'
import Gallery from './Gallery'
import Lightbox, { type LightboxItem } from './Lightbox'

type Chunk = { kind: 'html'; html: string } | { kind: 'gallery'; gallery: GalleryData; key: string }

/**
 * A post body on the page. Takes already-sanitized HTML, swaps each gallery
 * block for the interactive <Gallery>, and makes every standalone photo open
 * in the viewer (as one set, in reading order).
 */
export default function RichBody({ html, className = '' }: { html: string; className?: string }) {
  const [open, setOpen] = useState<number | null>(null)

  const { chunks, photos } = useMemo(() => {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstElementChild!
    const chunks: Chunk[] = []
    let buf = ''
    let n = 0

    for (const el of Array.from(root.childNodes)) {
      const g =
        el instanceof Element && el.hasAttribute('data-kc-gallery')
          ? parseGallery(el.getAttribute('data-kc-gallery'))
          : null
      if (g) {
        if (buf) chunks.push({ kind: 'html', html: buf })
        buf = ''
        chunks.push({ kind: 'gallery', gallery: g, key: `g${n++}` })
      } else {
        buf += el instanceof Element ? el.outerHTML : (el.textContent ?? '')
      }
    }
    if (buf) chunks.push({ kind: 'html', html: buf })

    // Standalone photos, for the viewer.
    const photos: LightboxItem[] = []
    root.querySelectorAll('img').forEach((img) => {
      if (img.closest('[data-kc-gallery]') || img.closest('a')) return
      const fig = img.closest('figure')
      photos.push({
        src: img.getAttribute('data-full') || img.getAttribute('src') || '',
        thumb: img.getAttribute('src') || undefined,
        alt: img.getAttribute('alt') || undefined,
        caption: fig?.querySelector('figcaption')?.textContent || undefined,
        w: Number(img.getAttribute('width')) || undefined,
        h: Number(img.getAttribute('height')) || undefined,
      })
    })
    return { chunks, photos }
  }, [html])

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const img = (e.target as HTMLElement).closest('img')
    if (!img || img.closest('.kc-gallery') || img.closest('a')) return
    const all = Array.from(e.currentTarget.querySelectorAll('img')).filter(
      (i) => !i.closest('.kc-gallery') && !i.closest('a'),
    )
    const i = all.indexOf(img)
    if (i >= 0) setOpen(i)
  }

  return (
    <div className={`prose-club kc-body ${className}`} onClick={onClick}>
      {chunks.map((c, i) =>
        c.kind === 'gallery' ? (
          <Gallery key={c.key} gallery={c.gallery} />
        ) : (
          <div key={i} className="kc-chunk" dangerouslySetInnerHTML={{ __html: c.html }} />
        ),
      )}
      {open !== null && photos.length > 0 && (
        <Lightbox items={photos} index={open} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
