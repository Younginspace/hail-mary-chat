// Export the current chat session.
//  - Markdown: plain client-side string build + blob download (archival)
//  - Share card: html2canvas rasterize of the off-screen <ShareCard/>
//    component — a curated 4:5 image with 1-6 user-picked messages
//    (NOT a long screenshot of the whole chat).

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

// ── Share card (4:5 PNG from the off-screen <ShareCard/>) ───────────

// Rasterize the given card element and trigger a download.
//
// Shoving the card to `left: -20000px` produced a black PNG on every
// browser we tested (Chrome + Safari desktop, mobile Safari) — html2canvas
// couldn't reliably read paint data for an element outside the composited
// area. Fix: while capturing, move the card to `left:0; top:0` with a
// low z-index. The caller shows a full-viewport overlay above it, so the
// user sees only the overlay and never the raw card.
//
// Capture at scale=2 → 2160×2700 retina output on the 1080×1350 layout.
// Canvas pixel count = 5.83M, comfortably under every browser's cap.
export async function renderShareCard(target: HTMLElement): Promise<void> {
  const prev = {
    left: target.style.left,
    top: target.style.top,
    opacity: target.style.opacity,
    visibility: target.style.visibility,
    zIndex: target.style.zIndex,
    transform: target.style.transform,
  };
  target.style.left = '0';
  target.style.top = '0';
  target.style.opacity = '1';
  target.style.visibility = 'visible';
  target.style.zIndex = '1';
  target.style.transform = 'none';

  // Two rAFs to let layout + paint settle before the capture reads styles.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  try {
    const canvas = await html2canvas(target, {
      backgroundColor: '#050c12',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('toBlob returned null'));
        triggerDownload(blob, `rocky-share_${formatTimestamp()}.png`);
        resolve();
      }, 'image/png');
    });
  } finally {
    target.style.left = prev.left;
    target.style.top = prev.top;
    target.style.opacity = prev.opacity;
    target.style.visibility = prev.visibility;
    target.style.zIndex = prev.zIndex;
    target.style.transform = prev.transform;
  }
}
