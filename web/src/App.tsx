import { useState, useCallback, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import EchoInterface from './components/EchoInterface';
import StartScreen from './components/StartScreen';
import { LangProvider } from './i18n/LangContext';
import { preloadAllRockyAudio } from './utils/rockyAudio';
import type { ChatMode } from './utils/playLimit';
import './styles/terminal.css';

type AppPhase = 'start' | 'chat' | 'echo';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('start');
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    preloadAllRockyAudio();
  }, []);

  const handleConnected = useCallback((mode: ChatMode, session_id: string) => {
    setChatMode(mode);
    setSessionId(session_id);
    setPhase('chat');
  }, []);

  const handleEcho = useCallback(() => {
    setSessionId(null);
    setPhase('echo');
  }, []);

  const handleBackToStart = useCallback(() => {
    setSessionId(null);
    setPhase('start');
  }, []);

  return (
    <LangProvider>
      {phase === 'start' && <StartScreen onConnected={handleConnected} onEcho={handleEcho} />}
      {phase === 'chat' && sessionId && (
        <ChatInterface mode={chatMode} sessionId={sessionId} onBack={handleBackToStart} />
      )}
      {phase === 'echo' && <EchoInterface onBack={handleBackToStart} />}
    </LangProvider>
  );
}
