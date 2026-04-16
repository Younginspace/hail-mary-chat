import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useAuthSession } from '../hooks/useAuthSession';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { getDefaultQuestions } from '../utils/defaultDialogs';
import { setTtsQuotaExceeded, setChatQuotaExceeded } from '../utils/playLimit';
import { endSession, logMessage } from '../utils/sessionApi';
import type { ChatMode } from '../utils/playLimit';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';
import LangSwitcher from './LangSwitcher';
import LoginModal from './LoginModal';

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

export default function ChatInterface({ mode, sessionId, onBack }: ChatInterfaceProps) {
  const { lang } = useLang();
  const maxTurns = mode === 'text' ? 50 : 10;
  const { messages, sendMessage, isLoading, error, turnsLeft, isEnded, isQuotaExceeded, usedSuggestions } = useChat(lang, mode, sessionId);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking, isEnabled: ttsEnabled, toggle: toggleTTS, ttsQuotaExceeded } = useRockyTTS(mode === 'text');
  const { isAuthenticated, me, signOut } = useAuthSession();
  const [input, setInput] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [hookDismissed, setHookDismissed] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);
  const loggedIdsRef = useRef<Set<string>>(new Set());

  // P4: 3-message hook — after the user's third message, prompt them to
  // register a callsign. Not shown if already logged in or dismissed.
  const userMessageCount = messages.filter((m) => m.role === 'user').length;
  const showCallsignHook =
    !isAuthenticated && !hookDismissed && userMessageCount >= 3 && !isEnded;

  // 当 quota 用完时，记到 localStorage
  useEffect(() => {
    if (ttsQuotaExceeded) setTtsQuotaExceeded();
  }, [ttsQuotaExceeded]);

  useEffect(() => {
    if (isQuotaExceeded) setChatQuotaExceeded();
  }, [isQuotaExceeded]);

  // Log each user/assistant message to backend (fire-and-forget).
  // Skip the hard-coded greeting (id='greeting') — it's shown locally, not
  // sent through LLM, so there's nothing meaningful to store yet. The
  // server increments turn_count automatically for role='user' inserts.
  useEffect(() => {
    for (const msg of messages) {
      if (msg.id === 'greeting') continue;
      if (msg.isStreaming) continue;
      if (loggedIdsRef.current.has(msg.id)) continue;
      loggedIdsRef.current.add(msg.id);
      logMessage(sessionId, msg.role, msg.content);
    }
  }, [messages, sessionId]);

  // Close session on unmount (back to start / tab closed).
  useEffect(() => {
    return () => {
      endSession(sessionId);
    };
  }, [sessionId]);

  // Also close on page visibility hidden (mobile tab swipe, browser close).
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        endSession(sessionId);
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [sessionId]);

  // Auto-scroll to bottom
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

  // Remaining suggestions (filter out used ones)
  const allSuggestions = getDefaultQuestions(lang);
  const remainingSuggestions = allSuggestions.filter((q) => !usedSuggestions.has(q));
  const showSuggestions = remainingSuggestions.length > 0 && !isLoading && !isEnded;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    stopTTS();
    setInput('');
    sendMessage(text);
  };

  const handleSuggestion = (question: string) => {
    stopTTS();
    sendMessage(question);
  };

  return (
    <div className="immersive-root">
      <Starfield />

      <div className="mobile-lang-fab">
        <LangSwitcher />
      </div>

      <div className="terminal-overlay">
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

        <RockyModel isSpeaking={isLoading || ttsSpeaking} />

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

        {showCallsignHook && (
          <div className="callsign-hook">
            <span>{t('login.hookTitle', lang)}</span>
            <button type="button" onClick={() => setLoginOpen(true)}>
              {t('login.modeSignUp', lang)}
            </button>
            <button
              type="button"
              className="hook-dismiss"
              onClick={() => setHookDismissed(true)}
              title={t('login.later', lang)}
            >
              ✕
            </button>
          </div>
        )}

        <SuggestedQuestions
          suggestions={remainingSuggestions}
          onSelect={handleSuggestion}
          visible={showSuggestions}
        />

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onSuccess={() => setHookDismissed(true)}
        />

        {isEnded ? (
          <EndedPanel quotaExceeded={isQuotaExceeded} onBack={onBack} />
        ) : (
          <form className="input-area" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('chat.inputPlaceholder', lang)}
              disabled={isLoading}
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
