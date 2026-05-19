// Asset URLs for companion mode v1.
// Paths are served by EdgeSpark Worker as static assets from
// web/public/audio/companion/v1/. Versioned (`v1`) so future
// asset replacements can bump the path and naturally orphan old
// browser cache.

export { TRIGGER_IDS, ENV_BED_URL, triggerUrl } from './companionScheduler';

/**
 * Critical assets that MUST load before transitioning Loading → Ready.
 * The full library of 20 triggers loads lazily after that.
 *
 * One per group (sans rummage which loads lazily — rarest in cadence).
 */
export function criticalTriggerIds(): string[] {
  return ['hum-01', 'tap-01', 'scrape-01', 'breath-01'];
}
