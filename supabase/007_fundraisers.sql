-- =====================================================================
-- Key Club — update 007: the fundraiser requirement
--
-- Alongside the yearly hours goal, every member must take part in at
-- least one fundraiser activity each semester. Fundraising is not
-- service, so it does not go in hours_log: it gets its own record, and
-- a member's standing is worked out from those records rather than
-- stored as a flag an officer has to remember to reset.
--
-- Run after 006. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Semester boundaries, set once a year next to school_year.
--
--    Two dates for the current school year. Fall runs from fall start up
--    to spring start; spring runs from spring start onward. "This
--    semester" is whichever window today (Seoul time) falls in.
-- ---------------------------------------------------------------------
alter table public.club_settings
  add column if not exists fall_semester_start   date not null default date '2026-08-01',
  add column if not exists spring_semester_start date not null default date '2027-01-01',
  add column if not exists fundraisers_required  smallint not null default 1;

alter table public.club_settings
  drop constraint if exists club_settings_semesters_ordered;
alter table public.club_settings
  add constraint club_settings_semesters_ordered
  check (spring_semester_start > fall_semester_start);

alter table public.club_settings
  drop constraint if exists club_settings_fundraisers_required;
alter table public.club_settings
  add constraint club_settings_fundraisers_required
  check (fundraisers_required between 0 and 20);

-- The window the requirement is measured over right now.
-- ends_before is exclusive and NULL for spring (open until the dates are
-- rolled over for next year).
create or replace function public.current_semester(
  out label       text,
  out starts_on   date,
  out ends_before date,
  out required    smallint
)
language sql stable security definer set search_path = public as $fn$
  select case when today >= s.spring_semester_start
              then 'Spring ' || extract(year from s.spring_semester_start)
              else 'Fall '   || extract(year from s.fall_semester_start) end,
         case when today >= s.spring_semester_start
              then s.spring_semester_start else s.fall_semester_start end,
         case when today >= s.spring_semester_start
              then null else s.spring_semester_start end,
         s.fundraisers_required
    from public.club_settings s,
         lateral (select (now() at time zone 'Asia/Seoul')::date as today) t
   limit 1;
$fn$;

grant execute on function public.current_semester() to authenticated;

-- ---------------------------------------------------------------------
-- 2. The record: one row per member per fundraiser they took part in.
--    Officer-entered, like hours. post_id links the event when there is
--    one; activity says what it was either way.
-- ---------------------------------------------------------------------
create table if not exists public.fundraiser_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  post_id         uuid references public.posts(id) on delete set null,
  activity        text not null check (length(trim(activity)) > 0),
  participated_on date not null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists fundraiser_user_idx on public.fundraiser_log (user_id);
create index if not exists fundraiser_date_idx on public.fundraiser_log (participated_on);

alter table public.fundraiser_log enable row level security;

-- You see your own; officers see and write everything. No member inserts.
drop policy if exists fundraiser_read on public.fundraiser_log;
create policy fundraiser_read on public.fundraiser_log
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists fundraiser_admin_all on public.fundraiser_log;
create policy fundraiser_admin_all on public.fundraiser_log
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. The per-member attribute: has this member met the requirement for
--    the current semester? Same shape and exposure as member_hours —
--    the rows are private, the standing is visible to the club.
-- ---------------------------------------------------------------------
create or replace view public.member_fundraisers
with (security_invoker = off) as
  select p.id as user_id,
         sem.label                                                        as semester,
         count(f.id) filter (
           where f.participated_on >= sem.starts_on
             and (sem.ends_before is null or f.participated_on < sem.ends_before)
         )::int                                                           as semester_count,
         count(f.id)::int                                                 as total_count,
         max(f.participated_on)                                           as last_participated_on,
         sem.required                                                     as required,
         count(f.id) filter (
           where f.participated_on >= sem.starts_on
             and (sem.ends_before is null or f.participated_on < sem.ends_before)
         ) >= sem.required                                                as requirement_met
    from public.profiles p
    cross join public.current_semester() sem
    left join public.fundraiser_log f on f.user_id = p.id
   group by p.id, sem.label, sem.starts_on, sem.ends_before, sem.required;

grant select on public.member_fundraisers to authenticated;

-- ---------------------------------------------------------------------
-- 4. The weekly email reads the digest; it now carries fundraiser
--    standing too. New columns go on the end so `create or replace`
--    keeps working against the 002 definition.
-- ---------------------------------------------------------------------
create or replace view public.weekly_hours_digest
with (security_invoker = off) as
  select m.email,
         coalesce(p.full_name, m.full_name)                                   as full_name,
         m.grade,
         m.graduation_year,
         coalesce(sum(h.hours) filter (where h.status = 'approved'), 0)::numeric as approved_hours,
         max(h.served_on) filter (where h.status = 'approved')                as last_served_on,
         coalesce(mf.semester, (select label from public.current_semester())) as semester,
         coalesce(mf.semester_count, 0)                                       as fundraisers_this_semester,
         coalesce(mf.required, (select required from public.current_semester())) as fundraisers_required,
         -- A member who has never signed in has no profile, so no records.
         coalesce(mf.requirement_met,
                  (select required from public.current_semester()) = 0)       as fundraiser_requirement_met
    from public.members m
    left join public.profiles  p on p.email   = m.email
    left join public.hours_log h on h.user_id = p.id
    left join public.member_fundraisers mf on mf.user_id = p.id
   where m.active
   group by m.email, p.full_name, m.full_name, m.grade, m.graduation_year,
            mf.semester, mf.semester_count, mf.required, mf.requirement_met;

revoke all on public.weekly_hours_digest from anon, authenticated;
