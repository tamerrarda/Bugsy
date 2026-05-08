import { LANGUAGE_LABEL, type Language } from '../types'

/**
 * The Wordle-style share card (spec §2.1). This is the viral mechanic, so it is a
 * pure function with tests rather than string-building buried in a component.
 *
 *   Bugsy #47 [rust] 🐛
 *   🟩🟩🟥  2/3
 *   🔥 12-day streak
 *   bugsy.dev
 *
 * The TRACK is named on the card, and that is not decoration. The daily is
 * per-language, so "2/3" only means something next to the language it was scored
 * in — without it, a Rust player and a Python player would be comparing grids from
 * entirely different sets of snippets and neither would know.
 */

/** Day 1. The puzzle number is the count of UTC days since this date. */
export const EPOCH = '2026-07-13'

const SITE = 'bugsy.dev'
const HIT = '🟩'
const MISS = '🟥'

const MS_PER_DAY = 86_400_000

/**
 * Which numbered puzzle a given UTC date is. Both sides are parsed as UTC
 * midnight, so this cannot drift by one depending on the reader's timezone —
 * the whole game is keyed to UTC days (spec §2.1).
 */
export function puzzleNumber(day: string): number {
  const then = Date.parse(`${EPOCH}T00:00:00Z`)
  const now = Date.parse(`${day}T00:00:00Z`)

  return Math.floor((now - then) / MS_PER_DAY) + 1
}

export interface ShareInput {
  /** UTC date of the daily, `YYYY-MM-DD`. */
  day: string
  /** The track this daily was played on. */
  language: Language
  /** One entry per challenge, in the order they were played. */
  results: boolean[]
  /** Current daily streak. Omitted from the card when zero. */
  dailyStreak: number
}

export function buildShareText({ day, language, results, dailyStreak }: ShareInput): string {
  const grid = results.map((correct) => (correct ? HIT : MISS)).join('')
  const score = results.filter(Boolean).length

  const lines = [
    `Bugsy #${puzzleNumber(day)} [${LANGUAGE_LABEL[language]}] 🐛`,
    `${grid}  ${score}/${results.length}`,
  ]

  // A zero-day streak is not worth bragging about, and "🔥 0-day streak" reads
  // like a bug rather than a boast.
  if (dailyStreak > 0) {
    lines.push(`🔥 ${dailyStreak}-day streak`)
  }

  lines.push(SITE)

  return lines.join('\n')
}
