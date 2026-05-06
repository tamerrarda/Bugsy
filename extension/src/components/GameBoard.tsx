import { useCallback, useEffect, useState } from 'react'
import type { AttemptResult, GameMode, PublicChallenge } from '../types'
import { getApi } from '../lib/session'
import { celebrate } from '../lib/confetti'
import { NO_ANSWER } from '../lib/scoring'
import { CodeViewer } from './CodeViewer'
import { ResultCard } from './ResultCard'
import { Timer } from './Timer'

const DIFFICULTY_LABEL: Record<number, string> = { 1: 'easy', 2: 'medium', 3: 'hard' }

interface GameBoardProps {
  challenge: PublicChallenge
  mode: GameMode
  showHint: boolean
  /** Label on the button shown after the result ("Next bug", "Next", "See results"). */
  nextLabel: string
  onNext: () => void
  onResult: (result: AttemptResult, clickedLine: number) => void
  onError: (message: string) => void
  /** Pre-answered (a daily challenge resumed from the server). Skips straight to the result. */
  answered?: { result: AttemptResult; clickedLine: number } | undefined
  /** Optional progress indicator, e.g. "2 / 3" for the daily run. */
  progress?: string | undefined
}

/**
 * Plays exactly one challenge: shows it, times it, submits the pick, reveals the
 * result. Both Practice and Daily use this, so the two modes cannot drift apart —
 * the only difference between them is the `mode` sent to the server.
 */
export function GameBoard({
  challenge,
  mode,
  showHint,
  nextLabel,
  onNext,
  onResult,
  onError,
  answered,
  progress,
}: GameBoardProps) {
  const [state, setState] = useState<
    { phase: 'playing' } | { phase: 'submitting' } | { phase: 'result'; result: AttemptResult; clickedLine: number }
  >(answered ? { phase: 'result', ...answered } : { phase: 'playing' })

  // A new challenge resets the board. Without this, moving to the next daily
  // snippet would leave the previous result on screen.
  useEffect(() => {
    setState(answered ? { phase: 'result', ...answered } : { phase: 'playing' })
  }, [challenge.id, answered])

  const submit = useCallback(
    async (clickedLine: number) => {
      // Freeze immediately so a fast double-click cannot submit twice.
      setState({ phase: 'submitting' })

      try {
        const api = await getApi()
        const result = await api.submitAttempt({ challengeId: challenge.id, mode, clickedLine })

        setState({ phase: 'result', result, clickedLine })
        onResult(result, clickedLine)

        if (result.correct) void celebrate()
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Something came apart. Try again?')
      }
    },
    [challenge.id, mode, onResult, onError],
  )

  const playing = state.phase === 'playing'

  return (
    <>
      <div className="game__bar">
        <div className="chips">
          <span className="chip">{challenge.language}</span>
          <span className={`chip chip--d${challenge.difficulty}`}>
            {DIFFICULTY_LABEL[challenge.difficulty]}
          </span>
          {progress ? <span className="chip chip--progress">{progress}</span> : null}
        </div>

        {playing ? (
          <Timer runKey={challenge.id} onExpire={() => void submit(NO_ANSWER)} />
        ) : null}
      </div>

      {playing && showHint ? (
        <p className="hint">Click the line you think holds the bug.</p>
      ) : null}

      <CodeViewer
        code={challenge.code}
        language={challenge.language}
        disabled={!playing}
        onPickLine={(line) => void submit(line)}
        reveal={
          state.phase === 'result'
            ? { bugLine: state.result.bugLine, clickedLine: state.clickedLine }
            : undefined
        }
      />

      {state.phase === 'submitting' ? <p className="muted center">Bugsy is checking…</p> : null}

      {state.phase === 'result' ? (
        <ResultCard
          result={state.result}
          clickedLine={state.clickedLine}
          nextLabel={nextLabel}
          onNext={onNext}
        />
      ) : null}
    </>
  )
}
