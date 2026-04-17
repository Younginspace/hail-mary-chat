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
import {
  consolidation_jobs,
  memories as memoriesTable,
  messages as messagesTable,
  rapport,
  rapport_thresholds,
  sessions,
  users,
  voice_credit_ledger,
} from "@defs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

// How many attempts we'll give a single session before flagging the
// job as failed (dead letter). 3 matches plan §7.
const MAX_CONSOLIDATION_ATTEMPTS = 3;

const DEFAULT_API_URL = "https://api.minimax.chat";
const DEFAULT_MODEL = "MiniMax-M2.7";
const MIN_TURNS = 1;
// Clamp token cost per consolidation.
const MAX_INPUT_MESSAGES = 100;
const EXTRACTION_MAX_TOKENS = 600;

const EXTRACTION_SYSTEM_PROMPT = `You are the memory consolidator for a 3D alien character named Rocky (from the novel "Project Hail Mary") who has just finished an interstellar comm call with a human friend. Your job: read the raw conversation and extract structured memory Rocky will use in future calls to remember this friend.

You will receive:
1. The conversation transcript.
2. (Optionally) Rocky's existing memories about this friend, prefixed with [EXISTING MEMORIES].

Return ONLY a JSON object matching this schema — no prose, no markdown fences, no explanation:

{
  "summary": "1-2 sentence English summary of what this call was about",
  "facts": [
    {
      "kind": "fact" | "preference" | "topic" | "emotion",
      "content": "short English sentence Rocky should remember",
      "importance": 0.0 to 1.0,
      "supersedes": "(optional) exact content string of an existing memory this fact replaces/updates"
    }
  ],
  "forget": ["(optional) exact content string of existing memories the friend asked Rocky to forget"],
  "rapport_delta": {
    "trust": -0.2 to 0.2,
    "warmth": -0.2 to 0.2,
    "last_mood": "happy" | "unhappy" | "question" | "inahurry" | "laugh" | "talk",
    "notes": "short English line capturing Rocky's feeling about this friend after the call"
  }
}

Rules:
- Output at most 8 NEW facts. Prefer high-signal facts over trivia.
- DEDUPLICATION: Do NOT repeat facts that already exist in [EXISTING MEMORIES]. Only extract genuinely new information from this conversation.
- UPDATES: If the friend corrected or updated something from an existing memory (e.g., moved to a new city, changed job), include the new fact with "supersedes" set to the exact content string of the old memory it replaces.
- FORGETTING: If the friend explicitly asked Rocky to forget, not remember, or stop mentioning something, add the exact content string(s) of the matching existing memory/memories to the "forget" array. Only do this for explicit requests — not for topic changes or mild discomfort.
- Never invent facts the user did not state. If nothing substantive was said, return "facts": [] and small rapport delta.
- Write everything in English, even if the conversation was Chinese / Japanese — memory is stored in a single language.
- Facts should be written as Rocky-facing third-person statements about the friend.
- last_mood reflects how Rocky parted, based on the assistant's last [MOOD:...] tag.
- rapport_delta is small unless the conversation was deeply positive or negative.`;

interface ExtractedFact {
  kind: string;
  content: string;
  importance?: number;
  /** Exact content string of an existing memory this fact replaces. */
  supersedes?: string;
}

interface ExtractionResult {
  summary?: string;
  facts?: ExtractedFact[];
  /** Exact content strings of existing memories the user asked to forget. */
  forget?: string[];
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

async function callExtractor(
  transcript: string,
  existingMemories: Array<{ content: string; kind: string }>,
): Promise<ExtractionResult | null> {
  const apiUrl = vars.get("MINIMAX_API_URL") ?? DEFAULT_API_URL;
  const model = vars.get("MINIMAX_MODEL") ?? DEFAULT_MODEL;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    console.error("consolidate: MINIMAX_API_KEY missing");
    return null;
  }

  // Prepend existing memories to the transcript so the LLM can dedup and detect updates.
  let userContent = "";
  if (existingMemories.length > 0) {
    userContent += "[EXISTING MEMORIES]\n";
    for (const m of existingMemories) {
      userContent += `- (${m.kind}) ${m.content}\n`;
    }
    userContent += "\n[CONVERSATION TRANSCRIPT]\n";
  }
  userContent += transcript;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: userContent },
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

  // 2b. Fetch existing memories for dedup + forget detection.
  const existingMems = await db
    .select({
      id: memoriesTable.id,
      kind: memoriesTable.kind,
      content: memoriesTable.content,
    })
    .from(memoriesTable)
    .where(
      and(
        eq(memoriesTable.user_id, session.user_id),
        isNull(memoriesTable.superseded_by),
      )
    )
    .orderBy(desc(memoriesTable.importance))
    .limit(50); // pass up to 50 existing memories for context

  // 3. Extract.
  const result = await callExtractor(transcript, existingMems);
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

  // 5a. Handle "forget" requests — mark matching memories as superseded.
  const forgetPatterns = Array.isArray(result.forget) ? result.forget : [];
  let forgotCount = 0;
  for (const pattern of forgetPatterns) {
    if (typeof pattern !== "string" || pattern.trim().length === 0) continue;
    // Find memory with exact or close content match.
    const match = existingMems.find(
      (m) => m.content === pattern || m.content.toLowerCase() === pattern.toLowerCase()
    );
    if (match) {
      await db
        .update(memoriesTable)
        .set({ superseded_by: `forget:${session_id}` })
        .where(eq(memoriesTable.id, match.id));
      forgotCount++;
    }
  }
  if (forgotCount > 0) {
    console.info(`consolidate: forgot ${forgotCount} memories for user ${session.user_id}`);
  }

  // 5b. Handle "supersedes" — mark old memories replaced by new facts.
  const rawFacts = Array.isArray(result.facts) ? result.facts : [];
  let supersededCount = 0;
  for (const f of rawFacts) {
    if (typeof f.supersedes === "string" && f.supersedes.trim().length > 0) {
      const match = existingMems.find(
        (m) => m.content === f.supersedes || m.content.toLowerCase() === f.supersedes!.toLowerCase()
      );
      if (match) {
        await db
          .update(memoriesTable)
          .set({ superseded_by: session_id })
          .where(eq(memoriesTable.id, match.id));
        supersededCount++;
      }
    }
  }

  // 5c. Insert new memories.
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
    `consolidate: session ${session_id} user ${session.user_id} → +${facts.length} facts, −${supersededCount} superseded, −${forgotCount} forgot, trustΔ=${trustDelta}, warmthΔ=${warmthDelta}`
  );

  // 7. Affinity level check — compute new level from the just-updated rapport
  //    and, if higher than stored users.affinity_level, grant the unlock
  //    bundle and mark pending_level_up so session/start can ceremony it.
  try {
    await checkLevelUp(session.user_id, session_id);
  } catch (err) {
    console.error("level check failed — skipping:", err);
  }
}

// Rapport-driven level unlock. Called after consolidate() updates rapport.
// Safe to call any time — idempotent: only grants once per upward level change.
async function checkLevelUp(user_id: string, session_id: string): Promise<void> {
  const rapRow = await db
    .select({ trust: rapport.trust, warmth: rapport.warmth })
    .from(rapport)
    .where(eq(rapport.user_id, user_id))
    .limit(1);
  if (rapRow.length === 0) return;
  const { trust, warmth } = rapRow[0];

  const thresholdsRows = await db.select().from(rapport_thresholds);
  if (thresholdsRows.length === 0) return; // unseeded — nothing to do
  // Highest level whose threshold is satisfied.
  let newLevel = 1;
  for (const row of thresholdsRows) {
    const okTrust = trust >= row.trust_min;
    const okWarmth = warmth >= row.warmth_min;
    const ok = row.combinator === "AND" ? okTrust && okWarmth : okTrust || okWarmth;
    if (ok && row.level > newLevel) newLevel = row.level;
  }

  const userRow = await db
    .select({
      affinity_level: users.affinity_level,
      voice_credits: users.voice_credits,
    })
    .from(users)
    .where(eq(users.id, user_id))
    .limit(1);
  if (userRow.length === 0) return;
  const curLevel = userRow[0].affinity_level;
  if (newLevel <= curLevel) return;

  // Credit bundle per milestone (plan table):
  //   Lv2: +10 TTS · 3 image
  //   Lv3: +30 TTS · 5 music
  //   Lv4: +50 TTS · 1 video (lifetime)
  const voiceBonusTable: Record<number, number> = { 2: 10, 3: 30, 4: 50 };
  const imageTable: Record<number, number> = { 2: 3 };
  const musicTable: Record<number, number> = { 3: 5 };
  const videoTable: Record<number, number> = { 4: 1 };

  let voiceBonus = 0;
  let imageBonus = 0;
  let musicBonus = 0;
  let videoBonus = 0;
  // Grant every unlock between curLevel+1 .. newLevel (in case user jumps
  // two levels from a single session — possible with large trust/warmth delta).
  for (let l = curLevel + 1; l <= newLevel; l++) {
    voiceBonus += voiceBonusTable[l] ?? 0;
    imageBonus += imageTable[l] ?? 0;
    musicBonus += musicTable[l] ?? 0;
    videoBonus += videoTable[l] ?? 0;
  }

  const now = Date.now();
  await db
    .update(users)
    .set({
      affinity_level: newLevel,
      pending_level_up: newLevel,
      voice_credits: sql`${users.voice_credits} + ${voiceBonus}`,
      image_credits: sql`${users.image_credits} + ${imageBonus}`,
      music_credits: sql`${users.music_credits} + ${musicBonus}`,
      video_credits: sql`${users.video_credits} + ${videoBonus}`,
    })
    .where(eq(users.id, user_id));

  if (voiceBonus > 0) {
    await db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id,
      delta: voiceBonus,
      reason: `level_up_${newLevel}`,
      session_id,
      created_at: now,
    });
  }

  console.info(
    `level_up: user ${user_id} ${curLevel} → ${newLevel} (trust=${trust.toFixed(2)}, warmth=${warmth.toFixed(2)}); +${voiceBonus} voice · +${imageBonus} image · +${musicBonus} music · +${videoBonus} video`
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Job wrapper (P5 Review §7) — no more silent .catch(console.error)
// ═══════════════════════════════════════════════════════════════════

// Replaces the old `consolidateSession(session_id).catch(...)` pattern.
// Upserts a consolidation_jobs row, runs the actual work, and records
// outcome so failures stop disappearing. After MAX_CONSOLIDATION_ATTEMPTS
// failures the row is marked 'failed' (dead letter) for a human or
// admin endpoint to retry.
export async function runConsolidationJob(session_id: string): Promise<void> {
  const now = Date.now();

  // Upsert: if a prior attempt failed and this is a retry, bump attempts.
  // ON CONFLICT path captures both "first time" and "retry after prior
  // attempt" cases without a separate read-then-write.
  await db
    .insert(consolidation_jobs)
    .values({
      session_id,
      status: "running",
      attempts: 1,
      last_error: null,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: consolidation_jobs.session_id,
      set: {
        status: "running",
        attempts: sql`${consolidation_jobs.attempts} + 1`,
        updated_at: now,
      },
    });

  try {
    await consolidateSession(session_id);
    await db
      .update(consolidation_jobs)
      .set({ status: "done", last_error: null, updated_at: Date.now() })
      .where(eq(consolidation_jobs.session_id, session_id));
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.slice(0, 2000) : String(err).slice(0, 2000);
    console.error(`consolidate job failed for ${session_id}:`, err);

    // Read current attempts to decide terminal vs requeue. Races with
    // a concurrent retry are harmless — both will settle on the same
    // observable state (attempts capped by MAX).
    const rows = await db
      .select({ attempts: consolidation_jobs.attempts })
      .from(consolidation_jobs)
      .where(eq(consolidation_jobs.session_id, session_id))
      .limit(1);
    const attempts = rows[0]?.attempts ?? 1;
    const terminal = attempts >= MAX_CONSOLIDATION_ATTEMPTS;

    await db
      .update(consolidation_jobs)
      .set({
        status: terminal ? "failed" : "pending",
        last_error: msg,
        updated_at: Date.now(),
      })
      .where(eq(consolidation_jobs.session_id, session_id));
  }
}

// Cold-start retry: call from an admin endpoint or a periodic path to
// sweep pending jobs with attempts < MAX that haven't been touched in
// a while. Keeps the queue self-healing without requiring a proper
// worker cron.
export async function retryStuckConsolidationJobs(
  olderThanMs = 10 * 60 * 1000,
  limit = 25
): Promise<{ retried: number }> {
  const cutoff = Date.now() - olderThanMs;
  const rows = await db
    .select({ session_id: consolidation_jobs.session_id })
    .from(consolidation_jobs)
    .where(
      and(
        eq(consolidation_jobs.status, "pending"),
        sql`${consolidation_jobs.attempts} < ${MAX_CONSOLIDATION_ATTEMPTS}`,
        sql`${consolidation_jobs.updated_at} < ${cutoff}`
      )
    )
    .limit(limit);
  let retried = 0;
  for (const r of rows) {
    try {
      await runConsolidationJob(r.session_id);
      retried++;
    } catch (err) {
      console.error(`retry job for ${r.session_id} threw (should be caught):`, err);
    }
  }
  return { retried };
}
