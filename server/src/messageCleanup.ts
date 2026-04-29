// Server-side mirror of web/src/utils/messageCleanup.ts.
//
// Why duplicate: the original migration to backfill Grace favorites
// used SQL LIKE patterns to guess speaker from text. That heuristic
// missed Grace lines without obvious markers ("Yeah yeah, don't make
// it weird, buddy..." / "He says that about everything. Anyway...").
// The recovery endpoint in /api/admin/recover-grace-favorites-by-message
// uses parseSpeakerBlocks against the source message instead — ground
// truth, not pattern matching. We keep the same logic shape as the
// web version so the speaker classification stays consistent across
// hash, render, badge, and recovery.
//
// Keep in sync with web/src/utils/messageCleanup.ts. Only the bits
// we actually need server-side (no React/Lang dependencies).

const LABEL_RE = /^\[(翻译|Translation|翻訳)\]/;
const NOTES_RE = /^[♫♩♪❗\s]{3,}$/;
const SPEAKER_RE = /^\[(ROCKY|GRACE)\]$/;

export type Speaker = "rocky" | "grace";

export interface SpeakerBlock {
  speaker: Speaker;
  rawContent: string;
}

export function parseSpeakerBlocks(content: string): SpeakerBlock[] {
  const lines = content.split("\n");
  const blocks: Array<{ speaker: Speaker; lines: string[] }> = [];
  let current: { speaker: Speaker; lines: string[] } = {
    speaker: "rocky",
    lines: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const speakerMatch = trimmed.match(SPEAKER_RE);
    if (speakerMatch) {
      // Push the previous block only if it had real content. An
      // implicit Rocky block before the first explicit [GRACE] marker
      // with no content shouldn't render as an empty block.
      if (current.lines.some((l) => l.trim().length > 0)) {
        blocks.push(current);
      }
      current = {
        speaker: speakerMatch[1].toUpperCase() === "GRACE" ? "grace" : "rocky",
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((l) => l.trim().length > 0)) {
    blocks.push(current);
  }

  if (blocks.length === 0) {
    return [{ speaker: "rocky", rawContent: "" }];
  }

  return blocks.map(({ speaker, lines: blockLines }) => ({
    speaker,
    rawContent: blockLines.join("\n"),
  }));
}

// Speaker-aware text extraction. Rocky blocks strip the [Translation]
// label since the actual playable content lives after it. Grace blocks
// don't need that strip (Grace writes English directly). Both strip
// mood / intro / like / dirty markers and music-note noise lines.
export function extractBlockText(content: string, speaker: Speaker): string {
  const out: string[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[MOOD:\w+\]$/.test(line)) continue;
    if (/^\[(INTRO|LIKE|DIRTY)\]$/.test(line)) continue;
    if (NOTES_RE.test(line)) continue;
    if (speaker === "rocky" && LABEL_RE.test(line)) {
      const rest = line.replace(LABEL_RE, "").trim();
      if (rest) out.push(rest);
      continue;
    }
    if (/^【Grace/.test(line)) {
      // Legacy inline Grace-attribution line from old prompt versions.
      const rest = line.replace(/^【Grace[^】]*】\s*/, "").trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(line);
  }
  return out.join(" ");
}
