import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' keeps asset URLs relative, so the same build works at the root
// (Cloudflare Pages) or under /key-club/ (GitHub Pages project site).
// Routing is hash-based for the same reason — no server rewrites required.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
})
