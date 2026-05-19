// MediaSession metadata + lock-screen handler wrapper. Feature-detected
// and best-effort — repo has no prior MediaSession usage, lock-screen
// MM:SS rendering is browser-dependent (verified only via real-device QA).
//
// Handlers wired: pause, stop. NOT seekto/previoustrack/nexttrack
// (companion has no notion of "tracks", per #38 lesson).

export interface CompanionMediaSessionHandlers {
  onPause: () => void;
  onStop: () => void;
}

// Optional artwork — falls back gracefully if missing on the server.
const ARTWORK_URL = '/audio/companion/v1/artwork.png';

export function setupCompanionMediaSession(handlers: CompanionMediaSessionHandlers): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return () => {};
  }
  const ms = (navigator as Navigator & { mediaSession: MediaSession }).mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title: 'Rocky · Companion',
      artist: 'Hail Mary Chat',
      album: 'Companion v1',
      artwork: [{ src: ARTWORK_URL, sizes: '512x512', type: 'image/png' }],
    });
  } catch {
    // Some browsers may throw on MediaMetadata constructor
  }
  try {
    ms.setActionHandler('pause', () => handlers.onPause());
  } catch {
    /* unsupported action — silent */
  }
  try {
    ms.setActionHandler('stop', () => handlers.onStop());
  } catch {
    /* unsupported action — silent */
  }
  try {
    ms.playbackState = 'playing';
  } catch {
    /* unsupported — silent */
  }

  return () => {
    try {
      ms.setActionHandler('pause', null);
    } catch {
      /* silent */
    }
    try {
      ms.setActionHandler('stop', null);
    } catch {
      /* silent */
    }
    try {
      ms.playbackState = 'none';
    } catch {
      /* silent */
    }
  };
}
