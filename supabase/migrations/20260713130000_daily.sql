-- Daily challenge.
--
-- Anti-cheat rule 4: the daily set is generated server-side and is identical for
-- everyone. It is created on the first request of a UTC day and then frozen — the
-- primary key on `day` is what makes that safe under concurrency, since two users
-- hitting a fresh day at the same instant both try to insert and exactly one wins.

create or replace function ensure_daily_set(p_day date)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select challenge_ids into v_ids from daily_sets where day = p_day;
  if found then
    return v_ids;
  end if;

  -- One challenge of each difficulty, so every day has an easy, a medium and a
  -- hard. Ordered easiest-first so the day ramps up.
  select array_agg(id order by difficulty)
    into v_ids
    from (
      select (
        select c.id
          from challenges c
         where c.active and c.difficulty = d
         order by random()
         limit 1
      ) as id, d as difficulty
      from generate_series(1, 3) as d
    ) picked
   where id is not null;

  if v_ids is null or array_length(v_ids, 1) <> 3 then
    raise exception 'not enough active challenges to build a daily set' using errcode = 'BG007';
  end if;

  -- Loser of the race silently keeps the winner's set.
  insert into daily_sets (day, challenge_ids)
  values (p_day, v_ids)
  on conflict (day) do nothing;

  select challenge_ids into v_ids from daily_sets where day = p_day;
  return v_ids;
end;
$$;

revoke all on function ensure_daily_set(date) from public, anon, authenticated;
grant execute on function ensure_daily_set(date) to service_role;


-- Serves today's three challenges, WITHOUT the answers, and stamps served_at for
-- each. Also returns whatever the user has already answered today, so a day that
-- was half-finished (or a popup that was closed) resumes exactly where it was —
-- including the revealed answers, which are fair game once an attempt exists.
create or replace function serve_daily(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_ids uuid[];
  v_challenges jsonb;
  v_attempts jsonb;
begin
  v_ids := ensure_daily_set(v_day);

  -- Start the clock on any of today's challenges the user has not answered yet.
  -- Answered ones are left alone: restamping them would be pointless, and their
  -- attempt row already exists.
  insert into serves (user_id, challenge_id, mode, served_at)
  select p_user_id, c.id, 'daily', now()
    from unnest(v_ids) as c(id)
   where not exists (
     select 1 from attempts a
      where a.user_id = p_user_id and a.challenge_id = c.id and a.mode = 'daily'
   )
  on conflict (user_id, challenge_id, mode) do update set served_at = now();

  select jsonb_agg(
           jsonb_build_object(
             'id', c.id,
             'language', c.language,
             'difficulty', c.difficulty,
             'category', c.category,
             'code', c.code
           )
           order by c.difficulty
         )
    into v_challenges
    from challenges c
   where c.id = any(v_ids);

  -- The answer is included here ONLY for challenges the user has already
  -- attempted. Revealing it then is the whole point of the result screen.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'challengeId', a.challenge_id,
               'clickedLine', a.clicked_line,
               'correct', a.correct,
               'points', a.points,
               'bugLine', c.bug_line,
               'explanation', c.explanation
             )
           ),
           '[]'::jsonb
         )
    into v_attempts
    from attempts a
    join challenges c on c.id = a.challenge_id
   where a.user_id = p_user_id
     and a.mode = 'daily'
     and a.challenge_id = any(v_ids);

  return jsonb_build_object(
    'day', v_day,
    'challenges', v_challenges,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function serve_daily(uuid) from public, anon, authenticated;
grant execute on function serve_daily(uuid) to service_role;
