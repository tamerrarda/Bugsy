import type { Badge } from '../types'

/**
 * The daily streak, cached in `chrome.storage.sync` purely so the toolbar badge
 * can render without a network round-trip. The number of record is
 * always the server's — this cache is a mirror, never a source.
 */
export const DAILY_STREAK_KEY = 'bugsy:dailyStreak'

const hasStorage = (): boolean =>
  typeof chrome !== 'undefined' && chrome.storage?.sync !== undefined

export async function cacheDailyStreak(streak: number): Promise<void> {
  if (!hasStorage()) return
  await chrome.storage.sync.set({ [DAILY_STREAK_KEY]: streak })
}

export async function readCachedDailyStreak(): Promise<number> {
  if (!hasStorage()) return 0
  const cached = await chrome.storage.sync.get(DAILY_STREAK_KEY)
  return (cached[DAILY_STREAK_KEY] as number | undefined) ?? 0
}

/**
 * Records that the user played today, so the service worker's daily-reset alarm
 * does not nudge someone who has already been.
 */
export async function markPlayedToday(): Promise<void> {
  if (!hasStorage()) return
  await chrome.storage.sync.set({ 'bugsy:lastPlayedDay': new Date().toISOString().slice(0, 10) })
}

/** Fires the badge-award notification. */
export async function notifyBadges(badges: Badge[]): Promise<void> {
  if (typeof chrome === 'undefined' || chrome.notifications === undefined) return

  for (const badge of badges) {
    chrome.notifications.create(`badge-${badge.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `🏅 ${badge.name}`,
      message: badge.description,
    })
  }
}
