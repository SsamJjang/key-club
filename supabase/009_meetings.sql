-- =====================================================================
-- Key Club — update 009: meetings
--
-- A fourth post type. A meeting has everything an event has (date, time,
-- series, location, colour) but:
--   * it lives on the Events calendar only, never in the News feed;
--   * nobody signs up: officers invite an audience instead, either
--     everyone or just officers;
--   * an invited member can decline, which files a "can't make it"
--     notice (event_absences, from 008).
--
-- "Officers" means an officer/admin role OR a board seat, so a Treasurer
-- who is a plain `member` in the app is still invited to board meetings.
-- An officers-only meeting is invisible to everyone else.
--
-- Run after 008. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The type, and who it's for.
-- ---------------------------------------------------------------------
alter table public.posts drop constraint if exists posts_category_check;
alter table public.posts
  add constraint posts_category_check
  check (category in ('news', 'notice', 'event', 'meeting'));

alter table public.posts
  add column if not exists audience text;

-- Meetings must say who's invited; nothing else carries an audience.
alter table public.posts drop constraint if exists posts_audience_check;
alter table public.posts
  add constraint posts_audience_check
  check (
    (category = 'meeting' and audience in ('everyone', 'officers'))
    or (category <> 'meeting' and audience is null)
  );

-- ---------------------------------------------------------------------
-- 2. Who counts as an officer for invitations.
-- ---------------------------------------------------------------------
create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.profiles p
      join public.members  m on m.email = p.email
     where p.id = auth.uid()
       and m.active
       and (p.role in ('officer', 'admin') or m.board_position is not null)
  );
$fn$;

grant execute on function public.is_officer() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Officers-only meetings are hidden from everyone else.
-- ---------------------------------------------------------------------
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (
    public.is_member()
    and (published or public.is_admin())
    and (category <> 'meeting' or audience = 'everyone' or public.is_officer())
  );

-- ---------------------------------------------------------------------
-- 4. No sign-ups for meetings: you're invited, not signing up.
-- ---------------------------------------------------------------------
drop policy if exists signups_write_own on public.event_signups;
create policy signups_write_own on public.event_signups
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member()
    and exists (select 1 from public.posts p where p.id = post_id and p.category = 'event')
  );

-- ---------------------------------------------------------------------
-- 5. Notices only for something you can see. The posts subquery runs
--    under posts_read, so an officers-only meeting is out of reach for
--    everyone else.
-- ---------------------------------------------------------------------
drop policy if exists absences_insert_own on public.event_absences;
create policy absences_insert_own on public.event_absences
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member()
    and exists (select 1 from public.posts p where p.id = post_id and p.category in ('event', 'meeting'))
  );
