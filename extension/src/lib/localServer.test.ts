import { beforeEach, describe, expect, it } from 'vitest'
import type { Challenge } from '../types'
import type { BugsyApi, PracticeFilters } from './api'
import { ServerError, createLocalServer, guestHasPractice, guestLanguages } from './localServer'
import { NO_ANSWER, SERVE_TTL_MS } from './scoring'
import { createMemoryStatsStore } from './storage'

const CHALLENGE: Challenge = {
  id: '11111111-1111-4111-8111-111111111111',
  language: 'javascript',
  difficulty: 2,
  category: 'off-by-one',
  code: 'function f(a) {\n  return a[a.length];\n}',
  bugLine: 2,
  explanation: 'Reads one past the end.',
  source: 'handwritten',
  active: true,
}

const OTHER: Challenge = { ...CHALLENGE, id: '22222222-2222-4222-8222-222222222222', bugLine: 1 }

/**
 * Lets each test drive the server's clock instead of waiting on a real one, and
 * gives it a private stats store so streaks can't leak between tests.
 */
function serverAt(clock: { ms: number }, challenges: Challenge[] = [CHALLENGE]): BugsyApi {
  return createLocalServer({
    challenges,
    now: () => clock.ms,
    stats: createMemoryStatsStore(),
  })
}

describe('getPractice', () => {
  let clock: { ms: number }

  beforeEach(() => {
    clock = { ms: 1_000_000 }
  })

  it('never hands out the answer', async () => {
    const served = await serverAt(clock).getPractice()

    // The runtime guard behind the type-level one: an object literal that
    // accidentally spread the full Challenge would still typecheck as a
    // PublicChallenge, so assert on the actual keys.
    expect(Object.keys(served).sort()).toEqual([
      'category',
      'code',
      'difficulty',
      'id',
      'language',
    ])
    expect(served).not.toHaveProperty('bugLine')
    expect(served).not.toHaveProperty('explanation')
  })

  it('honours the language filter', async () => {
    const python: Challenge = { ...OTHER, language: 'python' }
    const served = await serverAt(clock, [CHALLENGE, python]).getPractice({ language: 'python' })

    expect(served.id).toBe(python.id)
    expect(served.language).toBe('python')
  })

  it('rejects a filter that matches nothing', async () => {
    await expect(serverAt(clock).getPractice({ language: 'python' })).rejects.toThrow(ServerError)
  })

  it('skips a challenge already played this session, then recycles once the pool is dry', async () => {
    const api = serverAt(clock, [CHALLENGE, OTHER])

    const first = await api.getPractice()
    await api.submitAttempt({ challengeId: first.id, mode: 'practice', clickedLine: 1 })

    const second = await api.getPractice()
    expect(second.id).not.toBe(first.id)
    await api.submitAttempt({ challengeId: second.id, mode: 'practice', clickedLine: 1 })

    // Both played: rather than dead-ending, it serves something again.
    const third = await api.getPractice()
    expect([first.id, second.id]).toContain(third.id)
    await expect(
      api.submitAttempt({ challengeId: third.id, mode: 'practice', clickedLine: 1 }),
    ).resolves.toBeDefined()
  })
})

describe('submitAttempt', () => {
  let clock: { ms: number }
  let api: BugsyApi

  beforeEach(async () => {
    clock = { ms: 1_000_000 }
    api = serverAt(clock)
    await api.getPractice()
  })

  it('grades a correct pick and reveals the answer', async () => {
    const result = await api.submitAttempt({
      challengeId: CHALLENGE.id,
      mode: 'practice',
      clickedLine: 2,
    })

    expect(result.correct).toBe(true)
    expect(result.bugLine).toBe(2)
    expect(result.explanation).toBe(CHALLENGE.explanation)
    expect(result.points).toBe(200 + 120) // d2, answered instantly
  })

  it('grades a wrong pick, still revealing the answer', async () => {
    const result = await api.submitAttempt({
      challengeId: CHALLENGE.id,
      mode: 'practice',
      clickedLine: 1,
    })

    expect(result.correct).toBe(false)
    expect(result.bugLine).toBe(2)
    expect(result.points).toBe(0)
  })

  it('scores from the server clock, not the client timer', async () => {
    clock.ms += 25_000

    const result = await api.submitAttempt({
      challengeId: CHALLENGE.id,
      mode: 'practice',
      clickedLine: 2,
    })

    expect(result.points).toBe(200 + (60 - 25) * 2)
  })

  it('treats a timeout (line 0) as a wrong answer, not an error', async () => {
    const result = await api.submitAttempt({
      challengeId: CHALLENGE.id,
      mode: 'practice',
      clickedLine: NO_ANSWER,
    })

    expect(result.correct).toBe(false)
    expect(result.points).toBe(0)
    expect(result.bugLine).toBe(2)
  })

  it('rejects a second attempt at the same challenge', async () => {
    await api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: 1 })

    await expect(
      api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: 2 }),
    ).rejects.toThrow(/already answered/i)
  })

  it('rejects an attempt at a challenge that was never served', async () => {
    const fresh = serverAt(clock)

    await expect(
      fresh.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: 2 }),
    ).rejects.toThrow(/never served/i)
  })

  it('rejects an attempt after the serve TTL expires', async () => {
    clock.ms += SERVE_TTL_MS + 1

    await expect(
      api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: 2 }),
    ).rejects.toThrow(/expired/i)
  })

  it('rejects a line number outside the snippet', async () => {
    await expect(
      api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: 99 }),
    ).rejects.toThrow(/not in this snippet/i)
  })

  it('rejects a negative line number', async () => {
    await expect(
      api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'practice', clickedLine: -1 }),
    ).rejects.toThrow(/not in this snippet/i)
  })

  it('refuses daily mode for guests — it is scored, so it needs an account', async () => {
    await expect(
      api.submitAttempt({ challengeId: CHALLENGE.id, mode: 'daily', clickedLine: 2 }),
    ).rejects.toThrow(/sign in/i)
  })
})

describe('guest pool availability', () => {
  // A pool shaped like the real one: a couple of languages, gaps in the
  // difficulty matrix, and one retired snippet that must count for nothing.
  const jsMedium = CHALLENGE // javascript, difficulty 2
  const pyEasy: Challenge = {
    ...CHALLENGE,
    id: '33333333-3333-4333-8333-333333333333',
    language: 'python',
    difficulty: 1,
  }
  const rustRetired: Challenge = {
    ...CHALLENGE,
    id: '44444444-4444-4444-8444-444444444444',
    language: 'rust',
    active: false,
  }
  const pool = [pyEasy, jsMedium, rustRetired]

  it('lists only languages the pool holds, in LANGUAGES order', () => {
    // python is first in the pool but javascript comes first in LANGUAGES; the
    // filter dropdown should follow the canonical order, not file order.
    expect(guestLanguages(pool)).toEqual(['javascript', 'python'])
  })

  it('a retired snippet does not put its language on offer', () => {
    expect(guestLanguages(pool)).not.toContain('rust')
  })

  const cases: { filters: PracticeFilters; expected: boolean }[] = [
    { filters: {}, expected: true },
    { filters: { language: 'javascript' }, expected: true },
    { filters: { language: 'java' }, expected: false },
    { filters: { language: 'rust' }, expected: false }, // exists but retired
    { filters: { difficulty: 1 }, expected: true },
    { filters: { difficulty: 3 }, expected: false },
    { filters: { language: 'python', difficulty: 1 }, expected: true },
    { filters: { language: 'python', difficulty: 2 }, expected: false },
    { filters: { language: 'javascript', difficulty: 2 }, expected: true },
  ]

  for (const { filters, expected } of cases) {
    it(`hasPractice(${JSON.stringify(filters)}) -> ${expected}`, () => {
      expect(guestHasPractice(filters, pool)).toBe(expected)
    })
  }

  it('the real bundled pool serves at least one language', () => {
    // The seed script refuses to emit an empty guest pool; this catches the
    // bundle and the seed rule drifting apart.
    expect(guestLanguages().length).toBeGreaterThan(0)
  })
})

describe('accuracy streak', () => {
  it('counts consecutive correct answers and resets on a miss', async () => {
    const clock = { ms: 1_000_000 }
    // A single-challenge pool keeps getPractice deterministic; the recycling
    // path re-serves it, so the same snippet can be graded each round.
    const api = serverAt(clock, [CHALLENGE])

    // CHALLENGE.bugLine is 2, so clicking 2 is correct and 1 is a miss.
    const answer = async (clickedLine: number) => {
      const served = await api.getPractice()
      return api.submitAttempt({ challengeId: served.id, mode: 'practice', clickedLine })
    }

    expect((await answer(2)).streaks.accuracyCurrent).toBe(1)
    expect((await answer(2)).streaks.accuracyCurrent).toBe(2)
    expect((await answer(2)).streaks.accuracyCurrent).toBe(3)

    const miss = await answer(1)
    expect(miss.streaks.accuracyCurrent).toBe(0)
    // A miss resets the current streak but must not erase the best.
    expect(miss.streaks.accuracyBest).toBe(3)

    // And the streak rebuilds from zero afterwards.
    const rebuilt = await answer(2)
    expect(rebuilt.streaks.accuracyCurrent).toBe(1)
    expect(rebuilt.streaks.accuracyBest).toBe(3)
  })
})
