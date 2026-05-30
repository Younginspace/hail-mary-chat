// #07 — Aliyun DashScope ASR client wrapper. Posts a recorded blob
// to /api/asr (auth-required) and returns the transcript.
//
// Server expects base64 in JSON because Workers' multipart body limits
// are stricter. We pay the ~33% size overhead willingly — recording
// caps at 60s ≈ <2MB even after base64, which is fine.

import type { Lang } from '../i18n';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type ASRError =
  | 'permission_denied'
  | 'unsupported_browser'
  | 'no_microphone'
  | 'audio_too_large'
  | 'unsupported_audio_format'
  | 'asr_submit_failed'
  | 'asr_failed'
  | 'asr_empty_transcript'
  | 'asr_timeout'
  | 'network'
  | 'unknown';

export type ASRResult =
  | { ok: true; transcript: string }
  | { ok: false; error: ASRError; detail?: string };

/** Convert a Blob to a base64 string (data: prefix stripped). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked btoa to avoid the "string too long" exception on large
  // blobs. Process 32KB at a time.
  let binary = '';
  const chunk = 32 * 1024;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function transcribeAudio(
  blob: Blob,
  mimeType: string,
  lang: Lang,
): Promise<ASRResult> {
  let audioBase64: string;
  try {
    audioBase64 = await blobToBase64(blob);
  } catch (err) {
    return { ok: false, error: 'unknown', detail: String(err) };
  }

  let res: Response;
  try {
    // Client-side hard timeout. The server self-bounds the DashScope poll at
    // ~7.5s → 504, but if the Worker stalls or the connection hangs there's
    // nothing to release the button (it's disabled during transcribe). 15s
    // is comfortably above the server ceiling + network slack; past it we
    // give up and surface a timeout so the UI never wedges.
    res = await fetch(`${API_BASE}/api/asr`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType, lang }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // AbortSignal.timeout fires a TimeoutError (a DOMException). Map it to the
    // transcribe-timeout copy; everything else is a network failure.
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      ok: false,
      error: isTimeout ? 'asr_timeout' : 'network',
      detail: String(err),
    };
  }

  if (!res.ok) {
    let body: { error?: string; detail?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore parse failure
    }
    const errKey = (body.error ?? '') as ASRError;
    const known: ASRError[] = [
      'audio_too_large',
      'unsupported_audio_format',
      'asr_submit_failed',
      'asr_failed',
      'asr_empty_transcript',
      'asr_timeout',
    ];
    return {
      ok: false,
      error: known.includes(errKey) ? errKey : 'unknown',
      detail: body.detail,
    };
  }

  let data: { transcript?: string };
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'unknown', detail: 'invalid response JSON' };
  }
  const transcript = (data.transcript ?? '').trim();
  if (!transcript) {
    return { ok: false, error: 'asr_empty_transcript' };
  }
  return { ok: true, transcript };
}
