import { forwardRef } from 'react';
import type { DisplayMessage } from '../hooks/useChat';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { extractPlayableText } from '../utils/messageCleanup';

// Per-message visual cap. Longer bodies get truncated with ellipsis so
// the card fits 6 messages at 4:5 without overflow. Tuned empirically
// against 4-line clamp at 30px/1.45.
const CHAR_CAP_PER_MSG = 140;

function truncateBody(raw: string, lang: Lang): string {
  const clean = extractPlayableText(raw, lang);
  if (clean.length <= CHAR_CAP_PER_MSG) return clean;
  return clean.slice(0, CHAR_CAP_PER_MSG - 1).trimEnd() + '…';
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
            const isRocky = msg.role === 'assistant';
            const body = truncateBody(msg.content, lang);
            return (
              <div
                key={msg.id}
                className={`sharecard-msg ${isRocky ? 'sharecard-msg-rocky' : 'sharecard-msg-user'}`}
              >
                <div className="sharecard-msg-label">
                  {isRocky
                    ? t('share.senderRocky', lang)
                    : (callsign ?? t('share.senderYou', lang)).toUpperCase()}
                </div>
                <div className="sharecard-msg-body">{body}</div>
              </div>
            );
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
