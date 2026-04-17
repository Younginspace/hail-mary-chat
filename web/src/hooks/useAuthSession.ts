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

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = esClient.auth.onSessionChange(async (next) => {
      if (cancelled) return;
      setSession(next);
      setLoading(false);
      if (next) {
        // Always (re-)adopt on session change — idempotent on the backend.
        const adopted = await adoptDevice();
        if (!cancelled && adopted) setMe(adopted);
        else if (!cancelled) setMe(await fetchMe());
      } else {
        setMe(null);
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
      if (adopted) setMe(adopted);
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
      if (adopted) setMe(adopted);
      return res;
    },
    []
  );

  const signOut = useCallback(async () => {
    await esClient.auth.signOut();
    setMe(null);
    // Clear the browser's anonymous device identity so the next account
    // registering on this device doesn't collide with the previous owner.
    resetDeviceId();
  }, []);

  return {
    session,
    me,
    loading,
    isAuthenticated: !!session,
    signInEmail,
    signUpEmail,
    signOut,
  };
}
