-- submit_attempt, aware of the full 31-badge catalogue.
--
-- Everything below still happens inside the ONE transaction that inserts the
-- attempt. A badge that is "almost" awarded is worse than no badge at all.
--
-- The counting query runs only when the answer was right: every volume,
-- language and category badge needs a correct answer to move, and the
-- thresholds only ever go up, so a wrong answer cannot newly cross one. Wrong
-- answers therefore stay exactly as cheap as they were.

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
  v_language text;

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
  v_right_today int;
  v_completed_daily boolean := false;

  -- Career totals, counted once, only when the answer was right.
  v_total_correct int := 0;
  v_hard_correct int := 0;
  v_langs int := 0;
  v_cats int := 0;
  v_all_langs int;
  v_all_cats int;

  v_new_badges text[] := '{}';
  v_badges jsonb;
begin
  if p_mode not in ('daily', 'practice') then
    raise exception 'unknown mode' using errcode = 'BG004';
  end if;

  select bug_line, difficulty, explanation, language,
         array_length(string_to_array(code, E'\n'), 1)
    into v_bug_line, v_difficulty, v_explanation, v_language, v_line_count
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
    select daily_language into v_track from profiles where id = p_user_id;

    select challenge_ids into v_daily_ids
      from daily_sets
     where day = v_day and language = v_track;

    select count(*), count(*) filter (where a.correct)
      into v_done_today, v_right_today
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

  -- ---------------- career totals ----------------
  if v_correct then
    -- One pass over this player's attempts. The attempt just inserted is
    -- already visible to it, so the counts include it.
    select count(*),
           count(*) filter (where c.difficulty = 3),
           count(distinct c.language),
           count(distinct c.category)
      into v_total_correct, v_hard_correct, v_langs, v_cats
      from attempts a
      join challenges c on c.id = a.challenge_id
     where a.user_id = p_user_id and a.correct;

    -- Measured against what we actually serve, not a hardcoded 8. Add a ninth
    -- language and Polyglot means "all nine" from that moment on, rather than
    -- quietly becoming a weaker badge than the one earlier players hold.
    select count(distinct language), count(distinct category)
      into v_all_langs, v_all_cats
      from challenges
     where active;
  end if;

  -- ---------------- badges ----------------
  -- Daily
  if v_completed_daily then
    v_new_badges := array_append(v_new_badges, 'first-daily');
  end if;
  if v_completed_daily and v_right_today >= 3 then
    v_new_badges := array_append(v_new_badges, 'daily-perfect');
  end if;
  if v_streaks.daily_current >= 5   then v_new_badges := array_append(v_new_badges, 'streak-5');   end if;
  if v_streaks.daily_current >= 10  then v_new_badges := array_append(v_new_badges, 'streak-10');  end if;
  if v_streaks.daily_current >= 25  then v_new_badges := array_append(v_new_badges, 'streak-25');  end if;
  if v_streaks.daily_current >= 50  then v_new_badges := array_append(v_new_badges, 'streak-50');  end if;
  if v_streaks.daily_current >= 100 then v_new_badges := array_append(v_new_badges, 'streak-100'); end if;
  if v_streaks.daily_current >= 365 then v_new_badges := array_append(v_new_badges, 'streak-365'); end if;

  -- Speed. Server-measured; a client claiming it was fast is not evidence.
  if v_correct and v_elapsed_ms < 10000 then
    v_new_badges := array_append(v_new_badges, 'speed-10');
  end if;
  if v_correct and v_elapsed_ms < 5000 then
    v_new_badges := array_append(v_new_badges, 'speed-5');
  end if;
  if v_correct and v_difficulty = 3 and v_elapsed_ms < 15000 then
    v_new_badges := array_append(v_new_badges, 'speed-hard');
  end if;

  -- Practice streak
  if v_streaks.accuracy_current >= 10 then v_new_badges := array_append(v_new_badges, 'acc-10'); end if;
  if v_streaks.accuracy_current >= 25 then v_new_badges := array_append(v_new_badges, 'acc-25'); end if;
  if v_streaks.accuracy_current >= 50 then v_new_badges := array_append(v_new_badges, 'acc-50'); end if;

  -- Bugs squashed
  if v_total_correct >= 1   then v_new_badges := array_append(v_new_badges, 'solved-1');   end if;
  if v_total_correct >= 10  then v_new_badges := array_append(v_new_badges, 'solved-10');  end if;
  if v_total_correct >= 50  then v_new_badges := array_append(v_new_badges, 'solved-50');  end if;
  if v_total_correct >= 100 then v_new_badges := array_append(v_new_badges, 'solved-100'); end if;
  if v_total_correct >= 250 then v_new_badges := array_append(v_new_badges, 'solved-250'); end if;

  -- Hard bugs
  if v_hard_correct >= 10 then v_new_badges := array_append(v_new_badges, 'hard-10'); end if;
  if v_hard_correct >= 50 then v_new_badges := array_append(v_new_badges, 'hard-50'); end if;

  -- Languages. One badge per language, earned by the answer that just landed.
  if v_correct then
    v_new_badges := array_append(v_new_badges, 'lang-' || v_language);
  end if;

  -- Mastery
  if v_correct and v_langs >= v_all_langs then
    v_new_badges := array_append(v_new_badges, 'polyglot');
  end if;
  if v_correct and v_cats >= v_all_cats then
    v_new_badges := array_append(v_new_badges, 'entomologist');
  end if;

  -- `on conflict do nothing` + `returning` means newBadges holds exactly the
  -- badges earned by THIS attempt, so the extension celebrates once and never
  -- re-congratulates. The join to `badges` also drops any id with no catalogue
  -- row, which is what keeps a stray 'lang-<something>' from being awarded.
  with awarded as (
    insert into user_badges (user_id, badge_id)
    select p_user_id, b.id
      from unnest(v_new_badges) as n(id)
      join badges b on b.id = n.id
    on conflict (user_id, badge_id) do nothing
    returning badge_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', b.id, 'name', b.name, 'description', b.description, 'icon', b.icon
             )
             order by b.sort
           ),
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
