/**
 * Database Schema — P1
 *
 * Three tables for the memory system:
 *   - users       one row per device (later also per logged-in account)
 *   - sessions    one row per Rocky call
 *   - messages    one row per user/assistant message (raw log)
 *
 * After changes: edgespark db generate && edgespark db migrate
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // uuid v4
    device_id: text("device_id").notNull().unique(),
    // P4 will add email + callsign; kept nullable so P1 migrations stay additive.
    email: text("email"),
    callsign: text("callsign"),
    created_at: integer("created_at").notNull(), // unix ms
    last_seen_at: integer("last_seen_at").notNull(),
  },
  (t) => [index("idx_users_device_id").on(t.device_id)]
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

// Keep the sql import reachable so future migrations adding defaults type-check.
export { sql };
