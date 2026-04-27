// P5 F1: session endpoints are auth-required (/api/session/*).
// Registration happens before the first session/start call.

import type { Lang } from '../i18n';
import type { ChatMode } from './playLimit';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface LevelUpPayload {
  from: number;
  to: number;
  image_credits: number;
  music_credits: number;
  video_credits: number;
  // Cumulative remaining Grace cameo credits after the level-up. The
  // ceremony uses this to show "Grace can visit X more times" — it's
  // the total budget, not the per-level delta.
  grace_credits: number;
}

export interface StartSessionResult {
  ok: true;
  session_id: string;
  affinity_level: number;
  level_up: LevelUpPayload | null;
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
    const json = (await res.json()) as {
      session_id: string;
      affinity_level?: number;
      level_up?: LevelUpPayload | null;
    };
    return {
      ok: true,
      session_id: json.session_id,
      affinity_level: json.affinity_level ?? 1,
      level_up: json.level_up ?? null,
    };
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
  content: string,
  id?: string,
): void {
  fetch(`${API_BASE}/api/session/message`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // Pass `id` so the server stores the same primary key the client uses.
    // Lets /api/tts?message_id=<id> link audio back to this row.
    body: JSON.stringify({ session_id, role, content, id }),
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
  // 'rocky' | 'grace' — drives the speaker badge in the favorites list
  // and the speaker= URL param on /api/tts replay (so cloned Grace lines
  // render as Gosling, not as Rocky's voice). Server defaults to 'rocky'
  // for legacy rows and pre-Grace clients.
  speaker: 'rocky' | 'grace';
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
  // Identifies which speaker the favorited block came from. Required
  // for Grace cameo blocks so the server hashes against Grace's
  // cloned voice_id (otherwise replay falls back to Rocky's voice).
  // Defaults server-side to 'rocky' when omitted.
  speaker?: 'rocky' | 'grace';
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

// ── F6 Phase 2: gift generation ──

export type GiftType = 'image' | 'music' | 'video';
export type GiftImageSubtype = 'realistic' | 'comic';

export interface GiftReady {
  id: string;
  type: GiftType;
  subtype: GiftImageSubtype | null;
  status: 'ready';
  url: string;
  expires_at: number;
  content_type: string;
  caption: string | null;
  remaining: number;
}

export type GenerateGiftResult =
  | GiftReady
  | { status: 'failed'; reason: 'insufficient' | 'minimax' | 'network' | 'storage'; detail?: string };

export async function generateGift(
  type: GiftType,
  description: string,
  session_id?: string | null,
  subtype?: GiftImageSubtype | null
): Promise<GenerateGiftResult> {
  try {
    const res = await fetch(`${API_BASE}/api/generate-media`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        subtype: subtype ?? undefined,
        description,
        session_id: session_id ?? null,
      }),
    });
    if (res.status === 402) {
      return { status: 'failed', reason: 'insufficient' };
    }
    if (res.status === 502 || res.status === 500) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { status: 'failed', reason: body.error === 'storage_failed' ? 'storage' : 'minimax' };
    }
    if (!res.ok) {
      return { status: 'failed', reason: 'minimax' };
    }
    const json = (await res.json()) as GiftReady;
    return json;
  } catch (err) {
    console.warn('generateGift failed', err);
    return { status: 'failed', reason: 'network' };
  }
}

export interface GiftRow {
  id: string;
  type: GiftType;
  subtype: GiftImageSubtype | null;
  description: string | null;
  status: string;
  created_at: number;
  url: string | null;
}

export async function fetchGifts(): Promise<GiftRow[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/gifts`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as { gifts: GiftRow[] };
    return json.gifts;
  } catch (err) {
    console.warn('fetchGifts failed', err);
    return null;
  }
}

