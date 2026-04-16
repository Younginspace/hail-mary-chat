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
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

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

// Keep the sql import reachable so future migrations adding defaults type-check.
export { sql };
