import { describe, it, expect } from 'vitest';
import {
  pickNextTrigger,
  pickNextInterval,
  TRIGGER_IDS,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  triggerUrl,
  ENV_BED_URL,
} from '../utils/companionScheduler';

describe('TRIGGER_IDS', () => {
  it('has 20 ids — 5 groups × 4 variants', () => {
    expect(TRIGGER_IDS.length).toBe(20);
  });

  it('contains expected groups', () => {
    const groups = new Set(TRIGGER_IDS.map((id) => id.split('-')[0]));
    expect(groups).toEqual(new Set(['hum', 'tap', 'scrape', 'breath', 'rummage']));
  });

  it('uses zero-padded indices', () => {
    expect(TRIGGER_IDS).toContain('hum-01');
    expect(TRIGGER_IDS).toContain('rummage-04');
  });
});

describe('pickNextTrigger', () => {
  it('returns one of the 20 trigger ids when called with null previous', () => {
    const id = pickNextTrigger(null);
    expect(TRIGGER_IDS).toContain(id);
  });

  it('never returns the same id as the previous one', () => {
    for (let i = 0; i < 1000; i++) {
      const prev = TRIGGER_IDS[i % TRIGGER_IDS.length];
      const next = pickNextTrigger(prev);
      expect(next).not.toBe(prev);
      expect(TRIGGER_IDS).toContain(next);
    }
  });

  it('over 1000 picks with rolling previous, never adjacent-duplicates', () => {
    let prev = pickNextTrigger(null);
    for (let i = 0; i < 1000; i++) {
      const next = pickNextTrigger(prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it('distribution over 5000 picks visits each id at least once', () => {
    const seen = new Set<string>();
    let prev = pickNextTrigger(null);
    for (let i = 0; i < 5000; i++) {
      seen.add(prev);
      prev = pickNextTrigger(prev);
    }
    expect(seen.size).toBe(TRIGGER_IDS.length);
  });
});

describe('pickNextInterval', () => {
  it('returns value within [MIN_INTERVAL_MS, MAX_INTERVAL_MS]', () => {
    for (let i = 0; i < 1000; i++) {
      const ms = pickNextInterval();
      expect(ms).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      expect(ms).toBeLessThanOrEqual(MAX_INTERVAL_MS);
    }
  });

  it('range is 30s to 120s', () => {
    expect(MIN_INTERVAL_MS).toBe(30_000);
    expect(MAX_INTERVAL_MS).toBe(120_000);
  });

  it('over 5000 samples, mean is roughly the midpoint (uniform)', () => {
    let sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) sum += pickNextInterval();
    const mean = sum / N;
    // Uniform [30k, 120k] → expected mean ~75k; allow ±5k slack
    expect(mean).toBeGreaterThan(70_000);
    expect(mean).toBeLessThan(80_000);
  });
});

describe('asset URL helpers', () => {
  it('triggerUrl maps id to /audio/companion/v1/triggers/<id>.mp3', () => {
    expect(triggerUrl('hum-01')).toBe('/audio/companion/v1/triggers/hum-01.mp3');
  });

  it('ENV_BED_URL points at the env bed', () => {
    expect(ENV_BED_URL).toBe('/audio/companion/v1/env-bed-01.mp3');
  });
});
