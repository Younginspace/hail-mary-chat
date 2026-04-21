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

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
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
      const url = `${API_BASE}/api/tts?text=${encodeURIComponent(fav.message_content)}&lang=${encodeURIComponent(fav.lang)}&favorite=true`;
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
    const url = staticPath
      ? staticPath
      : `${API_BASE}/api/tts?text=${encodeURIComponent(fav.message_content)}&lang=${encodeURIComponent(fav.lang)}&favorite=true`;
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
          <button type="button" className="echo-back" onClick={onBack}>
            ← {t('dialin.back', lang)}
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
            {items.map((fav) => {
              const playing = playingId === fav.id;
              return (
                <div key={fav.id} className="favorite-row">
                  <div className="favorite-row-body">
                    <div className="favorite-row-text">{fav.message_content}</div>
                    <div className="favorite-row-meta">
                      {formatWhen(fav.created_at)}
                      {fav.mood ? ` · ${fav.mood}` : ''}
                    </div>
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
