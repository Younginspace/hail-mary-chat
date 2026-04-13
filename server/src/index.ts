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
import { messages as messagesTable, sessions, users } from "@defs";
import { and, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { consolidateSession } from "./consolidate";

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

// CORS — permissive during migration; tighten in P4+ once the custom
// domain swap happens and origins are known.
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
    credentials: false,
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
    .select({ id: users.id })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);
  let used = 0;
  if (existing.length > 0) {
    used = await getTodayUsed(existing[0].id);
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
  const used = await getTodayUsed(user_id);
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
    used: used + 1,
    remaining: DAILY_QUOTA - used - 1,
    resetAt: utc8TomorrowStartMs(),
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
  }>();

  const apiUrl = vars.get("MINIMAX_API_URL") ?? DEFAULT_API_URL;
  const model = vars.get("MINIMAX_MODEL") ?? DEFAULT_MODEL;
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) {
    return c.json({ error: "missing_secret", detail: "MINIMAX_API_KEY not set" }, 500);
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
        messages: body.messages,
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
