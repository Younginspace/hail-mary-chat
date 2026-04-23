import { forwardRef } from 'react';
import type { DisplayMessage } from '../hooks/useChat';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import {
  extractBlockText,
  extractPlayableText,
  parseSpeakerBlocks,
  type Speaker,
} from '../utils/messageCleanup';

// Per-message visual cap. Longer bodies get truncated with ellipsis so
// the card fits 6 messages at 4:5 without overflow. Tuned empirically
// against 4-line clamp at 30px/1.45.
const CHAR_CAP_PER_MSG = 140;

function truncate(clean: string): string {
  if (clean.length <= CHAR_CAP_PER_MSG) return clean;
  return clean.slice(0, CHAR_CAP_PER_MSG - 1).trimEnd() + '…';
}

function truncateBody(raw: string, lang: Lang): string {
  return truncate(extractPlayableText(raw, lang));
}

interface AssistantBlock {
  speaker: Speaker;
  text: string;
}

// Parse an assistant message into one or more speaker-labelled blocks.
// A reply that never used [ROCKY]/[GRACE] markers returns a single
// rocky block — same text extractPlayableText would produce — so the
// old single-bubble rendering is unchanged. When Grace is in the
// reply, we return one block per speaker so the card can render each
// under its own label (ROCKY / GRACE) with matching palette.
function toAssistantBlocks(content: string): AssistantBlock[] {
  const parsed = parseSpeakerBlocks(content);
  const out: AssistantBlock[] = [];
  for (const block of parsed) {
    const text = truncate(extractBlockText(block.rawContent, block.speaker));
    if (text) out.push({ speaker: block.speaker, text });
  }
  return out;
}

interface Props {
  messages: DisplayMessage[]; // already in chronological order, 1..6
  lang: Lang;
  callsign: string | null;
  affinityLevel: number; // 1..4
  levelName: string;
}

// Rendered off-screen (see ShareCard.css: left: -20000px) so html2canvas
// can rasterize it without the user seeing layout shift. Sized at the
// export target: 1080 × 1350 (4:5). Host-level positioning lives in
// terminal.css under .sharecard-*.
const ShareCard = forwardRef<HTMLDivElement, Props>(function ShareCard(
  { messages, lang, callsign, affinityLevel, levelName },
  ref,
) {
  const ts = new Date();
  const yyyy = ts.getFullYear();
  const mm = String(ts.getMonth() + 1).padStart(2, '0');
  const dd = String(ts.getDate()).padStart(2, '0');
  const tsLabel = `${yyyy}-${mm}-${dd}`;

  return (
    <div ref={ref} className="sharecard" role="img" aria-hidden="true">
      {/* Background layers — pure CSS so html2canvas sees them. No
          three.js / canvas elements (they render blank via html2canvas). */}
      <div className="sharecard-bg-grid" />
      <div className="sharecard-bg-aurora" />
      <div className="sharecard-bg-horizon" />
      <div className="sharecard-bg-scan" />

      {/* Corner brackets — sci-fi terminal vibe */}
      <div className="sharecard-bracket sharecard-bracket-tl" />
      <div className="sharecard-bracket sharecard-bracket-tr" />
      <div className="sharecard-bracket sharecard-bracket-bl" />
      <div className="sharecard-bracket sharecard-bracket-br" />

      <div className="sharecard-inner">
        <div className="sharecard-header">
          <div className="sharecard-badge">
            <span className="sharecard-badge-dot" />
            {t('share.cardHeader', lang)}
          </div>
          <div className="sharecard-timestamp">{tsLabel}</div>
        </div>

        <div className="sharecard-messages">
          {messages.map((msg) => {
            if (msg.role !== 'assistant') {
              return (
                <div key={msg.id} className="sharecard-msg sharecard-msg-user">
                  <div className="sharecard-msg-label">
                    {(callsign ?? t('share.senderYou', lang)).toUpperCase()}
                  </div>
                  <div className="sharecard-msg-body">{truncateBody(msg.content, lang)}</div>
                </div>
              );
            }
            const blocks = toAssistantBlocks(msg.content);
            return blocks.map((block, i) => (
              <div
                key={`${msg.id}-${i}`}
                className={`sharecard-msg sharecard-msg-${block.speaker}`}
              >
                <div className="sharecard-msg-label">
                  {t(block.speaker === 'grace' ? 'share.senderGrace' : 'share.senderRocky', lang)}
                </div>
                <div className="sharecard-msg-body">{block.text}</div>
              </div>
            ));
          })}
        </div>

        <div className="sharecard-footer">
          <div className="sharecard-footer-left">
            {affinityLevel > 1 && (
              <span className={`sharecard-level-badge lv-${affinityLevel}`}>
                {levelName}
              </span>
            )}
            {callsign && <span className="sharecard-footer-callsign">@{callsign}</span>}
          </div>
          <div className="sharecard-footer-right">rocky.savemoss.com</div>
        </div>
      </div>
    </div>
  );
});

export default ShareCard;
