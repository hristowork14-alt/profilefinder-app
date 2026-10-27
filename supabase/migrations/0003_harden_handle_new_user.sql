-- 0003 — Lock down handle_new_user().
--
-- handle_new_user() is a SECURITY DEFINER trigger function (0001_init.sql) that creates a
-- profiles row for every new auth user. Functions in the public schema are executable by
-- PUBLIC by default, so it was also reachable through the REST API (/rest/v1/rpc/handle_new_user)
-- by the anon and authenticated roles (Supabase advisors 0028 / 0029). Nobody needs to call it
-- directly: it only has to run as a trigger, and Postgres checks EXECUTE when a trigger is
-- created, not when it fires — so revoking it leaves sign-up working exactly as before.
--
-- Additive only: the function body and the on_auth_user_created trigger are unchanged.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
