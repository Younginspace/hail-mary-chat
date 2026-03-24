import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useLang } from '../i18n/LangContext';
import { t, getSuggestions } from '../i18n';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';
import LangSwitcher from './LangSwitcher';

export default function ChatInterface() {
  const { lang } = useLang();
  const { messages, sendMessage, isLoading, error, turnsLeft, isEnded } = useChat(lang);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking, isEnabled: ttsEnabled, toggle: toggleTTS } = useRockyTTS();
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Speak Rocky's message when it finishes streaming
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastMsg.isStreaming) return; // wait for streaming to finish
    if (lastMsg.id === lastSpokenIdRef.current) return; // already spoken

    // Speak greeting on first interaction
    if (lastMsg.id === 'greeting' && !greetingSpoken.current) {
      greetingSpoken.current = true;
      // Don't auto-speak greeting — wait for user's first click
      const speakGreeting = () => {
        speak(lastMsg.content, lang);
        document.removeEventListener('click', speakGreeting);
      };
      document.addEventListener('click', speakGreeting, { once: true });
      lastSpokenIdRef.current = lastMsg.id;
      return;
    }

    lastSpokenIdRef.current = lastMsg.id;
    speak(lastMsg.content, lang);
  }, [messages, speak, lang]);

  const showSuggestions = messages.length === 1 && !isLoading;
  const suggestions = getSuggestions(lang);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
  };

  const handleSuggestion = (question: string) => {
    sendMessage(question);
  };

  const endedLines = t('chat.endedNotice', lang).split('\n');

  return (
    <div className="immersive-root">
      {/* Three.js starfield background */}
      <Starfield />

      {/* Mobile floating lang switcher */}
      <div className="mobile-lang-fab">
        <LangSwitcher />
      </div>

      {/* Main terminal layout */}
      <div className="terminal-overlay">
        {/* Top status bar */}
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
          <span className="delay">{t('chat.latency', lang)}</span>
          <span className="turns">{turnsLeft}/10 {t('chat.remaining', lang)}</span>
          <button
            className={`tts-toggle ${ttsEnabled ? 'tts-on' : 'tts-off'}`}
            onClick={() => { toggleTTS(); }}
            title={ttsEnabled ? 'Mute' : 'Unmute'}
          >
            {ttsEnabled ? '🔊' : '🔇'}
          </button>
          <LangSwitcher />
        </div>

        {/* Rocky 3D hologram */}
        <RockyModel isSpeaking={isLoading || ttsSpeaking} />

        {/* Error bar */}
        {error && <div className="error-bar">{error}</div>}

        {/* Chat messages */}
        <div className="chat-area">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} lang={lang} />
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Suggested questions */}
        <SuggestedQuestions
          suggestions={suggestions}
          onSelect={handleSuggestion}
          visible={showSuggestions}
        />

        {/* Input area */}
        {isEnded ? (
          <div className="ended-notice">
            {endedLines.map((line, i) => (
              <span key={i}>{line}{i < endedLines.length - 1 && <br />}</span>
            ))}
          </div>
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
