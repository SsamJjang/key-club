-- =====================================================================
-- Key Club — update 002
--   * roster is now editable from the admin portal
--   * image uploads for posts and avatars
--   * only officers log service hours (members no longer submit)
--   * club settings + weekly email scheduling
-- Run after schema.sql. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Club settings (single row).
-- ---------------------------------------------------------------------
create table if not exists public.club_settings (
  id                   boolean primary key default true check (id),
  club_name            text    not null default 'Key Club',
  school_year          text    not null default '’26–’27',
  hours_goal           numeric not null default 50 check (hours_goal > 0),
  email_from           text    not null default 'Key Club Hour Tracker <keyclub@example.org>',
  email_reply_to       text,
  weekly_email_enabled boolean not null default false,
  site_url             text
);

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

alter table public.club_settings enable row level security;

drop policy if exists settings_read on public.club_settings;
create policy settings_read on public.club_settings
  for select to authenticated using (public.is_member());

drop policy if exists settings_admin_write on public.club_settings;
create policy settings_admin_write on public.club_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. The roster becomes writable from the admin portal.
--    Guard rails: you cannot demote or deactivate yourself, so a chapter
--    can never lock itself out of its own admin area.
-- ---------------------------------------------------------------------
drop policy if exists members_admin_insert on public.members;
create policy members_admin_insert on public.members
  for insert to authenticated with check (public.is_admin());

drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members
  for update to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (
      -- editing someone else is unrestricted...
      email <> (select p.email from public.profiles p where p.id = auth.uid())
      -- ...editing yourself may not drop your own admin access
      or (role in ('officer', 'admin') and active)
    )
  );

drop policy if exists members_admin_delete on public.members;
create policy members_admin_delete on public.members
  for delete to authenticated
  using (
    public.is_admin()
    and email <> (select p.email from public.profiles p where p.id = auth.uid())
  );

-- Editing a roster row now pushes name/grade/year/phone onto the live
-- profile too, so the directory reflects officer edits immediately.
create or replace function public.sync_member_to_profile()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.profiles
     set role            = new.role,
         full_name       = coalesce(nullif(new.full_name, ''), full_name),
         grade           = new.grade,
         graduation_year = new.graduation_year,
         phone           = new.phone,
         updated_at      = now()
   where email = new.email;
  return new;
end;
$fn$;

drop trigger if exists on_member_updated on public.members;
create trigger on_member_updated
  after update on public.members
  for each row execute function public.sync_member_to_profile();

-- ---------------------------------------------------------------------
-- 3. Service hours are now officer-entered only.
--    Members keep read access to their own rows; they can no longer
--    insert, edit, or withdraw.
-- ---------------------------------------------------------------------
drop policy if exists hours_insert_own on public.hours_log;
drop policy if exists hours_update_own on public.hours_log;
drop policy if exists hours_delete_own on public.hours_log;

-- hours_read (own or admin) and hours_admin_all stay as they are.

-- Officer-entered hours are approved on the spot — there is no longer a
-- request to review.
alter table public.hours_log alter column status set default 'approved';

-- Records who entered it, which matters now that members cannot.
alter table public.hours_log
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 4. Storage: post images and member avatars.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read: these are images embedded in pages, and the bucket is
-- public so <img src> works without signed URLs.
drop policy if exists "public read post images" on storage.objects;
create policy "public read post images" on storage.objects
  for select using (bucket_id in ('post-images', 'avatars'));

drop policy if exists "admins write post images" on storage.objects;
create policy "admins write post images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and public.is_admin());

drop policy if exists "admins update post images" on storage.objects;
create policy "admins update post images" on storage.objects
  for update to authenticated using (bucket_id = 'post-images' and public.is_admin());

drop policy if exists "admins delete post images" on storage.objects;
create policy "admins delete post images" on storage.objects
  for delete to authenticated using (bucket_id = 'post-images' and public.is_admin());

-- Members own their avatar folder: avatars/<their uid>/<file>
drop policy if exists "members write own avatar" on storage.objects;
create policy "members write own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "members update own avatar" on storage.objects;
create policy "members update own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members delete own avatar" on storage.objects;
create policy "members delete own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 5. Weekly email support.
--    A view the Edge Function reads with the service role: one row per
--    active member with their approved total.
-- ---------------------------------------------------------------------
create or replace view public.weekly_hours_digest
with (security_invoker = off) as
  select m.email,
         coalesce(p.full_name, m.full_name)                                   as full_name,
         m.grade,
         m.graduation_year,
         coalesce(sum(h.hours) filter (where h.status = 'approved'), 0)::numeric as approved_hours,
         max(h.served_on) filter (where h.status = 'approved')                as last_served_on
    from public.members m
    left join public.profiles  p on p.email   = m.email
    left join public.hours_log h on h.user_id = p.id
   where m.active
   group by m.email, p.full_name, m.full_name, m.grade, m.graduation_year;

-- Not granted to authenticated: the Edge Function reads it with the
-- service role key. Members see their own hours in the app instead.
revoke all on public.weekly_hours_digest from anon, authenticated;

-- Audit trail so a double-fired cron is visible.
create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'weekly_hours',
  sent_at    timestamptz not null default now(),
  recipients integer not null default 0,
  failures   integer not null default 0,
  detail     text
);

alter table public.email_log enable row level security;

drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Schedule it: Sunday 21:00 Asia/Seoul = Sunday 12:00 UTC.
--
--    Run these THREE statements yourself after deploying the Edge
--    Function, replacing the placeholders. They are commented out
--    because they embed project-specific values.
-- ---------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- Store the service role key in Vault rather than inline in the job.
-- select vault.create_secret(
--   'PASTE_YOUR_SERVICE_ROLE_KEY',
--   'cron_service_key',
--   'Authorizes the weekly Key Club hours email'
-- );
--
-- select cron.schedule(
--   'weekly-hours-email',
--   '0 12 * * 0',                      -- Sunday 12:00 UTC = Sunday 21:00 KST
--   $cron$
--   select net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/weekly-hours-email',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer ' || (
--         select decrypted_secret from vault.decrypted_secrets
--          where name = 'cron_service_key'
--       )
--     ),
--     body    := '{}'::jsonb
--   );
--   $cron$
-- );
--
-- -- To check or remove it later:
-- --   select * from cron.job;
-- --   select cron.unschedule('weekly-hours-email');
