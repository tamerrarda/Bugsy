/**
 * POST /submit-attempt   (auth required)
 *
 * Body: { challengeId, mode, clickedLine }
 * Returns: { correct, bugLine, explanation, points, streaks, newBadges }
 *
 * This is the ONLY place the true bug line and the explanation are ever revealed
 * (spec §5.4). The grading, scoring, attempt insert and streak update all happen
 * inside the `submit_attempt` database function, in one transaction.
 *
 * Note what this function does NOT take from the client: no user id (it comes
 * from the verified JWT), no elapsed time (the server computes it from
 * served_at), no correctness flag. The client only says which line it clicked.
 */
import { admin, dbError, json, preflight, requireUser } from '../_shared/http.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const user = await requireUser(req)
  if (!user) return json({ error: 'Sign in to play.' }, 401)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'Malformed body.' }, 400)

  const { challengeId, mode, clickedLine } = body as Record<string, unknown>

  if (typeof challengeId !== 'string' || !UUID_RE.test(challengeId)) {
    return json({ error: 'challengeId must be a uuid.' }, 400)
  }
  if (mode !== 'daily' && mode !== 'practice') {
    return json({ error: 'mode must be daily or practice.' }, 400)
  }
  // 0 is the "timer ran out" sentinel; the range check against the actual
  // snippet happens in the database, which is the only thing that knows the code.
  if (typeof clickedLine !== 'number' || !Number.isInteger(clickedLine) || clickedLine < 0) {
    return json({ error: 'clickedLine must be a non-negative integer.' }, 400)
  }

  const { data, error } = await admin.rpc('submit_attempt', {
    p_user_id: user.id,
    p_challenge_id: challengeId,
    p_mode: mode,
    p_clicked_line: clickedLine,
  })

  if (error) return dbError(error)

  return json(data)
})
