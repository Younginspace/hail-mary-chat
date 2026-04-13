import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat } from '../utils/api';
import type { ChatMessage } from '../utils/api';
import { getRockySystemPrompt, getRockyGreeting, getRockyFarewell, getLastTurnHint, getRockyFewShots, ROCKY_API_CONFIG } from '../prompts/rocky';
import { findDefaultDialog } from '../utils/defaultDialogs';
import { refundPlay } from '../utils/playLimit';
import type { ChatMode } from '../utils/playLimit';
import type { Lang } from '../i18n';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isDefault?: boolean;   // 预置对话标记，TTS 用本地音频
}

export function useChat(lang: Lang, mode: ChatMode = 'voice') {
  const MAX_TURNS = mode === 'text' ? 50 : 10;
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
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [usedSuggestions, setUsedSuggestions] = useState<Set<string>>(new Set());
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
      setUsedSuggestions(new Set());
    }
  }, [lang, userTurns]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading || isEnded) return;

      const newTurnCount = userTurns + 1;
      setError(null);

      // Track used suggestion
      setUsedSuggestions((prev) => new Set(prev).add(text));

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

      // === 检查是否预置对话 ===
      const defaultDialog = findDefaultDialog(text, lang);
      if (defaultDialog) {
        const assistantId = `default-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          userMsg,
          {
            id: assistantId,
            role: 'assistant',
            content: defaultDialog.reply,
            isDefault: true,
          },
        ]);
        setUserTurns(newTurnCount);
        if (newTurnCount === MAX_TURNS) setIsEnded(true);
        return;
      }

      // === 非预置：走 LLM API ===
      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsLoading(true);
      setUserTurns(newTurnCount);

      let systemContent = getRockySystemPrompt(lang);
      if (newTurnCount === MAX_TURNS) {
        systemContent += getLastTurnHint(lang);
      }

      const apiMessages: ChatMessage[] = [
        { role: 'system', content: systemContent },
      ];

      // 注入 few-shot 示例（定口感，教格式，仅英文）
      const fewShots = getRockyFewShots(lang);
      for (const shot of fewShots) {
        apiMessages.push({ role: shot.role, content: shot.content });
      }

      // 实际对话历史
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
        (cleanedFull) => {
          if (abortRef.current) return;
          accumulated = cleanedFull;
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
          console.error('API error after retries:', err.message);
          const isQuotaExceeded = err.message === 'QUOTA_EXCEEDED';
          const quotaMsg: Record<Lang, string> = {
            en: '[MOOD:unhappy]\n[Translation] Too many calls today, resources exhausted. Please come back another day, friend!',
            zh: '[MOOD:unhappy]\n[翻译] 今日通话的人太多了，资源不足，请改天再来吧！',
            ja: '[MOOD:unhappy]\n[翻訳] 今日は通話が多すぎてリソース不足です。また別の日に来てね！',
          };
          const fallback: Record<Lang, string> = {
            en: '[MOOD:unhappy]\n[Translation] Interstellar link unstable. Please resend, friend.',
            zh: '[MOOD:unhappy]\n[翻译] 星际链接不稳定，请重新发送。',
            ja: '[MOOD:unhappy]\n[翻訳] 星間リンクが不安定。もう一度送ってほしい。',
          };
          const msg = isQuotaExceeded ? quotaMsg : fallback;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: msg[lang], isStreaming: false } : m
            )
          );
          setIsLoading(false);
          if (isQuotaExceeded) {
            setIsQuotaExceeded(true);
            setIsEnded(true);
          } else {
            setUserTurns(newTurnCount - 1);
          }
          if (newTurnCount === 1) {
            refundPlay(mode);
          }
        },
        ROCKY_API_CONFIG
      );
    },
    [messages, isLoading, isEnded, userTurns, lang]
  );

  const turnsLeft = Math.max(0, MAX_TURNS - userTurns);

  return { messages, sendMessage, isLoading, error, turnsLeft, isEnded, isQuotaExceeded, usedSuggestions };
}
