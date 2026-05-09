-- The badge catalogue grows from 6 to 31.
--
-- Every badge here has to be REACHABLE with the content that actually exists,
-- otherwise the "All badges" screen becomes a list of promises we can't keep.
-- The scored pool is 345 snippets (92 of them hard) across 8 languages and 8
-- categories, and a player may answer each snippet once per mode. So:
--   * volume tops out at 250 (not 500 — that would need content we don't have)
--   * hard tops out at 50 (92 exist)
--   * polyglot / entomologist are checked against the LIVE distinct counts in
--     `challenges`, not a hardcoded 8, so adding a 9th language raises the bar
--     for new players instead of leaving a badge that silently means less.
--
-- `family` and `sort` exist purely so the catalogue screen can group and order
-- badges without the client hardcoding a copy of this list.

alter table badges add column if not exists icon   text not null default '🏅';
alter table badges add column if not exists family text not null default 'Bugs squashed';
alter table badges add column if not exists sort   int  not null default 0;

insert into badges (id, name, description, icon, family, sort) values
  -- Daily -------------------------------------------------------------------
  ('first-daily',   'Day One',           'Complete your first daily challenge.',                 '🌱', 'Daily',          100),
  ('streak-5',      'Rookie Hunter',     'Reach a 5-day daily streak.',                          '🔥', 'Daily',          110),
  ('streak-10',     'Habit Formed',      'Reach a 10-day daily streak.',                         '🔥', 'Daily',          120),
  ('streak-25',     'Bug Exterminator',  'Reach a 25-day daily streak.',                         '🧯', 'Daily',          130),
  ('streak-50',     'Half Century',      'Reach a 50-day daily streak.',                         '🏆', 'Daily',          140),
  ('streak-100',    'Linus''s Eye',      'Reach a 100-day daily streak.',                        '👁️', 'Daily',          150),
  ('streak-365',    'Year of the Bug',   'Reach a 365-day daily streak.',                        '🌟', 'Daily',          160),
  ('daily-perfect', 'Flawless Day',      'Get all three of a day''s bugs right.',                '💎', 'Daily',          170),

  -- Speed -------------------------------------------------------------------
  ('speed-10',      'Speed Reader',      'Find a bug in under 10 seconds.',                      '⚡', 'Speed',          200),
  ('speed-5',       'Quickdraw',         'Find a bug in under 5 seconds.',                       '🚀', 'Speed',          210),
  ('speed-hard',    'Cold Read',         'Find a hard bug in under 15 seconds.',                 '🎯', 'Speed',          220),

  -- Practice streak ---------------------------------------------------------
  ('acc-10',        'Sharpshooter',      'Get 10 correct answers in a row in Practice.',         '🏹', 'Practice streak', 300),
  ('acc-25',        'Deadeye',           'Get 25 correct answers in a row in Practice.',         '🦅', 'Practice streak', 310),
  ('acc-50',        'Unerring',          'Get 50 correct answers in a row in Practice.',         '🦉', 'Practice streak', 320),

  -- Bugs squashed -----------------------------------------------------------
  ('solved-1',      'First Blood',       'Squash your first bug.',                               '🐞', 'Bugs squashed',  400),
  ('solved-10',     'Pest Control',      'Squash 10 bugs.',                                      '🧹', 'Bugs squashed',  410),
  ('solved-50',     'Debugger',          'Squash 50 bugs.',                                      '🔍', 'Bugs squashed',  420),
  ('solved-100',    'Centurion',         'Squash 100 bugs.',                                     '💯', 'Bugs squashed',  430),
  ('solved-250',    'Bug Whisperer',     'Squash 250 bugs.',                                     '🧙', 'Bugs squashed',  440),

  -- Hard bugs ---------------------------------------------------------------
  ('hard-10',       'Deep Diver',        'Squash 10 hard bugs.',                                 '🌊', 'Hard bugs',      500),
  ('hard-50',       'Abyss Walker',      'Squash 50 hard bugs.',                                 '🕳️', 'Hard bugs',      510),

  -- Languages ---------------------------------------------------------------
  ('lang-javascript', 'JavaScript',      'Squash a bug in JavaScript.',                          '🟨', 'Languages',      600),
  ('lang-typescript', 'TypeScript',      'Squash a bug in TypeScript.',                          '🟦', 'Languages',      610),
  ('lang-python',     'Python',          'Squash a bug in Python.',                              '🐍', 'Languages',      620),
  ('lang-java',       'Java',            'Squash a bug in Java.',                                '☕', 'Languages',      630),
  ('lang-csharp',     'C#',              'Squash a bug in C#.',                                  '🎼', 'Languages',      640),
  ('lang-c',          'C',               'Squash a bug in C.',                                   '🔧', 'Languages',      650),
  ('lang-cpp',        'C++',             'Squash a bug in C++.',                                 '➕', 'Languages',      660),
  ('lang-rust',       'Rust',            'Squash a bug in Rust.',                                '🦀', 'Languages',      670),

  -- Mastery -----------------------------------------------------------------
  ('polyglot',      'Polyglot',          'Squash a bug in every language Bugsy knows.',          '🌍', 'Mastery',        700),
  ('entomologist',  'Entomologist',      'Squash a bug of every kind Bugsy collects.',           '🦋', 'Mastery',        710)
on conflict (id) do update
  set name        = excluded.name,
      description = excluded.description,
      icon        = excluded.icon,
      family      = excluded.family,
      sort        = excluded.sort;

-- A language badge that doesn't match a language we serve can never be earned.
-- Fail the migration rather than ship a dead badge.
do $$
declare
  v_missing text;
begin
  select string_agg(b.id, ', ') into v_missing
    from badges b
   where b.family = 'Languages'
     and not exists (
       select 1 from challenges c where 'lang-' || c.language = b.id
     );

  -- Only meaningful once content is seeded; an empty challenges table (a fresh
  -- `db reset` before seeding) legitimately matches nothing.
  if v_missing is not null and exists (select 1 from challenges) then
    raise exception 'unearnable language badge(s): %', v_missing;
  end if;
end;
$$;
