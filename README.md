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

All of it happens in the app at `/#/admin`:

- **Posts** — write news, notices, and events in Markdown, upload images, pin to the home page, publish or unpublish.
- **Hours** — log service hours for members; pick an event to pre-select everyone who signed up.
- **Members** — add, edit, deactivate, or remove people, and assign board positions.
- **Settings** — club name, hours goal, site URL, and the weekly email switch.

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

### Weekly advisor report (Sundays, 9 PM KST)

A second, separate send: one PDF containing the **entire** club database,
emailed to the advisors. The member emails above tell each student their own
hour total; this tells the advisors everything.

Script: [`google-apps-script/WeeklyAdvisorReport.gs`](google-apps-script/WeeklyAdvisorReport.gs)

Goes to `choi.jenny@faystonsongdo.org` and `29kim.sunjoong@faystonsongdo.org` —
the list is the `REPORT_RECIPIENTS` array at the top of the file, or a
`REPORT_RECIPIENTS` script property (comma-separated) if you'd rather change it
without editing code.

The PDF has twelve sections:

| | |
|---|---|
| 1 | Club logistics — every value from Admin → Settings |
| 2 | Membership at a glance — headcounts by grade, role, and sign-in status |
| 3 | Board — who holds which seat, with contact details; vacancies flagged |
| 4 | Service hours standings — every active member against the hours goal |
| 5 | This week — hours logged, new signups, new posts |
| 6 | Upcoming events — with signup counts against capacity |
| 7 | Event signup rosters — who signed up and who was marked attended |
| 8 | Complete service hours log — every row, with reviewer and notes |
| 9 | Complete roster — every column of `members`, inactive included |
| 10 | Member profiles — titles, pronouns, bios |
| 11 | All posts, notices and events |
| 12 | Automated email log — the last 25 scheduled sends |

**Setup.** Add the file to the *same* Apps Script project as
`WeeklyHoursEmail.gs` — it reuses the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
script properties and the Seoul timezone, so there is nothing new to configure.
Then:

1. Run `previewAdvisorReport` — builds the PDF, saves it to your Drive, logs the
   link, emails nobody. Open it and check it reads right.
2. Run `sendAdvisorReportTestToMe` — one real email, to you.
3. Run `createAdvisorReportTrigger` once. Done: Sundays at 9 PM Seoul time.

To stop it, run `deleteAdvisorReportTrigger`. This report does **not** respect
the on/off switch in Admin → Settings — that switch governs the member-facing
hour emails only.

Each run writes an `email_log` row with `kind = 'weekly_advisor_report'`, so it
sits alongside the member sends in the same audit table.

> The PDF carries member names, emails, and phone numbers. It goes to two named
> school addresses and nowhere else; keep it that way.

---

## Update 004 — event scheduling

Run [`supabase/004_event_scheduling.sql`](supabase/004_event_scheduling.sql) in
the SQL editor. Safe to re-run, and nothing about existing events changes.

**Event is the default post type.** New posts open as an event with the date
fields already showing. Switch **Type** to News or Notice for a post with no
date — doing so clears the event columns rather than leaving orphaned dates on
the calendar.

**Date and time are separate fields.** They used to be one `datetime-local`
input, which produces *nothing at all* until both halves are filled — so an
officer who knew the date but not the time saved an event with no date. Now the
date stands on its own: the event saves, the calendar places it, and it reads
"time TBA" until someone fills the time in. Leaving the date blank too is still
fine — those events collect under "No date set yet".

**Events can repeat.** Three modes in the editor:

| Mode | For |
|---|---|
| Just once | A single day. |
| Every week | Pick the weekdays and an end date — "every Wed until Dec 17". |
| Pick dates | A run of consecutive days, or any hand-picked set. |

A series is stored as a **concrete list of dates** in `posts.event_dates`, not
as a recurrence rule. A school year ends, so every series is finite; a stored
list is something an officer can read back, delete one date out of for a
holiday, and trust. The editor shows the generated dates before you save, and
caps a series at 200 dates so a mistyped end year can't fill the table.

The calendar draws the event on each of its dates, and an event is only "past"
once its **last** date has gone by. Sign-ups are per date — see update 005.

`recurrence_note` holds a display sentence like `Every Wed until Dec 17`. It's
derived from the dates themselves, so an event edited later still describes
itself correctly; nothing ever parses it back.

**Service hours can be TBD.** Distinct from "no hours", which stays the default.
TBD shows the word instead of a number so members still sign up, and the
awarding form in Admin → Hours leaves the amount for the officer to type.

### Typography

Headings inside post bodies (`prose-club h1/h2/h3`) are sans now, matching the
body text. The display serif is still used for page furniture — page titles,
card titles, the calendar's month — but in a written post it read as though the
paragraph and its own heading came from different sites.

---

## Update 005 — sign up for specific dates

Run [`supabase/005_per_date_signups.sql`](supabase/005_per_date_signups.sql).
Existing sign-ups keep meaning exactly what they did.

Nobody can make every Wednesday of a term, and asking for all-or-nothing is how
you get an empty sign-up list. A member now picks the dates they can make:

- **On the event page**, a row of date tabs sits above the sign-up panel.
  Picking a tab switches which date the panel below describes — the spots bar,
  the "I'm going" button, and, most importantly, **exactly who is coming on
  that day**. A ✓ on a tab marks the dates you're already down for, so your
  whole selection stays visible while you move between them. **Every remaining
  date** signs you up for all of them at once; **Clear mine** drops the lot.
- **On the calendar**, the button under a day cell signs you up for *that*
  date only, and says so.
- A single-date event is unchanged — the same panel, with no tabs above it.

`event_signups.occurs_on` holds the date. It's `NULL` for a one-date event and
for an event with no date yet, because "I'm coming to this" needs no date to
disambiguate — so every row written before this migration still reads
correctly. The primary key moved from `(post_id, user_id)` to a surrogate `id`,
with a unique index on `(post_id, user_id, coalesce(occurs_on, '0001-01-01'))`
enforcing one row per member per date.

**Counting.** Every number attached to a date is that date's: "3 members going",
the roster underneath, and the `3 of 6 spots` bar. **Capacity is per date** — 20
spots means 20 at each session, not 20 people spread across the term, which is
what a bar drawn per date has to mean to make sense. The only whole-series
number is the "Signed up" line in the details grid, which counts distinct
people: a member down for five dates is one member there.

**Awarding hours.** Admin → Hours pre-selects the members who signed up **for
the date served**, not everyone who ever signed up for the series. Change the
date by hand and a button offers to re-select for that date — it won't silently
overwrite a list you've already adjusted.

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
