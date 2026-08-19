import { Suspense, lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { EmptyState, Spinner } from './components/ui'

// The rich text editor pulls in ProseMirror, which roughly triples the
// bundle. Only officers opening the editor should pay for it.
const PostEditor = lazy(() => import('./pages/PostEditor'))

/**
 * Hash routing on purpose: the app ships as static files to Cloudflare
 * Pages or GitHub Pages, neither of which is configured here to rewrite
 * deep links back to index.html.
 */
export default function App() {
  return (
    <HashRouter>
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
    </HashRouter>
  )
}
