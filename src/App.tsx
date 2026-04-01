import { useState, useCallback, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import StartScreen from './components/StartScreen';
import { LangProvider } from './i18n/LangContext';
import { preloadAllRockyAudio } from './utils/rockyAudio';
import { getRemainingPlays, consumePlay } from './utils/playLimit';
import type { ChatMode } from './utils/playLimit';
import './styles/terminal.css';

type AppPhase = 'start' | 'chat';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('start');
  const [chatMode, setChatMode] = useState<ChatMode>('text');

  useEffect(() => {
    preloadAllRockyAudio();
  }, []);

  const handleConnected = useCallback((mode: ChatMode) => {
    if (getRemainingPlays(mode) <= 0) {
      // 没有次数了，不进入对话（StartScreen 应该已经有提示）
      return;
    }
    consumePlay(mode);
    setChatMode(mode);
    setPhase('chat');
  }, []);

  const handleBackToStart = useCallback(() => {
    setPhase('start');
  }, []);

  return (
    <LangProvider>
      {phase === 'start' && <StartScreen onConnected={handleConnected} />}
      {phase === 'chat' && <ChatInterface mode={chatMode} onBack={handleBackToStart} />}
    </LangProvider>
  );
}
