import { useEffect, useRef } from 'react'

/**
 * The living layer behind every screen: drifting clouds, falling leaves,
 * pollen sparks — and a row of flowers along the grass that stir when the
 * cursor comes near.
 *
 * The flowers cannot use `:hover`. This whole layer sits at z-index -1, so the
 * shell above it wins every hit test and the flowers never receive pointer
 * events. Instead a window-level mousemove measures the distance to each
 * flower's rooting point and toggles a class. The positions come from the same
 * FLOWERS table the markup is rendered from, so the math never reads the DOM —
 * no layout thrash at mouse speed.
 *
 * Everything here is decorative: aria-hidden, pointer-events none, animated
 * with transform/opacity only, and stilled by prefers-reduced-motion in CSS
 * (the class toggle then changes nothing, so the listener can stay).
 */

interface FlowerSpec {
  /** Anchor of the stem base, as a percentage of the popup width. */
  left: number
  /** Distance of the stem base from the bottom edge, in px. */
  bottom: number
  /** Rendered height in px; width follows the 32:40 viewBox. */
  size: number
  kind: 'daisy' | 'poppy'
  /** Sway phase offset, so the row never moves in unison. */
  delay: number
  /** Sway period. Taller flowers swing slower, like real stems. */
  duration: number
}

const FLOWERS: FlowerSpec[] = [
  { left: 5, bottom: 30, size: 34, kind: 'poppy', delay: 0, duration: 7.2 },
  { left: 20, bottom: 10, size: 26, kind: 'daisy', delay: -2.1, duration: 5.8 },
  { left: 45, bottom: 22, size: 23, kind: 'daisy', delay: -4.4, duration: 6.4 },
  { left: 68, bottom: 8, size: 29, kind: 'poppy', delay: -1.2, duration: 6.9 },
  { left: 86, bottom: 26, size: 33, kind: 'daisy', delay: -3.2, duration: 7.6 },
]

/** How close the cursor must come (px) before a flower notices it. */
const STIR_RADIUS = 55

interface TuftSpec {
  left: number
  bottom: number
  /** Rendered height in px; width follows the 40:24 viewBox. */
  size: number
  /** Mirrored tufts break up the repetition of one drawing used seven times. */
  flip?: boolean
  /** Idle sway period. */
  duration: number
}

/** Grass tufts in the foreground, rendered after the flowers so a few stems
    disappear behind them — that overlap is what sells the depth. */
const TUFTS: TuftSpec[] = [
  { left: 0, bottom: 0, size: 22, duration: 4.9 },
  { left: 13, bottom: 4, size: 16, flip: true, duration: 4.2 },
  { left: 28, bottom: 0, size: 20, duration: 5.4 },
  { left: 43, bottom: 5, size: 15, flip: true, duration: 4.6 },
  { left: 57, bottom: 0, size: 21, duration: 5.1 },
  { left: 73, bottom: 3, size: 17, duration: 4.4 },
  { left: 89, bottom: 0, size: 23, flip: true, duration: 5.7 },
]

/**
 * The gust wave travels left to right: each plant starts its bend this many
 * seconds per percent of width after the plants at the left edge, so the wind
 * visibly crosses the garden in about 1.3 seconds.
 */
const GUST_SECONDS_PER_PERCENT = 0.013

function Daisy() {
  return (
    <svg viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 22 C15.4 27 15.8 33 15.2 40" stroke="#5d8a2a" strokeWidth="2" fill="none" />
      <path d="M15.6 30 C11 28.5 9.5 25.5 9 23.5 C13 24 15 26.5 15.6 30" fill="#7ba83c" />
      {/* Petals placed by hand, not by formula — the uneven angles are the point. */}
      <g fill="#fdf5e4" stroke="#eadbb8" strokeWidth="0.8">
        <ellipse cx="16" cy="5.5" rx="3.1" ry="5" />
        <ellipse cx="23.5" cy="9.5" rx="3" ry="4.8" transform="rotate(64 23.5 9.5)" />
        <ellipse cx="22.5" cy="17.5" rx="3" ry="4.6" transform="rotate(118 22.5 17.5)" />
        <ellipse cx="16" cy="20.5" rx="3.1" ry="4.8" transform="rotate(184 16 20.5)" />
        <ellipse cx="9" cy="17" rx="3" ry="4.7" transform="rotate(238 9 17)" />
        <ellipse cx="8.8" cy="9" rx="3" ry="4.8" transform="rotate(299 8.8 9)" />
      </g>
      <circle cx="16" cy="13" r="4.2" fill="#f4c445" stroke="#dfa422" strokeWidth="1" />
    </svg>
  )
}

function Tuft() {
  return (
    <svg viewBox="0 0 40 24" aria-hidden="true">
      {/* Blades as bare strokes: five curves, two greens, no two alike. */}
      <g fill="none" strokeLinecap="round">
        <path d="M7 24 C8 15 4 9 2.5 5" stroke="#6d9c33" strokeWidth="3" />
        <path d="M14 24 C15 13 12.5 7 14.5 2" stroke="#86b73f" strokeWidth="3.4" />
        <path d="M21 24 C21.5 14 24 8 27 4.5" stroke="#5d8a2a" strokeWidth="3" />
        <path d="M28 24 C29 16 32 11 35.5 8" stroke="#86b73f" strokeWidth="2.8" />
        <path d="M34 24 C34.5 17 37 13 38.5 10.5" stroke="#6d9c33" strokeWidth="2.4" />
      </g>
    </svg>
  )
}

function Butterfly() {
  return (
    <svg viewBox="0 0 24 20" aria-hidden="true">
      {/* Each wing pair flaps by squeezing toward the body (scaleX in CSS,
          origin on the body line) — the top-down flap the eye expects at this
          size. Forewings gold, hindwings cream, like everything else here. */}
      <g className="butterfly__wing butterfly__wing--l">
        <path d="M11 9 C6 2 1.5 2.5 1.5 6.5 C1.5 9.5 6 10.5 11 10" fill="#f4c445" stroke="#dfa422" strokeWidth="0.8" />
        <path d="M11 10.5 C6.5 10.5 3.5 12.5 4 15 C4.5 17.5 8.5 16.5 11 12.5" fill="#fdf5e4" stroke="#eadbb8" strokeWidth="0.8" />
      </g>
      <g className="butterfly__wing butterfly__wing--r">
        <path d="M13 9 C18 2 22.5 2.5 22.5 6.5 C22.5 9.5 18 10.5 13 10" fill="#f4c445" stroke="#dfa422" strokeWidth="0.8" />
        <path d="M13 10.5 C17.5 10.5 20.5 12.5 20 15 C19.5 17.5 15.5 16.5 13 12.5" fill="#fdf5e4" stroke="#eadbb8" strokeWidth="0.8" />
      </g>
      <ellipse cx="12" cy="10.5" rx="1.4" ry="4.4" fill="#5a3d24" />
      <path d="M11.2 6.5 C10 4.5 9 3.8 8 3.2 M12.8 6.5 C14 4.5 15 3.8 16 3.2" stroke="#5a3d24" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function Poppy() {
  return (
    <svg viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 20 C16.6 26 16 33 16.6 40" stroke="#5d8a2a" strokeWidth="2" fill="none" />
      <path d="M16.3 31 C20.5 29.5 22 26.5 22.4 24.5 C18.6 25 16.8 27.5 16.3 31" fill="#7ba83c" />
      <path
        d="M8.5 13.5 C7.5 6.5 12 3.5 16 3.8 C20 3.5 24.5 6.5 23.5 13.5 C23 18 19.5 20.5 16 20.3 C12.5 20.5 9 18 8.5 13.5"
        fill="#ef7f3a"
        stroke="#d95f24"
        strokeWidth="1"
      />
      {/* Two creases give the cup its folds without another color. */}
      <path d="M12.5 5.5 C11.5 10 12 15 13.5 19" stroke="#d95f24" strokeWidth="1" fill="none" />
      <path d="M19.5 5.5 C20.5 10 20 15 18.5 19" stroke="#d95f24" strokeWidth="1" fill="none" />
      <circle cx="16" cy="12.5" r="2.4" fill="#5a3d24" />
    </svg>
  )
}

export function Garden() {
  const flowerRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      FLOWERS.forEach((flower, index) => {
        const el = flowerRefs.current[index]
        if (!el) return

        // The stem base, from the spec table — never from getBoundingClientRect,
        // which would force layout on every mouse move and also wobble with the
        // sway transform itself.
        const x = (flower.left / 100) * window.innerWidth + (flower.size * 32) / 80
        const y = window.innerHeight - flower.bottom

        const near = Math.hypot(event.clientX - x, event.clientY - y) < STIR_RADIUS
        el.classList.toggle('garden__flower--stirred', near)
      })
    }

    // The whole popup is one small window, so listening on it catches the
    // cursor even while it is over the cards the flowers peek out behind.
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div className="garden" aria-hidden="true">
      <span className="garden__cloud garden__cloud--a" />
      <span className="garden__cloud garden__cloud--b" />
      <span className="garden__leaf garden__leaf--a" />
      <span className="garden__leaf garden__leaf--b" />
      <span className="garden__leaf garden__leaf--c" />
      <span className="garden__spark garden__spark--a" />
      <span className="garden__spark garden__spark--b" />
      <span className="garden__spark garden__spark--c" />

      {/* Leaves the gust tears loose. Their animation runs on the same 12.5s
          period as garden-gust, so they enter exactly as the wave bends the
          leftmost plants and cross the garden with it — the wind becomes
          visible as the thing carrying them. */}
      <span className="garden__gustleaf garden__gustleaf--a" />
      <span className="garden__gustleaf garden__gustleaf--b" />
      <span className="garden__gustleaf garden__gustleaf--c" />

      {/* One butterfly, appearing occasionally: most of its long cycle is
          spent elsewhere. It flies in low, dwells at two of the flowers below,
          then spirals off — the flower positions in its keyframe path
          (popup.css) match the FLOWERS table above. */}
      <span className="garden__butterfly">
        <Butterfly />
      </span>

      {FLOWERS.map((flower, index) => (
        <span
          key={index}
          ref={(el) => {
            flowerRefs.current[index] = el
          }}
          className="garden__flower"
          style={{
            left: `${flower.left}%`,
            bottom: flower.bottom,
            width: (flower.size * 32) / 40,
            height: flower.size,
            animationDelay: `${flower.delay}s`,
            animationDuration: `${flower.duration}s`,
            ['--gust-delay' as string]: `${(flower.left * GUST_SECONDS_PER_PERCENT).toFixed(2)}s`,
          }}
        >
          {flower.kind === 'daisy' ? <Daisy /> : <Poppy />}
        </span>
      ))}

      {/* The flip lives on the svg's inner group (see popup.css), NOT on this
          span: a mirrored ancestor would mirror the gust bend too, and half the
          garden would lean into the wind instead of away from it. */}
      {TUFTS.map((tuft, index) => (
        <span
          key={index}
          className={`garden__tuft ${tuft.flip ? 'garden__tuft--flip' : ''}`}
          style={{
            left: `${tuft.left}%`,
            bottom: tuft.bottom,
            width: (tuft.size * 40) / 24,
            height: tuft.size,
            animationDuration: `${tuft.duration}s`,
            animationDelay: `${-index * 1.7}s`,
            ['--gust-delay' as string]: `${(tuft.left * GUST_SECONDS_PER_PERCENT).toFixed(2)}s`,
          }}
        >
          <Tuft />
        </span>
      ))}
    </div>
  )
}
