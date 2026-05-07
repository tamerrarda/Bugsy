-- Leaderboards: if you played, you are on the board.
--
-- The original views filtered with `having sum(points) > 0`, which quietly erased
-- anyone who finished the day without a single correct answer. Real play exposed
-- how bad that is: a player completed all three dailies, earned a streak and the
-- Day One badge, opened the leaderboard — and was told "Bugsy hasn't seen anyone
-- here yet." Bugsy had, in fact, just seen them.
--
-- Scoring zero is not the same as not existing. Attempting is what puts you on
-- the board; points only decide where. Last place is a reason to come back
-- tomorrow. Being invisible is a reason to leave.

drop view if exists leaderboard_alltime;
drop view if exists leaderboard_daily;
drop view if exists leaderboard_weekly;

create view leaderboard_alltime
with (security_invoker = false) as
  select
    p.username,
    p.avatar_url,
    sum(a.points)::int as points,
    rank() over (order by sum(a.points) desc)::int as rank
  from attempts a
  join profiles p on p.id = a.user_id
  group by p.id, p.username, p.avatar_url;

create view leaderboard_daily
with (security_invoker = false) as
  select
    p.username,
    p.avatar_url,
    sum(a.points)::int as points,
    rank() over (order by sum(a.points) desc)::int as rank
  from attempts a
  join profiles p on p.id = a.user_id
  where a.created_at >= (date_trunc('day', timezone('utc', now())) at time zone 'utc')
  group by p.id, p.username, p.avatar_url;

create view leaderboard_weekly
with (security_invoker = false) as
  select
    p.username,
    p.avatar_url,
    sum(a.points)::int as points,
    rank() over (order by sum(a.points) desc)::int as rank
  from attempts a
  join profiles p on p.id = a.user_id
  where a.created_at >= (date_trunc('week', timezone('utc', now())) at time zone 'utc')
  group by p.id, p.username, p.avatar_url;

grant select on leaderboard_alltime, leaderboard_daily, leaderboard_weekly
  to anon, authenticated;
