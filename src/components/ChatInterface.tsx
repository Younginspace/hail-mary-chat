import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useAudio } from '../hooks/useAudio';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';

export default function ChatInterface() {
  const { messages, sendMessage, isLoading, error, turnsLeft, isEnded } = useChat();
  const { play: playAudio } = useAudio();
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const greetingAudioPlayed = useRef(false);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Play greeting audio on first user interaction
  useEffect(() => {
    if (greetingAudioPlayed.current) return;
    const playGreeting = () => {
      if (!greetingAudioPlayed.current) {
        greetingAudioPlayed.current = true;
        playAudio('/rocky-greeting.mp3');
      }
      document.removeEventListener('click', playGreeting);
    };
    document.addEventListener('click', playGreeting);
    return () => document.removeEventListener('click', playGreeting);
  }, [playAudio]);

  const showSuggestions = messages.length === 1 && !isLoading;

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

  return (
    <div className="immersive-root">
      {/* Three.js starfield background */}
      <Starfield />

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
          <span className="delay">LATENCY 4.2ly</span>
          <span className="turns">{turnsLeft}/10 REMAINING</span>
        </div>

        {/* Rocky 3D hologram */}
        <RockyModel isSpeaking={isLoading} />

        {/* Error bar */}
        {error && <div className="error-bar">{error}</div>}

        {/* Chat messages */}
        <div className="chat-area">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Suggested questions */}
        <SuggestedQuestions onSelect={handleSuggestion} visible={showSuggestions} />

        {/* Input area */}
        {isEnded ? (
          <div className="ended-notice">
            ── TRANSMISSION ENDED ──<br />
            噬星体能源已耗尽 · 感谢与 Rocky 的对话
          </div>
        ) : (
          <form className="input-area" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="发送星际消息..."
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
