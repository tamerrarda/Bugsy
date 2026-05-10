-- The grading core.
--
-- Why a database function and not just TypeScript in the Edge Function: the
-- attempt insert, the scoring and the streak update have to happen in ONE
-- transaction. A Deno function issuing several
-- supabase-js calls is not a transaction — a crash between two of them leaves a
-- scored attempt with no streak update, or vice versa. A plpgsql function is
-- atomic by construction. The Edge Function stays the only entry point: it does
-- auth and request shape, then calls this.
--
-- This function is the ONLY place bug_line is compared against a guess.
-- It runs as SECURITY DEFINER so it can read `challenges`, which is revoked from
-- every client role.

-- Custom SQLSTATEs so the Edge Function can map failures onto HTTP codes
-- without string-matching messages:
--   BG001 challenge was never served to this user
--   BG002 the serve expired (> 5 minutes)
--   BG003 already answered (one attempt per challenge per mode)
--   BG004 clicked_line is not a line in this snippet
--   BG005 unknown / inactive challenge

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

  -- Anti-cheat rule 2: the clock is ours, started when we served the challenge.
  -- Whatever the client's timer says is irrelevant and never even sent.
  select served_at into v_served_at
    from serves
   where user_id = p_user_id and challenge_id = p_challenge_id and mode = p_mode;

  if not found then
    raise exception 'challenge was never served' using errcode = 'BG001';
  end if;

  -- Precedence matters: a challenge answered an hour ago is "already answered",
  -- not "expired". Checking duplicates first also keeps the message honest for a
  -- user who left the popup open.
  if exists (
    select 1 from attempts
     where user_id = p_user_id and challenge_id = p_challenge_id and mode = p_mode
  ) then
    raise exception 'already answered' using errcode = 'BG003';
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_served_at)) * 1000);

  if v_elapsed_ms > 300000 then   -- 5 minutes
    raise exception 'serve expired' using errcode = 'BG002';
  end if;

  -- clicked_line 0 is the "timer ran out, no pick" sentinel.
  if p_clicked_line <> 0 and (p_clicked_line < 1 or p_clicked_line > v_line_count) then
    raise exception 'line % is not in this snippet', p_clicked_line using errcode = 'BG004';
  end if;

  v_correct := (p_clicked_line = v_bug_line);

  -- Scoring: base = difficulty x 100, bonus = remainingSeconds x 2.
  -- Mirrors extension/src/lib/scoring.ts exactly; the bonus floors at zero rather
  -- than going negative.
  if v_correct then
    v_remaining := greatest(0, 60 - floor(v_elapsed_ms / 1000));
    v_points := v_difficulty * 100 + v_remaining * 2;
  else
    v_points := 0;
  end if;

  -- The unique constraint is the real guard; the check above is just for a better
  -- message. Two concurrent submits both reach here, and exactly one inserts.
  insert into attempts (user_id, challenge_id, mode, clicked_line, correct, elapsed_ms, points)
  values (p_user_id, p_challenge_id, p_mode, p_clicked_line, v_correct, v_elapsed_ms, v_points)
  on conflict (user_id, challenge_id, mode) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    raise exception 'already answered' using errcode = 'BG003';
  end if;

  -- Accuracy streak (Practice only). The DAILY streak and the badge
  -- engine are Milestone 3 and are deliberately not implemented here
  -- yet — daily_current / last_daily_date stay untouched, and new_badges is empty.
  if p_mode = 'practice' then
    update streaks
       set accuracy_current = case when v_correct then accuracy_current + 1 else 0 end,
           accuracy_best = greatest(
             accuracy_best,
             case when v_correct then accuracy_current + 1 else 0 end
           )
     where user_id = p_user_id;
  end if;

  select * into v_streaks from streaks where user_id = p_user_id;

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
    'newBadges', '[]'::jsonb
  );
end;
$$;

-- Only the Edge Function (service_role) may call this. Never the client.
-- EXECUTE is granted to PUBLIC by default, so revoking from PUBLIC is what
-- actually locks it down — and it means service_role must then be granted back
-- explicitly, since it inherited its access through PUBLIC.
revoke all on function submit_attempt(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function submit_attempt(uuid, uuid, text, int) to service_role;


-- Serving a challenge: pick from the active pool, avoiding what the user has
-- already attempted, and stamp served_at. Returns the challenge WITHOUT the
-- answer fields (anti-cheat rule 1) — bug_line and explanation are simply not
-- selected, so they cannot be leaked by a careless caller.
create or replace function serve_practice(
  p_user_id uuid,
  p_language text default null,
  p_difficulty int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges%rowtype;
begin
  select c.* into v_challenge
    from challenges c
   where c.active
     and (p_language is null or c.language = p_language)
     and (p_difficulty is null or c.difficulty = p_difficulty)
     and not exists (
       select 1 from attempts a
        where a.user_id = p_user_id
          and a.challenge_id = c.id
          and a.mode = 'practice'
     )
   order by random()
   limit 1;

  if not found then
    raise exception 'no unplayed snippets match that filter' using errcode = 'BG006';
  end if;

  -- Restamp on every serve, so the 60s round always starts now.
  insert into serves (user_id, challenge_id, mode, served_at)
  values (p_user_id, v_challenge.id, 'practice', now())
  on conflict (user_id, challenge_id, mode)
  do update set served_at = now();

  return jsonb_build_object(
    'id', v_challenge.id,
    'language', v_challenge.language,
    'difficulty', v_challenge.difficulty,
    'category', v_challenge.category,
    'code', v_challenge.code
  );
end;
$$;

revoke all on function serve_practice(uuid, text, int) from public, anon, authenticated;
grant execute on function serve_practice(uuid, text, int) to service_role;
