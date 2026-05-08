/**
 * Proves every snippet's bug FAILS OBSERVABLY.
 *
 * A snippet whose "bug" quietly produces the correct answer is an unsolvable
 * puzzle — the player has no evidence to reason from, so the answer is
 * arbitrary. One shipped that way before this check existed: an off-by-one that
 * read one past the end of an array, where `undefined > max` is false, so the
 * function returned the right answer every single time.
 *
 * Hence: every snippet must come with a DRIVER that runs it and prints
 * `OBSERVED: <what actually went wrong>`.
 *
 *   drivers/<slug>.mjs   JavaScript — appended to the snippet, so it can call
 *   drivers/<slug>.py    Python       the snippet's own functions directly
 *
 * A snippet with no driver is a FAILURE, not a skip. That is the whole point: it
 * must be impossible to add content without also proving the bug is real.
 *
 *   node scripts/verify-content.mjs           check every snippet
 *   node scripts/verify-content.mjs <slug>    check one
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNNERS } from './runners.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'content')
const DRIVERS = join(ROOT, 'drivers')

const only = process.argv[2] ?? null

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.json')) out.push(full)
  }
  return out
}

const files = walk(CONTENT).sort()
let pass = 0
const unproven = []

for (const file of files) {
  const slug = file.split('/').pop().replace('.json', '')
  if (only && slug !== only) continue

  const challenge = JSON.parse(readFileSync(file, 'utf8'))
  const runner = RUNNERS[challenge.language]

  if (!runner) {
    unproven.push(slug)
    console.log(`✗ ${slug.padEnd(22)} NO RUNNER for ${challenge.language} — see scripts/runners.mjs`)
    continue
  }

  const driverPath = join(DRIVERS, `${slug}.${runner.ext}`)

  if (!existsSync(driverPath)) {
    unproven.push(slug)
    console.log(`✗ ${slug.padEnd(22)} NO DRIVER — write drivers/${slug}.${runner.ext}`)
    continue
  }

  // Compiles (where the language needs it) and runs snippet + driver together.
  const output = runner.run(challenge.code, readFileSync(driverPath, 'utf8'))

  const observed = output.split('\n').find((line) => line.includes('OBSERVED:'))

  if (observed) {
    pass++
    console.log(`✓ ${slug.padEnd(22)} ${observed.split('OBSERVED:')[1].trim().slice(0, 88)}`)
  } else {
    unproven.push(slug)
    const tail = output.trim().split('\n').slice(-2).join(' | ').slice(0, 96)
    console.log(`✗ ${slug.padEnd(22)} bug NOT observable — ${tail || 'driver printed nothing'}`)
  }
}

console.log(`\n${'='.repeat(66)}`)
console.log(`${pass} snippet bug(s) proven observable, ${unproven.length} unproven`)

if (unproven.length > 0) {
  console.log(`\nUnproven: ${unproven.join(', ')}`)
  console.log('A bug that produces the correct answer is an unsolvable puzzle. Fix or remove it.')
  process.exit(1)
}
