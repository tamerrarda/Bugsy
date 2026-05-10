import type {
  AttemptResult,
  DailySet,
  Difficulty,
  Language,
  PublicChallenge,
  SubmitAttemptRequest,
} from '../types'

export interface PracticeFilters {
  language?: Language
  difficulty?: Difficulty
}

/**
 * The contract between the game UI and whatever is serving it.
 *
 * There are two implementations, and which one you get depends on whether you are
 * signed in:
 *
 *   guest  -> localServer.ts, playing the small demo pool bundled in the
 *             extension. No points, no leaderboard.
 *   signed  -> serverApi.ts, calling the Supabase Edge Functions. Scored, ranked,
 *      in     and the answers live only on the server.
 *
 * The two challenge pools do not overlap (see scripts/seed.ts): guest snippets are
 * never inserted into the database, and scored snippets are never bundled. That is
 * what lets guest mode exist at all without handing signed-in players the answers
 * to the scored pool.
 */
export interface BugsyApi {
  /** `GET /get-practice` — one challenge, answer fields stripped. */
  getPractice(filters?: PracticeFilters): Promise<PublicChallenge>

  /**
   * `GET /get-daily` — today's three challenges on the given TRACK, plus any
   * already answered.
   *
   * The daily is per-language. With eight languages, three shared
   * slots cannot represent them all, and a Rust developer handed three C# snippets
   * either loses their streak or clicks blindly. Everyone on the same track still
   * gets the same three — so anti-cheat rule 4 holds and the emoji grid stays
   * comparable against the people you would actually compare yourself to.
   *
   * Guests cannot play Daily: it is scored and ranked, so it needs an account.
   */
  getDaily(language: Language): Promise<DailySet>

  /**
   * `POST /submit-attempt` — grades the attempt and reveals the answer.
   * Rejects if the challenge was never served, or was served over five minutes
   * ago, or if `clickedLine` is out of range, or if it was already answered.
   */
  submitAttempt(req: SubmitAttemptRequest): Promise<AttemptResult>
}
