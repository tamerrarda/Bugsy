-- Leaderboard views (spec §4.3, §5.3): daily, weekly, all-time, by points sum.
--
-- These deliberately run with security_invoker = false, i.e. as the view owner
-- (postgres) rather than the caller. They have to: RLS on `attempts` limits a
-- caller to their OWN rows, but a leaderboard is inherently a read across
-- everyone. Running as owner is what makes the aggregate possible.
--
-- That is safe here only because of what the views project: username, avatar_url,
-- points, rank — and nothing else (spec §5.3). No attempt rows, no challenge ids,
-- no answers leak through them. Do not add columns to these views casually.
--
-- Day boundaries are UTC (spec §2.1), stated explicitly rather than relying on
-- the database's TimeZone setting.

create view leaderboard_alltime
with (security_invoker = false) as
  select
    p.username,
    p.avatar_url,
    sum(a.points)::int as points,
    rank() over (order by sum(a.points) desc)::int as rank
  from attempts a
  join profiles p on p.id = a.user_id
  group by p.id, p.username, p.avatar_url
  having sum(a.points) > 0;

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
  group by p.id, p.username, p.avatar_url
  having sum(a.points) > 0;

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
  group by p.id, p.username, p.avatar_url
  having sum(a.points) > 0;

grant select on leaderboard_alltime, leaderboard_daily, leaderboard_weekly
  to anon, authenticated;
