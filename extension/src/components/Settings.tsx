import { useEffect, useState } from 'react'
import { LANGUAGES, LANGUAGE_LABEL, type Language } from '../types'
import {
  DEFAULT_SETTINGS,
  getSettings,
  setDailyTrack,
  setNotificationsEnabled,
  setPreferredLanguage,
  type LanguagePreference,
  type Settings as SettingsValue,
} from '../lib/settings'
import { supabase } from '../lib/supabase'

interface SettingsProps {
  /** Lifts the language choice so the home screen's filter stays in sync. */
  onLanguageChange: (language: LanguagePreference) => void
  /** Lifts the daily track, so the next "Play today's challenge" uses it. */
  onTrackChange: (language: Language) => void
}

const PRACTICE_OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'all', label: 'Any language' },
  ...LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_LABEL[language] })),
]

export function Settings({ onLanguageChange, onTrackChange }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsValue>(DEFAULT_SETTINGS)
  const [tracks, setTracks] = useState<Language[]>([])

  useEffect(() => {
    void getSettings().then(setSettings)

    // Only tracks that actually have a daily. The view guarantees content at
    // every difficulty, so we never offer a track that would fail on tap.
    void supabase
      .from('daily_tracks')
      .select('language')
      .then(({ data }) => setTracks((data ?? []).map((row) => row.language as Language)))
  }, [])

  const toggleNotifications = async () => {
    const next = !settings.notificationsEnabled
    setSettings((s) => ({ ...s, notificationsEnabled: next }))
    // The service worker reads this key directly before firing the daily nudge.
    await setNotificationsEnabled(next)
  }

  const pickPractice = async (language: LanguagePreference) => {
    setSettings((s) => ({ ...s, preferredLanguage: language }))
    await setPreferredLanguage(language)
    onLanguageChange(language)
  }

  const pickTrack = async (language: Language) => {
    setSettings((s) => ({ ...s, dailyTrack: language }))
    await setDailyTrack(language)
    onTrackChange(language)
  }

  return (
    <div className="settings">
      <label className="setting">
        <div>
          <span className="setting__name">Daily reminder</span>
          <span className="setting__hint">
            One nudge a day when fresh bugs land. Nothing else, ever.
          </span>
        </div>
        <input
          type="checkbox"
          className="setting__toggle"
          checked={settings.notificationsEnabled}
          onChange={() => void toggleNotifications()}
        />
      </label>

      {/* The daily track. The track picker promises this setting exists — for a
          while it did not, which made that promise a lie. */}
      <div className="setting">
        <div>
          <span className="setting__name">Daily challenge</span>
          <span className="setting__hint">
            The language your three daily bugs come in. Everyone on your track gets the same
            three.
          </span>
        </div>
        <Dropdown
          icon="🔥"
          ariaLabel="Daily challenge language"
          value={settings.dailyTrack ?? ''}
          onChange={(value) => void pickTrack(value as Language)}
          options={[
            ...(settings.dailyTrack === null ? [{ value: '', label: 'Not picked' }] : []),
            ...tracks.map((language) => ({
              value: language,
              label: LANGUAGE_LABEL[language],
            })),
          ]}
        />
      </div>

      <div className="setting">
        <div>
          <span className="setting__name">Practice language</span>
          <span className="setting__hint">Which snippets Bugsy serves you in Practice.</span>
        </div>
        <Dropdown
          icon="🌿"
          ariaLabel="Practice language"
          value={settings.preferredLanguage}
          onChange={(value) => void pickPractice(value as LanguagePreference)}
          options={PRACTICE_OPTIONS}
        />
      </div>

      <p className="settings__note">
        Bugsy stores your GitHub username, avatar and scores. Nothing else, and never your
        code or your browsing.
      </p>
    </div>
  )
}

function Dropdown({
  icon,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  icon: string
  ariaLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="select select--setting">
      <span className="select__icon" aria-hidden="true">
        {icon}
      </span>
      <select
        className="select__field"
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="select__caret" aria-hidden="true">
        ▾
      </span>
    </label>
  )
}
