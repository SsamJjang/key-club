-- =====================================================================
-- Key Club — update 011: officers add and remove people from events
--
-- An officer can now put any active member on an event (or one date of a
-- series) and take anyone off it. Taking off already worked — the delete
-- policy has allowed is_admin() since the start. Putting on did not: the
-- insert policy only let a member insert a row for themselves.
--
-- The officer's insert skips the sign-up rules the button enforces
-- (closed, full, already over). That's the point: it's for "they came
-- without signing up" and "I promised them a spot". It still has to be a
-- real, active member — a deactivated roster row can't be added.
--
-- Run after 010. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Who put the row there, when it wasn't the member themselves.
--    NULL means the member signed up on their own — every row before
--    this update.
-- ---------------------------------------------------------------------
alter table public.event_signups
  add column if not exists added_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Insert: yourself as before, or anyone active if you're an officer.
--    added_by can only ever name the person doing the inserting, so the
--    "added by" tag on the roster can't be forged.
-- ---------------------------------------------------------------------
drop policy if exists signups_write_own on public.event_signups;
create policy signups_write_own on public.event_signups
  for insert to authenticated
  with check (
    (user_id = auth.uid() and public.is_member() and added_by is null)
    or (
      public.is_admin()
      and added_by = auth.uid()
      and exists (
        select 1
          from public.profiles p
          join public.members  m on m.email = p.email
         where p.id = user_id and m.active
      )
    )
  );
