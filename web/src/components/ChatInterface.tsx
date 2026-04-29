import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import {
  endSession,
  logMessage,
  fetchVoiceCredits,
  fetchFavorites,
  addFavorite,
  removeFavorite,
  type FavoriteRow,
} from '../utils/sessionApi';
import {
  extractBlockText,
  extractMood,
  extractPlayableText,
  isTtsTextMeaningful,
  parseSpeakerBlocks,
} from '../utils/messageCleanup';
import { findDefaultAudioByTtsText } from '../utils/defaultDialogs';
import { attachAudio, claimSlot, isOwner, releaseSlot } from '../utils/audioPlayback';
import AffinityIndicator from './AffinityIndicator';
import AffinityDetailsModal from './AffinityDetailsModal';
import VoiceModeButton from './VoiceModeButton';
import type { DisplayMessage } from '../hooks/useChat';
import type { ChatMode } from '../utils/playLimit';
import { exportChatMarkdown, renderShareCard } from '../utils/exportChat';
const API_BASE = import.meta.env.VITE_API_URL || '';

import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import LangSwitcher from './LangSwitcher';
import LevelUpCeremony from './LevelUpCeremony';
import ShareCard from './ShareCard';
import type { LevelUpPayload, RecentHistoryMessage } from '../utils/sessionApi';

const SHARE_MAX = 6;

function EndedPanel({ quotaExceeded, onBack }: { quotaExceeded: boolean; onBack: () => void }) {
  const { lang } = useLang();
  return (
    <div className="ended-panel">
      <div className="ended-line">{t('ended.line', lang)}</div>
      {quotaExceeded ? (
        <div className="ended-desc">{t('chat.quotaExceededPanel', lang)}</div>
      ) : (
        <button className="ended-play-btn" onClick={onBack}>{t('ended.callAgain', lang)}</button>
      )}
    </div>
  );
}

interface ChatInterfaceProps {
  mode: ChatMode;
  sessionId: string;
  onBack: () => void;
  initialLevelUp: LevelUpPayload | null;
  onLevelUpDismiss: () => void;
  // Pre-loaded message tail from /api/session/start. Forwarded into
  // useChat which prepends them above the current session's greeting
  // with a divider in between. Empty array for first-time users.
  initialHistory: RecentHistoryMessage[];
}

// Mobile-only view state. Desktop CSS shows both panes regardless.
type MobileView = 'chat' | 'hologram';

const SWIPE_THRESHOLD = 80; // px

export default function ChatInterface({
  mode,
  sessionId,
  onBack,
  initialLevelUp,
  onLevelUpDismiss,
  initialHistory,
}: ChatInterfaceProps) {
  const { lang } = useLang();
  // useAuthSession lifted above useChat so we can feed affinity_level
  // into the hook — L2+ users get an uncapped per-session turn count.
  const { isAuthenticated, me, refreshMe } = useAuthSession();
  const affinityLevel = me?.affinity_level ?? 1;
  const isCapHidden = affinityLevel >= 2;
  const maxTurns = mode === 'text' ? 50 : 10;
  const { messages, sendMessage, isLoading, turnsLeft, isEnded, isQuotaExceeded } = useChat(
    lang,
    mode,
    sessionId,
    affinityLevel,
    initialHistory,
  );
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceCredits, setVoiceCredits] = useState<number | null>(null);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking, ttsQuotaExceeded, ttsInsufficientCredits } = useRockyTTS(!voiceEnabled);
  const [input, setInput] = useState('');
  const [mobileView, setMobileView] = useState<MobileView>('chat');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [favoritesList, setFavoritesList] = useState<FavoriteRow[]>([]);
  const [favError, setFavError] = useState<string | null>(null);
  // `${msg.id}#${blockIdx}` — tracks which single block is currently
  // playing so each bubble's Play button toggles only its own audio.
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [globalQuotaHit, setGlobalQuotaHit] = useState(false);
  const [resetInLabel, setResetInLabel] = useState<string>('');
  const [hangupConfirmOpen, setHangupConfirmOpen] = useState(false);
  // Affinity details modal — opened by tapping the AffinityIndicator
  // strip OR by tapping the "voice budget used up" banner (the latter
  // gives users hitting the lifetime limit an immediate path to learn
  // about the level-up route to more credits).
  const [affinityModalOpen, setAffinityModalOpen] = useState(false);
  // Token of the currently-playing slot from the global audioPlayback
  // coordinator. Used to distinguish "this block's audio finished"
  // from "a newer claim took over" — both arrive via onEnded.
  const playbackTokenRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);
  // Pre-seed loggedIdsRef with all history-message ids on mount so
  // the message-log effect below doesn't re-POST them to the server
  // (they're already in the messages table — that's where they came
  // from). The greeting id is also pre-seeded since it's special-cased
  // in the loop, but doing it here keeps the gate symmetric.
  const loggedIdsRef = useRef<Set<string>>(
    new Set(initialHistory.map((m) => m.id))
  );
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Log each user/assistant message to backend (fire-and-forget). Pass
  // msg.id so the server uses the same primary key; /api/tts will later
  // update this row's tts_content_hash using that id.
  //
  // Skip the history-divider sentinel (UI-only), the greeting (special-
  // cased), streaming messages (will log when complete), and any
  // message tagged with originSessionId (already logged in its
  // original session, would create a duplicate row here under the
  // current session_id otherwise).
  useEffect(() => {
    for (const msg of messages) {
      if (msg.id === 'greeting') continue;
      if (msg.isHistoryDivider) continue;
      if (msg.originSessionId) continue;
      if (msg.isStreaming) continue;
      if (loggedIdsRef.current.has(msg.id)) continue;
      loggedIdsRef.current.add(msg.id);
      logMessage(sessionId, msg.role, msg.content, msg.id);
    }
  }, [messages, sessionId]);

  // Refresh /api/me on every ChatInterface mount.
  //
  // The mount-time refetch covers both situations the AffinityIndicator
  // strip needs fresh data for:
  //   1. The user just finished a session that got consolidated
  //      server-side (rapport bumped, progress_to_next changed).
  //      /api/session/start hands back the new affinity_level but
  //      not progress_to_next, so we need /api/me.
  //   2. /api/session/start returned a level-up flag (initialLevelUp).
  //      The level transition fact is already in hand, but trust /
  //      warmth + the post-level progress baseline still live behind
  //      /api/me, so we need to refetch them anyway.
  // Both call paths used to fire their own useEffect; on a fresh
  // login-with-levelup that double-triggered /api/me. Consolidated
  // into a single mount-time fetch — initialLevelUp now relies on
  // this effect to also pull the post-level data.
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // Close session on unmount
  useEffect(() => {
    return () => {
      endSession(sessionId);
    };
  }, [sessionId]);

  // Close on page unload. Using pagehide rather than visibilitychange so
  // mobile keyboard show/hide doesn't end the session early.
  useEffect(() => {
    const onPageHide = () => {
      endSession(sessionId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [sessionId]);

  // Smart auto-scroll. Rules:
  //   1. If the user just sent a message (last entry is a 'user' role),
  //      ALWAYS scroll to bottom — they want to see their own send.
  //   2. Otherwise only scroll if they're already close to the bottom
  //      so we don't yank them while reading history.
  // Using `block: 'end'` + 'nearest' inline prevents the scroll from
  // escaping the chat area and accidentally moving the window (which
  // on mobile can even fire pull-to-refresh).
  useEffect(() => {
    const area = chatAreaRef.current;
    if (!area) return;
    const last = messages[messages.length - 1];
    const distanceFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
    const justSent = last?.role === 'user';
    if (justSent || distanceFromBottom < 200) {
      // rAF so we measure after the DOM commits the new message height.
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
      });
    }
  }, [messages]);

  // Speak Rocky's message when it finishes streaming
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastMsg.isStreaming) return;
    if (lastMsg.id === lastSpokenIdRef.current) return;

    if (lastMsg.id === 'greeting' && !greetingSpoken.current) {
      greetingSpoken.current = true;
      lastSpokenIdRef.current = lastMsg.id;
      // Minimal defer so the greeting bubble paints before audio starts.
      setTimeout(() => speak(lastMsg.content, lang, lastMsg.id), 120);
      return;
    }

    lastSpokenIdRef.current = lastMsg.id;
    speak(lastMsg.content, lang, lastMsg.id);
  }, [messages, speak, lang]);

  // F2: fetch voice credits on mount, refresh whenever Rocky finishes
  // replying (TTS may have consumed one) or when the server reports
  // insufficient credits.
  useEffect(() => {
    fetchVoiceCredits().then((res) => {
      if (res) setVoiceCredits(res.remaining);
    });
  }, []);

  useEffect(() => {
    if (!voiceEnabled) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.isStreaming) return;
    fetchVoiceCredits().then((res) => {
      if (!res) return;
      setVoiceCredits(res.remaining);
      if (res.remaining <= 0) {
        setVoiceEnabled(false);
      }
    });
  }, [messages, voiceEnabled]);

  useEffect(() => {
    if (ttsInsufficientCredits) {
      setVoiceCredits(0);
      setVoiceEnabled(false);
    }
  }, [ttsInsufficientCredits]);

  // Two distinct exhaustion modes, two distinct messages.
  //
  //   creditsExhausted  — users.voice_credits hit 0. Lifetime balance,
  //                       only refilled by leveling up (or, post-launch,
  //                       a top-up purchase). The banner for this case
  //                       routes the user into the affinity-details
  //                       modal so they see the upgrade path right at
  //                       the moment they hit the wall.
  //   dailyQuotaHit     — the global 8000-char/day MiniMax pool is
  //                       saturated for everyone. This DOES refresh at
  //                       UTC+8 midnight, so the banner shows the live
  //                       countdown.
  //
  // ttsQuotaExceeded is a vestigial state from the per-user 1000-char
  // daily cap that PR #30 deleted; we keep the variable around as
  // defensive cover for stale clients but it can no longer transition
  // to true from a fresh render.
  const creditsExhausted = voiceCredits != null && voiceCredits <= 0;
  const dailyQuotaHit = ttsQuotaExceeded || globalQuotaHit;

  useEffect(() => {
    // Only the daily-quota banner cares about the countdown — the
    // credits-exhausted banner doesn't refresh on a clock so we don't
    // need to spin a timer for it.
    if (!dailyQuotaHit) {
      setResetInLabel('');
      return;
    }
    const compute = () => {
      const now = Date.now();
      const msIntoUtc8Day = (now + 8 * 3600 * 1000) % 86_400_000;
      const msLeft = 86_400_000 - msIntoUtc8Day;
      const totalMin = Math.max(1, Math.ceil(msLeft / 60_000));
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      setResetInLabel(
        h > 0
          ? t('chat.durationHoursMinutes', lang, { h, m })
          : t('chat.durationMinutes', lang, { m })
      );
    };
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [dailyQuotaHit, lang]);

  // F3: load favorites once. The set only mutates via add/remove handlers.
  useEffect(() => {
    fetchFavorites().then((res) => {
      if (res) setFavoritesList(res.items);
    });
  }, []);

  // Stop any per-message playback on unmount. releaseSlot is a no-op
  // if a sibling component already took ownership of the slot.
  useEffect(() => {
    return () => {
      if (playbackTokenRef.current !== null && isOwner(playbackTokenRef.current)) {
        releaseSlot();
      }
    };
  }, []);

  // Extract a specific speaker block's playable text and speaker from a
  // message. `blockIdx` is 0 for single-speaker replies (unchanged) and
  // 0..n-1 for Grace cameos. Returns null when the block is missing or
  // has no renderable text.
  const getBlock = useCallback(
    (msg: DisplayMessage, blockIdx: number) => {
      const blocks = parseSpeakerBlocks(msg.content);
      const block = blocks[blockIdx];
      if (!block) return null;
      const text = extractBlockText(block.rawContent, block.speaker);
      if (!text) return null;
      return { text, speaker: block.speaker, mood: block.mood };
    },
    []
  );

  const findFavoriteForBlock = useCallback(
    (msg: DisplayMessage, blockIdx: number): FavoriteRow | undefined => {
      const block = getBlock(msg, blockIdx);
      if (!block) return undefined;
      return favoritesList.find((f) => f.message_content === block.text);
    },
    [favoritesList, getBlock]
  );

  const handleMessagePlay = useCallback(
    async (msg: DisplayMessage, blockIdx: number) => {
      const key = `${msg.id}#${blockIdx}`;
      // Toggle-off if this exact block's audio is currently playing.
      if (playingKey === key) {
        releaseSlot();
        playbackTokenRef.current = null;
        setPlayingKey(null);
        return;
      }

      const block = getBlock(msg, blockIdx);
      if (!block) return;
      const { text, speaker } = block;
      // Don't burn a MiniMax request on a 1-char block or a block that's
      // just punctuation. Server enforces the same rule (400 without
      // charging); catching it here skips the round-trip.
      if (!isTtsTextMeaningful(text)) return;

      // Claim the global slot — atomically stops auto-TTS (mood chirps,
      // streaming Rocky line), any other play button's audio (chat or
      // favorites), and aborts the previous /api/tts fetch. Note that
      // claimSlot also calls stopSharedAudio internally, so the manual
      // stopTTS() call is redundant here — but we keep it because
      // useRockyTTS owns its own ttsAudioRef + cancelledRef state that
      // claimSlot doesn't know about.
      stopTTS();
      const { token, signal } = claimSlot();
      playbackTokenRef.current = token;
      setFavError(null);

      // Short-circuit: greeting / farewell / Echo preset replies are
      // backed by static MP3s under /audio/defaults/. Those files never
      // pass through /api/tts, so hitting the TTS endpoint would cache-
      // miss and burn a MiniMax credit (or 402 when the user is out).
      // Match the same cleaned-text lookup FavoritesScreen uses.
      const staticPath = findDefaultAudioByTtsText(text, lang);
      let blobUrl: string | null = null;
      let src: string;
      if (staticPath) {
        src = staticPath;
        setPlayingKey(key);
      } else {
        const msgIdParam = msg.id ? `&message_id=${encodeURIComponent(msg.id)}` : '';
        const speakerParam = speaker === 'grace' ? '&speaker=grace' : '';
        const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}${msgIdParam}${speakerParam}`;
        // Optimistic UI: show "playing" immediately so the user gets
        // feedback even before the fetch lands. Reset on error/staleness.
        setPlayingKey(key);
        let res: Response;
        try {
          res = await fetch(url, { credentials: 'include', signal });
        } catch (err) {
          if ((err as Error).name !== 'AbortError' && playbackTokenRef.current === token) {
            playbackTokenRef.current = null;
            setPlayingKey((cur) => (cur === key ? null : cur));
          }
          return;
        }
        // Stale-result guard after every await — newer claim drops all
        // post-fetch state mutation.
        if (!isOwner(token)) return;
        if (res.status === 402) {
          setVoiceCredits(0);
          setVoiceEnabled(false);
          if (playbackTokenRef.current === token) {
            playbackTokenRef.current = null;
            setPlayingKey((cur) => (cur === key ? null : cur));
          }
          return;
        }
        if (res.status === 429) {
          setGlobalQuotaHit(true);
          if (playbackTokenRef.current === token) {
            playbackTokenRef.current = null;
            setPlayingKey((cur) => (cur === key ? null : cur));
          }
          return;
        }
        if (!res.ok) {
          if (playbackTokenRef.current === token) {
            playbackTokenRef.current = null;
            setPlayingKey((cur) => (cur === key ? null : cur));
          }
          return;
        }

        const blob = await res.blob();
        if (!isOwner(token)) return;
        blobUrl = URL.createObjectURL(blob);
        src = blobUrl;
      }

      const ok = attachAudio(token, src, {
        blobUrl,
        onEnded: () => {
          if (playbackTokenRef.current === token) {
            playbackTokenRef.current = null;
            setPlayingKey((cur) => (cur === key ? null : cur));
          }
        },
      });
      if (!ok && playbackTokenRef.current === token) {
        playbackTokenRef.current = null;
        setPlayingKey((cur) => (cur === key ? null : cur));
      }

      // Credits may have changed (cache miss on a non-favorite). Only
      // worth a refresh if we actually hit /api/tts.
      if (!staticPath) {
        fetchVoiceCredits().then((r) => {
          if (!r) return;
          setVoiceCredits(r.remaining);
        });
      }
    },
    [playingKey, stopTTS, lang, getBlock]
  );

  const handleToggleFavorite = useCallback(
    async (msg: DisplayMessage, blockIdx: number) => {
      setFavError(null);
      const existing = findFavoriteForBlock(msg, blockIdx);
      if (existing) {
        const ok = await removeFavorite(existing.id);
        if (ok) setFavoritesList((fs) => fs.filter((f) => f.id !== existing.id));
        return;
      }
      const block = getBlock(msg, blockIdx);
      if (!block) return;
      const res = await addFavorite({
        message_content: block.text,
        lang,
        // Prefer the block's own mood (Grace blocks carry their own
        // [MOOD:...]); fall back to the whole-message mood for legacy
        // single-speaker replies where extractMood on rawContent yields
        // null.
        mood: block.mood ?? extractMood(msg.content),
        // For history-loaded messages, attribute source_session to the
        // ORIGINAL session that produced the line — not the current
        // session we just opened. Otherwise a heart-tap on something
        // Rocky said three days ago would point at today's session,
        // which is misleading and breaks any per-session lookups
        // (e.g. the recover-grace-favorites admin endpoint that
        // walks messages by session_id).
        source_session: msg.originSessionId ?? sessionId,
        // Speaker decides which voice_id the server hashes against.
        // Grace blocks must travel as 'grace' so replay routes to the
        // cloned Gosling voice instead of Rocky's.
        speaker: block.speaker,
      });
      if (res.ok) {
        const reload = await fetchFavorites();
        if (reload) setFavoritesList(reload.items);
      } else if (res.reason === 'full') {
        setFavError(t('chat.favoritesFull', lang));
      }
    },
    [findFavoriteForBlock, getBlock, lang, sessionId]
  );

  // Auto-focus the input when Rocky finishes replying — desktop only.
  // `(pointer: fine)` filters out touch devices, so mobile doesn't trigger
  // the soft keyboard every reply.
  useEffect(() => {
    if (isLoading || isEnded) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.isStreaming) return;
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    // Skip focus when the export menu is open — the user is interacting
    // with it and we'd yank focus away mid-flow.
    if (exportOpen) return;
    textareaRef.current?.focus();
  }, [messages, isLoading, isEnded, exportOpen]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    stopTTS();
    setInput('');
    sendMessage(text);
  };

  // Manual hang-up: end the session cleanly so consolidation still runs,
  // then drop back to home. pagehide already fires endSession on tab
  // close but a user-initiated exit should be immediate + visible. Two
  // steps — the icon button opens a confirm modal; this actually ends.
  const handleHangupConfirmed = useCallback(() => {
    setHangupConfirmOpen(false);
    stopTTS();
    try {
      endSession(sessionId);
    } catch (err) {
      console.warn('endSession on hangup failed', err);
    }
    onBack();
  }, [stopTTS, sessionId, onBack]);

  // Enter submits; Shift+Enter inserts a newline (Slack-style).
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    stopTTS();
    setInput('');
    sendMessage(text);
  };

  const toggleMobileView = useCallback(() => {
    setMobileView((v) => (v === 'chat' ? 'hologram' : 'chat'));
  }, []);

  const handleExportMarkdown = useCallback(() => {
    setExportOpen(false);
    setExportError(null);
    try {
      exportChatMarkdown(messages, me?.callsign ?? null, lang);
    } catch (err) {
      console.error(err);
      setExportError(t('chat.exportFailed', lang));
    }
  }, [messages, me, lang]);

  // Share-card mode: users pick up to 6 messages, we render a 4:5 card
  // via ShareCard + html2canvas. Selection is chronological regardless
  // of click order so the card reads top-to-bottom as it happened.
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [shareSelectMode, setShareSelectMode] = useState(false);
  const [shareSelectedIds, setShareSelectedIds] = useState<string[]>([]);
  const [shareGenerating, setShareGenerating] = useState(false);

  const handleEnterShareMode = useCallback(() => {
    setExportOpen(false);
    setExportError(null);
    setShareSelectedIds([]);
    setShareSelectMode(true);
  }, []);

  const handleCancelShare = useCallback(() => {
    setShareSelectMode(false);
    setShareSelectedIds([]);
  }, []);

  const handleToggleShareSelect = useCallback(
    (msg: DisplayMessage) => {
      setShareSelectedIds((prev) => {
        if (prev.includes(msg.id)) {
          return prev.filter((id) => id !== msg.id);
        }
        if (prev.length >= SHARE_MAX) return prev;
        return [...prev, msg.id];
      });
    },
    [],
  );

  const handleGenerateShareCard = useCallback(async () => {
    if (shareSelectedIds.length === 0 || !shareCardRef.current) return;
    setShareGenerating(true);
    setExportError(null);
    try {
      // Wait one paint so the ShareCard with the just-updated message
      // list has fully laid out before html2canvas reads it.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await renderShareCard(shareCardRef.current);
      setShareSelectMode(false);
      setShareSelectedIds([]);
    } catch (err) {
      console.error(err);
      setExportError(t('chat.exportFailed', lang));
    } finally {
      setShareGenerating(false);
    }
  }, [shareSelectedIds.length, lang]);

  // Chronological ordering of the selected messages for the card.
  const shareMessages = shareSelectMode
    ? messages.filter((m) => shareSelectedIds.includes(m.id))
    : [];

  // Close export menu on outside click / ESC
  // Escape closes the End-call confirmation modal. Mirrors the
  // FavoritesScreen delete modal (added in the same commit) so any
  // hangup-confirm dialog in the app responds the same way to ESC.
  useEffect(() => {
    if (!hangupConfirmOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setHangupConfirmOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hangupConfirmOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.export-menu') || target?.closest('.export-toggle')) return;
      setExportOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  // Horizontal swipe to toggle mobile view. Attached only to chat-pane —
  // the hologram pane hosts OrbitControls which own its touch events.
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (window.innerWidth >= 768) return;
      const start = touchStartRef.current;
      if (!start) return;
      touchStartRef.current = null;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Horizontal swipe only — ignore mostly-vertical gestures (scroll).
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      // Chat view: swipe right → show hologram.
      if (mobileView === 'chat' && dx > 0) setMobileView('hologram');
      // (Return from hologram via button — swipe in hologram conflicts with
      // OrbitControls drag-to-rotate.)
    },
    [mobileView]
  );

  return (
    <div className={`immersive-root chat-shell view-${mobileView}`}>
      <Starfield />

      <button
        type="button"
        className="pane-toggle"
        onClick={toggleMobileView}
        aria-label={mobileView === 'chat' ? t('aria.toggleHologram', lang) : t('aria.toggleChat', lang)}
        title={mobileView === 'chat' ? t('aria.toggleHologram', lang) : t('aria.toggleChat', lang)}
      >
        {mobileView === 'chat' ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      <div className="hologram-pane" aria-hidden={mobileView === 'chat'}>
        <RockyModel isSpeaking={isLoading || ttsSpeaking} />
      </div>

      <div
        ref={chatPaneRef}
        className="chat-pane"
        aria-hidden={mobileView === 'hologram'}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="status-bar">
          <div className="signal">
            <div className="signal-bars">
              <div className="signal-bar" />
              <div className="signal-bar" />
              <div className="signal-bar" />
              <div className="signal-bar" />
            </div>
            <span>ERID-LINK v2.1</span>
          </div>
          <div className="status-actions">
          {/* Voice mode chip — text-labeled replacement for the old
              icon-only tts-toggle. Pre-PR the button silently
              disabled itself when credits hit 0; now it shows the
              "voice budget used up" modal with a top-up CTA. */}
          <VoiceModeButton
            voiceEnabled={voiceEnabled}
            voiceCredits={voiceCredits}
            onToggle={() => {
              setVoiceEnabled((v) => !v);
              if (voiceEnabled) stopTTS();
            }}
          />
          {messages.some((m) => m.role === 'user') && (
            <div className="export-wrap">
              <button
                type="button"
                className="export-toggle"
                onClick={() => setExportOpen((v) => !v)}
                title={t('chat.exportLabel', lang)}
                aria-label={t('chat.exportLabel', lang)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v13M6 10l6 6 6-6M5 21h14" />
                </svg>
              </button>
              {exportOpen && (
                <div className="export-menu" role="menu">
                  <button type="button" role="menuitem" onClick={handleExportMarkdown}>
                    {t('chat.exportMarkdown', lang)}
                  </button>
                  <button type="button" role="menuitem" onClick={handleEnterShareMode}>
                    {t('chat.exportShareCard', lang)}
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="status-iconbtn hangup"
            onClick={() => setHangupConfirmOpen(true)}
            title={t('chat.hangup', lang)}
            aria-label={t('chat.hangup', lang)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12l-3-3a14 14 0 0 0-14 0l-3 3 2.5 2.5a1 1 0 0 0 1.4 0l2-2a1 1 0 0 1 1-.3 13 13 0 0 0 5.2 0 1 1 0 0 1 1 .3l2 2a1 1 0 0 0 1.4 0L22 12z" transform="rotate(135 12 12)" />
            </svg>
          </button>
          </div>
          {isAuthenticated && me?.callsign && (
            // Level badge dropped from the Chat top bar so everything fits
            // on a single row (was wrapping onto 2-3 rows on mobile). The
            // affinity name still shows on the LevelUp ceremony + in any
            // future profile surface — nothing lost, just reclaimed.
            <span className="account-chip" title={me.email ?? ''}>
              ● {me.callsign}
            </span>
          )}
          <LangSwitcher />
        </div>

        <div className="mode-bar">
          {/* AffinityIndicator replaces the old "LATENCY 4.2ly" flavor
              text. Gated on `me` being loaded so an L2+ returning
              user doesn't see a brief "Earth Signal · 0%" flicker
              flash to their actual level on first /api/me resolve.
              While loading, the mode-bar shows just the remaining-
              turns counter. */}
          {me != null && (
            <>
              <AffinityIndicator
                level={me.affinity_level ?? 1}
                /* Forward `null` UNCHANGED for max-level users — the
                   indicator renders "MAX" only when it sees null,
                   not when it sees 0. Earlier `?? 0` shorthand
                   collapsed both null and undefined to 0, which
                   meant L4 users saw "0% → LV5" instead of MAX. */
                progressToNext={
                  me.progress_to_next === undefined
                    ? 0
                    : me.progress_to_next
                }
                onClick={() => setAffinityModalOpen(true)}
              />
              {!isCapHidden && <span className="mode-bar-divider">·</span>}
            </>
          )}
          {!isCapHidden && (
            // Tightened from "{n} / {m} REMAINING" to "Chat {n}/{m}"
            // — the longer form was getting clipped at narrow widths
            // (mobile) when the affinity strip on the left filled
            // most of the row. "Chat" prefix kept English so it
            // reads as a brand-style terminal token (matches the
            // "AFFINITY ·" label format on the same row).
            //
            // Hidden entirely for L2+ users, who have no per-session
            // turn cap (see useChat). The mode-bar then shows just
            // the affinity strip — cleaner for engaged users.
            <span className="mode-bar-remaining">
              Chat {turnsLeft}/{maxTurns}
            </span>
          )}
        </div>

        <div ref={chatAreaRef} className="chat-area">
          {messages.map((msg) => {
            // History divider — rendered between pre-loaded history
            // and the current session's fresh greeting. Only present
            // when initialHistory was non-empty (useChat skips the
            // sentinel for first-time users).
            if (msg.isHistoryDivider) {
              return (
                <div key={msg.id} className="chat-history-divider" role="separator">
                  <span className="chat-history-divider-line" aria-hidden="true" />
                  <span className="chat-history-divider-label">
                    {t('chat.previousCall', lang)}
                  </span>
                  <span className="chat-history-divider-line" aria-hidden="true" />
                </div>
              );
            }
            const selected = shareSelectedIds.includes(msg.id);
            const capped = shareSelectedIds.length >= SHARE_MAX;
            // Exclude greeting + streaming + history-divider from share
            // picks (nothing to share pre-answer; divider has no body).
            // The divider is filtered higher up via the early return,
            // so this guard is belt-and-suspenders, but kept so future
            // refactors can't accidentally make the divider eligible.
            const shareEligible =
              shareSelectMode &&
              msg.id !== 'greeting' &&
              !msg.isStreaming &&
              !msg.isHistoryDivider;
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                lang={lang}
                callsign={me?.callsign ?? null}
                onPlay={
                  !shareSelectMode && msg.role === 'assistant'
                    ? handleMessagePlay
                    : undefined
                }
                onToggleFavorite={
                  !shareSelectMode && msg.role === 'assistant'
                    ? handleToggleFavorite
                    : undefined
                }
                isFavoritedFor={(i) => findFavoriteForBlock(msg, i) != null}
                isPlayingFor={(i) => playingKey === `${msg.id}#${i}`}
                shareSelectMode={shareEligible}
                shareSelected={selected}
                shareDisabled={capped && !selected}
                onShareToggle={handleToggleShareSelect}
              />
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {(exportError || favError) && (
          <div className="export-error">{exportError ?? favError}</div>
        )}

        {initialLevelUp && (
          <LevelUpCeremony payload={initialLevelUp} onClose={onLevelUpDismiss} />
        )}

        {isEnded ? (
          <EndedPanel quotaExceeded={isQuotaExceeded} onBack={onBack} />
        ) : (
          <>
            {/* Two banners, two reasons. Lifetime credit exhaustion
                takes precedence over a daily-quota hit (the user with
                0 credits can't TTS regardless of pool state, so showing
                the level-up CTA is the more actionable message). */}
            {creditsExhausted && (
              // No role="status" on the interactive variant — <button>
              // already exposes correct semantics, and role="status"
              // (a live region) can suppress button semantics in some
              // screen readers. The non-interactive daily variant
              // below still uses role="status" since it's a passive
              // div announcement.
              <button
                type="button"
                className="voice-exhausted-bar voice-exhausted-bar-credits"
                onClick={() => setAffinityModalOpen(true)}
              >
                {t('chat.voiceCreditsExhausted', lang)}
              </button>
            )}
            {!creditsExhausted && dailyQuotaHit && resetInLabel && (
              <div className="voice-exhausted-bar voice-exhausted-bar-daily" role="status">
                {t('chat.voiceExhausted', lang, { time: resetInLabel })}
              </div>
            )}
          <form
            className="input-area"
            onSubmit={handleSubmit}
            action="#"
            noValidate
            autoComplete="off"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder', lang)}
              disabled={isLoading}
              rows={3}
              autoFocus
            />
            <button className="send-btn" type="submit" disabled={isLoading || !input.trim()}>
              {t('chat.sendButton', lang)}
            </button>
          </form>
          </>
        )}
      </div>

      {affinityModalOpen && (
        <AffinityDetailsModal
          currentLevel={me?.affinity_level ?? 1}
          /* Same null-preservation as in the indicator: L4 users
             must reach the "MAX" branch in the modal, which only
             fires when progressToNext === null. */
          progressToNext={
            me?.progress_to_next === undefined ? 0 : me.progress_to_next
          }
          onClose={() => setAffinityModalOpen(false)}
        />
      )}

      {hangupConfirmOpen && (
        <div
          className="hangup-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setHangupConfirmOpen(false)}
        >
          <div className="hangup-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="hangup-confirm-title">{t('chat.hangupConfirmTitle', lang)}</div>
            <div className="hangup-confirm-desc">{t('chat.hangupConfirmDesc', lang)}</div>
            <div className="hangup-confirm-actions">
              <button
                type="button"
                className="hangup-confirm-cancel"
                onClick={() => setHangupConfirmOpen(false)}
                autoFocus
              >
                {t('chat.hangupConfirmNo', lang)}
              </button>
              <button
                type="button"
                className="hangup-confirm-ok"
                onClick={handleHangupConfirmed}
              >
                {t('chat.hangupConfirmYes', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareSelectMode && (
        <div className="share-toolbar" role="toolbar">
          <span className="share-toolbar-hint">{t('share.hint', lang)}</span>
          <span className="share-toolbar-counter">
            {t('share.counter', lang, { n: shareSelectedIds.length })}
          </span>
          <button
            type="button"
            className="share-toolbar-cancel"
            onClick={handleCancelShare}
            disabled={shareGenerating}
          >
            {t('share.cancel', lang)}
          </button>
          <button
            type="button"
            className="share-toolbar-generate"
            onClick={handleGenerateShareCard}
            disabled={shareSelectedIds.length === 0 || shareGenerating}
          >
            {t('share.generate', lang)}
          </button>
        </div>
      )}

      {/* Off-screen card — only mounted during share mode so html2canvas
          reads live DOM at the export dimensions (1080x1350). */}
      {shareSelectMode && shareMessages.length > 0 && (
        <ShareCard
          ref={shareCardRef}
          messages={shareMessages}
          lang={lang}
          callsign={me?.callsign ?? null}
          affinityLevel={me?.affinity_level ?? 1}
          levelName={t(
            `level.${Math.min(Math.max(me?.affinity_level ?? 1, 1), 4)}.name` as never,
            lang,
          )}
        />
      )}

      {/* Full-viewport overlay during capture — covers the card that
          renderShareCard briefly pulls into the painting area so the
          user never sees the raw artwork flash on screen. Sits above
          the card's z-index:1 but below any system UI. */}
      {shareGenerating && (
        <div className="share-generating-overlay" role="status" aria-live="polite">
          <div className="share-generating-spinner" />
          <div className="share-generating-label">{t('share.generate', lang)}…</div>
        </div>
      )}
    </div>
  );
}
