import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Links from before the switch to real paths — bookmarks, old emails,
// calendar files — look like /#/post/slug. Move them onto the path so they
// still land where they meant to. Supabase's own fragments (#access_token,
// #error) don't start with "/", so they are left alone.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
