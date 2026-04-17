import { useState, useEffect, useCallback, useRef } from 'react';
import { gsap } from 'gsap';
import Starfield from './Starfield';
import MemoryConstellation from './MemoryConstellation';
import SignalStreaks from './SignalStreaks';
import LangSwitcher from './LangSwitcher';
import OpenChannel from './OpenChannel';
import DialInScreen from './DialInScreen';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { unlockAudio } from '../utils/rockyAudio';
import { startSession } from '../utils/sessionApi';
import type { ChatMode } from '../utils/playLimit';

// P5 F1: StartScreen has four phases:
//   - 'channel'    Open Channel FAQ view (passive, public)
//   - 'dialin'     Register / sign-in form (private channel)
//   - 'connecting' Handshake animation
//   - 'connected'  Brief flash before onConnected fires
//
// Forced registration: anonymous users cannot skip to chat. Already-authed
// users see the Open Channel with a "Reconnect" button that starts a session
// without re-entering credentials.

type Phase = 'channel' | 'dialin' | 'connecting' | 'connected';

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
  const { isAuthenticated, me, signOut } = useAuthSession();
  const [phase, setPhase] = useState<Phase>('channel');
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const channelRef = useRef<HTMLDivElement>(null);
  const dialinRef = useRef<HTMLDivElement>(null);
  const connectingRef = useRef<HTMLDivElement>(null);

  // Fade/slide between channel ↔ dialin with GSAP.
  useEffect(() => {
    if (phase === 'channel' && channelRef.current) {
      gsap.fromTo(
        channelRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
      );
    }
    if (phase === 'dialin' && dialinRef.current) {
      gsap.fromTo(
        dialinRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
      );
    }
    if (phase === 'connecting' && connectingRef.current) {
      gsap.fromTo(
        connectingRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: 'power2.inOut' }
      );
    }
  }, [phase]);

  // Begin handshake animation + start a server session.
  const beginConnection = useCallback(async () => {
    unlockAudio();
    setStartError(null);
    const result = await startSession(lang, 'text');
    if (!result.ok) {
      setStartError(
        result.reason === 'not_authenticated'
          ? t('login.errorGeneric', lang)
          : t('login.errorGeneric', lang)
      );
      return;
    }
    setPendingSessionId(result.session_id);
    setPhase('connecting');
  }, [lang]);

  // Auto-advance handshake steps
  useEffect(() => {
    if (phase !== 'connecting') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    CONNECTION_STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => setVisibleSteps(i + 1), step.delay));
    });
    timers.push(setTimeout(() => setPhase('connected'), 5600));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // Once connected, animate out and hand over to parent
  useEffect(() => {
    if (phase !== 'connected' || !pendingSessionId) return;
    const timer = setTimeout(() => {
      if (connectingRef.current) {
        gsap.to(connectingRef.current, {
          opacity: 0,
          duration: 0.4,
          ease: 'power2.in',
          onComplete: () => onConnected('text', pendingSessionId),
        });
      } else {
        onConnected('text', pendingSessionId);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [phase, pendingSessionId, onConnected]);

  return (
    <div className="immersive-root">
      <Starfield />
      <MemoryConstellation />
      <SignalStreaks />

      <div className="start-overlay">
        <div className="start-lang-corner">
          <LangSwitcher />
        </div>

        {phase === 'channel' && (
          <div ref={channelRef} className="channel-panel">
            <div className="version-badge">
              <span className="version-badge-dot" />
              <span className="version-badge-label">{t('version.badge', lang)}</span>
            </div>

            <div className="channel-header">
              <div className="channel-eyebrow">{t('start.subtitle', lang)}</div>
              <h1 className="channel-title">{t('channel.title', lang)}</h1>
              <div className="channel-desc">{t('channel.desc', lang)}</div>
            </div>

            <OpenChannel />

            <div className="channel-dialin">
              <div className="channel-dialin-hint">
                {isAuthenticated && me?.callsign
                  ? t('login.welcome', lang, { callsign: me.callsign })
                  : t('channel.dialInHint', lang)}
              </div>
              <button
                type="button"
                className="channel-dialin-cta"
                onClick={() => {
                  if (isAuthenticated) {
                    void beginConnection();
                  } else {
                    setPhase('dialin');
                  }
                }}
              >
                {t('channel.dialInCta', lang)}
              </button>
              {isAuthenticated && (
                <button
                  type="button"
                  className="channel-logout"
                  onClick={() => signOut()}
                >
                  {t('login.signOut', lang)}
                </button>
              )}
              {startError && <div className="channel-error">{startError}</div>}
            </div>
          </div>
        )}

        {phase === 'dialin' && (
          <div ref={dialinRef} className="dialin-wrap">
            <DialInScreen
              onBack={() => setPhase('channel')}
              onSuccess={() => {
                // A brief moment lets useAuthSession pick up the new session
                // (adopt-device runs on session change). Then we start a real
                // session on the server and kick off the handshake.
                setTimeout(() => {
                  void beginConnection();
                }, 500);
              }}
            />
          </div>
        )}

        {(phase === 'connecting' || phase === 'connected') && (
          <div ref={connectingRef} className="connecting-content">
            <div className="connecting-header">{t('start.connectingHeader', lang)}</div>
            <div className="connecting-log">
              {CONNECTION_STEPS.slice(0, visibleSteps).map((step, i) => (
                <div
                  key={i}
                  className={`log-line ${i === CONNECTION_STEPS.length - 1 && visibleSteps === CONNECTION_STEPS.length ? 'log-success' : ''}`}
                >
                  <span className="log-prefix">
                    {i === CONNECTION_STEPS.length - 1 && visibleSteps === CONNECTION_STEPS.length ? '✓' : '›'}
                  </span>
                  {step.text}
                </div>
              ))}
              {visibleSteps < CONNECTION_STEPS.length && <div className="log-cursor">_</div>}
            </div>
            {phase === 'connected' && (
              <div className="connected-flash">{t('start.connectedFlash', lang)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
