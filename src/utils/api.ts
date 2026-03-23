export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'https://colorist-gateway-staging.arco.ai';
const MODEL = import.meta.env.VITE_MODEL || 'MiniMax-M2.7';

export async function streamChat(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void
) {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    onError(new Error('请在 .env 文件中配置 VITE_API_KEY'));
    return;
  }

  // Separate system message from conversation messages
  const systemMsg = messages.find((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  try {
    const response = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        system: systemMsg?.content || '',
        messages: nonSystemMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        temperature: 0.85,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'event: message_stop') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          // Anthropic streaming: content_block_delta events
          if (json.type === 'content_block_delta') {
            const text = json.delta?.text;
            if (text) onChunk(text);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    onDone();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}
