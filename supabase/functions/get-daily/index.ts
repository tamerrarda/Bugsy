/**
 * GET /get-daily?language=   (auth required)
 *
 * Response: { day, language, challenges: [...], attempts: [...today's attempts] }
 *
 * The daily is a per-language TRACK (spec §2.1). Everyone on the same track gets
 * the same three snippets that day — generated server-side, so there is nothing to
 * shop around for (anti-cheat rule 4) — and the shareable emoji grid stays
 * comparable, because the people you compare yourself to solved the same three.
 *
 * bug_line and explanation are stripped from `challenges`, and appear in
 * `attempts` only for challenges this user has already answered.
 */
import { admin, dbError, isLanguage, json, preflight, requireUser } from '../_shared/http.ts'

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors

  const user = await requireUser(req)
  if (!user) return json({ error: 'Sign in to play the daily challenge.' }, 401)

  const url = new URL(req.url)
  let language = url.searchParams.get('language')

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    language = language ?? body.language ?? null
  }

  // No track chosen yet: fall back to the one they last played, if any. The popup
  // asks before the first daily, so this only ever fires for a returning player.
  if (!language) {
    const { data } = await admin
      .from('profiles')
      .select('daily_language')
      .eq('id', user.id)
      .single()

    language = (data?.daily_language as string | null) ?? null
  }

  if (!language) {
    return json({ error: 'Pick a language to play the daily.', code: 'NO_TRACK' }, 400)
  }

  if (!isLanguage(language)) {
    return json({ error: 'Bugsy does not run a daily in that language.' }, 400)
  }

  const { data, error } = await admin.rpc('serve_daily', {
    p_user_id: user.id,
    p_language: language,
  })

  if (error) return dbError(error)

  return json(data)
})
