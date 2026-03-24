import { useState, useEffect, useCallback } from 'react';
import Starfield from './Starfield';
import LangSwitcher from './LangSwitcher';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

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
  onConnected: () => void;
}

export default function StartScreen({ onConnected }: StartScreenProps) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);

  const handleCall = useCallback(() => {
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
    const timer = setTimeout(() => onConnected(), 600);
    return () => clearTimeout(timer);
  }, [phase, onConnected]);

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

            <button className="call-btn" onClick={handleCall}>
              <div className="call-btn-ring" />
              <div className="call-btn-ring call-btn-ring-2" />
              <div className="call-btn-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <span className="call-btn-text">{t('start.callBtn', lang)}</span>
            </button>

            <div className="start-footer">
              <span>{t('start.footer', lang)}</span>
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
    </div>
  );
}
