export interface CategoryStat {
  category: string
  attempts: number
  correct: number
}

/**
 * The category the player is worst at — but only if they are actually bad at it.
 *
 * `correct < attempts` is the load-bearing clause. Without it, the worst of
 * several perfect scores is still perfect, and the profile cheerfully tells a
 * flawless player they "keep missing async bugs — 100% on 5 tries". Being wrong
 * about someone's weakness is worse than saying nothing.
 *
 * The 3-attempt floor keeps one unlucky miss from being branded a weakness.
 */
export function weakest(categories: CategoryStat[]): CategoryStat | null {
  const meaningful = categories.filter((c) => c.attempts >= 3 && c.correct < c.attempts)
  if (meaningful.length === 0) return null

  return meaningful.reduce((worst, c) =>
    c.correct / c.attempts < worst.correct / worst.attempts ? c : worst,
  )
}
