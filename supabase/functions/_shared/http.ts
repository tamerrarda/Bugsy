import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * The languages Bugsy runs.
 *
 * Kept in ONE place because it was previously hand-listed in each function, and
 * the copy in get-practice went stale the day the other six languages shipped:
 * the content was there, the daily served it, and Practice answered
 * "Unknown language." to anyone who filtered by Rust.
 *
 * Mirrors extension/src/types/index.ts LANGUAGES and scripts/validate.ts.
 */
export const LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'csharp',
  'c',
  'cpp',
  'rust',
] as const

export function isLanguage(value: unknown): value is (typeof LANGUAGES)[number] {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/**
 * The popup calls these functions from a chrome-extension:// origin, which is
 * opaque to CORS, so the preflight has to be answered explicitly.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS_HEADERS }) : null
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * The privileged client. It bypasses RLS and is the only thing that can read
 * `challenges` (where the answers live) or call the grading functions.
 *
 * It never leaves the server. The extension only ever holds the anon key.
 */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/**
 * Resolves the caller's user id from their JWT, using the ANON key — i.e. we
 * verify the token rather than trusting any user id in the request body. A
 * client-supplied user id would let anyone submit attempts as anyone.
 */
export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return null

  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await scoped.auth.getUser()
  if (error || !data.user) return null

  return { id: data.user.id }
}

/** Maps the grading functions' custom SQLSTATEs onto HTTP status + user-facing copy. */
const ERRORS: Record<string, { status: number; message: string }> = {
  BG001: { status: 409, message: 'That challenge was never served to you.' },
  BG002: { status: 410, message: 'That challenge expired. Grab a fresh one.' },
  BG003: { status: 409, message: 'You already answered this one.' },
  BG004: { status: 400, message: 'That is not a line in this snippet.' },
  BG005: { status: 404, message: 'Bugsy has never heard of that challenge.' },
  BG006: { status: 404, message: 'Bugsy has no snippets matching that filter.' },
  BG007: { status: 503, message: "Bugsy hasn't written enough snippets for today yet." },
}

export function dbError(error: { code?: string; message?: string }): Response {
  const known = error.code ? ERRORS[error.code] : undefined
  if (known) return json({ error: known.message, code: error.code }, known.status)

  // Never echo a raw Postgres error to the client: it can carry column names,
  // constraint names, even row values.
  console.error('unexpected db error', error)
  return json({ error: 'Something came apart on our side.' }, 500)
}
