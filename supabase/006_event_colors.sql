-- =====================================================================
-- Key Club — update 006: colour-coded events
--
-- An officer can give every event its own colour, the way you would on a
-- work calendar: one colour for service projects, another for meetings,
-- another for fundraisers. The colour is what the calendar filters,
-- groups and legends key off, so it is a real organising tool rather
-- than decoration.
--
-- Run after 005. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The colour itself.
--
--    Stored as a NAME, not a hex code. Two reasons: the palette has to
--    stay legible on both the light and the dark theme, which only the
--    stylesheet can guarantee; and a fixed vocabulary is filterable —
--    "show me everything Basil" — where free-form hex would not be.
--
--    NULL means "no colour chosen"; the app falls back to a per-category
--    default, so every existing post already looks right.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists color text;

alter table public.posts
  drop constraint if exists posts_color_allowed;
alter table public.posts
  add constraint posts_color_allowed check (
    color is null or color in (
      'tomato', 'flamingo', 'tangerine', 'banana', 'sage', 'basil',
      'peacock', 'blueberry', 'lavender', 'grape', 'graphite'
    )
  );

-- ---------------------------------------------------------------------
-- 2. A short label an officer can type once and reuse — "Service",
--    "Board meeting", "Fundraiser". Optional. It rides alongside the
--    colour so the calendar legend can say what a colour MEANS instead
--    of just naming the paint.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists calendar_label text;

-- ---------------------------------------------------------------------
-- 3. The calendar filters on colour constantly; a plain index keeps that
--    honest once a few school years of events have piled up.
-- ---------------------------------------------------------------------
create index if not exists posts_color_idx on public.posts (color)
  where category = 'event';
