import { useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import type { DisplayMessage } from '../hooks/useChat';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { getTranslationLabel } from '../prompts/rocky';
import GiftBubble from './GiftBubble';

interface Props {
  message: DisplayMessage;
  lang: Lang;
  // Optional actions (only wired in ChatInterface; EchoInterface omits them).
  onPlay?: (msg: DisplayMessage) => void;
  onToggleFavorite?: (msg: DisplayMessage) => void;
  isFavorited?: boolean;
  isPlaying?: boolean;
  // Share-select mode: when true the whole bubble becomes clickable to
  // toggle inclusion in the share card. shareDisabled suppresses taps
  // when the 6-msg cap has been hit (except for already-selected rows
  // so the user can still deselect).
  shareSelectMode?: boolean;
  shareSelected?: boolean;
  shareDisabled?: boolean;
  onShareToggle?: (msg: DisplayMessage) => void;
}

// Parse Rocky's message into music notes + translation sections
function parseRockyMessage(content: string, lang: Lang) {
  const lines = content.split('\n');
  const parts: Array<{ type: 'notes' | 'label' | 'text' | 'grace'; content: string }> = [];
  const translationLabel = getTranslationLabel(lang);
  const labelRegex = /^\[(翻译|Translation|翻訳)\]/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^\[MOOD:\w+\]$/.test(trimmed)) continue;
    if (/^\[(INTRO|LIKE|DIRTY)\]$/.test(trimmed)) continue;

    if (/^[♫♩♪❗\s]{3,}$/.test(trimmed)) {
      parts.push({ type: 'notes', content: trimmed });
    } else if (labelRegex.test(trimmed)) {
      parts.push({ type: 'label', content: translationLabel });
      const text = trimmed.replace(labelRegex, '').trim();
      if (text) parts.push({ type: 'text', content: text });
    } else if (/^【Grace/.test(trimmed)) {
      parts.push({ type: 'grace', content: trimmed });
    } else {
      parts.push({ type: 'text', content: trimmed });
    }
  }

  return parts;
}

export default function MessageBubble({
  message,
  lang,
  onPlay,
  onToggleFavorite,
  isFavorited = false,
  isPlaying = false,
  shareSelectMode = false,
  shareSelected = false,
  shareDisabled = false,
  onShareToggle,
}: Props) {
  const isRocky = message.role === 'assistant';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const shareClass = shareSelectMode
    ? `share-selectable${shareSelected ? ' share-selected' : ''}${shareDisabled && !shareSelected ? ' share-disabled' : ''}`
    : '';
  const shareHandler = shareSelectMode && onShareToggle
    ? () => onShareToggle(message)
    : undefined;

  // F5: GSAP mount animation replacing the prior CSS `fadeIn`. Honor
  // prefers-reduced-motion — users who asked for no motion get no
  // tweens at all.
  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!node) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    gsap.fromTo(
      node,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.32,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility',
      }
    );
  }, []);

  if (!isRocky) {
    return (
      <div
        ref={bubbleRef}
        className={`message user ${shareClass}`.trim()}
        onClick={shareHandler}
        role={shareHandler ? 'button' : undefined}
      >
        <div className="message-sender">{t('chat.senderYou', lang)}</div>
        {message.content}
      </div>
    );
  }

  const parts = parseRockyMessage(message.content, lang);

  // Only show action buttons when caller wires them in — and never
  // while the reply is still streaming in. Greeting used to be hidden
  // too, but in Echo mode users want to replay/favorite the greeting,
  // so the caller decides via the onPlay/onToggleFavorite props.
  const showActions =
    (onPlay != null || onToggleFavorite != null) &&
    !message.isStreaming &&
    !message.id?.startsWith('farewell-');

  return (
    <div
      ref={bubbleRef}
      className={`message rocky ${shareClass}`.trim()}
      onClick={shareHandler}
      role={shareHandler ? 'button' : undefined}
    >
      <div className="message-sender">Rocky (Erid)</div>
      {parts.map((part, i) => {
        switch (part.type) {
          case 'notes':
            return <div key={i} className="music-notes">{part.content}</div>;
          case 'label':
            return <div key={i} className="translation-label">{part.content}</div>;
          case 'grace':
            return <div key={i} className="grace-tag">{part.content}</div>;
          case 'text':
            return <div key={i}>{part.content}</div>;
        }
      })}
      {message.isStreaming && <span className="streaming-cursor" />}

      {message.gift && <GiftBubble gift={message.gift} lang={lang} />}

      {showActions && (
        <div className="message-actions">
          {onPlay && (
            <button
              type="button"
              className={`msg-action msg-play ${isPlaying ? 'playing' : ''}`}
              onClick={() => onPlay(message)}
              aria-label={isPlaying ? t('aria.stop', lang) : t('aria.play', lang)}
              title={isPlaying ? t('aria.stop', lang) : t('aria.play', lang)}
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" />
                  <rect x="14" y="5" width="4" height="14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              )}
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              className={`msg-action msg-fav ${isFavorited ? 'favorited' : ''}`}
              onClick={() => onToggleFavorite(message)}
              aria-label={isFavorited ? t('aria.unfavorite', lang) : t('aria.favorite', lang)}
              title={isFavorited ? t('aria.unfavorite', lang) : t('aria.favorite', lang)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
