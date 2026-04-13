import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChat } from '../hooks/useChat';
import { useRockyTTS } from '../hooks/useRockyTTS';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { getDefaultQuestions } from '../utils/defaultDialogs';
import { getRemainingPlays, canShareForBonus, markShared, getShareUrl, setTtsQuotaExceeded, setChatQuotaExceeded } from '../utils/playLimit';
import { t as translate } from '../i18n';
import type { ChatMode } from '../utils/playLimit';
import Starfield from './Starfield';
import RockyModel from './RockyModel';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';
import LangSwitcher from './LangSwitcher';
import ShareModal from './ShareModal';

function EndedPanel({ mode, quotaExceeded, onBack }: { mode: ChatMode; quotaExceeded: boolean; onBack: () => void }) {
  const { lang } = useLang();
  const [unlocked, setUnlocked] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const remaining = getRemainingPlays(mode);
  const canShare = canShareForBonus(mode);
  const canPlayAgain = remaining > 0;

  const handleShareDone = () => {
    markShared(mode);
    setUnlocked(true);
    setShowShare(false);
  };

  const handleShare = async () => {
    // 手机：优先系统分享面板
    if (navigator.share) {
      try {
        await navigator.share({
          title: translate('share.title', lang),
          text: translate('share.text', lang),
          url: getShareUrl(),
        });
        handleShareDone();
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    // 桌面 fallback
    setShowShare(true);
  };

  const handlePlayAgain = () => onBack();

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
      ) : unlocked ? (
        <>
          <div className="ended-unlocked">{t('ended.unlocked', lang, { n: 0 })}</div>
          <button className="ended-play-btn" onClick={handlePlayAgain}>{t('ended.callAgain', lang)}</button>
        </>
      ) : canPlayAgain ? (
        <>
          <div className="ended-desc">{t('ended.remaining', lang, { n: remaining })}</div>
          <button className="ended-play-btn" onClick={handlePlayAgain}>{t('ended.callAgain', lang)}</button>
          {canShare && (
            <button className="ended-share-btn" onClick={handleShare}>
              {t('ended.shareToRefuel', lang)}
            </button>
          )}
        </>
      ) : canShare ? (
        <>
          <div className="ended-desc">{t('ended.depleted', lang, { n: 1 })}</div>
          <button className="ended-share-btn" onClick={handleShare}>
            {t('ended.shareToRefuel', lang)}
          </button>
        </>
      ) : (
        <>
          <div className="ended-desc">{t('ended.dailyDepleted', lang)}</div>
          <button className="ended-play-btn" onClick={handlePlayAgain}>{t('ended.callAgain', lang)}</button>
        </>
      )}

      {showShare && (
        <ShareModal
          url={getShareUrl()}
          onShared={handleShareDone}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}

interface ChatInterfaceProps {
  mode: ChatMode;
  onBack: () => void;
}

export default function ChatInterface({ mode, onBack }: ChatInterfaceProps) {
  const { lang } = useLang();
  const maxTurns = mode === 'text' ? 50 : 10;
  const { messages, sendMessage, isLoading, error, turnsLeft, isEnded, isQuotaExceeded, usedSuggestions } = useChat(lang, mode);
  const { speak, stop: stopTTS, isSpeaking: ttsSpeaking, isEnabled: ttsEnabled, toggle: toggleTTS, ttsQuotaExceeded } = useRockyTTS(mode === 'text');
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string>('');
  const greetingSpoken = useRef(false);

  // 当 quota 用完时，记到 localStorage
  useEffect(() => {
    if (ttsQuotaExceeded) setTtsQuotaExceeded();
  }, [ttsQuotaExceeded]);

  useEffect(() => {
    if (isQuotaExceeded) setChatQuotaExceeded();
  }, [isQuotaExceeded]);

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

        <SuggestedQuestions
          suggestions={remainingSuggestions}
          onSelect={handleSuggestion}
          visible={showSuggestions}
        />

        {isEnded ? (
          <EndedPanel mode={mode} quotaExceeded={isQuotaExceeded} onBack={onBack} />
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
