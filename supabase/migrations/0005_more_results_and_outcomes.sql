-- ════════════════════════════════════════════════════════════════════════════
-- ProfileFinder — 0005: more results per search, more outcome kinds, search funnel
-- Backward compatible: constraints are only widened, new columns are nullable,
-- nothing is dropped or rewritten. Safe to apply while the previous version of
-- the app is live (it only ever writes values the new constraints also allow).
--
-- Why:
--   • Roles many people hold (Mechanical Engineer, Developer …) now return up to
--     25 profiles instead of 5.
--   • New outcomes: verified but also working elsewhere, verified with a profile
--     matched by name only, "likely" (one strong source), "closest matches".
--   • The verified person can hold the top role of a function ("Chief Design
--     Officer" when "Head of Design" was asked): that title is stored with them.
--   • Diagnostics record how many candidates were found, kept and dropped.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── search_results: rank 1–25 (was 1–5) ────────────────────────────────────
alter table public.search_results drop constraint if exists search_results_rank_check;
alter table public.search_results
  add constraint search_results_rank_check check (rank between 1 and 25);

-- ─── searches / search_cache: the wider list of outcomes ───────────────────
alter table public.searches drop constraint if exists searches_decision_check;
alter table public.searches
  add constraint searches_decision_check check (
    decision is null or decision in (
      'verified_profile', 'verified_elsewhere', 'verified_name_match', 'verified_no_profile',
      'likely', 'contradicted', 'unverified', 'closest', 'no_results'
    )
  );

alter table public.search_cache drop constraint if exists search_cache_decision_check;
alter table public.search_cache
  add constraint search_cache_decision_check check (
    decision is null or decision in (
      'verified_profile', 'verified_elsewhere', 'verified_name_match', 'verified_no_profile',
      'likely', 'contradicted', 'unverified', 'closest', 'no_results'
    )
  );

-- ─── searches: the title the verified person holds, when it differs ────────
alter table public.searches
  add column if not exists verified_role text check (char_length(verified_role) <= 120);

-- ─── search_diagnostics (server-only): the candidate funnel ────────────────
-- Counts only (found, credible, shown, dropped by reason) and credits used —
-- never names or snippets.
alter table public.search_diagnostics
  add column if not exists funnel jsonb;
