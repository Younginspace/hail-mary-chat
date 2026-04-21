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
  consolidation_jobs,
  daily_api_usage,
  favorites,
  gifts,
  memories,
  messages as messagesTable,
  rapport,
  rapport_thresholds,
  register_rate_limit,
  sessions,
  users,
  voice_credit_ledger,
} from "@defs";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { retryStuckConsolidationJobs, runConsolidationJob } from "./consolidate";
import { getRockySystemPrompt, getRockyFewShots, getLastTurnHint } from "./prompts/rocky";
import type { GiftCredits, Lang as RockyLang } from "./prompts/rocky";

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

// ─── Bot defenses (P5 Review compensation, no Turnstile) ───

// Max new `users` rows a single IP may adopt per rolling UTC hour.
// 10 is generous for a shared dorm / household but aggressive for bots.
const REGISTER_HOURLY_CAP = 10;

// Static disposable-email blacklist. Kept tiny — these are the big ones
// that tradeshow spam scripts default to. Growable without migration.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "throwaway.email",
  "yopmail.com",
  "getnada.com",
  "sharklasers.com",
  "dispostable.com",
  "trashmail.com",
  "maildrop.cc",
  "fakeinbox.com",
  "emailondeck.com",
  "mohmal.com",
  "moakt.com",
]);

// Credits to zero out for accounts that signed up >= this many days ago
// and still have zero sessions. Defense against registered-never-used
// bot armies that might later be weaponized for TTS spam.
const IDLE_ZERO_DAYS = 7;

// Normalize an email domain so lookups catch common bypass vectors:
//  - subdomain nesting:  foo@x.mailinator.com   → check x.mailinator.com then mailinator.com
//  - uppercase:          FOO@MAILINATOR.COM     → lowercased
//  - punycode / IDN:     foo@xn--mlinator-8vd.com → toASCII form is what we stored anyway,
//                        but the lookup compares the punycode form directly; set entries
//                        should be the ASCII (punycode) form for IDN domains.
// Returns the sequence of candidate domains to probe, most-specific-first.
function disposableCandidateDomains(email: string): string[] {
  const at = email.lastIndexOf("@");
  if (at < 0) return [];
  let domain = email.slice(at + 1).trim().toLowerCase();
  // Strip a trailing dot (fully-qualified form) so "mailinator.com." matches.
  if (domain.endsWith(".")) domain = domain.slice(0, -1);
  if (!domain) return [];
  const parts = domain.split(".");
  if (parts.length < 2) return [domain];
  const candidates: string[] = [];
  // Walk from the full domain down to the registrable (last 2 labels).
  for (let i = 0; i <= parts.length - 2; i++) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const candidates = disposableCandidateDomains(email);
  for (const c of candidates) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(c)) return true;
  }
  return false;
}

function currentHourBucket(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / (1000 * 60 * 60));
}

// Return true if the IP is under its hourly register cap. Atomic CAS
// increment — falls through 0→1 insert or N→N+1 update only when
// count < cap. When cap is hit, .returning() comes back empty.
async function tryConsumeRegisterSlot(ip: string): Promise<boolean> {
  const now = Date.now();
  const bucket = currentHourBucket(now);
  const ret = await db
    .insert(register_rate_limit)
    .values({ ip, hour_bucket: bucket, count: 1, updated_at: now })
    .onConflictDoUpdate({
      target: [register_rate_limit.ip, register_rate_limit.hour_bucket],
      set: { count: sql`${register_rate_limit.count} + 1`, updated_at: now },
      setWhere: sql`${register_rate_limit.count} < ${REGISTER_HOURLY_CAP}`,
    })
    .returning({ count: register_rate_limit.count });
  return ret.length > 0;
}

// If this user signed up ≥ IDLE_ZERO_DAYS ago and still has 0 sessions,
// zero their voice_credits (if any). Fires lazily from /api/me so we
// don't need a cron. Idempotent.
async function zeroCreditsIfStale(user_id: string): Promise<void> {
  try {
    const urows = await db
      .select({ created_at: users.created_at, voice_credits: users.voice_credits })
      .from(users)
      .where(eq(users.id, user_id))
      .limit(1);
    if (urows.length === 0) return;
    const row = urows[0];
    if (row.voice_credits <= 0) return;
    const ageDays = (Date.now() - row.created_at) / (1000 * 60 * 60 * 24);
    if (ageDays < IDLE_ZERO_DAYS) return;
    const sessCount = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.user_id, user_id))
      .limit(1);
    if (sessCount.length > 0) return;
    await db
      .update(users)
      .set({ voice_credits: 0 })
      .where(eq(users.id, user_id));
    await db.insert(voice_credit_ledger).values({
      id: crypto.randomUUID(),
      user_id,
      delta: -row.voice_credits,
      reason: "idle_7day_zero",
      session_id: null,
      created_at: Date.now(),
    });
    console.info(`bot-defense: zeroed ${row.voice_credits} credits for idle user ${user_id}`);
  } catch (err) {
    // Defensive-only; never block /api/me on this.
    console.warn("zeroCreditsIfStale failed:", err);
  }
}

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
  // Guardrail: MiniMax otherwise pattern-matches short greetings ("记得我吗",
  // "hi", "are you there") against the "I'm new" few-shot and replies
  // treating the caller as a stranger. Shout the opposite at the top of
  // the memory block so the LLM doesn't fall back on the stranger script.
  lines.push(
    "IMPORTANT: THIS FRIEND IS NOT NEW. They have called before — see the facts below. Do NOT ask if they are new, do NOT say \"you said you are new\", do NOT treat their greeting as a first introduction. If they ask whether you remember them, answer YES, state their callsign, and reference at least one fact below."
  );
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
    .select({
      id: users.id,
      created_at: users.created_at,
      voice_credits: users.voice_credits,
      affinity_level: users.affinity_level,
      pending_level_up: users.pending_level_up,
      image_credits: users.image_credits,
      music_credits: users.music_credits,
      video_credits: users.video_credits,
      video_used_at: users.video_used_at,
    })
    .from(users)
    .where(eq(users.auth_user_id, auth_user_id))
    .orderBy(asc(users.created_at));

  if (allUsers.length <= 1) return;

  const primary = allUsers[0];
  const primaryId = primary.id;
  const secondaryIds = allUsers.slice(1).map((u) => u.id);

  // ── 1. Reparent child rows that reference users.id as an FK ──
  // sessions + memories (always safe — no unique constraints on user_id).
  await db.batch([
    db.update(sessions).set({ user_id: primaryId }).where(inArray(sessions.user_id, secondaryIds)),
    db.update(memories).set({ user_id: primaryId }).where(inArray(memories.user_id, secondaryIds)),
    db.update(voice_credit_ledger).set({ user_id: primaryId }).where(inArray(voice_credit_ledger.user_id, secondaryIds)),
    db.update(gifts).set({ user_id: primaryId }).where(inArray(gifts.user_id, secondaryIds)),
  ]);

  // favorites has UNIQUE(user_id, content_hash) — dedupe by keeping only
  // the primary's copy if both exist. Reparent the rest.
  const primaryHashes = new Set(
    (
      await db
        .select({ content_hash: favorites.content_hash })
        .from(favorites)
        .where(eq(favorites.user_id, primaryId))
    ).map((r) => r.content_hash)
  );
  const secondaryFavs = await db
    .select({ id: favorites.id, content_hash: favorites.content_hash })
    .from(favorites)
    .where(inArray(favorites.user_id, secondaryIds));
  const favIdsToReparent = secondaryFavs
    .filter((f) => !primaryHashes.has(f.content_hash))
    .map((f) => f.id);
  const favIdsToDelete = secondaryFavs
    .filter((f) => primaryHashes.has(f.content_hash))
    .map((f) => f.id);
  if (favIdsToReparent.length > 0) {
    await db.update(favorites).set({ user_id: primaryId }).where(inArray(favorites.id, favIdsToReparent));
  }
  if (favIdsToDelete.length > 0) {
    await db.delete(favorites).where(inArray(favorites.id, favIdsToDelete));
  }

  // ── 2. Merge rapport (best trust/warmth, latest mood, concat notes) ──
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

  // ── 3. Merge credit columns on users table INTO the primary row ──
  // Take the MAX across all rows so credits I put on a dup via raw SQL
  // (or credits granted before a merge) aren't lost.
  let maxVoice = primary.voice_credits;
  let maxAffinity = primary.affinity_level;
  let maxPending = primary.pending_level_up;
  let maxImage = primary.image_credits;
  let maxMusic = primary.music_credits;
  let maxVideo = primary.video_credits;
  let earliestVideoUsed = primary.video_used_at;
  for (const u of allUsers.slice(1)) {
    if (u.voice_credits > maxVoice) maxVoice = u.voice_credits;
    if (u.affinity_level > maxAffinity) maxAffinity = u.affinity_level;
    if ((u.pending_level_up ?? 0) > (maxPending ?? 0)) maxPending = u.pending_level_up;
    if (u.image_credits > maxImage) maxImage = u.image_credits;
    if (u.music_credits > maxMusic) maxMusic = u.music_credits;
    if (u.video_credits > maxVideo) maxVideo = u.video_credits;
    if (u.video_used_at != null && (earliestVideoUsed == null || u.video_used_at < earliestVideoUsed)) {
      earliestVideoUsed = u.video_used_at;
    }
  }
  await db
    .update(users)
    .set({
      voice_credits: maxVoice,
      affinity_level: maxAffinity,
      pending_level_up: maxPending,
      image_credits: maxImage,
      music_credits: maxMusic,
      video_credits: maxVideo,
      video_used_at: earliestVideoUsed,
    })
    .where(eq(users.id, primaryId));

  // ── 4. Delete zombie secondary user rows ──
  await db.delete(users).where(inArray(users.id, secondaryIds));

  console.info(
    `merge: auth_user_id=${auth_user_id} → primary=${primaryId}, merged+deleted ${secondaryIds.length} secondary user(s)`
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

  // ── Disposable-email blacklist. Silent reject — disposable signups
  // should see a generic rejection so scripts can't easily iterate.
  if (isDisposableEmail(authUser.email)) {
    return c.json({ error: "not_supported" }, 403);
  }

  // ── AUTH-FIRST LOOKUP: if this auth_user_id already has a row, just
  // update it. This is the idempotent path that `useAuthSession` hits
  // on every session change. Historically we keyed on device_id first,
  // which meant a new browser / cleared localStorage spawned a fresh
  // user row every time — driving the 16-dup-rows issue.
  const existingByAuth = await db
    .select({ id: users.id, callsign: users.callsign })
    .from(users)
    .where(eq(users.auth_user_id, authUser.id))
    .orderBy(asc(users.created_at))
    .limit(1);
  if (existingByAuth.length > 0) {
    const row = existingByAuth[0];
    const resolvedCallsign =
      requestedCallsign ??
      row.callsign ??
      authUser.email?.split("@")[0]?.slice(0, 64) ??
      "friend";
    await db
      .update(users)
      .set({
        device_id,
        email: authUser.email,
        callsign: resolvedCallsign,
        last_seen_at: now,
      })
      .where(eq(users.id, row.id));
    // Safety-net merge — cleans historical dups from before this fix.
    // Once the DB is clean this is effectively a no-op (<=1 row).
    await mergeUsersByAuthId(authUser.id);
    return c.json({ ok: true, user_id: row.id, callsign: resolvedCallsign, adopted: true });
  }

  // ── Legacy device_id fallback: pre-auth anon session adopting into
  // a first-time login. Only reachable when auth_user_id has ZERO rows.
  //
  // BOT DEFENSE: we're about to create a new users row. Rate-limit by
  // CF-Connecting-IP (falls back to X-Forwarded-For's first entry, then
  // 'unknown' as a shared bucket). 10/hour is gentle for humans, hard
  // stop for bot farms. Applies to both the fresh-insert branch and
  // the cross-account synthetic-device-id branch below. ──
  const ip =
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const slotOk = await tryConsumeRegisterSlot(ip);
  if (!slotOk) {
    return c.json({ error: "rate_limited", detail: "too many accounts from this source" }, 429);
  }

  const existing = await db
    .select({ id: users.id, auth_user_id: users.auth_user_id, callsign: users.callsign })
    .from(users)
    .where(eq(users.device_id, device_id))
    .limit(1);

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
  let affinity_level = 1;
  if (user) {
    const row = await db
      .select({ affinity_level: users.affinity_level })
      .from(users)
      .where(eq(users.id, user.user_id))
      .limit(1);
    affinity_level = row[0]?.affinity_level ?? 1;
    // Bot defense: lazily zero credits on idle-for-7-days accounts with
    // zero sessions. Runs in background so /api/me stays snappy.
    ctx.runInBackground(zeroCreditsIfStale(user.user_id));
  }
  return c.json({
    ok: true,
    email: auth.user.email,
    callsign: user?.callsign ?? null,
    adopted: user != null,
    affinity_level,
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

  // Atomically consume any pending level-up flag in a single CAS so two
  // concurrent /api/session/start calls (double-click, two tabs) can't
  // both ceremony the same level-up. The UPDATE ... WHERE pending_level_up
  // IS NOT NULL ... RETURNING pattern either (a) returns the cleared row
  // to the one winning caller, or (b) returns an empty array to losers.
  // Losers still need affinity_level for the response, so we fall back
  // to a plain read when the CAS misses.
  const consumed = await db
    .update(users)
    .set({ pending_level_up: null })
    .where(and(eq(users.id, user.user_id), isNotNull(users.pending_level_up)))
    .returning({
      affinity_level: users.affinity_level,
      pending_level_up: users.pending_level_up, // always null post-update; use the old via RETURNING is unavailable, so we read it via the subquery below
      image_credits: users.image_credits,
      music_credits: users.music_credits,
      video_credits: users.video_credits,
    });

  let level_up: {
    from: number;
    to: number;
    image_credits: number;
    music_credits: number;
    video_credits: number;
  } | null = null;
  let affinity_level = 1;

  if (consumed.length > 0) {
    // We won the CAS. The RETURNING row reflects post-UPDATE state, so
    // pending_level_up is already null. Read affinity_level to derive
    // the "to" target — on successful consume, affinity_level equals
    // the flag we just cleared (checkLevelUp in consolidate.ts sets both
    // affinity_level and pending_level_up to the same value).
    const row = consumed[0];
    affinity_level = row.affinity_level;
    const to = row.affinity_level;
    const from = Math.max(1, to - 1);
    level_up = {
      from,
      to,
      image_credits: row.image_credits,
      music_credits: row.music_credits,
      video_credits: row.video_credits,
    };
  } else {
    // No pending level-up, or we lost the CAS to a concurrent call.
    // Either way: do not ceremony. Read affinity_level for the response.
    const row = await db
      .select({ affinity_level: users.affinity_level })
      .from(users)
      .where(eq(users.id, user.user_id))
      .limit(1);
    affinity_level = row[0]?.affinity_level ?? 1;
  }

  await db.insert(sessions).values({
    id: session_id,
    user_id: user.user_id,
    lang,
    mode,
    started_at: now,
    turn_count: 0,
  });

  return c.json({
    session_id,
    unlimited: true,
    affinity_level,
    level_up,
  });
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

  // Wrapped in a consolidation_jobs-backed job — errors are persisted
  // as failed/pending rows rather than silently logged. No need to
  // catch here; runConsolidationJob never throws.
  ctx.runInBackground(runConsolidationJob(body.session_id));

  // Opportunistically sweep older stuck jobs while we have a warm
  // worker. Cheap (capped at 25 rows, only jobs > 10min stale).
  ctx.runInBackground(
    retryStuckConsolidationJobs().then((r) => {
      if (r.retried > 0) console.info(`retryStuck: resumed ${r.retried} job(s)`);
    })
  );

  return c.json({ ok: true });
});

app.post("/api/session/message", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const body = await c.req
    .json<{ session_id?: string; role?: string; content?: string; id?: string }>()
    .catch(() => ({} as { session_id?: string; role?: string; content?: string; id?: string }));
  if (!body.session_id || !body.role || typeof body.content !== "string") {
    return c.json({ error: "session_id, role, content required" }, 400);
  }
  if (body.role !== "user" && body.role !== "assistant") {
    return c.json({ error: "role must be user|assistant" }, 400);
  }
  const content = body.content.slice(0, 8000);

  // Require session exists, is owned by the caller, and is still open.
  // The ended_at check prevents racing /api/session/end from inserting
  // a late message that consolidation already swept past.
  const session = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, body.session_id),
        eq(sessions.user_id, user.user_id),
        isNull(sessions.ended_at)
      )
    )
    .limit(1);
  if (session.length === 0) return c.json({ error: "session not found or ended" }, 404);

  // Accept client-provided id so the same primary key flows through to
  // /api/tts?message_id=... when the client TTS's this assistant row.
  // Validate: string, reasonable length, not empty. Fallback to a fresh
  // uuid for legacy clients. onConflictDoNothing dedups retries (same
  // client sends a message twice due to a flaky network).
  const clientId =
    typeof body.id === "string" && body.id.length > 0 && body.id.length <= 64
      ? body.id
      : null;
  const rowId = clientId ?? crypto.randomUUID();

  await db
    .insert(messagesTable)
    .values({
      id: rowId,
      session_id: body.session_id,
      role: body.role,
      content,
      created_at: Date.now(),
    })
    .onConflictDoNothing();

  if (body.role === "user") {
    // Only bump turn_count if the session is still open; if /api/session/end
    // raced us after the check above, ended_at is now set and this UPDATE
    // harmlessly no-ops.
    await db.run(
      sql`UPDATE sessions SET turn_count = turn_count + 1 WHERE id = ${body.session_id} AND ended_at IS NULL`
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

  // Fetch credits so the prompt only advertises gift capabilities the
  // user can actually back. Failures are non-fatal — skip the block.
  let giftCredits: GiftCredits | undefined;
  try {
    const rows = await db
      .select({
        image: users.image_credits,
        music: users.music_credits,
        video: users.video_credits,
      })
      .from(users)
      .where(eq(users.id, user.user_id))
      .limit(1);
    if (rows.length > 0) {
      giftCredits = { image: rows[0].image, music: rows[0].music, video: rows[0].video };
    }
  } catch (err) {
    console.warn("gift credits lookup failed — chat will skip gift block:", err);
  }

  let systemContent = getRockySystemPrompt(lang, giftCredits);
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
      } else {
        // Not an error, but worth logging at info: either the session_id
        // was bogus or belonged to another user. Chat still proceeds
        // without memory context (safest). Surfacing the reason makes
        // it easier to distinguish from a true exception below.
        console.info(
          `memory inject skipped: session ${session_id} not found or not owned by ${user.user_id}`
        );
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

  if (!upstream.body) {
    return c.json({ error: "no_upstream_body" }, 502);
  }

  // ── SSE transform: strip [GIFT:type:sub? "desc"] tags out of the
  // content stream and re-emit them as a dedicated `gift_trigger`
  // SSE event. Prevents the raw tag ever rendering on the client,
  // lets us validate server-side (level, credits) before the client
  // kicks generation, and removes the client's trust-the-text
  // regex from the critical path. (P5 Review §5.) ──
  return new Response(upstream.body.pipeThrough(buildGiftStrippingTransform()), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// Runs on every /api/chat SSE stream. State is per-request — each
// call to this factory returns a fresh TransformStream.
function buildGiftStrippingTransform(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const GIFT_MARKER = "[GIFT:";
  // Anchored with lookahead for closing `]` and balanced double quotes.
  const GIFT_FULL = /\[GIFT:(image|music|video)(?::([a-z]{3,16}))?\s+"([^"]{1,500})"\]/i;

  // Running state between chunks.
  let sseBuffer = ""; // incomplete SSE line tail
  let contentHold = ""; // withheld text that might be a partial GIFT tag

  function emitGiftEvent(
    controller: TransformStreamDefaultController<Uint8Array>,
    payload: { type: string; subtype: string | null; description: string }
  ): void {
    controller.enqueue(
      encoder.encode(`event: gift_trigger\ndata: ${JSON.stringify(payload)}\n\n`)
    );
  }

  function emitContentDelta(
    controller: TransformStreamDefaultController<Uint8Array>,
    originalJson: unknown,
    deltaText: string
  ): void {
    if (!deltaText) return;
    const base = originalJson as {
      choices?: Array<{ delta?: { content?: string } }>;
      [k: string]: unknown;
    };
    const first = base.choices?.[0] ?? {};
    const synthetic = {
      ...base,
      choices: [
        {
          ...first,
          delta: { ...(first.delta ?? {}), content: deltaText },
        },
      ],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(synthetic)}\n`));
  }

  // Given an incoming text buffer, strip complete GIFT tags (emitting
  // gift_trigger events for each) and determine how much of the tail
  // may be a partial tag that must be withheld. Returns the clean
  // text to forward + the new hold.
  function processBuffer(
    buffer: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ): { emit: string; hold: string } {
    let out = "";
    let remaining = buffer;
    while (true) {
      const start = remaining.indexOf(GIFT_MARKER);
      if (start === -1) {
        // No marker. But the tail might be a prefix ("[GIF", "[GIFT" …).
        let prefixLen = 0;
        for (let k = 1; k <= Math.min(GIFT_MARKER.length, remaining.length); k++) {
          if (remaining.endsWith(GIFT_MARKER.slice(0, k))) prefixLen = k;
        }
        if (remaining.endsWith("[") && prefixLen < 1) prefixLen = 1;
        out += remaining.slice(0, remaining.length - prefixLen);
        return { emit: out, hold: prefixLen > 0 ? remaining.slice(-prefixLen) : "" };
      }
      // Emit content before the marker.
      out += remaining.slice(0, start);
      const tagCandidate = remaining.slice(start);
      const m = tagCandidate.match(GIFT_FULL);
      if (!m) {
        // Tag not yet fully received. Hold everything from marker on.
        return { emit: out, hold: tagCandidate };
      }
      // Full tag matched — emit gift_trigger, drop the tag, keep scanning.
      const [full, type, subtype, desc] = m;
      emitGiftEvent(controller, {
        type: type.toLowerCase(),
        subtype: subtype ? subtype.toLowerCase() : null,
        description: desc.trim(),
      });
      const tagEnd = start + (m.index ?? 0) + full.length;
      remaining = remaining.slice(tagEnd);
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine;
        if (line === "") {
          // Preserve blank line (SSE record separator).
          controller.enqueue(encoder.encode("\n"));
          continue;
        }
        if (line === "data: [DONE]") {
          // Flush any held text before DONE.
          if (contentHold) {
            // Hold that never became a tag — emit as plain content on a
            // synthetic chunk so the client sees the text it would
            // have otherwise missed.
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: contentHold } }],
                })}\n`
              )
            );
            contentHold = "";
          }
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        if (!line.startsWith("data: ")) {
          // Unknown directive (event:, id:, retry:) — pass through.
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(line.slice(6));
        } catch {
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        const delta = (json as { choices?: Array<{ delta?: { content?: string } }> })
          .choices?.[0]?.delta?.content ?? "";
        if (!delta) {
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        const { emit, hold } = processBuffer(contentHold + delta, controller);
        contentHold = hold;
        emitContentDelta(controller, json, emit);
      }
    },
    flush(controller) {
      // Drain any pending SSE line + held text.
      if (sseBuffer) {
        controller.enqueue(encoder.encode(sseBuffer));
        sseBuffer = "";
      }
      if (contentHold) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: contentHold } }],
            })}\n`
          )
        );
        contentHold = "";
      }
    },
  });
}

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
//  P5 F6 Phase 2 — MiniMax API probe (one-off, auth-gated)
//
//  Hits plausible endpoint paths for each generation API with a minimal
//  test prompt and returns the raw response shape. Lets us confirm
//  actual URLs, request/response formats, and async vs sync behaviour
//  before writing /api/generate-media. Any logged-in user can trigger
//  it; call ?what=image|music|lyrics|video|all (default all).
// ═══════════════════════════════════════════════════════════════════

app.get("/api/probe-minimax", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);
  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) return c.json({ error: "no_key" }, 500);

  const what = c.req.query("what") ?? "all";
  const base = "https://api.minimaxi.com";

  type ProbeResult = {
    api: string;
    url: string;
    method: string;
    status: number | null;
    ok: boolean;
    elapsed_ms: number;
    body_preview: string;
    request_body?: unknown;
    error?: string;
  };

  async function hit(api: string, url: string, body: unknown, method: "POST" | "GET" = "POST"): Promise<ProbeResult> {
    const t0 = Date.now();
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      };
      if (method === "POST") init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      const text = await res.text();
      return {
        api,
        url,
        method,
        status: res.status,
        ok: res.ok,
        elapsed_ms: Date.now() - t0,
        body_preview: text.slice(0, 2000),
        request_body: body,
      };
    } catch (err) {
      return {
        api,
        url,
        method,
        status: null,
        ok: false,
        elapsed_ms: Date.now() - t0,
        body_preview: "",
        request_body: body,
        error: String(err),
      };
    }
  }

  const tasks: Array<Promise<ProbeResult>> = [];

  if (what === "all" || what === "image") {
    tasks.push(
      hit("image-01", `${base}/v1/image_generation`, {
        model: "image-01",
        prompt: "a small red cube on a white background, studio lighting",
        aspect_ratio: "1:1",
        n: 1,
        prompt_optimizer: true,
      })
    );
  }

  if (what === "all" || what === "lyrics") {
    tasks.push(
      hit("lyrics-01", `${base}/v1/lyrics_generation`, {
        model: "lyrics-01",
        prompt: "spring sunrise over a quiet field",
      })
    );
  }

  if (what === "all" || what === "music") {
    tasks.push(
      hit("music-2.6", `${base}/v1/music_generation`, {
        model: "music-2.6",
        lyrics: "Line one a morning light\nLine two a quiet field\nLine three the sun comes up",
      })
    );
  }

  if (what === "music-cover") {
    tasks.push(
      hit("music-cover", `${base}/v1/music_cover`, {
        model: "music-cover",
        lyrics: "Line one a morning light",
        // Needs a reference audio URL or bytes — probe will likely 400 with
        // a helpful "missing field" message telling us the shape.
        refer_voice: "missing-for-probe",
      })
    );
  }

  if (what === "all" || what === "video" || what === "video-t2v") {
    tasks.push(
      hit("T2V-01", `${base}/v1/video_generation`, {
        model: "T2V-01",
        prompt: "a slow zoom over a starfield",
      })
    );
  }
  if (what === "video" || what === "video-director") {
    tasks.push(
      hit("T2V-01-Director", `${base}/v1/video_generation`, {
        model: "T2V-01-Director",
        prompt: "a slow zoom over a starfield",
      })
    );
  }
  if (what === "video" || what === "video-hailuo") {
    tasks.push(
      hit("MiniMax-Hailuo-02", `${base}/v1/video_generation`, {
        model: "MiniMax-Hailuo-02",
        prompt: "a slow zoom over a starfield",
      })
    );
  }
  if (what === "video" || what === "video-i2v") {
    tasks.push(
      hit("I2V-01", `${base}/v1/video_generation`, {
        model: "I2V-01",
        prompt: "a slow zoom",
      })
    );
  }

  // Music-cover spike (P5 plan preferred route for audio gifts).
  // Tries the MiniMax music_cover endpoint with rocky_voice_human.MP3
  // (28s, hosted at /audio/rocky_ref.wav) as the reference voice.
  // Field names vary across MiniMax docs — try several in parallel so
  // the error messages tell us which is canonical.
  if (what === "music-cover-rocky") {
    const origin = new URL(c.req.url).origin;
    const refVoiceUrl = `${origin}/audio/rocky_ref.wav`;
    const lyrics = "Friend of mine, far away star, Rocky remembers you tonight.";
    const baseBody = {
      model: "music-cover",
      lyrics,
    };
    tasks.push(
      hit("mc_refer_voice", `${base}/v1/music_cover`, {
        ...baseBody,
        refer_voice: refVoiceUrl,
      })
    );
    tasks.push(
      hit("mc_reference_voice", `${base}/v1/music_cover`, {
        ...baseBody,
        reference_voice: refVoiceUrl,
      })
    );
    tasks.push(
      hit("mc_voice_reference", `${base}/v1/music_cover`, {
        ...baseBody,
        voice_reference: refVoiceUrl,
      })
    );
    tasks.push(
      hit("mc_audio_url", `${base}/v1/music_cover`, {
        ...baseBody,
        audio_url: refVoiceUrl,
      })
    );
    tasks.push(
      hit("mc_alt_endpoint_music_cover_generation", `${base}/v1/music_cover_generation`, {
        ...baseBody,
        refer_voice: refVoiceUrl,
      })
    );
    tasks.push(
      hit("mc_on_music_generation", `${base}/v1/music_generation`, {
        model: "music-cover",
        lyrics,
        refer_voice: refVoiceUrl,
      })
    );
  }

  // Follow-up character-lock probe — earlier i2i probe tried
  // `subject_reference` with sunny.png and got 1000 unknown error. We
  // now suspect that variant IS the proper character-lock mode but it
  // rejected the sun because it isn't character-shaped. Retry with the
  // real Rocky reference hosted at /gifts/ref/.
  if (what === "image-i2i-rocky") {
    const origin = new URL(c.req.url).origin;
    const refUrl = `${origin}/gifts/ref/rocky_realistic.jpeg`;
    const baseBody = {
      model: "image-01",
      prompt: "Same character, standing in a dim spacecraft corridor with warm orange lighting, three-quarter view.",
      aspect_ratio: "1:1",
      n: 1,
      prompt_optimizer: false,
    };
    tasks.push(
      hit("rocky_subject_arr", `${base}/v1/image_generation`, {
        ...baseBody,
        subject_reference: [{ type: "character", image_url: [refUrl] }],
      })
    );
    tasks.push(
      hit("rocky_subject_str", `${base}/v1/image_generation`, {
        ...baseBody,
        subject_reference: [{ type: "character", image_url: refUrl }],
      })
    );
    tasks.push(
      hit("rocky_subject_object_single", `${base}/v1/image_generation`, {
        ...baseBody,
        subject_reference: { type: "character", image_url: [refUrl] },
      })
    );
    tasks.push(
      hit("rocky_reference_image_baseline", `${base}/v1/image_generation`, {
        ...baseBody,
        reference_image: refUrl,
      })
    );
  }

  // image-01 img2img probe — we need the model to accept a reference
  // image so Rocky gifts stay on-character (plan Type C: Rocky holding
  // a sign, Type A: Rocky selfie). Documented field names differ across
  // MiniMax versions — try every plausible shape in parallel and let
  // the error messages tell us which is canonical.
  if (what === "image-i2i") {
    const refUrl = "https://ssl.gstatic.com/onebox/weather/64/sunny.png";
    const baseBody = {
      model: "image-01",
      prompt: "the sun wearing sunglasses, same subject",
      aspect_ratio: "1:1",
      n: 1,
      prompt_optimizer: true,
    };
    tasks.push(
      hit("i2i_subject_reference_arr", `${base}/v1/image_generation`, {
        ...baseBody,
        subject_reference: [{ type: "character", image_url: [refUrl] }],
      })
    );
    tasks.push(
      hit("i2i_subject_reference_url_str", `${base}/v1/image_generation`, {
        ...baseBody,
        subject_reference: [{ type: "character", image_url: refUrl }],
      })
    );
    tasks.push(
      hit("i2i_reference_image", `${base}/v1/image_generation`, {
        ...baseBody,
        reference_image: refUrl,
      })
    );
    tasks.push(
      hit("i2i_image_url", `${base}/v1/image_generation`, {
        ...baseBody,
        image_url: refUrl,
      })
    );
    tasks.push(
      hit("i2i_init_image", `${base}/v1/image_generation`, {
        ...baseBody,
        init_image: refUrl,
      })
    );
    tasks.push(
      hit("i2i_first_frame_image", `${base}/v1/image_generation`, {
        ...baseBody,
        first_frame_image: refUrl,
      })
    );
    tasks.push(
      hit("i2i_image_edit_endpoint", `${base}/v1/image_edit`, {
        ...baseBody,
        image_url: refUrl,
      })
    );
  }

  // Vision retry — focused set after the first pass. M2.7 got a 529
  // (overloaded, not a capability answer) so we retry it; abab6.5 family
  // definitively said "not support img" so they're excluded here. Added
  // MiniMax-VL-* + abab7 candidates.
  if (what === "vision-retry") {
    const testImageUrl = "https://ssl.gstatic.com/onebox/weather/64/sunny.png";
    const multimodalBody = (model: string) => ({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What do you see in this image? One short sentence." },
            { type: "image_url", image_url: { url: testImageUrl } },
          ],
        },
      ],
      max_tokens: 80,
    });
    const chatBase = "https://api.minimax.chat";
    tasks.push(hit("v_M2.7_retry1", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-M2.7")));
    tasks.push(hit("v_M2.7_retry2", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-M2.7")));
    tasks.push(hit("v_VL-01", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-VL-01")));
    tasks.push(hit("v_VL", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-VL")));
    tasks.push(hit("v_abab7-chat", `${chatBase}/v1/chat/completions`, multimodalBody("abab7-chat")));
    tasks.push(hit("v_abab7-preview", `${chatBase}/v1/chat/completions`, multimodalBody("abab7-preview")));
    tasks.push(hit("v_MiniMax-M1", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-M1")));
  }

  // Multimodal vision — can Rocky "see" an image the user attaches?
  // Try the current chat model plus a handful of candidate vision models.
  if (what === "vision") {
    const testImageUrl =
      "https://teaching-collie-6315.edgespark.app/rocky.glb.png".length > 0
        ? "https://ssl.gstatic.com/onebox/weather/64/sunny.png"
        : "https://ssl.gstatic.com/onebox/weather/64/sunny.png";
    const multimodalBody = (model: string) => ({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What do you see in this image? One short sentence." },
            { type: "image_url", image_url: { url: testImageUrl } },
          ],
        },
      ],
      max_tokens: 80,
    });
    const chatBase = "https://api.minimax.chat";
    tasks.push(hit("vision_M2.7", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-M2.7")));
    tasks.push(hit("vision_abab6.5-chat", `${chatBase}/v1/chat/completions`, multimodalBody("abab6.5-chat")));
    tasks.push(hit("vision_abab6.5s-chat", `${chatBase}/v1/chat/completions`, multimodalBody("abab6.5s-chat")));
    tasks.push(hit("vision_abab6.5g-chat", `${chatBase}/v1/chat/completions`, multimodalBody("abab6.5g-chat")));
    tasks.push(hit("vision_MiniMax-Text-01", `${chatBase}/v1/chat/completions`, multimodalBody("MiniMax-Text-01")));
  }

  // Lyrics variants — the first probe returned generic "invalid params"
  // so the schema is wrong. Try a few more shapes.
  if (what === "lyrics-alt") {
    tasks.push(
      hit("lyrics_gen_prompt_only", `${base}/v1/lyrics_generation`, {
        prompt: "spring sunrise over a quiet field",
      })
    );
    tasks.push(
      hit("lyrics_gen_seed_lyrics", `${base}/v1/lyrics_generation`, {
        seed_lyrics: "spring sunrise over a quiet field",
      })
    );
    tasks.push(
      hit("lyrics_gen_refer", `${base}/v1/lyrics_generation`, {
        model: "lyrics-01",
        refer_voice: "",
        prompt: "spring sunrise over a quiet field",
      })
    );
  }

  const results = await Promise.all(tasks);
  return c.json({ results, note: "what=all by default. Use ?what=image|music|lyrics|video|music-cover to isolate." });
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

  const id = crypto.randomUUID();
  const now = Date.now();

  // Atomic cap enforcement: INSERT ... SELECT ... WHERE count < cap. A
  // prior non-atomic read-then-insert allowed two concurrent calls to
  // both see count=99, both insert, and land on 101 rows. This form
  // rejects the second concurrent insert at the SQL layer.
  //
  // D1/SQLite doesn't let us directly express "INSERT ... WHERE
  // subquery" in Drizzle, so we fall back to a raw statement. The
  // UNIQUE(user_id, content_hash) index still catches the dup case.
  let inserted = false;
  try {
    const ret = await db.run(
      sql`INSERT INTO favorites (id, user_id, content_hash, message_content, mood, lang, source_session, created_at)
          SELECT ${id}, ${user.user_id}, ${contentHash}, ${content}, ${body.mood ?? null}, ${lang}, ${body.source_session ?? null}, ${now}
          WHERE (SELECT count(*) FROM favorites WHERE user_id = ${user.user_id}) < ${FAVORITES_CAP}`
    );
    // D1's run() result shape varies; treat any positive change as success.
    const meta = (ret as unknown as { meta?: { changes?: number }; rowsAffected?: number }) ?? {};
    const changes = meta.meta?.changes ?? meta.rowsAffected ?? 0;
    inserted = changes > 0;
  } catch {
    // UNIQUE violation — already favorited.
    return c.json({ error: "already_favorited", content_hash: contentHash }, 409);
  }

  if (!inserted) {
    // No rows changed → cap hit (or race loser). Re-check to distinguish.
    const countRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(favorites)
      .where(eq(favorites.user_id, user.user_id));
    const count = countRows[0]?.c ?? 0;
    if (count >= FAVORITES_CAP) {
      return c.json({ error: "favorites_full", cap: FAVORITES_CAP }, 409);
    }
    // Shouldn't happen, but surface rather than silently succeed.
    return c.json({ error: "insert_failed" }, 500);
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

// Best-effort backfill: UPDATE messages SET tts_content_hash = ? WHERE id = ?.
// Retries once after 1s if the message row hasn't been inserted yet —
// /api/session/message and this /api/tts call race in the client on every
// assistant turn. After two misses we accept the trace link is lost and
// move on. Runs in ctx.runInBackground, so it never blocks the audio
// response. ~5% rows will still slip through under heavy concurrent
// /api/session/end races; good enough for the analytics use-case.
//
// Ownership gate (sessions.user_id = userId) stops a caller forging a
// tts_content_hash on another user's assistant row by guessing its id.
async function linkMessageTts(
  messageId: string,
  contentHash: string,
  userId: string,
): Promise<void> {
  for (const delayMs of [0, 1000]) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const result = await db
        .update(messagesTable)
        .set({ tts_content_hash: contentHash })
        .where(
          and(
            eq(messagesTable.id, messageId),
            eq(messagesTable.role, "assistant"),
            sql`${messagesTable.session_id} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.user_id} = ${userId})`,
          ),
        )
        .returning({ id: messagesTable.id });
      if (result.length > 0) return;
    } catch (err) {
      console.warn(`linkMessageTts update failed (${delayMs}ms):`, err);
      return;
    }
  }
  // Not found after retry — row never made it, id mismatched, or it's
  // not owned by this user. Silent.
}

app.get("/api/tts", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const url = new URL(c.req.url);
  const text = url.searchParams.get("text")?.trim();
  if (!text) {
    return c.json({ error: "text is required" }, 400);
  }
  const isFavorite = url.searchParams.get("favorite") === "true";
  const messageId = url.searchParams.get("message_id")?.trim() || null;

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
      if (messageId) ctx.runInBackground(linkMessageTts(messageId, contentHash, user.user_id));
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
  if (messageId) ctx.runInBackground(linkMessageTts(messageId, contentHash, user.user_id));

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      "X-Audio-Cache": "miss",
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
//  P5 F6 Phase 2 — Media gift generation
//
//  Triggered by a [GIFT:image|music "desc"] tag in Rocky's reply.
//  Image  → requires affinity_level ≥ 2 + image_credits > 0
//  Music  → requires affinity_level ≥ 3 + music_credits > 0
//  Video is NOT wired here yet (needs two-step image-01 → I2V-01
//  async + Hailuo daily_global_locks CAS + 48h SLA fallback).
// ═══════════════════════════════════════════════════════════════════

const MINIMAX_SYNC_API = "https://api.minimaxi.com";
const GIFT_URL_TTL_SECS = 3600 * 24 * 7; // 7 days — long enough for a chat bubble to survive a reload

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const byteLength = hex.length / 2;
  const out = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// Subtypes supported for image gifts. Each maps to a public reference
// image at /gifts/ref/<file> served by the Worker's asset handler,
// passed to MiniMax image-01 via `reference_image` so the generated
// output sits in a consistent Rocky visual universe.
const IMAGE_REF_FILE: Record<string, string> = {
  realistic: "/gifts/ref/rocky_realistic.jpeg",
  comic: "/gifts/ref/rocky_comic1.jpeg",
};

// Style prompts prepended to the scene description. Locked tightly to
// the reference image — these are defensive prompts meant to keep the
// character on-model and suppress spurious text/watermarks/signatures
// the model sometimes hallucinates when a reference image is provided.
const IMAGE_NEGATIVE =
  "STRICT NEGATIVES: no text, no letters, no words, no numbers, no captions, no subtitles, no signatures, no watermarks, no logos, no handwriting, no UI, no frames, no borders. The output must contain zero visible characters of any kind.";

const IMAGE_STYLE_PROMPT: Record<string, string> = {
  realistic: [
    "CHARACTER LOCK: the subject is the exact same rock-segmented alien creature shown in the reference image — same brown/tan stone body, blue-green mineral streaks, chunky multi-segment limbs, no face, no eyes, no mouth. Preserve the creature's anatomy and proportions from the reference exactly; only the pose and environment may change to match the scene description.",
    "STYLE LOCK: photo-realistic 3D sculpture render, matte stone texture, soft studio-like lighting, shallow depth of field.",
    IMAGE_NEGATIVE,
    "SCENE:",
  ].join(" "),
  comic: [
    "CHARACTER LOCK: Rocky is rendered as the same rock-segmented alien creature from the reference — brown/tan stone body, teal mineral patches, chunky limbs, no face. Anatomy matches reference.",
    "STYLE LOCK: hand-drawn watercolor on textured cream paper, loose ink line-art, gentle pencil shading, soft earth-tone palette. The whole composition must look like a casual sketch drawn by Rocky on a piece of paper — naive, warm, friendly.",
    IMAGE_NEGATIVE,
    "SUBJECT OF THE DRAWING:",
  ].join(" "),
};

app.post("/api/generate-media", async (c) => {
  const authed = await getAuthedUser();
  if (!authed) return c.json({ error: "not_authenticated" }, 401);
  const userId = authed.user_id;

  const body = await c.req.json<{
    type?: unknown;
    subtype?: unknown;
    description?: unknown;
    session_id?: unknown;
  }>();

  const type = body.type;
  if (type !== "image" && type !== "music") {
    return c.json({ error: "invalid_type" }, 400);
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length < 4 || description.length > 500) {
    return c.json({ error: "invalid_description" }, 400);
  }
  // Subtype is required for image gifts (we no longer support free-form
  // image generation without a reference style).
  let subtype: string | null = null;
  if (type === "image") {
    const raw = typeof body.subtype === "string" ? body.subtype.trim().toLowerCase() : "";
    if (!(raw in IMAGE_REF_FILE)) {
      return c.json({ error: "invalid_subtype", accepted: Object.keys(IMAGE_REF_FILE) }, 400);
    }
    subtype = raw;
  }
  const sessionId = typeof body.session_id === "string" && body.session_id.length > 0 ? body.session_id : null;

  const apiKey = secret.get("MINIMAX_API_KEY");
  if (!apiKey) return c.json({ error: "missing_secret" }, 500);

  // ── 1. CAS decrement (level gate + credit check in one round trip) ──
  const minLevel = type === "image" ? 2 : 3;
  const deducted =
    type === "image"
      ? await db
          .update(users)
          .set({ image_credits: sql`${users.image_credits} - 1` })
          .where(
            and(
              eq(users.id, userId),
              sql`${users.affinity_level} >= ${minLevel}`,
              sql`${users.image_credits} > 0`
            )
          )
          .returning({ remaining: users.image_credits })
      : await db
          .update(users)
          .set({ music_credits: sql`${users.music_credits} - 1` })
          .where(
            and(
              eq(users.id, userId),
              sql`${users.affinity_level} >= ${minLevel}`,
              sql`${users.music_credits} > 0`
            )
          )
          .returning({ remaining: users.music_credits });

  if (deducted.length === 0) {
    return c.json({ error: "insufficient_credit_or_level", type, min_level: minLevel }, 402);
  }

  // Refund helper — used whenever downstream work fails AFTER the CAS
  // succeeded. Credits that disappear into thin air are the worst
  // class of support ticket so this path must be bulletproof.
  async function refund(reason: string): Promise<void> {
    try {
      if (type === "image") {
        await db
          .update(users)
          .set({ image_credits: sql`${users.image_credits} + 1` })
          .where(eq(users.id, userId));
      } else {
        await db
          .update(users)
          .set({ music_credits: sql`${users.music_credits} + 1` })
          .where(eq(users.id, userId));
      }
    } catch (err) {
      console.error(`refund failed (${reason}):`, err);
    }
  }

  // ── 2. Call MiniMax ──
  let bytes: Uint8Array;
  let contentType: string;
  let ext: string;

  try {
    if (type === "image") {
      // For realistic subtype the description is "scene | caption" —
      // only feed the scene portion to MiniMax. For comic, the whole
      // description is the scene (caption is fixed client-side).
      const scene =
        subtype === "realistic" && description.includes("|")
          ? description.split("|")[0].trim()
          : description;
      const stylePrefix = subtype ? IMAGE_STYLE_PROMPT[subtype] : "";
      const prompt = stylePrefix ? `${stylePrefix} ${scene}` : scene;
      const origin = new URL(c.req.url).origin;
      const refUrl = subtype ? `${origin}${IMAGE_REF_FILE[subtype]}` : undefined;

      const upstream = await fetch(`${MINIMAX_SYNC_API}/v1/image_generation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "image-01",
          prompt,
          aspect_ratio: "1:1",
          n: 1,
          // Off — optimizer rewrites our explicit style/negative locks
          // and drifts away from the reference. Keep our prompt verbatim.
          prompt_optimizer: false,
          ...(refUrl ? { reference_image: refUrl } : {}),
        }),
      });
      if (!upstream.ok) {
        const errText = await upstream.text();
        console.warn("image_generation non-ok:", upstream.status, errText.slice(0, 400));
        await refund("image_api_not_ok");
        return c.json({ error: "minimax_failed", status: upstream.status }, 502);
      }
      const json = (await upstream.json()) as {
        data?: { image_urls?: string[] };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      if (json.base_resp?.status_code !== 0) {
        console.warn("image_generation base_resp not 0:", json.base_resp);
        await refund("image_base_resp_nonzero");
        return c.json({ error: "minimax_rejected", detail: json.base_resp }, 502);
      }
      const ossUrl = json.data?.image_urls?.[0];
      if (!ossUrl) {
        await refund("image_no_url");
        return c.json({ error: "minimax_no_url" }, 502);
      }
      // MiniMax OSS URLs expire after ~7 days — mirror immediately.
      const ossRes = await fetch(ossUrl);
      if (!ossRes.ok) {
        await refund("oss_fetch_failed");
        return c.json({ error: "oss_fetch_failed", status: ossRes.status }, 502);
      }
      const ab = await ossRes.arrayBuffer();
      bytes = new Uint8Array(ab);
      // MiniMax serves image as JPEG in most cases; trust the Content-Type
      // but fall back to a safe default that browsers will sniff.
      contentType = ossRes.headers.get("Content-Type") ?? "image/jpeg";
      ext = contentType.includes("png") ? "png" : "jpg";
    } else {
      // music-2.6 needs a `lyrics` field. We use the description as
      // lyrical prompt so the model has melodic material to sing over.
      // Pure-BGM output via a different model (or ffmpeg mixing) is a
      // v2 follow-up per plan.
      const upstream = await fetch(`${MINIMAX_SYNC_API}/v1/music_generation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "music-2.6",
          lyrics: description,
        }),
      });
      if (!upstream.ok) {
        const errText = await upstream.text();
        console.warn("music_generation non-ok:", upstream.status, errText.slice(0, 400));
        await refund("music_api_not_ok");
        return c.json({ error: "minimax_failed", status: upstream.status }, 502);
      }
      const json = (await upstream.json()) as {
        data?: { audio?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      if (json.base_resp?.status_code !== 0) {
        console.warn("music_generation base_resp not 0:", json.base_resp);
        await refund("music_base_resp_nonzero");
        return c.json({ error: "minimax_rejected", detail: json.base_resp }, 502);
      }
      const hex = json.data?.audio;
      if (!hex) {
        await refund("music_no_audio");
        return c.json({ error: "minimax_no_audio" }, 502);
      }
      bytes = hexToBytes(hex);
      contentType = "audio/mpeg";
      ext = "mp3";
    }
  } catch (err) {
    console.error("generate-media upstream error:", err);
    await refund("exception");
    return c.json({ error: "proxy_error" }, 502);
  }

  // ── 3. Persist to R2 ──
  const hash = await sha256HexBytes(bytes);
  const r2Key = `gift/${type}/${hash.slice(0, 2)}/${hash}.${ext}`;
  try {
    await storage.from(buckets.rockyAudio).put(r2Key, bytes);
  } catch (err) {
    console.error("R2 put failed:", err);
    await refund("r2_put_failed");
    return c.json({ error: "storage_failed" }, 500);
  }

  // ── 4. Record gift + return presigned URL ──
  const giftId = crypto.randomUUID();
  const now = Date.now();
  // For realistic subtype, extract the caption (right of `|`) so the
  // client can overlay it at render time. Comic subtype's caption is
  // a fixed localized string injected client-side.
  let caption: string | null = null;
  if (subtype === "realistic" && description.includes("|")) {
    const raw = description.split("|").slice(1).join("|").trim();
    if (raw) caption = raw.slice(0, 40);
  }
  await db.insert(gifts).values({
    id: giftId,
    user_id: userId,
    type,
    subtype,
    description,
    r2_key: r2Key,
    r2_bucket: "rocky-audio",
    source_session: sessionId,
    status: "ready",
    error: null,
    created_at: now,
    updated_at: now,
  });

  // Track daily API usage (telemetry only — no enforcement until we
  // observe real volumes; plan allows 120/day image, 100/day music).
  const today = utc8DateString(now);
  ctx.runInBackground(
    (async () => {
      try {
        await db
          .insert(daily_api_usage)
          .values({ date: today, api: type, scope: "__global__", count: 1, updated_at: now })
          .onConflictDoUpdate({
            target: [daily_api_usage.date, daily_api_usage.api, daily_api_usage.scope],
            set: { count: sql`${daily_api_usage.count} + 1`, updated_at: now },
          });
      } catch (err) {
        console.warn("daily_api_usage increment failed:", err);
      }
    })()
  );

  const { downloadUrl, expiresAt } = await storage
    .from(buckets.rockyAudio)
    .createPresignedGetUrl(r2Key, GIFT_URL_TTL_SECS);

  return c.json({
    id: giftId,
    type,
    subtype,
    status: "ready",
    url: downloadUrl,
    expires_at: expiresAt.getTime(),
    content_type: contentType,
    caption,
    remaining: deducted[0].remaining,
  });
});

// List this user's gifts (newest first) with fresh presigned URLs so
// the client can re-render old gifts after a reload without needing
// to hit /api/generate-media again.
app.get("/api/gifts", async (c) => {
  const user = await getAuthedUser();
  if (!user) return c.json({ error: "not_authenticated" }, 401);

  const rows = await db
    .select({
      id: gifts.id,
      type: gifts.type,
      subtype: gifts.subtype,
      description: gifts.description,
      r2_key: gifts.r2_key,
      status: gifts.status,
      created_at: gifts.created_at,
    })
    .from(gifts)
    .where(eq(gifts.user_id, user.user_id))
    .orderBy(desc(gifts.created_at))
    .limit(200);

  const out = await Promise.all(
    rows.map(async (r) => {
      if (r.status !== "ready" || !r.r2_key) {
        return { ...r, url: null };
      }
      try {
        const { downloadUrl } = await storage
          .from(buckets.rockyAudio)
          .createPresignedGetUrl(r.r2_key, GIFT_URL_TTL_SECS);
        return { ...r, url: downloadUrl };
      } catch (err) {
        console.warn(`presign failed for gift ${r.id}:`, err);
        return { ...r, url: null };
      }
    })
  );

  return c.json({ gifts: out });
});

// ═══════════════════════════════════════════════════════════════════
//  Admin endpoints — gated by X-Admin-Token == secret ADMIN_TOKEN
//
//  (P5 Review §7 consolidation retry + rapport threshold recalibration)
// ═══════════════════════════════════════════════════════════════════

function isAdmin(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const expected = secret.get("ADMIN_TOKEN");
  if (!expected) return false;
  const got = c.req.header("x-admin-token")?.trim();
  if (!got) return false;
  // Constant-time compare. Do NOT early-return on length mismatch —
  // that leaks the token length via timing. Pad `got` to the expected
  // length (with a sentinel that can never match expected's own chars
  // is not needed since the length-XOR below catches any mismatch) and
  // fold the length difference into the same XOR accumulator, so total
  // wall time is length-independent across mismatched-length inputs.
  const pad = "\u0000".repeat(Math.max(0, expected.length - got.length));
  const padded = (got + pad).slice(0, expected.length);
  let diff = expected.length ^ got.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ padded.charCodeAt(i);
  }
  return diff === 0;
}

// Manually retry stuck consolidation jobs. Returns how many were kicked.
app.post("/api/admin/retry-consolidation", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const url = new URL(c.req.url);
  const olderThanMs = Math.max(0, Number(url.searchParams.get("older_than_ms") ?? 0)) || 10 * 60 * 1000;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 0)) || 25);
  const result = await retryStuckConsolidationJobs(olderThanMs, limit);
  return c.json({ ok: true, ...result });
});

// Dead-letter inspection — list failed consolidation jobs.
app.get("/api/admin/consolidation-failed", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const rows = await db
    .select()
    .from(consolidation_jobs)
    .where(eq(consolidation_jobs.status, "failed"))
    .orderBy(desc(consolidation_jobs.updated_at))
    .limit(100);
  return c.json({ failed: rows });
});

// Compute current rapport distribution + proposed thresholds.
// Plan: Lv2 = P50, Lv3 = P75, Lv4 = P95 (using trust as the primary
// percentile; warmth thresholds follow the same split of warmth).
// DOES NOT apply — admin reviews and then POSTs the recalibrate call.
app.get("/api/admin/rapport-percentiles", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const rows = await db
    .select({ trust: rapport.trust, warmth: rapport.warmth })
    .from(rapport);
  if (rows.length === 0) {
    return c.json({ sample_size: 0, warning: "no rapport rows yet" });
  }
  const trusts = rows.map((r) => r.trust).sort((a, b) => a - b);
  const warmths = rows.map((r) => r.warmth).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => {
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)));
    return arr[idx];
  };
  const trustP = { p50: pct(trusts, 0.5), p75: pct(trusts, 0.75), p95: pct(trusts, 0.95) };
  const warmthP = { p50: pct(warmths, 0.5), p75: pct(warmths, 0.75), p95: pct(warmths, 0.95) };
  const current = await db.select().from(rapport_thresholds);
  return c.json({
    sample_size: rows.length,
    warning:
      rows.length < 500
        ? `Sample size ${rows.length} < 500 — plan says wait for more data before recalibrating.`
        : null,
    trust_percentiles: trustP,
    warmth_percentiles: warmthP,
    proposed: [
      { level: 2, trust_min: trustP.p50, warmth_min: warmthP.p50, combinator: "OR" },
      { level: 3, trust_min: trustP.p75, warmth_min: warmthP.p75, combinator: "AND" },
      { level: 4, trust_min: trustP.p95, warmth_min: warmthP.p95, combinator: "AND" },
    ],
    current,
  });
});

// Apply thresholds. Body: { levels: [{ level, trust_min, warmth_min, combinator }] }.
// No auto-run — admin inspects /rapport-percentiles, then POSTs the payload
// they want applied. Logs to console. Does NOT demote existing users.
app.post("/api/admin/rapport-recalibrate", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<{ levels?: Array<{ level?: number; trust_min?: number; warmth_min?: number; combinator?: string }> }>()
    .catch(() => ({} as { levels?: unknown }));
  const levels = Array.isArray(body.levels) ? body.levels : [];
  const applied: Array<{ level: number; trust_min: number; warmth_min: number; combinator: string }> = [];
  for (const row of levels) {
    const level = Number(row.level);
    if (!Number.isInteger(level) || level < 2 || level > 4) continue;
    const trust_min = Number(row.trust_min);
    const warmth_min = Number(row.warmth_min);
    const combinator = row.combinator === "AND" || row.combinator === "OR" ? row.combinator : null;
    if (!Number.isFinite(trust_min) || !Number.isFinite(warmth_min) || !combinator) continue;
    if (trust_min < 0 || trust_min > 1 || warmth_min < 0 || warmth_min > 1) continue;
    await db
      .insert(rapport_thresholds)
      .values({ level, trust_min, warmth_min, combinator })
      .onConflictDoUpdate({
        target: rapport_thresholds.level,
        set: { trust_min, warmth_min, combinator },
      });
    applied.push({ level, trust_min, warmth_min, combinator });
    console.info(
      `rapport_threshold lv${level}: trust≥${trust_min.toFixed(3)} ${combinator} warmth≥${warmth_min.toFixed(3)}`
    );
  }
  return c.json({ ok: true, applied });
});

// Browse audio_cache for spot-checking what MiniMax TTS has rendered.
// Returns rows newest-first with presigned R2 download URLs (1h TTL).
// Joins favorites so rows that anyone favorited come back with the text;
// for the rest you'll see only the hash and have to download + listen.
//
// Filters: ?lang=zh|en|ja  ?limit=50 (max 200)  ?offset=0
// Usage:
//   curl -H "X-Admin-Token: $TOKEN" \
//        "https://<host>/api/admin/audio-cache?limit=100&lang=zh"
app.get("/api/admin/audio-cache", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const url = new URL(c.req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const langFilter = url.searchParams.get("lang");

  const rowsQ = db
    .select({
      content_hash: audio_cache.content_hash,
      lang: audio_cache.lang,
      voice_id: audio_cache.voice_id,
      r2_key: audio_cache.r2_key,
      byte_length: audio_cache.byte_length,
      created_at: audio_cache.created_at,
    })
    .from(audio_cache)
    .orderBy(desc(audio_cache.created_at))
    .limit(limit)
    .offset(offset);
  const rows = langFilter
    ? await rowsQ.where(eq(audio_cache.lang, langFilter))
    : await rowsQ;

  // Best-effort text via favorites.content_hash.
  const hashes = rows.map((r) => r.content_hash);
  const favs = hashes.length > 0
    ? await db
        .select({
          content_hash: favorites.content_hash,
          message_content: favorites.message_content,
        })
        .from(favorites)
        .where(inArray(favorites.content_hash, hashes))
    : [];
  const textByHash = new Map<string, string>();
  for (const f of favs) textByHash.set(f.content_hash, f.message_content);

  const items = await Promise.all(
    rows.map(async (r) => {
      const { downloadUrl } = await storage
        .from(buckets.rockyAudio)
        .createPresignedGetUrl(r.r2_key, 3600);
      return {
        content_hash: r.content_hash,
        lang: r.lang,
        voice_id: r.voice_id,
        byte_length: r.byte_length,
        created_at: r.created_at,
        text: textByHash.get(r.content_hash) ?? null,
        download_url: downloadUrl,
      };
    })
  );

  const totalQ = db
    .select({ n: sql<number>`count(*)`.as("n") })
    .from(audio_cache);
  const totalRow = langFilter
    ? await totalQ.where(eq(audio_cache.lang, langFilter))
    : await totalQ;

  return c.json({
    total: totalRow[0]?.n ?? 0,
    limit,
    offset,
    items,
  });
});

// Browse messages with the full trace chain attached:
//   message.text
//   → tts_audio (if voiced) via tts_content_hash → audio_cache → R2
//   → favorited flag (favorites.content_hash match)
//   → prior user message in same session (what question triggered this)
//
// Filters:
//   ?session_id=<uuid>   — single session (sorted by created_at)
//   ?user_id=<uuid>      — all sessions for a user
//   ?limit / ?offset
//   ?role=assistant|user — filter by role
//
// Example:
//   curl -H "X-Admin-Token: $TOKEN" \
//     "https://<host>/api/admin/messages?session_id=<id>&limit=200"
app.get("/api/admin/messages", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
  const url = new URL(c.req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const sessionFilter = url.searchParams.get("session_id");
  const userFilter = url.searchParams.get("user_id");
  const roleFilter = url.searchParams.get("role");

  // Build the WHERE from the provided filters.
  const wheres = [];
  if (sessionFilter) wheres.push(eq(messagesTable.session_id, sessionFilter));
  if (roleFilter === "user" || roleFilter === "assistant") {
    wheres.push(eq(messagesTable.role, roleFilter));
  }

  // user_id filter needs a join through sessions.
  let msgs;
  if (userFilter) {
    const joinQ = db
      .select({
        id: messagesTable.id,
        session_id: messagesTable.session_id,
        role: messagesTable.role,
        content: messagesTable.content,
        created_at: messagesTable.created_at,
        tts_content_hash: messagesTable.tts_content_hash,
        user_id: sessions.user_id,
      })
      .from(messagesTable)
      .innerJoin(sessions, eq(messagesTable.session_id, sessions.id))
      .orderBy(desc(messagesTable.created_at))
      .limit(limit)
      .offset(offset);
    msgs = await joinQ.where(and(eq(sessions.user_id, userFilter), ...wheres));
  } else {
    const baseQ = db
      .select({
        id: messagesTable.id,
        session_id: messagesTable.session_id,
        role: messagesTable.role,
        content: messagesTable.content,
        created_at: messagesTable.created_at,
        tts_content_hash: messagesTable.tts_content_hash,
      })
      .from(messagesTable)
      .orderBy(sessionFilter ? asc(messagesTable.created_at) : desc(messagesTable.created_at))
      .limit(limit)
      .offset(offset);
    msgs =
      wheres.length > 0
        ? await baseQ.where(wheres.length === 1 ? wheres[0] : and(...wheres))
        : await baseQ;
  }
  if (msgs.length === 0) {
    return c.json({ items: [], limit, offset });
  }

  // Pull audio_cache + favorites rows in one batch per table.
  const hashes = Array.from(
    new Set(msgs.map((m) => m.tts_content_hash).filter((h): h is string => !!h))
  );
  const caches = hashes.length > 0
    ? await db
        .select({ content_hash: audio_cache.content_hash, r2_key: audio_cache.r2_key, byte_length: audio_cache.byte_length, lang: audio_cache.lang })
        .from(audio_cache)
        .where(inArray(audio_cache.content_hash, hashes))
    : [];
  const cacheByHash = new Map(caches.map((c) => [c.content_hash, c]));

  const favs = hashes.length > 0
    ? await db
        .select({ content_hash: favorites.content_hash, id: favorites.id, user_id: favorites.user_id })
        .from(favorites)
        .where(inArray(favorites.content_hash, hashes))
    : [];
  const favHashes = new Set(favs.map((f) => f.content_hash));

  // For "what question triggered this?" lookup — grab prior user message
  // per assistant row. One read-per-session: bulk fetch user-role rows
  // for every unique session in the response, sorted by created_at.
  const sessionIds = Array.from(new Set(msgs.map((m) => m.session_id)));
  const userRows = sessionIds.length > 0
    ? await db
        .select({
          id: messagesTable.id,
          session_id: messagesTable.session_id,
          content: messagesTable.content,
          created_at: messagesTable.created_at,
        })
        .from(messagesTable)
        .where(
          and(
            inArray(messagesTable.session_id, sessionIds),
            eq(messagesTable.role, "user"),
          ),
        )
        .orderBy(asc(messagesTable.created_at))
    : [];
  const userBySession = new Map<string, typeof userRows>();
  for (const r of userRows) {
    const list = userBySession.get(r.session_id) ?? [];
    list.push(r);
    userBySession.set(r.session_id, list);
  }

  const items = await Promise.all(
    msgs.map(async (m) => {
      // For assistant: the last user message in the same session before m.
      let triggered_by: { id: string; content: string; created_at: number } | null = null;
      if (m.role === "assistant") {
        const list = userBySession.get(m.session_id) ?? [];
        let prev: (typeof list)[number] | undefined;
        for (const u of list) {
          if (u.created_at < m.created_at) prev = u;
          else break;
        }
        if (prev) {
          triggered_by = { id: prev.id, content: prev.content, created_at: prev.created_at };
        }
      }

      let tts: {
        content_hash: string;
        r2_key: string;
        byte_length: number;
        lang: string;
        download_url: string;
      } | null = null;
      if (m.tts_content_hash) {
        const cache = cacheByHash.get(m.tts_content_hash);
        if (cache) {
          const { downloadUrl } = await storage
            .from(buckets.rockyAudio)
            .createPresignedGetUrl(cache.r2_key, 3600);
          tts = {
            content_hash: cache.content_hash,
            r2_key: cache.r2_key,
            byte_length: cache.byte_length,
            lang: cache.lang,
            download_url: downloadUrl,
          };
        }
      }

      return {
        id: m.id,
        session_id: m.session_id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        tts,
        favorited: m.tts_content_hash ? favHashes.has(m.tts_content_hash) : false,
        triggered_by,
      };
    }),
  );

  return c.json({ items, limit, offset });
});

export default app;
