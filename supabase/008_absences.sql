-- =====================================================================
-- Key Club — update 008: "I can't make it" / "I'll be late"
--
-- Members tell officers ahead of time that they'll miss, or be late to,
-- an upcoming event or meeting. Page: /absent.
--
-- Private between the member and the officers: other members never see
-- who is out or why.
--
-- Run after 007. Safe to re-run.
-- =====================================================================

create table if not exists public.event_absences (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Which date of a series. NULL for a single-date event, same as
  -- event_signups.occurs_on.
  occurs_on   date,
  kind        text not null check (kind in ('absent', 'late')),
  -- "Late" only: roughly when they'll get there, free text ("4:15", "after
  -- practice") because members don't know to the minute.
  arrives     text check (arrives is null or length(arrives) <= 60),
  reason      text check (reason is null or length(reason) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One notice per member per date. Saying "late" after "absent" replaces it.
-- COALESCE for the same reason as event_signups_one_per_date: NULL never
-- equals NULL in a unique index.
create unique index if not exists event_absences_one_per_date
  on public.event_absences (post_id, user_id, coalesce(occurs_on, '0001-01-01'::date));

create index if not exists event_absences_post_date_idx
  on public.event_absences (post_id, occurs_on);

alter table public.event_absences enable row level security;

-- Your own, or everything if you're an officer.
drop policy if exists absences_read on public.event_absences;
create policy absences_read on public.event_absences
  for select to authenticated
  using ((user_id = auth.uid() and public.is_member()) or public.is_admin());

drop policy if exists absences_insert_own on public.event_absences;
create policy absences_insert_own on public.event_absences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());

drop policy if exists absences_update_own on public.event_absences;
create policy absences_update_own on public.event_absences
  for update to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

drop policy if exists absences_delete_own on public.event_absences;
create policy absences_delete_own on public.event_absences
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.touch_event_absence()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists event_absences_touch on public.event_absences;
create trigger event_absences_touch
  before update on public.event_absences
  for each row execute function public.touch_event_absence();
