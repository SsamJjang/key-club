import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: '/' — routes are real paths now, so /post/some-slug must still load
// /assets/... from the root rather than /post/assets/.... Cloudflare Pages
// rewrites every deep link to index.html via public/_redirects.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
})
