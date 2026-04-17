// P5 F1: session endpoints are auth-required (/api/session/*).
// Registration happens before the first session/start call.

import type { Lang } from '../i18n';
import type { ChatMode } from './playLimit';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface StartSessionResult {
  ok: true;
  session_id: string;
}
export interface StartSessionDenied {
  ok: false;
  reason: 'not_authenticated' | 'network' | 'server';
}

export async function startSession(
  lang: Lang,
  mode: ChatMode
): Promise<StartSessionResult | StartSessionDenied> {
  try {
    const res = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, mode }),
    });
    if (res.status === 401) {
      return { ok: false, reason: 'not_authenticated' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'server' };
    }
    const json = (await res.json()) as { session_id: string };
    return { ok: true, session_id: json.session_id };
  } catch (err) {
    console.warn('startSession failed', err);
    return { ok: false, reason: 'network' };
  }
}

export function endSession(session_id: string): void {
  fetch(`${API_BASE}/api/session/end`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id }),
    keepalive: true,
  }).catch((err) => console.warn('endSession failed', err));
}

export function logMessage(
  session_id: string,
  role: 'user' | 'assistant',
  content: string
): void {
  fetch(`${API_BASE}/api/session/message`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, role, content }),
    keepalive: true,
  }).catch((err) => console.warn('logMessage failed', err));
}

export interface VoiceCreditsResponse {
  remaining: number;
}

export interface FavoriteRow {
  id: string;
  user_id: string;
  content_hash: string;
  message_content: string;
  mood: string | null;
  lang: string;
  source_session: string | null;
  created_at: number;
}

export async function fetchFavorites(): Promise<{ items: FavoriteRow[]; cap: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/favorites`, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as { items: FavoriteRow[]; cap: number };
  } catch (err) {
    console.warn('fetchFavorites failed', err);
    return null;
  }
}

export async function addFavorite(payload: {
  message_content: string;
  lang: Lang;
  mood?: string | null;
  source_session?: string | null;
}): Promise<{ ok: true; id: string; content_hash: string } | { ok: false; reason: 'full' | 'exists' | 'server' }> {
  try {
    const res = await fetch(`${API_BASE}/api/favorites`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'favorites_full') return { ok: false, reason: 'full' };
      return { ok: false, reason: 'exists' };
    }
    if (!res.ok) return { ok: false, reason: 'server' };
    const body = (await res.json()) as { id: string; content_hash: string };
    return { ok: true, ...body };
  } catch (err) {
    console.warn('addFavorite failed', err);
    return { ok: false, reason: 'server' };
  }
}

export async function removeFavorite(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/favorites/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch (err) {
    console.warn('removeFavorite failed', err);
    return false;
  }
}

export async function fetchVoiceCredits(): Promise<VoiceCreditsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/voice-credits`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()) as VoiceCreditsResponse;
  } catch (err) {
    console.warn('fetchVoiceCredits failed', err);
    return null;
  }
}

export interface CheckCallsignResult {
  available: boolean;
  callsign?: string;
  reason?: 'invalid_format';
}

export async function checkCallsign(q: string): Promise<CheckCallsignResult | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/public/check-callsign?q=${encodeURIComponent(q)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as CheckCallsignResult;
  } catch (err) {
    console.warn('checkCallsign failed', err);
    return null;
  }
}

