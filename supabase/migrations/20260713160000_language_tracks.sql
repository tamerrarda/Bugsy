-- Per-language daily tracks.
--
-- With two languages, forcing both into every set worked. With eight it collapses:
-- three slots cannot represent eight languages, so a Rust developer would go days
-- without seeing Rust and be handed C# and Java instead. They would either lose a
-- streak they had been building or click blindly — and blind clicking turns the
-- game into a coin flip and makes the explanation worthless to them.
--
-- So the daily becomes a TRACK. You pick your language; everyone on that track
-- gets the same three snippets that day. Anti-cheat rule 4 survives intact — the
-- set is still generated server-side and is still identical for everyone you can
-- compare yourself against. The share grid survives too; it just names the track:
--
--     Bugsy #47 [rust] 🐛
--     🟩🟩🟥  2/3
--
-- The leaderboard stays GLOBAL. Points are points, and a cross-language board is
-- one of the few places the whole audience meets.

-- daily_sets: one row per (day, language) rather than per day.
alter table daily_sets drop constraint daily_sets_pkey;
alter table daily_sets add column language text;

-- Existing rows predate tracks. They were the two-language mixed sets, so there is
-- no single language they belong to; retire them rather than mislabel them.
delete from daily_sets where language is null;

alter table daily_sets alter column language set not null;
alter table daily_sets add primary key (day, language);

-- The player's chosen track. Nullable: they have not picked one until they do, and
-- the popup asks before their first daily.
alter table profiles add column daily_language text;


create or replace function ensure_daily_set(p_day date, p_language text)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  d int;
begin
  select challenge_ids into v_ids
    from daily_sets
   where day = p_day and language = p_language;

  if found then
    return v_ids;
  end if;

  -- One per difficulty, easiest first, all in the track's language.
  v_ids := '{}';

  for d in 1..3 loop
    select c.id into v_id
      from challenges c
     where c.active and c.difficulty = d and c.language = p_language
     order by random()
     limit 1;

    if v_id is null then
      raise exception 'no active % challenge at difficulty %', p_language, d
        using errcode = 'BG007';
    end if;

    v_ids := array_append(v_ids, v_id);
  end loop;

  insert into daily_sets (day, language, challenge_ids)
  values (p_day, p_language, v_ids)
  on conflict (day, language) do nothing;

  select challenge_ids into v_ids
    from daily_sets
   where day = p_day and language = p_language;

  return v_ids;
end;
$$;

revoke all on function ensure_daily_set(date, text) from public, anon, authenticated;
grant execute on function ensure_daily_set(date, text) to service_role;

drop function if exists ensure_daily_set(date);


create or replace function serve_daily(p_user_id uuid, p_language text)
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
  v_ids := ensure_daily_set(v_day, p_language);

  -- Remember the track, so the popup and the streak logic agree on which daily
  -- "today's daily" means.
  update profiles set daily_language = p_language where id = p_user_id;

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
             'id', c.id, 'language', c.language, 'difficulty', c.difficulty,
             'category', c.category, 'code', c.code
           ) order by c.difficulty
         )
    into v_challenges
    from challenges c
   where c.id = any(v_ids);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'challengeId', a.challenge_id, 'clickedLine', a.clicked_line,
               'correct', a.correct, 'points', a.points,
               'bugLine', c.bug_line, 'explanation', c.explanation
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
    'language', p_language,
    'challenges', v_challenges,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function serve_daily(uuid, text) from public, anon, authenticated;
grant execute on function serve_daily(uuid, text) to service_role;

drop function if exists serve_daily(uuid);


-- Which languages actually have enough content to run a daily track: one active
-- challenge at every difficulty. Publicly readable, so the popup can offer only
-- the tracks that will not immediately fail.
create view daily_tracks
with (security_invoker = false) as
  select language
    from challenges
   where active
   group by language
  having count(*) filter (where difficulty = 1) > 0
     and count(*) filter (where difficulty = 2) > 0
     and count(*) filter (where difficulty = 3) > 0;

grant select on daily_tracks to anon, authenticated;
