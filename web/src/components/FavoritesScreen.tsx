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
import { attachAudio, claimSlot, isOwner, releaseSlot } from '../utils/audioPlayback';
import type { Lang } from '../i18n';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Props {
  onBack: () => void;
}

// Absolute YYYY-MM-DD HH:mm — language-independent, terminal-aesthetic,
// unambiguous. Earlier version used relative time ("2 days ago") but
// users found it too fuzzy for log-style content (favorites are
// memorable moments — exact timestamps help recall).
function formatWhen(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function FavoritesScreen({ onBack }: Props) {
  const { lang } = useLang();
  const [items, setItems] = useState<FavoriteRow[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Modal-based delete confirmation, mirroring the End-call flow.
  // Holds the row pending confirmation (or null when the modal is
  // closed). Reuses .hangup-confirm-* styles so the visual language
  // for "destructive confirmation" is consistent across the app.
  const [pendingDelete, setPendingDelete] = useState<FavoriteRow | null>(null);
  // Token of the currently-playing slot from audioPlayback.ts. Used to
  // distinguish "this row's audio finished" from "a newer claim took
  // over"; both arrive via the same onEnded callback so React state
  // resets cleanly either way.
  const playingTokenRef = useRef<number | null>(null);

  useEffect(() => {
    fetchFavorites().then((res) => setItems(res?.items ?? []));
  }, []);

  useEffect(() => {
    return () => {
      // Component unmount — drop the slot if we own it. releaseSlot
      // is a no-op when another component already took ownership.
      if (playingTokenRef.current !== null && isOwner(playingTokenRef.current)) {
        releaseSlot();
      }
    };
  }, []);

  // Escape closes the delete-confirm modal. Same pattern as the End-
  // call confirm in ChatInterface — backdrop click + ESC + Cancel
  // button all dismiss; only Confirm commits.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDelete(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pendingDelete]);

  const play = useCallback(async (fav: FavoriteRow) => {
    // Toggle off if the same favorite is currently playing.
    if (playingId === fav.id) {
      releaseSlot();
      playingTokenRef.current = null;
      setPlayingId(null);
      return;
    }

    // Claim the global slot — this stops any other audio in the app
    // (favorites, chat TTS, useRockyTTS chirps) and aborts the previous
    // fetch in one atomic step. The cross-component sweep is what fixes
    // the "Rocky echo can't play while other audio is playing" report.
    const { token, signal } = claimSlot();
    playingTokenRef.current = token;
    setPlayingId(fav.id);

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
      // Grace favorites silently render with Rocky's voice.
      const speakerParam = fav.speaker === 'grace' ? '&speaker=grace' : '';
      const url = `${API_BASE}/api/tts?text=${encodeURIComponent(fav.message_content)}&lang=${encodeURIComponent(fav.lang)}&favorite=true${speakerParam}`;
      try {
        const res = await fetch(url, { credentials: 'include', signal });
        // Stale-result guard after every await — if a newer claim has
        // taken the slot, drop everything (including any blob we'd build).
        if (!isOwner(token)) return;
        if (!res.ok) {
          // Non-2xx and we still own the slot — drop the playing
          // indicator since no audio will be bound.
          if (playingTokenRef.current === token) {
            playingTokenRef.current = null;
            setPlayingId(null);
          }
          return;
        }
        const blob = await res.blob();
        if (!isOwner(token)) return;
        blobUrl = URL.createObjectURL(blob);
        src = blobUrl;
      } catch (err) {
        // AbortError is the expected path when a newer claim ran. For
        // any other error, also reset the playing indicator.
        if ((err as Error).name !== 'AbortError' && playingTokenRef.current === token) {
          playingTokenRef.current = null;
          setPlayingId(null);
        }
        return;
      }
    }

    // attachAudio internally re-checks the token, so a race between
    // the static-path sync block and a competing claim is safe — the
    // blob URL gets revoked by attachAudio on a stale token.
    const ok = attachAudio(token, src, {
      blobUrl,
      onEnded: () => {
        // Fires for both natural end AND newer-claim takeover. UI
        // resets either way.
        if (playingTokenRef.current === token) {
          playingTokenRef.current = null;
          setPlayingId(null);
        }
      },
    });
    if (!ok && playingTokenRef.current === token) {
      playingTokenRef.current = null;
      setPlayingId(null);
    }
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

  // ✕ on a row opens the confirm modal. The actual delete happens in
  // confirmDelete(), wired to the modal's Confirm button.
  const requestDelete = useCallback((fav: FavoriteRow) => {
    setPendingDelete(fav);
  }, []);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    const fav = pendingDelete;
    if (!fav) return;
    setPendingDelete(null);
    if (playingId === fav.id) {
      releaseSlot();
      playingTokenRef.current = null;
      setPlayingId(null);
    }
    const ok = await removeFavorite(fav.id);
    if (ok) setItems((xs) => xs?.filter((x) => x.id !== fav.id) ?? null);
  }, [pendingDelete, playingId]);

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
                      <span className="favorite-when">{formatWhen(fav.created_at)}</span>
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
                      onClick={() => requestDelete(fav)}
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

      {pendingDelete && (
        <div
          className="hangup-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={cancelDelete}
        >
          <div className="hangup-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="hangup-confirm-title">
              {t('chat.favoritesRemoveConfirmTitle', lang)}
            </div>
            <div className="hangup-confirm-desc">
              {t('chat.favoritesRemoveConfirmDesc', lang)}
            </div>
            <div className="hangup-confirm-actions">
              <button
                type="button"
                className="hangup-confirm-cancel"
                onClick={cancelDelete}
                autoFocus
              >
                {t('chat.favoritesRemoveConfirmNo', lang)}
              </button>
              <button
                type="button"
                className="hangup-confirm-ok"
                onClick={confirmDelete}
              >
                {t('chat.favoritesRemoveConfirmYes', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
