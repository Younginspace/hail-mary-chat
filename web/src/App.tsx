import { useState, useCallback, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import EchoInterface from './components/EchoInterface';
import FavoritesScreen from './components/FavoritesScreen';
import StartScreen from './components/StartScreen';
import { LangProvider } from './i18n/LangContext';
import { preloadAllRockyAudio } from './utils/rockyAudio';
import type { ChatMode } from './utils/playLimit';
import type { LevelUpPayload } from './utils/sessionApi';
import './styles/terminal.css';

type AppPhase = 'start' | 'chat' | 'echo' | 'favorites';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('start');
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingLevelUp, setPendingLevelUp] = useState<LevelUpPayload | null>(null);

  useEffect(() => {
    preloadAllRockyAudio();
  }, []);

  const handleConnected = useCallback(
    (mode: ChatMode, session_id: string, levelUp: LevelUpPayload | null) => {
      setChatMode(mode);
      setSessionId(session_id);
      setPendingLevelUp(levelUp);
      setPhase('chat');
    },
    []
  );

  const handleEcho = useCallback(() => {
    setSessionId(null);
    setPhase('echo');
  }, []);

  const handleFavorites = useCallback(() => {
    setPhase('favorites');
  }, []);

  const handleBackToStart = useCallback(() => {
    setSessionId(null);
    setPhase('start');
  }, []);

  const handleBackFromFavorites = useCallback(() => {
    // If we were in chat, try to go back there; otherwise home.
    if (sessionId) setPhase('chat');
    else setPhase('start');
  }, [sessionId]);

  return (
    <LangProvider>
      {phase === 'start' && (
        <StartScreen
          onConnected={handleConnected}
          onEcho={handleEcho}
          onFavorites={handleFavorites}
        />
      )}
      {phase === 'chat' && sessionId && (
        <ChatInterface
          mode={chatMode}
          sessionId={sessionId}
          onBack={handleBackToStart}
          initialLevelUp={pendingLevelUp}
          onLevelUpDismiss={() => setPendingLevelUp(null)}
        />
      )}
      {phase === 'echo' && <EchoInterface onBack={handleBackToStart} />}
      {phase === 'favorites' && <FavoritesScreen onBack={handleBackFromFavorites} />}
    </LangProvider>
  );
}
