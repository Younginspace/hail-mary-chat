// Wall-clock sleep timer for companion mode.
//
// "Wall-clock" means countdown is based on Date.now() deltas, NOT
// audio playback time. If iOS pauses our audio in background, the
// timer continues. If the user returns from background past the
// scheduled fade or done time, those handlers fire immediately on
// the next tick.
//
// Two scheduled callbacks per timer:
//   - onFade fires 8s before done — UI fades base audio
//   - onDone fires at the scheduled time — UI navigates back to home
//
// Cancellation: stop() clears both. change(min) resets from the
// current moment with a new duration.

export const SLEEP_TIMER_OPTIONS_MIN = ['off', 15, 30, 45, 60] as const;
export type SleepTimerOption = (typeof SLEEP_TIMER_OPTIONS_MIN)[number];

export const DEFAULT_SLEEP_TIMER_MIN: SleepTimerOption = 30;
export const FADE_DURATION_MS = 8000;

export interface SleepTimerHandle {
  start: () => void;
  stop: () => void;
  change: (minutes: SleepTimerOption) => void;
  remainingMs: () => number;
}

interface Args {
  minutes: SleepTimerOption;
  onFade: () => void;
  onDone: () => void;
}

export function createSleepTimer(args: Args): SleepTimerHandle {
  let { minutes } = args;
  const { onFade, onDone } = args;

  let startedAt: number | null = null;
  let durationMs: number = minutes === 'off' ? 0 : minutes * 60 * 1000;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let doneFired = false;

  function clearScheduled() {
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    if (doneTimer !== null) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
  }

  function schedule() {
    if (durationMs <= 0) return; // 'off'
    const fadeAtMs = Math.max(0, durationMs - FADE_DURATION_MS);
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      onFade();
    }, fadeAtMs);
    doneTimer = setTimeout(() => {
      doneTimer = null;
      if (doneFired) return;
      doneFired = true;
      onDone();
    }, durationMs);
  }

  return {
    start() {
      doneFired = false;
      startedAt = Date.now();
      clearScheduled();
      schedule();
    },
    stop() {
      startedAt = null;
      clearScheduled();
    },
    change(newMinutes: SleepTimerOption) {
      minutes = newMinutes;
      durationMs = newMinutes === 'off' ? 0 : newMinutes * 60 * 1000;
      doneFired = false;
      startedAt = Date.now();
      clearScheduled();
      schedule();
    },
    remainingMs() {
      if (startedAt === null || durationMs <= 0) return 0;
      const elapsed = Date.now() - startedAt;
      return Math.max(0, durationMs - elapsed);
    },
  };
}
