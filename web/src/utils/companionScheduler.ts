// Pure scheduler logic for companion mode trigger sounds.
// Kept dependency-free for testability — consumed by useCompanionAudio.
//
// Design rules (per spec §3):
//   - 20 trigger ids, 5 groups × 4 variants (hum / tap / scrape / breath / rummage)
//   - Each pickNextTrigger excludes the most-recent id to avoid
//     audible repetition in a single session
//   - Interval is uniform random in [30s, 120s]; over a 1h session,
//     ~60 triggers fire, all 20 ids should be touched

export const TRIGGER_GROUPS = ['hum', 'tap', 'scrape', 'breath', 'rummage'] as const;
export type TriggerGroup = (typeof TRIGGER_GROUPS)[number];

function buildTriggerIds(): readonly string[] {
  const out: string[] = [];
  for (const group of TRIGGER_GROUPS) {
    for (let n = 1; n <= 4; n++) {
      out.push(`${group}-${String(n).padStart(2, '0')}`);
    }
  }
  return Object.freeze(out);
}

export const TRIGGER_IDS = buildTriggerIds(); // 20 ids

export const MIN_INTERVAL_MS = 30_000;
export const MAX_INTERVAL_MS = 120_000;

/**
 * Pick the next trigger id, guaranteed not equal to `previousId`.
 * Pass `null` when called for the first trigger of a session.
 */
export function pickNextTrigger(previousId: string | null): string {
  if (previousId === null) {
    return TRIGGER_IDS[Math.floor(Math.random() * TRIGGER_IDS.length)];
  }
  // Pick from the (n-1) ids that aren't the previous one
  const candidates = TRIGGER_IDS.filter((id) => id !== previousId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Uniform random interval in [MIN_INTERVAL_MS, MAX_INTERVAL_MS].
 * Returned in milliseconds, intended for setTimeout.
 */
export function pickNextInterval(): number {
  const span = MAX_INTERVAL_MS - MIN_INTERVAL_MS;
  return MIN_INTERVAL_MS + Math.floor(Math.random() * (span + 1));
}

/**
 * Map a trigger id to its mp3 path under web/public/audio/companion/v1/.
 */
export function triggerUrl(id: string): string {
  return `/audio/companion/v1/triggers/${id}.mp3`;
}

/**
 * Env bed asset URL.
 */
export const ENV_BED_URL = '/audio/companion/v1/env-bed-01.mp3';
