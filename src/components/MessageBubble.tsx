import type { DisplayMessage } from '../hooks/useChat';

interface Props {
  message: DisplayMessage;
}

// Parse Rocky's message into music notes + translation sections
function parseRockyMessage(content: string) {
  const lines = content.split('\n');
  const parts: Array<{ type: 'notes' | 'label' | 'text' | 'grace'; content: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Music notes line (mostly ♫♩♪ characters)
    if (/^[♫♩♪❗\s]{3,}$/.test(trimmed)) {
      parts.push({ type: 'notes', content: trimmed });
    } else if (/^\[翻译\]/.test(trimmed)) {
      parts.push({ type: 'label', content: '[翻译]' });
      const text = trimmed.replace(/^\[翻译\]\s*/, '');
      if (text) parts.push({ type: 'text', content: text });
    } else if (/^【Grace/.test(trimmed)) {
      parts.push({ type: 'grace', content: trimmed });
    } else {
      parts.push({ type: 'text', content: trimmed });
    }
  }

  return parts;
}

export default function MessageBubble({ message }: Props) {
  const isRocky = message.role === 'assistant';

  if (!isRocky) {
    return (
      <div className="message user">
        <div className="message-sender">你 (Earth)</div>
        {message.content}
      </div>
    );
  }

  const parts = parseRockyMessage(message.content);

  return (
    <div className="message rocky">
      <div className="message-sender">Rocky (Erid)</div>
      {parts.map((part, i) => {
        switch (part.type) {
          case 'notes':
            return <div key={i} className="music-notes">{part.content}</div>;
          case 'label':
            return <div key={i} className="translation-label">{part.content}</div>;
          case 'grace':
            return <div key={i} className="grace-tag">{part.content}</div>;
          case 'text':
            return <div key={i}>{part.content}</div>;
        }
      })}
      {message.isStreaming && <span className="streaming-cursor" />}
    </div>
  );
}
