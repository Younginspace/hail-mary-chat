import { useState, useEffect, useCallback } from 'react';
import Starfield from './Starfield';
import LangSwitcher from './LangSwitcher';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { unlockAudio } from '../utils/rockyAudio';
import { isTtsQuotaExceeded, setTtsQuotaExceeded, isChatQuotaExceeded, setChatQuotaExceeded, formatResetTime, getRemainingPlays, markShared, getShareUrl } from '../utils/playLimit';
import ShareModal from './ShareModal';
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
  onConnected: (mode: ChatMode) => void;
}

export default function StartScreen({ onConnected }: StartScreenProps) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('text');
  const [ttsDisabled, setTtsDisabled] = useState(isTtsQuotaExceeded());
  const [chatDisabled, setChatDisabled] = useState(isChatQuotaExceeded());
  const [resetTime, setResetTime] = useState(formatResetTime());
  const textDailyUsed = getRemainingPlays('text') <= 0;
  const voiceDailyUsed = getRemainingPlays('voice') <= 0;
  const textBtnDisabled = chatDisabled; // API 不可用才真正禁用；次数用完可通过分享获取
  const voiceBtnDisabled = ttsDisabled || voiceDailyUsed;
  const [textShared, setTextShared] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareMode, setShareMode] = useState<ChatMode>('text');

  const handleOpenShare = useCallback(async (mode: ChatMode) => {
    setShareMode(mode);
    // 手机：优先触发系统原生分享面板（微信/小红书等）
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('share.title', lang),
          text: t('share.text', lang),
          url: getShareUrl(),
        });
        markShared(mode);
        if (mode === 'text') setTextShared(true);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    // 桌面 fallback：显示二维码弹窗
    setShowShareModal(true);
  }, [lang]);

  const handleShareDone = useCallback(() => {
    markShared(shareMode);
    if (shareMode === 'text') setTextShared(true);
    setShowShareModal(false);
  }, [shareMode]);

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
    if (!ttsDisabled && !chatDisabled) return;
    const timer = setInterval(() => setResetTime(formatResetTime()), 60000);
    return () => clearInterval(timer);
  }, [ttsDisabled, chatDisabled]);

  const handleCall = useCallback((mode: ChatMode) => {
    unlockAudio();
    setSelectedMode(mode);
    setPhase('connecting');
  }, []);

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
    const timer = setTimeout(() => onConnected(selectedMode), 600);
    return () => clearTimeout(timer);
  }, [phase, onConnected, selectedMode]);

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

            <div className="start-mode-buttons">
              {/* 文字通话 */}
              <button
                className={`mode-btn ${textBtnDisabled ? 'mode-btn-disabled' : textDailyUsed && !textShared ? 'mode-btn-share' : ''}`}
                onClick={() => {
                  if (textBtnDisabled) return;
                  if (textDailyUsed && !textShared) { handleOpenShare('text'); return; }
                  handleCall('text');
                }}
                disabled={textBtnDisabled}
              >
                <div className="mode-btn-icon">
                  {textDailyUsed && !textShared && !textBtnDisabled ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  )}
                </div>
                <div className="mode-btn-body">
                  <span className="mode-btn-label">{t('start.textBtn', lang)}</span>
                  <span className={`mode-btn-hint ${(textBtnDisabled || (textDailyUsed && !textShared)) ? 'mode-btn-hint-warn' : ''}`}>
                    {chatDisabled
                      ? t('start.textDisabled', lang)
                      : textDailyUsed && !textShared
                        ? t('start.textDailyUsed', lang)
                        : t('start.textHint', lang)}
                  </span>
                </div>
              </button>

              {/* 语音通话 */}
              <button
                className={`mode-btn ${voiceBtnDisabled ? 'mode-btn-disabled' : ''}`}
                onClick={() => !voiceBtnDisabled && handleCall('voice')}
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
                      : voiceDailyUsed
                        ? t('start.voiceDailyUsed', lang)
                        : t('start.voiceHint', lang)}
                  </span>
                </div>
              </button>
            </div>
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

      {showShareModal && (
        <ShareModal
          url={getShareUrl()}
          onShared={handleShareDone}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
