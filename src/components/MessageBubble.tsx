import type { DisplayMessage } from '../hooks/useChat';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { getTranslationLabel } from '../prompts/rocky';

interface Props {
  message: DisplayMessage;
  lang: Lang;
}

// Parse Rocky's message into music notes + translation sections
function parseRockyMessage(content: string, lang: Lang) {
  const lines = content.split('\n');
  const parts: Array<{ type: 'notes' | 'label' | 'text' | 'grace'; content: string }> = [];
  const translationLabel = getTranslationLabel(lang);
  // Match any of the translation labels
  const labelRegex = /^\[(翻译|Translation|翻訳)\]/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Music notes line (mostly ♫♩♪ characters)
    if (/^[♫♩♪❗\s]{3,}$/.test(trimmed)) {
      parts.push({ type: 'notes', content: trimmed });
    } else if (labelRegex.test(trimmed)) {
      parts.push({ type: 'label', content: translationLabel });
      const text = trimmed.replace(labelRegex, '').trim();
      if (text) parts.push({ type: 'text', content: text });
    } else if (/^【Grace/.test(trimmed)) {
      parts.push({ type: 'grace', content: trimmed });
    } else {
      parts.push({ type: 'text', content: trimmed });
    }
  }

  return parts;
}

export default function MessageBubble({ message, lang }: Props) {
  const isRocky = message.role === 'assistant';

  if (!isRocky) {
    return (
      <div className="message user">
        <div className="message-sender">{t('chat.senderYou', lang)}</div>
        {message.content}
      </div>
    );
  }

  const parts = parseRockyMessage(message.content, lang);

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
