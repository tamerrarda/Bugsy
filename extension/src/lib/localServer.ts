/**
 * The GUEST implementation of BugsyApi.
 *
 * Guests play Practice without an account, which means their
 * challenges must be answerable with no server — so their answers ship inside the
 * extension bundle. That is safe only because of a hard rule enforced in
 * scripts/seed.ts: the bundle contains ONLY the guest pool, and no guest snippet
 * is ever inserted into the database. A guest earns no points and appears on no
 * leaderboard, so knowing an answer here buys nothing. The scored pool's answers
 * live exclusively on the server and never come near this file.
 *
 * Signed-in players get serverApi.ts instead, and never touch this code.
 *
 * It mirrors the real server's rules so both implementations behave alike:
 *   - the answer is never handed out before an attempt is submitted
 *   - timing is measured from `servedAt`, set when the challenge is served;
 *     the on-screen timer is cosmetic and its value is never trusted
 *   - a challenge that was never served, or served over SERVE_TTL_MS ago,
 *     cannot be answered
 *   - one attempt per (challenge, mode)
 */
import { LANGUAGES } from '../types'
import type {
  AttemptResult,
  Challenge,
  Language,
  PublicChallenge,
  Streaks,
  SubmitAttemptRequest,
} from '../types'
import type { BugsyApi, PracticeFilters } from './api'
import { NO_ANSWER, SERVE_TTL_MS, computePoints } from './scoring'
import { persistentStatsStore, type StatsStore } from './storage'

// Generated from content/ by `scripts/seed.ts --emit` (runs automatically via
// the pre-dev / pre-build / pre-test npm hooks).
import generated from '../generated/challenges.json'

const CHALLENGES = generated as Challenge[]

export class ServerError extends Error {}

/** Strips the answer fields. The compiler enforces the shape; this enforces the value. */
function toPublic(challenge: Challenge): PublicChallenge {
  return {
    id: challenge.id,
    language: challenge.language,
    difficulty: challenge.difficulty,
    category: challenge.category,
    code: challenge.code,
  }
}

export function lineCount(code: string): number {
  return code.split('\n').length
}

/**
 * What the bundled guest pool can actually serve.
 *
 * The home screen builds its Practice filters from these when the player is a
 * guest, instead of from the full LANGUAGES list. With five bundled snippets
 * most of the language × difficulty matrix is empty, and a filter option that
 * matches nothing dead-ends in "Bugsy has no snippets matching that filter." —
 * the same rudeness TrackPicker exists to avoid for daily tracks. Signed-in
 * players keep the full list; the server pool covers every language.
 */
export function guestLanguages(challenges: Challenge[] = CHALLENGES): Language[] {
  const present = new Set(
    challenges.filter((c) => c.active).map((c) => c.language),
  )
  return LANGUAGES.filter((language) => present.has(language))
}

/** Whether the guest pool holds at least one active snippet matching the filter. */
export function guestHasPractice(
  filters: PracticeFilters,
  challenges: Challenge[] = CHALLENGES,
): boolean {
  return challenges.some(
    (c) =>
      c.active &&
      (filters.language === undefined || c.language === filters.language) &&
      (filters.difficulty === undefined || c.difficulty === filters.difficulty),
  )
}

export interface LocalServerDeps {
  challenges?: Challenge[]
  now?: () => number
  stats?: StatsStore
}

export function createLocalServer(deps: LocalServerDeps = {}): BugsyApi {
  const challenges = deps.challenges ?? CHALLENGES
  const now = deps.now ?? (() => Date.now())
  const stats = deps.stats ?? persistentStatsStore

  /** challengeId -> when we served it. The server's clock, not the client's. */
  const servedAt = new Map<string, number>()
  /** `${challengeId}:${mode}` — stands in for the DB's unique constraint. */
  const attempted = new Set<string>()

  const byId = new Map(challenges.map((c) => [c.id, c]))

  async function getPractice(filters: PracticeFilters = {}): Promise<PublicChallenge> {
    const matching = challenges.filter(
      (c) =>
        c.active &&
        (filters.language === undefined || c.language === filters.language) &&
        (filters.difficulty === undefined || c.difficulty === filters.difficulty),
    )
    if (matching.length === 0) {
      throw new ServerError('Bugsy has no snippets matching that filter.')
    }

    const unplayed = matching.filter((c) => !attempted.has(`${c.id}:practice`))

    // With only 10 snippets in M1 the pool runs dry fast. Rather than
    // dead-ending, recycle: once everything matching the filter has been played
    // this session, allow repeats. The real `get-practice` picks against the
    // user's stored attempt history instead of a session-local set.
    const recycling = unplayed.length === 0
    const candidates = recycling ? matching : unplayed

    const picked = candidates[Math.floor(Math.random() * candidates.length)]!

    if (recycling) {
      attempted.delete(`${picked.id}:practice`)
    }

    servedAt.set(picked.id, now())
    return toPublic(picked)
  }

  async function submitAttempt(req: SubmitAttemptRequest): Promise<AttemptResult> {
    // Daily is a scored, ranked mode, so it requires an account.
    // A guest reaching here means the UI let them, which would be a bug.
    if (req.mode === 'daily') {
      throw new ServerError('Sign in with GitHub to play the daily challenge.')
    }

    const challenge = byId.get(req.challengeId)
    if (!challenge) throw new ServerError('Unknown challenge.')

    const served = servedAt.get(req.challengeId)
    if (served === undefined) {
      throw new ServerError('That challenge was never served.')
    }

    // The duplicate check must come before the TTL check: a challenge answered
    // an hour ago is "already answered", not "expired", and answering twice is
    // the case that actually matters. This mirrors the DB, where `served_at`
    // persists on the row and the unique (user, challenge, mode) constraint is
    // what rejects the second insert.
    const key = `${req.challengeId}:${req.mode}`
    if (attempted.has(key)) {
      throw new ServerError('You already answered this one.')
    }

    const elapsedMs = now() - served
    if (elapsedMs > SERVE_TTL_MS) {
      throw new ServerError('That challenge expired. Grab a fresh one.')
    }

    // NO_ANSWER (0) means the timer ran out without a pick. Any other
    // out-of-range line is a malformed request.
    const max = lineCount(challenge.code)
    if (req.clickedLine !== NO_ANSWER && (req.clickedLine < 1 || req.clickedLine > max)) {
      throw new ServerError(`Line ${req.clickedLine} is not in this snippet.`)
    }

    attempted.add(key)

    const correct = req.clickedLine === challenge.bugLine
    const points = computePoints({ correct, difficulty: challenge.difficulty, elapsedMs })

    return {
      correct,
      bugLine: challenge.bugLine,
      explanation: challenge.explanation,
      points,
      streaks: await updateAccuracyStreak(correct),
      // Guests earn no badges and have no daily: both are account-scoped, and
      // both are awarded server-side inside the attempt transaction.
      newBadges: [],
      dailyComplete: false,
    }
  }

  /**
   * Practice-mode accuracy streak, kept locally. Guests may play Practice
   * without an account, so this streak is local-only and carries no
   * leaderboard weight. Daily streaks are server-computed in M3.
   */
  async function updateAccuracyStreak(correct: boolean): Promise<Streaks> {
    const previous = await stats.get()

    const accuracyCurrent = correct ? previous.accuracyCurrent + 1 : 0
    const accuracyBest = Math.max(previous.accuracyBest, accuracyCurrent)

    await stats.set({ accuracyCurrent, accuracyBest })

    return { dailyCurrent: 0, dailyBest: 0, accuracyCurrent, accuracyBest }
  }

  /**
   * Guests cannot play Daily. It is scored, ranked and shared, so it needs an
   * account — and its snippets live only on the server anyway, which is exactly
   * what stops a guest from ever seeing an answer they could later cash in.
   */
  async function getDaily(_language: Language): Promise<never> {
    throw new ServerError('Sign in with GitHub to play the daily challenge.')
  }

  return { getPractice, getDaily, submitAttempt }
}

export const localServer: BugsyApi = createLocalServer()
