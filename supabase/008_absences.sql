-- =====================================================================
-- Key Club — update 008: "I can't make it" / "I'll be late"
--
-- Members tell officers ahead of time that they'll miss, or be late to,
-- an upcoming event or meeting. Page: /absent.
--
-- Private between the member and the officers: other members never see
-- who is out or why. Officers read them in Admin → Absences and on each
-- event's page and calendar card.
--
-- sent_at records when the notice was given, so officers can tell a
-- day-ahead heads-up from a text an hour before. The app counts 12+
-- hours before the event as advance notice.
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
  -- When this notice was given. Set by the trigger below, never by the
  -- client: on insert, and again whenever kind changes ("late" turning
  -- into "absent" an hour before is a new, short-notice message). Fixing
  -- a typo in the reason doesn't move it.
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.event_absences
  add column if not exists sent_at timestamptz not null default now();

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

create or replace function public.stamp_event_absence()
returns trigger language plpgsql as $fn$
begin
  if tg_op = 'INSERT' then
    new.sent_at    := now();
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.sent_at := case when new.kind is distinct from old.kind then now() else old.sent_at end;
  end if;
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists event_absences_touch on public.event_absences;
drop trigger if exists event_absences_stamp on public.event_absences;
create trigger event_absences_stamp
  before insert or update on public.event_absences
  for each row execute function public.stamp_event_absence();
drop function if exists public.touch_event_absence();
