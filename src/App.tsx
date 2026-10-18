import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Home from './pages/Home'
import News from './pages/News'
import Events from './pages/Events'
import PostDetail from './pages/PostDetail'
import Directory from './pages/Directory'
import MemberProfile from './pages/MemberProfile'
import MyProfile from './pages/MyProfile'
import Hours from './pages/Hours'
import Admin from './pages/Admin'
import Absent from './pages/Absent'
import { EmptyState, Spinner } from './components/ui'

// The rich text editor pulls in ProseMirror, which roughly triples the
// bundle. Only officers opening the editor should pay for it.
const PostEditor = lazy(() => import('./pages/PostEditor'))

/**
 * Real paths (/events, /absent), not /#/events. Cloudflare Pages serves
 * index.html for every deep link via public/_redirects; old /#/ links are
 * rewritten in main.tsx before the router ever sees them.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Home />} />
            <Route path="news" element={<News />} />
            <Route path="events" element={<Events />} />
            <Route path="post/:slug" element={<PostDetail />} />
            <Route path="directory" element={<Directory />} />
            <Route path="members/:id" element={<MemberProfile />} />
            <Route path="me" element={<MyProfile />} />
            <Route path="hours" element={<Hours />} />
            <Route path="absent" element={<Absent />} />

            <Route
              path="admin"
              element={
                <ProtectedRoute adminOnly>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/posts/:id"
              element={
                <ProtectedRoute adminOnly>
                  <Suspense fallback={<Spinner label="Loading the editor" />}>
                    <PostEditor />
                  </Suspense>
                </ProtectedRoute>
              }
            />

            <Route
              path="*"
              element={
                <EmptyState icon="🧭" title="Page not found">
                  That link doesn’t go anywhere.
                </EmptyState>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
