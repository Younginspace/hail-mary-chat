import { useCallback, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import type { GiftAttachment } from '../hooks/useChat';
import type { Lang } from '../i18n';
import { t } from '../i18n';

interface Props {
  gift: GiftAttachment;
  lang: Lang;
}

async function composeImageDownload(
  node: HTMLElement,
  filename: string
): Promise<void> {
  // Rasterize the composed node (image + overlay) to a PNG so users get
  // what they see, not the raw pre-overlay generation. html2canvas
  // handles cross-origin presigned URLs via `useCORS: true` and the
  // R2 URL response which sets `Access-Control-Allow-Origin: *`.
  const canvas = await html2canvas(node, {
    useCORS: true,
    backgroundColor: null,
    scale: 2, // 2x for retina-quality downloads
    logging: false,
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }, 'image/png');
}

function typeLabel(gift: GiftAttachment, lang: Lang): string {
  if (gift.type === 'image') {
    if (gift.subtype === 'realistic') return t('gift.typeRealistic', lang);
    if (gift.subtype === 'comic') return t('gift.typeComic', lang);
    return t('gift.typeImage', lang);
  }
  if (gift.type === 'music') return t('gift.typeMusic', lang);
  return t('gift.typeVideo', lang);
}

function downloadFilename(gift: GiftAttachment): string {
  const ext =
    gift.type === 'image'
      ? gift.content_type?.includes('png') ? 'png' : 'jpg'
      : gift.type === 'music'
        ? 'mp3'
        : 'mp4';
  const suffix = gift.subtype ? `-${gift.subtype}` : '';
  return `rocky-gift-${gift.type}${suffix}-${Date.now()}.${ext}`;
}

export default function GiftBubble({ gift, lang }: Props) {
  const composedRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const title = typeLabel(gift, lang);

  const handleComposedDownload = useCallback(
    async (ev: React.MouseEvent<HTMLAnchorElement>) => {
      const node = composedRef.current;
      if (!node) return; // fall through to <a download> default behaviour
      ev.preventDefault();
      if (downloading) return;
      setDownloading(true);
      try {
        await composeImageDownload(node, downloadFilename(gift));
      } catch (err) {
        console.warn('composed download failed, falling back to raw', err);
        const a = document.createElement('a');
        a.href = gift.url ?? '';
        a.download = downloadFilename(gift);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        setDownloading(false);
      }
    },
    [downloading, gift]
  );

  if (gift.status === 'pending') {
    return (
      <div className="gift-bubble pending">
        <div className="gift-title">{title}</div>
        <div className="gift-status">
          <span className="gift-pulse" />
          {t('gift.pending', lang)}
        </div>
        {gift.description && <div className="gift-desc">{gift.description}</div>}
      </div>
    );
  }

  if (gift.status === 'failed') {
    return (
      <div className="gift-bubble failed">
        <div className="gift-title">{title}</div>
        <div className="gift-status">{t('gift.failed', lang)}</div>
      </div>
    );
  }

  if (!gift.url) return null;

  // Image subtypes get a composed layout: generated image + overlay text
  // (top banner for realistic, bottom signature for comic). Download
  // button still grabs the raw generated image — html2canvas composite
  // of the overlay is a v2 follow-up.
  if (gift.type === 'image') {
    const realistic = gift.subtype === 'realistic';
    const comic = gift.subtype === 'comic';
    return (
      <div className="gift-bubble ready">
        <div className="gift-title">{title}</div>
        <div
          ref={composedRef}
          className={`gift-compose ${realistic ? 'realistic' : ''} ${comic ? 'comic' : ''}`}
        >
          <img
            className="gift-media gift-image"
            src={gift.url}
            alt={gift.description}
            loading="lazy"
            crossOrigin="anonymous"
          />
          {realistic && gift.caption && (
            <div className="gift-overlay gift-overlay-top">{gift.caption}</div>
          )}
          {comic && (
            <div className="gift-overlay gift-overlay-bottom">
              {t('gift.comicSignature', lang)}
            </div>
          )}
        </div>
        {gift.description && !realistic && (
          <div className="gift-desc">{gift.description}</div>
        )}
        <a
          className="gift-download"
          href={gift.url}
          onClick={handleComposedDownload}
          download={downloadFilename(gift)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {downloading ? '…' : t('gift.download', lang)}
        </a>
      </div>
    );
  }

  // Music / video — unchanged
  return (
    <div className="gift-bubble ready">
      <div className="gift-title">{title}</div>
      {gift.type === 'music' && (
        <audio
          className="gift-media gift-audio"
          src={gift.url}
          controls
          preload="metadata"
        />
      )}
      {gift.type === 'video' && (
        <video
          className="gift-media gift-video"
          src={gift.url}
          controls
          playsInline
          preload="metadata"
        />
      )}
      {gift.description && <div className="gift-desc">{gift.description}</div>}
      <a
        className="gift-download"
        href={gift.url}
        download={downloadFilename(gift)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('gift.download', lang)}
      </a>
    </div>
  );
}
