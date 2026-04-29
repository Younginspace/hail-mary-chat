// Full per-level breakdown modal, opened from AffinityIndicator (and
// from the voice-credits-exhausted banner when the user wants to know
// how to earn more).
//
// 4-card horizontal carousel. Each card shows level name + tagline +
// perks. Current level is highlighted; future levels are shown
// "locked" but still describe what unlocks. Default-opens on the
// user's current level so the most relevant card is in view.
//
// Interaction:
//   - prev/next arrow buttons cycle through levels 1–4
//   - mobile: horizontal swipe (touchstart/touchend dx threshold)
//   - keyboard: ArrowLeft / ArrowRight cycle, Esc closes
//   - tap backdrop or ✕ to close

import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n/LangContext';
import { t, type TranslationKey } from '../i18n';

interface Props {
  currentLevel: number;
  progressToNext: number | null;
  onClose: () => void;
}

const LEVELS = [1, 2, 3, 4] as const;
const SWIPE_THRESHOLD = 50; // px — minimum horizontal travel to count

export default function AffinityDetailsModal({ currentLevel, progressToNext, onClose }: Props) {
  const { lang } = useLang();
  const safeCurrent = Math.min(4, Math.max(1, currentLevel)) as 1 | 2 | 3 | 4;
  // Default-show the user's current level so the most relevant card is
  // already in view when the modal opens.
  const [selectedLevel, setSelectedLevel] = useState<number>(safeCurrent);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Keyboard nav: ←/→ cycle through cards, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        setSelectedLevel((l) => Math.max(1, l - 1));
      } else if (e.key === 'ArrowRight') {
        setSelectedLevel((l) => Math.min(4, l + 1));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move keyboard focus into the dialog so screen readers announce it
  // and Tab order doesn't strand the user on the page behind.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // Multi-touch guard: pinch-zoom or two-finger gestures shouldn't
    // be interpreted as a swipe. Bail on anything other than a single
    // finger touch — touchEnd then sees touchStartXRef === null and
    // skips. Without this, lifting one finger of a pinch zoom can
    // produce a phantom dx > threshold and cycle the carousel.
    if (e.touches.length > 1) {
      touchStartXRef.current = null;
      return;
    }
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartXRef.current;
    touchStartXRef.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx > 0) {
      // swipe right = previous level
      setSelectedLevel((l) => Math.max(1, l - 1));
    } else {
      setSelectedLevel((l) => Math.min(4, l + 1));
    }
  };

  return (
    <div
      className="affinity-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="affinity-modal-title"
      onClick={onClose}
    >
      <div
        className="affinity-modal-card"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="affinity-modal-header">
          <span id="affinity-modal-title" className="affinity-modal-title">
            {t('affinity.detailsTitle', lang)}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            className="affinity-modal-close"
            onClick={onClose}
            aria-label={t('affinity.close', lang)}
          >
            ✕
          </button>
        </div>

        <div className="affinity-modal-stage">
          {/* Navigation: mobile = horizontal swipe (handled at the
              card container's onTouchStart/End); desktop = the dot
              row at the bottom. The prev/next arrow buttons that
              used to live here were removed — they read as
              decorative chrome that didn't pull weight against the
              dots, and on mobile they competed with the swipe gesture. */}
          <div className="affinity-modal-cards">
            {LEVELS.map((lv) => {
              const isCurrent = lv === safeCurrent;
              const isLocked = lv > safeCurrent;
              const isShown = lv === selectedLevel;
              return (
                <div
                  key={lv}
                  className={[
                    'affinity-card',
                    isShown ? 'affinity-card-active' : '',
                    isCurrent ? 'affinity-card-current' : '',
                    isLocked ? 'affinity-card-locked' : '',
                  ].filter(Boolean).join(' ')}
                  aria-hidden={!isShown}
                >
                  <div className="affinity-card-eyebrow">
                    LV {lv}
                    {isCurrent && (
                      <span className="affinity-card-pill affinity-card-pill-current">
                        {t('affinity.currentBadge', lang)}
                      </span>
                    )}
                    {isLocked && (
                      <span className="affinity-card-pill affinity-card-pill-locked">
                        {t('affinity.lockedBadge', lang)}
                      </span>
                    )}
                  </div>
                  <div className="affinity-card-name">
                    {t(`level.${lv}.name` as TranslationKey, lang)}
                  </div>
                  <div className="affinity-card-tagline">
                    {t(`level.${lv}.tagline` as TranslationKey, lang)}
                  </div>
                  <div className="affinity-card-perks">
                    {t(`level.${lv}.perks` as TranslationKey, lang)}
                  </div>
                  {isCurrent && progressToNext !== null && (
                    <div className="affinity-card-progress">
                      <div className="affinity-card-progress-bar" aria-hidden="true">
                        <div
                          className="affinity-card-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, progressToNext))}%` }}
                        />
                      </div>
                      <div className="affinity-card-progress-label">
                        {t('affinity.progress', lang, { p: progressToNext, n: lv + 1 })}
                      </div>
                    </div>
                  )}
                  {isCurrent && progressToNext === null && (
                    <div className="affinity-card-progress affinity-card-progress-max">
                      {t('affinity.max', lang)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="affinity-modal-dots" role="tablist">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              role="tab"
              aria-selected={lv === selectedLevel}
              className={`affinity-modal-dot ${lv === selectedLevel ? 'is-active' : ''}`}
              onClick={() => setSelectedLevel(lv)}
              aria-label={`LV${lv} ${t(`level.${lv}.name` as TranslationKey, lang)}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
