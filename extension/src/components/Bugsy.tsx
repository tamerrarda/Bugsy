/**
 * Bugsy the mascot.
 *
 * The art lives in `public/mascot/` rather than being imported as a module, so
 * each mood is a separate file the browser fetches only when it is actually
 * shown — the popup never pays for the three moods it is not rendering. Paths are
 * root-absolute, which resolves to chrome-extension://<id>/mascot/… at runtime.
 */
export type BugsyMood = 'happy' | 'dizzy' | 'sleeping' | 'celebrating'

interface BugsyProps {
  mood: BugsyMood
  size?: number
  className?: string
}

/** What a screen reader hears. The mascot carries real meaning on the result screen. */
const ALT: Record<BugsyMood, string> = {
  happy: 'Bugsy, looking pleased',
  celebrating: 'Bugsy, celebrating',
  dizzy: 'Bugsy, dazed',
  sleeping: 'Bugsy, asleep',
}

export function Bugsy({ mood, size = 64, className }: BugsyProps) {
  return (
    <img
      src={`/mascot/bugsy-${mood}.png`}
      width={size}
      height={size}
      alt={ALT[mood]}
      className={className}
      draggable={false}
      style={{ display: 'block' }}
    />
  )
}
