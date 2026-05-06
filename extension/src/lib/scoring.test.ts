import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../types'
import { ROUND_SECONDS, computePoints } from './scoring'

describe('computePoints', () => {
  const cases: {
    name: string
    correct: boolean
    difficulty: Difficulty
    elapsedMs: number
    expected: number
  }[] = [
    // base = difficulty × 100, bonus = remainingSeconds × 2
    { name: 'instant d1', correct: true, difficulty: 1, elapsedMs: 0, expected: 100 + 120 },
    { name: 'instant d2', correct: true, difficulty: 2, elapsedMs: 0, expected: 200 + 120 },
    { name: 'instant d3', correct: true, difficulty: 3, elapsedMs: 0, expected: 300 + 120 },
    { name: 'half a round, d2', correct: true, difficulty: 2, elapsedMs: 30_000, expected: 200 + 60 },
    { name: 'one second left', correct: true, difficulty: 1, elapsedMs: 59_000, expected: 100 + 2 },

    // Sub-second precision is floored, so the bonus only ticks down on whole seconds.
    { name: 'partial second floors', correct: true, difficulty: 1, elapsedMs: 1_999, expected: 100 + 118 },

    // The bonus floors at zero rather than going negative.
    { name: 'exactly at the buzzer', correct: true, difficulty: 3, elapsedMs: ROUND_SECONDS * 1000, expected: 300 },
    { name: 'well past the buzzer', correct: true, difficulty: 3, elapsedMs: 240_000, expected: 300 },

    // Wrong answers never score, and never go negative (spec §4.3).
    { name: 'wrong, fast', correct: false, difficulty: 3, elapsedMs: 0, expected: 0 },
    { name: 'wrong, slow', correct: false, difficulty: 1, elapsedMs: 120_000, expected: 0 },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(
        computePoints({ correct: c.correct, difficulty: c.difficulty, elapsedMs: c.elapsedMs }),
      ).toBe(c.expected)
    })
  }

  it('never returns a negative score for a nonsensical clock', () => {
    expect(computePoints({ correct: true, difficulty: 1, elapsedMs: -5_000 })).toBe(100 + 120)
  })
})
