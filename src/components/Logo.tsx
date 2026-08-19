/**
 * The club logo.
 *
 * Drop your file at `public/logo.svg` (or logo.png and change LOGO_SRC) and
 * every mark in the app updates — header, login page, favicon fallback.
 * Until then the placeholder in public/logo.svg stands in.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`.replace('./', '')

export default function Logo({
  size = 36,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <img
      src={LOGO_SRC}
      alt="Key Club logo"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function LogoWordmark({ size = 36 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
        Key Club
      </span>
    </span>
  )
}
