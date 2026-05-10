import { useCallback, useEffect, useState } from 'react'
import { LANGUAGES, LANGUAGE_LABEL } from '../types'
import type { AttemptResult, DailySet, Language, PublicChallenge } from '../types'
import { getProfile, signInWithGitHub, signOut, type AuthUser } from '../lib/auth'
import { getApi } from '../lib/session'
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

  const playPractice = useCallback(async () => {
    setScreen({ name: 'loading' })
    try {
      const api = await getApi()
      const challenge = await api.getPractice({
        ...(language === 'all' ? {} : { language }),
        ...(difficulty === 'all' ? {} : { difficulty }),
      })
      setScreen({ name: 'practice', challenge })
    } catch (error) {
      fail(messageFor(error))
    }
  }, [language, difficulty, fail])

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

      <div className="home">
        <div className="home__crest">
          <Bugsy mood={dailyStreak > 0 || stats.accuracyCurrent > 0 ? 'happy' : 'sleeping'} size={84} />
          <div className="home__sign">
            <h1 className="home__title">Bugsy</h1>
          </div>
        </div>

        <p className="home__tagline">One bug per snippet. Find it before the timer does.</p>

        <div className="home__stats">
          <Stat icon="🔥" label="daily" value={dailyStreak} />
          <Stat icon="⭐" label="streak" value={stats.accuracyCurrent} />
          <Stat icon="👑" label="best" value={stats.accuracyBest} />
        </div>

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

        {/* Practice filters. Both were already honoured end to end — the server
            takes language and difficulty, and so does the guest pool; only the UI
            had never surfaced difficulty. */}
        <div className="filters">
          {/* A native <select>, not a hand-rolled menu. Nine languages as chips ate
              two rows and pushed Practice toward the fold; a dropdown costs one
              line. Native also means keyboard and screen-reader behaviour arrive
              for free — a custom popup would have had to reimplement both, badly.

              The options come from LANGUAGES. They were once a hand-written
              ['all', 'javascript', 'python'], which went quietly stale the day the
              other six languages shipped: the content was there, the filter was not. */}
          <label className="select">
            <span className="select__icon" aria-hidden="true">
              🌿
            </span>
            <select
              className="select__field"
              value={language}
              aria-label="Practice language"
              onChange={(event) => chooseLanguage(event.target.value as LanguageFilter)}
            >
              {LANGUAGE_FILTERS.map(({ value, label }) => (
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
                className={`chip chip--button ${difficulty === value ? 'chip--active' : ''}`}
                onClick={() => chooseDifficulty(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={`btn btn--block ${profile ? 'btn--practice' : 'btn--primary'}`}
          onClick={() => void playPractice()}
        >
          <span className="btn__leaf" aria-hidden="true">🌱</span>
          Practice
          <span className="btn__arrow" aria-hidden="true">❯</span>
        </button>

        {profile ? (
          <>
            <nav className="home__nav">
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
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </Shell>
  )
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="stat">
      <span className="stat__row">
        <span className="stat__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="stat__value">{value}</span>
      </span>
      <span className="stat__label">{label}</span>
    </div>
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
      <div className="garden" aria-hidden="true" />
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
