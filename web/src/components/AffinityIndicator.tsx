// Inline affinity progress strip that lives in the chat mode-bar.
//
// Replaces the static "LATENCY 4.2ly" flavor text with something
// actually informative: current level name + a thin progress bar +
// percentage to next level. Tap opens AffinityDetailsModal for the
// full per-level breakdown.
//
// Updates: rapport (and thus progress) only changes after a session
// is consolidated server-side. We don't pretend it ticks live during
// chat — the parent re-runs fetchMe on level-up / session start and
// passes the latest values down. No real-time polling needed.

import { useLang } from '../i18n/LangContext';
import { t, type TranslationKey } from '../i18n';

interface Props {
  level: number;
  progressToNext: number | null; // 0–100, null at max level
  onClick: () => void;
}

export default function AffinityIndicator({ level, progressToNext, onClick }: Props) {
  const { lang } = useLang();
  const safeLevel = Math.min(4, Math.max(1, level));
  const levelName = t(`level.${safeLevel}.name` as TranslationKey, lang);
  const isMax = progressToNext === null;
  const pct = isMax ? 100 : Math.max(0, Math.min(100, progressToNext ?? 0));

  return (
    <button
      type="button"
      className={`affinity-strip ${isMax ? 'affinity-strip-max' : ''}`}
      onClick={onClick}
      aria-label={t('affinity.detailsTitle', lang)}
    >
      <span className="affinity-strip-label">
        {t('affinity.indicator', lang, { n: safeLevel, name: levelName })}
      </span>
      <span className="affinity-strip-divider">·</span>
      <span className="affinity-strip-progress">
        {isMax
          ? t('affinity.max', lang)
          : t('affinity.progress', lang, { p: pct, n: safeLevel + 1 })}
      </span>
      <span className="affinity-strip-bar" aria-hidden="true">
        <span
          className="affinity-strip-fill"
          style={{ width: `${pct}%` }}
        />
      </span>
    </button>
  );
}
