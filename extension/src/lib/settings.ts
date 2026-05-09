import type { Difficulty, Language } from '../types'

/**
 * User settings (spec §7.13).
 *
 * These live in `chrome.storage.sync`, not `local`, for two reasons: they follow
 * the user to another machine, and the service worker needs to read
 * `notificationsEnabled` without the popup being open — a `local` value would be
 * just as reachable, but keeping every SW-visible key in one area makes it
 * obvious which settings the background code depends on.
 */

export const NOTIFICATIONS_KEY = 'bugsy:notificationsEnabled'
export const LANGUAGE_KEY = 'bugsy:preferredLanguage'
export const DIFFICULTY_KEY = 'bugsy:preferredDifficulty'
export const TRACK_KEY = 'bugsy:dailyTrack'
export const ONBOARDED_KEY = 'bugsy:onboarded'

export type LanguagePreference = Language | 'all'
export type DifficultyPreference = Difficulty | 'all'

export interface Settings {
  notificationsEnabled: boolean
  preferredLanguage: LanguagePreference
  preferredDifficulty: DifficultyPreference
  /** The daily track. null until the player picks one — the popup asks before their first daily. */
  dailyTrack: Language | null
}

/** Notifications default ON — the daily nudge is the point of the extension. */
export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  preferredLanguage: 'all',
  preferredDifficulty: 'all',
  dailyTrack: null,
}

const hasSync = (): boolean =>
  typeof chrome !== 'undefined' && chrome.storage?.sync !== undefined

const memory = new Map<string, unknown>()

async function read<T>(key: string, fallback: T): Promise<T> {
  if (!hasSync()) return (memory.get(key) as T | undefined) ?? fallback
  const result = await chrome.storage.sync.get(key)
  return (result[key] as T | undefined) ?? fallback
}

async function write(key: string, value: unknown): Promise<void> {
  if (!hasSync()) {
    memory.set(key, value)
    return
  }
  await chrome.storage.sync.set({ [key]: value })
}

export async function getSettings(): Promise<Settings> {
  const [notificationsEnabled, preferredLanguage, preferredDifficulty, dailyTrack] =
    await Promise.all([
      read(NOTIFICATIONS_KEY, DEFAULT_SETTINGS.notificationsEnabled),
      read(LANGUAGE_KEY, DEFAULT_SETTINGS.preferredLanguage),
      read(DIFFICULTY_KEY, DEFAULT_SETTINGS.preferredDifficulty),
      read<Language | null>(TRACK_KEY, DEFAULT_SETTINGS.dailyTrack),
    ])

  return { notificationsEnabled, preferredLanguage, preferredDifficulty, dailyTrack }
}

export async function setDailyTrack(language: Language): Promise<void> {
  await write(TRACK_KEY, language)
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await write(NOTIFICATIONS_KEY, enabled)
}

export async function setPreferredLanguage(language: LanguagePreference): Promise<void> {
  await write(LANGUAGE_KEY, language)
}

export async function setPreferredDifficulty(difficulty: DifficultyPreference): Promise<void> {
  await write(DIFFICULTY_KEY, difficulty)
}

/** The 3-step first-run tour shows once, ever. */
export const getOnboarded = (): Promise<boolean> => read(ONBOARDED_KEY, false)
export const markOnboarded = (): Promise<void> => write(ONBOARDED_KEY, true)
