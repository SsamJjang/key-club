-- =====================================================================
-- Key Club — update 003: board positions
--
-- A board seat (President, VP, Secretary, Treasurer) is a title the club
-- elects. It is deliberately SEPARATE from `role`, which controls who can
-- write posts and log hours. A Secretary can be an admin; a President can
-- be a plain member; an adult adviser can be an admin with no seat at all.
--
-- Run after 002. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The positions themselves — a table, not a CHECK constraint, so you
--    can add "Historian" or "Webmaster" later with one INSERT instead of
--    an ALTER TABLE.
-- ---------------------------------------------------------------------
create table if not exists public.board_positions (
  id         text primary key,          -- 'president'
  label      text    not null,          -- 'President'
  sort_order integer not null default 100
);

insert into public.board_positions (id, label, sort_order) values
  ('president',      'President',      10),
  ('vice_president', 'Vice President', 20),
  ('secretary',      'Secretary',      30),
  ('treasurer',      'Treasurer',      40)
on conflict (id) do update
  set label = excluded.label, sort_order = excluded.sort_order;

-- To add another seat later:
--   insert into public.board_positions values ('historian', 'Historian', 50);

alter table public.board_positions enable row level security;

drop policy if exists board_positions_read on public.board_positions;
create policy board_positions_read on public.board_positions
  for select to authenticated using (public.is_member());

-- ---------------------------------------------------------------------
-- 2. Assign seats on the roster; mirror onto profiles for display.
--    Named board_position, not position — POSITION is a SQL keyword.
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists board_position text
    references public.board_positions(id) on delete set null;

alter table public.profiles
  add column if not exists board_position text
    references public.board_positions(id) on delete set null;

create index if not exists members_board_idx  on public.members  (board_position);
create index if not exists profiles_board_idx on public.profiles (board_position);

-- ---------------------------------------------------------------------
-- 3. Carry the seat through the existing roster -> profile sync.
-- ---------------------------------------------------------------------
create or replace function public.sync_member_to_profile()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.profiles
     set role            = new.role,
         full_name       = coalesce(nullif(new.full_name, ''), full_name),
         grade           = new.grade,
         graduation_year = new.graduation_year,
         phone           = new.phone,
         board_position  = new.board_position,
         updated_at      = now()
   where email = new.email;
  return new;
end;
$fn$;

drop trigger if exists on_member_updated on public.members;
create trigger on_member_updated
  after update on public.members
  for each row execute function public.sync_member_to_profile();

-- New signups pick up the seat too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m public.members%rowtype;
begin
  select * into m from public.members
   where email = new.email and active;

  if not found then
    raise exception 'not_on_roster: % is not on the Key Club roster', new.email
      using errcode = '42501';
  end if;

  insert into public.profiles (
    id, email, full_name, grade, graduation_year, phone, role, board_position, avatar_url
  ) values (
    new.id,
    new.email,
    coalesce(nullif(m.full_name, ''), new.raw_user_meta_data ->> 'full_name', new.email::text),
    m.grade,
    m.graduation_year,
    m.phone,
    m.role,
    m.board_position,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4. Backfill anyone already signed in whose roster row has a seat.
-- ---------------------------------------------------------------------
update public.profiles p
   set board_position = m.board_position
  from public.members m
 where m.email = p.email
   and p.board_position is distinct from m.board_position;

-- ---------------------------------------------------------------------
-- 5. Not enforced on purpose: two people may share a seat (co-presidents
--    are common, and a handover week has both). If your chapter wants one
--    holder per seat, add:
--
--   create unique index one_holder_per_seat
--     on public.members (board_position)
--     where board_position is not null and active;
-- ---------------------------------------------------------------------
