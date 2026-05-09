import { describe, expect, it } from 'vitest'
import catalogueSql from '../../../supabase/migrations/20260713170000_badge_catalogue.sql?raw'
import { BADGE_IDS, LANGUAGES } from '../types'
import { byFamily } from './badges'
import type { BadgeCatalogueEntry } from '../types'

/** The ids the migration actually inserts, read straight from the SQL. */
function seededIds(): string[] {
  const rows = catalogueSql.matchAll(/^\s*\('([a-z0-9-]+)',\s*'/gm)
  return [...rows].map((m) => m[1] as string)
}

describe('badge catalogue', () => {
  // The client's BADGE_IDS and the badges table are two copies of one list. Two
  // copies drift. A badge the server can award but the client has never heard of
  // renders as a nameless tile; catch it here instead of in someone's popup.
  it('BADGE_IDS matches the seeded catalogue exactly', () => {
    expect([...BADGE_IDS].sort()).toEqual(seededIds().sort())
  })

  it('seeds a badge for every language we serve', () => {
    const ids = new Set(seededIds())
    for (const language of LANGUAGES) {
      expect(ids.has(`lang-${language}`), `missing lang-${language}`).toBe(true)
    }
  })

  it('has no duplicate ids', () => {
    const ids = seededIds()
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const entry = (over: Partial<BadgeCatalogueEntry>): BadgeCatalogueEntry => ({
  id: 'speed-10',
  name: 'x',
  description: 'x',
  icon: '⚡',
  family: 'Speed',
  sort: 0,
  earned: false,
  ...over,
})

describe('byFamily', () => {
  it('groups in sort order, families contiguous', () => {
    const groups = byFamily([
      entry({ family: 'Speed', sort: 200 }),
      entry({ family: 'Daily', sort: 100 }),
      entry({ family: 'Speed', sort: 210 }),
      entry({ family: 'Daily', sort: 110 }),
    ])

    expect(groups.map((g) => g.family)).toEqual(['Daily', 'Speed'])
    expect(groups.map((g) => g.badges.length)).toEqual([2, 2])
    expect(groups[0]?.badges.map((b) => b.sort)).toEqual([100, 110])
  })

  it('is empty for no badges', () => {
    expect(byFamily([])).toEqual([])
  })
})
