// Helpers for pulling plain text + mood out of Rocky's tagged messages.
// Kept outside the components so MessageBubble, ChatInterface, and the
// favorites flow all agree on what "message content" means when it's
// stored or hashed.

import type { Lang } from '../i18n';

const LABEL_RE = /^\[(翻译|Translation|翻訳)\]/;
const NOTES_RE = /^[♫♩♪❗\s]{3,}$/;
const SPEAKER_RE = /^\[(ROCKY|GRACE)\]$/;

export type Speaker = 'rocky' | 'grace';

export interface SpeakerBlock {
  speaker: Speaker;
  mood: string | null;
  hasIntro: boolean;
  hasLike: boolean;
  hasDirty: boolean;
  /** Raw source lines for this block (speaker marker stripped). Used by
   * render paths that want to run the same parseRockyMessage logic per
   * block. Grace blocks keep their format intact too. */
  rawContent: string;
}

// Split a full assistant message into one or more SpeakerBlocks.
//
// When the message contains no [ROCKY] / [GRACE] markers (old format,
// or a Rocky-only reply), returns a single Rocky block with the entire
// content as rawContent. When markers appear, everything before the
// first marker is an implicit Rocky block, and each marker starts a
// new block whose speaker matches the tag.
export function parseSpeakerBlocks(content: string): SpeakerBlock[] {
  const lines = content.split('\n');
  const blocks: Array<{ speaker: Speaker; lines: string[] }> = [];
  let current: { speaker: Speaker; lines: string[] } = { speaker: 'rocky', lines: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    const speakerMatch = trimmed.match(SPEAKER_RE);
    if (speakerMatch) {
      // Only push the previous block if it collected anything; first-block
      // implicit Rocky with no content before a [GRACE] marker should not
      // render as an empty Rocky bubble.
      if (current.lines.some((l) => l.trim().length > 0)) {
        blocks.push(current);
      }
      current = {
        speaker: speakerMatch[1].toUpperCase() === 'GRACE' ? 'grace' : 'rocky',
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((l) => l.trim().length > 0)) {
    blocks.push(current);
  }

  // Fallback: if somehow we produced 0 blocks (content was all whitespace
  // + speaker markers), return a single empty Rocky block so the caller
  // has something to render and extractPlayableText has something to
  // walk.
  if (blocks.length === 0) {
    return [{ speaker: 'rocky', mood: null, hasIntro: false, hasLike: false, hasDirty: false, rawContent: '' }];
  }

  return blocks.map(({ speaker, lines: blockLines }) => {
    const raw = blockLines.join('\n');
    return {
      speaker,
      mood: extractMood(raw),
      hasIntro: /^\[INTRO\]$/m.test(raw),
      hasLike: /^\[LIKE\]$/m.test(raw),
      hasDirty: /^\[DIRTY\]$/m.test(raw),
      rawContent: raw,
    };
  });
}

// extractPlayableText across ALL blocks, joined by spaces. Back-compat:
// a single-speaker Rocky-only message (no [GRACE] marker) returns the
// same string as before — preserves content_hash stability for every
// existing favorite / audio_cache row. `lang` is retained in the
// signature for back-compat with existing callers; currently unused
// since the stripping rules don't differ by language.
export function extractPlayableText(content: string, _lang?: Lang): string {
  const blocks = parseSpeakerBlocks(content);
  return blocks.map((b) => extractBlockText(b.rawContent, b.speaker)).filter(Boolean).join(' ');
}

// Speaker-aware text extraction — Grace blocks skip the [Translation]
// label stripping (Grace writes English directly) but still strip mood
// tags and speaker-neutral noise. Exported for callers that need to
// TTS one block at a time.
export function extractBlockText(content: string, speaker: Speaker): string {
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[MOOD:\w+\]$/.test(line)) continue;
    if (/^\[(INTRO|LIKE|DIRTY)\]$/.test(line)) continue;
    if (NOTES_RE.test(line)) continue;
    if (speaker === 'rocky' && LABEL_RE.test(line)) {
      const rest = line.replace(LABEL_RE, '').trim();
      if (rest) out.push(rest);
      continue;
    }
    if (/^【Grace/.test(line)) {
      // Legacy inline Grace-attribution line from old prompt versions.
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
