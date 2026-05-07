import { describe, expect, it } from 'vitest'
import { liveDailyStreak, type StreakState } from './streaks'

function state(overrides: Partial<StreakState> = {}): StreakState {
  return {
    dailyCurrent: 12,
    dailyBest: 30,
    accuracyCurrent: 0,
    accuracyBest: 0,
    lastDailyDate: '2026-07-13',
    ...overrides,
  }
}

const TODAY = '2026-07-13'

describe('liveDailyStreak', () => {
  it('keeps the streak when the last daily was today', () => {
    expect(liveDailyStreak(state({ lastDailyDate: TODAY }), TODAY)).toBe(12)
  })

  it('keeps the streak when the last daily was yesterday — the day is not over', () => {
    expect(liveDailyStreak(state({ lastDailyDate: '2026-07-12' }), TODAY)).toBe(12)
  })

  it('shows zero once a whole UTC day has been missed', () => {
    // The stored daily_current is still 12 — the server only resets it on the
    // next attempt. Showing 12 here would promise a streak that is already gone,
    // and the player would only find out after playing.
    expect(liveDailyStreak(state({ lastDailyDate: '2026-07-11' }), TODAY)).toBe(0)
  })

  it('shows zero for someone who has never finished a daily', () => {
    expect(liveDailyStreak(state({ lastDailyDate: null, dailyCurrent: 0 }), TODAY)).toBe(0)
  })

  it('handles a month boundary without breaking the chain', () => {
    expect(liveDailyStreak(state({ lastDailyDate: '2026-06-30' }), '2026-07-01')).toBe(12)
  })

  it('handles a year boundary without breaking the chain', () => {
    expect(liveDailyStreak(state({ lastDailyDate: '2025-12-31' }), '2026-01-01')).toBe(12)
  })

  it('breaks across a month boundary when a day really was missed', () => {
    expect(liveDailyStreak(state({ lastDailyDate: '2026-06-29' }), '2026-07-01')).toBe(0)
  })
})
