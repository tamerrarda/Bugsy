import { useCallback, useEffect, useRef, useState } from 'react'
import { LEADERBOARD_PERIODS, type LeaderboardPeriod, type LeaderboardRow } from '../types'
import { getLeaderboard } from '../lib/serverApi'
import { supabase } from '../lib/supabase'
import { Bugsy } from './Bugsy'

const LABEL: Record<LeaderboardPeriod, string> = {
  daily: 'today',
  weekly: 'this week',
  alltime: 'all time',
}

interface LeaderboardProps {
  /** The signed-in player, so their own row can be highlighted. */
  username: string | null
}

export function Leaderboard({ username }: LeaderboardProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('daily')
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await getLeaderboard(period))
      setError(null)
    } catch {
      setError("Bugsy couldn't reach the leaderboard.")
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  // Live updates while the board is open.
  //
  // This listens for a BROADCAST, not postgres_changes. A postgres_changes
  // subscription on `attempts` would be filtered by RLS down to the subscriber's
  // own rows — the board would never move for anyone else's score, while looking
  // for all the world like it was live. The database broadcasts a contentless
  // ping instead (see the attempts_broadcast trigger), and we simply re-read.
  const lastLoadRef = useRef(0)
  const pendingRef = useRef<number | null>(null)

  useEffect(() => {
    // The topic is public: anyone holding the anon key can broadcast to it, so
    // the ping is treated as a hint, never a command. A trailing-edge throttle
    // collapses any burst — a busy evening or a hostile client flooding the
    // channel — into at most one refetch per window. The flood then costs its
    // sender a websocket and costs every listener almost nothing.
    const REFRESH_MIN_MS = 2500

    const channel = supabase
      .channel('leaderboard')
      .on('broadcast', { event: 'attempt' }, () => {
        if (pendingRef.current !== null) return

        const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - lastLoadRef.current))
        pendingRef.current = window.setTimeout(() => {
          pendingRef.current = null
          lastLoadRef.current = Date.now()
          void load()
        }, wait)
      })
      .subscribe()

    return () => {
      if (pendingRef.current !== null) {
        window.clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [load])

  return (
    <div className="board">
      <div className="chips chips--filter">
        {LEADERBOARD_PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip chip--button ${period === option ? 'chip--active' : ''}`}
            onClick={() => setPeriod(option)}
          >
            {LABEL[option]}
          </button>
        ))}
      </div>

      {error ? <p className="muted center">{error}</p> : null}

      {rows === null && !error ? <p className="muted center">Counting…</p> : null}

      {rows !== null && rows.length === 0 ? (
        <div className="center">
          <Bugsy mood="sleeping" size={56} />
          <p className="muted">Bugsy hasn&rsquo;t seen anyone here yet.</p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ol className="board__list">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.username}`}
              className={`board__row ${row.username === username ? 'board__row--me' : ''}`}
            >
              <span className="board__rank">{row.rank}</span>
              {row.avatarUrl ? (
                <img className="board__avatar" src={row.avatarUrl} alt="" />
              ) : (
                <span className="board__avatar board__avatar--blank" />
              )}
              <span className="board__name">{row.username}</span>
              <span className="board__points">{row.points}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
