import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat } from '../utils/api';
import type { ChatMessage } from '../utils/api';
import { getRockyGreeting, getRockyFarewell, ROCKY_API_CONFIG } from '../prompts/rocky';
import { findDefaultDialog } from '../utils/defaultDialogs';
import type { ChatMode } from '../utils/playLimit';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { generateGift, type GiftType } from '../utils/sessionApi';

export type GiftImageSubtype = 'realistic' | 'comic';

export interface GiftAttachment {
  type: GiftType;
  subtype?: GiftImageSubtype | null;
  description: string;
  caption?: string | null;
  status: 'pending' | 'ready' | 'failed';
  url?: string;
  content_type?: string;
  reason?: string;
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isDefault?: boolean;   // 预置对话标记，TTS 用本地音频
  gift?: GiftAttachment;
}

// Match `[GIFT:type(:subtype) "description"]`. Subtype is optional for
// music/video but REQUIRED for image (enforced server-side too). Tag
// must be on its own block — description can contain any non-quote char.
const GIFT_TAG_REGEX =
  /\[GIFT:(image|music|video)(?::([a-z]{3,16}))?\s+"([^"]{1,500})"\]/i;

export function extractGift(content: string): {
  cleaned: string;
  gift: { type: GiftType; subtype: GiftImageSubtype | null; description: string } | null;
} {
  const m = content.match(GIFT_TAG_REGEX);
  if (!m) return { cleaned: content, gift: null };
  const type = m[1].toLowerCase() as GiftType;
  const rawSub = m[2]?.toLowerCase() ?? null;
  const subtype: GiftImageSubtype | null =
    rawSub === 'realistic' || rawSub === 'comic' ? rawSub : null;
  const description = m[3].trim();
  const cleaned = content.replace(GIFT_TAG_REGEX, '').replace(/[ \t]+\n/g, '\n').trim();
  return { cleaned, gift: { type, subtype, description } };
}

export function useChat(lang: Lang, mode: ChatMode = 'voice', sessionId?: string) {
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

      // Build raw user/assistant chat history only — server handles
      // system prompt, few-shots, memory context, and last-turn hint.
      const apiMessages: ChatMessage[] = [];
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
      // The gift-trigger can arrive either from the server's dedicated
      // SSE event OR (as a fallback) from the client regex over the
      // streamed text. Whichever fires first wins; the other branch
      // no-ops. Belt + suspenders during rollout of the server path.
      let giftDispatched = false;

      const dispatchGift = (params: {
        type: GiftType;
        subtype: GiftImageSubtype | null;
        description: string;
      }) => {
        if (giftDispatched) return;
        giftDispatched = true;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  gift: {
                    type: params.type,
                    subtype: params.subtype,
                    description: params.description,
                    status: 'pending',
                  },
                }
              : m
          )
        );
        generateGift(params.type, params.description, sessionId, params.subtype).then((result) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId || !m.gift) return m;
              if (result.status === 'failed') {
                return { ...m, gift: { ...m.gift, status: 'failed', reason: result.reason } };
              }
              return {
                ...m,
                gift: {
                  ...m.gift,
                  status: 'ready',
                  url: result.url,
                  content_type: result.content_type,
                  caption: result.caption ?? null,
                },
              };
            })
          );
        });
      };

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
          // Client-side regex fallback for GIFT tags, in case the
          // server-side SSE stripping didn't catch it (old deployment,
          // network hiccup, etc). Server event path is preferred.
          const { cleaned, gift } = extractGift(accumulated);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: cleaned, isStreaming: false } : m
            )
          );
          setIsLoading(false);
          if (newTurnCount === MAX_TURNS) {
            setIsEnded(true);
          }
          if (gift) dispatchGift(gift);
        },
        (err) => {
          console.error('API error after retries:', err.message);
          const isQuotaExceeded = err.message === 'QUOTA_EXCEEDED';
          const msg = isQuotaExceeded
            ? t('chat.rockyQuotaReply', lang)
            : t('chat.rockyNetworkError', lang);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: msg, isStreaming: false } : m
            )
          );
          setIsLoading(false);
          if (isQuotaExceeded) {
            setIsQuotaExceeded(true);
            setIsEnded(true);
          } else {
            setUserTurns(newTurnCount - 1);
          }
        },
        { ...ROCKY_API_CONFIG, session_id: sessionId, lang, last_turn: newTurnCount === MAX_TURNS },
        // Server-side gift_trigger event: preferred path. Fires mid-
        // stream as soon as the tag is fully received server-side.
        (payload) => {
          if (payload.type !== 'image' && payload.type !== 'music' && payload.type !== 'video') return;
          dispatchGift({
            type: payload.type,
            subtype: payload.subtype,
            description: payload.description,
          });
        }
      );
    },
    [messages, isLoading, isEnded, userTurns, lang, sessionId, mode]
  );

  const turnsLeft = Math.max(0, MAX_TURNS - userTurns);

  return { messages, sendMessage, isLoading, error, turnsLeft, isEnded, isQuotaExceeded };
}
