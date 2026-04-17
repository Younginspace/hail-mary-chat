import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { useLang } from '../i18n/LangContext';
import { t, type TranslationKey } from '../i18n';
import type { LevelUpPayload } from '../utils/sessionApi';

interface Props {
  payload: LevelUpPayload;
  onClose: () => void;
}

export default function LevelUpCeremony({ payload, onClose }: Props) {
  const { lang } = useLang();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, scale: 0.92, y: 20 },
      { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: 'power3.out' }
    );
  }, []);

  const fromName = t(`level.${payload.from}.name` as TranslationKey, lang);
  const toName = t(`level.${payload.to}.name` as TranslationKey, lang);

  return (
    <div className="levelup-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className="levelup-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="levelup-sparkles" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="levelup-eyebrow">LV {payload.from} → LV {payload.to}</div>
        <div className="levelup-title">{t('level.upTitle', lang)}</div>
        <div className="levelup-badge">
          <span className="levelup-badge-from">{fromName}</span>
          <span className="levelup-badge-arrow">→</span>
          <span className="levelup-badge-to">{toName}</span>
        </div>

        <ul className="levelup-bonuses">
          {payload.image_credits > 0 && (
            <li>{t('level.upImageBonus', lang, { n: payload.image_credits })}</li>
          )}
          {payload.music_credits > 0 && (
            <li>{t('level.upMusicBonus', lang, { n: payload.music_credits })}</li>
          )}
          {payload.video_credits > 0 && (
            <li>{t('level.upVideoBonus', lang, { n: payload.video_credits })}</li>
          )}
          <li>
            {/* voice bonus is computed server-side; the ceremony shows fixed per-level totals */}
            {t('level.upVoiceBonus', lang, {
              n: payload.to === 2 ? 10 : payload.to === 3 ? 30 : payload.to === 4 ? 50 : 0,
            })}
          </li>
        </ul>

        <button type="button" className="levelup-continue" onClick={onClose}>
          {t('level.upContinue', lang)}
        </button>
      </div>
    </div>
  );
}
