/**
 * Database Schema — P1 + P2
 *
 * P1 tables (raw log):
 *   - users       one row per device (later also per logged-in account)
 *   - sessions    one row per Rocky call
 *   - messages    one row per user/assistant message
 *
 * P2 tables (consolidated memory):
 *   - memories    atomic facts extracted from sessions, for later prompt injection
 *   - rapport     per-user Rocky attitude (trust, warmth, notes)
 *
 * After changes: edgespark db generate && edgespark db migrate
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // uuid v4
    device_id: text("device_id").notNull().unique(),
    // P4: email + callsign populated when anonymous device adopts an account.
    email: text("email"),
    callsign: text("callsign"),
    // P4: EdgeSpark auth user id — set when device is linked to a login.
    // Rows where this is non-null bypass the daily quota.
    auth_user_id: text("auth_user_id"),
    created_at: integer("created_at").notNull(), // unix ms
    last_seen_at: integer("last_seen_at").notNull(),
    // P5 F2: TTS credit balance. Registration grants 10; rapport milestones
    // (F6) grant bonuses. All mutations also land in voice_credit_ledger for
    // audit + debugging. Default 10 backfills existing rows at migration.
    voice_credits: integer("voice_credits").notNull().default(10),
    // P5 F6: rapport-driven affinity. Level 1 = Earth Signal (fresh signup),
    // 2 = Good Human, 3 = Friend, 4 = Fist My Bump. pending_level_up stores
    // the newly-reached level so the next session/start can ceremony-welcome
    // the user, then clear it.
    affinity_level: integer("affinity_level").notNull().default(1),
    pending_level_up: integer("pending_level_up"),
    // Lv2/3/4 unlock gift budgets (image/music/video). Each milestone is
    // a one-time grant; re-entering the same level from a rollback does
    // not re-grant.
    image_credits: integer("image_credits").notNull().default(0),
    music_credits: integer("music_credits").notNull().default(0),
    video_credits: integer("video_credits").notNull().default(0),
    // Immutable: set once when the one-shot video gift is rendered. Used
    // to honor the "one video per user, ever" commitment even after a
    // cross-device merge.
    video_used_at: integer("video_used_at"),
    // Grace cameo budget — how many times Rocky can invite Grace (Ryland
    // Grace from Project Hail Mary) into this user's calls. Scales with
    // affinity:
    //    register (Lv1 Earth Signal)   1
    //    promoted to Lv2 Good Human   +3   (cumulative 4)
    //    promoted to Lv3 Friend       +5   (cumulative 9)
    //    promoted to Lv4 Fist My Bump +10  (cumulative 19)
    // Consumed atomically by /api/chat after a response that contained
    // a [GRACE] speaker block. No daily refresh — once spent, it's spent.
    grace_credits: integer("grace_credits").notNull().default(1),
    // How Grace should address this user affectionately. NULL = Grace
    // hasn't asked yet (first cameo should ask). 'boy' / 'girl' = user
    // answered, Grace may occasionally close with "Good boy" / "Good
    // girl" as an endearment (not every sentence; light touch). 'neither'
    // = user declined / identified as non-binary; Grace stops asking and
    // stays on "Earth kid" / callsign. Populated by the gender-detection
    // scan in /api/chat when a [GRACE]-asked-gender turn is followed by
    // a matching user reply. See README or the minimax_api_key_types
    // memory for the full flow.
    grace_address: text("grace_address"),
  },
  (t) => [
    index("idx_users_device_id").on(t.device_id),
    index("idx_users_auth_user_id").on(t.auth_user_id),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // uuid v4
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    lang: text("lang").notNull(), // 'en' | 'zh' | 'ja'
    mode: text("mode").notNull(), // 'text' | 'voice'
    started_at: integer("started_at").notNull(), // unix ms
    ended_at: integer("ended_at"),
    turn_count: integer("turn_count").notNull().default(0),
    // P2 fills these in during consolidation.
    summary: text("summary"),
    summary_tokens: integer("summary_tokens"),
  },
  (t) => [index("idx_sessions_user_started").on(t.user_id, t.started_at)]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(), // uuid v4
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    created_at: integer("created_at").notNull(),
    // Points at audio_cache.content_hash once /api/tts renders (or
    // cache-hits) this assistant message. Always NULL for user rows
    // and for assistant rows that were never voiced. Lets the admin
    // view join messages ↔ audio ↔ favorites without re-hashing.
    tts_content_hash: text("tts_content_hash"),
  },
  (t) => [
    index("idx_messages_session").on(t.session_id),
    index("idx_messages_tts_hash").on(t.tts_content_hash),
  ]
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(), // uuid v4
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(), // 'fact' | 'preference' | 'topic' | 'emotion'
    content: text("content").notNull(),
    importance: real("importance").notNull().default(0.5), // 0..1
    source_session: text("source_session").references(() => sessions.id),
    created_at: integer("created_at").notNull(),
    last_used_at: integer("last_used_at"),
    // P3 will flip old memories to superseded when new info replaces them.
    // Unused in P2 — column created now so migrations stay additive.
    superseded_by: text("superseded_by"),
  },
  (t) => [index("idx_memories_user_imp").on(t.user_id, t.importance)]
);

export const rapport = sqliteTable("rapport", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => users.id),
  trust: real("trust").notNull().default(0.3),
  warmth: real("warmth").notNull().default(0.3),
  last_mood: text("last_mood"),
  notes: text("notes"),
  updated_at: integer("updated_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════
//  P5 F2 — Voice credits, TTS audio cache, daily global API accounting
// ═══════════════════════════════════════════════════════════════════

// Append-only record of every voice_credits mutation. Lets us answer
// "why did my count drop" questions from user support, and survives a
// users row wipe if we ever need to reconstruct balances.
export const voice_credit_ledger = sqliteTable(
  "voice_credit_ledger",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    delta: integer("delta").notNull(), // negative for consume, positive for grant
    reason: text("reason").notNull(),  // 'consume_tts' | 'register_bonus' | 'level_up' | etc.
    session_id: text("session_id"),    // optional link to the session that triggered consume
    created_at: integer("created_at").notNull(),
  },
  (t) => [index("idx_ledger_user_ts").on(t.user_id, t.created_at)]
);

// SHA-256(text|lang|voice_id) → R2 object holding rendered audio. Lets
// favorite-replay, Open Channel FAQ playback, and repeat visits skip the
// MiniMax TTS call entirely.
export const audio_cache = sqliteTable(
  "audio_cache",
  {
    content_hash: text("content_hash").primaryKey(), // hex sha256
    lang: text("lang").notNull(),
    voice_id: text("voice_id").notNull(),
    r2_key: text("r2_key").notNull(),     // path inside buckets.rocky_audio
    byte_length: integer("byte_length").notNull(),
    created_at: integer("created_at").notNull(),
  }
);

// Global + per-user daily counters for external API quotas (TTS 11k/day,
// music 100/day, image 120/day, Hailuo 2+2/day). Per-user row uses the
// actual user_id; global row uses a sentinel '__global__' so the PK is
// still a non-null string (SQLite lets NULL columns slip through PK).
export const daily_api_usage = sqliteTable(
  "daily_api_usage",
  {
    date: text("date").notNull(),    // YYYY-MM-DD in UTC+8
    api: text("api").notNull(),      // 'tts' | 'tts_gift' | 'music' | 'image' | 'hailuo'
    scope: text("scope").notNull(),  // user_id or '__global__'
    count: integer("count").notNull().default(0),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.api, t.scope] }),
    index("idx_usage_date_api").on(t.date, t.api),
  ]
);

// ═══════════════════════════════════════════════════════════════════
//  P5 F6 — Affinity thresholds (seed-seeded, editable at runtime)
// ═══════════════════════════════════════════════════════════════════

// Editable in-DB so we can recalibrate later without a redeploy
// (plan calls for a P50/P75/P95 auto-tune after 500 real users). Seeded
// with the beta values from the P5 review: Lv2 OR, Lv3/4 AND.
export const rapport_thresholds = sqliteTable(
  "rapport_thresholds",
  {
    level: integer("level").primaryKey(),       // 2, 3, 4
    trust_min: real("trust_min").notNull(),
    warmth_min: real("warmth_min").notNull(),
    combinator: text("combinator").notNull(),   // 'AND' | 'OR'
  }
);

// ═══════════════════════════════════════════════════════════════════
//  P5 F6 Phase 2 — Gifts, async media tasks, global API locks, fallback events
// ═══════════════════════════════════════════════════════════════════

// One row per gift Rocky sends. Synchronous types (image, music) insert
// with status='ready'; asynchronous ones (video) start as 'pending' and
// are updated by the poll handler.
export const gifts = sqliteTable(
  "gifts",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    // 'image' | 'music' | 'video' | 'postcard' (the video fallback)
    type: text("type").notNull(),
    // e.g. 'selfie' | 'memory_sketch' | 'sign' | 'bgm_only' | …
    subtype: text("subtype"),
    description: text("description"),   // Rocky's original desc from [GIFT:…]
    r2_key: text("r2_key"),              // path inside buckets.rockyAudio (reused bucket)
    r2_bucket: text("r2_bucket"),        // which bucket the object lives in
    source_session: text("source_session"),
    status: text("status").notNull().default("pending"), // pending | ready | failed
    error: text("error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [index("idx_gifts_user_created").on(t.user_id, t.created_at)]
);

// For multi-step or async generations (notably I2V-01 video). Lets us keep
// /api/generate-media responses snappy by returning a task handle and
// letting the client poll.
export const media_tasks = sqliteTable(
  "media_tasks",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    gift_id: text("gift_id"),
    type: text("type").notNull(), // 'image' | 'music' | 'video' | 'i2v_prep'
    status: text("status").notNull().default("pending"), // pending | processing | done | failed
    external_task_id: text("external_task_id"), // MiniMax task_id (video)
    external_url: text("external_url"),          // OSS URL before R2 copy
    error: text("error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [index("idx_media_tasks_user_created").on(t.user_id, t.created_at)]
);

// Composite-PK atomic lock for global per-API daily ceilings (Hailuo
// video: 4/day overall). daily_api_usage with scope='__global__' covers
// the same need for TTS; this table is the Hailuo analogue with an
// explicit cap column.
export const daily_global_locks = sqliteTable(
  "daily_global_locks",
  {
    date: text("date").notNull(),   // YYYY-MM-DD in UTC+8
    api: text("api").notNull(),     // 'hailuo_video' | …
    used: integer("used").notNull().default(0),
    limit: integer("limit").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.api] })]
);

// User-facing record of what happened when a Lv4 video gift aged past
// its 48h SLA — did they accept the postcard downgrade or keep waiting.
// Product uses this to decide whether to upgrade the MiniMax plan.
export const video_fallback_events = sqliteTable(
  "video_fallback_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    gift_id: text("gift_id"),
    choice: text("choice").notNull(), // 'postcard' | 'wait_longer'
    created_at: integer("created_at").notNull(),
  }
);

// ═══════════════════════════════════════════════════════════════════
//  P5 F3 — Favorites (per user, capped at 100)
// ═══════════════════════════════════════════════════════════════════

export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    // Matches audio_cache.content_hash — repeat taps of the same content
    // resolve to the same R2 key, so favorite replay stays free.
    content_hash: text("content_hash").notNull(),
    message_content: text("message_content").notNull(), // cleaned translation text
    mood: text("mood"),                                  // happy | unhappy | …
    lang: text("lang").notNull(),
    source_session: text("source_session"),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_fav_user_hash").on(t.user_id, t.content_hash),
    index("idx_fav_user_created").on(t.user_id, t.created_at),
  ]
);

// ═══════════════════════════════════════════════════════════════════
//  Consolidation retry + dead-letter (P5 Review §7)
// ═══════════════════════════════════════════════════════════════════

// One row per session/end that kicks consolidation. Wraps the actual
// consolidate() call so failures stop being swallowed by a bare .catch.
// Status transitions: pending → running → (done | failed). 'failed'
// only when attempts hits MAX (3); otherwise it flips back to pending
// for a later retry (manual admin or cold-start sweep).
export const consolidation_jobs = sqliteTable(
  "consolidation_jobs",
  {
    session_id: text("session_id").primaryKey(),
    status: text("status").notNull().default("pending"), // pending | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [index("idx_cjobs_status_updated").on(t.status, t.updated_at)]
);

// ═══════════════════════════════════════════════════════════════════
//  Bot defenses (P5 Review compensation — no Turnstile)
// ═══════════════════════════════════════════════════════════════════

// Per-IP hourly register rate limit. hour_bucket = UTC epoch hour.
// CAS-friendly: (ip, hour_bucket) PK, `count` bumped atomically.
export const register_rate_limit = sqliteTable(
  "register_rate_limit",
  {
    ip: text("ip").notNull(),
    hour_bucket: integer("hour_bucket").notNull(),
    count: integer("count").notNull().default(0),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ip, t.hour_bucket] })]
);

// Keep the sql import reachable so future migrations adding defaults type-check.
export { sql };
