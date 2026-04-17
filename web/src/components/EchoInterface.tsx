import { useRef, useEffect, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { getDefaultQuestions } from '../utils/defaultDialogs';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import LangSwitcher from './LangSwitcher';

// Rocky Echo — the read-only broadcast mode. No server session, no LLM,
// no credits. Every reply comes from defaultDialogs.ts (hand-authored Q&A
// + pre-rendered MP3 under /audio/defaults). Useful for logged-out
// visitors and users who just want a taste before dialing in.
interface EchoInterfaceProps {
  onBack: () => void;
}

type MobileView = 'chat' | 'hologram';

const SWIPE_THRESHOLD = 80;

export default function EchoInterface({ onBack }: EchoInterfaceProps) {
  const { lang } = useLang();
  // sessionId left undefined — useChat still runs, but the server path
  // never fires because findDefaultDialog intercepts every message.
  const { messages, sendMessage, isEnded, turnsLeft } = useChat(lang, 'voice', undefined);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking } = useRockyTTS(false);
  const [mobileView, setMobileView] = useState<MobileView>('chat');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Smart auto-scroll — same heuristic as ChatInterface.
  useEffect(() => {
    const area = chatAreaRef.current;
    if (!area) return;
    const distance = area.scrollHeight - area.scrollTop - area.clientHeight;
    if (distance < 120) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Speak the greeting / preset replies when they settle.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.isStreaming) return;
    if (last.id === lastSpokenIdRef.current) return;
    if (last.id === 'greeting' && !greetingSpoken.current) {
      greetingSpoken.current = true;
      lastSpokenIdRef.current = last.id;
      setTimeout(() => speak(last.content, lang, last.id), 500);
      return;
    }
    lastSpokenIdRef.current = last.id;
    speak(last.content, lang, last.id);
  }, [messages, speak, lang]);

  const allQuestions = getDefaultQuestions(lang);
  const askedSet = new Set(messages.filter((m) => m.role === 'user').map((m) => m.content));
  const remaining = allQuestions.filter((q) => !askedSet.has(q));

  const handleQuestion = (q: string) => {
    stopTTS();
    sendMessage(q);
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    const start = touchStartRef.current;
    if (!start) return;
    touchStartRef.current = null;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (mobileView === 'chat' && dx > 0) setMobileView('hologram');
  };

  return (
    <div className={`immersive-root chat-shell view-${mobileView}`}>
      <Starfield />

      <button
        type="button"
        className="pane-toggle"
        onClick={() => setMobileView((v) => (v === 'chat' ? 'hologram' : 'chat'))}
        aria-label={mobileView === 'chat' ? 'Show hologram' : 'Show chat'}
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
        <RockyModel isSpeaking={ttsSpeaking} />
      </div>

      <div
        className="chat-pane"
        aria-hidden={mobileView === 'hologram'}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="status-bar">
          <button type="button" className="echo-back" onClick={onBack}>
            {t('echo.back', lang)}
          </button>
          <span className="echo-badge">ROCKY ECHO</span>
          <LangSwitcher />
        </div>

        <div className="mode-bar">
          <span className="mode-bar-label">{t('echo.hint', lang)}</span>
          <span className="mode-bar-remaining">{remaining.length} / {allQuestions.length}</span>
        </div>

        <div ref={chatAreaRef} className="chat-area">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} lang={lang} />
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="echo-questions">
          {remaining.length === 0 ? (
            <div className="echo-allanswered">{t('echo.allAnswered', lang)}</div>
          ) : (
            remaining.map((q) => (
              <button
                key={q}
                type="button"
                className="echo-question-chip"
                onClick={() => handleQuestion(q)}
                disabled={isEnded || turnsLeft <= 0}
              >
                {q}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
