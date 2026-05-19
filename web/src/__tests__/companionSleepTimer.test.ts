import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSleepTimer,
  FADE_DURATION_MS,
  SLEEP_TIMER_OPTIONS_MIN,
  DEFAULT_SLEEP_TIMER_MIN,
} from '../utils/companionSleepTimer';

describe('SLEEP_TIMER_OPTIONS_MIN + defaults', () => {
  it('exposes the option set and default', () => {
    expect(SLEEP_TIMER_OPTIONS_MIN).toEqual(['off', 15, 30, 45, 60]);
    expect(DEFAULT_SLEEP_TIMER_MIN).toBe(30);
  });

  it('FADE_DURATION_MS is 8 seconds', () => {
    expect(FADE_DURATION_MS).toBe(8000);
  });
});

describe('createSleepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('off setting never fires fade or done', () => {
    const onFade = vi.fn();
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 'off', onFade, onDone });
    timer.start();
    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
    expect(onFade).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('30min setting: fade fires at 30min - 8s, done fires at 30min', () => {
    const onFade = vi.fn();
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 30, onFade, onDone });
    timer.start();

    // 29 min 51 sec elapsed — fade not yet fired (9s remaining)
    vi.advanceTimersByTime(29 * 60 * 1000 + 51 * 1000);
    expect(onFade).not.toHaveBeenCalled();

    // 30 min - 8 sec mark = 29 min 52 sec; fade should fire on next ms tick
    vi.advanceTimersByTime(1000);
    expect(onFade).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();

    // 30 min total — done fires
    vi.advanceTimersByTime(8 * 1000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('done is idempotent on extra advance', () => {
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 15, onFade: () => {}, onDone });
    timer.start();
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels pending fade and done', () => {
    const onFade = vi.fn();
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 30, onFade, onDone });
    timer.start();
    vi.advanceTimersByTime(10 * 60 * 1000);
    timer.stop();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onFade).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('change(minutes) resets countdown from new value', () => {
    const onFade = vi.fn();
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 30, onFade, onDone });
    timer.start();
    vi.advanceTimersByTime(25 * 60 * 1000); // 25min elapsed, 5min remaining
    timer.change(45); // reset to 45min from now

    // After change, 44min 51sec passes — fade not fired (9s remain)
    vi.advanceTimersByTime(44 * 60 * 1000 + 51 * 1000);
    expect(onFade).not.toHaveBeenCalled();

    // One more second crosses the fade-entry mark
    vi.advanceTimersByTime(1000);
    expect(onFade).toHaveBeenCalledTimes(1);
  });

  it('remainingMs() reports wall-clock-based remaining time', () => {
    const timer = createSleepTimer({ minutes: 30, onFade: () => {}, onDone: () => {} });
    timer.start();
    expect(timer.remainingMs()).toBe(30 * 60 * 1000);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timer.remainingMs()).toBe(20 * 60 * 1000);
  });

  it('remainingMs() returns 0 when off', () => {
    const timer = createSleepTimer({ minutes: 'off', onFade: () => {}, onDone: () => {} });
    timer.start();
    expect(timer.remainingMs()).toBe(0);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timer.remainingMs()).toBe(0);
  });

  it('change to "off" stops any scheduled fire', () => {
    const onFade = vi.fn();
    const onDone = vi.fn();
    const timer = createSleepTimer({ minutes: 30, onFade, onDone });
    timer.start();
    vi.advanceTimersByTime(10 * 60 * 1000);
    timer.change('off');
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onFade).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
