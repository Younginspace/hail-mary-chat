// P4 login modal. Narrative: email = 呼号 (callsign), password = 通讯口令
// (comm passphrase). Email verification is off — login happens inline.
//
// After a successful sign-in or sign-up the modal does NOT close immediately.
// It shows a success state with the callsign so the user gets real feedback
// before being sent back to the home screen. The user dismisses with a
// button, or an auto-close kicks in after a few seconds as a safety net.

import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Mode = 'signIn' | 'signUp';
type Phase = 'form' | 'success';

const AUTO_CLOSE_MS = 3000;

export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const { lang } = useLang();
  const { signInEmail, signUpEmail, me, session } = useAuthSession();
  const [mode, setMode] = useState<Mode>('signUp');
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset phase when modal re-opens so a returning user sees the form.
  useEffect(() => {
    if (open) {
      setPhase('form');
      setError(null);
      setPassword('');
    }
  }, [open]);

  // Auto-close success after a few seconds as a safety net, even if the
  // user forgets to click CONTINUE.
  useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(() => {
      onClose();
    }, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result =
      mode === 'signIn'
        ? await signInEmail(email.trim(), password)
        : await signUpEmail(email.trim(), password, displayName.trim() || undefined);

    setSubmitting(false);

    if (result?.error) {
      setError(result.error.message || t('login.errorGeneric', lang));
      return;
    }
    onSuccess?.();
    setPhase('success');
  };

  // Fallback callsign: prefer adopted `me.callsign`, then the form's display
  // name, then the email local-part. Avoids showing blank during the brief
  // window where /api/me hasn't resolved.
  const liveCallsign =
    me?.callsign ||
    displayName.trim() ||
    (session?.user?.name as string | undefined) ||
    (session?.user?.email ?? email).split('@')[0] ||
    'friend';

  return (
    <div className="login-backdrop" onClick={phase === 'form' ? onClose : undefined}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        {phase === 'form' ? (
          <>
            <div className="login-header">
              <div className="login-title">{t('login.hookTitle', lang)}</div>
              <div className="login-desc">{t('login.hookDesc', lang)}</div>
            </div>

            <div className="login-tabs">
              <button
                type="button"
                className={`login-tab ${mode === 'signUp' ? 'active' : ''}`}
                onClick={() => { setMode('signUp'); setError(null); }}
              >
                {t('login.modeSignUp', lang)}
              </button>
              <button
                type="button"
                className={`login-tab ${mode === 'signIn' ? 'active' : ''}`}
                onClick={() => { setMode('signIn'); setError(null); }}
              >
                {t('login.modeSignIn', lang)}
              </button>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-label">
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

              <label className="login-label">
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

              {mode === 'signUp' && (
                <label className="login-label">
                  <span>{t('login.displayNameLabel', lang)}</span>
                  <input
                    type="text"
                    maxLength={64}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ryland"
                  />
                </label>
              )}

              {error && <div className="login-error">{error}</div>}

              <div className="login-actions">
                <button
                  type="button"
                  className="login-later"
                  onClick={onClose}
                  disabled={submitting}
                >
                  {t('login.later', lang)}
                </button>
                <button type="submit" className="login-submit" disabled={submitting}>
                  {mode === 'signIn'
                    ? t('login.submitSignIn', lang)
                    : t('login.submitSignUp', lang)}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="login-success">
            <div className="login-success-badge">{t('login.successTitle', lang)}</div>
            <div className="login-success-desc">
              {t('login.successDesc', lang, { callsign: liveCallsign })}
            </div>
            <button
              type="button"
              className="login-submit"
              onClick={onClose}
              style={{ marginTop: 18, width: '100%' }}
            >
              {t('login.successContinue', lang)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
