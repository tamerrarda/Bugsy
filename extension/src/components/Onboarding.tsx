import { useState } from 'react'
import { Bugsy, type BugsyMood } from './Bugsy'

interface Step {
  mood: BugsyMood
  title: string
  body: string
}

/**
 * The 3-step first-run tour (spec §7.13). Bugsy speaking, short and playful,
 * at most one exclamation mark across the whole thing (§6.2).
 */
const STEPS: Step[] = [
  {
    mood: 'happy',
    title: "Hi, I'm Bugsy",
    body: "Every snippet I show you has exactly one bug in it. Your job is to spot the line it's hiding on.",
  },
  {
    mood: 'dizzy',
    title: 'Click the line',
    body: "You get 60 seconds. Click the line you think is buggy — one click, no take-backs. Then I'll tell you what actually went wrong, and why.",
  },
  {
    mood: 'celebrating',
    title: 'Come back tomorrow',
    body: 'Three fresh bugs land every day, the same three for everyone. Finish all three to keep your streak alive.',
  },
]

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0)

  const step = STEPS[index]
  if (!step) return null

  const last = index === STEPS.length - 1

  return (
    <div className="tour">
      <Bugsy mood={step.mood} size={92} />

      <h2 className="tour__title">{step.title}</h2>
      <p className="tour__body">{step.body}</p>

      <div className="tour__dots" aria-hidden="true">
        {STEPS.map((_, i) => (
          <span key={i} className={`tour__dot ${i === index ? 'tour__dot--on' : ''}`} />
        ))}
      </div>

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => (last ? onDone() : setIndex(index + 1))}
      >
        {last ? 'Find my first bug' : 'Next'}
      </button>

      {!last ? (
        <button type="button" className="tour__skip" onClick={onDone}>
          skip
        </button>
      ) : null}
    </div>
  )
}
