import { createClient, type SupportedStorage } from '@supabase/supabase-js'

/**
 * The Supabase client for the extension.
 *
 * It holds the ANON key only. The anon key can read the badge catalogue and the
 * leaderboard views, and nothing else — `challenges`, `serves` and the grading
 * functions are all revoked from it at the database level. The service-role key
 * never comes near this bundle.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy extension/.env.example to extension/.env.',
  )
}

export const SUPABASE_ORIGIN = SUPABASE_URL

/**
 * supabase-js reaches for localStorage by default, which a service worker does
 * not have and which an extension popup loses on every close. chrome.storage.local
 * survives both, so the session persists across popup open/close.
 */
const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && chrome.storage?.local !== undefined

// Falls back to memory when the extension APIs are absent, so the popup can also
// be opened as a plain page during development instead of white-screening on a
// `chrome is not defined` thrown from deep inside supabase-js.
const fallback = new Map<string, string>()

const chromeStorage: SupportedStorage = {
  getItem: async (key) => {
    if (!hasChromeStorage()) return fallback.get(key) ?? null
    const result = await chrome.storage.local.get(key)
    return (result[key] as string | undefined) ?? null
  },
  setItem: async (key, value) => {
    if (!hasChromeStorage()) {
      fallback.set(key, value)
      return
    }
    await chrome.storage.local.set({ [key]: value })
  },
  removeItem: async (key) => {
    if (!hasChromeStorage()) {
      fallback.delete(key)
      return
    }
    await chrome.storage.local.remove(key)
  },
}

/** Fixed rather than derived from the URL, so the session survives changing hosts. */
export const AUTH_STORAGE_KEY = 'bugsy:auth'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorage,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // The extension parses the OAuth fragment itself (see auth.ts); there is no
    // page navigation for supabase-js to pick a token out of.
    detectSessionInUrl: false,
  },
})
