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

## Changing the wording

See **[EDITING-TEXT.md](EDITING-TEXT.md)** — which words live in the database
(editable from the site, no code) and which live in `.tsx` files, with the file
and line for the ones you're most likely to want.

## Roles vs. positions

Two separate things, on purpose.

**Rank** (`role`) controls site access:

| role | can |
|---|---|
| `member` | read posts, RSVP to events, see their own hours, edit their own profile |
| `officer` | everything above + write/publish posts, log hours, manage the roster |
| `admin` | same as officer |

**Board position** is the elected office — President, Vice President, Secretary,
Treasurer — set per member in **Admin → Members**. It grants no permissions at
all. A Treasurer can be a plain `member`; an adviser can be an `admin` with no
seat. Positions show on the directory as "This year's board", and as a gold badge
on member cards and profiles.

Add a seat (Historian, Webmaster, co-anything) with one row in the
`board_positions` table — `sort_order` controls the display order. Seats are not
unique by default, so co-presidents work; [`003`](supabase/003_board_positions.sql)
has the index to uncomment if you want one holder each.

## Managing the club

Roster changes happen in Supabase Studio (`members` table). Everything else
happens in the app at `/#/admin`:

- **Posts** — write news, notices, and events in Markdown, pin to the home page, publish or unpublish.
- **Hours queue** — approve or reject submitted service hours.
- **Roster** — read-only view of the allowlist.

---

## Update 002 — logo, uploads, roster editing, weekly email

Run [`supabase/002_admin_storage_email.sql`](supabase/002_admin_storage_email.sql)
in the SQL Editor after `schema.sql`.

### The logo

Replace `public/logo.svg` with the real Key Club logo, keeping the filename.
The header, login page, and favicon all read from it. Using a PNG instead?
Drop in `public/logo.png` and change `LOGO_SRC` in
[`src/components/Logo.tsx`](src/components/Logo.tsx).

### Image uploads

Two public Storage buckets are created: `post-images` (officers only) and
`avatars` (members write only into their own folder). In the post editor, the
cover image has an upload button, and **+ Insert image** above the body uploads
and drops the Markdown in at the end. 5 MB cap per image.

### Managing the roster in-app

**Admin → Members** now does add / edit / deactivate / delete. Two guard rails
enforced in RLS, not just the UI: you cannot deactivate yourself, and you cannot
strip your own admin role — so a chapter can't lock itself out.

*Deactivate* revokes access on the next request and keeps their history.
*Delete* removes the roster row entirely; their profile and logged hours stay in
the database but are orphaned, and their Google account still exists in
`auth.users` (removing that needs the service role key).

### Hours are officer-entered

Members can no longer submit hours — the RLS insert policy is gone, so it's
enforced server-side, not just hidden in the UI. `/hours` is now a read-only
record with a progress bar.

Officers use **Admin → Hours**: pick an event and it pre-fills the hours,
date, and description *and* pre-selects everyone who signed up. Adjust the
selection, submit, and everyone gets an approved entry at once.

### Weekly email (Sundays, 9 PM KST)

Sent by **Google Apps Script**, which now reads the club database instead of a
spreadsheet. Free, no domain, no DNS, no email service, and it sends from your
own Google account so it doesn't get filtered as spoofed mail.

Script: [`google-apps-script/WeeklyHoursEmail.gs`](google-apps-script/WeeklyHoursEmail.gs)

**1.** Go to [script.google.com](https://script.google.com) → **New project**.
Name it `Key Club Hours`. Delete the stub `myFunction` and paste in the whole
`.gs` file.

**2. Project Settings → Script properties → Add script property**, twice:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `SUPABASE_SERVICE_KEY` | your `service_role` key (Supabase → Settings → API) |

The service key belongs *only* here — never in the website code, never in git.
Script properties are readable only by you.

**3. Project Settings → Time zone → `(GMT+09:00) Seoul`.** The trigger uses this,
so there's no UTC math to get wrong.

**4.** Fill in **Admin → Settings** on the site: club name, school year, hours
goal, site URL. Leave the on/off switch **off** for now. (`From address` only
supplies the display name here — Gmail sends from your own account regardless.)

**5. Test.** In the Apps Script editor, pick `previewRecipients` from the
function dropdown and **Run**. Approve the permission prompt the first time —
it will warn the app isn't verified, which is expected for your own script
(Advanced → Go to project). Open **Executions** to see who *would* be mailed.
Nothing is sent.

Then run `sendTestToMe` — one real email, to you only.

**6. Schedule it.** Run `createWeeklyTrigger` once. That's it: Sundays at 9 PM
Seoul time, forever. Then flip the switch on in **Admin → Settings**.

To stop it, run `deleteWeeklyTrigger`, or turn off the switch in Settings.

**Quota:** Gmail allows 100 recipients/day on a consumer account, 1,500/day on
Workspace. The script checks the remaining quota first and refuses to send
rather than emailing half the club.

Every run writes to `email_log` (recipients, failures, first errors), so a
delivery problem is visible in the Supabase table editor.

<details>
<summary>Alternative: Supabase Edge Function + Resend</summary>

[`supabase/functions/weekly-hours-email/`](supabase/functions/weekly-hours-email/)
does the same job entirely inside Supabase, scheduled with `pg_cron` (the
commented block at the bottom of the 002 SQL, `0 12 * * 0` = Sunday 21:00 KST).

It needs a **domain you control DNS for**, because Resend requires SPF/DKIM
records to verify a sender. If the club ever gets its own domain, this is the
tidier option — everything lives in one place and there's no Google dependency.
Until then, use the Apps Script above.

</details>

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
