/**
 * Session consolidation — runs after /session/end as a background job.
 *
 * Reads the raw message log for a session, asks MiniMax-M2.7 to extract
 * structured memory (summary + facts + rapport_delta), and persists the
 * result. Idempotent: skips if the session already has a summary. Skips
 * short sessions (< MIN_TURNS) to avoid burning tokens on accidental
 * connects.
 */

import { db, vars, secret } from "edgespark";
import { memories as memoriesTable, messages as messagesTable, rapport, sessions } from "@defs";
import { and, eq } from "drizzle-orm";

const DEFAULT_API_URL = "https://api.minimax.chat";
const DEFAULT_MODEL = "MiniMax-M2.7";
const MIN_TURNS = 3;
// Clamp token cost per consolidation.
const MAX_INPUT_MESSAGES = 60;
const EXTRACTION_MAX_TOKENS = 600;

const EXTRACTION_SYSTEM_PROMPT = `You are the memory consolidator for a 3D alien character named Rocky (from the novel "Project Hail Mary") who has just finished an interstellar comm call with a human friend. Your job: read the raw conversation and extract structured memory Rocky will use in future calls to remember this friend.

Return ONLY a JSON object matching this schema — no prose, no markdown fences, no explanation:

{
  "summary": "1-2 sentence English summary of what this call was about (who the friend seemed to be, what topics came up)",
  "facts": [
    {
      "kind": "fact" | "preference" | "topic" | "emotion",
      "content": "short English sentence Rocky should remember (e.g. 'Friend lives in Shanghai', 'Friend likes building small software', 'Friend asked about Grace's research')",
      "importance": 0.0 to 1.0
    }
  ],
  "rapport_delta": {
    "trust": -0.2 to 0.2,
    "warmth": -0.2 to 0.2,
    "last_mood": "happy" | "unhappy" | "question" | "inahurry" | "laugh" | "talk",
    "notes": "short English line capturing Rocky's feeling about this friend after the call"
  }
}

Rules:
- Output at most 8 facts. Prefer high-signal facts over trivia.
- Never invent facts the user did not state. If nothing substantive was said, return "facts": [] and small rapport delta.
- Write everything in English, even if the conversation was Chinese / Japanese — memory is stored in a single language.
- Facts should be written as Rocky-facing third-person statements about the friend.
- last_mood reflects how Rocky parted, based on the assistant's last [MOOD:...] tag.
- rapport_delta is small unless the conversation was deeply positive or negative.`;

interface ExtractedFact {
  kind: string;
  content: string;
  importance?: number;
}

interface ExtractionResult {
  summary?: string;
  facts?: ExtractedFact[];
  rapport_delta?: {
    trust?: number;
    warmth?: number;
    last_mood?: string;
    notes?: string;
  };
}

const VALID_KINDS = new Set(["fact", "preference", "topic", "emotion"]);
const VALID_MOODS = new Set(["happy", "unhappy", "question", "inahurry", "laugh", "talk"]);

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
}

function tryParseJson(text: string): ExtractionResult | null {
  const cleaned = stripThink(text).trim();
  // Strip markdown fences if the model wraps the JSON.
  const noFence = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(noFence) as ExtractionResult;
  } catch {
    // Best-effort: find the first { ... } block.
    const start = noFence.indexOf("{");
    const end = noFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(noFence.slice(start, end + 1)) as ExtractionResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const RETRY_DELAYS_MS = [1000, 3000, 9000]; // 3 retries on transient upstream errors

async function callExtractor(transcript: string): Promise<ExtractionResult | null> {
  const apiUrl = vars.get("MINIMAX_API_URL") ?? DEFAULT_API_URL;
  const model = vars.get("MINIMAX_MODEL") ?? DEFAULT_MODEL;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    console.error("consolidate: MINIMAX_API_KEY missing");
    return null;
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    stream: false,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: EXTRACTION_MAX_TOKENS,
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });
    } catch (err) {
      console.error(`consolidate: upstream fetch failed (attempt ${attempt + 1})`, err);
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return null;
    }

    // MiniMax 529 / 503 / 502 are transient overload signals — retry.
    // 429 is quota — also worth one retry since consolidation can slip
    // behind the user-facing chat quota.
    const retriable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 529;
    if (!res.ok) {
      console.warn(
        `consolidate: extractor HTTP ${res.status} (attempt ${attempt + 1}${retriable ? ", retrying" : ""})`
      );
      if (retriable && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return null;
    }

    const json = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw) {
      console.error("consolidate: no content in extractor response");
      return null;
    }
    return tryParseJson(raw);
  }
  return null;
}

export async function consolidateSession(session_id: string): Promise<void> {
  // 1. Load session, gate on state.
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, session_id))
    .limit(1);
  if (sessionRows.length === 0) {
    console.warn("consolidate: session not found", session_id);
    return;
  }
  const session = sessionRows[0];

  if (session.summary) {
    // Already consolidated (idempotent).
    return;
  }
  if (session.turn_count < MIN_TURNS) {
    console.info(
      `consolidate: skipping session ${session_id} (turn_count=${session.turn_count} < ${MIN_TURNS})`
    );
    return;
  }

  // 2. Load messages.
  const msgs = await db
    .select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.session_id, session_id))
    .orderBy(messagesTable.created_at);
  if (msgs.length === 0) return;

  // Keep only the last N messages; earlier turns are implicitly summarized.
  const trimmed = msgs.slice(-MAX_INPUT_MESSAGES);
  const transcript = trimmed
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  // 3. Extract.
  const result = await callExtractor(transcript);
  if (!result) {
    console.warn("consolidate: extractor returned nothing for", session_id);
    return;
  }

  const now = Date.now();
  const summary = typeof result.summary === "string" ? result.summary.slice(0, 1000) : null;

  // 4. Write sessions.summary (single update).
  await db
    .update(sessions)
    .set({
      summary,
      summary_tokens: EXTRACTION_MAX_TOKENS, // rough upper bound; we don't get a true count
    })
    .where(eq(sessions.id, session_id));

  // 5. Insert memories.
  const rawFacts = Array.isArray(result.facts) ? result.facts : [];
  const facts = rawFacts
    .filter((f) => f && typeof f.content === "string" && f.content.trim().length > 0)
    .slice(0, 8)
    .map((f) => ({
      id: crypto.randomUUID(),
      user_id: session.user_id,
      kind: VALID_KINDS.has(f.kind) ? f.kind : "fact",
      content: f.content.trim().slice(0, 500),
      importance: clamp(typeof f.importance === "number" ? f.importance : 0.5, 0, 1),
      source_session: session_id,
      created_at: now,
    }));

  if (facts.length > 0) {
    await db.insert(memoriesTable).values(facts);
  }

  // 6. Upsert rapport.
  const delta = result.rapport_delta ?? {};
  const trustDelta = clamp(typeof delta.trust === "number" ? delta.trust : 0, -0.2, 0.2);
  const warmthDelta = clamp(typeof delta.warmth === "number" ? delta.warmth : 0, -0.2, 0.2);
  const lastMood =
    typeof delta.last_mood === "string" && VALID_MOODS.has(delta.last_mood)
      ? delta.last_mood
      : null;
  const notes = typeof delta.notes === "string" ? delta.notes.slice(0, 500) : null;

  const existing = await db
    .select()
    .from(rapport)
    .where(eq(rapport.user_id, session.user_id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(rapport).values({
      user_id: session.user_id,
      trust: clamp(0.3 + trustDelta, 0, 1),
      warmth: clamp(0.3 + warmthDelta, 0, 1),
      last_mood: lastMood,
      notes,
      updated_at: now,
    });
  } else {
    const prev = existing[0];
    await db
      .update(rapport)
      .set({
        trust: clamp(prev.trust + trustDelta, 0, 1),
        warmth: clamp(prev.warmth + warmthDelta, 0, 1),
        last_mood: lastMood ?? prev.last_mood,
        notes: notes ?? prev.notes,
        updated_at: now,
      })
      .where(eq(rapport.user_id, session.user_id));
  }

  console.info(
    `consolidate: session ${session_id} user ${session.user_id} → ${facts.length} facts, trustΔ=${trustDelta}, warmthΔ=${warmthDelta}`
  );

  // Silence unused-import warning for drizzle's `and` — kept for symmetry
  // with index.ts and future refinements (e.g., partial consolidation).
  void and;
}
