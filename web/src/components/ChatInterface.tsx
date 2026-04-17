import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { endSession, logMessage } from '../utils/sessionApi';
import type { ChatMode } from '../utils/playLimit';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import LangSwitcher from './LangSwitcher';

function EndedPanel({ quotaExceeded, onBack }: { quotaExceeded: boolean; onBack: () => void }) {
  const { lang } = useLang();

  const quotaMsg: Record<string, string> = {
    zh: '今日通话的人太多了，资源不足，请改天再来吧！',
    en: 'Too many calls today, resources exhausted. Please come back another day!',
    ja: '本日は通話が多すぎてリソース不足です。また別の日に来てね！',
  };

  return (
    <div className="ended-panel">
      <div className="ended-line">{t('ended.line', lang)}</div>
      {quotaExceeded ? (
        <div className="ended-desc">{quotaMsg[lang]}</div>
      ) : (
        <button className="ended-play-btn" onClick={onBack}>{t('ended.callAgain', lang)}</button>
      )}
    </div>
  );
}

interface ChatInterfaceProps {
  mode: ChatMode;
  sessionId: string;
  onBack: () => void;
}

// Mobile-only view state. Desktop CSS shows both panes regardless.
type MobileView = 'chat' | 'hologram';

const SWIPE_THRESHOLD = 80; // px

export default function ChatInterface({ mode, sessionId, onBack }: ChatInterfaceProps) {
  const { lang } = useLang();
  const maxTurns = mode === 'text' ? 50 : 10;
  const { messages, sendMessage, isLoading, error, turnsLeft, isEnded, isQuotaExceeded } = useChat(lang, mode, sessionId);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking, isEnabled: ttsEnabled, toggle: toggleTTS, ttsQuotaExceeded } = useRockyTTS(mode === 'text');
  const { isAuthenticated, me, signOut } = useAuthSession();
  const [input, setInput] = useState('');
  const [mobileView, setMobileView] = useState<MobileView>('chat');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);
  const loggedIdsRef = useRef<Set<string>>(new Set());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Log each user/assistant message to backend (fire-and-forget).
  useEffect(() => {
    for (const msg of messages) {
      if (msg.id === 'greeting') continue;
      if (msg.isStreaming) continue;
      if (loggedIdsRef.current.has(msg.id)) continue;
      loggedIdsRef.current.add(msg.id);
      logMessage(sessionId, msg.role, msg.content);
    }
  }, [messages, sessionId]);

  // Close session on unmount
  useEffect(() => {
    return () => {
      endSession(sessionId);
    };
  }, [sessionId]);

  // Close on page unload. Using pagehide rather than visibilitychange so
  // mobile keyboard show/hide doesn't end the session early.
  useEffect(() => {
    const onPageHide = () => {
      endSession(sessionId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [sessionId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Speak Rocky's message when it finishes streaming
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastMsg.isStreaming) return;
    if (lastMsg.id === lastSpokenIdRef.current) return;

    if (lastMsg.id === 'greeting' && !greetingSpoken.current) {
      greetingSpoken.current = true;
      lastSpokenIdRef.current = lastMsg.id;
      setTimeout(() => speak(lastMsg.content, lang, lastMsg.id), 500);
      return;
    }

    lastSpokenIdRef.current = lastMsg.id;
    speak(lastMsg.content, lang, lastMsg.id);
  }, [messages, speak, lang]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    stopTTS();
    setInput('');
    sendMessage(text);
  };

  // Enter submits; Shift+Enter inserts a newline (Slack-style).
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    stopTTS();
    setInput('');
    sendMessage(text);
  };

  const toggleMobileView = useCallback(() => {
    setMobileView((v) => (v === 'chat' ? 'hologram' : 'chat'));
  }, []);

  // Horizontal swipe to toggle mobile view. Attached only to chat-pane —
  // the hologram pane hosts OrbitControls which own its touch events.
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (window.innerWidth >= 768) return;
      const start = touchStartRef.current;
      if (!start) return;
      touchStartRef.current = null;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Horizontal swipe only — ignore mostly-vertical gestures (scroll).
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      // Chat view: swipe right → show hologram.
      if (mobileView === 'chat' && dx > 0) setMobileView('hologram');
      // (Return from hologram via button — swipe in hologram conflicts with
      // OrbitControls drag-to-rotate.)
    },
    [mobileView]
  );

  return (
    <div className={`immersive-root chat-shell view-${mobileView}`}>
      <Starfield />

      <button
        type="button"
        className="pane-toggle"
        onClick={toggleMobileView}
        aria-label={mobileView === 'chat' ? 'Show hologram' : 'Show chat'}
        title={mobileView === 'chat' ? 'Hologram' : 'Chat'}
      >
        {mobileView === 'chat' ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      <div className="hologram-pane" aria-hidden={mobileView === 'chat'}>
        <RockyModel isSpeaking={isLoading || ttsSpeaking} />
      </div>

      <div
        ref={chatPaneRef}
        className="chat-pane"
        aria-hidden={mobileView === 'hologram'}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="status-bar">
          <div className="signal">
            <div className="signal-bars">
              <div className="signal-bar" />
              <div className="signal-bar" />
              <div className="signal-bar" />
              <div className="signal-bar" />
            </div>
            <span>ERID-LINK v2.1</span>
          </div>
          {mode === 'voice' && (
            <button
              className={`tts-toggle ${ttsEnabled ? 'tts-on' : 'tts-off'}`}
              onClick={() => { toggleTTS(); }}
              title={ttsEnabled ? 'Mute' : 'Unmute'}
            >
              {ttsEnabled ? '🔊' : '🔇'}
            </button>
          )}
          <span className="delay">{t('chat.latency', lang)}</span>
          <span className="turns">{turnsLeft}/{maxTurns} {t('chat.remaining', lang)}</span>
          {isAuthenticated && me?.callsign && (
            <span className="account-chip" title={me.email ?? ''}>
              ● {me.callsign}
              <button
                type="button"
                className="account-logout"
                onClick={() => signOut()}
                title={t('login.signOut', lang)}
              >
                ✕
              </button>
            </span>
          )}
          <LangSwitcher />
        </div>

        {error && <div className="error-bar">{error}</div>}

        <div className="mode-bar">
          <span className="mode-bar-label">
            {mode === 'voice' ? '📞' : '💬'}{' '}
            {t(mode === 'voice' ? 'chat.modeVoice' : 'chat.modeText', lang)}
          </span>
          <span className="mode-bar-remaining">
            {t('chat.modeRemaining', lang, { n: turnsLeft })}
          </span>
        </div>

        {mode === 'voice' && ttsQuotaExceeded && (
          <div className="quota-bar">
            {{
              zh: '今日通话人数太多，资源不足以播放语音',
              en: 'Too many calls today — insufficient resources for voice playback',
              ja: '本日は通話が多すぎて、音声再生のリソースが不足しています',
            }[lang]}
          </div>
        )}

        <div className="chat-area">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} lang={lang} />
          ))}
          <div ref={chatEndRef} />
        </div>

        {isEnded ? (
          <EndedPanel quotaExceeded={isQuotaExceeded} onBack={onBack} />
        ) : (
          <form className="input-area" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder', lang)}
              disabled={isLoading}
              rows={3}
              autoFocus
            />
            <button className="send-btn" type="submit" disabled={isLoading || !input.trim()}>
              SEND
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
