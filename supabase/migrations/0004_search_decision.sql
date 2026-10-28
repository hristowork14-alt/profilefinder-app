-- ════════════════════════════════════════════════════════════════════════════
-- ProfileFinder — 0004: remember the verification outcome of each search
-- Additive only (one new nullable column on two tables), so it is safe to apply
-- while the previous version of the app is live. Older rows keep NULL.
--
-- Why: "the sources name someone, but their LinkedIn profile says otherwise"
-- (contradicted) and "a role many people hold" look the same as an ordinary
-- unverified match once stored. History and the Bulk export need the outcome
-- to show a clear status for every row.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.searches
  add column if not exists decision text
    check (decision is null or decision in ('verified_profile', 'verified_no_profile', 'contradicted', 'unverified', 'no_results'));

alter table public.search_cache
  add column if not exists decision text
    check (decision is null or decision in ('verified_profile', 'verified_no_profile', 'contradicted', 'unverified', 'no_results'));
