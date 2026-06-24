-- Sammelbuch — Supabase Schema
-- Ausführen im Supabase-Dashboard: SQL Editor → New query → einfügen → Run.
-- Idempotent: kann gefahrlos erneut ausgeführt werden.

-- 1) checkins: genau ein Eintrag pro Tag pro Nutzer
create table if not exists public.checkins (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day        date not null,
  level      text not null default 'normal' check (level in ('leicht','normal','stark')),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- 2) profiles: Einstellungen pro Nutzer
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  goal       int     not null default 40,
  accent     text    not null default '#6b6862',
  onboarded  boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 3) Row-Level-Security aktivieren
alter table public.checkins enable row level security;
alter table public.profiles enable row level security;

-- 4) Policies: jeder Nutzer nur seine eigenen Zeilen
drop policy if exists "checkins_select" on public.checkins;
drop policy if exists "checkins_insert" on public.checkins;
drop policy if exists "checkins_update" on public.checkins;
drop policy if exists "checkins_delete" on public.checkins;
create policy "checkins_select" on public.checkins for select using (auth.uid() = user_id);
create policy "checkins_insert" on public.checkins for insert with check (auth.uid() = user_id);
create policy "checkins_update" on public.checkins for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "checkins_delete" on public.checkins for delete using (auth.uid() = user_id);

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
