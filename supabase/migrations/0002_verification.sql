-- ════════════════════════════════════════════════════════════════════════════
-- ProfileFinder — 0002: verification of the role holder + search diagnostics
-- Additive only (new nullable / defaulted columns and one new table), so it is
-- safe to apply while the previous version of the app is live.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── searches: the person independent sources name as the holder ────────────
alter table public.searches
  add column if not exists verified_holder       text     check (char_length(verified_holder) <= 200),
  add column if not exists verified_sources      smallint check (verified_sources between 0 and 100),
  add column if not exists verified_source_links jsonb;   -- up to 3 {title, url} from search results

-- ─── search_results: which shown profile is the verified person ────────────
alter table public.search_results
  add column if not exists verified boolean not null default false;

-- ─── search_cache: keep the holder, so cache hits show the same answer ─────
alter table public.search_cache
  add column if not exists verified_holder jsonb;

-- ─── search_diagnostics (server-only) ───────────────────────────────────────
-- What the pipeline did for one search: queries (text, kind, hit count, time,
-- error), evidence (names with source counts and source hosts — never snippets),
-- the decision branch and timings. Used to debug misses after the fact.
create table if not exists public.search_diagnostics (
  search_id   uuid primary key references public.searches (id) on delete cascade,
  queries     jsonb not null default '[]'::jsonb,
  evidence    jsonb not null default '[]'::jsonb,
  decision    text  not null check (char_length(decision) <= 40),
  extraction  text  check (char_length(extraction) <= 20),
  timings     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists search_diagnostics_created_idx
  on public.search_diagnostics (created_at);

-- RLS on and deliberately NO policies, like search_cache: the browser (anon /
-- authenticated) can never read or write it; only the secret key inside the
-- Netlify Functions can. Deleting a search or an account still removes its
-- diagnostics through the cascade.
alter table public.search_diagnostics enable row level security;
revoke all on table public.search_diagnostics from anon, authenticated;
