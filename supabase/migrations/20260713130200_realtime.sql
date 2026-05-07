-- Live leaderboard (spec §6.1, §7.10).
--
-- The obvious approach — subscribing to postgres_changes on `attempts` — is a
-- trap here. RLS restricts a player to their OWN attempt rows, so such a
-- subscription would only ever fire for the subscriber's own scores: the board
-- would sit frozen while everyone else played, and it would *look* like it was
-- working. (It would in fact deliver nothing at all, since `attempts` is not in
-- the realtime publication either.)
--
-- Instead the database broadcasts a deliberately empty ping on every attempt.
-- Subscribers just re-read the leaderboard views, which already expose only
-- username / avatar / points / rank. The ping itself carries no user, no
-- challenge and no score — there is nothing in it to leak.

create or replace function broadcast_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('at', now()),   -- no user_id, no challenge_id, no points
    'attempt',                          -- event
    'leaderboard',                      -- topic
    false                               -- public topic: no per-user authorization needed
  );
  return null;
end;
$$;

create trigger attempts_broadcast
  after insert on attempts
  for each row execute function broadcast_attempt();
