import type { Streaks } from '../types'
import { supabase } from './supabase'

/**
 * Reads the player's streaks from the server.
 *
 * The popup needs this on every open, and forgetting it was a real bug: the UI
 * only ever learned a streak from the *response to an attempt*, so reopening the
 * popup showed 0 until you finished another daily — and the toolbar badge, which
 * is fed from this same number, stayed blank. A streak you cannot see is a streak
 * you stop caring about, and the badge is the whole re-engagement mechanic.
 *
 * `streaks` is readable by its owner under RLS, so this needs no Edge Function.
 */
export interface StreakState extends Streaks {
  /** UTC date of the last completed daily, or null if they have never finished one. */
  lastDailyDate: string | null
}

export async function fetchStreaks(userId: string): Promise<StreakState | null> {
  const { data, error } = await supabase
    .from('streaks')
    .select('daily_current, daily_best, last_daily_date, accuracy_current, accuracy_best')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  return {
    dailyCurrent: data.daily_current as number,
    dailyBest: data.daily_best as number,
    accuracyCurrent: data.accuracy_current as number,
    accuracyBest: data.accuracy_best as number,
    lastDailyDate: (data.last_daily_date as string | null) ?? null,
  }
}

/**
 * What the streak is worth *today*.
 *
 * The stored `daily_current` only changes when someone plays, so a player who
 * last finished a daily three days ago still has `daily_current = 12` sitting in
 * the row — the server will reset it to 1 on their next attempt (see
 * submit_attempt), but until then the number is stale. Showing 12 to someone
 * whose streak is already broken is a lie, and a cruel one, because they find out
 * only after playing.
 *
 * A streak survives if the last completed daily was today or yesterday (UTC).
 */
export function liveDailyStreak(state: StreakState, today = utcToday()): number {
  if (state.lastDailyDate === null) return 0

  const yesterday = utcDaysAgo(1, today)
  if (state.lastDailyDate === today || state.lastDailyDate === yesterday) {
    return state.dailyCurrent
  }

  return 0
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function utcDaysAgo(days: number, from: string): string {
  const date = new Date(`${from}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
