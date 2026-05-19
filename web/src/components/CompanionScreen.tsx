import { useEffect, useState, useCallback } from 'react';
import { useCompanionAudio } from '../hooks/useCompanionAudio';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import type { SleepTimerOption } from '../utils/companionSleepTimer';
import { SLEEP_TIMER_OPTIONS_MIN } from '../utils/companionSleepTimer';

interface Props {
  onDone: () => void;
}

export default function CompanionScreen({ onDone }: Props) {
  const { lang } = useLang();
  const audio = useCompanionAudio({ onDone });
  const [dim, setDim] = useState<boolean>(() => {
    try {
      return localStorage.getItem('companionDim') === 'true';
    } catch {
      return false;
    }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chromeFlash, setChromeFlash] = useState(false);

  // Persist dim toggle
  useEffect(() => {
    try {
      localStorage.setItem('companionDim', String(dim));
    } catch {
      /* localStorage unavailable — silent */
    }
  }, [dim]);

  // Escape key closes companion at any phase
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        audio.stop();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [audio]);

  // Tap-anywhere in dim mode → 3s chrome flash
  const handleScreenTap = useCallback(() => {
    if (!dim) return;
    setChromeFlash(true);
  }, [dim]);

  // Auto-redim after 3s
  useEffect(() => {
    if (!chromeFlash) return;
    const id = setTimeout(() => setChromeFlash(false), 3000);
    return () => clearTimeout(id);
  }, [chromeFlash]);

  const showFullChrome = !dim || chromeFlash;
  const minutesLabel = (m: SleepTimerOption) =>
    m === 'off' ? t('companion.timer.off', lang) : `${m} min`;
  const elapsedFmt = formatTime(audio.elapsedMs);
  const remainingFmt = audio.sleepTimer === 'off' ? '' : formatTime(audio.remainingMs);

  return (
    <div
      className={`companion-root ${dim && !chromeFlash ? 'companion-dim' : ''}`}
      onClick={handleScreenTap}
      role="application"
      aria-label={t('companion.aria.root', lang)}
    >
      {showFullChrome && (
        <>
          <button
            className="companion-dim-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setDim((d) => !d);
            }}
            aria-label={t(dim ? 'companion.aria.dimOff' : 'companion.aria.dimOn', lang)}
            type="button"
          >
            ☾
          </button>
          <button
            className="companion-exit"
            onClick={(e) => {
              e.stopPropagation();
              audio.stop();
            }}
            aria-label={t('companion.aria.exit', lang)}
            type="button"
          >
            ✕
          </button>
        </>
      )}

      <div className="companion-center">
        <div className="companion-dot" aria-hidden="true" />
        <div className="companion-label">
          {audio.phase === 'loading' && t('companion.label.tuning', lang)}
          {audio.phase === 'ready' && t('companion.label.ready', lang)}
          {audio.phase === 'playing' && t('companion.label.online', lang)}
          {audio.phase === 'fading' && t('companion.label.fading', lang)}
          {audio.phase === 'error' && t('companion.label.error', lang)}
        </div>

        {audio.phase === 'playing' && showFullChrome && (
          <div className="companion-elapsed" aria-live="polite">
            {elapsedFmt}
          </div>
        )}

        {audio.phase === 'ready' && (
          <button
            className="companion-start"
            onClick={(e) => {
              e.stopPropagation();
              audio.start();
            }}
            autoFocus
            type="button"
          >
            ▶ {t('companion.tapToStart', lang)}
          </button>
        )}

        {audio.phase === 'error' && (
          <button
            className="companion-retry"
            onClick={(e) => {
              e.stopPropagation();
              audio.retry();
            }}
            type="button"
          >
            {t('companion.retry', lang)}
          </button>
        )}
      </div>

      {(audio.phase === 'ready' || audio.phase === 'playing') && showFullChrome && (
        <button
          className="companion-timer-pill"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((o) => !o);
          }}
          aria-label={t('companion.aria.timerPill', lang)}
          type="button"
        >
          ⏱ {minutesLabel(audio.sleepTimer)}
          {audio.phase === 'playing' && remainingFmt && ` · ${remainingFmt}`}
        </button>
      )}

      {pickerOpen && (
        <div
          className="companion-timer-picker"
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          {SLEEP_TIMER_OPTIONS_MIN.map((opt) => (
            <button
              key={opt}
              className={
                audio.sleepTimer === opt
                  ? 'companion-timer-option active'
                  : 'companion-timer-option'
              }
              onClick={() => {
                audio.setSleepTimer(opt);
                setPickerOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              {minutesLabel(opt)}
            </button>
          ))}
        </div>
      )}

      {dim && !chromeFlash && (
        <div className="companion-dim-bar">
          🛰 Rocky · {elapsedFmt}
          {audio.sleepTimer !== 'off' && remainingFmt && ` · ${remainingFmt}`}
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
