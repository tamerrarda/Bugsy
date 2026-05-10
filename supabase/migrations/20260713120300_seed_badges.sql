-- The badge catalogue. Exactly these six in v1.
-- Idempotent so `supabase db reset` and re-running migrations stay clean.

insert into badges (id, name, description) values
  ('streak-5',    'Rookie Hunter',    'Reach a 5-day daily streak.'),
  ('streak-25',   'Bug Exterminator', 'Reach a 25-day daily streak.'),
  ('streak-100',  'Linus''s Eye',     'Reach a 100-day daily streak.'),
  ('speed-10',    'Speed Reader',     'Find a bug in under 10 seconds.'),
  ('acc-10',      'Sharpshooter',     'Get 10 correct answers in a row in Practice.'),
  ('first-daily', 'Day One',          'Complete your first daily challenge.')
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description;
