/**
 * Thin wrapper over `chrome.storage.local` that degrades to an in-memory map
 * when the extension APIs are absent (unit tests, plain-browser dev).
 */

export interface LocalStats {
  accuracyCurrent: number
  accuracyBest: number
}

export const EMPTY_STATS: LocalStats = { accuracyCurrent: 0, accuracyBest: 0 }

const STATS_KEY = 'bugsy:localStats'
const HINT_KEY = 'bugsy:hintSeen'

const memory = new Map<string, unknown>()

const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && chrome.storage?.local !== undefined

async function read<T>(key: string, fallback: T): Promise<T> {
  if (!hasChromeStorage()) {
    return (memory.get(key) as T | undefined) ?? fallback
  }
  const result = await chrome.storage.local.get(key)
  return (result[key] as T | undefined) ?? fallback
}

async function write(key: string, value: unknown): Promise<void> {
  if (!hasChromeStorage()) {
    memory.set(key, value)
    return
  }
  await chrome.storage.local.set({ [key]: value })
}

export const getStats = (): Promise<LocalStats> => read(STATS_KEY, EMPTY_STATS)
export const setStats = (stats: LocalStats): Promise<void> => write(STATS_KEY, stats)

/**
 * Where the local accuracy streak lives. Injected into the server rather than
 * imported by it, so a test can hand it a fresh store instead of inheriting
 * whatever streak an earlier test happened to leave behind.
 */
export interface StatsStore {
  get(): Promise<LocalStats>
  set(stats: LocalStats): Promise<void>
}

export const persistentStatsStore: StatsStore = { get: getStats, set: setStats }

export function createMemoryStatsStore(initial: LocalStats = EMPTY_STATS): StatsStore {
  let current = initial
  return {
    get: async () => current,
    set: async (stats) => {
      current = stats
    },
  }
}

/** The "click the buggy line" hint shows on the first play only. */
export const getHintSeen = (): Promise<boolean> => read(HINT_KEY, false)
export const markHintSeen = (): Promise<void> => write(HINT_KEY, true)
