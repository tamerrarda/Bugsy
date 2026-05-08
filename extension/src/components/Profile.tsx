import { useEffect, useState } from 'react'
import type { AuthUser } from '../lib/auth'
import type { BadgeCatalogueEntry } from '../types'
import { loadBadgeCatalogue } from '../lib/badges'
import { weakest, type CategoryStat } from '../lib/weakSpot'
import { supabase } from '../lib/supabase'
import { Bugsy } from './Bugsy'

interface Stats {
  badges: BadgeCatalogueEntry[]
  categories: CategoryStat[]
  dailyBest: number
  accuracyBest: number
  totalAttempts: number
  totalCorrect: number
}

async function loadStats(userId: string): Promise<Stats> {
  const [badges, categories, streaks] = await Promise.all([
    loadBadgeCatalogue(userId),
    supabase.from('my_category_stats').select('category, attempts, correct'),
    supabase.from('streaks').select('daily_best, accuracy_best').eq('user_id', userId).single(),
  ])

  // Do NOT swallow these. Coalescing a failed query to [] would render "0%
  // accuracy" — a confident, specific lie — for a player who has been getting
  // them right all week. An honest error beats a plausible wrong number.
  const failed = [categories.error, streaks.error].find(Boolean)
  if (failed) throw new Error(failed.message)

  const cats = (categories.data ?? []) as CategoryStat[]

  return {
    badges,
    categories: cats,
    dailyBest: (streaks.data?.daily_best as number | undefined) ?? 0,
    accuracyBest: (streaks.data?.accuracy_best as number | undefined) ?? 0,
    totalAttempts: cats.reduce((n, c) => n + c.attempts, 0),
    totalCorrect: cats.reduce((n, c) => n + c.correct, 0),
  }
}

interface ProfileProps {
  profile: AuthUser
  /** Opens the full catalogue — every badge, earned or not. */
  onShowAllBadges: () => void
}

export function Profile({ profile, onShowAllBadges }: ProfileProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStats(profile.id)
      .then(setStats)
      .catch(() => setError("Bugsy couldn't add up your stats."))
  }, [profile.id])

  if (error) {
    return (
      <div className="center">
        <Bugsy mood="dizzy" size={48} />
        <p className="muted">{error}</p>
      </div>
    )
  }

  if (!stats) return <p className="muted center">Bugsy is counting…</p>

  const accuracy =
    stats.totalAttempts > 0 ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100) : 0
  const weak = weakest(stats.categories)
  const myBadges = stats.badges.filter((b) => b.earned)
  const earned = myBadges.length

  const shareUrl = `https://bugsy.dev/u/${profile.username}`
  const shareText = `I've earned ${earned}/${stats.badges.length} Bugsy badges and a ${stats.dailyBest}-day debugging streak 🐛`

  return (
    <div className="profile">
      <header className="profile__head">
        {profile.avatarUrl ? <img className="profile__avatar" src={profile.avatarUrl} alt="" /> : null}
        <div>
          <h2 className="profile__name">{profile.username}</h2>
          <p className="profile__sub">
            🍃 {earned} of {stats.badges.length} badges
          </p>
        </div>
        <Bugsy mood="happy" size={54} className="profile__mascot" />
      </header>

      <div className="profile__stats">
        <Stat icon="🎯" label="accuracy" value={`${accuracy}%`} />
        <Stat icon="⭐" label="best daily" value={stats.dailyBest} />
        <Stat icon="⏱️" label="best run" value={stats.accuracyBest} />
      </div>

      {weak ? (
        <p className="profile__weak">
          <Bugsy mood="dizzy" size={30} />
          <span>
            Bugsy notices you keep missing <strong>{weak.category}</strong> bugs —{' '}
            {Math.round((weak.correct / weak.attempts) * 100)}% on {weak.attempts} tries.
          </span>
        </p>
      ) : stats.totalAttempts >= 3 && stats.totalCorrect === stats.totalAttempts ? (
        <p className="profile__weak">
          <Bugsy mood="celebrating" size={30} />
          <span>
            No weak spot yet — Bugsy hasn't seen you miss one.
          </span>
        </p>
      ) : (
        <p className="profile__weak">
          <Bugsy mood="happy" size={30} />
          <span>Play a few more and Bugsy will spot your weak spot.</span>
        </p>
      )}

      {/* A panel, not bare text: everything else on this screen sits on a card,
          and "My badges" over the grass painting is close to unreadable. */}
      <section className="badges__panel">
        <div className="badges__head">
          <h3 className="badges__title">My badges</h3>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onShowAllBadges}>
            All badges
          </button>
        </div>

        {/* Empty until you earn one. A wall of grey padlocks on day one reads as
            "you have failed 31 times", which is a strange way to greet someone
            who has not started. The catalogue is one tap away for anyone who
            wants the map. */}
        {myBadges.length === 0 ? (
          <p className="badges__empty">
            <Bugsy mood="sleeping" size={30} />
            <span>No badges yet. Squash your first bug and one lands right here.</span>
          </p>
        ) : (
          <div className="badges">
            {myBadges.map((badge) => (
              <div key={badge.id} className="badge badge--earned" title={badge.description}>
                <span className="badge__icon" aria-hidden="true">
                  {badge.icon}
                </span>
                <span className="badge__name">{badge.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pre-filled share links, no API integration needed (spec §4.2). */}
      <div className="profile__share">
        <a
          className="btn"
          href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          𝕏 &nbsp;Share on X
        </a>
        <a
          className="btn"
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          in &nbsp;LinkedIn
        </a>
      </div>

    </div>
  )
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat__row">
        <span className="stat__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="stat__value">{value}</span>
      </span>
      <span className="stat__label">{label}</span>
    </div>
  )
}
