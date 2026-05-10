import { useEffect, useRef, useState } from 'react'
import { ROUND_SECONDS } from '../lib/scoring'

interface TimerProps {
  /** Restarting the countdown is keyed on this — pass the challenge id. */
  runKey: string
  onExpire: () => void
}

const RADIUS = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Cosmetic countdown. The server times the round from `served_at`;
 * nothing here is ever sent to it or trusted by it. It exists to create urgency
 * and to fire `onExpire` so the round resolves on its own.
 */
export function Timer({ runKey, onExpire }: TimerProps) {
  const [remaining, setRemaining] = useState(ROUND_SECONDS)

  // Keeps the interval from re-subscribing every time the parent re-renders.
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    setRemaining(ROUND_SECONDS)
  }, [runKey])

  useEffect(() => {
    const deadline = Date.now() + ROUND_SECONDS * 1000

    // Derive from a deadline rather than decrementing a counter: an interval
    // that gets throttled would otherwise drift and under-count.
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemaining(left)

      if (left === 0) {
        clearInterval(id)
        onExpireRef.current()
      }
    }, 250)

    return () => clearInterval(id)
  }, [runKey])

  const fraction = remaining / ROUND_SECONDS
  const urgent = remaining <= 10

  return (
    <div className={`timer ${urgent ? 'timer--urgent' : ''}`} aria-live="off">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="timer__track" cx="18" cy="18" r={RADIUS} />
        <circle
          className="timer__progress"
          cx="18"
          cy="18"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span className="timer__label">{remaining}</span>
    </div>
  )
}
