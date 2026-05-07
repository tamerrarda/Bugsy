-- Profile stats (spec §6.1: "accuracy %, best streaks, weakest category").
--
-- The weakest-category stat needs attempts joined to challenges.category — but
-- `challenges` is revoked from every client role, because that is the table the
-- answers live in. So the join happens inside a view that runs as its owner and
-- projects ONLY the category, never bug_line or explanation.
--
-- Running as owner means RLS on `attempts` does not apply, so the view has to
-- restrict rows itself: `a.user_id = auth.uid()` is what stops one player from
-- reading another's category breakdown. auth.uid() still reflects the CALLER's
-- JWT here — it is request-local, not owner-local.

create view my_category_stats
with (security_invoker = false) as
  select
    c.category,
    count(*)::int as attempts,
    count(*) filter (where a.correct)::int as correct
  from attempts a
  join challenges c on c.id = a.challenge_id
  where a.user_id = (select auth.uid())
  group by c.category;

grant select on my_category_stats to authenticated;
