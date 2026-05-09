import { useEffect, useState } from 'react'
import { LANGUAGE_LABEL, type Language } from '../types'
import { supabase } from '../lib/supabase'
import { Bugsy } from './Bugsy'

/**
 * Picks the daily track.
 *
 * Only languages with a real daily are offered. `daily_tracks` is a view over the
 * challenge pool that returns a language only if it has at least one active
 * snippet at EVERY difficulty — otherwise the set could not be built and the
 * player would tap "Play today's challenge" and get an error. Offering a track we
 * cannot serve would be the rudest possible bug.
 */
export function TrackPicker({
  current,
  onPick,
}: {
  current: Language | null
  onPick: (language: Language) => void
}) {
  const [tracks, setTracks] = useState<Language[] | null>(null)

  useEffect(() => {
    void supabase
      .from('daily_tracks')
      .select('language')
      .then(({ data }) => {
        setTracks((data ?? []).map((row) => row.language as Language))
      })
  }, [])

  if (tracks === null) {
    return <p className="muted center">Bugsy is checking which tracks are open…</p>
  }

  return (
    <div className="tracks">
      <Bugsy mood="happy" size={64} />

      <h2 className="tracks__title">Pick your language</h2>
      <p className="tracks__body">
        Three fresh bugs a day, in the language you actually write. Everyone on your track
        gets the same three, so your result means something.
      </p>

      <div className="tracks__grid">
        {tracks.map((language) => (
          <button
            key={language}
            type="button"
            className={`track ${current === language ? 'track--active' : ''}`}
            onClick={() => onPick(language)}
          >
            {LANGUAGE_LABEL[language]}
          </button>
        ))}
      </div>

      <p className="tracks__note">You can switch tracks any time in Settings.</p>
    </div>
  )
}
