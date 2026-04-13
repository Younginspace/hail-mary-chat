// Thin client for the EdgeSpark session/quota endpoints.
// All calls carry X-Device-Id. Errors are logged, not thrown, for
// fire-and-forget sites; callers that need the result await the promise.

import type { Lang } from '../i18n';
import type { ChatMode } from './playLimit';
import { getDeviceId } from './deviceId';

const API_BASE = import.meta.env.VITE_API_URL || '';

function withDeviceHeader(extra: Record<string, string> = {}): HeadersInit {
  return {
    'X-Device-Id': getDeviceId(),
    ...extra,
  };
}

export interface QuotaResponse {
  used: number;
  remaining: number;
  dailyLimit: number;
  resetAt: number; // unix ms
  anonymous?: boolean;
}

export async function fetchQuota(): Promise<QuotaResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/quota`, {
      method: 'GET',
      headers: withDeviceHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()) as QuotaResponse;
  } catch (err) {
    console.warn('fetchQuota failed', err);
    return null;
  }
}

export interface StartSessionResult {
  ok: true;
  session_id: string;
  used: number;
  remaining: number;
  resetAt: number;
}
export interface StartSessionDenied {
  ok: false;
  reason: 'quota_exceeded' | 'network' | 'server';
  resetAt?: number;
}

export async function startSession(
  lang: Lang,
  mode: ChatMode
): Promise<StartSessionResult | StartSessionDenied> {
  try {
    const res = await fetch(`${API_BASE}/api/public/session/start`, {
      method: 'POST',
      headers: withDeviceHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lang, mode }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: 'quota_exceeded', resetAt: body.resetAt };
    }
    if (!res.ok) {
      return { ok: false, reason: 'server' };
    }
    const json = (await res.json()) as {
      session_id: string;
      used: number;
      remaining: number;
      resetAt: number;
    };
    return { ok: true, ...json };
  } catch (err) {
    console.warn('startSession failed', err);
    return { ok: false, reason: 'network' };
  }
}

export function endSession(session_id: string): void {
  // keepalive: true lets this survive page unload. If the browser drops it
  // anyway (rare), the session simply lacks ended_at — consolidation can
  // infer end time from the last message. turn_count is maintained
  // server-side in /session/message so we don't send it here.
  fetch(`${API_BASE}/api/public/session/end`, {
    method: 'POST',
    headers: withDeviceHeader({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id }),
    keepalive: true,
  }).catch((err) => console.warn('endSession failed', err));
}

export function logMessage(
  session_id: string,
  role: 'user' | 'assistant',
  content: string
): void {
  // Fire-and-forget. Silent failures are acceptable for P1 — missing one
  // turn just leaves a gap in memory consolidation later.
  fetch(`${API_BASE}/api/public/session/message`, {
    method: 'POST',
    headers: withDeviceHeader({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id, role, content }),
    keepalive: true,
  }).catch((err) => console.warn('logMessage failed', err));
}
