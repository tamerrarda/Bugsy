/**
 * Shared types. These mirror the DB schema and the Edge
 * Function contracts (§5.4) exactly — when the backend lands in Milestone 2,
 * these types must not need to change.
 *
 * The central invariant of this file: `bugLine` and `explanation` live on
 * `Challenge` (server/authoring side) and on `AttemptResult` (post-attempt
 * reveal). They do NOT exist on `PublicChallenge`, which is the only shape the
 * game screen is ever allowed to hold. This is enforced by the type system, not
 * by convention.
 */

/**
 * Adding a language means four things, and skipping any of them ships broken
 * content: this list, a Shiki grammar in lib/highlight.ts, a runner in
 * scripts/runners.mjs (a language we cannot RUN is a language whose bugs we
 * cannot prove), and a daily track (each language has its own daily,
 * so a Rust developer is not handed three JavaScript snippets).
 */
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
export type Language = (typeof LANGUAGES)[number]

/** What a player should see. "csharp" and "cpp" are ids, not names. */
export const LANGUAGE_LABEL: Record<Language, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
  c: 'C',
  cpp: 'C++',
  rust: 'Rust',
}

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
export type BugCategory = (typeof CATEGORIES)[number]

/** 1 = easy (~20s for a mid-level dev), 3 = hard (~60s). */
export type Difficulty = 1 | 2 | 3

export const MODES = ['daily', 'practice'] as const
export type GameMode = (typeof MODES)[number]

/**
 * A challenge with its answer attached. This is the authoring/DB shape.
 *
 * SECURITY: never hand one of these to a component. In Milestone 2 this type
 * only ever exists inside Edge Functions. In Milestone 1 it exists locally
 * (there is no server yet), but is confined to `lib/grader.ts`.
 */
export interface Challenge {
  id: string
  language: Language
  difficulty: Difficulty
  category: BugCategory
  code: string
  /** 1-indexed line number of the single buggy line. */
  bugLine: number
  explanation: string
  source: string
  active: boolean
}

/**
 * A challenge as the client is allowed to see it, before an attempt.
 * This is the exact shape returned by `get-daily` / `get-practice`.
 */
export type PublicChallenge = Pick<
  Challenge,
  'id' | 'language' | 'difficulty' | 'category' | 'code'
>

export interface Streaks {
  dailyCurrent: number
  dailyBest: number
  accuracyCurrent: number
  accuracyBest: number
}

/**
 * Mirror of the `badges` table. A test asserts the two agree, because a badge
 * the server can award but the client doesn't know about is a badge that shows
 * up as a blank tile.
 */
export const BADGE_IDS = [
  'first-daily',
  'streak-5',
  'streak-10',
  'streak-25',
  'streak-50',
  'streak-100',
  'streak-365',
  'daily-perfect',
  'speed-10',
  'speed-5',
  'speed-hard',
  'acc-10',
  'acc-25',
  'acc-50',
  'solved-1',
  'solved-10',
  'solved-50',
  'solved-100',
  'solved-250',
  'hard-10',
  'hard-50',
  'lang-javascript',
  'lang-typescript',
  'lang-python',
  'lang-java',
  'lang-csharp',
  'lang-c',
  'lang-cpp',
  'lang-rust',
  'polyglot',
  'entomologist',
] as const
export type BadgeId = (typeof BADGE_IDS)[number]

export interface Badge {
  id: BadgeId
  name: string
  description: string
  icon: string
}

/** A catalogue row: a badge plus where it belongs on the "All badges" screen. */
export interface BadgeCatalogueEntry extends Badge {
  family: string
  sort: number
  earned: boolean
}

/** Request body for `POST /submit-attempt`. */
export interface SubmitAttemptRequest {
  challengeId: string
  mode: GameMode
  clickedLine: number
}

/**
 * Response from `POST /submit-attempt`. This is the ONLY place the true bug
 * line and the explanation are ever revealed to the client.
 */
export interface AttemptResult {
  correct: boolean
  bugLine: number
  explanation: string
  points: number
  streaks: Streaks
  newBadges: Badge[]
  /** True on the attempt that completed all three of today's daily challenges. */
  dailyComplete: boolean
}

/**
 * An attempt the user already made today, as returned by `get-daily`. It carries
 * the answer, which is correct: the attempt exists, so the answer is spent.
 * This is what lets a half-finished day resume with its results still showing.
 */
export interface DailyAttempt {
  challengeId: string
  clickedLine: number
  correct: boolean
  points: number
  bugLine: number
  explanation: string
}

/** Response from `GET /get-daily`. */
export interface DailySet {
  /** UTC date, `YYYY-MM-DD`. */
  day: string
  /** The track. Everyone playing this language today gets these same three. */
  language: Language
  challenges: PublicChallenge[]
  attempts: DailyAttempt[]
}

/** A row of any of the three leaderboard views. */
export interface LeaderboardRow {
  username: string
  avatarUrl: string | null
  points: number
  rank: number
}

export const LEADERBOARD_PERIODS = ['daily', 'weekly', 'alltime'] as const
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number]
