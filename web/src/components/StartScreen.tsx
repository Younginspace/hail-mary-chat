import { useState, useEffect, useCallback } from 'react';
import Starfield from './Starfield';
import MemoryConstellation from './MemoryConstellation';
import SignalStreaks from './SignalStreaks';
import LangSwitcher from './LangSwitcher';
import LoginModal from './LoginModal';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { unlockAudio } from '../utils/rockyAudio';
import { isTtsQuotaExceeded, setTtsQuotaExceeded, isChatQuotaExceeded, setChatQuotaExceeded, formatResetTime, clearAllQuotaFlags } from '../utils/playLimit';
import { fetchQuota, startSession } from '../utils/sessionApi';
import type { ChatMode } from '../utils/playLimit';

// EdgeSpark proxy base URL — the worker owns MINIMAX_API_KEY server-side.
const API_BASE = import.meta.env.VITE_API_URL || '';

type Phase = 'idle' | 'connecting' | 'connected';

const CONNECTION_STEPS = [
  { text: 'INITIALIZING ERID-LINK v2.1 ...', delay: 0 },
  { text: 'SCANNING FREQUENCY BAND 7.4 GHz ...', delay: 800 },
  { text: 'SIGNAL DETECTED — ASTROPHAGE RELAY NODE #4217', delay: 1800 },
  { text: 'DECRYPTING ERIDIAN HANDSHAKE PROTOCOL ...', delay: 2800 },
  { text: 'LATENCY CALIBRATED: 4.2 LIGHT-YEARS', delay: 3600 },
  { text: 'TRANSLATION MODULE ONLINE', delay: 4200 },
  { text: '■ CONNECTION ESTABLISHED ■', delay: 5000 },
];

interface StartScreenProps {
  onConnected: (mode: ChatMode, sessionId: string) => void;
}

export default function StartScreen({ onConnected }: StartScreenProps) {
  const { lang } = useLang();
  const { isAuthenticated, me, session, signOut } = useAuthSession();
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('text');
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [ttsDisabled, setTtsDisabled] = useState(isTtsQuotaExceeded());
  const [chatDisabled, setChatDisabled] = useState(isChatQuotaExceeded());
  const [resetTime, setResetTime] = useState(formatResetTime());
  const [loginOpen, setLoginOpen] = useState(false);

  // ── Daily-quota state (from EdgeSpark) ──
  // -1 means "unlimited" (authed). null is pre-fetch unknown.
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [startError, setStartError] = useState<'quota' | 'server' | null>(null);

  const dailyDepleted = !unlimited && dailyRemaining === 0;

  const textBtnDisabled = chatDisabled || dailyDepleted;
  const voiceBtnDisabled = ttsDisabled || dailyDepleted;

  // ── On mount & when auth state changes: fetch backend quota ──
  // Quota endpoint returns {unlimited: true, remaining: -1} for adopted users.
  // When the user just logged in, also clear the localStorage TTS/chat
  // "quota exceeded" flags — otherwise the mode buttons stay disabled even
  // though the backend has granted unlimited access.
  useEffect(() => {
    if (isAuthenticated) {
      clearAllQuotaFlags();
      setTtsDisabled(false);
      setChatDisabled(false);
    }
    fetchQuota().then((q) => {
      if (!q) return;
      if ((q as { unlimited?: boolean }).unlimited) {
        setUnlimited(true);
        setDailyRemaining(null);
      } else {
        setUnlimited(false);
        setDailyRemaining(q.remaining);
      }
    });
  }, [isAuthenticated]);

  // 探测 TTS 额度（GET /api/public/tts?text=.）
  useEffect(() => {
    if (ttsDisabled || localStorage.getItem('rocky_skip_tts_probe')) return;
    fetch(`${API_BASE}/api/public/tts?text=.`, { method: 'GET' })
      .then(res => { if (res.status === 429) { setTtsQuotaExceeded(); setTtsDisabled(true); } })
      .catch(() => {});
  }, [ttsDisabled]);

  // 探测 Chat 额度（POST /api/public/chat，单 token）
  useEffect(() => {
    if (chatDisabled) return;
    fetch(`${API_BASE}/api/public/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
    })
      .then(res => { if (res.status === 429) { setChatQuotaExceeded(); setChatDisabled(true); } })
      .catch(() => {});
  }, [chatDisabled]);

  // 每分钟刷新倒计时
  useEffect(() => {
    if (!ttsDisabled && !chatDisabled && !dailyDepleted) return;
    const timer = setInterval(() => setResetTime(formatResetTime()), 60000);
    return () => clearInterval(timer);
  }, [ttsDisabled, chatDisabled, dailyDepleted]);

  // ── Click handler: start session on backend, then play connect animation ──
  const handleCall = useCallback(async (mode: ChatMode) => {
    unlockAudio();
    setStartError(null);
    const result = await startSession(lang, mode);
    if (!result.ok) {
      if (result.reason === 'quota_exceeded') {
        setDailyRemaining(0);
        setStartError('quota');
      } else {
        setStartError('server');
      }
      return;
    }
    setPendingSessionId(result.session_id);
    setDailyRemaining(result.remaining);
    if ((result as { unlimited?: boolean }).unlimited) setUnlimited(true);
    setSelectedMode(mode);
    setPhase('connecting');
  }, [lang]);

  // Connection steps animation
  useEffect(() => {
    if (phase !== 'connecting') return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    CONNECTION_STEPS.forEach((step, i) => {
      timers.push(
        setTimeout(() => setVisibleSteps(i + 1), step.delay)
      );
    });

    timers.push(
      setTimeout(() => {
        setPhase('connected');
      }, 5600)
    );

    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // Once connected, wait a beat then transition to chat
  useEffect(() => {
    if (phase !== 'connected') return;
    if (!pendingSessionId) return;
    const timer = setTimeout(() => onConnected(selectedMode, pendingSessionId), 600);
    return () => clearTimeout(timer);
  }, [phase, onConnected, selectedMode, pendingSessionId]);

  const dailyDepletedCopy = {
    zh: '今日 20 次通话已用完。登记呼号即可无限通讯，或明日 00:00 再来。',
    en: 'Daily 20 calls used up. Register a callsign for unlimited comm, or come back at 00:00.',
    ja: '本日の通話20回を使い切りました。コールサイン登録で無制限、または00:00にまた。',
  }[lang];

  return (
    <div className="immersive-root">
      <Starfield />
      <MemoryConstellation />
      <SignalStreaks />

      <div className="start-overlay">
        <div className="start-lang-corner">
          <LangSwitcher />
        </div>

        {phase === 'idle' && (
          <div className="start-content">
            <div className="version-badge">
              <span className="version-badge-dot" />
              <span className="version-badge-label">{t('version.badge', lang)}</span>
            </div>

            <div className="start-title-group">
              <div className="start-subtitle">{t('start.subtitle', lang)}</div>
              <h1 className="start-title">
                <span className="title-line">{t('start.callLabel', lang)}</span>
                <span className="title-name">ROCKY</span>
              </h1>
              <div className="start-desc">
                {t('start.desc', lang)}
              </div>
              <div className="version-tagline">{t('version.tagline', lang)}</div>
            </div>

            {dailyDepleted && (
              <div className="daily-depleted-bar">
                {dailyDepletedCopy}
                {!isAuthenticated && (
                  <>
                    {'  '}
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#ffaa44', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
                      onClick={() => setLoginOpen(true)}
                    >
                      {t('login.modeSignUp', lang)}
                    </button>
                  </>
                )}
              </div>
            )}
            {startError === 'server' && (
              <div className="daily-depleted-bar">
                {{
                  zh: '通讯系统繁忙，请稍后再试',
                  en: 'Comm system busy, please try again',
                  ja: '通信システム混雑中、しばらくしてから再試行',
                }[lang]}
              </div>
            )}

            <div className="start-mode-buttons">
              {/* 文字通话 */}
              <button
                className={`mode-btn ${textBtnDisabled ? 'mode-btn-disabled' : ''}`}
                onClick={() => { if (!textBtnDisabled) handleCall('text'); }}
                disabled={textBtnDisabled}
              >
                <div className="mode-btn-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="mode-btn-body">
                  <span className="mode-btn-label">{t('start.textBtn', lang)}</span>
                  <span className={`mode-btn-hint ${textBtnDisabled ? 'mode-btn-hint-warn' : ''}`}>
                    {chatDisabled
                      ? t('start.textDisabled', lang)
                      : t('start.textHint', lang)}
                  </span>
                </div>
              </button>

              {/* 语音通话 */}
              <button
                className={`mode-btn ${voiceBtnDisabled ? 'mode-btn-disabled' : ''}`}
                onClick={() => { if (!voiceBtnDisabled) handleCall('voice'); }}
                disabled={voiceBtnDisabled}
              >
                <div className="mode-btn-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <div className="mode-btn-body">
                  <span className="mode-btn-label">{t('start.voiceBtn', lang)}</span>
                  <span className={`mode-btn-hint ${voiceBtnDisabled ? 'mode-btn-hint-warn' : ''}`}>
                    {ttsDisabled
                      ? t('start.voiceDisabled', lang, { time: resetTime })
                      : t('start.voiceHint', lang)}
                  </span>
                </div>
              </button>
            </div>

            {isAuthenticated ? (
              <div className="login-welcome-banner">
                <span className="welcome-dot" />
                <span>
                  {t('login.welcome', lang, {
                    callsign:
                      me?.callsign ??
                      (session?.user?.name as string | undefined) ??
                      (session?.user?.email ?? '').split('@')[0] ??
                      'friend',
                  })}
                </span>
                <button
                  type="button"
                  className="welcome-logout"
                  onClick={() => signOut()}
                >
                  {t('login.signOut', lang)}
                </button>
              </div>
            ) : dailyRemaining !== null && !dailyDepleted ? (
              <div className="daily-remaining-hint">
                {{
                  zh: `今日剩余 ${dailyRemaining} 次通话`,
                  en: `${dailyRemaining} calls left today`,
                  ja: `本日残り ${dailyRemaining} 回`,
                }[lang]}
                <button
                  type="button"
                  style={{ marginLeft: 10, background: 'none', border: 'none', color: '#00d4aa', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
                  onClick={() => setLoginOpen(true)}
                >
                  {t('login.modeSignUp', lang)}
                </button>
              </div>
            ) : null}
          </div>
        )}

        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />

        {(phase === 'connecting' || phase === 'connected') && (
          <div className="connecting-content">
            <div className="connecting-header">
              {t('start.connectingHeader', lang)}
            </div>
            <div className="connecting-log">
              {CONNECTION_STEPS.slice(0, visibleSteps).map((step, i) => (
                <div
                  key={i}
                  className={`log-line ${i === CONNECTION_STEPS.length - 1 && visibleSteps === CONNECTION_STEPS.length ? 'log-success' : ''}`}
                >
                  <span className="log-prefix">{i === CONNECTION_STEPS.length - 1 && visibleSteps === CONNECTION_STEPS.length ? '✓' : '›'}</span>
                  {step.text}
                </div>
              ))}
              {visibleSteps < CONNECTION_STEPS.length && (
                <div className="log-cursor">_</div>
              )}
            </div>
            {phase === 'connected' && (
              <div className="connected-flash">
                {t('start.connectedFlash', lang)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
