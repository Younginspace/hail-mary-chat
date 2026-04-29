// Rocky-side wrapper around EdgeSpark auth.
//
// Exposes whoever is currently signed in (or null for anonymous device users),
// the callsign surfaced by /api/me (defaults to the email local-part), and
// sign-in / sign-up / sign-out helpers that also trigger device adoption so
// Rocky's memory follows the account.

import { useEffect, useState, useCallback } from 'react';
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

async function adoptDevice(callsign?: string): Promise<AdoptedMe | null> {
  try {
    const res = await esClient.api.fetch('/api/adopt-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
      },
      body: JSON.stringify({ callsign }),
    });
    if (!res.ok) return null;
    return (await res.json()) as AdoptedMe;
  } catch {
    return null;
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

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [me, setMe] = useState<AdoptedMe | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks whether /api/adopt-device has completed (or failed) for the
  // current session. Consumers that need the server to have linked a
  // users row (chat, session/start, memory) must gate on `ready`, not
  // just `isAuthenticated` — otherwise a fast first-send can race the
  // adoption round-trip and the server will see no user context yet.
  const [adopted, setAdopted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = esClient.auth.onSessionChange(async (next) => {
      if (cancelled) return;
      if (next) {
        // Keep isAuthenticated=false until adoption completes, so UI
        // gated on `ready`/`isAuthenticated` can't fire chat before the
        // server has our users row.
        setAdopted(false);
        const adopted = await adoptDevice();
        if (cancelled) return;
        if (adopted) setMe(adopted);
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
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    const res = await esClient.auth.signIn.email({ email, password });
    if (!res.error) {
      rememberEmail(email);
      // Synchronously adopt so the caller can show success UI with a real
      // callsign rather than waiting for onSessionChange to race.
      const adopted = await adoptDevice();
      if (adopted) {
        setMe(adopted);
        setAdopted(true);
      }
    }
    return res;
  }, []);

  const signUpEmail = useCallback(
    async (email: string, password: string, callsign?: string) => {
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
      const adopted = await adoptDevice(callsign);
      if (adopted) {
        setMe(adopted);
        setAdopted(true);
      }
      return res;
    },
    []
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
