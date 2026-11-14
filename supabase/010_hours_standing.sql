-- =====================================================================
-- Key Club — update 010: semester hours standing
--
-- Every member needs 25 service hours per semester. Up to 15 of those can
-- be outside volunteering, which the club doesn't see — so at least 10
-- must be Key Club hours, and that club minimum is the part we can track.
--
-- member_hours_standing puts every active member in a tier, from their
-- logged club hours alone, against where they "should" be by today if the
-- 10-hour club minimum were spread evenly from the semester start to the
-- hours due date (pace):
--
--   complete   club hours >= 25                 (no outside hours needed)
--   club_done  club hours >= 10                 (only outside hours left)
--   on_pace    club hours >= pace
--   behind     club hours >= half of pace
--   danger     less than half of pace
--
-- upcoming_service_events lists every dated service opportunity between
-- today and the due date, one row per date of a series.
--
-- The standing email (google-apps-script/StandingEmail.gs) mails the
-- behind and danger tiers, with the upcoming events underneath.
--
-- Run after 009. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The semester rule, next to the yearly hours_goal.
--
--    hours_due_on is the deadline members are told — usually a little
--    before the semester's last day. NULL falls back to the semester end.
--    Change it each semester in Table Editor -> club_settings.
-- ---------------------------------------------------------------------
alter table public.club_settings
  add column if not exists semester_hours_goal numeric not null default 25,
  add column if not exists external_hours_cap  numeric not null default 15,
  add column if not exists hours_due_on        date;

alter table public.club_settings
  drop constraint if exists club_settings_semester_hours;
alter table public.club_settings
  add constraint club_settings_semester_hours
  check (semester_hours_goal > 0
         and external_hours_cap >= 0
         and external_hours_cap < semester_hours_goal);

-- Fall 2026 deadline. Only fills it in the first time.
update public.club_settings set hours_due_on = date '2026-12-18' where hours_due_on is null;

-- ---------------------------------------------------------------------
-- 2. The window both views share.
-- ---------------------------------------------------------------------
create or replace function public.hours_window(
  out semester    text,
  out starts_on   date,
  out ends_before date,
  out due_on      date,
  out today       date,
  out goal        numeric,
  out club_min    numeric
)
language sql stable security definer set search_path = public as $fn$
  select cs.label,
         cs.starts_on,
         coalesce(cs.ends_before, (cs.starts_on + interval '5 months')::date),
         coalesce(case when s.hours_due_on >= cs.starts_on
                        and (cs.ends_before is null or s.hours_due_on < cs.ends_before)
                       then s.hours_due_on end,
                  coalesce(cs.ends_before, (cs.starts_on + interval '5 months')::date) - 1),
         (now() at time zone 'Asia/Seoul')::date,
         s.semester_hours_goal,
         s.semester_hours_goal - s.external_hours_cap
    from public.current_semester() cs
    cross join public.club_settings s
   limit 1;
$fn$;

-- ---------------------------------------------------------------------
-- 3. The standing. One row per active member.
--    events is a JSON array of the hours behind the total, oldest first:
--    [{ "event": "Beach cleanup", "served_on": "2026-09-14", "hours": 3 }]
-- ---------------------------------------------------------------------
drop view if exists public.member_hours_standing;
create view public.member_hours_standing
with (security_invoker = off) as
with w as (select * from public.hours_window()),
club as (
  select h.user_id,
         sum(h.hours)     as hours,
         count(*)         as entries,
         max(h.served_on) as last_served_on,
         json_agg(json_build_object(
                    'event',     coalesce(p.title, h.description),
                    'served_on', h.served_on,
                    'hours',     h.hours)
                  order by h.served_on, h.created_at) as events
    from public.hours_log h
    left join public.posts p on p.id = h.post_id
    cross join w
   where h.status = 'approved'
     and h.served_on >= w.starts_on and h.served_on < w.ends_before
   group by h.user_id
),
base as (
  select pr.id as user_id, pr.full_name, pr.email, pr.grade,
         w.semester,
         w.due_on,
         greatest(w.due_on - w.today, 0) as days_left,
         w.goal, w.club_min,
         round(w.club_min
               * least(greatest(w.today - w.starts_on, 0), w.due_on - w.starts_on)::numeric
               / greatest(w.due_on - w.starts_on, 1), 1) as pace,
         coalesce(c.hours, 0)           as club_hours,
         coalesce(c.entries, 0)         as times_served,
         c.last_served_on,
         coalesce(c.events, '[]'::json) as events
    from public.profiles pr
    join public.members m on m.email = pr.email and m.active
    cross join w
    left join club c on c.user_id = pr.id
)
select user_id, full_name, email, grade, semester, due_on, days_left,
       goal, club_min, pace, club_hours,
       greatest(club_min - club_hours, 0) as club_hours_still_needed,
       greatest(goal - club_hours, 0)     as total_still_needed,
       times_served, last_served_on, events,
       case
         when club_hours >= goal     then 'complete'
         when club_hours >= club_min then 'club_done'
         when club_hours >= pace     then 'on_pace'
         when club_hours >= pace / 2 then 'behind'
         else                             'danger'
       end as tier
  from base;

-- Names, emails and hours for the whole club: service role only, like
-- weekly_hours_digest. The Apps Script reads it with the service key.
revoke all on public.member_hours_standing from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Upcoming service opportunities, today through the due date.
--    A series (event_dates) gives one row per remaining date; a single
--    event gives one row from starts_at. Every published event counts;
--    the email shows hours when the event has them.
-- ---------------------------------------------------------------------
drop view if exists public.upcoming_service_events;
create view public.upcoming_service_events
with (security_invoker = off) as
with w as (select * from public.hours_window()),
occ as (
  select p.id as post_id, p.slug, p.title, p.location, p.service_hours, p.hours_tbd,
         p.all_day, p.capacity,
         (p.starts_at at time zone 'Asia/Seoul')::time as starts_time,
         (p.ends_at   at time zone 'Asia/Seoul')::time as ends_time,
         d.on_date,
         coalesce(array_length(p.event_dates, 1), 0) > 1 as in_series
    from public.posts p
    cross join lateral (
      select unnest(p.event_dates) as on_date
       where coalesce(array_length(p.event_dates, 1), 0) > 0
      union all
      select (p.starts_at at time zone 'Asia/Seoul')::date
       where coalesce(array_length(p.event_dates, 1), 0) = 0 and p.starts_at is not null
    ) d
   where p.category = 'event'
     and p.published
)
select o.post_id, o.slug, o.title, o.location, o.service_hours, o.hours_tbd,
       o.on_date, case when o.all_day then null else o.starts_time end as starts_time,
       case when o.all_day then null else o.ends_time end as ends_time,
       o.in_series,
       o.capacity,
       case when o.capacity is null then null
            else greatest(o.capacity - (
              select count(*) from public.event_signups s
               where s.post_id = o.post_id and s.status = 'going'
                 and (s.occurs_on = o.on_date or (s.occurs_on is null and not o.in_series))
            ), 0) end as spots_left
  from occ o
  cross join w
 where o.on_date >= w.today and o.on_date <= w.due_on;

revoke all on public.upcoming_service_events from anon, authenticated;
