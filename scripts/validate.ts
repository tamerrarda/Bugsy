/**
 * Content validation rules for Bugsy snippets.
 *
 * Pure on purpose: no filesystem, no process, no imports. `seed.ts` is the CLI
 * shell that reads files and calls in here, which lets these rules be unit
 * tested directly — they are the only thing standing between a broken snippet
 * and the players, so they cannot themselves be untested.
 */

// Must stay in step with extension/src/types/index.ts and scripts/runners.mjs.
// A language listed here but missing a runner would let unverifiable content in.
export const LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'csharp',
  'c',
  'cpp',
  'rust',
] as const
export const CATEGORIES = [
  'off-by-one',
  'null-undefined',
  'wrong-operator',
  'scope',
  'async',
  'mutation',
  'type-coercion',
  'logic',
] as const

export const MIN_LINES = 10
export const MAX_LINES = 25

/**
 * Java and C# charge a ceremony tax that is not part of the puzzle: imports, a
 * class wrapper, and the closing braces for both. A 25-line budget therefore buys
 * ~25 lines of puzzle in Python and ~18 in Java. Rather than force authors to
 * mangle realistic Java into the smaller box, pay the tax explicitly — the amount
 * of code the player actually has to reason about stays the same.
 */
const MAX_LINES_BY_LANGUAGE: Record<string, number> = {
  java: 30,
  csharp: 30,
}

export function maxLinesFor(language: unknown): number {
  return typeof language === 'string' ? (MAX_LINES_BY_LANGUAGE[language] ?? MAX_LINES) : MAX_LINES
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A comment or identifier that hands the player the answer. */
const GIVEAWAY_RE = /\b(bug|BUG|FIXME|XXX|wrong|broken|should be)\b/

export interface ValidationInput {
  /** Path relative to content/, e.g. "javascript/off-by-one/recent-entries.json". */
  relPath: string
  /** The parsed JSON. Deliberately unknown — validating it is the point. */
  raw: unknown
  /** id -> the file that already claimed it, for duplicate detection. */
  seenIds: Map<string, string>
  /** slug -> the file that already claimed it. See the slug check below. */
  seenSlugs?: Map<string, string>
}

/** Returns a list of human-readable errors. Empty means valid. */
export function validateChallenge({
  relPath,
  raw,
  seenIds,
  seenSlugs,
}: ValidationInput): string[] {
  const errors: string[] = []
  const err = (msg: string) => errors.push(msg)

  // The slug must be unique across the WHOLE repo, not just within its folder.
  // `drivers/` is a flat namespace keyed by slug, so two snippets in different
  // categories sharing a basename would fight over one driver file — and the
  // loser would be silently "proven" by the winner's driver.
  const slug = (relPath.split('/').pop() ?? '').replace(/\.json$/, '')
  if (seenSlugs) {
    const claimed = seenSlugs.get(slug)
    if (claimed !== undefined && claimed !== relPath) {
      err(`duplicate slug "${slug}" — also used by ${claimed}; drivers/ is keyed by slug`)
    } else {
      seenSlugs.set(slug, relPath)
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ['must be a JSON object']
  }

  const c = raw as Record<string, unknown>

  // id — stable across reseeds, so it must be a real UUID and globally unique.
  if (typeof c['id'] !== 'string' || !UUID_RE.test(c['id'])) {
    err('id must be a uuid')
  } else if (seenIds.has(c['id'])) {
    err(`duplicate id, also used by ${seenIds.get(c['id'])}`)
  } else {
    seenIds.set(c['id'], relPath)
  }

  const language = c['language']
  const category = c['category']

  if (typeof language !== 'string' || !(LANGUAGES as readonly string[]).includes(language)) {
    err(`language must be one of ${LANGUAGES.join(' | ')}`)
  }
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    err(`category must be one of ${CATEGORIES.join(' | ')}`)
  }
  if (c['difficulty'] !== 1 && c['difficulty'] !== 2 && c['difficulty'] !== 3) {
    err('difficulty must be 1, 2 or 3')
  }
  if (typeof c['explanation'] !== 'string' || c['explanation'].trim().length < 20) {
    err('explanation must be a real sentence (>= 20 chars)')
  }
  if (typeof c['source'] !== 'string' || c['source'].length === 0) {
    err('source is required')
  }
  if (typeof c['active'] !== 'boolean') {
    err('active must be a boolean')
  }

  // Routing flag, not a runtime field. `guest: true` puts a snippet in the
  // bundled demo pool that unauthenticated players get; it is then NEVER seeded
  // into the database. Everything else is server-only and never bundled. The two
  // pools must not intersect, or a signed-in player could read the answers to
  // scored challenges straight out of the extension bundle.
  if (c['guest'] !== undefined && typeof c['guest'] !== 'boolean') {
    err('guest must be a boolean when present')
  }

  const code = c['code']
  if (typeof code !== 'string' || code.length === 0) {
    err('code is required')
    return errors
  }

  const lines = code.split('\n')
  const maxLines = maxLinesFor(language)
  if (lines.length < MIN_LINES || lines.length > maxLines) {
    err(`code must be ${MIN_LINES}-${maxLines} lines, got ${lines.length}`)
  }
  if (code.includes('\t')) {
    err('code must use spaces, not tabs (tab width breaks line alignment in the popup)')
  }
  if (GIVEAWAY_RE.test(code)) {
    err('code contains a comment/identifier that gives the bug away')
  }

  const bugLine = c['bugLine']
  if (typeof bugLine !== 'number' || !Number.isInteger(bugLine)) {
    err('bugLine must be an integer')
  } else if (bugLine < 1 || bugLine > lines.length) {
    err(`bugLine ${bugLine} is outside the snippet (1..${lines.length})`)
  } else if ((lines[bugLine - 1] ?? '').trim().length === 0) {
    err(`bugLine ${bugLine} points at a blank line`)
  }

  // The folder layout is part of the contract: content/{language}/{category}/
  const segments = relPath.split('/')
  if (segments.length >= 3) {
    if (segments[0] !== language) {
      err(`file is under ${segments[0]}/ but language is "${String(language)}"`)
    }
    if (segments[1] !== category) {
      err(`file is under ${segments[1]}/ but category is "${String(category)}"`)
    }
  } else {
    err('must live at content/{language}/{category}/{name}.json')
  }

  return errors
}
