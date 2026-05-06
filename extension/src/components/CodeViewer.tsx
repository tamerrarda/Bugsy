import { useEffect, useRef, useState } from 'react'
import type { Language } from '../types'
import { highlight, plainLines, type HighlightedLine } from '../lib/highlight'

/**
 * Which lines to mark up after an attempt. This prop is the ONLY channel
 * through which the answer enters the game screen, and it is populated
 * exclusively from an `AttemptResult` — i.e. after the server has graded.
 * While playing, it is undefined.
 */
export interface Reveal {
  bugLine: number
  clickedLine: number
}

interface CodeViewerProps {
  code: string
  language: Language
  /** Disabled once an answer is in — the code stays readable, just not clickable. */
  disabled: boolean
  onPickLine: (line: number) => void
  reveal?: Reveal | undefined
}

export function CodeViewer({ code, language, disabled, onPickLine, reveal }: CodeViewerProps) {
  const [lines, setLines] = useState<HighlightedLine[]>(() => plainLines(code))
  const containerRef = useRef<HTMLDivElement>(null)

  const revealedBugLine = reveal?.bugLine

  // On reveal, bring the buggy line into view. A long snippet plus the result
  // card can easily push it off screen, and an explanation you can't see the
  // line for is worth very little.
  useEffect(() => {
    if (revealedBugLine === undefined) return

    containerRef.current
      ?.querySelector(`[data-line="${revealedBugLine}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [revealedBugLine])

  useEffect(() => {
    let cancelled = false

    // Show unstyled code immediately, then upgrade in place once Shiki loads.
    setLines(plainLines(code))

    highlight(code, language)
      .then((highlighted) => {
        if (!cancelled) setLines(highlighted)
      })
      .catch(() => {
        // Highlighting is cosmetic; the game is fully playable without it.
      })

    return () => {
      cancelled = true
    }
  }, [code, language])

  return (
    <div className="code-viewer" ref={containerRef}>
      {/* Inner track is sized to the longest line, so all rows share a width and
          the hover highlight still spans the full row when scrolled right. */}
      <div
        className="code-lines"
        role="group"
        aria-label="Code snippet. Choose the line you think holds the bug."
      >
        {lines.map((tokens, index) => {
          const lineNumber = index + 1

          const isBug = reveal?.bugLine === lineNumber
          const isWrongPick =
            reveal !== undefined &&
            reveal.clickedLine === lineNumber &&
            reveal.clickedLine !== reveal.bugLine

          const className = [
            'code-line',
            isBug ? 'code-line--bug' : '',
            isWrongPick ? 'code-line--miss' : '',
          ]
            .filter(Boolean)
            .join(' ')

          // Screen readers get the line's actual source, not just its number —
          // "line 7" is unplayable if you can't hear what is on line 7. Blank
          // lines say so rather than announcing nothing.
          const text = tokens.map((token) => token.content).join('').trim()
          const spoken = text.length > 0 ? text : 'blank line'

          const verdict = isBug
            ? '. This is the buggy line'
            : isWrongPick
              ? '. This is the line you picked, and it is not the bug'
              : ''

          return (
            <button
              key={lineNumber}
              type="button"
              className={className}
              data-line={lineNumber}
              disabled={disabled}
              onClick={() => onPickLine(lineNumber)}
              aria-label={`Line ${lineNumber}: ${spoken}${verdict}`}
            >
              <span className="code-line__number" aria-hidden="true">
                {lineNumber}
              </span>
              {/* Without this the reveal is carried by colour alone, which
                  red/green colour blindness cannot see. Always rendered, so the
                  gutter width never shifts between playing and result. */}
              <span className="code-line__mark" aria-hidden="true">
                {isBug ? '✓' : isWrongPick ? '✗' : ''}
              </span>
              <code className="code-line__content" aria-hidden="true">
                {tokens.map((token, i) => (
                  <span key={i} style={token.color ? { color: token.color } : undefined}>
                    {token.content}
                  </span>
                ))}
                {/* Keeps blank lines clickable and full-height. */}
                {tokens.length === 0 ? ' ' : null}
              </code>
            </button>
          )
        })}
      </div>
    </div>
  )
}
