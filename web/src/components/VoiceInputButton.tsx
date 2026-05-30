// #07 Voice input button. Press-and-hold to record; release to send;
// drag up while pressed to cancel. Mirrors the gesture vocabulary
// users already know from 微信 / WhatsApp voice messages.
//
// On stop, the audio blob is sent through transcribeAudio (asr.ts).
// The transcript is then handed to the parent via onTranscript —
// we deliberately do NOT auto-send: the parent fills the chat input
// box so the user can edit before pressing Send.

import { useCallback, useRef, useState } from 'react';
import { useVoiceInput, type VoiceInputErrorCode } from '../hooks/useVoiceInput';
import { transcribeAudio, type ASRError } from '../utils/asr';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface Props {
  /** Called with the (raw, unedited) transcript on success. */
  onTranscript: (text: string) => void;
  /** Disable the button (e.g. while a chat reply is streaming). */
  disabled?: boolean;
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'error';

const CANCEL_DRAG_THRESHOLD_PX = 60;

export default function VoiceInputButton({ onTranscript, disabled = false }: Props) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Used to render "drag up to cancel" UI. Tracked from pointermove.
  const [willCancel, setWillCancel] = useState(false);
  const pointerStartYRef = useRef<number | null>(null);

  const handleError = useCallback((code: VoiceInputErrorCode | ASRError, detail?: string) => {
    const map: Record<string, string> = {
      permission_denied: t('voiceinput.error.permission', lang),
      unsupported_browser: t('voiceinput.error.unsupported', lang),
      no_microphone: t('voiceinput.error.noMic', lang),
      audio_too_large: t('voiceinput.error.tooLong', lang),
      unsupported_audio_format: t('voiceinput.error.format', lang),
      asr_submit_failed: t('voiceinput.error.network', lang),
      asr_failed: t('voiceinput.error.failed', lang),
      asr_empty_transcript: t('voiceinput.error.empty', lang),
      asr_timeout: t('voiceinput.error.timeout', lang),
      network: t('voiceinput.error.network', lang),
    };
    setErrorMsg(map[code] ?? t('voiceinput.error.generic', lang));
    setPhase('error');
    if (detail) console.warn(`[voice-input] ${code}: ${detail}`);
    // Auto-clear after 3s so the button doesn't stay frozen on error.
    setTimeout(() => {
      setPhase('idle');
      setErrorMsg(null);
    }, 3000);
  }, [lang]);

  const voice = useVoiceInput({
    maxDurationSec: 60,
    onComplete: async ({ blob, mimeType }) => {
      setPhase('transcribing');
      const result = await transcribeAudio(blob, mimeType, lang);
      if (result.ok) {
        onTranscript(result.transcript);
        setPhase('idle');
      } else {
        handleError(result.error, result.detail);
      }
    },
    onError: handleError,
  });

  const onPointerDown = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || phase !== 'idle') return;
    ev.preventDefault();
    // Capture so subsequent move/up events keep targeting this button
    // even if the finger drags off it.
    (ev.target as HTMLButtonElement).setPointerCapture?.(ev.pointerId);
    pointerStartYRef.current = ev.clientY;
    setWillCancel(false);
    setPhase('recording');
    void voice.start();
  }, [disabled, phase, voice]);

  const onPointerMove = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    if (phase !== 'recording' || pointerStartYRef.current == null) return;
    const dy = pointerStartYRef.current - ev.clientY;
    setWillCancel(dy > CANCEL_DRAG_THRESHOLD_PX);
  }, [phase]);

  const onPointerUp = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    if (phase !== 'recording') return;
    (ev.target as HTMLButtonElement).releasePointerCapture?.(ev.pointerId);
    if (willCancel) {
      voice.cancel();
      setPhase('idle');
    } else {
      voice.stop();
      // Phase remains 'recording' until onComplete fires (then we set
      // 'transcribing'). If state lingers visually it's because the
      // recorder is finalizing — typically <100ms.
    }
    pointerStartYRef.current = null;
    setWillCancel(false);
  }, [phase, willCancel, voice]);

  const onPointerCancel = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    if (phase !== 'recording') return;
    (ev.target as HTMLButtonElement).releasePointerCapture?.(ev.pointerId);
    voice.cancel();
    setPhase('idle');
    pointerStartYRef.current = null;
    setWillCancel(false);
  }, [phase, voice]);

  const recording = phase === 'recording';
  const transcribing = phase === 'transcribing';
  const hasError = phase === 'error';

  return (
    <div className="voice-input-wrap">
      {/* Live indicator overlay — only when recording or transcribing. */}
      {(recording || transcribing) && (
        <div
          className={`voice-input-overlay ${willCancel ? 'voice-input-overlay--cancel' : ''}`}
          aria-live="polite"
        >
          {recording && (
            <>
              <span className="voice-input-dot" aria-hidden="true" />
              <span className="voice-input-timer">
                {String(Math.floor(voice.elapsedSec / 60)).padStart(1, '0')}:
                {String(voice.elapsedSec % 60).padStart(2, '0')}
              </span>
              <span className="voice-input-hint">
                {willCancel ? t('voiceinput.releaseToCancel', lang) : t('voiceinput.dragToCancel', lang)}
              </span>
            </>
          )}
          {transcribing && (
            <span className="voice-input-hint">{t('voiceinput.transcribing', lang)}</span>
          )}
        </div>
      )}
      {hasError && errorMsg && (
        <div className="voice-input-error" role="alert">{errorMsg}</div>
      )}
      <button
        type="button"
        className={`voice-input-btn ${recording ? 'is-recording' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        disabled={disabled || transcribing}
        aria-label={recording ? t('voiceinput.recording', lang) : t('voiceinput.holdToTalk', lang)}
        title={t('voiceinput.holdToTalk', lang)}
      >
        <span aria-hidden="true">🎤</span>
      </button>
    </div>
  );
}
