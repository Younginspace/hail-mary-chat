// Full-screen bedtime story player. Opened from a 🌙 button in the
// chat top bar. Lists the 3 stories with affinity-level gating, lets
// the user pick one, plays it via HTML5 audio (lock-screen-safe),
// supports a sleep timer with fade-out.
//
// Audio infra: useBedtimeAudio. Story metadata: data/bedtimeStories.
//
// MP3s are pre-rendered by scripts/gen-bedtime-stories.sh — until the
// owner runs that script (post-script-review), the audio paths 404
// and the player surfaces a "audio not rendered yet" empty state.

import { useState, useCallback, useEffect } from 'react';
import {
  BEDTIME_STORIES,
  bedtimeAudioPath,
  isStoryUnlocked,
  type BedtimeStoryId,
  type BedtimeStoryMeta,
} from '../data/bedtimeStories';
import { useBedtimeAudio } from '../hooks/useBedtimeAudio';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface BedtimePlayerProps {
  /** True = modal open. False = unmounted, no audio. */
  open: boolean;
  /** User's current affinity level — gates which stories are unlocked. */
  userLevel: number;
  /** Called when the user closes the modal (X or backdrop click). */
  onClose: () => void;
}

type SleepOption = 'off' | '5min' | '15min' | '30min';

const SLEEP_OPTION_MS: Record<SleepOption, number | null> = {
  off: null,
  '5min': 5 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '30min': 30 * 60 * 1000,
};

export default function BedtimePlayer({ open, userLevel, onClose }: BedtimePlayerProps) {
  const { lang } = useLang();
  const [selectedId, setSelectedId] = useState<BedtimeStoryId | null>(null);
  const [sleepOption, setSleepOption] = useState<SleepOption>('off');

  const selectedStory = selectedId
    ? BEDTIME_STORIES.find((s) => s.id === selectedId) ?? null
    : null;

  const audioSrc = selectedStory ? bedtimeAudioPath(selectedStory.id, lang) : null;
  const audio = useBedtimeAudio({
    src: audioSrc,
    title: selectedStory?.title[lang],
    artist: 'Rocky',
    // Skip artwork until we have a 512x512 raster Rocky icon in /public.
    // MediaSession on Android/Chrome will 404 a missing artwork URL on
    // every play; cleaner to pass undefined and let the OS fall back to
    // a default. TODO: drop a real PNG into web/public/ then wire here.
    artworkSrc: undefined,
    sleepTimerMs: SLEEP_OPTION_MS[sleepOption],
    onEnded: useCallback(() => {
      // Story finished naturally — drop back to the list view.
      setSelectedId(null);
      setSleepOption('off');
    }, []),
  });

  // Reset on close so reopening starts at the list.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSleepOption('off');
    }
  }, [open]);

  const handleClose = useCallback(async () => {
    if (audio.playing) {
      // Polite fade-out instead of hard cut when user exits mid-story.
      await audio.fadeOutAndStop(800);
    }
    onClose();
  }, [audio, onClose]);

  if (!open) return null;

  return (
    <div className="bedtime-backdrop" role="dialog" aria-modal="true" onClick={handleClose}>
      <div className="bedtime-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bedtime-modal-header">
          <span className="bedtime-modal-title">
            <span aria-hidden="true">🌙</span> {t('bedtime.title', lang)}
          </span>
          <button
            type="button"
            className="bedtime-modal-close"
            onClick={handleClose}
            aria-label={t('bedtime.close', lang)}
          >
            ✕
          </button>
        </header>

        {selectedStory ? (
          <PlayerView
            story={selectedStory}
            playing={audio.playing}
            position={audio.position}
            duration={audio.duration}
            loading={audio.loading}
            error={audio.error}
            sleepOption={sleepOption}
            onTogglePlay={() => void audio.togglePlay()}
            onSeek={audio.seek}
            onSleepChange={setSleepOption}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <StoryList
            userLevel={userLevel}
            onPick={(id) => setSelectedId(id)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Story list ────────────────────────────────────────────────────

function StoryList({
  userLevel,
  onPick,
}: {
  userLevel: number;
  onPick: (id: BedtimeStoryId) => void;
}) {
  const { lang } = useLang();
  return (
    <div className="bedtime-list">
      <p className="bedtime-list-hint">{t('bedtime.listHint', lang)}</p>
      {BEDTIME_STORIES.map((s) => {
        const unlocked = isStoryUnlocked(s, userLevel);
        return (
          <button
            key={s.id}
            type="button"
            className={`bedtime-card ${unlocked ? '' : 'bedtime-card--locked'}`}
            onClick={unlocked ? () => onPick(s.id) : undefined}
            aria-disabled={!unlocked}
            disabled={!unlocked}
          >
            <span className="bedtime-card-title">{s.title[lang]}</span>
            <span className="bedtime-card-subtitle">{s.subtitle[lang]}</span>
            <span className="bedtime-card-meta">
              ~{Math.round(s.approxDurationSec / 60)} {t('bedtime.minutesShort', lang)}
              {!unlocked && (
                <span className="bedtime-card-lock">
                  🔒 {t('bedtime.lockedAt', lang, { level: String(s.requiredLevel) })}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Player view ───────────────────────────────────────────────────

function PlayerView({
  story,
  playing,
  position,
  duration,
  loading,
  error,
  sleepOption,
  onTogglePlay,
  onSeek,
  onSleepChange,
  onBack,
}: {
  story: BedtimeStoryMeta;
  playing: boolean;
  position: number;
  duration: number;
  loading: boolean;
  error: 'not_found' | 'decode_failed' | 'unknown' | null;
  sleepOption: SleepOption;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onSleepChange: (opt: SleepOption) => void;
  onBack: () => void;
}) {
  const { lang } = useLang();

  // Any audio error (404, decode, unknown) gets the same empty-state
  // surface. The audioNotReady copy is intentionally generic — owner
  // hasn't run gen-bedtime-stories.sh yet (404), or MiniMax produced a
  // bad mp3 (decode), or something else broke; user-facing message is
  // the same: "Rocky 还在录这段，先回去聊聊？".
  if (error) {
    return (
      <div className="bedtime-player">
        <button type="button" className="bedtime-player-back" onClick={onBack}>
          ← {t('bedtime.backToList', lang)}
        </button>
        <h2 className="bedtime-player-title">{story.title[lang]}</h2>
        <div className="bedtime-player-empty">
          {t('bedtime.audioNotReady', lang)}
        </div>
      </div>
    );
  }

  return (
    <div className="bedtime-player">
      <button type="button" className="bedtime-player-back" onClick={onBack}>
        ← {t('bedtime.backToList', lang)}
      </button>
      <h2 className="bedtime-player-title">{story.title[lang]}</h2>
      <p className="bedtime-player-subtitle">{story.subtitle[lang]}</p>

      <div className="bedtime-player-controls">
        <button
          type="button"
          className="bedtime-player-play"
          onClick={onTogglePlay}
          disabled={loading}
          aria-label={playing ? t('bedtime.pause', lang) : t('bedtime.play', lang)}
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>

      <div className="bedtime-player-scrubber">
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={1}
          value={position}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={!duration}
          aria-label={t('bedtime.seek', lang)}
        />
        <span className="bedtime-player-time">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>

      <div className="bedtime-player-sleep">
        <span className="bedtime-player-sleep-label">{t('bedtime.sleepTimer', lang)}:</span>
        <div className="bedtime-player-sleep-options" role="radiogroup">
          {(['off', '5min', '15min', '30min'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`bedtime-sleep-opt ${sleepOption === opt ? 'is-active' : ''}`}
              onClick={() => onSleepChange(opt)}
              role="radio"
              aria-checked={sleepOption === opt}
            >
              {opt === 'off'
                ? t('bedtime.sleepOff', lang)
                : t(`bedtime.sleep${opt === '5min' ? '5' : opt === '15min' ? '15' : '30'}` as
                    | 'bedtime.sleep5'
                    | 'bedtime.sleep15'
                    | 'bedtime.sleep30', lang)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
