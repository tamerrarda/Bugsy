import { describe, expect, it } from 'vitest'
import { EPOCH, buildShareText, puzzleNumber } from './share'

describe('puzzleNumber', () => {
  it('starts at 1 on the epoch', () => {
    expect(puzzleNumber(EPOCH)).toBe(1)
  })

  it('counts UTC days', () => {
    expect(puzzleNumber('2026-07-14')).toBe(2)
    expect(puzzleNumber('2026-08-28')).toBe(47)
  })

  it('crosses a month boundary without drifting', () => {
    expect(puzzleNumber('2026-07-31')).toBe(19)
    expect(puzzleNumber('2026-08-01')).toBe(20)
  })

  it('crosses a DST boundary without drifting', () => {
    // Northern-hemisphere clocks change on 2026-10-25. UTC does not, and the
    // puzzle number must not either — a day either side must differ by exactly 1.
    expect(puzzleNumber('2026-10-26') - puzzleNumber('2026-10-25')).toBe(1)
  })

  it('crosses a year boundary', () => {
    expect(puzzleNumber('2027-01-01') - puzzleNumber('2026-12-31')).toBe(1)
  })
})

describe('buildShareText', () => {
  it('renders the spec example', () => {
    const text = buildShareText({
      day: '2026-08-28', // puzzle #47
      language: 'rust',
      results: [true, true, false],
      dailyStreak: 12,
    })

    expect(text).toBe('Bugsy #47 [Rust] 🐛\n🟩🟩🟥  2/3\n🔥 12-day streak\nbugsy.dev')
  })

  it('renders a perfect day', () => {
    const text = buildShareText({ day: EPOCH, language: 'python', results: [true, true, true], dailyStreak: 1 })

    expect(text).toContain('🟩🟩🟩  3/3')
  })

  it('renders a blank day', () => {
    const text = buildShareText({ day: EPOCH, language: 'java', results: [false, false, false], dailyStreak: 3 })

    expect(text).toContain('🟥🟥🟥  0/3')
  })

  it('omits the streak line at zero rather than boasting about nothing', () => {
    const text = buildShareText({ day: EPOCH, language: 'csharp', results: [true, false, true], dailyStreak: 0 })

    expect(text).not.toContain('streak')
    expect(text).toBe('Bugsy #1 [C#] 🐛\n🟩🟥🟩  2/3\nbugsy.dev')
  })

  it('never leaks which lines were the answer', () => {
    // The whole point of an emoji grid: it proves your score without spoiling the
    // puzzle for whoever you send it to.
    const text = buildShareText({ day: EPOCH, language: 'cpp', results: [true, false, true], dailyStreak: 5 })

    expect(text).not.toMatch(/line|\bbug\b|\d{1,2}:/i)
  })
})
