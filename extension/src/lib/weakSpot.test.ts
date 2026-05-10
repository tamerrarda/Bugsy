import { describe, expect, it } from 'vitest'
import { weakest } from './weakSpot'

describe('weakest', () => {
  it('is null when nothing has been missed', () => {
    // The bug this exists to prevent: the profile telling a flawless player
    // "you keep missing async bugs — 100% on 5 tries".
    expect(
      weakest([
        { category: 'async', attempts: 5, correct: 5 },
        { category: 'scope', attempts: 4, correct: 4 },
      ]),
    ).toBeNull()
  })

  it('is null below the 3-attempt floor', () => {
    expect(weakest([{ category: 'async', attempts: 2, correct: 0 }])).toBeNull()
  })

  it('picks the lowest hit rate among categories with a miss', () => {
    const worst = weakest([
      { category: 'async', attempts: 10, correct: 9 },
      { category: 'scope', attempts: 4, correct: 1 },
      { category: 'logic', attempts: 6, correct: 6 },
    ])
    expect(worst?.category).toBe('scope')
  })

  it('ignores a perfect category even when it is the smallest', () => {
    const worst = weakest([
      { category: 'async', attempts: 3, correct: 3 },
      { category: 'scope', attempts: 20, correct: 19 },
    ])
    expect(worst?.category).toBe('scope')
  })

  it('is null for no data', () => {
    expect(weakest([])).toBeNull()
  })
})
