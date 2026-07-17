-- Second hardening pass: close the defaults Postgres hands out for free.
--
-- 1. Trigger functions. `create function` grants EXECUTE to PUBLIC by default,
--    and both of these are SECURITY DEFINER. They return `trigger`, so neither
--    Postgres nor PostgREST will let a client actually call them today — this
--    revoke is belt-and-braces, so their safety no longer depends on that
--    incidental fact. Trigger FIRING is unaffected: EXECUTE is checked when a
--    trigger is created, not when DML fires it.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function broadcast_attempt() from public, anon, authenticated;

-- 2. Table privileges nothing uses. Supabase's defaults leave REFERENCES,
--    TRIGGER and TRUNCATE granted to the client roles on every table. None of
--    them is reachable through PostgREST — but TRUNCATE in particular is not
--    subject to RLS, so if any future path ever lets these roles run SQL, a
--    single statement could empty a table. Strip them everywhere; the server
--    role keeps everything it has.
--
--    NOTE: this covers tables that exist today. A future migration that
--    creates a table gets Supabase's defaults again — repeat the revoke there.
revoke references, trigger, truncate on all tables in schema public from anon, authenticated;
