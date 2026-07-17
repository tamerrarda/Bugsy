import { useCallback, useEffect, useState } from 'react'
import { LANGUAGES, LANGUAGE_LABEL } from '../types'
import type { AttemptResult, DailySet, Language, PublicChallenge } from '../types'
import { getProfile, signInWithGitHub, signOut, type AuthUser } from '../lib/auth'
import { getApi } from '../lib/session'
import { guestHasPractice, guestLanguages } from '../lib/localServer'
import { cacheDailyStreak, markPlayedToday, notifyBadges } from '../lib/badge'
import {
  getOnboarded,
  getSettings,
  markOnboarded,
  setDailyTrack,
  setPreferredDifficulty,
  setPreferredLanguage,
  type DifficultyPreference,
  type LanguagePreference,
} from '../lib/settings'
import { fetchStreaks, liveDailyStreak } from '../lib/streaks'
import { EMPTY_STATS, getHintSeen, getStats, markHintSeen, type LocalStats } from '../lib/storage'
import { Bugsy } from '../components/Bugsy'
import { GameBoard } from '../components/GameBoard'
import { Garden } from '../components/Garden'
import { Leaderboard } from '../components/Leaderboard'
import { Onboarding } from '../components/Onboarding'
import { Profile } from '../components/Profile'
import { AllBadges } from '../components/AllBadges'
import { Settings } from '../components/Settings'
import { ShareCard } from '../components/ShareCard'
import { TrackPicker } from '../components/TrackPicker'
import { CodeSkeleton } from '../components/Skeleton'

type LanguageFilter = LanguagePreference

/** Named, not numbered: "hard" means something to a player, "3" does not. */
const DIFFICULTY_OPTIONS: { value: DifficultyPreference; label: string }[] = [
  { value: 'all', label: 'any' },
  { value: 1, label: 'easy' },
  { value: 2, label: 'medium' },
  { value: 3, label: 'hard' },
]

/** Every language Bugsy ships, plus "any". Adding a language must not require editing this. */
const LANGUAGE_FILTERS: { value: LanguageFilter; label: string }[] = [
  { value: 'all', label: 'Any language' },
  ...LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_LABEL[language] })),
]

type Screen =
  | { name: 'home' }
  | { name: 'tour' }
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'practice'; challenge: PublicChallenge }
  | { name: 'daily'; set: DailySet; index: number }
  | { name: 'summary'; day: string; language: Language; results: boolean[] }
  | { name: 'tracks' }
  | { name: 'leaderboard' }
  | { name: 'profile' }
  | { name: 'badges' }
  | { name: 'settings' }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS)
  const [language, setLanguage] = useState<LanguageFilter>('all')
  const [difficulty, setDifficulty] = useState<DifficultyPreference>('all')
  const [track, setTrack] = useState<Language | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [dailyStreak, setDailyStreak] = useState(0)
  const [authBusy, setAuthBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    void getHintSeen().then((seen) => setShowHint(!seen))
    void getSettings().then((s) => {
      setLanguage(s.preferredLanguage)
      setDifficulty(s.preferredDifficulty)
      setTrack(s.dailyTrack)
    })

    // First run gets the tour before anything else.
    void getOnboarded().then((seen) => {
      if (!seen) setScreen({ name: 'tour' })
    })

    void (async () => {
      const who = await getProfile()
      setProfile(who)

      if (!who) {
        // Guest: the only streak that exists is the local practice one.
        setStats(await getStats())
        return
      }

      // Signed in: the server is the source of truth for BOTH streaks. Reading
      // them here is what makes a streak survive closing the popup — and what
      // feeds the toolbar badge, since the service worker renders it from this
      // cache and has no other way to learn the number.
      const streaks = await fetchStreaks(who.id)
      if (!streaks) return

      const live = liveDailyStreak(streaks)

      setDailyStreak(live)
      setStats({
        accuracyCurrent: streaks.accuracyCurrent,
        accuracyBest: streaks.accuracyBest,
      })
      void cacheDailyStreak(live)
    })()
  }, [])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const chooseLanguage = useCallback((next: LanguageFilter) => {
    setLanguage(next)
    void setPreferredLanguage(next)
  }, [])

  const chooseDifficulty = useCallback((next: DifficultyPreference) => {
    setDifficulty(next)
    void setPreferredDifficulty(next)
  }, [])

  const fail = useCallback((message: string) => setScreen({ name: 'error', message }), [])

  const seenHint = useCallback(() => {
    if (showHint) {
      setShowHint(false)
      void markHintSeen()
    }
  }, [showHint])

  // ---------------- practice ----------------

  // Guests play the small bundled pool, which covers a couple of languages and
  // not every difficulty. The filters must only offer what that pool can serve
  // — an option that matches nothing dead-ends in an error screen, the same
  // rudeness TrackPicker exists to avoid. Signed-in players get the full list.
  const guestPool = profile === null ? guestLanguages() : null

  const languageOptions = guestPool
    ? LANGUAGE_FILTERS.filter(({ value }) => value === 'all' || guestPool.includes(value))
    : LANGUAGE_FILTERS

  // A signed-in preference (say Rust) outlives the session that set it. As a
  // guest it may match nothing — play "all" rather than serving the error, and
  // let the stored preference resurface on the next sign-in.
  const effectiveLanguage =
    guestPool && language !== 'all' && !guestPool.includes(language) ? 'all' : language

  const difficultyAvailable = (value: DifficultyPreference): boolean =>
    guestPool === null ||
    value === 'all' ||
    guestHasPractice({
      ...(effectiveLanguage === 'all' ? {} : { language: effectiveLanguage }),
      difficulty: value,
    })

  const effectiveDifficulty = difficultyAvailable(difficulty) ? difficulty : 'all'

  const playPractice = useCallback(async () => {
    setScreen({ name: 'loading' })
    try {
      const api = await getApi()
      const challenge = await api.getPractice({
        ...(effectiveLanguage === 'all' ? {} : { language: effectiveLanguage }),
        ...(effectiveDifficulty === 'all' ? {} : { difficulty: effectiveDifficulty }),
      })
      setScreen({ name: 'practice', challenge })
    } catch (error) {
      fail(messageFor(error))
    }
  }, [effectiveLanguage, effectiveDifficulty, fail])

  // ---------------- daily ----------------

  const playDaily = useCallback(async (language: Language) => {
    setScreen({ name: 'loading' })
    try {
      const api = await getApi()
      const set = await api.getDaily(language)

      // Resume where the day was left off: the first challenge with no attempt.
      const answered = new Set(set.attempts.map((a) => a.challengeId))
      const index = set.challenges.findIndex((c) => !answered.has(c.id))

      if (index === -1) {
        // The whole day is already done — go straight to the summary rather than
        // making the user click through three revealed results.
        setScreen({
          name: 'summary',
          day: set.day,
          language: set.language,
          results: set.challenges.map(
            (c) => set.attempts.find((a) => a.challengeId === c.id)?.correct ?? false,
          ),
        })
        return
      }

      setScreen({ name: 'daily', set, index })
    } catch (error) {
      fail(messageFor(error))
    }
  }, [fail])

  /** The daily needs a track. Ask before playing rather than guessing. */
  const startDaily = useCallback(() => {
    if (track) {
      void playDaily(track)
    } else {
      setScreen({ name: 'tracks' })
    }
  }, [track, playDaily])

  const chooseTrack = useCallback(
    (language: Language) => {
      setTrack(language)
      void setDailyTrack(language)
      void playDaily(language)
    },
    [playDaily],
  )

  const onDailyResult = useCallback(
    (result: AttemptResult, clickedLine: number) => {
      seenHint()
      void markPlayedToday()
      void notifyBadges(result.newBadges)

      if (result.streaks.dailyCurrent > 0) {
        setDailyStreak(result.streaks.dailyCurrent)
        // Feed the toolbar badge. The service worker watches this key.
        void cacheDailyStreak(result.streaks.dailyCurrent)
      }

      setScreen((current) => {
        if (current.name !== 'daily') return current

        const challenge = current.set.challenges[current.index]
        if (!challenge) return current

        // Record the attempt locally so the summary and a resume both see it.
        const set: DailySet = {
          ...current.set,
          attempts: [
            ...current.set.attempts,
            {
              challengeId: challenge.id,
              clickedLine,
              correct: result.correct,
              points: result.points,
              bugLine: result.bugLine,
              explanation: result.explanation,
            },
          ],
        }

        return { ...current, set }
      })
    },
    [seenHint],
  )

  const nextDaily = useCallback(() => {
    setScreen((current) => {
      if (current.name !== 'daily') return current

      const next = current.index + 1
      if (next < current.set.challenges.length) {
        return { ...current, index: next }
      }

      return {
        name: 'summary',
        day: current.set.day,
        language: current.set.language,
        results: current.set.challenges.map(
          (c) => current.set.attempts.find((a) => a.challengeId === c.id)?.correct ?? false,
        ),
      }
    })
  }, [])

  // ---------------- auth ----------------

  const handleSignIn = useCallback(async () => {
    setAuthBusy(true)
    try {
      await signInWithGitHub()
      setProfile(await getProfile())
    } catch (error) {
      if (messageFor(error) !== 'Sign-in cancelled.') fail(messageFor(error))
    } finally {
      setAuthBusy(false)
    }
  }, [fail])

  const handleSignOut = useCallback(async () => {
    await signOut()
    setProfile(null)
    setDailyStreak(0)
    void cacheDailyStreak(0)
    setStats(await getStats())
    setScreen({ name: 'home' })
  }, [])

  // ---------------- render ----------------

  const home = () => setScreen({ name: 'home' })

  if (screen.name === 'tour') {
    return (
      <Shell>
        <Onboarding
          onDone={() => {
            void markOnboarded()
            home()
          }}
        />
      </Shell>
    )
  }

  if (screen.name === 'loading') {
    // A skeleton shaped like the code block, not a spinner: the popup must not
    // jump when the snippet lands, or the user's click misses the line they aimed at.
    return (
      <Shell onBack={home}>
        <CodeSkeleton />
      </Shell>
    )
  }

  if (screen.name === 'error') {
    return (
      <Shell>
        <div className="center">
          <Bugsy mood="dizzy" size={56} />
          <p className="error-message">{screen.message}</p>
          <button type="button" className="btn btn--primary" onClick={home}>
            Back
          </button>
        </div>
      </Shell>
    )
  }

  if (screen.name === 'practice') {
    return (
      <Shell onBack={home}>
        <GameBoard
          challenge={screen.challenge}
          mode="practice"
          showHint={showHint}
          nextLabel="Next bug"
          onNext={() => void playPractice()}
          onResult={(result) => {
            seenHint()
            // Practice can earn speed-10 and acc-10 too.
            void notifyBadges(result.newBadges)
            setStats({
              accuracyCurrent: result.streaks.accuracyCurrent,
              accuracyBest: result.streaks.accuracyBest,
            })
          }}
          onError={fail}
        />
      </Shell>
    )
  }

  if (screen.name === 'daily') {
    const challenge = screen.set.challenges[screen.index]
    if (!challenge) return null

    const answered = screen.set.attempts.find((a) => a.challengeId === challenge.id)
    const isLast = screen.index === screen.set.challenges.length - 1

    return (
      <Shell onBack={home}>
        <GameBoard
          key={challenge.id}
          challenge={challenge}
          mode="daily"
          showHint={showHint}
          progress={`${screen.index + 1} / ${screen.set.challenges.length}`}
          nextLabel={isLast ? 'See results' : 'Next'}
          onNext={nextDaily}
          onResult={onDailyResult}
          onError={fail}
          answered={
            answered
              ? {
                  clickedLine: answered.clickedLine,
                  result: {
                    correct: answered.correct,
                    bugLine: answered.bugLine,
                    explanation: answered.explanation,
                    points: answered.points,
                    // A resumed attempt is history: it awards nothing again.
                    streaks: {
                      dailyCurrent: dailyStreak,
                      dailyBest: 0,
                      accuracyCurrent: stats.accuracyCurrent,
                      accuracyBest: stats.accuracyBest,
                    },
                    newBadges: [],
                    dailyComplete: false,
                  },
                }
              : undefined
          }
        />
      </Shell>
    )
  }

  if (screen.name === 'tracks') {
    return (
      <Shell onBack={home}>
        <TrackPicker current={track} onPick={chooseTrack} />
      </Shell>
    )
  }

  if (screen.name === 'summary') {
    return (
      <Shell onBack={home}>
        <ShareCard
          day={screen.day}
          language={screen.language}
          results={screen.results}
          dailyStreak={dailyStreak}
          onDone={home}
        />
      </Shell>
    )
  }

  if (screen.name === 'leaderboard') {
    return (
      <Shell onBack={home} title="Leaderboard">
        <Leaderboard username={profile?.username ?? null} />
      </Shell>
    )
  }

  if (screen.name === 'profile') {
    return (
      <Shell onBack={home} title="Profile">
        {profile ? (
          <Profile profile={profile} onShowAllBadges={() => setScreen({ name: 'badges' })} />
        ) : (
          <p className="muted center">Sign in first.</p>
        )}
      </Shell>
    )
  }

  if (screen.name === 'badges') {
    // Back goes to the Profile, not home — this screen is reached from there,
    // and a back arrow that teleports you somewhere else is a small betrayal.
    return (
      <Shell onBack={() => setScreen({ name: 'profile' })} title="All badges">
        {profile ? (
          <AllBadges userId={profile.id} />
        ) : (
          <p className="muted center">Sign in first.</p>
        )}
      </Shell>
    )
  }

  if (screen.name === 'settings') {
    return (
      <Shell onBack={home} title="Settings">
        <Settings
          onLanguageChange={setLanguage}
          onTrackChange={(next) => {
            setTrack(next)
            void setDailyTrack(next)
          }}
        />
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Spec §6.3: v1 does not queue attempts offline, so say so plainly rather
          than letting the user start a round that cannot be submitted. */}
      {!online ? (
        <div className="offline" role="status">
          You&rsquo;re offline. Bugsy will be here when you&rsquo;re back.
        </div>
      ) : null}

      {/* The home screen is built on hierarchy, not inventory: one hero (Bugsy
          in his garden), one dominant action, and everything else either
          compressed into a strip or parked quietly at the bottom. The garden
          needs open space to be seen at all — crowding it with equal-weight
          boxes was how the old home lost both the scenery and the CTA. */}
      <div className="home">
        <div className="home__hero">
          <Bugsy mood={dailyStreak > 0 || stats.accuracyCurrent > 0 ? 'happy' : 'sleeping'} size={96} />
          <div className="home__sign">
            <h1 className="home__title">Bugsy</h1>
          </div>
          <p className="home__tagline">One bug per snippet. Find it before the timer does.</p>
        </div>

        {/* All three numbers in one slim strip. Three separate boxes gave the
            scoreboard the same visual rank as the play button; a strip states
            the facts and steps aside. Guests see no "daily" — they can't have one. */}
        <div className="statbar" role="group" aria-label="Your streaks">
          {profile ? (
            <>
              <StatItem icon="🔥" label="daily" value={dailyStreak} />
              <span className="statbar__divider" aria-hidden="true" />
            </>
          ) : null}
          <StatItem icon="⭐" label="streak" value={stats.accuracyCurrent} />
          <span className="statbar__divider" aria-hidden="true" />
          <StatItem icon="👑" label="best" value={stats.accuracyBest} />
        </div>

        <div className="home__actions">
          {profile ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={startDaily}
            >
              Play today&rsquo;s challenge
              <span className="btn__arrow" aria-hidden="true">❯</span>
            </button>
          ) : null}

          <button
            type="button"
            className={`btn btn--block ${profile ? 'btn--practice' : 'btn--primary'}`}
            onClick={() => void playPractice()}
          >
            <span className="btn__leaf" aria-hidden="true">🌱</span>
            Practice
            <span className="btn__arrow" aria-hidden="true">❯</span>
          </button>

          {/* Practice's own options, directly under Practice — filters mid-stack
              between the two buttons made them read as a third, unrelated thing.

              A native <select>, not a hand-rolled menu: keyboard and screen-reader
              behaviour arrive for free. The options come from LANGUAGES —
              narrowed, for guests, to what the bundled pool actually holds. */}
          <div className="filters">
            <label className="select">
              <span className="select__icon" aria-hidden="true">
                🌿
              </span>
              <select
                className="select__field"
                value={effectiveLanguage}
                aria-label="Practice language"
                onChange={(event) => chooseLanguage(event.target.value as LanguageFilter)}
              >
                {languageOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="select__caret" aria-hidden="true">
                ▾
              </span>
            </label>

            <div className="chips">
              {DIFFICULTY_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`chip chip--button ${effectiveDifficulty === value ? 'chip--active' : ''}`}
                  disabled={!difficultyAvailable(value)}
                  onClick={() => chooseDifficulty(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {profile ? (
          <div className="home__foot">
            {/* Quiet icon row, not three more boxes: navigation is a hallway,
                not a destination. */}
            <nav className="home__nav" aria-label="Sections">
              <button type="button" onClick={() => setScreen({ name: 'leaderboard' })}>
                <span className="nav__icon" aria-hidden="true">🏆</span>
                Leaderboard
              </button>
              <button type="button" onClick={() => setScreen({ name: 'profile' })}>
                <span className="nav__icon" aria-hidden="true">🐞</span>
                Profile
              </button>
              <button type="button" onClick={() => setScreen({ name: 'settings' })}>
                <span className="nav__icon" aria-hidden="true">⚙️</span>
                Settings
              </button>
            </nav>

            <div className="account">
              {profile.avatarUrl ? (
                <img className="account__avatar" src={profile.avatarUrl} alt="" />
              ) : null}
              <span className="account__name">{profile.username}</span>
              <button type="button" className="account__signout" onClick={() => void handleSignOut()}>
                sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="home__foot">
            <p className="guest-note">
              You&rsquo;re playing as a guest on a handful of snippets. Sign in for the daily
              challenge, the full set, points and the leaderboard.
            </p>
            <button
              type="button"
              className="btn btn--github btn--block"
              onClick={() => void handleSignIn()}
              disabled={authBusy}
            >
              {authBusy ? 'Waiting for GitHub…' : 'Sign in with GitHub'}
            </button>
          </div>
        )}
      </div>
    </Shell>
  )
}

function StatItem({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <span className="statbar__item">
      <span className="statbar__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="statbar__value">{value}</span>
      <span className="statbar__label">{label}</span>
    </span>
  )
}

function Shell({
  children,
  onBack,
  title,
}: {
  children: React.ReactNode
  onBack?: () => void
  title?: string
}) {
  return (
    <main className="shell">
      <Garden />
      {onBack ? (
        <div className="topbar">
          <button type="button" className="topbar__back" onClick={onBack}>
            ← Bugsy
          </button>
          {title ? <span className="topbar__title">{title}</span> : null}
        </div>
      ) : null}
      {children}
    </main>
  )
}

function messageFor(error: unknown): string {
  // Both API implementations already speak in Bugsy's voice, and the Edge
  // Functions never echo a raw Postgres error, so these are safe to show.
  return error instanceof Error ? error.message : 'Something came apart. Try again?'
}
