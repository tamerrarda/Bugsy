import type { BadgeCatalogueEntry, BadgeId } from '../types'
import { supabase } from './supabase'

/**
 * The whole catalogue, with `earned` stamped on each row.
 *
 * The client never decides WHICH badges exist or what they mean — that lives in
 * the `badges` table, next to the code that awards them. Two lists that must
 * agree but live apart eventually stop agreeing.
 */
export async function loadBadgeCatalogue(userId: string): Promise<BadgeCatalogueEntry[]> {
  const [all, owned] = await Promise.all([
    supabase.from('badges').select('id, name, description, icon, family, sort').order('sort'),
    supabase.from('user_badges').select('badge_id').eq('user_id', userId),
  ])

  // A failed query must not quietly become "you have earned nothing". Someone
  // who has ground out 20 badges deserves an error, not a lie that erases them.
  const failed = [all.error, owned.error].find(Boolean)
  if (failed) throw new Error(failed.message)

  const earned = new Set((owned.data ?? []).map((row) => row.badge_id as string))

  return (all.data ?? []).map((row) => ({
    id: row.id as BadgeId,
    name: row.name as string,
    description: row.description as string,
    icon: row.icon as string,
    family: row.family as string,
    sort: row.sort as number,
    earned: earned.has(row.id as string),
  }))
}

/** Catalogue order, grouped by family. Relies on `sort` keeping families contiguous. */
export function byFamily(badges: BadgeCatalogueEntry[]): { family: string; badges: BadgeCatalogueEntry[] }[] {
  const groups: { family: string; badges: BadgeCatalogueEntry[] }[] = []

  for (const badge of [...badges].sort((a, b) => a.sort - b.sort)) {
    const last = groups[groups.length - 1]
    if (last && last.family === badge.family) last.badges.push(badge)
    else groups.push({ family: badge.family, badges: [badge] })
  }

  return groups
}
