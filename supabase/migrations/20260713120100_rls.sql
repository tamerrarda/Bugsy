-- Row Level Security. RLS is enabled on EVERY table. No exceptions.
--
-- The service_role key used by the Edge Functions bypasses RLS by design; these
-- policies govern what the extension's anon key can reach directly via PostgREST.
-- Anything a client has no business reading gets RLS enabled with NO policy plus
-- an explicit REVOKE, because Supabase grants table privileges to anon and
-- authenticated by default.

alter table profiles     enable row level security;
alter table challenges   enable row level security;
alter table daily_sets   enable row level security;
alter table serves       enable row level security;
alter table attempts     enable row level security;
alter table streaks      enable row level security;
alter table badges       enable row level security;
alter table user_badges  enable row level security;

-- Table privileges -----------------------------------------------------------
-- RLS narrows what a role may see; it does not GRANT anything. Postgres checks
-- the table privilege first, so a policy without a matching grant is a dead
-- letter — the role is refused before RLS is ever evaluated. Supabase's default
-- privileges hand out only REFERENCES/TRIGGER/TRUNCATE, so every SELECT below
-- has to be explicit.
--
-- The pairing to keep in mind: GRANT decides which *table* a role may touch;
-- POLICY decides which *rows*. Both are required.

-- The backend. Bypasses RLS by design; it is what the Edge Functions run as.
grant all on all tables in schema public to service_role;

-- Signed-in users read their own data (rows narrowed by the policies below).
grant select on profiles, attempts, streaks, badges, user_badges to authenticated;
grant update on profiles to authenticated;

-- Guests get the badge catalogue (to render locked badges) and the leaderboards
-- (granted with the views themselves). Nothing else.
grant select on badges to anon;

-- Deliberately absent from every grant above: challenges, serves, daily_sets.

-- challenges ----------------------------------------------------------------
-- THE invariant: bug_line and explanation must never reach a client before an
-- attempt. Direct select is revoked outright, so the only way to see
-- a challenge is through an Edge Function, which strips the answer fields.
revoke all on challenges from anon, authenticated;

-- serves --------------------------------------------------------------------
-- Server-side timing. If a client could read (or worse, write) served_at, the
-- whole anti-cheat timing model collapses.
revoke all on serves from anon, authenticated;

-- daily_sets ----------------------------------------------------------------
-- The client never needs this; get-daily returns the challenges themselves.
revoke all on daily_sets from anon, authenticated;

-- profiles ------------------------------------------------------------------
-- Public: the leaderboard shows usernames and avatars.
create policy "profiles are readable by everyone"
  on profiles for select
  using (true);

create policy "users can update their own profile"
  on profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- attempts ------------------------------------------------------------------
-- Read your own history. No insert/update/delete policy exists, so a client
-- cannot fabricate an attempt or rewrite one — only submit-attempt can, via the
-- service role. This is what makes the unique-constraint anti-cheat rule real.
create policy "users can read their own attempts"
  on attempts for select
  using ((select auth.uid()) = user_id);

-- streaks -------------------------------------------------------------------
-- Read-only to the owner; only the server may write them.
create policy "users can read their own streaks"
  on streaks for select
  using ((select auth.uid()) = user_id);

-- badges --------------------------------------------------------------------
-- The catalogue is public so the profile screen can show locked badges.
create policy "badge catalogue is readable by everyone"
  on badges for select
  using (true);

-- user_badges ---------------------------------------------------------------
create policy "users can read their own badges"
  on user_badges for select
  using ((select auth.uid()) = user_id);
