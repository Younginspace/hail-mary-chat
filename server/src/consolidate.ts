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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

// How many attempts we'll give a single session before flagging the
// job as failed (dead letter). Bumped from 3 → 5 because the new
// stale-session sweep + /session/end racing the same job can burn
// through attempts faster than they should during a transient
// upstream (MiniMax) outage. Concurrency guard at the top of
// runConsolidationJob also helps but isn't a perfect fence; the
// extra headroom is the safety net.
const MAX_CONSOLIDATION_ATTEMPTS = 5;

const DEFAULT_API_URL = "https://api.minimax.chat";
const DEFAULT_MODEL = "MiniMax-M2.7";
const MIN_TURNS = 1;
// Clamp token cost per consolidation.
const MAX_INPUT_MESSAGES = 100;
const EXTRACTION_MAX_TOKENS = 600;

// ── Forward-only sweep gate ────────────────────────────────────────
// The stale-session sweep was added on 2026-04-27. Existing orphan
// sessions started before this cutoff deliberately stay un-
// consolidated: backfilling them would unexpectedly bump some users
// from L1→L2/L3 (rapport accumulates per-session), which is bad UX
// and could erode trust. Only sessions started AFTER this cutoff are
// eligible for the new sweep. Old data stays where it is; the next
// session a returning user starts (post-cutoff) gets the new behavior.
//
// 2026-04-28 00:00 UTC = 1777334400000.
// (Earlier version used 1778025600000 which is actually 2026-05-06 —
//  off by 8 days. Sweep was silently dead until that fix.) The
//  module-load log below makes any future arithmetic regression loud.
const STALE_SWEEP_CUTOFF_MS = 1777334400000; // 2026-04-28 00:00 UTC
console.info(`[consolidate] stale sweep cutoff = ${new Date(STALE_SWEEP_CUTOFF_MS).toISOString()}`);

// Sessions with no activity for this long are treated as ended by the
// server-side sweep. Tuned to be generous (a user pondering a reply
// for 10 minutes shouldn't get prematurely consolidated) but tight
// enough that closed-tab orphans get picked up the same day.
const STALE_IDLE_MS = 30 * 60 * 1000; // 30 minutes

// If a consolidation_jobs row is in 'running' state and was touched
// within this window, runConsolidationJob assumes another invocation
// is in flight and skips. Without this guard, three call paths can
// concurrently invoke runConsolidationJob for the same session
// (explicit /session/end, sweep, retryStuck), each incrementing
// attempts independently, so a transient extractor failure can burn
// through MAX attempts in seconds.
const CONCURRENT_JOB_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

const EXTRACTION_SYSTEM_PROMPT = `You are the memory consolidator for a 3D alien character named Rocky (from the novel "Project Hail Mary") who has just finished an interstellar comm call with a human friend. Your job: read the raw conversation and extract structured memory Rocky will use in future calls to remember this friend.

You will receive:
1. The conversation transcript.
2. (Optionally) Rocky's existing memories about this friend, prefixed with [EXISTING MEMORIES]. Each memory is shown as [id] (kind) content. The id is opaque — copy it exactly when referencing a memory; do NOT invent ids.

Return ONLY a JSON object matching this schema — no prose, no markdown fences, no explanation:

{
  "summary": "1-2 sentence English summary of what this call was about",
  "facts": [
    {
      "kind": "fact" | "preference" | "topic" | "emotion",
      "content": "short English sentence Rocky should remember",
      "importance": 0.0 to 1.0,
      "supersedes_id": "(optional) id of an existing memory this fact replaces/updates — copy the id exactly from [EXISTING MEMORIES]"
    }
  ],
  "forget_ids": ["(optional) ids of existing memories the friend asked Rocky to forget"],
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
- UPDATES: If the friend corrected or updated something from an existing memory (e.g., moved to a new city, changed job), include the new fact with "supersedes_id" set to the exact id of the old memory it replaces.
- FORGETTING: If the friend explicitly asked Rocky to forget, not remember, or stop mentioning something, add the exact id(s) of the matching memory/memories to "forget_ids". Only do this for explicit requests — not for topic changes or mild discomfort. Never invent an id — if no existing memory matches, omit.
- Never invent facts the user did not state. If nothing substantive was said, return "facts": [] and small rapport delta.
- Write everything in English, even if the conversation was Chinese / Japanese — memory is stored in a single language.
- Facts should be written as Rocky-facing third-person statements about the friend.
- last_mood reflects how Rocky parted, based on the assistant's last [MOOD:...] tag.
- rapport_delta is small unless the conversation was deeply positive or negative.`;

interface ExtractedFact {
  kind: string;
  content: string;
  importance?: number;
  /** ID of an existing memory this fact replaces. Preferred. */
  supersedes_id?: string;
  /** Legacy: exact content string of an existing memory this fact replaces. */
  supersedes?: string;
}

interface ExtractionResult {
  summary?: string;
  facts?: ExtractedFact[];
  /** IDs of existing memories the user asked to forget. Preferred. */
  forget_ids?: string[];
  /** Legacy: exact content strings of existing memories to forget. */
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
  existingMemories: Array<{ id: string; content: string; kind: string }>,
): Promise<ExtractionResult | null> {
  const apiUrl = vars.get("MINIMAX_API_URL") ?? DEFAULT_API_URL;
  const model = vars.get("MINIMAX_MODEL") ?? DEFAULT_MODEL;
  // Memory consolidation is an LLM call, not a clone op — use the
  // Coding Plan subscription key, same as /api/chat.
  const apiKey = secret.get("MINIMAX_CODING_PLAN_KEY");
  if (!apiKey) {
    console.error("consolidate: MINIMAX_CODING_PLAN_KEY missing");
    return null;
  }

  // Prepend existing memories to the transcript so the LLM can dedup and
  // detect updates. Include each memory's id so the LLM can reference it
  // in supersedes_id / forget_ids without fragile content-string matching.
  let userContent = "";
  if (existingMemories.length > 0) {
    userContent += "[EXISTING MEMORIES]\n";
    for (const m of existingMemories) {
      userContent += `- [${m.id}] (${m.kind}) ${m.content}\n`;
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
    // Throw — not a silent return — so runConsolidationJob marks this
    // job as 'pending' (or 'failed' on terminal exhaustion) and the
    // sweeper retries it later. Pre-fix this swallowed extractor
    // failures: 277 jobs were marked 'done' but only 58 sessions
    // actually had a summary, meaning ~80% of "successful" jobs
    // silently produced nothing. The thrown path triggers the same
    // attempt-counter logic that real exceptions already use.
    throw new Error(`extractor returned no usable result (transient)`);
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

  // Helper: resolve an extractor-provided reference (preferring id) to an
  // existing memory row the caller is allowed to act on. Falls back to
  // exact / case-insensitive content match for backward-compat with any
  // in-flight extraction rounds before the prompt change rolled out.
  const existingById = new Map(existingMems.map((m) => [m.id, m] as const));
  const resolveRef = (id?: string | null, contentFallback?: string | null) => {
    if (typeof id === "string" && id.trim().length > 0) {
      const hit = existingById.get(id.trim());
      if (hit) return hit;
    }
    if (typeof contentFallback === "string" && contentFallback.trim().length > 0) {
      const needle = contentFallback.trim();
      return existingMems.find(
        (m) => m.content === needle || m.content.toLowerCase() === needle.toLowerCase()
      );
    }
    return undefined;
  };

  // 5a. Handle "forget" requests — mark matching memories as superseded.
  const forgetIds = Array.isArray(result.forget_ids) ? result.forget_ids : [];
  const forgetContents = Array.isArray(result.forget) ? result.forget : [];
  let forgotCount = 0;
  for (const id of forgetIds) {
    const match = resolveRef(typeof id === "string" ? id : null, null);
    if (match) {
      await db
        .update(memoriesTable)
        .set({ superseded_by: `forget:${session_id}` })
        .where(eq(memoriesTable.id, match.id));
      forgotCount++;
    }
  }
  for (const pattern of forgetContents) {
    const match = resolveRef(null, typeof pattern === "string" ? pattern : null);
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
    const match = resolveRef(f.supersedes_id, f.supersedes);
    if (match) {
      await db
        .update(memoriesTable)
        .set({ superseded_by: session_id })
        .where(eq(memoriesTable.id, match.id));
      supersededCount++;
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
  // Delta cap ±0.08 (was ±0.20). Paired with the tighter Lv3 threshold in
  // migration 0009 this gates 1→2 at ≥2 sessions even on max-positive
  // conversations, stretches 2→3 to ~5 sessions typical, and 3→4 to
  // ~11-14 sessions typical. See checkLevelUp below + rapport_thresholds.
  const delta = result.rapport_delta ?? {};
  const trustDelta = clamp(typeof delta.trust === "number" ? delta.trust : 0, -0.08, 0.08);
  const warmthDelta = clamp(typeof delta.warmth === "number" ? delta.warmth : 0, -0.08, 0.08);
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
  //   Lv2: +10 TTS · 3 image · 3 grace
  //   Lv3: +30 TTS · 5 music · 5 grace
  //   Lv4: +50 TTS · 1 video (lifetime) · 10 grace
  const voiceBonusTable: Record<number, number> = { 2: 10, 3: 30, 4: 50 };
  const imageTable: Record<number, number> = { 2: 3 };
  const musicTable: Record<number, number> = { 3: 5 };
  const videoTable: Record<number, number> = { 4: 1 };
  // Grace cameo credits — stack on top of the register-time 1. Keeps
  // Grace appearances rare early and more generous at deep affinity.
  const graceTable: Record<number, number> = { 2: 3, 3: 5, 4: 10 };

  let voiceBonus = 0;
  let imageBonus = 0;
  let musicBonus = 0;
  let videoBonus = 0;
  let graceBonus = 0;
  // Grant every unlock between curLevel+1 .. newLevel (in case user jumps
  // two levels from a single session — possible with large trust/warmth delta).
  for (let l = curLevel + 1; l <= newLevel; l++) {
    voiceBonus += voiceBonusTable[l] ?? 0;
    imageBonus += imageTable[l] ?? 0;
    musicBonus += musicTable[l] ?? 0;
    videoBonus += videoTable[l] ?? 0;
    graceBonus += graceTable[l] ?? 0;
  }

  const now = Date.now();
  // Pair the affinity/credit columns update with the ledger insert into a
  // single batch so a write-failure between them can't leave the wallet
  // out-of-sync with the ledger. db.batch is atomic in D1 — either both
  // statements land or neither does.
  const updateOp = db
    .update(users)
    .set({
      affinity_level: newLevel,
      pending_level_up: newLevel,
      voice_credits: sql`${users.voice_credits} + ${voiceBonus}`,
      image_credits: sql`${users.image_credits} + ${imageBonus}`,
      music_credits: sql`${users.music_credits} + ${musicBonus}`,
      video_credits: sql`${users.video_credits} + ${videoBonus}`,
      grace_credits: sql`${users.grace_credits} + ${graceBonus}`,
    })
    .where(eq(users.id, user_id));
  if (voiceBonus > 0) {
    const ledgerOp = db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id,
      delta: voiceBonus,
      reason: `level_up_${newLevel}`,
      session_id,
      created_at: now,
    });
    await db.batch([updateOp, ledgerOp] as unknown as Parameters<typeof db.batch>[0]);
  } else {
    await updateOp;
  }

  console.info(
    `level_up: user ${user_id} ${curLevel} → ${newLevel} (trust=${trust.toFixed(2)}, warmth=${warmth.toFixed(2)}); +${voiceBonus} voice · +${imageBonus} image · +${musicBonus} music · +${videoBonus} video · +${graceBonus} grace`
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

  // Concurrency gate. Three call paths converge here for the same
  // session (explicit /session/end, sweep, retryStuck). Without this,
  // a transient extractor outage can burn through MAX_CONSOLIDATION_
  // ATTEMPTS in seconds because each concurrent invocation increments
  // attempts independently. Skip if:
  //   - already 'done' — idempotent no-op
  //   - 'running' for less than CONCURRENT_JOB_LOCKOUT_MS — assume
  //     another invocation is in flight; let it finish + write the
  //     terminal status. Stuck-running rows older than the lockout
  //     are picked up by retryStuckConsolidationJobs.
  const existing = await db
    .select({
      status: consolidation_jobs.status,
      updated_at: consolidation_jobs.updated_at,
    })
    .from(consolidation_jobs)
    .where(eq(consolidation_jobs.session_id, session_id))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    if (row.status === "done") return;
    if (row.status === "running" && now - row.updated_at < CONCURRENT_JOB_LOCKOUT_MS) {
      console.info(`runConsolidationJob: skipping ${session_id} — concurrent invocation in flight (updated ${now - row.updated_at}ms ago)`);
      return;
    }
  }

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
// sweep pending OR orphaned-running jobs with attempts < MAX that
// haven't been touched in a while. Keeps the queue self-healing
// without requiring a proper worker cron.
//
// "Orphaned-running" means a worker set status='running' then crashed
// or was evicted before writing 'done'/'pending'/'failed'. Without
// this branch such rows live forever invisible to the sweeper — the
// whole session's consolidation is silently lost. Picking them up and
// re-running them is safe: consolidateSession rewrites session.summary
// and upserts rapport, and memory inserts go through dedup via the
// existingMems forget/supersedes pass in the same call.
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
        inArray(consolidation_jobs.status, ["pending", "running"]),
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

// ═══════════════════════════════════════════════════════════════════
//  Stale-session sweep — server-side detection of "ended" sessions
// ═══════════════════════════════════════════════════════════════════
//
// Why this exists:
//   /api/session/end is a fire-and-forget keepalive call from the
//   client. In production we measured 312/619 sessions with
//   ended_at IS NULL — 50% of conversations never explicitly ended,
//   so consolidation never triggered, so the user's rapport never
//   updated, so the affinity_level stayed stuck at the L1 default.
//
// Definition of "ended" (server-side, no client cooperation):
//   1. Explicit /api/session/end (best path, milliseconds latency)
//   2. The same user starts a NEW session — the previous one is
//      implicitly done (sweepUserStaleSessions is called from
//      /session/start)
//   3. No /api/session/message activity for STALE_IDLE_MS
//      (sweepStaleSessions, called opportunistically from hot paths)
//
// Forward-only: the cutoff filter STALE_SWEEP_CUTOFF_MS keeps this
// from backfilling old orphans. That's intentional — see the comment
// on the constant. The intent is to not change any existing user's
// affinity_level retroactively.
//
// What "sweep" does to a stale session:
//   - SET ended_at = now (only if still NULL — race-safe)
//   - Queue runConsolidationJob in the background
// Both writes happen via the existing job machinery so attempt
// counters, retry logic, and idempotency all behave the same as for
// explicitly-ended sessions.

/**
 * Sweep stale open sessions belonging to a single user, started after
 * the rollout cutoff. Called from /api/session/start so that whenever
 * a user opens a new conversation, the server cleans up whatever the
 * previous one left dangling. Cheap (one indexed SELECT, capped at
 * `limit` rows).
 */
export async function sweepUserStaleSessions(
  user_id: string,
  opts: { idleMs?: number; limit?: number } = {}
): Promise<{ swept: number }> {
  const idleMs = opts.idleMs ?? STALE_IDLE_MS;
  const limit = opts.limit ?? 5; // a single user rarely has many open sessions
  const now = Date.now();
  const idleCutoff = now - idleMs;

  const stale = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.user_id, user_id),
        isNull(sessions.ended_at),
        sql`${sessions.started_at} > ${STALE_SWEEP_CUTOFF_MS}`,
        // Use last_active_at when we have it, fall back to started_at
        // (legacy rows pre-migration 0014 will have NULL last_active_at).
        sql`coalesce(${sessions.last_active_at}, ${sessions.started_at}) < ${idleCutoff}`,
      )
    )
    .limit(limit);

  if (stale.length === 0) return { swept: 0 };

  let swept = 0;
  for (const row of stale) {
    // Race-safe close: only set ended_at if still NULL. If a concurrent
    // /api/session/end already closed it, we skip — the explicit path
    // already queued consolidation.
    const closed = await db
      .update(sessions)
      .set({ ended_at: now })
      .where(and(eq(sessions.id, row.id), isNull(sessions.ended_at)))
      .returning({ id: sessions.id });
    if (closed.length === 0) continue;
    try {
      await runConsolidationJob(row.id);
      swept++;
    } catch (err) {
      console.error(`sweepUserStaleSessions: job for ${row.id} threw (caught):`, err);
    }
  }
  return { swept };
}

/**
 * Global stale-session sweep — opportunistically called from /session/end
 * to mop up any lingering open sessions across all users. Capped tightly
 * so adding a slow path on every /session/end doesn't compound.
 */
export async function sweepStaleSessions(
  opts: { idleMs?: number; limit?: number } = {}
): Promise<{ swept: number }> {
  const idleMs = opts.idleMs ?? STALE_IDLE_MS;
  const limit = opts.limit ?? 25;
  const now = Date.now();
  const idleCutoff = now - idleMs;

  const stale = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        isNull(sessions.ended_at),
        sql`${sessions.started_at} > ${STALE_SWEEP_CUTOFF_MS}`,
        sql`coalesce(${sessions.last_active_at}, ${sessions.started_at}) < ${idleCutoff}`,
      )
    )
    .limit(limit);

  if (stale.length === 0) return { swept: 0 };

  let swept = 0;
  for (const row of stale) {
    const closed = await db
      .update(sessions)
      .set({ ended_at: now })
      .where(and(eq(sessions.id, row.id), isNull(sessions.ended_at)))
      .returning({ id: sessions.id });
    if (closed.length === 0) continue;
    try {
      await runConsolidationJob(row.id);
      swept++;
    } catch (err) {
      console.error(`sweepStaleSessions: job for ${row.id} threw (caught):`, err);
    }
  }
  return { swept };
}
