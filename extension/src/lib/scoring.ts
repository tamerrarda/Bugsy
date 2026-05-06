import type { Difficulty } from '../types'

/** Length of one round. The client timer is cosmetic; this is the scoring basis. */
export const ROUND_SECONDS = 60

/** A served challenge older than this can no longer be answered (spec §5.4). */
export const SERVE_TTL_MS = 5 * 60 * 1000

/** `clickedLine: 0` is the sentinel for "the timer ran out, no line was picked". */
export const NO_ANSWER = 0

/**
 * Points for an attempt (spec §4.3).
 *   base      = difficulty × 100
 *   timeBonus = remainingSeconds × 2
 *   wrong     = 0 (never negative)
 *
 * `elapsedMs` is server-computed (`now - served_at`). Answers submitted after
 * the round length earn the base points only — the bonus floors at zero rather
 * than going negative.
 */
export function computePoints(args: {
  correct: boolean
  difficulty: Difficulty
  elapsedMs: number
}): number {
  if (!args.correct) return 0

  const elapsedSeconds = Math.floor(Math.max(0, args.elapsedMs) / 1000)
  const remainingSeconds = Math.max(0, ROUND_SECONDS - elapsedSeconds)

  return args.difficulty * 100 + remainingSeconds * 2
}
