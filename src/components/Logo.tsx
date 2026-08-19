/**
 * The club logo.
 *
 * The source file is a solid black silhouette, so it is inverted to solid
 * white wherever it sits on a dark surface:
 *   tone="auto"  black in light mode, white in dark mode  (default)
 *   tone="light" always white — for permanently dark panels like the login hero
 *   tone="dark"  always black
 *
 * Swap `public/logo.svg` for a different mark and everything here still holds,
 * as long as it stays single-colour black.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`.replace('./', '')

const TONE_CLASS = {
  auto: 'logo-auto',
  light: 'logo-light',
  dark: 'logo-dark',
} as const

export default function Logo({
  size = 36,
  tone = 'auto',
  className = '',
}: {
  size?: number
  tone?: keyof typeof TONE_CLASS
  className?: string
}) {
  return (
    <img
      src={LOGO_SRC}
      alt="Key Club logo"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${TONE_CLASS[tone]} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function LogoWordmark({
  size = 36,
  tone = 'auto',
}: {
  size?: number
  tone?: keyof typeof TONE_CLASS
}) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} tone={tone} />
      <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
        Key Club
      </span>
    </span>
  )
}
