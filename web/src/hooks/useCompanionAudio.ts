import { useEffect, useRef, useState, useCallback } from 'react';
import { claimSlot, releaseSlot, isOwner } from '../utils/audioPlayback';
import {
  ENV_BED_URL,
  pickNextInterval,
  pickNextTrigger,
  triggerUrl,
} from '../utils/companionScheduler';
import { criticalTriggerIds } from '../utils/companionAssets';
import {
  createSleepTimer,
  DEFAULT_SLEEP_TIMER_MIN,
  FADE_DURATION_MS,
} from '../utils/companionSleepTimer';
import type { SleepTimerHandle, SleepTimerOption } from '../utils/companionSleepTimer';
import { requestScreenWakeLock } from '../utils/wakeLock';
import type { WakeLockHandle } from '../utils/wakeLock';
import { setupCompanionMediaSession } from '../utils/companionMediaSession';

export type CompanionPhase = 'loading' | 'ready' | 'playing' | 'fading' | 'done' | 'error';

export interface UseCompanionAudio {
  phase: CompanionPhase;
  /** Wall-clock elapsed in playing+fading states, milliseconds. */
  elapsedMs: number;
  /** Wall-clock remaining until done. Returns 0 when sleep timer is 'off'. */
  remainingMs: number;
  /** Current sleep timer setting. */
  sleepTimer: SleepTimerOption;
  /** User-initiated start from Ready → Playing. MUST be called inside
   * a user-gesture event handler (iOS autoplay policy). */
  start: () => void;
  /** User-initiated stop. Triggers fade then done. No-op in fading/done. */
  stop: () => void;
  /** Change the sleep timer. Resets countdown from now with new duration. */
  setSleepTimer: (option: SleepTimerOption) => void;
  /** Retry from error state — restart asset preload. */
  retry: () => void;
}

interface Options {
  onDone: () => void;
  initialSleepTimer?: SleepTimerOption;
}

const ASSET_LOAD_TIMEOUT_MS = 5000;

export function useCompanionAudio({
  onDone,
  initialSleepTimer = DEFAULT_SLEEP_TIMER_MIN,
}: Options): UseCompanionAudio {
  const [phase, setPhase] = useState<CompanionPhase>('loading');
  const [sleepTimer, setSleepTimerState] = useState<SleepTimerOption>(initialSleepTimer);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [remainingMsTick, setRemainingMsTick] = useState(0); // forces re-render of remainingMs

  const baseAudioRef = useRef<HTMLAudioElement | null>(null);
  const triggerAudioRef = useRef<HTMLAudioElement | null>(null);
  const triggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTriggerIdRef = useRef<string | null>(null);
  const sleepHandleRef = useRef<SleepTimerHandle | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const mediaSessionTeardownRef = useRef<(() => void) | null>(null);
  const slotTokenRef = useRef<number | null>(null);
  const playStartTsRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest onDone in a ref to avoid stale-closure in long-lived timers
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // ── Stop everything: audio + timers + locks + media session ──
  const stopAllAudio = useCallback(() => {
    if (triggerTimerRef.current !== null) {
      clearTimeout(triggerTimerRef.current);
      triggerTimerRef.current = null;
    }
    if (fadeIntervalRef.current !== null) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    sleepHandleRef.current?.stop();
    sleepHandleRef.current = null;
    if (baseAudioRef.current) {
      baseAudioRef.current.pause();
      baseAudioRef.current.src = '';
      baseAudioRef.current = null;
    }
    if (triggerAudioRef.current) {
      triggerAudioRef.current.pause();
      triggerAudioRef.current.src = '';
      triggerAudioRef.current = null;
    }
    if (wakeLockRef.current) {
      void wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
    if (mediaSessionTeardownRef.current) {
      mediaSessionTeardownRef.current();
      mediaSessionTeardownRef.current = null;
    }
  }, []);

  // ── Asset preload helper, shared between mount and retry ──
  const loadAssets = useCallback(() => {
    const critical = criticalTriggerIds();
    const urls = [ENV_BED_URL, ...critical.map(triggerUrl)];
    setPhase('loading');
    Promise.all(urls.map((u) => preloadAudio(u, ASSET_LOAD_TIMEOUT_MS))).then(
      () => {
        if (cancelledRef.current) return;
        const token = slotTokenRef.current;
        if (token !== null && !isOwner(token)) return;
        setPhase('ready');
      },
      () => {
        if (cancelledRef.current) return;
        setPhase('error');
      },
    );
  }, []);

  // ── Mount: claim slot, kick off asset load ──
  useEffect(() => {
    cancelledRef.current = false;
    const { token } = claimSlot();
    slotTokenRef.current = token;
    loadAssets();

    return () => {
      cancelledRef.current = true;
      stopAllAudio();
      releaseSlot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ticker for elapsed + remaining display (1Hz) during playing/fading ──
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'fading') return;
    const interval = setInterval(() => {
      if (playStartTsRef.current !== null) {
        setElapsedMs(Date.now() - playStartTsRef.current);
      }
      // Bump tick so remainingMs() getter re-evaluates
      setRemainingMsTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ── Schedule next trigger (recursive setTimeout) ──
  const scheduleNextTrigger = useCallback(() => {
    if (triggerTimerRef.current !== null) clearTimeout(triggerTimerRef.current);
    const intervalMs = pickNextInterval();
    triggerTimerRef.current = setTimeout(() => {
      triggerTimerRef.current = null;
      const id = pickNextTrigger(lastTriggerIdRef.current);
      lastTriggerIdRef.current = id;
      if (triggerAudioRef.current) {
        triggerAudioRef.current.src = triggerUrl(id);
        // Best-effort; ignore failures (single trigger fail is benign)
        void triggerAudioRef.current.play().catch(() => {
          // Skip this trigger silently
        });
      }
      scheduleNextTrigger();
    }, intervalMs);
  }, []);

  // ── beginFade: linear 8s ramp on base volume ──
  const beginFade = useCallback(() => {
    setPhase('fading');
    if (triggerTimerRef.current !== null) {
      clearTimeout(triggerTimerRef.current);
      triggerTimerRef.current = null;
    }
    const base = baseAudioRef.current;
    if (!base) return;
    const startVol = base.volume;
    const fadeStart = Date.now();
    if (fadeIntervalRef.current !== null) clearInterval(fadeIntervalRef.current);
    fadeIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - fadeStart;
      const ratio = Math.min(1, elapsed / FADE_DURATION_MS);
      base.volume = Math.max(0, startVol * (1 - ratio));
      if (ratio >= 1) {
        if (fadeIntervalRef.current !== null) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
      }
    }, 100);
  }, []);

  // ── finishDone: terminal state ──
  const finishDone = useCallback(() => {
    setPhase('done');
    stopAllAudio();
    onDoneRef.current();
  }, [stopAllAudio]);

  // ── start: MUST be called inside a user gesture ──
  const start = useCallback(() => {
    setPhase((current) => {
      if (current !== 'ready') return current;

      const base = new Audio(ENV_BED_URL);
      base.loop = true;
      base.preload = 'auto';
      base.volume = 1.0;
      baseAudioRef.current = base;

      const trigger = new Audio();
      trigger.preload = 'auto';
      triggerAudioRef.current = trigger;

      // play() inside the gesture handler — iOS autoplay unlock
      void base.play().catch(() => {
        // Defer error reporting to the next tick so React state update is allowed
        setTimeout(() => setPhase('error'), 0);
      });

      playStartTsRef.current = Date.now();

      // Fire-and-forget WakeLock + MediaSession
      void requestScreenWakeLock().then((handle) => {
        if (!cancelledRef.current) wakeLockRef.current = handle;
        else void handle.release();
      });
      mediaSessionTeardownRef.current = setupCompanionMediaSession({
        onPause: () => stopUser(),
        onStop: () => stopUser(),
      });

      // Sleep timer starts COUNTING from here (per spec §5.4)
      sleepHandleRef.current = createSleepTimer({
        minutes: sleepTimer,
        onFade: () => beginFade(),
        onDone: () => finishDone(),
      });
      sleepHandleRef.current.start();

      scheduleNextTrigger();

      return 'playing';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepTimer, beginFade, finishDone, scheduleNextTrigger]);

  // ── stop (user-initiated): start fade, then finish after 8s ──
  const stopUser = useCallback(() => {
    setPhase((current) => {
      if (current === 'fading' || current === 'done') return current;
      // Defer the actual fade triggers to after state set
      setTimeout(() => {
        beginFade();
        if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => {
          exitTimerRef.current = null;
          if (!cancelledRef.current) finishDone();
        }, FADE_DURATION_MS);
      }, 0);
      return current; // beginFade() will flip to 'fading'
    });
  }, [beginFade, finishDone]);

  // ── setSleepTimer: change duration, reset countdown ──
  const handleSetSleepTimer = useCallback((option: SleepTimerOption) => {
    setSleepTimerState(option);
    sleepHandleRef.current?.change(option);
  }, []);

  // ── retry: from error back to loading ──
  const retry = useCallback(() => {
    loadAssets();
  }, [loadAssets]);

  // Force remainingMs to re-read on each tick
  void remainingMsTick;
  const remainingMs = sleepHandleRef.current?.remainingMs() ?? 0;

  return {
    phase,
    elapsedMs,
    remainingMs,
    sleepTimer,
    start,
    stop: stopUser,
    setSleepTimer: handleSetSleepTimer,
    retry,
  };
}

// ── helper: preload audio with a timeout ──
function preloadAudio(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'auto';
    const onCanPlay = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`audio load failed: ${url}`));
    };
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`audio load timeout: ${url}`));
    }, timeoutMs);
    function cleanup() {
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('error', onError);
      clearTimeout(timeoutId);
    }
    audio.addEventListener('canplaythrough', onCanPlay);
    audio.addEventListener('error', onError);
    audio.src = url;
    audio.load();
  });
}
