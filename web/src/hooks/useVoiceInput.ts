// #07 Voice input hook — MediaRecorder wrapper + iOS Safari codec
// fallback. Owns the per-recording lifecycle: permission probe →
// stream acquire → recorder start → blob accumulate → stop → blob
// out. Does NOT own the upload / transcription path; the caller
// hands the blob to /api/asr.
//
// iOS Safari quirk: MediaRecorder ships in iOS 14.3+ but defaults to
// audio/mp4 (AAC). Chrome/Firefox/Android default to audio/webm
// (Opus). DashScope Paraformer-v2 accepts both. We probe explicit
// MIME types and pick the first supported, so the server receives
// a known format.
//
// Cancel semantics: caller invokes `cancel()` to discard the blob
// without triggering onComplete. Used for the "drag up to cancel"
// gesture on the press-and-hold button.

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error';

export interface VoiceInputResult {
  blob: Blob;
  mimeType: string;
  /** Wall-clock recording duration in seconds (start → stop). */
  durationSec: number;
}

export type VoiceInputErrorCode =
  | 'permission_denied'
  | 'unsupported_browser'
  | 'no_microphone'
  | 'recorder_failed';

export interface UseVoiceInputOptions {
  /** Max recording duration in seconds. Auto-stops at this limit. */
  maxDurationSec?: number;
  /** Fired when stop() resolves with audio data. */
  onComplete?: (result: VoiceInputResult) => void;
  /** Fired on permission denial / unsupported browser / recorder error. */
  onError?: (code: VoiceInputErrorCode, detail?: string) => void;
}

export interface UseVoiceInputReturn {
  state: VoiceInputState;
  /** Seconds elapsed since recording started. 0 when idle. */
  elapsedSec: number;
  /** Begin recording. Resolves once MediaRecorder is started. */
  start: () => Promise<void>;
  /** Stop and emit the blob via onComplete. */
  stop: () => void;
  /** Discard the in-flight recording without firing onComplete. */
  cancel: () => void;
}

// MIME types we attempt in order. WebM/Opus is the cheapest and
// best-supported on Android/desktop; AAC is iOS Safari's preference.
// First match wins.
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export function useVoiceInput({
  maxDurationSec = 60,
  onComplete,
  onError,
}: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest callback refs so the recorder onstop closure doesn't capture
  // stale handlers if the parent re-renders mid-recording.
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // ─── Cleanup helper ─────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (elapsedTimerRef.current != null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (maxTimerRef.current != null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setElapsedSec(0);
  }, []);

  // Always tear down on unmount so we don't leak a live mic stream.
  useEffect(() => {
    return teardown;
  }, [teardown]);

  // ─── start ──────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    cancelledRef.current = false;
    chunksRef.current = [];

    // Browser feature check — bail before asking for the mic.
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      onErrorRef.current?.('unsupported_browser');
      setState('error');
      return;
    }

    const mimeType = pickSupportedMime();
    if (!mimeType) {
      onErrorRef.current?.('unsupported_browser', 'no MediaRecorder MIME type');
      setState('error');
      return;
    }

    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        onErrorRef.current?.('permission_denied');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        onErrorRef.current?.('no_microphone');
      } else {
        onErrorRef.current?.('recorder_failed', name || 'getUserMedia threw');
      }
      setState('error');
      return;
    }

    // CRITICAL: between `setState('requesting')` and `getUserMedia`
    // resolving (which can take ~50–500ms on slow devices), the user
    // may have already released the button or hit cancel. If we don't
    // check, we'd start a recorder that nobody will stop until the
    // 60s cap fires — leaving a hot mic stream live for up to a minute.
    // stop()/cancel() during 'requesting' set cancelledRef; honor it
    // here by tearing the stream down and bailing.
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      cancelledRef.current = false;
      setState('idle');
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      // Some browsers (older Safari) lie about isTypeSupported; fall back
      // to letting the browser pick its default. The server's mime-type
      // sniffing is permissive enough to handle most outcomes.
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        onErrorRef.current?.('recorder_failed', String(err));
        teardown();
        setState('error');
        return;
      }
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = () => {
      // Snapshot before teardown wipes the chunk array.
      const chunks = chunksRef.current.slice();
      const usedMime = recorder.mimeType || mimeType;
      const elapsedMs = Math.max(0, Date.now() - startTsRef.current);
      const wasCancelled = cancelledRef.current;

      teardown();
      setState('idle');

      if (wasCancelled) return;
      if (chunks.length === 0) {
        onErrorRef.current?.('recorder_failed', 'no chunks captured');
        return;
      }
      const blob = new Blob(chunks, { type: usedMime });
      onCompleteRef.current?.({
        blob,
        mimeType: usedMime,
        durationSec: elapsedMs / 1000,
      });
    };

    recorder.onerror = (ev) => {
      onErrorRef.current?.('recorder_failed', String((ev as ErrorEvent).message ?? 'unknown'));
      teardown();
      setState('error');
    };

    startTsRef.current = Date.now();
    setElapsedSec(0);
    recorder.start();
    setState('recording');

    elapsedTimerRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - startTsRef.current) / 1000);
      setElapsedSec(sec);
    }, 200);

    maxTimerRef.current = setTimeout(() => {
      // Hit the cap — stop normally so onComplete still fires.
      if (recorderRef.current?.state === 'recording') {
        setState('stopping');
        recorderRef.current.stop();
      }
    }, maxDurationSec * 1000);
  }, [state, maxDurationSec, teardown]);

  // ─── stop / cancel ──────────────────────────────────────────────

  const stop = useCallback(() => {
    if (state === 'recording') {
      cancelledRef.current = false;
      if (recorderRef.current?.state === 'recording') {
        setState('stopping');
        recorderRef.current.stop();
      }
      return;
    }
    if (state === 'requesting') {
      // Recording hasn't actually started yet (still awaiting
      // getUserMedia). Treat stop-during-requesting as cancel: there's
      // no audio to send. The mic-permission resolution in `start`
      // will see cancelledRef.current and bail without arming a
      // recorder. Same effect as cancel(), kept on stop() so callers
      // don't have to know which phase the hook is internally in.
      cancelledRef.current = true;
      return;
    }
  }, [state]);

  const cancel = useCallback(() => {
    if (state === 'recording') {
      cancelledRef.current = true;
      if (recorderRef.current?.state === 'recording') {
        // Trigger onstop, which will see cancelledRef and skip onComplete.
        recorderRef.current.stop();
      } else {
        teardown();
        setState('idle');
      }
      return;
    }
    if (state === 'requesting') {
      // Same as stop()-during-requesting — let the start() continuation
      // observe cancelledRef and clean up itself. Don't tear down here
      // because streamRef.current is still null.
      cancelledRef.current = true;
      return;
    }
    // 'idle' / 'stopping' / 'error' — nothing to cancel; reset display.
    teardown();
    setState('idle');
  }, [state, teardown]);

  return { state, elapsedSec, start, stop, cancel };
}
