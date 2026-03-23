import { useState, useCallback, useRef } from 'react';
import { streamChat } from '../utils/api';
import type { ChatMessage } from '../utils/api';
import { ROCKY_SYSTEM_PROMPT, ROCKY_GREETING, ROCKY_FAREWELL } from '../prompts/rocky';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

const MAX_TURNS = 10;

export function useChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'greeting',
      role: 'assistant',
      content: ROCKY_GREETING,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userTurns, setUserTurns] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const abortRef = useRef(false);

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
          { id: `farewell-${Date.now()}`, role: 'assistant', content: ROCKY_FAREWELL },
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
      let systemContent = ROCKY_SYSTEM_PROMPT;
      if (newTurnCount === MAX_TURNS) {
        systemContent += '\n\n【重要】这是最后一轮对话了。请在回复的最后自然地用角色内的方式暗示通讯能源快耗尽了，但不要太突兀，先正常回答用户的问题。';
      }

      const apiMessages: ChatMessage[] = [
        { role: 'system', content: systemContent },
      ];

      // Add conversation history (skip greeting, use actual messages)
      const history = [...messages, userMsg];
      for (const msg of history) {
        if (msg.id === 'greeting') {
          apiMessages.push({ role: 'assistant', content: ROCKY_GREETING });
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
    [messages, isLoading, isEnded, userTurns]
  );

  const turnsLeft = Math.max(0, MAX_TURNS - userTurns);

  return { messages, sendMessage, isLoading, error, turnsLeft, isEnded };
}
