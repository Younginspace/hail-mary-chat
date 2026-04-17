export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// P5 F1: chat is auth-required. Streams through /api/chat on the EdgeSpark
// worker; the session cookie rides along via credentials: 'include'.
const API_BASE = import.meta.env.VITE_API_URL || '';

export interface ChatConfig {
  temperature?: number;
  top_p?: number;
  /** If provided, server uses this to look up memory context for the session's user. */
  session_id?: string;
  /** Language hint — server uses this for system prompt + memory-context localization. */
  lang?: 'en' | 'zh' | 'ja';
  /** Signal that this is the last turn so server appends a farewell hint to the system prompt. */
  last_turn?: boolean;
}

const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

/** 去掉 <think>...</think> 块（含不完整的尾部 think 块） */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();
}

export async function streamChat(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  config?: ChatConfig
) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: config?.temperature ?? 0.55,
          top_p: config?.top_p ?? 0.9,
          max_tokens: 1024,
          session_id: config?.session_id,
          lang: config?.lang,
          last_turn: config?.last_turn,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
          onError(new Error('NOT_AUTHENTICATED'));
          return;
        }
        if (response.status === 429) {
          onError(new Error('QUOTA_EXCEEDED'));
          return;
        }
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let rawAccumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const text = json.choices?.[0]?.delta?.content;
            if (!text) continue;

            rawAccumulated += text;

            const cleaned = stripThink(rawAccumulated);
            if (cleaned) {
              onChunk(cleaned);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      const finalText = stripThink(rawAccumulated);
      if (!finalText) {
        onChunk('[MOOD:talk]\n[Translation] Signal weak. Rocky try again. Ask one more time, question?');
      }

      onDone();
      return;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
        continue;
      }
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
