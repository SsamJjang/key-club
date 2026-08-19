# Key Club

A private site for our school's Key Club chapter — event news, notices, the
member directory, event sign-ups, and service-hour tracking.

**There is no sign-up form.** Members sign in with Google, and only emails that
are already on the club roster are let through. Everyone else is rejected by the
database itself.

Static React build → deploys to Cloudflare Pages or GitHub Pages with no server.

---

## Stack

| | |
|---|---|
| App | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Routing | React Router (hash mode — no server rewrites needed) |
| Backend | Supabase (Google OAuth + Postgres + row level security) |

---

## Setup

### 1. Create the Supabase project

1. Make a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   It is safe to re-run.

### 2. Turn on Google sign-in

1. In Google Cloud Console → **APIs & Services → Credentials**, create an
   **OAuth client ID** of type *Web application*.
2. Authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In Supabase → **Authentication → Providers → Google**, paste the client ID
   and secret and enable it.
4. In Supabase → **Authentication → URL Configuration**, add your site URL and
   `http://localhost:5173` to **Redirect URLs**.

### 3. Add yourself to the roster

This is the allowlist. In Supabase → **Table Editor → `members`**, insert a row:

| column | value |
|---|---|
| `email` | your school Google address |
| `full_name` | your name |
| `grade` | 9–12 |
| `graduation_year` | e.g. 2027 |
| `phone` | optional |
| `role` | **`admin`** ← so you can write posts |
| `active` | `true` |

Do the same for every member. An email that is not here **cannot sign in**.

### 4. Run it

```bash
npm install
```

Copy `.env.example` to `.env` and fill in the two values from
Supabase → **Settings → API**:

```bash
cp .env.example .env
```

```bash
npm run dev
```

---

## How the allowlist actually works

Security lives in the database, not the browser — the anon key is public, so
client-side checks would be theatre.

1. **Signup gate.** `handle_new_user()` fires on insert into `auth.users`. If the
   email is not in `members` with `active = true`, it raises an exception, which
   rolls the whole signup back. No account is ever created.
2. **Ongoing access.** Every RLS policy calls `is_member()`, which re-joins
   `profiles` to `members`. Flip someone's `active` to `false` and their next
   request returns nothing — no redeploy, no cache to bust.
3. **Officer powers.** `is_admin()` gates writing posts and approving hours.
   `role` is authoritative in `members`; changing it there syncs to `profiles`,
   and members cannot edit their own role (the `profiles_update_own` policy
   pins it).

## Roles

| role | can |
|---|---|
| `member` | read posts, RSVP to events, log their own hours, edit their own profile |
| `officer` | everything above + write/publish posts, approve hours, view the roster |
| `admin` | same as officer |

## Managing the club

Roster changes happen in Supabase Studio (`members` table). Everything else
happens in the app at `/#/admin`:

- **Posts** — write news, notices, and events in Markdown, pin to the home page, publish or unpublish.
- **Hours queue** — approve or reject submitted service hours.
- **Roster** — read-only view of the allowlist.

---

## Deploying

The build is static files in `dist/`. Routing is hash-based, so deep links work
on any host without rewrite rules.

### Cloudflare Pages

Connect the repo and set:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### GitHub Pages

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as **repository secrets**
(Settings → Secrets and variables → Actions), then enable Pages with source
**GitHub Actions**. The included workflow at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and
publishes on every push to `main`.

**After deploying, add your live URL** to Supabase → Authentication → URL
Configuration → Redirect URLs, or Google sign-in will bounce.

> Both env vars end up in the shipped JavaScript. That is expected — the anon
> key is designed to be public, and RLS is what protects the data.

---

## Layout

```
src/
  context/AuthContext.tsx   session + profile, translates roster rejections
  components/               Layout, ProtectedRoute, PostCard, UI kit
  lib/                      supabase client, types, formatting, markdown
  pages/                    Login, Home, News, Events, PostDetail,
                            Directory, MemberProfile, MyProfile, Hours,
                            Admin, PostEditor
supabase/schema.sql         tables, the allowlist trigger, RLS policies
```
