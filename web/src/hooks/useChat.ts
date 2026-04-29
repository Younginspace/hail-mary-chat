import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat } from '../utils/api';
import type { ChatMessage } from '../utils/api';
import { getRockyGreeting, getRockyFarewell, ROCKY_API_CONFIG } from '../prompts/rocky';
import { findDefaultDialog } from '../utils/defaultDialogs';
import type { ChatMode } from '../utils/playLimit';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { generateGift, type GiftType, type RecentHistoryMessage } from '../utils/sessionApi';
import { genUuid } from '../utils/uuid';

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
  // Set on messages loaded as history from previous sessions. Points
  // at the original session_id so favorites can attribute correctly
  // (otherwise a heart-tap on a historical line would be filed under
  // the new session). Undefined for messages from the current session.
  originSessionId?: string;
  // Sentinel for the "— previous call —" divider rendered between
  // pre-loaded history and the current session's fresh greeting.
  // ChatInterface checks this flag and renders a divider element
  // instead of a MessageBubble.
  isHistoryDivider?: boolean;
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

export function useChat(
  lang: Lang,
  mode: ChatMode = 'voice',
  sessionId?: string,
  // affinity_level from /api/me. L2+ removes the per-session turn cap
  // entirely — they're considered engaged enough that we trust them
  // to keep the chat going as long as they want. Sessions still end
  // via the user's explicit hangup or the 30-min idle sweep
  // (consolidate.ts), so consolidation never runs on a runaway
  // transcript. Defaults to 1 so a missing/loading /api/me keeps the
  // safe (capped) behavior — never accidentally remove the cap from a
  // user who shouldn't have it removed.
  affinityLevel: number = 1,
  // Pre-loaded message tail from /api/session/start. The server
  // returns the last ~50 user/assistant messages from the user's
  // CONSOLIDATED prior sessions so a returning user sees "where we
  // left off" instead of a blank chat. Empty for first-time users.
  // Each entry carries originSessionId so favoriting a historical
  // line attributes source_session correctly. RecentHistoryMessage
  // is the shared type from sessionApi.ts; importing it here avoids
  // a parallel inline type that would silently drift if the server
  // shape ever changes.
  initialHistory: RecentHistoryMessage[] = [],
) {
  // Per-session turn cap. Infinity means uncapped (L2+ only); we still
  // take Math.max(0, MAX_TURNS - userTurns) for `turnsLeft`, which
  // resolves to Infinity for uncapped sessions — UI hides the counter
  // for L2+ so the value is never rendered as "Infinity".
  const MAX_TURNS = affinityLevel >= 2
    ? Number.POSITIVE_INFINITY
    : (mode === 'text' ? 50 : 10);
  // Initial messages list:
  //   1. Pre-loaded history (from previous consolidated sessions),
  //      each tagged with its origin session_id so favoriting still
  //      attributes to the right past conversation.
  //   2. A divider sentinel — id='history-divider' — that the
  //      ChatInterface render treats specially (renders a "previous
  //      call" line instead of a MessageBubble). Only inserted if
  //      there's actually history to separate.
  //   3. The fresh greeting for THIS session.
  // useState initializer runs once on mount so we don't overwrite
  // user-sent messages on later re-renders if initialHistory ref
  // changes.
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    const greeting: DisplayMessage = {
      id: 'greeting',
      role: 'assistant',
      content: getRockyGreeting(lang),
    };
    if (initialHistory.length === 0) return [greeting];
    const historyAsDisplay: DisplayMessage[] = initialHistory.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      originSessionId: m.session_id,
    }));
    return [
      ...historyAsDisplay,
      // Divider sentinel — see DisplayMessage.isHistoryDivider.
      { id: 'history-divider', role: 'assistant', content: '', isHistoryDivider: true },
      greeting,
    ];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [userTurns, setUserTurns] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  // UI-level gate so late streaming callbacks don't overwrite state after
  // the user already moved on. Distinct from `streamAbortRef`, which
  // aborts the underlying fetch/reader so no network drain lingers.
  const abortRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Cancel any inflight stream on unmount so we don't leave a zombie
  // fetch draining MiniMax in the background.
  useEffect(() => {
    return () => {
      abortRef.current = true;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, []);

  // Update greeting when lang changes (only if no user messages yet).
  // IMPORTANT: rewrite the greeting's content in place; do NOT replace
  // the entire messages array. The pre-loaded history + divider sit
  // ABOVE the greeting in the array — clobbering with [greeting] would
  // throw all of that away on every lang change AND on the initial
  // mount-time effect fire (because lang/userTurns changing triggers
  // it). That was the bug that left history-having users seeing only
  // the greeting.
  useEffect(() => {
    if (userTurns > 0) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'greeting'
          ? { ...m, content: getRockyGreeting(lang) }
          : m
      )
    );
  }, [lang, userTurns]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading || isEnded) return;

      const newTurnCount = userTurns + 1;

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
      // genUuid() is the polyfilled crypto.randomUUID — WeChat / QQ / UC /
      // old WebView don't expose randomUUID and the raw call would TypeError,
      // aborting sendMessage silently (the chat was reported as "can't send
      // messages" by Chinese users after the v2.0 deploy). Special-cased
      // ids (greeting, farewell-, default-, user-) keep their sentinels
      // since speak() routes them to pre-recorded audio paths and the
      // TTS link never matters.
      const assistantId = genUuid();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsLoading(true);
      setUserTurns(newTurnCount);

      // Build raw user/assistant chat history only — server handles
      // system prompt, few-shots, memory context, and last-turn hint.
      //
      // EXCLUDE pre-loaded history (messages with originSessionId)
      // and the history-divider sentinel. Those are UI-only:
      //   * the server already injects past-session memory via
      //     the consolidation pipeline (rapport + extracted facts),
      //     so re-feeding 50 raw historical messages would just
      //     bloat the prompt without adding signal
      //   * the divider has empty content and would land as an
      //     empty assistant message — confusing for the LLM
      // Net: only the current session's messages (greeting + the
      // user/assistant exchange so far) reach the LLM.
      const apiMessages: ChatMessage[] = [];
      const history = [...messages, userMsg];
      for (const msg of history) {
        if (msg.isHistoryDivider) continue;
        if (msg.originSessionId) continue;
        if (msg.id === 'greeting') {
          apiMessages.push({ role: 'assistant', content: getRockyGreeting(lang) });
        } else {
          apiMessages.push({ role: msg.role, content: msg.content });
        }
      }

      // Cancel the previous stream before starting a new one, so an
      // overlapping double-send can't leave two drains in flight.
      streamAbortRef.current?.abort();
      const thisAbort = new AbortController();
      streamAbortRef.current = thisAbort;

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
          // Strip any partial [GIFT:...] tag from what we display, in
          // case the server-side stripping failed and the tag leaked
          // into the streamed text. We keep the full text in
          // `accumulated` so the onDone fallback can still extract the
          // gift; only the user-visible content is cleaned.
          const { cleaned } = extractGift(accumulated);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: cleaned } : m
            )
          );
        },
        () => {
          if (thisAbort.signal.aborted) return;
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
          if (thisAbort.signal.aborted) return;
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
          if (thisAbort.signal.aborted) return;
          if (payload.type !== 'image' && payload.type !== 'music' && payload.type !== 'video') return;
          dispatchGift({
            type: payload.type,
            subtype: payload.subtype,
            description: payload.description,
          });
        },
        thisAbort.signal
      );
    },
    [messages, isLoading, isEnded, userTurns, lang, sessionId, mode]
  );

  const turnsLeft = Math.max(0, MAX_TURNS - userTurns);

  return { messages, sendMessage, isLoading, turnsLeft, isEnded, isQuotaExceeded };
}
