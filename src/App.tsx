import { useState, useCallback } from 'react';
import ChatInterface from './components/ChatInterface';
import StartScreen from './components/StartScreen';
import { LangProvider } from './i18n/LangContext';
import './styles/terminal.css';

export default function App() {
  const [started, setStarted] = useState(false);

  const handleConnected = useCallback(() => {
    setStarted(true);
  }, []);

  return (
    <LangProvider>
      {started ? <ChatInterface /> : <StartScreen onConnected={handleConnected} />}
    </LangProvider>
  );
}
