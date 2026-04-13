import { useState } from 'react';
import { markShared, getShareUrl, canShareForBonus } from '../utils/playLimit';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface Props {
  onUnlocked: () => void;
}

export default function ShareGate({ onUnlocked }: Props) {
  const { lang } = useLang();
  const [copied, setCopied] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const canShare = canShareForBonus('text');
  const sharesLeft = canShare ? 1 : 0;

  const shareUrl = getShareUrl();

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('share.title', lang),
          text: t('share.text', lang),
          url: shareUrl,
        });
        doUnlock();
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    try { await navigator.clipboard.writeText(shareUrl); } catch {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    doUnlock();
  };

  const doUnlock = () => {
    const ok = markShared('text');
    if (ok) {
      setUnlocked(true);
      setTimeout(() => onUnlocked(), 1200);
    }
  };

  const offlineLines = t('ended.offline', lang).split('\n');

  return (
    <div className="share-gate-overlay">
      <div className="share-gate-card">
        <div className="share-gate-icon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>

        {unlocked ? (
          <>
            <h2 className="share-gate-title">{t('gate.title.unlocked', lang)}</h2>
            <p className="share-gate-desc">{t('gate.unlocked.desc', lang)}</p>
          </>
        ) : canShare ? (
          <>
            <h2 className="share-gate-title">{t('gate.title.depleted', lang)}</h2>
            <p className="share-gate-desc">{t('gate.share.desc', lang, { n: sharesLeft })}</p>
            <button className="share-gate-btn" onClick={handleShare}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {copied ? t('ended.linkCopied', lang) : t('ended.shareToRefuel', lang)}
            </button>
          </>
        ) : (
          <>
            <h2 className="share-gate-title">{t('gate.title.offline', lang)}</h2>
            <p className="share-gate-desc">
              {offlineLines.map((line, i) => (
                <span key={i}>{line}{i < offlineLines.length - 1 && <br />}</span>
              ))}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
