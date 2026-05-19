// Wraps the Screen Wake Lock API.
// iOS Safari does not support this as of writing — silently falls
// back. Companion mode doesn't NEED the screen on (audio is the
// point), so failure is benign.

interface WakeLockSentinel {
  release: () => Promise<void>;
}

interface WakeLock {
  request: (type: 'screen') => Promise<WakeLockSentinel>;
}

export interface WakeLockHandle {
  release: () => Promise<void>;
}

/**
 * Request a screen wake lock. Returns a handle whose `release` is
 * a no-op if the request was denied or unsupported.
 *
 * Re-acquire after visibilitychange returns to visible — wake locks
 * are auto-released on hidden.
 */
export async function requestScreenWakeLock(): Promise<WakeLockHandle> {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (!wakeLock) {
    return { release: async () => {} };
  }
  try {
    const sentinel = await wakeLock.request('screen');
    return {
      release: async () => {
        try {
          await sentinel.release();
        } catch {
          // Ignore — sentinel may already be released by OS
        }
      },
    };
  } catch {
    // NotAllowedError, AbortError, etc. — all benign
    return { release: async () => {} };
  }
}
