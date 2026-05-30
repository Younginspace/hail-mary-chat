import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import StartScreen from './components/StartScreen';
// Non-entry screens are code-split (2026-05-30). StartScreen is the entry/
// login surface and stays eager so first paint isn't gated on a chunk
// fetch. ChatInterface drags in the heaviest tail — RockyModel (three +
// GLTF loader), ShareCard, GiftBubble, html2canvas, the export utils — none
// of which the login path needs; lazy-loading it (and the other post-login
// screens) pulls all of that out of the entry bundle.
const ChatInterface = lazy(() => import('./components/ChatInterface'));
const CompanionScreen = lazy(() => import('./components/CompanionScreen'));
const EchoInterface = lazy(() => import('./components/EchoInterface'));
const FavoritesScreen = lazy(() => import('./components/FavoritesScreen'));
import { LangProvider } from './i18n/LangContext';
import { AuthProvider } from './hooks/useAuthSession';
import { preloadAllRockyAudio } from './utils/rockyAudio';
import type { ChatMode } from './utils/playLimit';
import type { LevelUpPayload, RecentHistoryMessage } from './utils/sessionApi';
import './styles/terminal.css';

type AppPhase = 'start' | 'chat' | 'echo' | 'favorites' | 'companion';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('start');
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingLevelUp, setPendingLevelUp] = useState<LevelUpPayload | null>(null);
  // Pre-loaded conversation tail handed in by StartScreen via
  // /api/session/start. Forwarded into ChatInterface so the user sees
  // their last conversation above the new greeting on re-entry.
  const [pendingHistory, setPendingHistory] = useState<RecentHistoryMessage[]>([]);

  useEffect(() => {
    preloadAllRockyAudio();
  }, []);

  const handleConnected = useCallback(
    (mode: ChatMode, session_id: string, levelUp: LevelUpPayload | null, history: RecentHistoryMessage[]) => {
      setChatMode(mode);
      setSessionId(session_id);
      setPendingLevelUp(levelUp);
      setPendingHistory(history);
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

  // Companion mode entry points. From home: just swap phase. From chat:
  // ChatInterface's handler already calls stopTTS() + endSession() before
  // invoking this, so we just swap phase.
  const handleStayConnected = useCallback(() => {
    setPhase('companion');
  }, []);

  const handleStayOnLine = useCallback(() => {
    setPhase('companion');
  }, []);

  // Exit from companion → back to home, reset session state so a fresh
  // dial-in is needed for chat.
  const handleCompanionDone = useCallback(() => {
    setSessionId(null);
    setPendingLevelUp(null);
    setPendingHistory([]);
    setPhase('start');
  }, []);

  return (
    <AuthProvider>
    <LangProvider>
      {/* Fallback matches the app's dark background so a lazy screen's
          brief chunk-fetch doesn't flash white. StartScreen is eager so
          it never suspends. */}
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#050a12' }} />}>
        {phase === 'start' && (
          <StartScreen
            onConnected={handleConnected}
            onEcho={handleEcho}
            onFavorites={handleFavorites}
            onCompanion={handleStayConnected}
          />
        )}
        {phase === 'chat' && sessionId && (
          <ChatInterface
            mode={chatMode}
            sessionId={sessionId}
            onBack={handleBackToStart}
            initialLevelUp={pendingLevelUp}
            onLevelUpDismiss={() => setPendingLevelUp(null)}
            initialHistory={pendingHistory}
            onStayOnLine={handleStayOnLine}
          />
        )}
        {phase === 'echo' && <EchoInterface onBack={handleBackToStart} />}
        {phase === 'favorites' && <FavoritesScreen onBack={handleBackFromFavorites} />}
        {phase === 'companion' && <CompanionScreen onDone={handleCompanionDone} />}
      </Suspense>
    </LangProvider>
    </AuthProvider>
  );
}
