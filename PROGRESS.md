# Hail Mary Chat — P5 Progress & Handoff

_Last updated: 2026-04-17_
_Branch: `feat/edgespark-migration`_
_Production: https://teaching-collie-6315.edgespark.app_

A durable snapshot of where the P5 upgrade stands so the next session
can pick up without re-reading the transcript. The authoritative
companion docs are:

- **Master plan**: `~/.claude/plans/steady-shimmying-lighthouse.md`
  (feature breakdown + P5 review decisions)
- **Memory**: `~/.claude/projects/-Users-yangyihan-Downloads/memory/hail-mary-progress.md`
  (commit log by phase + key decisions)

---

## Shipped features (in chronological order)

| Phase | What shipped | Commit | Notes |
|---|---|---|---|
| P0 | Express → EdgeSpark Hono migration | `2e3cf5e` | |
| P1 | D1 tables + anonymous device_id quota | `a92781e` | |
| P2 | Async memory consolidation (MiniMax-M2.7) | `bfb2c5a` | |
| P3+P4+v3.0 | Memory injection + email/password + particle visuals | `6518974` | |
| Security/enhancements | Prompt server-side migration + dedup/decay/merge | `61f802b` | |
| **P5 F1** | **Forced registration + Rocky Chat hero + Dial In + Open Channel** | `6cb887a` | Open Channel later renamed to Rocky Echo |
| F1b+F1c | Two-pane chat (hologram + chat) + parallel CTAs + dynamic bg | `079b8f8` | |
| F1d→F1g | CTA polish + 3-row textarea + scroll isolation + MD/PNG export + register fix + top-down hologram | several | |
| F1h | Open Channel restored to 6 `defaultDialogs` with pre-recorded mp3s | `a7042e3` | |
| F1i | Rocky Echo screen + top-left account chip + remembered email | `f9b8bc6` | |
| F1k | DialIn layout polish (back to bottom, mode hint under CONNECT) | `a93754f` | |
| **P5 F2** | **Voice credits + R2 TTS cache + daily API accounting** | `a4fc329` | 10 voice credits on signup; rapport milestones add bonuses |
| **P5 F3 + F1l** | **Per-message play + favorites (100 cap) + UI polish** | `28813e1` | `?favorite=true` replay free; status bar reorganized |
| F1m + F1j | Mobile adaptation (landing/dialin/chat) + i18n audit | `15e18bb` | +8 new keys, 44 dead keys dropped, inline dicts moved to t() |
| **P5 F6 Phase 1** | **Affinity levels + rapport-driven credit unlocks** | `6ed1370` | Lv1→Lv4, pending_level_up, LevelUpCeremony overlay |
| F6 Phase 2 prep | Favorites hero pill + MiniMax probe + Phase 2 schema | `6a00d5d` | **current head** |

Plan Features inventory vs P5 plan:
- **F1** forced registration ✅
- **F2** merge text/voice modes + voice credits ✅
- **F3** play button + favorites ✅
- **F4** export (MD + PNG) ✅
- **F5** GSAP visual — partial (hero transitions only; message bubbles
  still CSS fadeIn)
- **F6** affinity + gifts — **Phase 1 ✅**, **Phase 2 in progress**

---

## Current architecture snapshot

### Routes

| Path | Auth | Purpose |
|---|---|---|
| `GET /api/public/health` | No | Liveness probe |
| `GET /api/public/check-callsign` | No | DialIn debounced availability |
| `POST /api/adopt-device` | Yes | Link device + callsign |
| `GET /api/me` | Yes | Profile + callsign + `affinity_level` |
| `GET /api/voice-credits` | Yes | Voice credit balance |
| `GET /api/favorites` / `POST` / `DELETE /:id` | Yes | Favorites CRUD (100 cap) |
| `POST /api/session/start` | Yes | Creates session row; returns `affinity_level`, optional `level_up` payload |
| `POST /api/session/end` | Yes | End + kicks consolidation (runs `checkLevelUp` after) |
| `POST /api/session/message` | Yes | Append message |
| `POST /api/chat` | Yes | SSE chat stream via MiniMax |
| `GET /api/tts` | Yes | Cache-first TTS (R2). Skips credit on favorite match or `?favorite=true` |
| `GET /api/probe-minimax` | Yes | Dev-only: probes MiniMax endpoints (`?what=all|image|music|lyrics|video|video-t2v|video-director|video-hailuo|video-i2v|lyrics-alt|vision|vision-retry`) |

### Database (D1, migrations 0001–0006)

- `users` — identity + credits: `voice_credits` (default 10), `affinity_level` (default 1), `pending_level_up`, `image_credits`, `music_credits`, `video_credits`, `video_used_at` (immutable)
- `sessions`, `messages`, `memories`, `rapport` — dialog + memory
- `voice_credit_ledger` — append-only audit (reasons include `consume_tts`, `register_bonus`, `refund_global_cap`, `level_up_{N}`)
- `audio_cache` — SHA-256 keyed TTS cache → R2 bucket `rocky-audio`
- `daily_api_usage` — composite PK (`date`, `api`, `scope`) for global + per-user counters (e.g. TTS 9,900/day user ceiling)
- `favorites` — unique per `(user_id, content_hash)` + index on `(user_id, created_at)`
- `rapport_thresholds` — seeded beta (Lv2 OR, Lv3/4 AND)
- **Phase 2 (schema only, no endpoints yet):** `gifts`, `media_tasks`, `daily_global_locks`, `video_fallback_events`

### Storage (R2)

- Bucket `rocky-audio` — current use: `audio/<2-hex>/<hash>.mp3` for TTS cache. Phase 2 will reuse it for gift image/music/video via `r2_key` in `gifts`.

---

## MiniMax probe findings (2026-04-17)

Confirmed with real API key via `/api/probe-minimax`:

| API | Endpoint | Method | Result |
|---|---|---|---|
| Image | `POST /v1/image_generation` | sync | ✅ 200, ~25s, returns OSS URL (7-day expiry → **must copy to R2**). Body: `{model:"image-01", prompt, aspect_ratio, n, prompt_optimizer}` |
| Music | `POST /v1/music_generation` | sync | ✅ 200, ~16s, returns hex audio. Body: `{model:"music-2.6", lyrics}` |
| Lyrics | `POST /v1/lyrics_generation` | sync | ❌ 2013 invalid params on 3 variants. Use chat LLM to generate lyrics instead. |
| Video (text2video) | `POST /v1/video_generation` | — | ❌ Current token plan does not include `video-01`, `T2V-01`, `T2V-01-Director`, `MiniMax-Hailuo-02`. |
| Video (I2V) | `POST /v1/video_generation` | async | ⚠️ `I2V-01` works but `first_frame_image` is required. Lv4 video gift must be **two-step: image-01 → I2V-01**. |
| Vision (M2.7 + abab6.5) | chat `/v1/chat/completions` with `content: [text, image_url]` | — | `abab6.5-chat` + `abab6.5g-chat` explicitly reject img. `M2.7` returned 529 overloaded — **retry needed**. |

**Pending user trigger** for `?what=vision-retry` (M2.7 ×2 retries + MiniMax-VL-01 / MiniMax-VL / abab7-chat / abab7-preview / MiniMax-M1). Paste JSON back next session.

If vision works: **F6.P2.7** — chat composer 📎 upload button, image → R2 → presigned URL → `image_url` content block in MiniMax chat body, Rocky "sees" user photos.

---

## Phase 2 (F6) — remaining work

Tasks filed: `#41`–`#46` + `#47` (vision) if vision works.

### Ready to build now (no probe needed)

1. **`/api/generate-media` POST** (`#42`, `#45`)
   - Input: `{ type: 'image'|'music', description, session_id? }`
   - Auth required; checks `affinity_level ≥ 2|3`, atomically decrements `image_credits` / `music_credits`
   - Calls MiniMax sync API, fetches OSS URL (image) or parses hex (music), puts to R2 (reuse `rocky-audio` bucket with subpath `gift/<type>/<hash>`), inserts `gifts` row with `status='ready'`
   - Music MVP: `music-2.6` BGM only. Plan's "BGM + TTS monologue overlay" is a v2 follow-up (needs ffmpeg-on-worker).
   - Returns `{ id, status, r2_presigned_url }`
2. **`GET /api/gifts`** — list for user
3. **Rocky system prompt updates** (`#43`)
   - `getRockySystemPrompt(lang, affinity_level, credits)` signature change
   - Append level-gated hints: Lv≥2 `[GIFT:image "desc"]`, Lv≥3 `[GIFT:music "desc"]`, Lv≥4 `[GIFT:video "desc"]` (only when corresponding credits > 0)
4. **Client: parse `[GIFT:xxx "desc"]`** (`#44`)
   - In `useChat.ts` after stream completes, regex `/\[GIFT:(image|music|video)\s+"([^"]+)"\]/`, remove from displayed text, fire `POST /api/generate-media`
   - Show placeholder bubble immediately ("Rocky is making something for you…"), on success replace with `GiftBubble`
5. **`GiftBubble.tsx`** component
   - `image` → `<img>` with fade-in + download
   - `music` → `<audio controls>` + download
   - `video` → `<video controls>` + download
6. **LevelUpCeremony → gift delivery**
   - When user closes the level-up overlay, kick off the milestone gift in the background (the plan's "track A — precise upgrade delivery" from the 2026-04-17 review)

### Needs more plumbing

7. **Video gift (`#46`)** — two-step `image-01 → I2V-01`
   - Step 1 sync: `image-01` to produce first frame (hand-tuned Erid/Rocky prompt)
   - Step 2 async: `POST /v1/video_generation` with `model: 'I2V-01'` + `first_frame_image` → returns `task_id`
   - Poll: `GET /v1/query/video_generation?task_id=…` (endpoint unverified; add to probe)
   - Atomic CAS on `daily_global_locks(date='…', api='hailuo_video')` with user's plan limit (~2 Fast + 2 full = 4/day). On failure → queue + user sees "预约明天" copy.
   - 48h SLA check: cron or on-access flag; past 48h offer postcard downgrade (another `image-01` call with different prompt) and record `video_fallback_events.choice`.
   - Respect `users.video_used_at` lifetime marker on success (once set, new Lv4 promotions do **not** re-grant `video_credits`).

### Also from the plan review, still open

- **Consolidation retry + `consolidation_jobs` dead-letter table** — currently `.catch(console.error)` swallows failures. Not Phase 2 per se but called out as a P1 risk.
- **`rapport_thresholds` auto-recalibration job** — beta values hard-set; plan to recompute P50/P75/P95 after 500 real users.
- **Bot defenses** (low priority at DAU≈100) — register IP rate limit, 7-day idle credits zeroing, disposable-email blacklist.
- **F5 GSAP message animations** — nice-to-have polish.

---

## Current state reminders

- `MINIMAX_API_KEY` is set as an EdgeSpark secret; all MiniMax calls route through the server.
- EdgeSpark CLI login: `edgespark login` → user opens printed URL in browser → re-run original command.
- Deploy from project root: `edgespark deploy`.
- DB migrations: `cd server && edgespark db generate` (author SQL in `drizzle/*.sql`), `edgespark db migrate`. Never edit a file once applied.
- Test account: `debugtest` (Stardust was set up during F1e regression; also a `1111` remains). Ask user for passphrase if sign-in testing needed.
- Playwright browser session is **not** authed across turns by default; for probe-style checks ask the user to hit the URL manually while logged in.

## Known production-facing gaps

- Video gifts blocked until user's MiniMax plan changes (only `I2V-01` available). The two-step image→I2V flow works, but 4/day global ceiling is very tight and 48h SLA fallback is required.
- Vision (user uploads image → Rocky reacts) pending `?what=vision-retry` result.
- `music_cover` not probed yet — plan's "首选: music-cover + Rocky 参考音频" still gated on spike. Music gift MVP will ship as plain `music-2.6` BGM.

---

## Where to start next session

1. **Paste vision-retry probe JSON** if it was triggered.
2. Decide: implement F6.P2.7 vision (if a model works) alongside Phase 2, or defer.
3. Start `/api/generate-media` (image first — sync, shortest path to visible value).
4. Add level-aware GIFT prompt fragments to `prompts/rocky.ts`.
5. Client-side `[GIFT:...]` parser + `GiftBubble.tsx`.
6. Deploy, smoke-test at Lv2 (register new account, fake rapport bump, trigger a gift).

Then iterate to music, then video.
