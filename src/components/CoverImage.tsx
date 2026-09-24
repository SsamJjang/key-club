import { useState } from 'react'
import { splitFocus } from '../lib/gallery'

/**
 * Frames a cover image of any shape in a fixed box.
 *
 * Covers are whatever an officer uploads — a wide photo one week, a round
 * sticker logo the next. Cropping everything to fill (object-cover) cuts the
 * logos apart; letterboxing everything leaves photos floating in bars. So the
 * frame looks at the image once it loads: close to the box's shape, it fills
 * edge to edge; otherwise it is shown whole, over a blurred, dimmed copy of
 * itself so the empty space still reads as part of the picture.
 *
 * A cover URL may carry a focus point ("…#focus=50,30", see lib/gallery.ts);
 * when the frame crops, that spot stays in view.
 */
export default function CoverImage({
  src: url,
  className = '',
  ratio = 16 / 9,
  eager = false,
}: {
  src: string
  /** Sizing and rounding for the frame, e.g. "aspect-[16/9] rounded-2xl". */
  className?: string
  /** The frame's width / height, used to decide fill vs. whole. */
  ratio?: number
  eager?: boolean
}) {
  const [fill, setFill] = useState<boolean | null>(null)
  const { src, fx, fy } = splitFocus(url)

  function measure(img: HTMLImageElement) {
    if (!img.naturalWidth || !img.naturalHeight) return
    const r = img.naturalWidth / img.naturalHeight
    // Within ~20% of the frame's shape, cropping loses little and looks best.
    setFill(Math.abs(Math.log(r / ratio)) < 0.2)
  }

  return (
    <div className={`relative overflow-hidden bg-[var(--surface)] ${className}`}>
      {fill === false && (
        <>
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-125 object-cover opacity-70 blur-2xl saturate-150"
          />
          <div
            className="absolute inset-0"
            style={{ background: 'color-mix(in srgb, var(--card) 30%, transparent)' }}
            aria-hidden
          />
        </>
      )}
      <img
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={(e) => measure(e.currentTarget)}
        style={fill ? { objectPosition: `${fx}% ${fy}%` } : undefined}
        className={`relative size-full transition-opacity duration-300 ${
          fill === null ? 'opacity-0' : 'opacity-100'
        } ${fill === false ? 'object-contain p-[6%] drop-shadow-xl' : 'object-cover'}`}
      />
    </div>
  )
}
