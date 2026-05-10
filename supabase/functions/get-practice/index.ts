/**
 * GET /get-practice?language=&difficulty=   (auth required)
 *
 * Returns one random challenge the user has not attempted, stripped of the
 * answer fields, and stamps served_at for it.
 *
 * The stripping is not done here — `serve_practice` never selects bug_line or
 * explanation in the first place, so there is nothing in this process to leak.
 */
import { admin, dbError, isLanguage, json, preflight, requireUser } from '../_shared/http.ts'

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors

  const user = await requireUser(req)
  if (!user) return json({ error: 'Sign in to play.' }, 401)

  // Accept filters from the query string or a JSON body
  // (what supabase-js `functions.invoke` sends by default).
  const url = new URL(req.url)
  let language = url.searchParams.get('language')
  let difficultyRaw = url.searchParams.get('difficulty')

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    language = language ?? body.language ?? null
    difficultyRaw = difficultyRaw ?? (body.difficulty != null ? String(body.difficulty) : null)
  }

  if (language !== null && !isLanguage(language)) {
    return json({ error: 'Bugsy does not have snippets in that language.' }, 400)
  }

  let difficulty: number | null = null
  if (difficultyRaw !== null && difficultyRaw !== '') {
    difficulty = Number(difficultyRaw)
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
      return json({ error: 'Difficulty must be 1, 2 or 3.' }, 400)
    }
  }

  const { data, error } = await admin.rpc('serve_practice', {
    p_user_id: user.id,
    p_language: language,
    p_difficulty: difficulty,
  })

  if (error) return dbError(error)

  return json(data)
})
