import { useState, useCallback, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import StartScreen from './components/StartScreen';
import { LangProvider } from './i18n/LangContext';
import { preloadAllRockyAudio } from './utils/rockyAudio';
import type { ChatMode } from './utils/playLimit';
import './styles/terminal.css';

type AppPhase = 'start' | 'chat';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('start');
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    preloadAllRockyAudio();
  }, []);

  // StartScreen performs the backend session/start call and hands us the
  // session_id here. Quota enforcement lives on the server now — if we got
  // a session_id, the user is allowed in.
  const handleConnected = useCallback((mode: ChatMode, session_id: string) => {
    setChatMode(mode);
    setSessionId(session_id);
    setPhase('chat');
  }, []);

  const handleBackToStart = useCallback(() => {
    setSessionId(null);
    setPhase('start');
  }, []);

  return (
    <LangProvider>
      {phase === 'start' && <StartScreen onConnected={handleConnected} />}
      {phase === 'chat' && sessionId && (
        <ChatInterface mode={chatMode} sessionId={sessionId} onBack={handleBackToStart} />
      )}
    </LangProvider>
  );
}
