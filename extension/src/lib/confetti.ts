/**
 * Confetti on a correct answer.
 *
 * Lazy-loaded: the module is only fetched the first time someone actually gets
 * one right, so a player who is still warming up never downloads it. It is also
 * entirely optional — if the import fails, the game carries on without it.
 *
 * Respects `prefers-reduced-motion`. A burst of particles is exactly the kind of
 * thing that setting exists to suppress, and skipping it costs the player nothing.
 */

const FLAME = '#FF6B35'
const CREAM = '#F5E9D9'
const SHELL = '#D4491B'

// Typed by inference: canvas-confetti's default export is a callable that also
// carries helper properties, and spelling that out by hand does not typecheck.
const importConfetti = () => import('canvas-confetti').then((module) => module.default)

let load: ReturnType<typeof importConfetti> | null = null

export async function celebrate(): Promise<void> {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  try {
    load ??= importConfetti()
    const confetti = await load

    await confetti({
      particleCount: 70,
      spread: 68,
      startVelocity: 32,
      gravity: 1.1,
      scalar: 0.85,
      ticks: 140,
      // Fire from just above the result card rather than the very top, so the
      // burst reads as coming from Bugsy.
      origin: { x: 0.5, y: 0.62 },
      colors: [FLAME, CREAM, SHELL],
      disableForReducedMotion: true,
    })
  } catch {
    // Cosmetic. Never let a failed confetti import break the game.
  }
}
