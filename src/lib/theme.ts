import { useCallback, useEffect, useState } from 'react'

const KEY = 'kc-theme'

/**
 * Light/dark toggle. The initial class is set by an inline script in
 * index.html so there is no white flash before React mounts; this hook just
 * keeps that class and localStorage in sync afterwards.
 */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(KEY, dark ? 'dark' : 'light')
  }, [dark])

  const toggle = useCallback(() => setDark((d) => !d), [])

  return { dark, setDark, toggle }
}
