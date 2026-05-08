import { useEffect, useState } from 'react'
import { LANGUAGE_LABEL, type Language } from '../types'
import { buildShareText, puzzleNumber } from '../lib/share'
import { Bugsy } from './Bugsy'

interface ShareCardProps {
  day: string
  /** The track this daily was played on. */
  language: Language
  /** One per challenge, in play order. */
  results: boolean[]
  dailyStreak: number
  onDone: () => void
}

/** Countdown to the next UTC midnight, when a new daily lands. */
function useTimeToNextDaily(): string {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
      )
      const ms = next - now.getTime()

      const hours = Math.floor(ms / 3_600_000)
      const minutes = Math.floor((ms % 3_600_000) / 60_000)

      setLabel(`${hours}h ${minutes}m`)
    }

    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return label
}

export function ShareCard({ day, language, results, dailyStreak, onDone }: ShareCardProps) {
  const [copied, setCopied] = useState(false)
  const nextDaily = useTimeToNextDaily()

  const text = buildShareText({ day, language, results, dailyStreak })
  const score = results.filter(Boolean).length

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="summary">
      <Bugsy mood={score === results.length ? 'celebrating' : score > 0 ? 'happy' : 'dizzy'} size={64} />

      <h2 className="summary__title">
        Bugsy #{puzzleNumber(day)} <span className="summary__track">{LANGUAGE_LABEL[language]}</span>
      </h2>
      <p className="summary__score">
        {score} of {results.length} today
      </p>

      {/* The grid the user actually shares. Rendered from the same string that
          gets copied, so what they see is exactly what lands in the paste. */}
      <pre className="summary__grid">{text}</pre>

      <button type="button" className="btn btn--primary btn--block" onClick={() => void copy()}>
        {copied ? 'Copied ✓' : 'Copy result'}
      </button>

      <p className="summary__next">Next bugs in {nextDaily}</p>

      <button type="button" className="btn btn--ghost btn--block" onClick={onDone}>
        Back home
      </button>
    </div>
  )
}
