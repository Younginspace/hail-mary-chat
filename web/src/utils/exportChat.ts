// Export the current chat session as either Markdown or a PNG image.
//
// Markdown is a plain client-side string build + blob download.
// Image uses html2canvas to rasterize a target DOM node. We render the
// chat-pane (not the hologram pane) so there's no Three.js canvas to
// worry about and the file stays small.

import html2canvas from 'html2canvas';
import type { DisplayMessage } from '../hooks/useChat';
import type { Lang } from '../i18n';

function formatTimestamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
}

// Strip the [MOOD:xxx], [INTRO], [LIKE], [DIRTY] control tags and the
// "[Translation]" / "[翻译]" / "[翻訳]" label before exporting — the
// bubble UI hides them but the raw `content` string still contains them.
function cleanForExport(raw: string): string {
  return raw
    .replace(/^\s*\[MOOD:[a-zA-Z]+\]\s*$/gm, '')
    .replace(/^\s*\[(INTRO|LIKE|DIRTY)\]\s*$/gm, '')
    .replace(/^\s*\[(Translation|翻译|翻訳)\]\s*/gm, '')
    .replace(/^[♫♩♪❗\s]{3,}$/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Markdown ────────────────────────────────────────────────────────

const HEADERS: Record<Lang, string> = {
  en: 'Chat with Rocky',
  zh: '与 Rocky 的通话记录',
  ja: 'Rockyとの通話記録',
};
const LABEL_ROCKY: Record<Lang, string> = {
  en: 'Rocky',
  zh: 'Rocky',
  ja: 'Rocky',
};
const LABEL_YOU: Record<Lang, string> = {
  en: 'You',
  zh: '你',
  ja: 'あなた',
};

export function exportChatMarkdown(
  messages: DisplayMessage[],
  callsign: string | null,
  lang: Lang
): void {
  const ts = formatTimestamp();
  const lines: string[] = [];
  lines.push(`# ${HEADERS[lang]}`);
  lines.push('');
  lines.push(`_${ts.replace('_', ' ')}${callsign ? ` · ${callsign}` : ''}_`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const body = cleanForExport(msg.content);
    if (!body) continue;
    const label = msg.role === 'assistant' ? LABEL_ROCKY[lang] : LABEL_YOU[lang];
    lines.push(`**${label}:**`);
    lines.push('');
    for (const line of body.split('\n')) {
      lines.push(`> ${line}`);
    }
    lines.push('');
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, `rocky-chat_${ts}.md`);
}

// ── PNG image (long screenshot) ─────────────────────────────────────

export async function exportChatImage(target: HTMLElement): Promise<void> {
  // Temporarily allow the chat-area to be as tall as its content so
  // html2canvas captures the entire history, not just the viewport slice.
  const scrollEl = target.querySelector<HTMLElement>('.chat-area');
  const prevMaxHeight = scrollEl?.style.maxHeight;
  const prevOverflow = scrollEl?.style.overflow;
  const prevScrollTop = scrollEl?.scrollTop;
  if (scrollEl) {
    scrollEl.style.maxHeight = 'none';
    scrollEl.style.overflow = 'visible';
    scrollEl.scrollTop = 0;
  }

  try {
    const canvas = await html2canvas(target, {
      backgroundColor: '#0b1620',
      scale: Math.min(window.devicePixelRatio, 2),
      useCORS: true,
      logging: false,
    });

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('toBlob returned null'));
        triggerDownload(blob, `rocky-chat_${formatTimestamp()}.png`);
        resolve();
      }, 'image/png');
    });
  } finally {
    if (scrollEl) {
      scrollEl.style.maxHeight = prevMaxHeight ?? '';
      scrollEl.style.overflow = prevOverflow ?? '';
      if (prevScrollTop != null) scrollEl.scrollTop = prevScrollTop;
    }
  }
}
