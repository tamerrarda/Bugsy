import { useEffect, useState } from 'react'
import type { BadgeCatalogueEntry } from '../types'
import { byFamily, loadBadgeCatalogue } from '../lib/badges'
import { Bugsy } from './Bugsy'

/**
 * Every badge Bugsy can hand out, grouped, with the ones you hold lit up.
 *
 * The locked rows keep their description on purpose: a badge you can't read is
 * not a goal, it's a mystery box. The point of this screen is to tell you what
 * to go and do.
 */
export function AllBadges({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<BadgeCatalogueEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBadgeCatalogue(userId)
      .then(setBadges)
      .catch(() => setError("Bugsy couldn't fetch the badge case."))
  }, [userId])

  if (error) {
    return (
      <div className="center">
        <Bugsy mood="dizzy" size={48} />
        <p className="muted">{error}</p>
      </div>
    )
  }

  if (!badges) return <p className="muted center">Bugsy is polishing them…</p>

  const earned = badges.filter((b) => b.earned).length

  return (
    <div className="catalogue">
      <p className="catalogue__count">
        🍃 {earned} of {badges.length} earned
      </p>

      {byFamily(badges).map((group) => (
        <section key={group.family} className="catalogue__group">
          <h3 className="catalogue__family">{group.family}</h3>

          {group.badges.map((badge) => (
            <div
              key={badge.id}
              className={`badge-row ${badge.earned ? 'badge-row--earned' : 'badge-row--locked'}`}
            >
              <span className="badge-row__icon" aria-hidden="true">
                {badge.earned ? badge.icon : '🔒'}
              </span>
              <div className="badge-row__text">
                <strong className="badge-row__name">{badge.name}</strong>
                <span className="badge-row__desc">{badge.description}</span>
              </div>
              {badge.earned ? (
                <span className="badge-row__tick" aria-label="earned">
                  ✓
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
