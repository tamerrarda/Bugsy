import type {
  AttemptResult,
  DailySet,
  Language,
  LeaderboardPeriod,
  LeaderboardRow,
  PublicChallenge,
  SubmitAttemptRequest,
} from '../types'
import type { BugsyApi, PracticeFilters } from './api'
import { supabase } from './supabase'

/**
 * The real API: the Supabase Edge Functions from spec §5.4.
 *
 * This implements exactly the same `BugsyApi` interface as the Milestone 1
 * localServer, which is why the game UI did not have to change at all when the
 * backend landed. The difference is where the truth lives: nothing in this file
 * knows a bug line, and there is no code path by which it could — the answer only
 * ever arrives inside an AttemptResult, as the response to a submitted attempt.
 */

export class ApiError extends Error {}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // Edge Functions signal failure with a non-2xx status; supabase-js wraps the
    // body in a FunctionsHttpError, so the human-readable message is one level in.
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      const payload = await context.json().catch(() => null)
      if (payload?.error) throw new ApiError(payload.error as string)
    }
    throw new ApiError(error.message || 'Bugsy could not reach the server.')
  }

  return data as T
}

export const serverApi: BugsyApi = {
  async getPractice(filters: PracticeFilters = {}): Promise<PublicChallenge> {
    return invoke<PublicChallenge>('get-practice', {
      ...(filters.language !== undefined ? { language: filters.language } : {}),
      ...(filters.difficulty !== undefined ? { difficulty: filters.difficulty } : {}),
    })
  },

  async getDaily(language: Language): Promise<DailySet> {
    return invoke<DailySet>('get-daily', { language })
  },

  async submitAttempt(req: SubmitAttemptRequest): Promise<AttemptResult> {
    return invoke<AttemptResult>('submit-attempt', {
      challengeId: req.challengeId,
      mode: req.mode,
      clickedLine: req.clickedLine,
    })
  },
}

/**
 * Leaderboards are plain views, read with the anon key straight through
 * PostgREST — no Edge Function needed, because they expose only username,
 * avatar_url, points and rank (spec §5.3). There is nothing to strip.
 */
export async function getLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from(`leaderboard_${period}`)
    .select('username, avatar_url, points, rank')
    .order('rank', { ascending: true })
    .limit(50)

  if (error) throw new ApiError(error.message)

  return (data ?? []).map((row) => ({
    username: row.username as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    points: row.points as number,
    rank: row.rank as number,
  }))
}
