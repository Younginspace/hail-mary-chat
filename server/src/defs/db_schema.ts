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
  },
  (t) => [index("idx_messages_session").on(t.session_id)]
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

// Keep the sql import reachable so future migrations adding defaults type-check.
export { sql };
