// Voice mode toggle: text-labeled chip + credits counter, replacing
// the icon-only speaker button that used to sit in the chat status
// bar. The old icon was too quiet about both its function and its
// disabled-because-no-credits state — users were silently locked out
// without realizing why.
//
// Behavior:
//   - When voice_credits > 0: clicking flips voiceEnabled.
//   - When voice_credits === 0 AND voiceEnabled is currently OFF:
//     clicking opens the no-credits modal instead of silently
//     disabling. Once paid top-ups land, the modal's "buy" button
//     wires up to real flow; for now the button is shown disabled
//     with a "(coming soon)" suffix in its label.
//   - When voice_credits === 0 AND voiceEnabled is currently ON:
//     clicking still flips OFF (don't trap the user mid-session).

import { useEffect, useState } from 'react';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface Props {
  voiceEnabled: boolean;
  voiceCredits: number | null;
  /** Toggle handler. Parent is responsible for stopping in-flight TTS
   *  when flipping off — VoiceModeButton just signals intent. */
  onToggle: () => void;
}

export default function VoiceModeButton({
  voiceEnabled,
  voiceCredits,
  onToggle,
}: Props) {
  const { lang } = useLang();
  const [showNoCreditsModal, setShowNoCreditsModal] = useState(false);

  const isExhausted = voiceCredits != null && voiceCredits <= 0;

  // Esc closes the no-credits modal — every other modal in the app
  // (hangup-confirm, favorites-remove, affinity-details, login,
  // level-up ceremony) has it; missing here would feel inconsistent.
  useEffect(() => {
    if (!showNoCreditsModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNoCreditsModal(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNoCreditsModal]);

  const handleClick = () => {
    // Block the off→on flip when the user has zero credits — surface
    // the explainer modal instead of silently doing nothing.
    if (!voiceEnabled && isExhausted) {
      setShowNoCreditsModal(true);
      return;
    }
    onToggle();
  };

  return (
    <>
      <button
        type="button"
        className={`voice-mode-btn ${voiceEnabled ? 'voice-mode-on' : 'voice-mode-off'} ${isExhausted ? 'voice-mode-exhausted' : ''}`}
        onClick={handleClick}
        aria-pressed={voiceEnabled}
        title={voiceEnabled ? t('chat.voiceDisable', lang) : t('chat.voiceEnable', lang)}
      >
        {/* Speaker glyph kept small alongside the text — gives the
            button a visual anchor without going back to icon-only. */}
        <svg
          className="voice-mode-icon"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {voiceEnabled ? (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </>
          ) : (
            <>
              <line x1="22" y1="9" x2="16" y2="15" />
              <line x1="16" y1="9" x2="22" y2="15" />
            </>
          )}
        </svg>
        <span className="voice-mode-label">
          {voiceEnabled ? t('chat.voiceModeOn', lang) : t('chat.voiceModeOff', lang)}
        </span>
        {voiceCredits != null && (
          <span className="voice-mode-credits">{voiceCredits}</span>
        )}
      </button>

      {showNoCreditsModal && (
        <div
          className="voice-credits-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-credits-modal-title"
          onClick={() => setShowNoCreditsModal(false)}
        >
          <div
            className="voice-credits-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="voice-credits-modal-title" className="voice-credits-modal-title">
              {t('chat.voiceCreditsModalTitle', lang)}
            </div>
            <div className="voice-credits-modal-desc">
              {t('chat.voiceCreditsModalDesc', lang)}
            </div>
            <div className="voice-credits-modal-actions">
              {/* Top-up button is intentionally inert until payment
                  integration ships. The "(coming soon)" suffix in the
                  label is the only signal — no inline message, no
                  toast, no aria-live noise. When the real flow lands,
                  drop `disabled` and add an onClick. */}
              <button
                type="button"
                className="voice-credits-modal-buy"
                disabled
                aria-disabled="true"
              >
                {t('chat.voiceCreditsModalBuy', lang)}
              </button>
              <button
                type="button"
                className="voice-credits-modal-later"
                onClick={() => setShowNoCreditsModal(false)}
              >
                {t('chat.voiceCreditsModalLater', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
