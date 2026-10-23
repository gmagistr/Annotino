-- Annotino database schema for Supabase (Postgres).
-- Run once in the Supabase SQL editor of a project created in an EU region
-- (e.g. Frankfurt, eu-central-1).
--
-- The server stores ciphertext only. These policies decide *who may fetch*
-- which ciphertext; they cannot read it. Annotation visibility (private, team,
-- scheduled, blind) is enforced here so hidden annotations are never even
-- delivered to other team members' browsers.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id                   uuid primary key references auth.users on delete cascade,
  email                text not null unique,
  display_name         text not null,
  public_key           jsonb not null,
  enc_private_key      text not null,
  kdf_salt             text not null,
  recovery_private_key text not null,
  recovery_salt        text not null,
  created_at           timestamptz not null default now()
);

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name_enc   text not null,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  settings   jsonb not null default '{"defaultVisibility":"blind","lockVisibility":false}',
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id     uuid not null references public.teams on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'member')),
  wrapped_key text not null,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.recordings (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams on delete cascade,
  meta_enc       text not null,
  storage_path   text not null unique,
  uploaded_by    uuid not null default auth.uid() references auth.users,
  blind_revealed boolean not null default false,
  created_at     timestamptz not null default now()
);

-- kinds: tier, sketch and tags belong to their author; thread (a discussion)
-- and guide (the team's annotation rules) are shared and any member may update
-- them. The guide is team-level, so it has no recording.
create table if not exists public.annotations (
  id           uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings on delete cascade,
  team_id      uuid not null references public.teams on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users on delete cascade,
  kind         text not null check (kind in ('tier', 'sketch', 'tags', 'thread', 'guide')),
  visibility   text not null check (visibility in ('private', 'team', 'scheduled', 'blind')),
  reveal_at    timestamptz,
  payload_enc  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users on delete set null,
  check (visibility <> 'scheduled' or reveal_at is not null),
  check ((recording_id is null) = (kind = 'guide')),
  check (kind not in ('thread', 'guide') or visibility = 'team')
);

-- Earlier versions of each annotation (the history). Written only by the trigger below.
create table if not exists public.annotation_versions (
  id            bigint generated always as identity primary key,
  annotation_id uuid not null references public.annotations on delete cascade,
  payload_enc   text not null,
  updated_at    timestamptz not null,
  updated_by    uuid references auth.users on delete set null
);
create index if not exists versions_annotation_idx on public.annotation_versions (annotation_id, updated_at desc);

create index if not exists annotations_recording_idx on public.annotations (recording_id);
create index if not exists recordings_team_idx on public.recordings (team_id);
create index if not exists members_user_idx on public.team_members (user_id);

-- ---------------------------------------------------------------- helpers
-- security definer so the policies below can consult team_members without
-- recursing into team_members' own policy.

create or replace function public.team_role(team uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.team_members where team_id = team and user_id = auth.uid()
$$;

create or replace function public.is_member(team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = team and user_id = auth.uid())
$$;

create or replace function public.is_admin(team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.team_role(team) in ('owner', 'admin'), false)
$$;

-- Look up a registered colleague to invite (returns public data only).
create or replace function public.find_profile_by_email(lookup text)
returns table (id uuid, email text, display_name text, public_key jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.public_key
  from public.profiles p
  where auth.uid() is not null and p.email = lower(trim(lookup))
$$;

-- Public data of everyone in a team the caller belongs to.
create or replace function public.team_profiles(team uuid)
returns table (id uuid, email text, display_name text, public_key jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.public_key
  from public.profiles p
  join public.team_members m on m.user_id = p.id
  where m.team_id = team and public.is_member(team)
$$;

-- Stamp who saved, keep the author fixed, and archive the previous version
-- (at most one archived version every three minutes per annotation, 60 kept).
create or replace function public.annotations_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if new.payload_enc is distinct from old.payload_enc and not exists (
      select 1 from public.annotation_versions v
      where v.annotation_id = old.id and v.updated_at > old.updated_at - interval '3 minutes'
    ) then
      insert into public.annotation_versions (annotation_id, payload_enc, updated_at, updated_by)
      values (old.id, old.payload_enc, old.updated_at, coalesce(old.updated_by, old.author_id));
      delete from public.annotation_versions where id in (
        select id from public.annotation_versions where annotation_id = old.id
        order by updated_at desc offset 60
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists annotations_before_write on public.annotations;
create trigger annotations_before_write before insert or update on public.annotations
  for each row execute function public.annotations_before_write();

-- ---------------------------------------------------------------- policies

alter table public.profiles     enable row level security;
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.recordings   enable row level security;
alter table public.annotations  enable row level security;
alter table public.annotation_versions enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid() and email = lower(auth.jwt() ->> 'email'));

drop policy if exists "teams: read" on public.teams;
create policy "teams: read" on public.teams
  for select using (public.is_member(id) or created_by = auth.uid());
drop policy if exists "teams: create" on public.teams;
create policy "teams: create" on public.teams
  for insert with check (created_by = auth.uid());
drop policy if exists "teams: owner updates" on public.teams;
create policy "teams: owner updates" on public.teams
  for update using (public.team_role(id) = 'owner');
drop policy if exists "teams: owner deletes" on public.teams;
create policy "teams: owner deletes" on public.teams
  for delete using (public.team_role(id) = 'owner');

drop policy if exists "members: read" on public.team_members;
create policy "members: read" on public.team_members
  for select using (public.is_member(team_id));
drop policy if exists "members: add" on public.team_members;
create policy "members: add" on public.team_members
  for insert with check (
    -- the creator adds themself as owner of a brand-new team
    (user_id = auth.uid() and role = 'owner'
      and exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid())
      and not exists (select 1 from public.team_members m where m.team_id = team_members.team_id))
    -- admins add others (never as owner)
    or (public.is_admin(team_id) and role <> 'owner')
  );
drop policy if exists "members: owner changes roles" on public.team_members;
create policy "members: owner changes roles" on public.team_members
  for update using (public.team_role(team_id) = 'owner') with check (role <> 'owner' or user_id = auth.uid());
drop policy if exists "members: remove" on public.team_members;
create policy "members: remove" on public.team_members
  for delete using (
    (user_id = auth.uid() and role <> 'owner')
    or (public.is_admin(team_id) and role <> 'owner')
  );

drop policy if exists "recordings: read" on public.recordings;
create policy "recordings: read" on public.recordings
  for select using (public.is_member(team_id));
drop policy if exists "recordings: admins write" on public.recordings;
create policy "recordings: admins write" on public.recordings
  for insert with check (public.is_admin(team_id) and uploaded_by = auth.uid());
drop policy if exists "recordings: admins update" on public.recordings;
create policy "recordings: admins update" on public.recordings
  for update using (public.is_admin(team_id));
drop policy if exists "recordings: admins delete" on public.recordings;
create policy "recordings: admins delete" on public.recordings
  for delete using (public.is_admin(team_id));

drop policy if exists "annotations: read" on public.annotations;
create policy "annotations: read" on public.annotations
  for select using (
    author_id = auth.uid()
    or (public.is_member(team_id) and (
      visibility = 'team'
      or (visibility = 'scheduled' and reveal_at <= now())
      or (visibility = 'blind' and exists (
        select 1 from public.recordings r where r.id = recording_id and r.blind_revealed))
    ))
  );
drop policy if exists "annotations: author writes" on public.annotations;
create policy "annotations: author writes" on public.annotations
  for insert with check (
    author_id = auth.uid() and public.is_member(team_id)
    and (
      (recording_id is null and kind = 'guide')
      or exists (select 1 from public.recordings r where r.id = recording_id and r.team_id = annotations.team_id)
    )
  );
drop policy if exists "annotations: author updates" on public.annotations;
create policy "annotations: author updates" on public.annotations
  for update using (author_id = auth.uid() or (kind in ('thread', 'guide') and public.is_member(team_id)))
  with check (public.is_member(team_id));

drop policy if exists "versions: read" on public.annotation_versions;
create policy "versions: read" on public.annotation_versions
  -- the subquery is itself filtered by the annotations read policy
  for select using (exists (select 1 from public.annotations a where a.id = annotation_id));
drop policy if exists "annotations: author deletes" on public.annotations;
create policy "annotations: author deletes" on public.annotations
  for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------- storage
-- Encrypted audio lives in a private bucket under <team_id>/<random id>.

insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "audio: members read" on storage.objects;
create policy "audio: members read" on storage.objects
  for select using (bucket_id = 'audio' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "audio: admins upload" on storage.objects;
create policy "audio: admins upload" on storage.objects
  for insert with check (bucket_id = 'audio' and public.is_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "audio: admins delete" on storage.objects;
create policy "audio: admins delete" on storage.objects
  for delete using (bucket_id = 'audio' and public.is_admin(((storage.foldername(name))[1])::uuid));
