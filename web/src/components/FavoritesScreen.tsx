import { useEffect, useRef, useState, useCallback } from 'react';
import Starfield from './Starfield';
import LangSwitcher from './LangSwitcher';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import {
  fetchFavorites,
  removeFavorite,
  type FavoriteRow,
} from '../utils/sessionApi';
import { findDefaultAudioByTtsText } from '../utils/defaultDialogs';
import type { Lang } from '../i18n';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Props {
  onBack: () => void;
}

// Relative time formatter. < 1m = "just now", < 1h = "5m ago",
// < 24h = "3h ago", yesterday, < 7d = "3 days ago", else absolute date.
// Localized lightly inline rather than via i18n keys — favorites screen
// is the only consumer and the strings are short enough that adding
// six new keys per locale is more friction than value.
function formatWhen(ts: number, lang: Lang): string {
  const now = Date.now();
  const diffMs = now - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diffMs < min) {
    return lang === 'zh' ? '刚刚' : lang === 'ja' ? 'たった今' : 'just now';
  }
  if (diffMs < hour) {
    const mins = Math.floor(diffMs / min);
    return lang === 'zh' ? `${mins} 分钟前` : lang === 'ja' ? `${mins} 分前` : `${mins}m ago`;
  }
  if (diffMs < day) {
    const hrs = Math.floor(diffMs / hour);
    return lang === 'zh' ? `${hrs} 小时前` : lang === 'ja' ? `${hrs} 時間前` : `${hrs}h ago`;
  }
  if (diffMs < 2 * day) {
    return lang === 'zh' ? '昨天' : lang === 'ja' ? '昨日' : 'yesterday';
  }
  if (diffMs < 7 * day) {
    const days = Math.floor(diffMs / day);
    return lang === 'zh' ? `${days} 天前` : lang === 'ja' ? `${days} 日前` : `${days} days ago`;
  }
  // > 7 days: absolute date. Locale-friendly without bringing in Intl
  // for a six-line file.
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (lang === 'zh') return sameYear ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : `${d.getFullYear()}-${mm}-${dd}`;
  if (lang === 'ja') return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${mm}/${dd}`;
  // English: "Apr 22" or "Apr 22, 2025"
  const monthShort = d.toLocaleString('en-US', { month: 'short' });
  return sameYear ? `${monthShort} ${d.getDate()}` : `${monthShort} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function FavoritesScreen({ onBack }: Props) {
  const { lang } = useLang();
  const [items, setItems] = useState<FavoriteRow[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchFavorites().then((res) => setItems(res?.items ?? []));
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const play = useCallback(async (fav: FavoriteRow) => {
    if (playingId === fav.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();

    // Echo-sourced favorites are backed by a pre-rendered MP3 in
    // /audio/defaults/. Those files never pass through /api/tts so the
    // server has no audio_cache row — hitting /api/tts would cache-miss
    // and burn a MiniMax call (or silently 429 when quota's tight). Play
    // the static asset directly whenever we can match it.
    const staticPath = findDefaultAudioByTtsText(fav.message_content, fav.lang as Lang);
    let blobUrl: string | null = null;
    let src: string;
    if (staticPath) {
      src = staticPath;
    } else {
      // speaker=grace routes to the cloned Gosling voice. Without this,
      // Grace favorites silently render with Rocky's voice (the bug
      // this commit fixes — see PR description).
      const speakerParam = fav.speaker === 'grace' ? '&speaker=grace' : '';
      const url = `${API_BASE}/api/tts?text=${encodeURIComponent(fav.message_content)}&lang=${encodeURIComponent(fav.lang)}&favorite=true${speakerParam}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      src = blobUrl;
    }

    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingId(fav.id);
    const cleanup = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingId(null);
      }
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  }, [playingId]);

  const download = useCallback(async (fav: FavoriteRow) => {
    // Echo favorites: fetch the static pre-rendered MP3 so download works
    // even when the TTS proxy is rate-limited.
    const staticPath = findDefaultAudioByTtsText(fav.message_content, fav.lang as Lang);
    const speakerParam = fav.speaker === 'grace' ? '&speaker=grace' : '';
    const url = staticPath
      ? staticPath
      : `${API_BASE}/api/tts?text=${encodeURIComponent(fav.message_content)}&lang=${encodeURIComponent(fav.lang)}&favorite=true${speakerParam}`;
    const res = await fetch(url, staticPath ? undefined : { credentials: 'include' });
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `rocky_${fav.id.slice(0, 8)}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }, []);

  const remove = useCallback(async (fav: FavoriteRow) => {
    if (playingId === fav.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
    }
    const ok = await removeFavorite(fav.id);
    if (ok) setItems((xs) => xs?.filter((x) => x.id !== fav.id) ?? null);
  }, [playingId]);

  return (
    <div className="immersive-root chat-shell view-chat">
      <Starfield />
      <div className="hologram-pane" aria-hidden="true" />
      <div className="chat-pane">
        <div className="status-bar">
          <button
            type="button"
            className="status-iconbtn"
            onClick={onBack}
            title={t('dialin.back', lang)}
            aria-label={t('dialin.back', lang)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="echo-badge">{t('chat.favorites', lang)}</span>
          <LangSwitcher />
        </div>

        {items === null ? (
          <div className="favorites-empty">…</div>
        ) : items.length === 0 ? (
          <div className="favorites-empty">{t('chat.favoritesEmpty', lang)}</div>
        ) : (
          <div className="favorites-list">
            {items.map((fav, idx) => {
              const playing = playingId === fav.id;
              const isGrace = fav.speaker === 'grace';
              const speakerName = isGrace ? 'Grace' : 'Rocky';
              return (
                <div
                  key={fav.id}
                  className={`favorite-row${isGrace ? ' favorite-row-grace' : ''}${playing ? ' favorite-row-playing' : ''}`}
                  // Stagger entry: 50ms per row, capped at 8 so a long
                  // list doesn't take seconds to fade in. Per emil — keep
                  // stagger short and decorative.
                  style={{ '--fav-stagger': `${Math.min(idx, 8) * 50}ms` } as React.CSSProperties}
                >
                  <div className="favorite-row-body">
                    <div className="favorite-row-meta">
                      <span className={`favorite-speaker favorite-speaker-${fav.speaker}`}>
                        <span className="favorite-speaker-dot" aria-hidden="true" />
                        {speakerName}
                      </span>
                      <span className="favorite-meta-sep">·</span>
                      <span className="favorite-when">{formatWhen(fav.created_at, lang)}</span>
                      {fav.mood ? (
                        <>
                          <span className="favorite-meta-sep">·</span>
                          <span className="favorite-mood">{fav.mood}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="favorite-row-text">{fav.message_content}</div>
                  </div>
                  <div className="favorite-row-actions">
                    <button
                      type="button"
                      className={`fav-play ${playing ? 'playing' : ''}`}
                      onClick={() => play(fav)}
                      title={playing ? t('aria.stop', lang) : t('aria.play', lang)}
                      aria-label={playing ? t('aria.stop', lang) : t('aria.play', lang)}
                    >
                      {playing ? (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                          <polygon points="6,4 20,12 6,20" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="fav-download"
                      onClick={() => download(fav)}
                      title={t('chat.favoritesDownload', lang)}
                      aria-label={t('chat.favoritesDownload', lang)}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3v13M6 10l6 6 6-6M5 21h14" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="fav-remove"
                      onClick={() => remove(fav)}
                      title={t('chat.favoritesRemove', lang)}
                      aria-label={t('chat.favoritesRemove', lang)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
