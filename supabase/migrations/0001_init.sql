-- ════════════════════════════════════════════════════════════════════════════
-- ProfileFinder — initial schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run on a fresh project. Creates tables, indexes, triggers and
-- Row Level Security (RLS) policies.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── profiles ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- Creates a profiles row automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Shared helper: keeps updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── bulk_jobs ──────────────────────────────────────────────────────────────
create table if not exists public.bulk_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name       text not null check (char_length(file_name) between 1 and 255),
  total_rows      integer not null check (total_rows between 0 and 100),
  processed_rows  integer not null default 0 check (processed_rows >= 0),
  status          text not null default 'pending'
                  check (status in ('pending', 'running', 'completed', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists bulk_jobs_set_updated_at on public.bulk_jobs;
create trigger bulk_jobs_set_updated_at
  before update on public.bulk_jobs
  for each row execute function public.set_updated_at();

-- ─── searches ───────────────────────────────────────────────────────────────
create table if not exists public.searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bulk_job_id   uuid references public.bulk_jobs (id) on delete set null,
  company_url   text not null check (char_length(company_url) between 1 and 500),
  domain        text check (char_length(domain) <= 253),
  company_name  text check (char_length(company_name) <= 200),
  position      text not null check (char_length(position) between 1 and 100),
  status        text not null default 'completed'
                check (status in ('completed', 'no_results', 'failed')),
  error         text check (char_length(error) <= 500),
  from_cache    boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ─── bulk_job_rows ──────────────────────────────────────────────────────────
create table if not exists public.bulk_job_rows (
  id           uuid primary key default gen_random_uuid(),
  bulk_job_id  uuid not null references public.bulk_jobs (id) on delete cascade,
  row_index    integer not null check (row_index >= 0),
  company_url  text not null default '' check (char_length(company_url) <= 500),
  position     text not null default '' check (char_length(position) <= 200),
  status       text not null default 'pending'
               check (status in ('pending', 'running', 'completed', 'failed')),
  search_id    uuid references public.searches (id) on delete set null,
  error        text check (char_length(error) <= 500),
  unique (bulk_job_id, row_index)
);

-- ─── search_results ─────────────────────────────────────────────────────────
create table if not exists public.search_results (
  id            uuid primary key default gen_random_uuid(),
  search_id     uuid not null references public.searches (id) on delete cascade,
  rank          smallint not null check (rank between 1 and 5),
  full_name     text not null check (char_length(full_name) <= 200),
  headline      text not null default '' check (char_length(headline) <= 300),
  linkedin_url  text not null check (linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]+$'),
  confidence    integer not null check (confidence between 0 and 100),
  reasoning     text not null default '' check (char_length(reasoning) <= 500),
  created_at    timestamptz not null default now()
);

-- ─── search_cache (server-only) ─────────────────────────────────────────────
create table if not exists public.search_cache (
  domain               text not null,
  position_normalized  text not null,
  company_name         text not null,
  results              jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  primary key (domain, position_normalized)
);

-- ─── Indexes ────────────────────────────────────────────────────────────────
create index if not exists searches_user_created_idx
  on public.searches (user_id, created_at desc);
-- Used by the hourly rate limit (fresh searches only).
create index if not exists searches_user_fresh_idx
  on public.searches (user_id, created_at)
  where from_cache = false;
create index if not exists searches_bulk_job_idx
  on public.searches (bulk_job_id)
  where bulk_job_id is not null;
create index if not exists search_results_search_rank_idx
  on public.search_results (search_id, rank);
create index if not exists bulk_jobs_user_created_idx
  on public.bulk_jobs (user_id, created_at desc);
create index if not exists bulk_job_rows_search_idx
  on public.bulk_job_rows (search_id)
  where search_id is not null;
create index if not exists search_cache_created_idx
  on public.search_cache (created_at);

-- ─── Row Level Security ─────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.bulk_jobs      enable row level security;
alter table public.bulk_job_rows  enable row level security;
alter table public.searches       enable row level security;
alter table public.search_results enable row level security;
alter table public.search_cache   enable row level security;

-- profiles: a user sees and edits only their own row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

-- bulk_jobs: owned through user_id.
drop policy if exists "bulk_jobs_select_own" on public.bulk_jobs;
create policy "bulk_jobs_select_own" on public.bulk_jobs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "bulk_jobs_insert_own" on public.bulk_jobs;
create policy "bulk_jobs_insert_own" on public.bulk_jobs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "bulk_jobs_update_own" on public.bulk_jobs;
create policy "bulk_jobs_update_own" on public.bulk_jobs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "bulk_jobs_delete_own" on public.bulk_jobs;
create policy "bulk_jobs_delete_own" on public.bulk_jobs
  for delete to authenticated using (user_id = (select auth.uid()));

-- bulk_job_rows: owned through the parent bulk job.
drop policy if exists "bulk_job_rows_select_own" on public.bulk_job_rows;
create policy "bulk_job_rows_select_own" on public.bulk_job_rows
  for select to authenticated using (
    exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
  );
drop policy if exists "bulk_job_rows_insert_own" on public.bulk_job_rows;
create policy "bulk_job_rows_insert_own" on public.bulk_job_rows
  for insert to authenticated with check (
    exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
  );
drop policy if exists "bulk_job_rows_update_own" on public.bulk_job_rows;
create policy "bulk_job_rows_update_own" on public.bulk_job_rows
  for update to authenticated
  using (
    exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
    and (
      search_id is null
      or exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
    )
  );
drop policy if exists "bulk_job_rows_delete_own" on public.bulk_job_rows;
create policy "bulk_job_rows_delete_own" on public.bulk_job_rows
  for delete to authenticated using (
    exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
  );

-- searches: owned through user_id. A search may only point at the user's own bulk job.
drop policy if exists "searches_select_own" on public.searches;
create policy "searches_select_own" on public.searches
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "searches_insert_own" on public.searches;
create policy "searches_insert_own" on public.searches
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and (
      bulk_job_id is null
      or exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
    )
  );
drop policy if exists "searches_update_own" on public.searches;
create policy "searches_update_own" on public.searches
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      bulk_job_id is null
      or exists (select 1 from public.bulk_jobs j where j.id = bulk_job_id and j.user_id = (select auth.uid()))
    )
  );
drop policy if exists "searches_delete_own" on public.searches;
create policy "searches_delete_own" on public.searches
  for delete to authenticated using (user_id = (select auth.uid()));

-- search_results: owned through the parent search.
drop policy if exists "search_results_select_own" on public.search_results;
create policy "search_results_select_own" on public.search_results
  for select to authenticated using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
drop policy if exists "search_results_insert_own" on public.search_results;
create policy "search_results_insert_own" on public.search_results
  for insert to authenticated with check (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
drop policy if exists "search_results_update_own" on public.search_results;
create policy "search_results_update_own" on public.search_results
  for update to authenticated
  using (exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid())));
drop policy if exists "search_results_delete_own" on public.search_results;
create policy "search_results_delete_own" on public.search_results
  for delete to authenticated using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );

-- search_cache: RLS is on and there are deliberately NO policies, so the browser
-- (anon / authenticated) can never read or write it. Only the secret key used
-- inside Netlify Functions (service_role, which bypasses RLS) can.
revoke all on table public.search_cache from anon, authenticated;

-- ─── Bulk job progress ──────────────────────────────────────────────────────
-- Recounts finished rows in one statement, so two parallel workers can never
-- overwrite each other's progress. Runs with the caller's rights, so RLS applies.
create or replace function public.refresh_bulk_job_progress(p_job_id uuid)
returns integer
language sql
security invoker
set search_path = ''
as $$
  update public.bulk_jobs j
     set processed_rows = (
       select count(*)::integer
         from public.bulk_job_rows r
        where r.bulk_job_id = j.id
          and r.status in ('completed', 'failed')
     )
   where j.id = p_job_id
  returning j.processed_rows;
$$;

revoke all on function public.refresh_bulk_job_progress(uuid) from public, anon;
grant execute on function public.refresh_bulk_job_progress(uuid) to authenticated;
