// Helpers for pulling plain text + mood out of Rocky's tagged messages.
// Kept outside the components so MessageBubble, ChatInterface, and the
// favorites flow all agree on what "message content" means when it's
// stored or hashed.

import type { Lang } from '../i18n';

const LABEL_RE = /^\[(翻译|Translation|翻訳)\]/;
const NOTES_RE = /^[♫♩♪❗\s]{3,}$/;

export function extractPlayableText(content: string, _lang?: Lang): string {
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[MOOD:\w+\]$/.test(line)) continue;
    if (/^\[(INTRO|LIKE|DIRTY)\]$/.test(line)) continue;
    if (NOTES_RE.test(line)) continue;
    if (LABEL_RE.test(line)) {
      const rest = line.replace(LABEL_RE, '').trim();
      if (rest) out.push(rest);
      continue;
    }
    if (/^【Grace/.test(line)) {
      const rest = line.replace(/^【Grace[^】]*】\s*/, '').trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(line);
  }
  return out.join(' ');
}

export function extractMood(content: string): string | null {
  const m = content.match(/\[MOOD:(\w+)\]/);
  return m ? m[1] : null;
}
