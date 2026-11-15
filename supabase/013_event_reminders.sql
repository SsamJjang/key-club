-- =====================================================================
-- Key Club — update 013: "Remind" emails for events
--
-- An officer clicks Remind next to an event in Admin -> Posts. That
-- inserts one row here. The Apps Script (google-apps-script/
-- EventReminders.gs) checks this table every minute, claims the row,
-- emails everyone it covers, and writes back how it went — so the
-- browser never holds the service key and never sends mail itself.
--
--   audience  signed_up  everyone signed up for that date ('going')
--             members    every active member (officers only, for an
--                        officers-only event); people already signed
--                        up get the "see you there" version
--   occurs_on the date being reminded about. For a series it picks
--             which date's sign-up list; for a one-off it's just shown.
--   status    queued -> sending -> sent | failed
--
-- Run after 012. Safe to re-run.
-- =====================================================================

create table if not exists public.event_reminders (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  occurs_on    date,
  audience     text not null default 'signed_up'
                 check (audience in ('signed_up', 'members')),
  note         text check (char_length(note) <= 1000),
  status       text not null default 'queued'
                 check (status in ('queued', 'sending', 'sent', 'failed')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  claimed_at   timestamptz,
  sent_at      timestamptz,
  recipients   integer not null default 0,
  detail       text
);

create index if not exists event_reminders_post_idx
  on public.event_reminders (post_id, requested_at desc);
create index if not exists event_reminders_queued_idx
  on public.event_reminders (requested_at) where status = 'queued';

-- One reminder in flight per event, so a double-click can't mail twice.
create unique index if not exists event_reminders_one_in_flight
  on public.event_reminders (post_id) where status in ('queued', 'sending');

alter table public.event_reminders enable row level security;

drop policy if exists event_reminders_admin_read on public.event_reminders;
create policy event_reminders_admin_read on public.event_reminders
  for select to authenticated using (public.is_admin());

-- Officers can only ask. Status, counts and timestamps are the script's
-- to write (service key, which skips RLS).
drop policy if exists event_reminders_admin_insert on public.event_reminders;
create policy event_reminders_admin_insert on public.event_reminders
  for insert to authenticated
  with check (public.is_admin() and status = 'queued' and recipients = 0
              and sent_at is null and claimed_at is null);

-- Cancelling one that hasn't been picked up yet.
drop policy if exists event_reminders_admin_delete on public.event_reminders;
create policy event_reminders_admin_delete on public.event_reminders
  for delete to authenticated using (public.is_admin() and status = 'queued');

grant select, insert, delete on public.event_reminders to authenticated;
