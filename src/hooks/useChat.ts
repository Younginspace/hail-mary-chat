import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat } from '../utils/api';
import type { ChatMessage } from '../utils/api';
import { getRockySystemPrompt, getRockyGreeting, getRockyFarewell, getLastTurnHint } from '../prompts/rocky';
import type { Lang } from '../i18n';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

const MAX_TURNS = 10;

export function useChat(lang: Lang) {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'greeting',
      role: 'assistant',
      content: getRockyGreeting(lang),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userTurns, setUserTurns] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const abortRef = useRef(false);

  // Update greeting when lang changes (only if no user messages yet)
  useEffect(() => {
    if (userTurns === 0) {
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          content: getRockyGreeting(lang),
        },
      ]);
    }
  }, [lang, userTurns]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading || isEnded) return;

      const newTurnCount = userTurns + 1;
      setError(null);

      // Check if this is the last turn
      if (newTurnCount > MAX_TURNS) {
        setMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: 'user', content: text },
          { id: `farewell-${Date.now()}`, role: 'assistant', content: getRockyFarewell(lang) },
        ]);
        setIsEnded(true);
        return;
      }

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
      };

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsLoading(true);
      setUserTurns(newTurnCount);

      // Build API messages
      let systemContent = getRockySystemPrompt(lang);
      if (newTurnCount === MAX_TURNS) {
        systemContent += getLastTurnHint(lang);
      }

      const apiMessages: ChatMessage[] = [
        { role: 'system', content: systemContent },
      ];

      // Add conversation history (skip greeting, use actual messages)
      const history = [...messages, userMsg];
      for (const msg of history) {
        if (msg.id === 'greeting') {
          apiMessages.push({ role: 'assistant', content: getRockyGreeting(lang) });
        } else {
          apiMessages.push({ role: msg.role, content: msg.content });
        }
      }

      abortRef.current = false;
      let accumulated = '';

      await streamChat(
        apiMessages,
        (chunk) => {
          if (abortRef.current) return;
          accumulated += chunk;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m
            )
          );
        },
        () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, isStreaming: false } : m
            )
          );
          setIsLoading(false);
          if (newTurnCount === MAX_TURNS) {
            setIsEnded(true);
          }
        },
        (err) => {
          setError(err.message);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setIsLoading(false);
          setUserTurns(newTurnCount - 1); // rollback
        }
      );
    },
    [messages, isLoading, isEnded, userTurns, lang]
  );

  const turnsLeft = Math.max(0, MAX_TURNS - userTurns);

  return { messages, sendMessage, isLoading, error, turnsLeft, isEnded };
}
