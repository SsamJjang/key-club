-- =====================================================================
-- Key Club — update 005: sign up for specific dates
--
-- A member can now say "I can make the 9th and the 23rd, not the 16th"
-- instead of committing to a whole weekly series or none of it.
--
-- Run after 004. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Which date this sign-up is for.
--
--    NULL means "this event", and stays the shape for a single-date event
--    and for an event with no date yet. A row per date only appears for a
--    series — so every existing sign-up keeps meaning exactly what it did.
-- ---------------------------------------------------------------------
alter table public.event_signups
  add column if not exists occurs_on date;

-- ---------------------------------------------------------------------
-- 2. The primary key has to move.
--
--    It was (post_id, user_id) — one row per member per event, which is
--    precisely what we now need more than one of. A surrogate key takes
--    over, and a unique index keeps the real rule: one row per member per
--    date. COALESCE is doing load-bearing work there, because NULL never
--    equals NULL in a unique index and a member could otherwise sign up
--    for a single-date event twice.
-- ---------------------------------------------------------------------
alter table public.event_signups
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.event_signups
  drop constraint if exists event_signups_pkey;

-- Re-running is fine: adding a PK that already exists would error, so check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.event_signups'::regclass and contype = 'p'
  ) then
    alter table public.event_signups add primary key (id);
  end if;
end
$$;

create unique index if not exists event_signups_one_per_date
  on public.event_signups (post_id, user_id, coalesce(occurs_on, '0001-01-01'::date));

create index if not exists signups_post_date_idx
  on public.event_signups (post_id, occurs_on);

-- ---------------------------------------------------------------------
-- 3. RLS is unchanged in substance — the policies key off user_id, which
--    still says who owns the row. Restated here only because the table
--    was rebuilt around a new primary key.
-- ---------------------------------------------------------------------
drop policy if exists signups_read on public.event_signups;
create policy signups_read on public.event_signups
  for select to authenticated using (public.is_member());

drop policy if exists signups_write_own on public.event_signups;
create policy signups_write_own on public.event_signups
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());

drop policy if exists signups_delete_own on public.event_signups;
create policy signups_delete_own on public.event_signups
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists signups_admin_update on public.event_signups;
create policy signups_admin_update on public.event_signups
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
