/**
 * Hail Mary Chat — Rocky server.
 *
 * P5 F1: forced registration. All chat / TTS / session endpoints now require
 * an authenticated session. Anonymous daily-quota logic is removed.
 *
 * Route layout:
 *   - /api/public/faqs              — Open Channel content (public, FAQ list)
 *   - /api/public/check-callsign    — Callsign availability (public, pre-register)
 *   - /api/chat                     — MiniMax chat proxy (auth required)
 *   - /api/tts                      — MiniMax TTS proxy (auth required)
 *   - /api/session/*                — Session lifecycle (auth required)
 *   - /api/me                       — Authed profile
 *   - /api/adopt-device             — Link device to auth account + set callsign
 *
 * `device_id` is still accepted by the adoption flow for legacy migration
 * (pre-F1 anon sessions keep their memories on first login). New users never
 * have an anonymous-only state.
 */

import { db, secret, vars, ctx, storage } from "edgespark";
import { auth } from "edgespark/http";
import {
  audio_cache,
  buckets,
  daily_api_usage,
  favorites,
  memories,
  messages as messagesTable,
  rapport,
  sessions,
  users,
  voice_credit_ledger,
} from "@defs";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

// SHA-256 hex of text + lang + voice_id — the cache key for rendered
// audio. Kept deterministic so the same prompt never re-renders.
async function hashAudioContent(
  text: string,
  lang: string,
  voiceId: string
): Promise<string> {
  const input = `${lang}|${voiceId}|${text}`;
  const buf = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Current date string in UTC+8 — matches the TTS quota reset boundary.
function utc8DateString(nowMs: number = Date.now()): string {
  const utc8 = new Date(nowMs + 8 * 3600 * 1000);
  return utc8.toISOString().slice(0, 10);
}

// TTS per-day cap reserved for regular user playback. Final MiniMax limit
// is 11,000/day; we leave 1,100 for F6 gift generation (tts_gift scope).
const TTS_DAILY_USER_CAP = 9900;

function getDeviceId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const raw = c.req.header("x-device-id")?.trim();
  if (!raw || raw.length > 128) return null;
  if (!/^[A-Za-z0-9._\-]{8,128}$/.test(raw)) return null;
  return raw;
}

// Resolve the primary users row for the current authed session. Returns null
// if the caller is not authenticated or hasn't adopted yet.
async function getAuthedUser(): Promise<{
  user_id: string;
  callsign: string | null;
} | null> {
  if (!auth.isAuthenticated()) return null;
  const rows = await db
    .select({ id: users.id, callsign: users.callsign })
    .from(users)
    .where(eq(users.auth_user_id, auth.user.id))
    .orderBy(asc(users.created_at))
    .limit(1);
  if (rows.length === 0) return null;
  return { user_id: rows[0].id, callsign: rows[0].callsign };
}

// Application-layer uniqueness check for callsign. Case-insensitive match.
// Optionally ignore a given auth_user_id (so a user doesn't see their own
// callsign as "taken").
async function isCallsignTaken(
  callsign: string,
  exceptAuthUserId: string | null = null
): Promise<boolean> {
  const normalized = callsign.trim();
  if (!normalized) return true; // treat blank as taken — don't allow
  const rows = await db
    .select({ auth_user_id: users.auth_user_id })
    .from(users)
    .where(sql`LOWER(${users.callsign}) = LOWER(${normalized})`);
  if (rows.length === 0) return false;
  if (exceptAuthUserId == null) return true;
  return rows.some((r) => r.auth_user_id !== exceptAuthUserId);
}

// Validate callsign format: 3-32 chars, alphanumeric + _ - space + common unicode letters.
function isValidCallsign(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const t = raw.trim();
  if (t.length < 3 || t.length > 32) return false;
  // Allow letters (any unicode), digits, underscore, hyphen, space.
  return /^[\p{L}\p{N} _\-]+$/u.test(t);
}

// ═══════════════════════════════════════════════════════════════════
//  Memory context — unchanged from P3
// ═══════════════════════════════════════════════════════════════════

const MEMORY_INJECT_TOP_N = 12;
const MEMORY_MAX_CHARS = 1800;

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

async function buildMemoryContext(
  user_id: string,
  lang: MemoryLang,
  callsign: string | null
): Promise<string | null> {
  const now = Date.now();
  const memRows = await db
    .select({
      kind: memories.kind,
      content: memories.content,
      importance: memories.importance,
    })
    .from(memories)
    .where(and(eq(memories.user_id, user_id), isNull(memories.superseded_by)))
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
//  Cross-device merge — unchanged from P4
// ═══════════════════════════════════════════════════════════════════

async function mergeUsersByAuthId(auth_user_id: string): Promise<void> {
  const allUsers = await db
    .select({ id: users.id, created_at: users.created_at })
    .from(users)
    .where(eq(users.auth_user_id, auth_user_id))
    .orderBy(asc(users.created_at));

  if (allUsers.length <= 1) return;

  const primaryId = allUsers[0].id;
  const secondaryIds = allUsers.slice(1).map((u) => u.id);

  await db.batch([
    db.update(sessions).set({ user_id: primaryId }).where(inArray(sessions.user_id, secondaryIds)),
    db.update(memories).set({ user_id: primaryId }).where(inArray(memories.user_id, secondaryIds)),
  ]);

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
      await db.insert(rapport).values({
        user_id: primaryId,
        trust: bestTrust,
        warmth: bestWarmth,
        last_mood: latestMood,
        notes: mergedNotes,
        updated_at: now,
      });
    }

    if (secondaryIds.length > 0) {
      await db.delete(rapport).where(inArray(rapport.user_id, secondaryIds));
    }
  }

  console.info(
    `merge: auth_user_id=${auth_user_id} → primary=${primaryId}, merged ${secondaryIds.length} secondary user(s)`
  );
}

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

// ═══════════════════════════════════════════════════════════════════
//  App
// ═══════════════════════════════════════════════════════════════════

const app = new Hono();

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
//  Public endpoints — no auth required
// ═══════════════════════════════════════════════════════════════════

// GET /api/public/check-callsign?q=xxx — true when available
// (Open Channel content is served directly from the web bundle —
// see web/src/utils/defaultDialogs.ts — so there is no /faqs endpoint.)
app.get("/api/public/check-callsign", async (c) => {
  const raw = c.req.query("q") ?? "";
  if (!isValidCallsign(raw)) {
    return c.json({ available: false, reason: "invalid_format" });
  }
  const taken = await isCallsignTaken(raw);
  return c.json({ available: !taken, callsign: raw.trim() });
});

// ═══════════════════════════════════════════════════════════════════
//  Device adoption — auth required
// ═══════════════════════════════════════════════════════════════════

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

  const requestedCallsign =
    typeof body.callsign === "string" && body.callsign.trim().length > 0
      ? body.callsign.trim().slice(0, 64)
      : null;

  if (requestedCallsign && !isValidCallsign(requestedCallsign)) {
    return c.json({ error: "invalid_callsign", detail: "3-32 chars, letters/numbers/spaces" }, 400);
  }
  if (requestedCallsign && (await isCallsignTaken(requestedCallsign, authUser.id))) {
    return c.json({ error: "callsign_taken", callsign: requestedCallsign }, 409);
  }

  const existing = await db
    .select({ id: users.id, auth_user_id: users.auth_user_id, callsign: users.callsign })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);

  // Decide what callsign to persist. Preserve existing value unless the
  // caller explicitly supplied a new one.
  const existingCallsign = existing[0]?.callsign ?? null;
  const resolvedCallsign =
    requestedCallsign ??
    existingCallsign ??
    authUser.email?.split("@")[0]?.slice(0, 64) ??
    "friend";

  if (existing.length === 0) {
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      device_id,
      email: authUser.email,
      callsign: resolvedCallsign,
      auth_user_id: authUser.id,
      created_at: now,
      last_seen_at: now,
      // voice_credits defaults to 10 via schema.
    });
    await db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id: id,
      delta: 10,
      reason: "register_bonus",
      session_id: null,
      created_at: now,
    });
    await mergeUsersByAuthId(authUser.id);
    const primaryRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_user_id, authUser.id))
      .orderBy(asc(users.created_at))
      .limit(1);
    const primaryId = primaryRow.length > 0 ? primaryRow[0].id : id;
    return c.json({ ok: true, user_id: primaryId, callsign: resolvedCallsign, adopted: true });
  }

  const row = existing[0];
  if (row.auth_user_id && row.auth_user_id !== authUser.id) {
    // Device is linked to a different auth account (e.g. previous user on
    // a shared browser that missed the device-id reset). Instead of hard
    // failing, create a fresh users row for this auth user with a
    // synthetic device_id so downstream getAuthedUser() works normally.
    const syntheticDeviceId = `synth-${authUser.id}-${now}`;
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      device_id: syntheticDeviceId,
      email: authUser.email,
      callsign: resolvedCallsign,
      auth_user_id: authUser.id,
      created_at: now,
      last_seen_at: now,
    });
    await db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id: id,
      delta: 10,
      reason: "register_bonus",
      session_id: null,
      created_at: now,
    });
    await mergeUsersByAuthId(authUser.id);
    const primaryRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_user_id, authUser.id))
      .orderBy(asc(users.created_at))
      .limit(1);
    const primaryId = primaryRow.length > 0 ? primaryRow[0].id : id;
    return c.json({ ok: true, user_id: primaryId, callsign: resolvedCallsign, adopted: true });
  }

  await db
    .update(users)
    .set({
      auth_user_id: authUser.id,
      email: authUser.email,
      callsign: resolvedCallsign,
      last_seen_at: now,
    })
    .where(eq(users.id, row.id));

  await mergeUsersByAuthId(authUser.id);
  const primaryRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.auth_user_id, authUser.id))
    .orderBy(asc(users.created_at))
    .limit(1);
  const primaryId = primaryRow.length > 0 ? primaryRow[0].id : row.id;
  return c.json({ ok: true, user_id: primaryId, callsign: resolvedCallsign, adopted: true });
});

app.get("/api/me", async (c) => {
  if (!auth.isAuthenticated()) {
    return c.json({ error: "not authenticated" }, 401);
  }
  const user = await getAuthedUser();
  return c.json({
    ok: true,
    email: auth.user.email,
    callsign: user?.callsign ?? null,
    adopted: user != null,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Session lifecycle — auth required
// ═══════════════════════════════════════════════════════════════════

app.post("/api/session/start", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const body = await c.req
    .json<{ lang?: string; mode?: string }>()
    .catch(() => ({} as { lang?: string; mode?: string }));
  const lang = body.lang === "zh" || body.lang === "ja" || body.lang === "en" ? body.lang : "en";
  const mode = body.mode === "voice" ? "voice" : "text";

  const session_id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    id: session_id,
    user_id: user.user_id,
    lang,
    mode,
    started_at: now,
    turn_count: 0,
  });

  return c.json({ session_id, unlimited: true });
});

app.post("/api/session/end", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const body = await c.req
    .json<{ session_id?: string }>()
    .catch(() => ({} as { session_id?: string }));
  if (!body.session_id) return c.json({ error: "missing session_id" }, 400);

  const result = await db
    .update(sessions)
    .set({ ended_at: Date.now() })
    .where(and(eq(sessions.id, body.session_id), eq(sessions.user_id, user.user_id)))
    .returning({ id: sessions.id });

  if (result.length === 0) return c.json({ error: "session not found" }, 404);

  ctx.runInBackground(
    consolidateSession(body.session_id).catch((err) =>
      console.error("consolidate error", err)
    )
  );

  return c.json({ ok: true });
});

app.post("/api/session/message", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const body = await c.req
    .json<{ session_id?: string; role?: string; content?: string }>()
    .catch(() => ({} as { session_id?: string; role?: string; content?: string }));
  if (!body.session_id || !body.role || typeof body.content !== "string") {
    return c.json({ error: "session_id, role, content required" }, 400);
  }
  if (body.role !== "user" && body.role !== "assistant") {
    return c.json({ error: "role must be user|assistant" }, 400);
  }
  const content = body.content.slice(0, 8000);

  const session = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, body.session_id), eq(sessions.user_id, user.user_id)))
    .limit(1);
  if (session.length === 0) return c.json({ error: "session not found" }, 404);

  await db.insert(messagesTable).values({
    id: crypto.randomUUID(),
    session_id: body.session_id,
    role: body.role,
    content,
    created_at: Date.now(),
  });

  if (body.role === "user") {
    await db.run(
      sql`UPDATE sessions SET turn_count = turn_count + 1 WHERE id = ${body.session_id}`
    );
  }

  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  MiniMax proxies — auth required
// ═══════════════════════════════════════════════════════════════════

app.post("/api/chat", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

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

  const session_id = typeof body.session_id === "string" ? body.session_id : null;
  const lang: RockyLang =
    body.lang === "zh" || body.lang === "ja" || body.lang === "en" ? body.lang : "en";

  let systemContent = getRockySystemPrompt(lang);
  if (body.last_turn) {
    systemContent += getLastTurnHint(lang);
  }

  // Memory context — verify session belongs to this authed user before injecting.
  if (session_id) {
    try {
      const sess = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, session_id), eq(sessions.user_id, user.user_id)))
        .limit(1);
      if (sess.length > 0) {
        const memBlock = await buildMemoryContext(user.user_id, lang, user.callsign);
        if (memBlock) {
          systemContent += "\n\n" + memBlock;
        }
      }
    } catch (err) {
      console.warn("memory inject failed — proceeding without:", err);
    }
  }

  const outboundMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemContent },
  ];
  const fewShots = getRockyFewShots(lang);
  for (const shot of fewShots) {
    outboundMessages.push({ role: shot.role, content: shot.content });
  }
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

// ═══════════════════════════════════════════════════════════════════
//  P5 F2 — /api/voice-credits  (GET balance)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/voice-credits", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);
  const row = await db
    .select({ voice_credits: users.voice_credits })
    .from(users)
    .where(eq(users.id, user.user_id))
    .limit(1);
  const remaining = row.length > 0 ? row[0].voice_credits : 0;
  return c.json({ remaining });
});

// ═══════════════════════════════════════════════════════════════════
//  P5 F3 — Favorites (capped at 100 per user)
// ═══════════════════════════════════════════════════════════════════

const FAVORITES_CAP = 100;

app.post("/api/favorites", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  type FavBody = {
    message_content?: string;
    lang?: string;
    mood?: string;
    source_session?: string;
  };
  const body: FavBody = await c.req.json<FavBody>().catch(() => ({} as FavBody));

  const content = (body.message_content ?? "").trim();
  if (!content) return c.json({ error: "content_required" }, 400);
  if (content.length > 4000) return c.json({ error: "content_too_long" }, 400);

  const lang = body.lang === "zh" || body.lang === "ja" ? body.lang : "en";
  const voiceId = vars.get("MINIMAX_TTS_VOICE_ID") ?? DEFAULT_TTS_VOICE_ID;
  const contentHash = await hashAudioContent(content, lang, voiceId);

  const countRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(favorites)
    .where(eq(favorites.user_id, user.user_id));
  const count = countRows[0]?.c ?? 0;
  if (count >= FAVORITES_CAP) {
    return c.json({ error: "favorites_full", cap: FAVORITES_CAP }, 409);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.insert(favorites).values({
      id,
      user_id: user.user_id,
      content_hash: contentHash,
      message_content: content,
      mood: body.mood ?? null,
      lang,
      source_session: body.source_session ?? null,
      created_at: now,
    });
  } catch {
    return c.json({ error: "already_favorited", content_hash: contentHash }, 409);
  }

  return c.json({ ok: true, id, content_hash: contentHash });
});

app.delete("/api/favorites/:id", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);
  const id = c.req.param("id");
  const result = await db
    .delete(favorites)
    .where(and(eq(favorites.id, id), eq(favorites.user_id, user.user_id)))
    .returning({ id: favorites.id });
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/favorites", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);
  const rows = await db
    .select()
    .from(favorites)
    .where(eq(favorites.user_id, user.user_id))
    .orderBy(desc(favorites.created_at));
  return c.json({ items: rows, cap: FAVORITES_CAP });
});

// ═══════════════════════════════════════════════════════════════════
//  P5 F2 — /api/tts  (cache-first, credit-metered, global-quota-gated)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/tts", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const url = new URL(c.req.url);
  const text = url.searchParams.get("text")?.trim();
  if (!text) {
    return c.json({ error: "text is required" }, 400);
  }
  const isFavorite = url.searchParams.get("favorite") === "true";

  const apiUrl = vars.get("MINIMAX_TTS_API_URL") ?? DEFAULT_TTS_API_URL;
  const ttsModel = vars.get("MINIMAX_TTS_MODEL") ?? DEFAULT_TTS_MODEL;
  const voiceId = vars.get("MINIMAX_TTS_VOICE_ID") ?? DEFAULT_TTS_VOICE_ID;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    return c.json({ error: "missing_secret", detail: "MINIMAX_API_KEY not set" }, 500);
  }

  // Memory context language is encoded with the system prompt, but the
  // text itself is what MiniMax renders. Use the language header the
  // frontend sends so the hash is stable across languages of the same
  // string (rare but possible for single words).
  const lang = url.searchParams.get("lang") ?? "en";

  const contentHash = await hashAudioContent(text, lang, voiceId);

  // ── 0. Favorite-aware free play ──
  // If this content is already in the user's favorites, replay is free.
  // Either the explicit ?favorite=true flag or a matching favorites row
  // is enough to skip the credit deduction.
  let freePlay = isFavorite;
  if (!freePlay) {
    const favRow = await db
      .select({ id: favorites.id })
      .from(favorites)
      .where(
        and(eq(favorites.user_id, user.user_id), eq(favorites.content_hash, contentHash))
      )
      .limit(1);
    if (favRow.length > 0) freePlay = true;
  }

  // ── 1. Try cache ──
  const cached = await db
    .select({ r2_key: audio_cache.r2_key })
    .from(audio_cache)
    .where(eq(audio_cache.content_hash, contentHash))
    .limit(1);

  if (cached.length > 0) {
    const file = await storage.from(buckets.rockyAudio).get(cached[0].r2_key);
    if (file) {
      return new Response(file.body, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(file.body.byteLength),
          "X-Audio-Cache": "hit",
        },
      });
    }
    // Cache row exists but R2 object was lost — fall through and re-render.
    console.warn(`audio_cache row hit but R2 missing for ${cached[0].r2_key}`);
  }

  // ── 2. Cache miss — charge the user (unless it's a free play) ──
  const now = Date.now();
  if (!freePlay) {
    const deducted = await db
      .update(users)
      .set({ voice_credits: sql`${users.voice_credits} - 1` })
      .where(and(eq(users.id, user.user_id), sql`${users.voice_credits} > 0`))
      .returning({ voice_credits: users.voice_credits });
    if (deducted.length === 0) {
      return c.json({ error: "insufficient_credits", remaining: 0 }, 402);
    }
    await db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id: user.user_id,
      delta: -1,
      reason: "consume_tts",
      session_id: url.searchParams.get("session_id"),
      created_at: now,
    });
  }

  // ── 3. Global daily TTS cap — atomic CAS ──
  const today = utc8DateString(now);
  const usage = await db
    .insert(daily_api_usage)
    .values({ date: today, api: "tts", scope: "__global__", count: 1, updated_at: now })
    .onConflictDoUpdate({
      target: [daily_api_usage.date, daily_api_usage.api, daily_api_usage.scope],
      set: { count: sql`${daily_api_usage.count} + 1`, updated_at: now },
      setWhere: sql`${daily_api_usage.count} < ${TTS_DAILY_USER_CAP}`,
    })
    .returning({ count: daily_api_usage.count });

  if (usage.length === 0) {
    // Global cap hit. Refund the credit so the user isn't punished for it.
    if (!freePlay) {
      await db
        .update(users)
        .set({ voice_credits: sql`${users.voice_credits} + 1` })
        .where(eq(users.id, user.user_id));
      await db.insert(voice_credit_ledger).values({
        id: crypto.randomUUID(),
        user_id: user.user_id,
        delta: 1,
        reason: "refund_global_cap",
        session_id: url.searchParams.get("session_id"),
        created_at: now,
      });
    }
    return c.json({ error: "global_quota_exceeded" }, 429);
  }

  // ── 4. Render via MiniMax ──
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
          speed: 1.0,
          vol: 1.0,
          pitch: 0,
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

  // ── 5. Persist to R2 + insert cache row (background — don't block user) ──
  const r2Key = `audio/${contentHash.slice(0, 2)}/${contentHash}.mp3`;
  ctx.runInBackground(
    (async () => {
      try {
        await storage.from(buckets.rockyAudio).put(r2Key, buf);
        await db
          .insert(audio_cache)
          .values({
            content_hash: contentHash,
            lang,
            voice_id: voiceId,
            r2_key: r2Key,
            byte_length: buf.byteLength,
            created_at: Date.now(),
          })
          .onConflictDoNothing();
      } catch (err) {
        console.warn("audio cache persist failed:", err);
      }
    })()
  );

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      "X-Audio-Cache": "miss",
    },
  });
});

export default app;
