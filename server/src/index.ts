/**
 * Hail Mary Chat — Rocky server.
 *
 * P0: proxy MiniMax chat + TTS (replaces old Express server).
 * P1: device_id anonymous identity + session/message logging + daily quota.
 *
 * All /api/public/* routes; no login yet. P4 will move authenticated paths
 * to /api/*. Every DB mutation scopes by device_id-derived user_id — the
 * platform does not enforce row ownership automatically.
 */

import { db, vars, secret, ctx } from "edgespark";
import { auth } from "edgespark/http";
import { memories, messages as messagesTable, rapport, sessions, users } from "@defs";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { consolidateSession } from "./consolidate";
import { getRockySystemPrompt, getRockyFewShots, getLastTurnHint } from "./prompts/rocky";
import type { Lang as RockyLang } from "./prompts/rocky";

const DEFAULT_API_URL = "https://api.minimax.chat";
const DEFAULT_MODEL = "MiniMax-M2.7";
const DEFAULT_TTS_API_URL = "https://api.minimaxi.com";
const DEFAULT_TTS_MODEL = "speech-2.8-hd";
const DEFAULT_TTS_VOICE_ID = "rocky_hailmary_v2";

const DAILY_QUOTA = 20;
const UTC8_OFFSET_MS = 8 * 3600 * 1000;

// ── UTC+8 today-start helpers (for daily quota) ──
function utc8TodayStartMs(now = Date.now()): number {
  const utc8Now = now + UTC8_OFFSET_MS;
  const utc8DayStart = Math.floor(utc8Now / 86_400_000) * 86_400_000;
  return utc8DayStart - UTC8_OFFSET_MS;
}

function utc8TomorrowStartMs(now = Date.now()): number {
  return utc8TodayStartMs(now) + 86_400_000;
}

// ── device_id helpers ──
function getDeviceId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const raw = c.req.header("x-device-id")?.trim();
  if (!raw || raw.length > 128) return null;
  // Accept any non-empty ID (UUIDv4, custom nanoid, etc.)
  if (!/^[A-Za-z0-9._\-]{8,128}$/.test(raw)) return null;
  return raw;
}

async function upsertUser(device_id: string): Promise<string> {
  const now = Date.now();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);
  if (existing.length > 0) {
    await db.update(users).set({ last_seen_at: now }).where(eq(users.id, existing[0].id));
    return existing[0].id;
  }
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    device_id,
    created_at: now,
    last_seen_at: now,
  });
  return id;
}

async function getTodayUsed(user_id: string): Promise<number> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.user_id, user_id), gte(sessions.started_at, utc8TodayStartMs())));
  return rows.length;
}

// P4: check whether the users row this device resolves to has been adopted
// by an authenticated account. Adopted rows bypass the daily-quota gate.
async function isUserAdopted(user_id: string): Promise<boolean> {
  const rows = await db
    .select({ auth_user_id: users.auth_user_id })
    .from(users)
    .where(eq(users.id, user_id))
    .limit(1);
  return rows.length > 0 && rows[0].auth_user_id != null;
}

// ═══════════════════════════════════════════════════════════════════
//  P3: memory-context helpers — used by /api/public/chat to prepend
//  a "[MEMORY CONTEXT]" system message so Rocky actually remembers.
// ═══════════════════════════════════════════════════════════════════

const MEMORY_INJECT_TOP_N = 12; // top memories by importance
const MEMORY_MAX_CHARS = 1800; // hard cap on injected block

type MemoryLang = "en" | "zh" | "ja";

function moodLabel(mood: string | null, lang: MemoryLang): string {
  if (!mood) return "";
  const table: Record<string, Record<MemoryLang, string>> = {
    happy: { en: "warm/happy", zh: "温暖开心", ja: "温かい/嬉しい" },
    unhappy: { en: "worried/sad", zh: "担忧/难过", ja: "心配/悲しい" },
    question: { en: "curious", zh: "好奇", ja: "好奇心" },
    inahurry: { en: "urgent", zh: "紧迫", ja: "急いでいる" },
    laugh: { en: "amused", zh: "欢乐", ja: "楽しい" },
    talk: { en: "calm", zh: "平静", ja: "穏やか" },
  };
  return table[mood]?.[lang] ?? mood;
}

function rapportBand(value: number): "low" | "mid" | "high" {
  if (value < 0.4) return "low";
  if (value < 0.7) return "mid";
  return "high";
}

/**
 * Build a compact memory context block for a given user. Returns null when
 * there is nothing worth injecting (new friend, no consolidated memory yet).
 *
 * English-only content — memories are stored in English by the consolidator.
 * We wrap in language-aware instructions so Rocky still speaks `lang`.
 */
async function buildMemoryContext(
  user_id: string,
  lang: MemoryLang,
  callsign: string | null
): Promise<string | null> {
  // Time-decayed scoring: score = importance / (1 + age_days / 30)
  // This gives a ~30-day half-life — newer facts of equal importance rank higher.
  // Naturally resolves conflicts: "moved to Beijing" (2 days ago) beats
  // "lives in Shanghai" (60 days ago) at the same importance level.
  const now = Date.now();
  const memRows = await db
    .select({
      kind: memories.kind,
      content: memories.content,
      importance: memories.importance,
    })
    .from(memories)
    .where(
      and(
        eq(memories.user_id, user_id),
        isNull(memories.superseded_by),
      )
    )
    .orderBy(
      desc(
        sql`(${memories.importance} * 1.0 / (1.0 + (${now} - ${memories.created_at}) / 86400000.0 / 30.0))`
      ),
      desc(memories.created_at)
    )
    .limit(MEMORY_INJECT_TOP_N);

  const rapportRows = await db
    .select()
    .from(rapport)
    .where(eq(rapport.user_id, user_id))
    .limit(1);

  if (memRows.length === 0 && rapportRows.length === 0 && !callsign) return null;

  const lines: string[] = [];
  lines.push("[MEMORY CONTEXT] (from previous calls with this friend)");
  if (callsign) {
    lines.push(`Friend's callsign (how Rocky should address them): ${callsign}`);
  }

  if (rapportRows.length > 0) {
    const r = rapportRows[0];
    const trustBand = rapportBand(r.trust);
    const warmthBand = rapportBand(r.warmth);
    lines.push(
      `Rapport: trust=${r.trust.toFixed(2)} (${trustBand}), warmth=${r.warmth.toFixed(2)} (${warmthBand}).`
    );
    if (r.last_mood) {
      lines.push(`Last parted with mood: ${moodLabel(r.last_mood, "en")}.`);
    }
    if (r.notes) {
      lines.push(`Rocky's feeling about friend: ${r.notes}`);
    }
  }

  if (memRows.length > 0) {
    lines.push("Known facts about the friend:");
    for (const m of memRows) {
      lines.push(`- (${m.kind}) ${m.content}`);
    }
  }

  const guide: Record<MemoryLang, string> = {
    en: "Use these memories to sound like you already know this friend. Reference a specific detail (e.g., their city, hobby, prior topic) in the first reply if it fits. Never quote this block verbatim or say the word 'memory'. If rapport trust/warmth is low, still be warm but earn deeper trust gradually.",
    zh: "用这些记忆让自己听起来像已经认识这位朋友。合适时在第一条回复里引用一个具体细节（比如他们所在的城市、爱好、上次聊的话题）。绝对不要逐字引用这个记忆块，也不要说'记忆/memory'这个词。如果信任度或温度偏低，依然要温暖，但让更深的信任慢慢赢得。",
    ja: "これらの記憶を使って、この友達をすでに知っているように話して。合う場合は最初の返信で具体的な詳細（街、趣味、前回の話題など）に触れて。この記憶ブロックをそのまま引用したり「記憶/memory」という言葉を使ったりしないで。信頼度や温かさが低くても、温かくして、深い信頼は徐々に勝ち取って。",
  };
  lines.push("");
  lines.push(guide[lang]);

  let out = lines.join("\n");
  if (out.length > MEMORY_MAX_CHARS) {
    out = out.slice(0, MEMORY_MAX_CHARS) + "\n…";
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  Cross-device memory merge — called after adopt-device links a device
//  to an auth account. Merges sessions, memories, and rapport from all
//  user rows sharing the same auth_user_id into a single primary user.
//  Idempotent: safe to call multiple times (e.g., device C logs in later).
// ═══════════════════════════════════════════════════════════════════

async function mergeUsersByAuthId(auth_user_id: string): Promise<void> {
  // 1. Find all user rows linked to this auth account.
  const allUsers = await db
    .select({ id: users.id, created_at: users.created_at })
    .from(users)
    .where(eq(users.auth_user_id, auth_user_id))
    .orderBy(asc(users.created_at));

  if (allUsers.length <= 1) return; // Nothing to merge.

  // 2. Pick the earliest-created user as the primary.
  const primaryId = allUsers[0].id;
  const secondaryIds = allUsers.slice(1).map((u) => u.id);

  // 3. Re-parent sessions and memories to the primary user (atomic batch).
  //    Messages are scoped to session_id, so they follow automatically.
  await db.batch([
    db.update(sessions).set({ user_id: primaryId }).where(inArray(sessions.user_id, secondaryIds)),
    db.update(memories).set({ user_id: primaryId }).where(inArray(memories.user_id, secondaryIds)),
  ]);

  // 4. Merge rapport: take MAX trust/warmth, most recent last_mood,
  //    concatenate notes. Then delete secondary rapport rows.
  const allRapport = await db
    .select()
    .from(rapport)
    .where(inArray(rapport.user_id, [primaryId, ...secondaryIds]));

  if (allRapport.length > 0) {
    let bestTrust = 0.3;
    let bestWarmth = 0.3;
    let latestMood: string | null = null;
    let latestUpdatedAt = 0;
    const notesParts: string[] = [];

    for (const r of allRapport) {
      if (r.trust > bestTrust) bestTrust = r.trust;
      if (r.warmth > bestWarmth) bestWarmth = r.warmth;
      if (r.updated_at > latestUpdatedAt) {
        latestUpdatedAt = r.updated_at;
        latestMood = r.last_mood;
      }
      if (r.notes) notesParts.push(r.notes);
    }

    const mergedNotes = notesParts.length > 0 ? notesParts.join(" | ").slice(0, 500) : null;
    const now = Date.now();

    const primaryRapport = allRapport.find((r) => r.user_id === primaryId);
    if (primaryRapport) {
      // Update existing primary rapport with merged values.
      await db
        .update(rapport)
        .set({
          trust: bestTrust,
          warmth: bestWarmth,
          last_mood: latestMood ?? primaryRapport.last_mood,
          notes: mergedNotes,
          updated_at: now,
        })
        .where(eq(rapport.user_id, primaryId));
    } else {
      // Primary had no rapport yet — insert merged values.
      await db.insert(rapport).values({
        user_id: primaryId,
        trust: bestTrust,
        warmth: bestWarmth,
        last_mood: latestMood,
        notes: mergedNotes,
        updated_at: now,
      });
    }

    // Delete secondary rapport rows.
    if (secondaryIds.length > 0) {
      await db.delete(rapport).where(inArray(rapport.user_id, secondaryIds));
    }
  }

  console.info(
    `merge: auth_user_id=${auth_user_id} → primary=${primaryId}, merged ${secondaryIds.length} secondary user(s)`
  );
}

// Log MiniMax response headers once per cold start so P2 can decide whether
// it can trust upstream rate-limit headers for the "能源再生中" countdown.
const chatHeaderFlag = { done: false };
const ttsHeaderFlag = { done: false };

function logHeadersOnce(flag: { done: boolean }, prefix: string, headers: Headers) {
  if (flag.done) return;
  flag.done = true;
  const entries: Record<string, string> = {};
  headers.forEach((value, key) => {
    entries[key] = value;
  });
  console.info(`${prefix} response headers (first call):`, JSON.stringify(entries));
}

const app = new Hono();

// CORS — permissive during migration; tighten in P5 once the custom
// domain swap happens and origins are known.
// credentials: true is required for /api/* so the auth session cookie rides
// along. The platform's /api/_es/auth/* endpoints already rely on this.
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "https://teaching-collie-6315.edgespark.app",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
    credentials: true,
  })
);

app.get("/api/public/health", (c) => c.json({ ok: true, service: "hail-mary-chat" }));

// ═══════════════════════════════════════════════════════════════════
//  P1: session + message + quota
// ═══════════════════════════════════════════════════════════════════

// GET /api/public/quota — read today's usage, does not touch users table
app.get("/api/public/quota", async (c) => {
  const device_id = getDeviceId(c);
  if (!device_id) {
    return c.json({
      used: 0,
      remaining: DAILY_QUOTA,
      dailyLimit: DAILY_QUOTA,
      resetAt: utc8TomorrowStartMs(),
      anonymous: true,
    });
  }
  const existing = await db
    .select({ id: users.id, auth_user_id: users.auth_user_id, callsign: users.callsign })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);
  let used = 0;
  let unlimited = false;
  let callsign: string | null = null;
  if (existing.length > 0) {
    unlimited = existing[0].auth_user_id != null;
    callsign = existing[0].callsign;
    if (!unlimited) {
      used = await getTodayUsed(existing[0].id);
    }
  }
  // Adopted/authed users bypass the daily quota — Rocky answers forever,
  // only capped by MiniMax subscription on the voice side.
  if (unlimited) {
    return c.json({
      used: 0,
      remaining: -1,
      dailyLimit: -1,
      resetAt: utc8TomorrowStartMs(),
      unlimited: true,
      callsign,
    });
  }
  return c.json({
    used,
    remaining: Math.max(0, DAILY_QUOTA - used),
    dailyLimit: DAILY_QUOTA,
    resetAt: utc8TomorrowStartMs(),
  });
});

// POST /api/public/session/start — allocate session row, enforce quota
app.post("/api/public/session/start", async (c) => {
  const device_id = getDeviceId(c);
  if (!device_id) return c.json({ error: "missing X-Device-Id" }, 400);

  const body = await c.req
    .json<{ lang?: string; mode?: string }>()
    .catch(() => ({} as { lang?: string; mode?: string }));
  const lang = body.lang === "zh" || body.lang === "ja" || body.lang === "en" ? body.lang : "en";
  const mode = body.mode === "text" || body.mode === "voice" ? body.mode : "text";

  const user_id = await upsertUser(device_id);
  const adopted = await isUserAdopted(user_id);
  let used = 0;
  if (!adopted) {
    used = await getTodayUsed(user_id);
    if (used >= DAILY_QUOTA) {
      return c.json(
        {
          error: "quota_exceeded",
          used,
          dailyLimit: DAILY_QUOTA,
          resetAt: utc8TomorrowStartMs(),
        },
        429
      );
    }
  }

  const session_id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    id: session_id,
    user_id,
    lang,
    mode,
    started_at: now,
    turn_count: 0,
  });

  return c.json({
    session_id,
    used: adopted ? 0 : used + 1,
    remaining: adopted ? -1 : DAILY_QUOTA - used - 1,
    dailyLimit: adopted ? -1 : DAILY_QUOTA,
    unlimited: adopted,
    resetAt: utc8TomorrowStartMs(),
  });
});

// ═══════════════════════════════════════════════════════════════════
//  P4: device → auth-account adoption
// ═══════════════════════════════════════════════════════════════════

// POST /api/adopt-device — authenticated. Links the current device's users
// row to the logged-in auth user. Idempotent: safe to call on every login.
//
// Path is under /api/* so EdgeSpark guarantees `auth.user`. We still require
// X-Device-Id so anonymous memories/sessions on that device get inherited.
app.post("/api/adopt-device", async (c) => {
  if (!auth.isAuthenticated()) {
    return c.json({ error: "not authenticated" }, 401);
  }
  const device_id = getDeviceId(c);
  if (!device_id) return c.json({ error: "missing X-Device-Id" }, 400);

  const body = await c.req
    .json<{ callsign?: string }>()
    .catch(() => ({} as { callsign?: string }));

  const authUser = auth.user;
  const now = Date.now();

  // Default callsign = local part of email (before @). Users can pass an
  // override, but we strip/trim to keep it display-safe.
  const rawCallsign =
    typeof body.callsign === "string" && body.callsign.trim().length > 0
      ? body.callsign.trim().slice(0, 64)
      : authUser.email?.split("@")[0]?.slice(0, 64) ?? "friend";

  const existing = await db
    .select({ id: users.id, auth_user_id: users.auth_user_id })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);

  if (existing.length === 0) {
    // New device, new account all in one go.
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      device_id,
      email: authUser.email,
      callsign: rawCallsign,
      auth_user_id: authUser.id,
      created_at: now,
      last_seen_at: now,
    });
    // Cross-device merge: if this auth account already has user rows from
    // other devices, merge all memories/sessions/rapport into the primary.
    await mergeUsersByAuthId(authUser.id);
    // After merge the primary user_id may differ from `id` (if older rows exist).
    const primaryRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_user_id, authUser.id))
      .orderBy(asc(users.created_at))
      .limit(1);
    const primaryId = primaryRow.length > 0 ? primaryRow[0].id : id;
    return c.json({ ok: true, user_id: primaryId, callsign: rawCallsign, adopted: true });
  }

  // Adopt: set auth_user_id + email + callsign, then merge across devices.
  const row = existing[0];
  if (row.auth_user_id && row.auth_user_id !== authUser.id) {
    // Device was already linked to a different account. Refuse silently
    // (don't move data between accounts automatically — avoids merge bugs).
    return c.json(
      { error: "device_linked_to_other_account", user_id: row.id },
      409
    );
  }

  await db
    .update(users)
    .set({
      auth_user_id: authUser.id,
      email: authUser.email,
      callsign: rawCallsign,
      last_seen_at: now,
    })
    .where(eq(users.id, row.id));

  // Cross-device merge: consolidate all user rows for this auth account.
  await mergeUsersByAuthId(authUser.id);
  // Return the primary user_id (earliest created).
  const primaryRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.auth_user_id, authUser.id))
    .orderBy(asc(users.created_at))
    .limit(1);
  const primaryId = primaryRow.length > 0 ? primaryRow[0].id : row.id;
  return c.json({ ok: true, user_id: primaryId, callsign: rawCallsign, adopted: true });
});

// GET /api/me — authenticated. Returns the linked profile + callsign so the
// web client can render "通讯畅通 · 呼号 XXX" once logged in.
app.get("/api/me", async (c) => {
  if (!auth.isAuthenticated()) {
    return c.json({ error: "not authenticated" }, 401);
  }
  const device_id = getDeviceId(c);
  // It's OK for device_id to be missing here — the client can re-adopt.
  let callsign: string | null = null;
  if (device_id) {
    const row = await db
      .select({ callsign: users.callsign, auth_user_id: users.auth_user_id })
      .from(users)
      .where(eq(users.device_id, device_id))
      .limit(1);
    if (row.length > 0 && row[0].auth_user_id === auth.user.id) {
      callsign = row[0].callsign;
    }
  }
  return c.json({
    ok: true,
    email: auth.user.email,
    callsign,
    adopted: callsign != null,
  });
});

// POST /api/public/session/end — close out session, record turn_count
app.post("/api/public/session/end", async (c) => {
  const device_id = getDeviceId(c);
  if (!device_id) return c.json({ error: "missing X-Device-Id" }, 400);

  const body = await c.req
    .json<{ session_id?: string; turn_count?: number }>()
    .catch(() => ({} as { session_id?: string; turn_count?: number }));
  if (!body.session_id) return c.json({ error: "missing session_id" }, 400);

  // Isolation: session must belong to this device_id's user.
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);
  if (user.length === 0) return c.json({ error: "unknown device" }, 404);

  // Only set ended_at. turn_count is maintained server-side in
  // /session/message, so we don't clobber it here.
  const result = await db
    .update(sessions)
    .set({ ended_at: Date.now() })
    .where(and(eq(sessions.id, body.session_id), eq(sessions.user_id, user[0].id)))
    .returning({ id: sessions.id });

  if (result.length === 0) return c.json({ error: "session not found" }, 404);

  // P2: kick off consolidation in the background. The client gets its
  // 200 immediately; the LLM extractor call can take a few seconds.
  // consolidateSession() is idempotent and gates on turn_count/summary.
  ctx.runInBackground(
    consolidateSession(body.session_id).catch((err) =>
      console.error("consolidate error", err)
    )
  );

  return c.json({ ok: true });
});

// POST /api/public/session/message — append one raw message to the log
app.post("/api/public/session/message", async (c) => {
  const device_id = getDeviceId(c);
  if (!device_id) return c.json({ error: "missing X-Device-Id" }, 400);

  const body = await c.req
    .json<{ session_id?: string; role?: string; content?: string }>()
    .catch(() => ({} as { session_id?: string; role?: string; content?: string }));
  if (!body.session_id || !body.role || typeof body.content !== "string") {
    return c.json({ error: "session_id, role, content required" }, 400);
  }
  if (body.role !== "user" && body.role !== "assistant") {
    return c.json({ error: "role must be user|assistant" }, 400);
  }
  // Cap content length defensively — keeps one row < 10KB.
  const content = body.content.slice(0, 8000);

  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);
  if (user.length === 0) return c.json({ error: "unknown device" }, 404);

  // Verify session ownership before writing.
  const session = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, body.session_id), eq(sessions.user_id, user[0].id)))
    .limit(1);
  if (session.length === 0) return c.json({ error: "session not found" }, 404);

  await db.insert(messagesTable).values({
    id: crypto.randomUUID(),
    session_id: body.session_id,
    role: body.role,
    content,
    created_at: Date.now(),
  });

  // Increment turn_count server-side for user messages. More reliable than
  // trusting the client's tally — survives dropped keepalive on page close.
  if (body.role === "user") {
    await db.run(
      sql`UPDATE sessions SET turn_count = turn_count + 1 WHERE id = ${body.session_id}`
    );
  }

  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  P0: MiniMax chat + TTS proxies (unchanged)
// ═══════════════════════════════════════════════════════════════════

app.post("/api/public/chat", async (c) => {
  const body = await c.req.json<{
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    session_id?: string;
    lang?: string;
    last_turn?: boolean;
  }>();

  const apiUrl = vars.get("MINIMAX_API_URL") ?? DEFAULT_API_URL;
  const model = vars.get("MINIMAX_MODEL") ?? DEFAULT_MODEL;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    return c.json({ error: "missing_secret", detail: "MINIMAX_API_KEY not set" }, 500);
  }

  // ── Resolve lang ──
  const device_id = getDeviceId(c);
  const session_id = typeof body.session_id === "string" ? body.session_id : null;
  const lang: RockyLang =
    body.lang === "zh" || body.lang === "ja" || body.lang === "en" ? body.lang : "en";

  // ── Build the complete messages array server-side ──
  // 1. System prompt (character + scenario + format + lang)
  //    Memory context is appended to the same system message because
  //    MiniMax rejects system messages after user/assistant messages.
  let systemContent = getRockySystemPrompt(lang);
  if (body.last_turn) {
    systemContent += getLastTurnHint(lang);
  }

  // 1b. Memory context (P3) — append to system prompt, not as separate message
  if (device_id && session_id) {
    try {
      const userRow = await db
        .select({ id: users.id, callsign: users.callsign })
        .from(users)
        .where(eq(users.device_id, device_id))
        .limit(1);
      if (userRow.length > 0) {
        const sess = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.id, session_id), eq(sessions.user_id, userRow[0].id)))
          .limit(1);
        if (sess.length > 0) {
          const memBlock = await buildMemoryContext(userRow[0].id, lang, userRow[0].callsign);
          if (memBlock) {
            systemContent += "\n\n" + memBlock;
          }
        }
      }
    } catch (err) {
      console.warn("memory inject failed — proceeding without:", err);
    }
  }

  const outboundMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemContent },
  ];

  // 2. Few-shot examples (English only)
  const fewShots = getRockyFewShots(lang);
  for (const shot of fewShots) {
    outboundMessages.push({ role: shot.role, content: shot.content });
  }

  // 4. User/assistant chat history (raw from frontend, no system/few-shots)
  for (const msg of body.messages) {
    outboundMessages.push({ role: msg.role, content: msg.content });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: outboundMessages,
        stream: true,
        temperature: body.temperature ?? 0.55,
        top_p: body.top_p ?? 0.9,
        max_tokens: body.max_tokens ?? 1024,
      }),
    });
  } catch (err) {
    console.error("Chat upstream fetch failed:", err);
    return c.json({ error: "proxy_error" }, 502);
  }

  logHeadersOnce(chatHeaderFlag, "chat", upstream.headers);

  if (!upstream.ok) {
    const text = await upstream.text();
    if (upstream.status === 429) {
      return c.json({ error: "quota_exceeded", detail: text }, 429);
    }
    return new Response(text, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.get("/api/public/tts", async (c) => {
  const url = new URL(c.req.url);
  const text = url.searchParams.get("text")?.trim();
  if (!text) {
    return c.json({ error: "text is required" }, 400);
  }
  const speed = url.searchParams.get("speed");
  const vol = url.searchParams.get("vol");
  const pitch = url.searchParams.get("pitch");

  const apiUrl = vars.get("MINIMAX_TTS_API_URL") ?? DEFAULT_TTS_API_URL;
  const ttsModel = vars.get("MINIMAX_TTS_MODEL") ?? DEFAULT_TTS_MODEL;
  const voiceId = vars.get("MINIMAX_TTS_VOICE_ID") ?? DEFAULT_TTS_VOICE_ID;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    return c.json({ error: "missing_secret", detail: "MINIMAX_API_KEY not set" }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ttsModel,
        text,
        voice_setting: {
          voice_id: voiceId,
          speed: speed ? parseFloat(speed) : 1.0,
          vol: vol ? parseFloat(vol) : 1.0,
          pitch: pitch ? parseInt(pitch, 10) : 0,
        },
        audio_setting: {
          format: "mp3",
          sample_rate: 44100,
          bitrate: 128000,
          channel: 1,
        },
      }),
    });
  } catch (err) {
    console.error("TTS upstream fetch failed:", err);
    return c.json({ error: "proxy_error" }, 502);
  }

  logHeadersOnce(ttsHeaderFlag, "tts", upstream.headers);

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, { status: upstream.status });
  }

  const json = (await upstream.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };

  if (json.base_resp?.status_code !== 0) {
    const code = json.base_resp?.status_code;
    if (code === 1002 || code === 1008 || code === 2056) {
      return c.json({ error: "quota_exceeded", detail: json.base_resp }, 429);
    }
    return c.json({ error: json.base_resp }, 500);
  }

  const hexAudio = json.data?.audio;
  if (!hexAudio) {
    return c.json({ error: "no audio data" }, 500);
  }

  const byteLength = hexAudio.length / 2;
  const buf = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    buf[i] = parseInt(hexAudio.substr(i * 2, 2), 16);
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
    },
  });
});

export default app;
