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
  // Two-step mount so CSS transitions play in BOTH directions.
  // `mounted` = in the DOM; `visible` = .is-visible class present.
  // Open: mount → next frame toggles visible → CSS tween runs.
  // Close: drop visible → CSS tween runs → 240ms later unmount.
  // 240ms matches the 220ms modal transform transition + a small margin.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);

  // Reset phase when modal re-opens so a returning user sees the form.
  useEffect(() => {
    if (open) {
      setPhase('form');
      setError(null);
      setPassword('');
    }
  }, [open]);

  // Keyboard: Esc closes the modal from the form phase (during success
  // the auto-close handles it). Scoped to `open` so we don't trap the
  // global Esc handler when the modal isn't up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'form') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, onClose]);

  // Auto-close success after a few seconds as a safety net, even if the
  // user forgets to click CONTINUE. `open` is in deps so that manually
  // closing (parent sets open=false) fires the cleanup and cancels the
  // pending timer — otherwise a late fire would onClose() on whatever
  // modal instance was up next.
  useEffect(() => {
    if (!open || phase !== 'success') return;
    const timer = setTimeout(() => {
      onClose();
    }, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, phase, onClose]);

  if (!mounted) return null;

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
    <div
      className={`login-backdrop${visible ? ' is-visible' : ''}`}
      onClick={phase === 'form' ? onClose : undefined}
    >
      <div
        className={`login-modal${visible ? ' is-visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'form' ? (
          <>
            <div className="login-header">
              <div className="login-title" id="login-title">{t('login.hookTitle', lang)}</div>
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
            <div className="login-success-badge" id="login-title">{t('login.successTitle', lang)}</div>
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
