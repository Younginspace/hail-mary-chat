import { useState, useEffect, useCallback } from 'react';
import Starfield from './Starfield';
import LangSwitcher from './LangSwitcher';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { unlockAudio } from '../utils/rockyAudio';
import { isTtsQuotaExceeded, setTtsQuotaExceeded, isChatQuotaExceeded, setChatQuotaExceeded, formatResetTime } from '../utils/playLimit';
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('text');
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [ttsDisabled, setTtsDisabled] = useState(isTtsQuotaExceeded());
  const [chatDisabled, setChatDisabled] = useState(isChatQuotaExceeded());
  const [resetTime, setResetTime] = useState(formatResetTime());

  // ── Daily-quota state (from EdgeSpark) ──
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null); // null = unknown
  const [startError, setStartError] = useState<'quota' | 'server' | null>(null);

  const dailyDepleted = dailyRemaining === 0;

  const textBtnDisabled = chatDisabled || dailyDepleted;
  const voiceBtnDisabled = ttsDisabled || dailyDepleted;

  // ── On mount: fetch backend quota ──
  useEffect(() => {
    fetchQuota().then((q) => {
      if (q) setDailyRemaining(q.remaining);
    });
  }, []);

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
    zh: '今日通话 20 次已用完，明日 00:00 再来（未来接入登录后可无限）',
    en: 'Daily 20 calls used up, come back tomorrow 00:00 (login for unlimited — coming soon)',
    ja: '本日の通話20回を使い切りました、明日00:00にまた（ログイン機能で無制限化予定）',
  }[lang];

  return (
    <div className="immersive-root">
      <Starfield />

      <div className="start-overlay">
        <div className="start-lang-corner">
          <LangSwitcher />
        </div>

        {phase === 'idle' && (
          <div className="start-content">
            <div className="start-title-group">
              <div className="start-subtitle">{t('start.subtitle', lang)}</div>
              <h1 className="start-title">
                <span className="title-line">{t('start.callLabel', lang)}</span>
                <span className="title-name">ROCKY</span>
              </h1>
              <div className="start-desc">
                {t('start.desc', lang)}
              </div>
            </div>

            {dailyDepleted && (
              <div className="daily-depleted-bar">
                {dailyDepletedCopy}
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

            {dailyRemaining !== null && !dailyDepleted && (
              <div className="daily-remaining-hint">
                {{
                  zh: `今日剩余 ${dailyRemaining} 次通话`,
                  en: `${dailyRemaining} calls left today`,
                  ja: `本日残り ${dailyRemaining} 回`,
                }[lang]}
              </div>
            )}
          </div>
        )}

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
