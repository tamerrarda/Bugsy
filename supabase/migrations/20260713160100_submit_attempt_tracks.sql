-- submit_attempt, aware of language tracks.
--
-- The daily-completion check used to read daily_sets by day alone. Now a day has
-- one set per language, so it has to read the set for the TRACK the player is on
-- — otherwise "have you finished all three?" is asked against the wrong three.

create or replace function submit_attempt(
  p_user_id uuid,
  p_challenge_id uuid,
  p_mode text,
  p_clicked_line int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bug_line int;
  v_difficulty int;
  v_explanation text;
  v_line_count int;

  v_served_at timestamptz;
  v_elapsed_ms int;

  v_correct boolean;
  v_points int;
  v_remaining int;

  v_attempt_id uuid;
  v_streaks streaks%rowtype;

  v_day date := (timezone('utc', now()))::date;
  v_track text;
  v_daily_ids uuid[];
  v_done_today int;
  v_completed_daily boolean := false;

  v_new_badges text[] := '{}';
  v_badges jsonb;
begin
  if p_mode not in ('daily', 'practice') then
    raise exception 'unknown mode' using errcode = 'BG004';
  end if;

  select bug_line, difficulty, explanation,
         array_length(string_to_array(code, E'\n'), 1)
    into v_bug_line, v_difficulty, v_explanation, v_line_count
    from challenges
   where id = p_challenge_id and active;

  if not found then
    raise exception 'unknown challenge' using errcode = 'BG005';
  end if;

  select served_at into v_served_at
    from serves
   where user_id = p_user_id and challenge_id = p_challenge_id and mode = p_mode;

  if not found then
    raise exception 'challenge was never served' using errcode = 'BG001';
  end if;

  if exists (
    select 1 from attempts
     where user_id = p_user_id and challenge_id = p_challenge_id and mode = p_mode
  ) then
    raise exception 'already answered' using errcode = 'BG003';
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_served_at)) * 1000);

  if v_elapsed_ms > 300000 then
    raise exception 'serve expired' using errcode = 'BG002';
  end if;

  if p_clicked_line <> 0 and (p_clicked_line < 1 or p_clicked_line > v_line_count) then
    raise exception 'line % is not in this snippet', p_clicked_line using errcode = 'BG004';
  end if;

  v_correct := (p_clicked_line = v_bug_line);

  if v_correct then
    v_remaining := greatest(0, 60 - floor(v_elapsed_ms / 1000));
    v_points := v_difficulty * 100 + v_remaining * 2;
  else
    v_points := 0;
  end if;

  insert into attempts (user_id, challenge_id, mode, clicked_line, correct, elapsed_ms, points)
  values (p_user_id, p_challenge_id, p_mode, p_clicked_line, v_correct, v_elapsed_ms, v_points)
  on conflict (user_id, challenge_id, mode) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    raise exception 'already answered' using errcode = 'BG003';
  end if;

  -- ---------------- accuracy streak (Practice) ----------------
  if p_mode = 'practice' then
    update streaks
       set accuracy_current = case when v_correct then accuracy_current + 1 else 0 end,
           accuracy_best = greatest(
             accuracy_best,
             case when v_correct then accuracy_current + 1 else 0 end
           )
     where user_id = p_user_id;
  end if;

  -- ---------------- daily streak ----------------
  if p_mode = 'daily' then
    -- The player's track. serve_daily records it, so by the time an attempt
    -- arrives it is always set.
    select daily_language into v_track from profiles where id = p_user_id;

    select challenge_ids into v_daily_ids
      from daily_sets
     where day = v_day and language = v_track;

    select count(*) into v_done_today
      from attempts a
     where a.user_id = p_user_id
       and a.mode = 'daily'
       and a.challenge_id = any(v_daily_ids);

    -- "Completion, not perfection".
    if v_done_today >= 3 then
      v_completed_daily := true;

      update streaks
         set daily_current = case
               when last_daily_date = v_day then daily_current
               when last_daily_date = v_day - 1 then daily_current + 1
               else 1
             end,
             last_daily_date = v_day
       where user_id = p_user_id;

      update streaks
         set daily_best = greatest(daily_best, daily_current)
       where user_id = p_user_id;
    end if;
  end if;

  select * into v_streaks from streaks where user_id = p_user_id;

  -- ---------------- badges ----------------
  if v_completed_daily then
    v_new_badges := array_append(v_new_badges, 'first-daily');
  end if;
  if v_streaks.daily_current >= 5 then
    v_new_badges := array_append(v_new_badges, 'streak-5');
  end if;
  if v_streaks.daily_current >= 25 then
    v_new_badges := array_append(v_new_badges, 'streak-25');
  end if;
  if v_streaks.daily_current >= 100 then
    v_new_badges := array_append(v_new_badges, 'streak-100');
  end if;
  if v_correct and v_elapsed_ms < 10000 then
    v_new_badges := array_append(v_new_badges, 'speed-10');
  end if;
  if v_streaks.accuracy_current >= 10 then
    v_new_badges := array_append(v_new_badges, 'acc-10');
  end if;

  with awarded as (
    insert into user_badges (user_id, badge_id)
    select p_user_id, unnest(v_new_badges)
    on conflict (user_id, badge_id) do nothing
    returning badge_id
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'description', b.description)),
           '[]'::jsonb
         )
    into v_badges
    from awarded a
    join badges b on b.id = a.badge_id;

  return jsonb_build_object(
    'correct', v_correct,
    'bugLine', v_bug_line,
    'explanation', v_explanation,
    'points', v_points,
    'streaks', jsonb_build_object(
      'dailyCurrent', coalesce(v_streaks.daily_current, 0),
      'dailyBest', coalesce(v_streaks.daily_best, 0),
      'accuracyCurrent', coalesce(v_streaks.accuracy_current, 0),
      'accuracyBest', coalesce(v_streaks.accuracy_best, 0)
    ),
    'newBadges', v_badges,
    'dailyComplete', v_completed_daily
  );
end;
$$;

revoke all on function submit_attempt(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function submit_attempt(uuid, uuid, text, int) to service_role;
