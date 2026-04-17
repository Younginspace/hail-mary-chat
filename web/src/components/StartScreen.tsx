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

// P5 F1c: Landing layout priority order
//   - Hero "Rocky Chat" title + tagline
//   - Two parallel CTAs: DIAL IN (primary) | OPEN CHANNEL (secondary)
//   - OPEN CHANNEL expands an inline FAQ drawer (no standalone view)
//   - Dial In flow opens its own screen
//   - Dynamic background overlays (aurora sweep, scan lines) on top of
//     the three-js Starfield/Constellation/Signals.

type Phase = 'home' | 'dialin' | 'connecting' | 'connected';

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
  const [phase, setPhase] = useState<Phase>('home');
  const [channelOpen, setChannelOpen] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const dialinRef = useRef<HTMLDivElement>(null);
  const connectingRef = useRef<HTMLDivElement>(null);
  const channelDrawerRef = useRef<HTMLDivElement>(null);

  // Fade/slide transitions between phases
  useEffect(() => {
    if (phase === 'home' && homeRef.current) {
      gsap.fromTo(
        homeRef.current,
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

  // Slide the channel drawer in/out
  useEffect(() => {
    if (!channelDrawerRef.current) return;
    if (channelOpen) {
      gsap.fromTo(
        channelDrawerRef.current,
        { opacity: 0, y: -12, height: 0 },
        { opacity: 1, y: 0, height: 'auto', duration: 0.4, ease: 'power2.out' }
      );
    }
  }, [channelOpen]);

  const beginConnection = useCallback(async () => {
    unlockAudio();
    setStartError(null);
    const result = await startSession(lang, 'text');
    if (!result.ok) {
      setStartError(t('login.errorGeneric', lang));
      return;
    }
    setPendingSessionId(result.session_id);
    setPhase('connecting');
  }, [lang]);

  useEffect(() => {
    if (phase !== 'connecting') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    CONNECTION_STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => setVisibleSteps(i + 1), step.delay));
    });
    timers.push(setTimeout(() => setPhase('connected'), 5600));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

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

  const handleDialIn = useCallback(() => {
    if (isAuthenticated) {
      void beginConnection();
    } else {
      setPhase('dialin');
    }
  }, [isAuthenticated, beginConnection]);

  return (
    <div className="immersive-root hero-root">
      <Starfield />
      <MemoryConstellation />
      <SignalStreaks />

      {/* Dynamic overlays — pure CSS, no tool cost */}
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-horizon" aria-hidden="true" />
      <div className="hero-scan" aria-hidden="true" />

      <div className="start-overlay">
        <div className="start-lang-corner">
          <LangSwitcher />
        </div>

        {phase === 'home' && (
          <div ref={homeRef} className="hero-panel">
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              <span className="hero-badge-label">{t('hero.tagline', lang)}</span>
            </div>

            <h1 className="hero-title">
              <span className="hero-title-text">{t('hero.title', lang)}</span>
              <span className="hero-title-underline" aria-hidden="true" />
            </h1>

            <div className="hero-subtitle">{t('start.subtitle', lang)}</div>

            <div className="hero-ctas">
              <button
                type="button"
                className="hero-cta hero-cta-primary"
                onClick={handleDialIn}
              >
                <span className="hero-cta-label">{t('hero.dialInCta', lang)}</span>
                <span className="hero-cta-sub">
                  {isAuthenticated && me?.callsign
                    ? t('login.welcome', lang, { callsign: me.callsign })
                    : t('hero.dialInSub', lang)}
                </span>
              </button>

              <button
                type="button"
                className={`hero-cta hero-cta-secondary ${channelOpen ? 'active' : ''}`}
                onClick={() => setChannelOpen((v) => !v)}
              >
                <span className="hero-cta-label">
                  {channelOpen ? t('hero.closeChannel', lang) : t('hero.openChannelCta', lang)}
                </span>
                <span className="hero-cta-sub">{t('hero.openChannelSub', lang)}</span>
              </button>
            </div>

            {isAuthenticated && (
              <button
                type="button"
                className="hero-logout"
                onClick={() => signOut()}
              >
                {t('login.signOut', lang)}
              </button>
            )}

            {startError && <div className="hero-error">{startError}</div>}

            {channelOpen && (
              <div ref={channelDrawerRef} className="hero-channel-drawer">
                <OpenChannel />
              </div>
            )}
          </div>
        )}

        {phase === 'dialin' && (
          <div ref={dialinRef} className="dialin-wrap">
            <DialInScreen
              onBack={() => setPhase('home')}
              onSuccess={() => {
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
