// HTML5-audio-based player for the bedtime stories.
//
// CRITICAL: this hook deliberately uses an HTMLAudioElement, NOT the
// Web Audio API used by useRockyTTS. Web Audio AudioContext gets
// suspended on iOS Safari when the screen locks; HTMLAudioElement
// stays alive (treated as media), gets a lock-screen control widget
// via MediaSession, and survives backgrounding. Bedtime listeners
// will absolutely lock their phone — Web Audio would silently die.
//
// Wake Lock prevents auto-screen-off during playback so users can
// glance at the player without re-unlocking. Manual lock is still
// honored — audio keeps playing via MediaSession.

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseBedtimeAudioOptions {
  /** Source URL of the mp3. Switching this stops/reloads playback. */
  src: string | null;
  /** Title shown on the OS lock-screen control widget. */
  title?: string;
  /** Sub-title (artist) shown on the OS lock-screen widget. */
  artist?: string;
  /** PNG/JPEG path used as the OS lock-screen artwork. */
  artworkSrc?: string;
  /** Sleep timer in milliseconds. 0 / null = no auto-stop.
   * The audio fades out over 3s ending exactly at this timestamp. */
  sleepTimerMs?: number | null;
  /** Called once when the audio reaches its natural end, after the
   * fade-out completes. Useful for parent state cleanup. */
  onEnded?: () => void;
}

export interface UseBedtimeAudioReturn {
  /** True when audio is actively playing (not paused, not loading). */
  playing: boolean;
  /** Current playback position in seconds. Updates ~4x/sec via timeupdate. */
  position: number;
  /** Total duration in seconds. 0 until metadata loads. NaN if not playable. */
  duration: number;
  /** True while the audio element is fetching / buffering. */
  loading: boolean;
  /** Set if the audio failed to load (404, decode error, etc.). */
  error: 'not_found' | 'decode_failed' | 'unknown' | null;
  /** Toggle play / pause. Resolves when the action committed. */
  togglePlay: () => Promise<void>;
  /** Hard stop + fade out over `fadeMs`. Resolves when fade complete. */
  fadeOutAndStop: (fadeMs?: number) => Promise<void>;
  /** Seek to absolute second position. Clamped to [0, duration]. */
  seek: (seconds: number) => void;
}

const FADE_FRAME_MS = 16; // ~60fps

export function useBedtimeAudio({
  src,
  title,
  artist,
  artworkSrc,
  sleepTimerMs,
  onEnded,
}: UseBedtimeAudioOptions): UseBedtimeAudioReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<unknown>(null);
  const fadeRafRef = useRef<number | null>(null);
  const sleepTimerHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest onEnded ref so the audio element listener doesn't capture a
  // stale callback when the parent re-renders with a new closure.
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UseBedtimeAudioReturn['error']>(null);

  // ─── Audio element lifecycle ─────────────────────────────────────

  useEffect(() => {
    if (!src) {
      // No source → tear down any existing element.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      setPlaying(false);
      setPosition(0);
      setDuration(0);
      setLoading(false);
      setError(null);
      return;
    }

    setError(null);
    setLoading(true);
    setPosition(0);
    setDuration(0);

    const audio = new Audio(src);
    audio.preload = 'auto';
    audioRef.current = audio;

    const onLoadedMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setLoading(false);
    };
    const onTimeUpdate = () => setPosition(audio.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onAudioEnded = () => {
      setPlaying(false);
      onEndedRef.current?.();
    };
    const onErr = () => {
      setLoading(false);
      const errCode = audio.error?.code;
      // MEDIA_ERR_SRC_NOT_SUPPORTED (4) commonly fires for 404s in
      // Safari — surface it as not_found so the UI can show "audio not
      // rendered yet" rather than a generic decode failure.
      if (errCode === 4) setError('not_found');
      else if (errCode === 3) setError('decode_failed');
      else setError('unknown');
    };

    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onAudioEnded);
    audio.addEventListener('error', onErr);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onAudioEnded);
      audio.removeEventListener('error', onErr);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [src]);

  // ─── MediaSession metadata ───────────────────────────────────────

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!src) {
      navigator.mediaSession.metadata = null;
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title ?? 'Bedtime Story',
        artist: artist ?? 'Rocky',
        artwork: artworkSrc
          ? [{ src: artworkSrc, sizes: '512x512', type: 'image/png' }]
          : [],
      });
      navigator.mediaSession.setActionHandler('play', () => {
        void audioRef.current?.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
      });
    } catch {
      // MediaSession not available — quietly skip.
    }
  }, [src, title, artist, artworkSrc]);

  // ─── Wake Lock ───────────────────────────────────────────────────

  useEffect(() => {
    // Only request wake lock while playing. Release when paused or torn
    // down so we don't keep the screen alive through pauses.
    if (!playing) {
      releaseWakeLock(wakeLockRef);
      return;
    }
    requestWakeLock(wakeLockRef);
    return () => releaseWakeLock(wakeLockRef);
  }, [playing]);

  // Visibility handler: re-acquire wake lock when the user comes back
  // to the tab after the OS auto-released it (Wake Lock spec releases
  // on visibility change to hidden).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && playing) {
        requestWakeLock(wakeLockRef);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [playing]);

  // ─── Imperative actions ──────────────────────────────────────────

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        // Reset volume in case a previous fade-out left it at 0.
        audio.volume = 1;
        await audio.play();
      } catch {
        // play() rejection is usually autoplay policy — surfaced via
        // existing 'error' listener if it's actually broken.
      }
    } else {
      audio.pause();
    }
  }, []);

  const fadeOutAndStop = useCallback(async (fadeMs = 3000) => {
    const audio = audioRef.current;
    if (!audio) return;
    return new Promise<void>((resolve) => {
      // Cancel any in-flight fade.
      if (fadeRafRef.current != null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
      const startVol = audio.volume;
      const startTime = performance.now();
      const tick = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / fadeMs, 1);
        audio.volume = Math.max(0, startVol * (1 - progress));
        if (progress < 1) {
          fadeRafRef.current = requestAnimationFrame(tick);
        } else {
          audio.pause();
          audio.volume = startVol; // Restore for next play.
          fadeRafRef.current = null;
          resolve();
        }
      };
      fadeRafRef.current = requestAnimationFrame(tick);
      // Safety: if rAF is throttled in background tabs, fall back to a
      // setTimeout that forces the final state after fadeMs + slack.
      setTimeout(() => {
        if (fadeRafRef.current != null) {
          cancelAnimationFrame(fadeRafRef.current);
          fadeRafRef.current = null;
          audio.pause();
          audio.volume = startVol;
          resolve();
        }
      }, fadeMs + FADE_FRAME_MS * 4);
    });
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
    setPosition(audio.currentTime);
  }, []);

  // ─── Sleep timer ─────────────────────────────────────────────────

  useEffect(() => {
    if (sleepTimerHandleRef.current) {
      clearTimeout(sleepTimerHandleRef.current);
      sleepTimerHandleRef.current = null;
    }
    if (!sleepTimerMs || sleepTimerMs <= 0) return;
    // Schedule a fade-out that ends at sleepTimerMs from now. We start
    // the 3-second fade 3s before the deadline so the audio reaches 0
    // exactly when the timer fires.
    const fadeMs = 3000;
    const startFadeAt = Math.max(0, sleepTimerMs - fadeMs);
    sleepTimerHandleRef.current = setTimeout(() => {
      void fadeOutAndStop(fadeMs);
    }, startFadeAt);
    return () => {
      if (sleepTimerHandleRef.current) {
        clearTimeout(sleepTimerHandleRef.current);
        sleepTimerHandleRef.current = null;
      }
    };
  }, [sleepTimerMs, fadeOutAndStop]);

  return {
    playing,
    position,
    duration,
    loading,
    error,
    togglePlay,
    fadeOutAndStop,
    seek,
  };
}

// ─── Wake Lock helpers ─────────────────────────────────────────────

interface WakeLockSentinel {
  release(): Promise<void>;
}

async function requestWakeLock(ref: React.MutableRefObject<unknown>) {
  // @ts-expect-error - navigator.wakeLock is missing in older lib.dom.d.ts
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return;
  try {
    // @ts-expect-error - see above
    const sentinel = await navigator.wakeLock.request('screen');
    ref.current = sentinel as WakeLockSentinel;
  } catch {
    // User refused, page hidden, or unsupported — silently OK.
    ref.current = null;
  }
}

function releaseWakeLock(ref: React.MutableRefObject<unknown>) {
  const sentinel = ref.current as WakeLockSentinel | null;
  if (!sentinel) return;
  try {
    void sentinel.release();
  } catch {
    // ignore
  }
  ref.current = null;
}
