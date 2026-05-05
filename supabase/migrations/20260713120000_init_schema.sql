-- Bugsy core schema (BUGSY_SPEC.md §5.3).
--
-- Note on `serves`: the spec's table list does not include it, but §5.4 and §5.5
-- require the server to time the round from when the challenge was *served*
-- ("served_at is written when the challenge is fetched; the client timer is
-- cosmetic"). That timestamp has to live somewhere durable, so it gets a table.

create extension if not exists "pgcrypto";

-- profiles ------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,        -- from GitHub login
  avatar_url text,
  created_at timestamptz not null default now()
);

-- challenges ----------------------------------------------------------------
create table challenges (
  id uuid primary key default gen_random_uuid(),
  language text not null,
  difficulty int not null check (difficulty between 1 and 3),
  category text not null,
  code text not null,
  bug_line int not null check (bug_line >= 1),
  explanation text not null,
  source text not null default 'handwritten',
  active boolean not null default true
);

-- Used by get-practice / get-daily to pick from the active pool.
create index challenges_pick_idx on challenges (active, language, difficulty);

-- daily_sets ----------------------------------------------------------------
create table daily_sets (
  day date primary key,                  -- UTC date
  challenge_ids uuid[] not null,
  constraint daily_sets_exactly_three check (array_length(challenge_ids, 1) = 3)
);

-- serves --------------------------------------------------------------------
-- The server's clock. Written when a challenge is handed to a user; read by
-- submit-attempt to compute elapsed_ms. Never exposed to the client.
create table serves (
  user_id uuid not null references profiles on delete cascade,
  challenge_id uuid not null references challenges on delete cascade,
  mode text not null check (mode in ('daily', 'practice')),
  served_at timestamptz not null default now(),
  primary key (user_id, challenge_id, mode)
);

-- attempts ------------------------------------------------------------------
create table attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  challenge_id uuid not null references challenges on delete cascade,
  mode text not null check (mode in ('daily', 'practice')),
  -- 0 means "the timer ran out, no line was picked" (spec §5.4). Any other
  -- value must be a real 1-indexed line, which submit-attempt range-checks
  -- against the snippet.
  clicked_line int not null check (clicked_line >= 0),
  correct boolean not null,
  elapsed_ms int not null check (elapsed_ms >= 0),   -- server-computed
  points int not null default 0 check (points >= 0), -- never negative (§4.3)
  created_at timestamptz not null default now(),
  unique (user_id, challenge_id, mode)               -- one attempt per challenge per mode
);

create index attempts_leaderboard_idx on attempts (created_at, user_id);
create index attempts_user_idx on attempts (user_id);

-- streaks -------------------------------------------------------------------
create table streaks (
  user_id uuid primary key references profiles on delete cascade,
  daily_current int not null default 0,
  daily_best int not null default 0,
  last_daily_date date,
  accuracy_current int not null default 0,
  accuracy_best int not null default 0
);

-- badges --------------------------------------------------------------------
create table badges (
  id text primary key,                   -- 'streak-5' etc.
  name text not null,
  description text not null
);

create table user_badges (
  user_id uuid not null references profiles on delete cascade,
  badge_id text not null references badges,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- new user -> profile + streaks ---------------------------------------------
-- Spec §7.7: "profiles row on first login". A trigger is more reliable than
-- doing it client-side, which would leave a user with no profile if the popup
-- closed mid-login.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  candidate text;
  suffix int := 0;
begin
  base_name := coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    split_part(coalesce(new.email, ''), '@', 1),
    'bugsy'
  );
  base_name := nullif(regexp_replace(base_name, '[^a-zA-Z0-9_-]', '', 'g'), '');
  base_name := coalesce(base_name, 'bugsy');

  -- username is unique; two GitHub accounts can still collide after stripping,
  -- so walk until a free name is found rather than failing the signup.
  candidate := base_name;
  while exists (select 1 from profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := base_name || '-' || suffix::text;
  end loop;

  insert into profiles (id, username, avatar_url)
  values (new.id, candidate, new.raw_user_meta_data ->> 'avatar_url');

  insert into streaks (user_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
