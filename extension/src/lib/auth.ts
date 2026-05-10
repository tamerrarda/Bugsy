import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * GitHub OAuth inside Manifest V3.
 *
 * A normal web OAuth redirect cannot work here: there is no page for the provider
 * to redirect back to, and the popup is destroyed the moment focus leaves it. So
 * Chrome hands us `launchWebAuthFlow`, which opens the provider in a window it
 * controls and gives us the final redirect URL back as a string.
 *
 * The flow:
 *   1. ask Supabase for the provider URL, but do NOT let it navigate
 *      (skipBrowserRedirect)
 *   2. run that URL through launchWebAuthFlow
 *   3. Chrome returns https://<extension-id>.chromiumapp.org/#access_token=...
 *   4. parse the fragment and hand the tokens to supabase-js
 *
 * The redirect URL is derived from the extension ID, which is pinned by the
 * `key` field in manifest.json — if that ID changes, this URL changes, and
 * Supabase rejects the callback.
 */

export interface AuthUser {
  id: string
  username: string
  avatarUrl: string | null
}

export function redirectUrl(): string {
  return chrome.identity.getRedirectURL()
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function signInWithGitHub(): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: redirectUrl(),
      skipBrowserRedirect: true,
    },
  })

  if (error || !data.url) {
    throw new Error(error?.message ?? "Bugsy couldn't reach GitHub.")
  }

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  })

  if (!responseUrl) {
    // The user closed the window. Not an error worth shouting about.
    throw new Error('Sign-in cancelled.')
  }

  // Supabase returns the tokens in the URL *fragment*, not the query string, so
  // they never travel to a server as part of the redirect.
  const fragment = new URL(responseUrl).hash.slice(1)
  const params = new URLSearchParams(fragment)

  const providerError = params.get('error_description') ?? params.get('error')
  if (providerError) throw new Error(providerError)

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')

  if (!accessToken || !refreshToken) {
    throw new Error('GitHub sent Bugsy back without a session.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (sessionError || !sessionData.session) {
    throw new Error(sessionError?.message ?? 'Could not start a session.')
  }

  return sessionData.session
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * The player's profile row. Created server-side by the `on_auth_user_created`
 * trigger, so it exists by the time the first session does — the client never
 * has to create it, and cannot end up signed in without one.
 */
export async function getProfile(): Promise<AuthUser | null> {
  const session = await getSession()
  if (!session) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('id', session.user.id)
    .single()

  if (error || !data) return null

  return {
    id: data.id as string,
    username: data.username as string,
    avatarUrl: (data.avatar_url as string | null) ?? null,
  }
}
