import type { AttemptResult } from '../types'
import { NO_ANSWER } from '../lib/scoring'
import { Bugsy } from './Bugsy'

interface ResultCardProps {
  result: AttemptResult
  clickedLine: number
  nextLabel: string
  onNext: () => void
}

export function ResultCard({ result, clickedLine, nextLabel, onNext }: ResultCardProps) {
  const timedOut = clickedLine === NO_ANSWER

  const headline = result.correct ? 'Got it.' : timedOut ? "Time's up." : 'Not this time.'

  const subline = result.correct
    ? `Line ${result.bugLine} was the one.`
    : timedOut
      ? `The bug was hiding on line ${result.bugLine}.`
      : `You picked line ${clickedLine}. The bug was on line ${result.bugLine}.`

  return (
    <div className={`result ${result.correct ? 'result--correct' : 'result--miss'}`}>
      <header className="result__header">
        <Bugsy mood={result.correct ? 'celebrating' : 'dizzy'} size={44} />
        <div>
          <h2 className="result__headline">{headline}</h2>
          <p className="result__subline">{subline}</p>
        </div>
        {result.correct ? <span className="result__points">+{result.points}</span> : null}
      </header>

      <div className="result__explanation">{result.explanation}</div>

      {result.newBadges.length > 0 ? (
        <div className="result__badges">
          {result.newBadges.map((badge) => (
            <div key={badge.id} className="badge-pill">
              <span className="badge-pill__icon">{badge.icon}</span>
              <div>
                <strong>{badge.name}</strong>
                <span className="badge-pill__desc">{badge.description}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="result__footer">
        <span className="result__streak">
          {result.streaks.accuracyCurrent > 0
            ? `🎯 ${result.streaks.accuracyCurrent} in a row`
            : 'Streak reset. Bugsy still believes in you.'}
        </span>
        {/* No autoFocus: focusing this scrolls it into view, which shoves the
            revealed line off screen. */}
        <button type="button" className="btn btn--primary" onClick={onNext}>
          {nextLabel}
        </button>
      </footer>
    </div>
  )
}
