// ── Global single-track audio coordinator ─────────────────────────
//
// Why this exists:
//   Before, FavoritesScreen and ChatInterface each held their own
//   audioRef + AbortController. PR #25 fixed the rapid-tap race
//   *within* a single component, but cross-component playback could
//   still overlap (e.g. tapping a favorite while ChatInterface's
//   useRockyTTS shared `_sharedAudio` was still mid-mood-chirp). The
//   user reported Rocky echo presets "sometimes can't play, especially
//   when other audio is playing" — that's the symptom.
//
// Single-slot model:
//   At most one Audio element is bound at a time. Every play attempt
//   (favorite, chat block, anywhere) goes through `claimSlot()` which
//   atomically:
//     1. aborts any pending fetch from a previous claim
//     2. pauses any currently-playing audio
//     3. calls stopSharedAudio() to stop the rockyAudio singleton
//        used by useRockyTTS (this is the cross-component fix)
//     4. mints a new monotonic token
//   The caller then computes its src (sync for static paths, after
//   awaits for /api/tts), and calls `attachAudio(token, src, ...)`.
//   If a newer claim happened in the meantime, attachAudio is a no-op
//   that revokes any blob URL the caller passed in.
//
// Why a token instead of just AbortSignal:
//   Static paths skip the fetch entirely, so AbortSignal alone can't
//   tell us whether we still own the slot. The token check is a single
//   integer compare that works for both sync and async paths.

import { stopSharedAudio } from './rockyAudio';

interface BoundAudio {
  audio: HTMLAudioElement;
  blobUrl: string | null;
  onEnded: (() => void) | null;
}

let currentToken = 0;
let currentAbort: AbortController | null = null;
let currentBound: BoundAudio | null = null;

/**
 * Reserve the global audio slot for a new playback. Stops anything
 * currently playing (including useRockyTTS's shared singleton) and
 * returns:
 *   - `token`: pass to `attachAudio` and `isOwner` to verify the slot
 *     is still ours after async work.
 *   - `signal`: pass to `fetch(...)`. Aborts when a newer claim runs.
 */
export function claimSlot(): { token: number; signal: AbortSignal } {
  // Stop whatever is on the slot now.
  stopActiveAudio();
  // Stop the rockyAudio singleton (used by useRockyTTS). This is the
  // bit FavoritesScreen wasn't doing before — auto-TTS chirps could
  // keep going after a user-initiated favorite tap.
  stopSharedAudio();
  // Abort any in-flight fetch from the previous claim.
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }

  const token = ++currentToken;
  const ctrl = new AbortController();
  currentAbort = ctrl;
  return { token, signal: ctrl.signal };
}

/**
 * Bind an Audio element to the slot for the given token and start
 * playback. Returns true if playback started, false if the token no
 * longer owns the slot (caller should treat as stale; the blob URL
 * passed in opts.blobUrl will be revoked here in that case).
 *
 * `onEnded` fires when playback finishes naturally OR when a newer
 * claim takes the slot. UI uses it to reset the "playing" indicator
 * regardless of which path ended the playback.
 */
export function attachAudio(
  token: number,
  src: string,
  opts: { blobUrl?: string | null; onEnded?: () => void } = {}
): boolean {
  if (token !== currentToken) {
    // A newer claim has happened during the caller's async work.
    if (opts.blobUrl) URL.revokeObjectURL(opts.blobUrl);
    return false;
  }

  const audio = new Audio(src);
  const bound: BoundAudio = {
    audio,
    blobUrl: opts.blobUrl ?? null,
    onEnded: opts.onEnded ?? null,
  };
  currentBound = bound;

  const finish = () => {
    // Only act if this exact bound entry is still the active one. A
    // newer claim may have already replaced us; in that case
    // stopActiveAudio already cleaned up, and the onEnded callback
    // already fired from there.
    if (currentBound !== bound) return;
    currentBound = null;
    if (bound.blobUrl) URL.revokeObjectURL(bound.blobUrl);
    if (bound.onEnded) bound.onEnded();
  };

  audio.onended = finish;
  audio.onerror = finish;
  audio.play().catch(finish);
  return true;
}

/**
 * True if `token` is still the owner. Use after every `await` before
 * touching React state to prevent stale callbacks from clobbering a
 * newer playback.
 */
export function isOwner(token: number): boolean {
  return token === currentToken;
}

/**
 * Stop whatever's playing right now and abort any in-flight fetch.
 * Use this from "toggle off" handlers and unmount cleanups.
 */
export function releaseSlot(): void {
  stopActiveAudio();
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  // Bump the token so any in-flight async work loses ownership too.
  currentToken++;
}

// Internal: tear down whatever is bound, firing onEnded so the UI
// component that owns the bound audio resets its "playing" indicator.
function stopActiveAudio(): void {
  if (!currentBound) return;
  const bound = currentBound;
  currentBound = null;
  bound.audio.pause();
  bound.audio.onended = null;
  bound.audio.onerror = null;
  if (bound.blobUrl) URL.revokeObjectURL(bound.blobUrl);
  if (bound.onEnded) bound.onEnded();
}
