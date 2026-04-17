# Hail Mary Chat — Branch Diff vs Production

_Last updated: 2026-04-17 (post P5 Review reliability/bot-defense batch)_
_Branch: `feat/edgespark-migration` (many commits ahead of `main`)_
_Production baseline: `main` @ `bb1bd95` (2026-04-07) — served at **rocky.savemoss.com** via old Cloudflare Pages (CNAME never cut over)_
_EdgeSpark worker (deployed target): https://teaching-collie-6315.edgespark.app_

This doc is **diff-only**: what sits on `feat/edgespark-migration` but
is NOT yet on `main`/`rocky.savemoss.com`. For the master plan see
`P5_PLAN.md` (copy of `~/.claude/plans/steady-shimmying-lighthouse.md`).
For runtime/admin usage of new secrets + endpoints see `ADMIN.md`.

---

## TL;DR

Express-on-Pages MVP → EdgeSpark Hono worker with D1 + R2. Forced
registration (Open Channel read-only + Dial In auth), voice-credit
economy, rapport-driven 4-level affinity system, favourites, chat
export (MD + PNG), MiniMax TTS + memory consolidation, media-gift
scaffolding (paused), and a full set of P5 Review carryover
reliability + bot-defense features shipped this round.

Everything is on branch. The only thing between the branch and real
users is a CNAME flip at the DNS provider.

---

## Plan feature status (vs P5_PLAN.md)

| Plan Feature | Scope | Status |
|---|---|---|
| P0 Express → Hono | Worker runtime migration | ✅ branch only |
| P1 Anonymous D1 + quota | `users` / `sessions` / `messages` | ✅ |
| P2 Memory consolidation | MiniMax-M2.7 extractor + `memories` | ✅ |
| P3+P4 Login + memory injection | better-auth email/password, prompt injection | ✅ |
| Security/enhancements | prompts server-side, dedup/decay | ✅ |
| **F1** Forced registration | Open Channel + Dial In + GSAP transitions | ✅ |
| **F2** Voice credits + cache | 10-credit grant + R2 `audio_cache` + daily CAS | ✅ |
| **F3** Play + favourites | Per-message play, 100-cap favourites, free replay | ✅ |
| **F4** Export | Markdown + PNG long-shot (html2canvas) | ✅ |
| **F5** GSAP polish | Hero transitions ✅ + message bubbles ✅ (this round) | ✅ |
| **F6 Phase 1** Affinity levels | Lv1→Lv4, rapport check, `pending_level_up`, Ceremony | ✅ |
| **F6 Phase 2 runtime** | `/api/generate-media` + prompt injection + `GiftBubble` | ⏸ code shipped, **paused** (MiniMax img2img has no character-lock; need model switch) |
| **F6 Phase 2 LevelUp ceremony gift** | Track A — precise gift on overlay dismiss | ⏸ waits on gift unpause |
| **F6 Phase 2 video path** | 2-step image-01 → I2V-01 + Hailuo CAS + 48h SLA | ⏸ waits on gift unpause |
| MiniMax probes | image/music/video/lyrics/vision/i2i-rocky/music-cover | ✅ multiple rounds |
| i18n audit | +8/−44 keys, mobile adaptation | ✅ |

---

## Reliability + P5 Review carryover (this round)

All shipped, all live on the worker.

| Feature | Files | Notes |
|---|---|---|
| **Consolidation retry + dead-letter** (`consolidation_jobs` table) | `server/src/consolidate.ts`, migration `0007_small_ikaris.sql` | `runConsolidationJob(session_id)` wraps the bare logic. Attempts capped at 3. Failed jobs → `failed` (dead letter). Opportunistic sweep fires on every `/api/session/end`. Admin inspect: `GET /api/admin/consolidation-failed`. |
| **Server-side GIFT tag stripping** | `server/src/index.ts` (`buildGiftStrippingTransform`), `web/src/utils/api.ts`, `web/src/hooks/useChat.ts` | `/api/chat` pipes MiniMax SSE through a TransformStream. `[GIFT:type:sub "desc"]` tags are detected across chunk boundaries, stripped from `data:` deltas, re-emitted as `event: gift_trigger` with a validated JSON payload. Client listens for the event and dispatches generation. Client regex kept as belt+suspenders fallback. |
| **Duplicate user rows fix** | `server/src/index.ts` (`adopt-device` + `mergeUsersByAuthId`) | Root cause: `useAuthSession.ts` called `adopt-device` on every session change; backend keyed on `device_id` so every fresh browser / cleared localStorage spawned a new `users` row. Fix: auth-first lookup in adopt-device (idempotent update); `mergeUsersByAuthId` now reparents `sessions` / `memories` / `voice_credit_ledger` / `favorites` (uniq-hash-aware) / `gifts` / `rapport` (best trust/warmth) + merges credit columns (max) + **DELETEs zombie user rows**. Historical cleanup done via SQL (21 rows → 1). |
| **rapport_thresholds recalibration** | `server/src/index.ts` (admin endpoints) | `GET /api/admin/rapport-percentiles` proposes Lv2=P50, Lv3=P75, Lv4=P95 with sample-size warning. `POST /api/admin/rapport-recalibrate` applies a reviewed body. Plan says wait ≥500 users before running. |
| **Admin endpoints gate** | `server/src/defs/runtime.ts`, secret `ADMIN_TOKEN` | Constant-time compare on `X-Admin-Token` header. See `ADMIN.md` for usage. |

## Bot defenses (this round)

| Feature | Files | Notes |
|---|---|---|
| **Per-IP register rate limit** | `server/src/index.ts`, `register_rate_limit` table, migration `0008_low_trish_tilby.sql` | 10 `users`-row creations per IP per rolling UTC hour. Key = (ip, hour_bucket), CAS via `onConflictDoUpdate` with `setWhere: count < cap`. Reads `CF-Connecting-IP` header. Applies to the fallback insert branches of `adopt-device`, NOT the auth-first idempotent update path. |
| **7-day idle credit zero** | `server/src/index.ts` (`zeroCreditsIfStale`) | Runs background on `/api/me`. If user signed up ≥7 days ago with 0 sessions, zeroes `voice_credits` and logs to `voice_credit_ledger` with `reason='idle_7day_zero'`. Lazy — no cron needed. |
| **Disposable email blacklist** | `server/src/index.ts` (`DISPOSABLE_EMAIL_DOMAINS`) | 17-domain static set (mailinator, 10minutemail, etc). Silent-rejects in `adopt-device` with `{error:'not_supported'}` so bots can't trivially iterate. |

## UX batch (this round)

| Feature | Files | Notes |
|---|---|---|
| **Hang-up button** | `ChatInterface.tsx`, `i18n/index.ts`, `styles/terminal.css` | Red phone icon in status-bar actions. Calls `stopTTS` + `endSession` + `onBack`. |
| **Echo replay + favorite** | `EchoInterface.tsx`, `MessageBubble.tsx` | Greeting + each preset now accept play/favorite. Favorite requires login (hidden for anon). Greeting exclusion removed from `MessageBubble`. |
| **TTS latency shaved** | `useRockyTTS.ts`, `ChatInterface.tsx`, `EchoInterface.tsx` | Removed 3× 200ms hard-coded pauses + dropped greeting 500ms → 120ms. ~1.1s saved per reply. |
| **Echo post-presets CTA → button** | `EchoInterface.tsx`, `i18n/index.ts`, `styles/terminal.css` | "Dial In" is now a pill button calling `onBack`. |
| **F5 GSAP message bubble mount** | `MessageBubble.tsx`, `styles/terminal.css` | `gsap.fromTo` on mount, 0.32s power2.out, `prefers-reduced-motion` honored. CSS fadeIn dropped. |
| **"首条消息偶发刷新" defensive** | `ChatInterface.tsx` | Form `noValidate` + `action="#"` + `autoComplete="off"`. **Root cause not yet found** — need console log on repro. |
| **Auto-scroll tightened** | `ChatInterface.tsx` | `rAF` defer + `block:'end'` + force-scroll on user send. |

---

## Architecture snapshot (branch-only)

### D1 migrations `0001`→`0008`

- `0001`–`0005`: users / sessions / messages / memories / rapport, voice_credit_ledger, audio_cache, daily_api_usage, favorites, rapport_thresholds
- `0006`: F6 Phase 2 gifts / media_tasks / daily_global_locks / video_fallback_events
- `0007` **(this round)**: `consolidation_jobs`
- `0008` **(this round)**: `register_rate_limit`

### Routes (post-batch)

```
Public (no auth):
  GET    /api/public/health
  GET    /api/public/check-callsign

User-auth (session required):
  GET    /api/me                         (also triggers zeroCreditsIfStale)
  POST   /api/adopt-device               (auth-first, rate-limited, disposable-blocked)
  GET    /api/voice-credits
  GET    /api/favorites
  POST   /api/favorites
  DELETE /api/favorites/:id
  POST   /api/session/start
  POST   /api/session/end                (runs runConsolidationJob + sweep)
  POST   /api/session/message
  POST   /api/chat                       (SSE w/ gift_trigger transform)
  GET    /api/tts                        (cache-first R2)
  POST   /api/generate-media             (gift endpoint — paused usage)
  GET    /api/gifts                      (gift list — paused usage)
  GET    /api/probe-minimax              (?what=all|image|music|lyrics|video|video-*|vision|vision-retry|image-i2i|image-i2i-rocky|music-cover-rocky)

Admin (X-Admin-Token required — see ADMIN.md):
  POST   /api/admin/retry-consolidation  (?older_than_ms=…&limit=…)
  GET    /api/admin/consolidation-failed
  GET    /api/admin/rapport-percentiles
  POST   /api/admin/rapport-recalibrate  ({ levels: [...] })
```

### Storage (R2 bucket `rocky-audio`)

- `audio/<2hex>/<hash>.mp3` — cached TTS
- `gift/<type>/<2hex>/<hash>.{jpg,mp3}` — gift media (paused usage)
- `gift/ref/*.jpeg` — Rocky character reference images (realistic, comic1, rockyemoji)

### Secrets

- `MINIMAX_API_KEY` — upstream MiniMax (chat, TTS, image, music)
- `ADMIN_TOKEN` — gates all `/api/admin/*` endpoints

---

## MiniMax probe findings (consolidated)

Latest results — see `/api/probe-minimax?what=<kind>` for live re-runs.

| API | Endpoint | Result |
|---|---|---|
| Image T2I | `POST /v1/image_generation` `image-01` sync | ✅ 200, ~25s, OSS URL 7-day expiry → mirror to R2 |
| Image img2img (`reference_image`) | `POST /v1/image_generation` | ✅ 200, but **only loose style/composition** — does NOT preserve character IP. Confirmed visually |
| Image img2img (`subject_reference: character`) | `POST /v1/image_generation` | ❌ 1000 "unknown error" on our plan — likely requires higher tier |
| Music | `POST /v1/music_generation` `music-2.6` sync | ✅ 200, ~16s, hex audio |
| Music-cover | `/v1/music_cover` variants | **Not yet probed with Rocky voice** — probe added as `?what=music-cover-rocky`, pending user trigger |
| Lyrics | `POST /v1/lyrics_generation` | ❌ 2013 — use chat LLM for lyrics |
| Video T2V family | `video_generation` w/ T2V-01/Director/Hailuo-02 | ❌ 2061 — excluded from plan |
| Video I2V | `I2V-01` async w/ `first_frame_image` | ⚠️ Works. Requires 2-step image→I2V |
| Vision (chat multimodal) | `content:[text, image_url]` | ❌ abab6.5 reject, M2.7 flaky. `vision-retry` probe prepared but never triggered by user |

**Upshot for gifts**: MiniMax cannot character-lock img2img for Rocky
on our plan. Plan next iteration: evaluate AnyCap nano-banana-pro
(character-lock verified in the Rocky-sign template test) or upgrade
MiniMax tier.

---

## Outstanding (not doable this round)

| # | Item | Why deferred |
|---|---|---|
| 1 | **F6 Phase 2 gift runtime unlock** | Waits on model selection (AnyCap vs MiniMax paid) |
| 2 | **`rocky.savemoss.com` CNAME → EdgeSpark** | User DNS action, not code |
| 3 | **"首条消息偶发刷新" root-cause** | Needs repro + console log `[Rocky ErrorBoundary]` |
| 4 | **rapport_thresholds live recalibration** | Script shipped, waiting on ≥500 real users (DAU≈100 → ~2-3 months) |
| 5 | **LevelUpCeremony → precise gift delivery** (Track A) | Depends on #1 |
| 6 | **Video gift SLA** (`video_fallback_events`) | Depends on #1 |
| 7 | **Music-cover production integration** | Probe shipped, production flow depends on #1 |

---

## Where to start next session

1. If user triggered `?what=music-cover-rocky` or `?what=image-i2i-rocky` or `?what=vision-retry`, paste JSON.
2. If model decision made for gift revival → unpause, wire new provider into `/api/generate-media`, and resume F6 Phase 2 code (already on branch).
3. Otherwise: CNAME flip discussion, or pick any P2/P3 polish task.
