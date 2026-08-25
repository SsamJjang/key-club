-- =====================================================================
-- Key Club — update 004: flexible event scheduling
--
--   * an event can repeat: a run of consecutive days, every Wednesday
--     until the end of term, or a hand-picked set of dates
--   * a date with no time is a real, storable answer ("Sept 12, time TBA")
--   * service hours can be TBD instead of a number
--
-- Run after 003. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Occurrence dates.
--
--    Deliberately a concrete list of dates rather than an RRULE string.
--    A school year ends, so every series this club runs is finite, and a
--    stored list is something an officer can read, hand-edit one date out
--    of, and reason about — no expansion engine, no "repeats forever".
--
--    NULL or empty = a single occurrence, described by starts_at as it
--    always was. Otherwise this holds EVERY date in the series, first one
--    included, and starts_at carries the time of day they all share.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists event_dates date[];

-- A short human sentence — "Every Wed until Dec 17" — written by the
-- editor when it generates the list. Display-only: nothing parses it back.
alter table public.posts
  add column if not exists recurrence_note text;

-- ---------------------------------------------------------------------
-- 2. All-day events.
--
--    Before this, the editor used a single datetime-local input, which
--    yields NOTHING until both halves are filled — so an officer who knew
--    the date but not the time saved an event with no date at all. Date
--    and time are separate inputs now; when the time is left blank,
--    starts_at is midnight local and this flag says "don't show a time".
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists all_day boolean not null default false;

-- ---------------------------------------------------------------------
-- 3. Service hours to be announced.
--
--    Distinct from service_hours IS NULL, which means "no hours offered".
--    TBD means "hours are coming, we haven't set them yet" — worth saying
--    out loud on the event page so members still sign up.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists hours_tbd boolean not null default false;

-- Belt and braces: a number and "to be decided" are mutually exclusive.
alter table public.posts
  drop constraint if exists posts_hours_tbd_or_number;
alter table public.posts
  add constraint posts_hours_tbd_or_number
    check (not (hours_tbd and service_hours is not null));

-- ---------------------------------------------------------------------
-- 4. Index for the calendar's "does this series touch this month" query.
-- ---------------------------------------------------------------------
create index if not exists posts_event_dates_idx
  on public.posts using gin (event_dates);

-- ---------------------------------------------------------------------
-- 5. Backfill: every existing dated event is a one-occurrence series, so
--    event_dates stays null and nothing changes for them. Existing events
--    all came from datetime-local, so none of them are all-day.
--
--    Nothing to do — the defaults above are already correct for old rows.
-- ---------------------------------------------------------------------
