/**
 * Content validator / emitter for Bugsy snippets.
 *
 *   node scripts/seed.ts --check    validate content/ and exit non-zero on any error
 *   node scripts/seed.ts --emit     validate, then write the bundle the extension plays from
 *   node scripts/seed.ts            (Milestone 2) validate + upsert into Postgres
 *
 * The rules themselves live in validate.ts, which is pure and unit tested. This
 * file is only the filesystem + CLI shell around them.
 *
 * Zero dependencies on purpose — it runs in CI and in npm pre-hooks, and Node 22
 * strips the types natively. `npx tsx scripts/seed.ts` works too.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateChallenge } from './validate.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_DIR = join(ROOT, 'content')
const EMIT_PATH = join(ROOT, 'extension', 'src', 'generated', 'challenges.json')

interface Challenge {
  id: string
  language: string
  difficulty: number
  category: string
  code: string
  bugLine: number
  explanation: string
  source: string
  active: boolean
  /** Build-time routing only — see splitPools(). Never stored, never shipped. */
  guest?: boolean
}

/**
 * The two pools, and why they must never intersect.
 *
 * Guest players play Practice without an account, which means their
 * challenges have to be answerable offline — the answers ship inside the
 * extension bundle. That is fine for them: a guest earns no points and appears on
 * no leaderboard, so knowing an answer buys nothing.
 *
 * It would NOT be fine for the scored pool. If a scored challenge were also
 * bundled, any signed-in player could read its bug line out of the extension and
 * top the leaderboard, which breaks anti-cheat rule 1 outright. So:
 *
 *   guest: true   -> bundled into the extension, never inserted into Postgres
 *   otherwise     -> inserted into Postgres, never bundled
 */
function splitPools(challenges: Challenge[]): { guest: Challenge[]; server: Challenge[] } {
  return {
    guest: challenges.filter((c) => c.guest === true),
    server: challenges.filter((c) => c.guest !== true),
  }
}

/** `guest` is a build-time flag; strip it so it never reaches disk or the DB. */
function stripGuestFlag(c: Challenge): Omit<Challenge, 'guest'> {
  const { guest: _guest, ...rest } = c
  return rest
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.json')) out.push(full)
  }
  return out
}

/**
 * Upserts the validated content into Postgres via PostgREST.
 *
 * Uses the service-role key, which bypasses RLS — that is the only way to write
 * `challenges`, since every client role has select revoked on it. This key lives
 * in the root .env (gitignored) and must NEVER appear anywhere under extension/.
 */
async function upsert(challenges: Challenge[]): Promise<void> {
  // Optional: --check and --emit never need credentials, so a missing .env is fine.
  try {
    process.loadEnvFile(join(ROOT, '.env'))
  } catch {
    // No .env — fall back to whatever is already in the environment (CI).
  }

  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !key) {
    console.error(
      '\nSeeding needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Copy .env.example to .env and fill it from `supabase status`.',
    )
    process.exit(1)
  }

  // Only the server pool. Guest snippets are deliberately never inserted — their
  // answers are already public inside the extension bundle, so serving them for
  // points would be handing out free wins.
  const { server, guest } = splitPools(challenges)

  // camelCase in the JSON, snake_case in the DB.
  const rows = server.map((c) => ({
    id: c.id,
    language: c.language,
    difficulty: c.difficulty,
    category: c.category,
    code: c.code,
    bug_line: c.bugLine,
    explanation: c.explanation,
    source: c.source,
    active: c.active,
  }))

  const response = await fetch(`${url}/rest/v1/challenges`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Upsert on the primary key, so re-seeding edits snippets in place rather
      // than duplicating them — ids are stable for exactly this reason.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })

  if (!response.ok) {
    console.error(`\nSeeding failed: ${response.status} ${await response.text()}`)
    process.exit(1)
  }

  // Upsert alone is not enough. A snippet that USED to be scored and has since
  // been moved into the guest pool (or deleted from content/) would otherwise sit
  // in the database, still active and still servable — while its answer now ships
  // inside the extension bundle. That is precisely the leak the two-pool split
  // exists to prevent, so retire everything that is no longer in the server pool.
  //
  // Deactivated rather than deleted: challenges are referenced by attempts, and
  // deleting one would cascade away real players' history. serve_practice only
  // ever picks `active` rows, so active=false takes it out of circulation.
  //
  // Compute the retirement list HERE rather than asking Postgres to do it with
  // `id=not.in.(...every kept id...)`. That is what this used to do, and it broke
  // the moment the pool grew: 345 UUIDs in a query string is ~13 KB and PostgREST
  // answers 414 URI Too Long. The retirement step then failed — silently, as far
  // as a casual read of the output went — and a guest snippet stayed live and
  // scorable in the database with its answer sitting in the shipped bundle.
  //
  // The set being retired is almost always empty, and never large. The set being
  // KEPT grows without bound. Put the small one in the URL.
  const keep = new Set(rows.map((r) => r.id))

  const activeNow = (await fetch(`${url}/rest/v1/challenges?active=eq.true&select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).then((r) => r.json())) as { id: string }[]

  const toRetire = activeNow.map((c) => c.id).filter((id) => !keep.has(id))

  const retired: { id: string }[] = []

  // Chunked, so a mass withdrawal cannot reintroduce the same URI limit.
  for (let i = 0; i < toRetire.length; i += 50) {
    const chunk = toRetire.slice(i, i + 50)

    const response = await fetch(`${url}/rest/v1/challenges?id=in.(${chunk.join(',')})`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ active: false }),
    })

    if (!response.ok) {
      console.error(
        `\nRetiring withdrawn challenges failed: ${response.status} ${await response.text()}`,
      )
      process.exit(1)
    }

    retired.push(...((await response.json()) as { id: string }[]))
  }

  console.log(
    `\n→ upserted ${rows.length} scored challenge(s) into ${url}` +
      `\n  held back ${guest.length} guest-pool snippet(s) — those ship in the extension bundle instead` +
      (retired.length > 0
        ? `\n  retired ${retired.length} challenge(s) no longer in the server pool (active=false)`
        : ''),
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const emit = args.includes('--emit')

  // content/ (the challenge answers) is kept OUT of the public repo — publishing
  // bugLine for every snippet would let anyone top the leaderboard. A fresh
  // clone therefore has no content/ to build from, and the pre-dev/build/test
  // hooks call this with --emit. In that case the committed guest bundle
  // (extension/src/generated/challenges.json) is already what the extension
  // needs, so skip rather than crash. Seeding the DB, which genuinely needs the
  // content, still fails loudly.
  if (!existsSync(CONTENT_DIR)) {
    if (emit && existsSync(EMIT_PATH)) {
      console.log(
        'content/ is not present (kept private); using the committed guest bundle at\n' +
          `  ${relative(ROOT, EMIT_PATH)}`,
      )
      return
    }
    if (check) {
      console.log('content/ is not present (kept private); nothing to validate.')
      return
    }
    console.error(
      '\ncontent/ is not present. The challenge answers are private and are not in\n' +
        'this repository. Seeding the database needs them; ask the maintainer.',
    )
    process.exit(1)
  }

  const files = walk(CONTENT_DIR).sort()
  const seenIds = new Map<string, string>()
  const seenSlugs = new Map<string, string>()
  const challenges: Challenge[] = []
  let failed = 0

  for (const file of files) {
    // Always forward-slashed, so the folder-layout rule behaves the same on Windows.
    const relPath = relative(CONTENT_DIR, file).split(sep).join('/')

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.error(`✗ content/${relPath}\n    invalid JSON: ${(e as Error).message}`)
      failed++
      continue
    }

    const errors = validateChallenge({ relPath, raw, seenIds, seenSlugs })
    if (errors.length > 0) {
      console.error(`✗ content/${relPath}`)
      for (const e of errors) console.error(`    ${e}`)
      failed++
      continue
    }

    challenges.push(raw as Challenge)
  }

  const byLang: Record<string, number> = {}
  const byDiff: Record<number, number> = {}
  for (const c of challenges) {
    byLang[c.language] = (byLang[c.language] ?? 0) + 1
    byDiff[c.difficulty] = (byDiff[c.difficulty] ?? 0) + 1
  }

  console.log(
    `\n${challenges.length} valid snippet(s)` +
      (failed > 0 ? `, ${failed} invalid` : '') +
      `\n  by language: ${Object.entries(byLang).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}` +
      `\n  by difficulty: ${[1, 2, 3].map((d) => `d${d} ${byDiff[d] ?? 0}`).join(', ')}`,
  )

  if (failed > 0) {
    console.error(`\n${failed} file(s) failed validation.`)
    process.exit(1)
  }

  const { guest, server } = splitPools(challenges)

  if (guest.length === 0) {
    console.error('\nNo guest-pool snippets. Guests would have nothing to play.')
    process.exit(1)
  }

  if (emit) {
    // ONLY the guest pool is bundled. This is the line that keeps the answers to
    // scored challenges out of the shipped extension.
    mkdirSync(dirname(EMIT_PATH), { recursive: true })
    writeFileSync(EMIT_PATH, JSON.stringify(guest.map(stripGuestFlag), null, 2) + '\n')

    console.log(
      `\n→ wrote ${relative(ROOT, EMIT_PATH)} with ${guest.length} guest-pool snippet(s)` +
        `\n  (${server.length} scored snippet(s) deliberately excluded — they live only in Postgres)`,
    )
    return
  }

  if (check) return

  await upsert(challenges)
}

await main()
