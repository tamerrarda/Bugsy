-- Close the one write the client was granted but never uses.
--
-- The extension only ever READS profiles (auth.ts). Every legitimate write is
-- server-side under the service role: handle_new_user creates the row,
-- serve_daily records the chosen track. Yet `authenticated` held a blanket
-- UPDATE grant plus a permissive policy — which meant any signed-in user could,
-- with nothing more than their own JWT and curl, rewrite their row directly:
--
--   * avatar_url -> any URL. The leaderboard renders every player's avatar as
--     an <img> in every OTHER player's popup, so a hostile avatar_url becomes a
--     tracking pixel: it leaks the IP and online-time of anyone who opens the
--     board. This is the vector that makes the grant a real bug rather than
--     tidiness.
--   * username -> lookalike impersonation of another player, bypassing the
--     GitHub-derived naming in handle_new_user.
--
-- No feature loses anything: nothing client-side performs this update today.
-- When a "change my display name" feature genuinely arrives, reintroduce write
-- access deliberately — as a SECURITY DEFINER function that validates the new
-- value, not as a table-wide grant.

revoke update on profiles from authenticated;

drop policy if exists "users can update their own profile" on profiles;
