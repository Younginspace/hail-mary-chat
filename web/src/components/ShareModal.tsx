import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface ShareModalProps {
  url: string;
  onShared: () => void;
  onClose: () => void;
}

export default function ShareModal({ url, onShared, onClose }: ShareModalProps) {
  const { lang } = useLang();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const hasNativeShare = !!navigator.share;
  const sharedRef = useRef(false);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#00d4aa', light: '#0a1628' } })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [url]);

  const markShared = useCallback(() => {
    if (!sharedRef.current) {
      sharedRef.current = true;
      onShared();
    }
  }, [onShared]);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(url); } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    markShared();
  }, [url, markShared]);

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: t('share.title', lang),
        text: t('share.text', lang),
        url,
      });
      markShared();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') markShared();
    }
  }, [url, lang, markShared]);

  const labels: Record<string, Record<string, string>> = {
    title: { zh: '分享给朋友', en: 'Share with friends', ja: '友達にシェア' },
    qrHint: { zh: '扫码打开', en: 'Scan to open', ja: 'スキャンして開く' },
    copy: { zh: '复制链接', en: 'Copy link', ja: 'リンクをコピー' },
    copied: { zh: '已复制!', en: 'Copied!', ja: 'コピー済み!' },
    more: { zh: '更多分享方式', en: 'More options', ja: 'その他の方法' },
    close: { zh: '关闭', en: 'Close', ja: '閉じる' },
  };

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="share-modal-title">{labels.title[lang]}</h3>

        {qrDataUrl && (
          <div className="share-modal-qr">
            <img src={qrDataUrl} alt="QR Code" />
            <span className="share-modal-qr-hint">{labels.qrHint[lang]}</span>
          </div>
        )}

        <div className="share-modal-actions">
          <button className="share-modal-btn share-modal-btn-copy" onClick={handleCopy}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? labels.copied[lang] : labels.copy[lang]}
          </button>

          {hasNativeShare && (
            <button className="share-modal-btn share-modal-btn-native" onClick={handleNativeShare}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {labels.more[lang]}
            </button>
          )}
        </div>

        <button className="share-modal-close" onClick={onClose}>{labels.close[lang]}</button>
      </div>
    </div>
  );
}
