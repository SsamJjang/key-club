-- =====================================================================
-- Key Club — full schema. Paste into Supabase Studio -> SQL Editor -> Run.
-- Safe to re-run.
-- =====================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. members = THE ROSTER / ALLOWLIST.
--    You manage this by hand in Supabase Studio -> Table Editor.
--    An email that is not in here (or is here but active = false)
--    cannot create an account, full stop. See the trigger in section 3.
-- ---------------------------------------------------------------------
create table if not exists public.members (
  email            citext primary key,
  full_name        text    not null,
  grade            smallint check (grade between 9 and 12),
  graduation_year  smallint check (graduation_year between 2000 and 2100),
  phone            text,
  role             text    not null default 'member'
                     check (role in ('member', 'officer', 'admin')),
  active           boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);

comment on table public.members is
  'Allowlist. Only emails listed here (active = true) may sign in.';
comment on column public.members.role is
  'member = read + rsvp + log hours. officer/admin = also write posts and approve hours.';

-- ---------------------------------------------------------------------
-- 2. profiles = the account created on first successful login,
--    seeded from the matching members row.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  email            citext unique not null,
  full_name        text not null,
  grade            smallint,
  graduation_year  smallint,
  phone            text,
  role             text not null default 'member'
                     check (role in ('member', 'officer', 'admin')),
  avatar_url       text,
  pronouns         text,
  title            text,          -- 'President', 'Sophomore Rep', ...
  bio              text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. The gate. An AFTER INSERT trigger on auth.users that raises if the
--    email is not on the roster — raising rolls the whole signup back, so
--    no auth.users row survives and the OAuth callback fails.
-- ---------------------------------------------------------------------
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
    id, email, full_name, grade, graduation_year, phone, role, avatar_url
  ) values (
    new.id,
    new.email,
    coalesce(nullif(m.full_name, ''), new.raw_user_meta_data ->> 'full_name', new.email::text),
    m.grade,
    m.graduation_year,
    m.phone,
    m.role,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Role helpers. SECURITY DEFINER so they bypass RLS and cannot recurse
--    when referenced from a policy on profiles.
-- ---------------------------------------------------------------------
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.profiles p
      join public.members  m on m.email = p.email
     where p.id = auth.uid() and m.active
  );
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.profiles p
      join public.members  m on m.email = p.email
     where p.id = auth.uid()
       and m.active
       and p.role in ('officer', 'admin')
  );
$fn$;

-- Keeps `members` authoritative: demote or deactivate someone there and
-- it lands on their profile too.
create or replace function public.sync_member_to_profile()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.profiles
     set role = new.role, updated_at = now()
   where email = new.email;
  return new;
end;
$fn$;

drop trigger if exists on_member_updated on public.members;
create trigger on_member_updated
  after update of role on public.members
  for each row execute function public.sync_member_to_profile();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. posts = news articles, notices, and events. One table; `category`
--    picks the shape and the event columns stay null for news/notices.
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  summary       text,
  body          text not null default '',        -- markdown
  category      text not null default 'news'
                  check (category in ('news', 'notice', 'event')),
  cover_url     text,
  pinned        boolean not null default false,
  published     boolean not null default false,
  author_id     uuid references public.profiles(id) on delete set null,
  -- event-only fields
  starts_at     timestamptz,
  ends_at       timestamptz,
  location      text,
  service_hours numeric(4,1) check (service_hours >= 0),
  capacity      integer check (capacity > 0),
  signup_open   boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists posts_category_idx  on public.posts (category, published);
create index if not exists posts_starts_at_idx on public.posts (starts_at);
create index if not exists posts_created_idx   on public.posts (created_at desc);

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. event signups
-- ---------------------------------------------------------------------
create table if not exists public.event_signups (
  post_id    uuid not null references public.posts(id)    on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'going' check (status in ('going', 'waitlist')),
  attended   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists signups_user_idx on public.event_signups (user_id);

-- ---------------------------------------------------------------------
-- 7. service hours log
-- ---------------------------------------------------------------------
create table if not exists public.hours_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  post_id     uuid references public.posts(id) on delete set null,
  hours       numeric(4,1) not null check (hours > 0 and hours <= 24),
  description text not null,
  served_on   date not null,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists hours_user_idx   on public.hours_log (user_id);
create index if not exists hours_status_idx on public.hours_log (status);

-- ---------------------------------------------------------------------
-- 8. Row level security. The anon key is public, so every rule that
--    matters lives here.
-- ---------------------------------------------------------------------
alter table public.members       enable row level security;
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.event_signups enable row level security;
alter table public.hours_log     enable row level security;

-- members: only admins read the raw roster from the browser, and nobody
-- writes it from the browser at all (Studio only).
drop policy if exists members_admin_read on public.members;
create policy members_admin_read on public.members
  for select to authenticated using (public.is_admin());

-- profiles: every signed-in member sees the directory. You edit your own
-- row, but never your own role.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (public.is_member());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- posts: members read published; admins read and write everything.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (public.is_member() and (published or public.is_admin()));

drop policy if exists posts_admin_write on public.posts;
create policy posts_admin_write on public.posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- signups: members see who else is going, manage only their own row.
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

-- hours: you see and file your own; admins see and rule on all.
drop policy if exists hours_read on public.hours_log;
create policy hours_read on public.hours_log
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists hours_insert_own on public.hours_log;
create policy hours_insert_own on public.hours_log
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member() and status = 'pending');

-- A member may edit or withdraw a submission only while it is pending.
drop policy if exists hours_update_own on public.hours_log;
create policy hours_update_own on public.hours_log
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists hours_delete_own on public.hours_log;
create policy hours_delete_own on public.hours_log
  for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());

drop policy if exists hours_admin_all on public.hours_log;
create policy hours_admin_all on public.hours_log
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 9. Approved-hours totals, exposed as a view the directory can read.
--    security_invoker = off on purpose: hours_log rows are private to
--    their owner, but the per-member *total* is meant to be public to the
--    club. The view exposes nothing but the two sums, and is granted to
--    authenticated only.
-- ---------------------------------------------------------------------
create or replace view public.member_hours
with (security_invoker = off) as
  select p.id as user_id,
         coalesce(sum(h.hours) filter (where h.status = 'approved'), 0) as approved_hours,
         coalesce(sum(h.hours) filter (where h.status = 'pending'), 0)  as pending_hours
    from public.profiles p
    left join public.hours_log h on h.user_id = p.id
   group by p.id;

grant select on public.member_hours to authenticated;
