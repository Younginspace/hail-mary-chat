/**
 * Hail Mary Chat — Rocky proxy server.
 *
 * P0 scope: equivalent to the old Express server in `server-legacy/index.js`.
 *   - POST /api/public/chat → SSE proxy to MiniMax /v1/chat/completions
 *   - GET  /api/public/tts  → MiniMax /v1/t2a_v2, hex-decoded to audio/mpeg
 *
 * No DB, no auth, no rate limiting yet. P1+ will layer those in.
 */

import { vars, secret } from "edgespark";
import { Hono } from "hono";
import { cors } from "hono/cors";

const DEFAULT_API_URL = "https://api.minimax.chat";
const DEFAULT_MODEL = "MiniMax-M2.7";
const DEFAULT_TTS_API_URL = "https://api.minimaxi.com";
const DEFAULT_TTS_MODEL = "speech-2.8-hd";
const DEFAULT_TTS_VOICE_ID = "rocky_hailmary_v2";

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

// CORS: P0 frontend is on Vite dev (http://localhost:5173) or the old
// savemoss.com build. Permissive during migration; tighten in P4+.
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.get("/api/public/health", (c) => c.json({ ok: true, service: "hail-mary-chat" }));

// ── Chat: SSE streaming proxy ──
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

  // Stream SSE straight through. Worker keeps the connection open while the
  // upstream ReadableStream pipes into the response.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ── TTS: GET endpoint, returns binary audio/mpeg ──
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
    // 1002 rate-limit, 1008 balance, 2056 usage-limit — all treated as quota
    if (code === 1002 || code === 1008 || code === 2056) {
      return c.json({ error: "quota_exceeded", detail: json.base_resp }, 429);
    }
    return c.json({ error: json.base_resp }, 500);
  }

  const hexAudio = json.data?.audio;
  if (!hexAudio) {
    return c.json({ error: "no audio data" }, 500);
  }

  // hex → Uint8Array
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
