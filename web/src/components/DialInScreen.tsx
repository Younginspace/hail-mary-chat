import { useState, useEffect, useRef, FormEvent } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { checkCallsign } from '../utils/sessionApi';

type Mode = 'signUp' | 'signIn';
type CallsignStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const CALLSIGN_RE = /^[\p{L}\p{N} _\-]{3,32}$/u;

interface DialInScreenProps {
  onBack: () => void;
  onSuccess: () => void;
}

export default function DialInScreen({ onBack, onSuccess }: DialInScreenProps) {
  const { lang } = useLang();
  const { signInEmail, signUpEmail } = useAuthSession();
  const [mode, setMode] = useState<Mode>('signUp');
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [callsignStatus, setCallsignStatus] = useState<CallsignStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== 'signUp') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = callsign.trim();
    if (!trimmed) {
      setCallsignStatus('idle');
      return;
    }
    if (!CALLSIGN_RE.test(trimmed)) {
      setCallsignStatus('invalid');
      return;
    }
    setCallsignStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const res = await checkCallsign(trimmed);
      if (!res) return;
      if (res.reason === 'invalid_format') setCallsignStatus('invalid');
      else setCallsignStatus(res.available ? 'available' : 'taken');
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [callsign, mode]);

  const canSubmit =
    mode === 'signIn'
      ? email.trim().length > 0 && password.length >= 8
      : email.trim().length > 0 &&
        password.length >= 8 &&
        callsignStatus === 'available';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result =
      mode === 'signIn'
        ? await signInEmail(email.trim(), password)
        : await signUpEmail(email.trim(), password, callsign.trim());
    setSubmitting(false);
    if (result?.error) {
      const msg = (result.error.message || '').toLowerCase();
      if (msg.includes('callsign_taken')) {
        setCallsignStatus('taken');
        setError(t('dialin.callsignTaken', lang));
      } else {
        setError(result.error.message || t('login.errorGeneric', lang));
      }
      return;
    }
    onSuccess();
  };

  const statusHint: Record<CallsignStatus, string> = {
    idle: '',
    checking: t('dialin.callsignChecking', lang),
    available: t('dialin.callsignAvailable', lang),
    taken: t('dialin.callsignTaken', lang),
    invalid: t('dialin.callsignInvalid', lang),
  };

  return (
    <div className="dialin-panel">
      <button type="button" className="dialin-back" onClick={onBack} disabled={submitting}>
        {t('dialin.back', lang)}
      </button>

      <div className="dialin-title">{t('dialin.title', lang)}</div>

      <div className="dialin-tabs">
        <button
          type="button"
          className={`dialin-tab ${mode === 'signUp' ? 'active' : ''}`}
          onClick={() => {
            setMode('signUp');
            setError(null);
          }}
        >
          {t('login.modeSignUp', lang)}
        </button>
        <button
          type="button"
          className={`dialin-tab ${mode === 'signIn' ? 'active' : ''}`}
          onClick={() => {
            setMode('signIn');
            setError(null);
          }}
        >
          {t('login.modeSignIn', lang)}
        </button>
      </div>

      <div className="dialin-mode-hint">
        {mode === 'signUp' ? t('dialin.signupHint', lang) : t('dialin.signinHint', lang)}
      </div>

      <form className="dialin-form" onSubmit={handleSubmit}>
        {mode === 'signUp' && (
          <label className="dialin-label">
            <span>{t('login.displayNameLabel', lang)}</span>
            <input
              type="text"
              required
              maxLength={32}
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              placeholder={t('dialin.callsignPlaceholder', lang)}
              autoComplete="nickname"
              autoFocus
            />
            {callsignStatus !== 'idle' && (
              <span className={`dialin-callsign-status status-${callsignStatus}`}>
                {statusHint[callsignStatus]}
              </span>
            )}
          </label>
        )}

        <label className="dialin-label">
          <span>{t('login.callsignLabel', lang)}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@hailmary.space"
          />
        </label>

        <label className="dialin-label">
          <span>{t('login.passwordLabel', lang)}</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="dialin-error">{error}</div>}

        <button type="submit" className="dialin-submit" disabled={submitting || !canSubmit}>
          {submitting
            ? '...'
            : mode === 'signIn'
              ? t('login.submitSignIn', lang)
              : t('login.submitSignUp', lang)}
        </button>
      </form>
    </div>
  );
}
