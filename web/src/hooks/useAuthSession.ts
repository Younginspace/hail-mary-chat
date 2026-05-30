// Rocky-side wrapper around EdgeSpark auth.
//
// Exposes whoever is currently signed in (or null for anonymous device users),
// the callsign surfaced by /api/me (defaults to the email local-part), and
// sign-in / sign-up / sign-out helpers that also trigger device adoption so
// Rocky's memory follows the account.
//
// 2026-05-30 — converted from a per-component hook to a single AuthProvider
// + context consumer. Previously FIVE components (StartScreen, LoginModal,
// DialInScreen, ChatInterface, EchoInterface) each instantiated this hook,
// so each had its own onSessionChange subscription → up to ~6 concurrent
// adopt-device POSTs fired on a single login. Some of those raced ahead of
// the just-set session cookie being attached, hit the EdgeSpark platform
// auth gate (which 401s /api/* BEFORE our handler with body
// {"error":"UNAUTHENTICATED"}), and the client mapped that unknown code to
// the generic "通讯节点拒绝". This was the root of the WebKit stuck-login
// incident. One provider + the in-flight dedupe below = exactly one adopt
// per login, eliminating the race.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { esClient } from '../lib/edgespark';
import type { AuthSession } from '@edgespark/web';
import { getDeviceId, resetDeviceId } from '../utils/deviceId';
import { rememberEmail } from '../utils/rememberedEmail';

export interface AdoptedMe {
  email: string | null;
  callsign: string | null;
  adopted: boolean;
  affinity_level?: number;
  // 0–100 progress toward the next affinity level. null when the user
  // is at the max level (4). Server hides the underlying trust/warmth
  // scores intentionally — see /api/me on the server for rationale.
  progress_to_next?: number | null;
  // Lifetime voice-credits balance. Mirrored here so the affinity /
  // voice-mode UI surfaces stay in sync with whatever the chat surface
  // already knows from /api/voice-credits, without requiring two
  // refetches every time the level updates.
  voice_credits?: number;
}

// Discriminated result. Caller can react to adoption-specific failures
// (e.g. surface a real message to the user, retry, etc.) rather than
// silently treating any non-2xx as a no-op like the old `null` return.
// Added 2026-05-22 after the 2.7% orphan-auth-user incident — the old
// silent return left users stuck in a half-state (auth account exists
// in es_system__auth_user, no users row in our app DB).
export type AdoptResult =
  | { ok: true; me: AdoptedMe }
  | { ok: false; status: number; code: string; detail?: string; ref?: string };

async function adoptDevice(callsign?: string, _attempt = 0): Promise<AdoptResult> {
  try {
    const res = await esClient.api.fetch('/api/adopt-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
      },
      body: JSON.stringify({ callsign }),
    });
    if (!res.ok) {
      // Read the body as TEXT first, then try JSON. The whole point of the
      // 2026-05-30 stuck-login investigation: when the failure is a
      // framework-level 401 ({"error":"UNAUTHENTICATED"}) or a Hono default
      // 500, the body may not be our {error} JSON — the old `await
      // res.json()` either threw or yielded an unmapped code, collapsing
      // every distinct failure into the generic "通讯节点拒绝". Capturing
      // the raw text + status + content-type is the source of truth the
      // server logs can't provide for framework-level failures (which never
      // reach our handler).
      let rawText = '';
      try {
        rawText = await res.text();
      } catch {
        /* body unreadable — keep empty */
      }
      let body: { error?: string; detail?: string; ref?: string } = {};
      try {
        body = JSON.parse(rawText) as { error?: string; detail?: string; ref?: string };
      } catch {
        /* non-JSON body (framework 401 / Hono default 500) */
      }

      // Cookie-commit timing mitigation. On WebKit (iOS Safari / DuckDuckGo
      // / Huawei ArkWeb — exactly the browsers our stuck users are on) the
      // session cookie just set by signIn is sometimes NOT yet attached to
      // this immediate follow-up request, yielding a framework-level 401
      // before our handler runs. Retry ONCE after a short delay. If the
      // cookie genuinely never sticks this just costs 400ms before we
      // surface the (now-diagnosable) error; if it's a race, it heals it.
      if (res.status === 401 && _attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        return adoptDevice(callsign, 1);
      }

      // Full diagnostic to the console regardless of what we render. The
      // ref (if present) ties to the server's [onError] log line.
      console.error('[adopt-device] failed', {
        status: res.status,
        statusText: res.statusText,
        ref: body.ref ?? null,
        contentType: res.headers.get('content-type'),
        bodyPrefix: rawText.slice(0, 300),
        attempt: _attempt,
      });

      return {
        ok: false,
        status: res.status,
        code: body.error ?? 'unknown',
        detail: body.detail,
        ref: body.ref,
      };
    }
    const me = (await res.json()) as AdoptedMe;
    return { ok: true, me };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: 'network_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchMe(): Promise<AdoptedMe | null> {
  try {
    const res = await esClient.api.fetch('/api/me', {
      headers: { 'X-Device-Id': getDeviceId() },
    });
    if (!res.ok) return null;
    return (await res.json()) as AdoptedMe;
  } catch {
    return null;
  }
}

// The actual state + behavior. Instantiated EXACTLY ONCE by <AuthProvider>;
// every component reads the result via the useAuthSession() context consumer
// below. Do not call this directly from components.
function useAuthSessionState() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [me, setMe] = useState<AdoptedMe | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks whether /api/adopt-device has completed (or failed) for the
  // current session. Consumers that need the server to have linked a
  // users row (chat, session/start, memory) must gate on `ready`, not
  // just `isAuthenticated` — otherwise a fast first-send can race the
  // adoption round-trip and the server will see no user context yet.
  const [adopted, setAdopted] = useState(false);

  // Coalesce concurrent adopt-device calls into a single in-flight request.
  // With a single provider there is one onSessionChange subscription, but
  // signIn/signUp adopt explicitly AND onSessionChange can fire — this
  // guarantees they share one network call instead of racing. Cleared on
  // settle so the next genuine login/restore starts fresh.
  const adoptInFlight = useRef<Promise<AdoptResult> | null>(null);
  const runAdopt = useCallback((callsign?: string) => {
    if (adoptInFlight.current) return adoptInFlight.current;
    const p = adoptDevice(callsign).finally(() => {
      adoptInFlight.current = null;
    });
    adoptInFlight.current = p;
    return p;
  }, []);

  // Set by signInEmail/signUpEmail so the onSessionChange subscription (which
  // fires when signIn establishes the session) does NOT also adopt — the
  // explicit path owns adoption on login and carries the callsign on signup.
  // onSessionChange only self-adopts for the page-load session-restore case.
  const explicitAdoptPending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = esClient.auth.onSessionChange(async (next) => {
      if (cancelled) return;
      if (next) {
        if (explicitAdoptPending.current) {
          // An explicit signIn/signUp is in flight and owns adoption; just
          // reflect the session so gating UI updates. The explicit path
          // sets me/adopted when its single adopt resolves.
          setSession(next);
          setLoading(false);
          return;
        }
        // Page-load session restore — adopt here.
        // Keep isAuthenticated=false until adoption completes, so UI
        // gated on `ready`/`isAuthenticated` can't fire chat before the
        // server has our users row.
        setAdopted(false);
        const result = await runAdopt();
        if (cancelled) return;
        if (result.ok) setMe(result.me);
        else setMe(await fetchMe());
        if (cancelled) return;
        setSession(next);
        setAdopted(true);
        setLoading(false);
      } else {
        setSession(null);
        setMe(null);
        setAdopted(false);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [runAdopt]);

  // Build a better-auth-shaped synthetic error from an AdoptResult so
  // signIn/signUp callers (LoginModal, DialInScreen) can treat adoption
  // failures the same way as auth-layer failures — they already render
  // result.error.message. Stable machine codes mirror the server's
  // adoption_failures.error_code values.
  const adoptionError = (r: { code: string; status: number; detail?: string; ref?: string }) => ({
    error: {
      message: `adoption_failed:${r.code}`,
      status: r.status,
      code: r.code,
      // Carried through so LoginModal / DialInScreen can render a short,
      // safe diagnostic tag (ERR-<ref> from the server, or HTTP-<status>
      // for framework-level failures) the user can screenshot for us.
      ref: r.ref,
      detail: r.detail,
    },
  });

  const signInEmail = useCallback(
    async (email: string, password: string) => {
      explicitAdoptPending.current = true;
      try {
        const res = await esClient.auth.signIn.email({ email, password });
        if (res.error) return res;
        rememberEmail(email);
        // Synchronously adopt so the caller can show success UI with a real
        // callsign rather than waiting for onSessionChange to race.
        const result = await runAdopt();
        if (result.ok) {
          setMe(result.me);
          setAdopted(true);
          return res;
        }
        // Adoption failed — surface to caller as if it were an auth error so
        // they show a real message instead of silently treating signin as
        // success.
        console.warn('adoptDevice after signIn failed', result.code, result.status);
        return adoptionError(result);
      } finally {
        explicitAdoptPending.current = false;
      }
    },
    [runAdopt]
  );

  const signUpEmail = useCallback(
    async (email: string, password: string, callsign?: string) => {
      explicitAdoptPending.current = true;
      try {
        const res = await esClient.auth.signUp.email({
          email,
          password,
          name: callsign ?? email.split('@')[0],
        });
        if (res.error) return res;
        rememberEmail(email);
        // EdgeSpark/better-auth doesn't always auto-establish a session after
        // signUp (autoSignIn config can be off). Explicitly sign in so the
        // cookie is guaranteed before adopt-device / startSession run.
        // Safe to call even if already signed in.
        const signInRes = await esClient.auth.signIn.email({ email, password });
        if (signInRes.error) {
          console.warn('auto-signIn after signUp failed', signInRes.error);
          return signInRes;
        }
        const result = await runAdopt(callsign);
        if (result.ok) {
          setMe(result.me);
          setAdopted(true);
          return res;
        }
        // Adoption failed AFTER auth.signUp + signIn succeeded. The auth
        // account exists (this is precisely the orphan case the 2026-05-22
        // incident report covers). Caller will display a real message;
        // server has telemetry to track the failure pattern; the retry path
        // is rate-limit-exempt via adoption_failures lookup.
        console.warn('adoptDevice after signUp failed', result.code, result.status);
        return adoptionError(result);
      } finally {
        explicitAdoptPending.current = false;
      }
    },
    [runAdopt]
  );

  const signOut = useCallback(async () => {
    await esClient.auth.signOut();
    setMe(null);
    setAdopted(false);
    // Clear the browser's anonymous device identity so the next account
    // registering on this device doesn't collide with the previous owner.
    resetDeviceId();
  }, []);

  // Refetch /api/me — call after a level-up so the status-bar level badge
  // and any other consumer reading me.affinity_level reflect the new state.
  const refreshMe = useCallback(async () => {
    const next = await fetchMe();
    if (next) setMe(next);
  }, []);

  return {
    session,
    me,
    loading,
    // isAuthenticated flips true only after adoptDevice resolved, so
    // any consumer gating on this can safely assume the server knows
    // our users row.
    isAuthenticated: !!session && adopted,
    // Explicit alias in case a caller wants the distinction.
    ready: !loading && (!session || adopted),
    signInEmail,
    signUpEmail,
    signOut,
    refreshMe,
  };
}

// Single shared auth state for the whole app. The value shape is exactly
// what useAuthSessionState returns, so existing consumers keep working
// unchanged after the provider refactor.
type AuthContextValue = ReturnType<typeof useAuthSessionState>;

const AuthContext = createContext<AuthContextValue | null>(null);

// Mount once at the app root. Runs the ONE onSessionChange subscription and
// holds the shared session/me/adopted state. Written with createElement so
// this file stays a plain .ts (no JSX) and existing import paths are intact.
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthSessionState();
  return createElement(AuthContext.Provider, { value }, children);
}

// Consumer hook — identical return shape to the old per-component hook, so
// the 5 call sites need no changes beyond being wrapped in <AuthProvider>.
export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthSession must be used within <AuthProvider>');
  }
  return ctx;
}
