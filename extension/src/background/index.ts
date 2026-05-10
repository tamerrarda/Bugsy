/**
 * Service worker.
 *
 * Owns three things the popup cannot, because the popup is destroyed the moment
 * it loses focus:
 *   - the toolbar badge, which is the passive re-engagement hook: your streak is
 *     visible every time you open the browser
 *   - the daily-reset alarm, which notices a new UTC day has begun
 *   - the "today's bugs are live" notification
 */

const DAILY_STREAK_KEY = 'bugsy:dailyStreak'
const LAST_PLAYED_KEY = 'bugsy:lastPlayedDay'
const NOTIFY_KEY = 'bugsy:notificationsEnabled'
const NOTIFIED_KEY = 'bugsy:notifiedForDay'

const FLAME = '#FF6B35'
const ALARM = 'daily-reset'

const utcToday = (): string => new Date().toISOString().slice(0, 10)

async function syncBadge(): Promise<void> {
  const cached = await chrome.storage.sync.get(DAILY_STREAK_KEY)
  const streak = (cached[DAILY_STREAK_KEY] as number | undefined) ?? 0

  await chrome.action.setBadgeBackgroundColor({ color: FLAME })
  // An empty string clears the badge. A "0" would be a worse thing to look at
  // every day than nothing at all.
  await chrome.action.setBadgeText({ text: streak > 0 ? String(streak) : '' })
}

/**
 * On each tick, check whether a new UTC day has started and the user has not
 * played it yet. Fires at most one notification per day, and only if the user
 * has not turned them off.
 */
async function checkDailyReset(): Promise<void> {
  const today = utcToday()

  const state = await chrome.storage.sync.get([NOTIFY_KEY, NOTIFIED_KEY, LAST_PLAYED_KEY])

  const enabled = (state[NOTIFY_KEY] as boolean | undefined) ?? true
  if (!enabled) return

  // Already nudged them today, or they have already played today.
  if (state[NOTIFIED_KEY] === today) return
  if (state[LAST_PLAYED_KEY] === today) return

  chrome.notifications.create(`daily-${today}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: "Bugsy's waiting",
    message: "Today's bugs are live 🐛",
  })

  await chrome.storage.sync.set({ [NOTIFIED_KEY]: today })
}

chrome.runtime.onInstalled.addListener(() => {
  void syncBadge()
  chrome.alarms.create(ALARM, { periodInMinutes: 60 })
})

chrome.runtime.onStartup.addListener(() => {
  void syncBadge()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    void checkDailyReset()
  }
})

// The popup writes the streak after an attempt; the badge follows it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && DAILY_STREAK_KEY in changes) {
    void syncBadge()
  }
})

// Clicking the notification should land you in the game, not nowhere.
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id)
  void chrome.action.openPopup().catch(() => {
    // openPopup needs a recent user gesture in some Chrome versions; failing to
    // open is not worth surfacing an error for.
  })
})
