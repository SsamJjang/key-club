# Where the words live

Most of what you'd want to change isn't in the code at all — it's in the
database, editable from the site. Check the first table before touching files.

## Editable without code

| What | Where |
|---|---|
| Articles, notices, events (title, body, images) | Site → **Admin → Posts** |
| Club name, school year, hours goal, site URL | Site → **Admin → Settings** |
| Everyone's name, grade, grad year, rank, board position | Site → **Admin → Members** |
| Board seat labels ("President" → "Co-President") | Supabase → Table Editor → `board_positions` |
| Your own bio, pronouns, phone, photo | Site → **My profile** |

---

## Editing the code

The files are `.tsx` — HTML mixed into JavaScript. **The text between the tags
is just text.** You can edit it exactly like HTML:

```jsx
<h2 className="mt-2 text-sm">Welcome back</h2>
                            └──── edit this ────┘
```

Rules:
- Change words between `>` and `<`. Leave `className="…"` alone — that's styling.
- Don't delete `{` `}` braces. Anything inside them is live data (`{profile.full_name}`
  prints the person's name).
- Curly quotes (`’`) are intentional — copy the style if you add apostrophes.
- Save, and the dev server updates instantly. If the page goes blank, you deleted
  a bracket; undo with Ctrl+Z.

### Page by page

| Page | File |
|---|---|
| Login screen | [`src/pages/Login.tsx`](src/pages/Login.tsx) |
| Home / dashboard | [`src/pages/Home.tsx`](src/pages/Home.tsx) |
| News list | [`src/pages/News.tsx`](src/pages/News.tsx) |
| Events list | [`src/pages/Events.tsx`](src/pages/Events.tsx) |
| Single article/event | [`src/pages/PostDetail.tsx`](src/pages/PostDetail.tsx) |
| Member directory | [`src/pages/Directory.tsx`](src/pages/Directory.tsx) |
| Someone's profile | [`src/pages/MemberProfile.tsx`](src/pages/MemberProfile.tsx) |
| Your own profile | [`src/pages/MyProfile.tsx`](src/pages/MyProfile.tsx) |
| My hours | [`src/pages/Hours.tsx`](src/pages/Hours.tsx) |
| Admin area | [`src/pages/Admin.tsx`](src/pages/Admin.tsx) |
| Post editor | [`src/pages/PostEditor.tsx`](src/pages/PostEditor.tsx) |
| Nav bar + footer | [`src/components/Layout.tsx`](src/components/Layout.tsx) |
| Weekly email wording | [`google-apps-script/WeeklyHoursEmail.gs`](google-apps-script/WeeklyHoursEmail.gs) |

### The lines you're most likely to want

**Login page** — `src/pages/Login.tsx`

| Text | Line |
|---|---|
| "Caring — our way of life." | ~43 |
| "Event news, service hours, and the whole member directory…" | ~46 |
| "Events / Hours / Members" three-up blurbs | ~53 |
| "Welcome back" | ~73 |
| "Members only. Your email has to be on the club roster…" | ~76 |
| "Continue with Google" | ~118 |
| "Not on the roster? Ask a club officer…" | ~122 |

`&nbsp;` in "our&nbsp;way" is a non-breaking space that stops the line wrapping
awkwardly. Keep it or delete it, either works.

**Nav bar and footer** — `src/components/Layout.tsx`

- Menu labels are in the `LINKS` list at the top: `{ to: '/news', label: 'News' }`
  — change `label`, not `to`.
- Footer line "Key Club — caring, our way of life."

**Home page** — `src/pages/Home.tsx`

- "Hey, {firstName}." — the `{firstName}` part fills itself in
- Section headings "Coming up", "Latest news"
- Stat labels "Members", "Club hours", "Your RSVPs"

**Empty states** (what shows when there's nothing yet) are scattered as
`<EmptyState title="…">` — search the project for `EmptyState` to find them all.

### Finding any specific sentence

In VS Code press **Ctrl+Shift+F**, paste the exact words from the site, and it
shows you the file and line. Fastest way, works every time.

### Site title and browser tab

[`index.html`](index.html) — the `<title>` tag and the `<meta name="description">`.

---

## Publishing your edits

```bash
npm run dev
```

Check it locally at http://localhost:5173, then:

```bash
git add -A
```

```bash
git commit -m "Reword the login page"
```

```bash
git push
```

Cloudflare rebuilds automatically. Give it a minute or two.

Before pushing, make sure this passes — it catches broken brackets:

```bash
npm run build
```
