import type { BugsyApi } from './api'
import { getSession } from './auth'
import { localServer } from './localServer'
import { serverApi } from './serverApi'

/**
 * Picks the implementation for the current player.
 *
 * Resolved per call rather than once at startup, so signing in or out swaps the
 * backing store immediately without the popup having to be reopened.
 */
export async function getApi(): Promise<BugsyApi> {
  const session = await getSession()
  return session ? serverApi : localServer
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSession()) !== null
}
