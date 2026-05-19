# Companion Mode v1 — Design

_Date: 2026-05-19_
_Status: design draft — awaiting cross-review (Claude × codex, 3 rounds)_
_Author: Claude (brainstormed with @yangyihan)_

---

## 1. North star

Pre-recorded **non-verbal audio companion** mode. A user opens it
from the home screen or from inside a chat, and Rocky's presence
becomes ambient: a continuously-looping spaceship environment bed,
overlaid with occasional Rocky non-verbal triggers (hums, taps,
breaths, scrapes, rummaging). The user is not chatting — they are
studying, working, or going to sleep, and they want to know Rocky
is still there.

Aligned with PHM canon: Eridians sense the world via sound
vibration, not vision, so audio-only presence is the most
"Rocky-true" interaction in the product.

### Why now

- **L1 retention** is the bottleneck. Users who don't want to chat
  right now have no reason to open the app — companion mode gives
  them one.
- **Zero marginal cost**: static R2 assets, no LLM, no TTS spend.
- **Lore wedge**: nothing else in the app exploits the
  vibration-sense canon.

### Out of scope (v1)

- Multi-channel menu ("Rocky working" / "Rocky resting" / etc.) — v2
- Adaptive trigger cadence (idle-aware) — v2
- Rocky verbal lines — use chat
- Affinity / rapport changes — explicitly no, regardless of usage
- voice_credits consumption — companion is free
- Bedtime stories — PR #38 paused, separate scope
- Cross-device companion sync — future

---

## 2. Architecture

```
[Client]
  ├─ CompanionScreen.tsx        (new — full-screen surface)
  ├─ useCompanionAudio.ts       (new — env loop + trigger scheduler + sleep timer)
  ├─ wakeLock.ts                (new, ~30 LOC — Screen Wake Lock API w/ iOS fallback)
  ├─ audioPlayback.ts           (existing, modified — add 'companion' slot type)
  └─ MediaSession metadata      (existing pattern)

[Server]
  └─ GET /api/companion/asset-urls   (new, tiny — returns presigned GETs for
                                       env bed + 20 triggers in one response)
     no other new endpoints

[Storage R2]
  rocky-audio/companion/v1/
  ├─ env-bed-01.mp3                       (~10 min, ~7 MB, seamless loop, 96kbps)
  └─ triggers/                            (20 short clips, ~1.5 MB total, 128kbps)
      ├─ hum-{01..04}.mp3
      ├─ tap-{01..04}.mp3
      ├─ scrape-{01..04}.mp3
      ├─ breath-{01..04}.mp3
      └─ rummage-{01..04}.mp3
```

**Total first-load weight: ~8-9 MB.** Subsequent opens hit the browser
HTTP cache via the same R2 object keys.

### Components & responsibilities

| Component | Type | Responsibility |
|---|---|---|
| `CompanionScreen.tsx` | new | Full-screen surface. Renders breathing dot + elapsed counter + sleep-timer control + Exit + Dim toggle. On mount: `audioPlayback.claimSlot('companion')`. On unmount: `releaseSlot`. |
| `useCompanionAudio.ts` | new | Two `HTMLAudioElement`s — base loop (`loop=true`) + single trigger element (reassigned per trigger). 30s–2min random interval, "no adjacent duplicates" algorithm. Sleep-timer fade (8s base volume → 0). States: `loading / playing / fading / done / error`. |
| `wakeLock.ts` | new | `navigator.wakeLock.request('screen')` wrapper. Silent fallback on iOS Safari (which currently does not support it on lock screen). |
| `audioPlayback.ts` | modified | Add `'companion'` slot type. `claimSlot('companion')` stops any in-flight TTS. Inverse defense: a TTS `claimSlot` during companion → companion auto-pauses + logs (defense — should not happen due to UI mutex). |
| `StartScreen.tsx` | modified | Add third CTA "STAY CONNECTED" / "陪着我" below `DIAL IN` / `OPEN CHANNEL` row. |
| `ChatInterface.tsx` | modified | Add new icon button in `status-actions` row near red hangup, labeled "STAY ON LINE". On click: `endSession()` (runs through existing consolidate path) → navigate to companion. |
| `App.tsx` | modified | Phase machine: `'home' \| 'echo' \| 'favorites' \| 'chat'` → add `'companion'`. Mutex enforced at navigation layer: entering companion forces chat exit; entering chat forces companion exit. |

---

## 3. Asset library

| Type | Count | Length | Bitrate | Total size |
|---|---|---|---|---|
| Env bed | 1 | ~10 min | 96 kbps mp3 | ~7 MB |
| Rocky triggers (5 groups × 4 variants) | 20 | 0.5–3s each | 128 kbps mp3 | ~1.5 MB |
| **Total** | **21 files** | — | — | **~8.5 MB** |

Groups: `hum` (4), `tap` (4), `scrape` (4), `breath` (4), `rummage` (4).

### Sourcing plan (per project directive: search online before recording)

| Asset | Step 1 — search online | Step 2 — clip existing | Step 3 — fresh recording |
|---|---|---|---|
| Env bed | **Freesound / Pixabay / Zapsplat** for "spaceship ambience", "sci-fi room tone", "fan hum", "control room ambient" (CC0 / CC-BY preferred). Audacity remix into seamless 10-min loop. | n/a | Only if step 1 yields nothing usable. |
| Rocky non-verbal triggers | n/a — must be Rocky's voice line, not findable online | Scan `rocky_voice_human.MP3` + `rocky_voice_human_2.MP3` for clippable non-verbal segments (hums, mouth-clicks, breaths, page flips). Optimistic estimate: ~10 of 20 triggers come from existing material. | Studio session for the rest (1–2 days). |

### Production estimate

| Phase | Duration | Notes |
|---|---|---|
| Recon: scan old recordings + Freesound search | 1 day | Plan-phase deliverable: "x of 20 triggers covered by existing material, y CC0 ambient candidates for env bed" |
| Env bed production (search-or-record + Audacity loop work) | 1–2 days | Step 1 path: 1 day. Step 3 fallback: 2 days. |
| Trigger recording (gaps not covered by old material) | 1–2 days | Depends on recon outcome. |
| Mix + seamless-loop QA + bitrate encoding | 1 day | One pass per asset; verify no audible loop click; verify trigger peaks consistent |
| **Total** | **3–6 working days** | Range depends on how much recon reduces fresh recording |

---

## 4. UX state machine

```
[home / chat]
   │
   ↓  CTA: "Stay Connected"  (home)
   ↓  CTA: "Stay On Line"    (chat → endSession() first)
   │
[loading]   ← parallel fetch env bed + 20 triggers; UI shows breathing dot + "tuning in…"
   │
   ↓  all critical assets loaded (env bed + at least 4 triggers)
   ↓  triggers still loading in background lazy
   │
[playing]
   │
   ↓  user taps Exit  |  sleep timer hits 0
   │
[fading]    ← 8s base volume → 0, trigger schedule stopped
   │
   ↓  fade complete
   │
[done]
   │
   ↓
[home]

side branch:
[error]   ← env bed fetch failed | network gone
   │
   ↓  retry button | exit
```

### Phase transitions

| From | To | Trigger |
|---|---|---|
| `home` | `loading` | user taps "Stay Connected" |
| `chat` | `loading` | user taps "Stay On Line" → `endSession()` runs (existing consolidate path) → navigate companion |
| `loading` | `playing` | env bed + ≥4 triggers loaded (rest lazy) |
| `loading` | `error` | env bed fetch fails (5s timeout or HTTP error) |
| `playing` | `fading` | user Exit | sleep timer = 0 |
| `fading` | `done` | 8s fade elapsed |
| `done` | `home` | automatic |
| `error` | `loading` | retry |
| `error` | `home` | exit |

---

## 5. UI specs

### Default chrome ("a-style")

```
┌─────────────────────────────────────┐
│  ☾                                ✕ │  ← dim toggle (top-left) | exit (top-right)
│                                     │
│                                     │
│              ◯                      │  ← breathing dot (slow pulse, 4s cycle)
│           Rocky · 在                 │  ← static label
│                                     │
│            32:14                    │  ← elapsed time, large
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ⏱ Sleep timer · 剩 23:14  │   │  ← sleep-timer pill, tappable opens picker
│  └─────────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

### Dim chrome ("c-style", same component, `companionDim=true`)

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│           (nearly black)            │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
│  🛰 Rocky · 32:14 · 剩 23 min        │  ← bottom bar only, low-contrast
└─────────────────────────────────────┘
```

The dim chrome reuses the same React component tree; only the styles
collapse + opacity drop. Tapping anywhere on screen toggles back to
full chrome briefly (3s auto-redim) for sleep-timer adjustment.

### Sleep timer picker

Bottom sheet, 5 options: `off / 15 / 30 / 45 / 60 min`.
Default selection: **30 min**.
Re-tapping the same option closes the sheet.
Changing the option resets the countdown from the new value (does
NOT accumulate against elapsed time).

### Breathing dot animation

Pure CSS: `box-shadow` + `opacity` keyframe, 4s cycle, ease-in-out.
On every Rocky trigger fire, the dot briefly brightens (300ms
boost) — a subliminal visual coupling between sound and visual.

---

## 6. Audio coordination

**Critical lesson from PR #38 review**: any new audio source MUST
integrate with `audioPlayback.ts` slot system, otherwise companion
audio can play simultaneously with chat TTS.

### Changes to `audioPlayback.ts`

```ts
type AudioSlotType = 'tts' | 'favorite' | 'echo' | 'companion';  // 'companion' new

// claimSlot('companion') stops any in-flight TTS and releases all
// other slot types. Same exclusivity contract as existing types.
// releaseSlot('companion') is called on CompanionScreen unmount.
```

### Mutex enforcement (defense in depth)

1. **UI-level**: navigation to `phase='companion'` exits chat;
   navigation back to chat exits companion. The two phases cannot
   coexist.
2. **Audio-level**: `audioPlayback` slot system guarantees only one
   slot owner at any time. If a defensive bug somewhere triggers a
   TTS claim during companion, companion auto-pauses and logs a
   warning (caught by future telemetry; ignored by user as a stop).

---

## 7. Background playback (screen off / lock / app-background)

| Mechanism | Purpose | iOS Safari behavior |
|---|---|---|
| `HTMLAudioElement` | Plays audio in background tab + lock screen | ✅ Supported; subject to OS-level audio session policy |
| MediaSession metadata | Lock-screen "now playing" UI | ✅ Supported — set `title="Rocky · Companion"`, `artist="Hail Mary Chat"`, `artwork=[<rocky-avatar-url>]` |
| MediaSession actions | Play/pause from lock screen | ✅ Supported — wire `play`, `pause`, `stop` |
| Screen Wake Lock API | Prevent screen sleep | ❌ Not supported on iOS Safari (as of iOS 16.4+, partial; before, none). Silent fallback; audio continues regardless. |

### iOS background-kill recovery

iOS will sometimes pause/kill HTMLAudio in background after extended
periods (varies by device, battery state, OS version). On resume:

1. `<audio>` element state is checked on visibility-change event
2. If `paused` and our state says `playing` → show "Tap to resume Rocky"
   toast at bottom of screen
3. One tap re-issues `audio.play()` (which counts as a user gesture
   for autoplay policy)
4. Trigger schedule resumes from current wall-clock offset (no rewind)

---

## 8. Error handling

| Scenario | Behavior |
|---|---|
| Env bed HTTP fetch fails | `error` state, retry button + exit. Triggers don't start without bed. |
| Single trigger fetch fails | Skip silently, log to console; next trigger fires normally. With 20 triggers, one missing isn't user-detectable. |
| Wake Lock API denied | Silent fallback; audio continues; screen may dim per OS settings. No user-facing message (Wake Lock failure on iOS is expected). |
| `endSession()` from chat fails | Show toast "Couldn't end chat cleanly — companion not started"; stay on chat. (Defensive: never strand the user in a half-state.) |
| iOS pauses audio in background | On visibility-change, detect paused state, show "Tap to resume Rocky" |
| Network drops mid-session | Already-loaded audio keeps playing; if a trigger fails to load mid-stream, log + skip + try next |
| User auth state expires | Companion continues (presigned URLs were issued at companion-mount time, 1h expiry — covers all sleep timer durations) |
| Long session > 1h, presigned URL expires | On URL expiry detection (audio fetch 403): re-fetch `/api/companion/asset-urls` and reassign `audio.src`. Seamless if env bed buffer is enough; brief gap acceptable. |

---

## 9. Server / data model

**v1 verdict: one new endpoint, zero new DB tables.**

### `GET /api/companion/asset-urls` (new)

Auth: optional (companion is free for all, but signing presigned
URLs requires server context anyway). Anonymous users get a stub
session token good enough to call this endpoint.

Response:
```json
{
  "env_bed": "https://r2-presigned/.../env-bed-01.mp3?...",
  "triggers": [
    { "id": "hum-01", "url": "https://r2-presigned/.../hum-01.mp3?..." },
    ...
    { "id": "rummage-04", "url": "https://r2-presigned/.../rummage-04.mp3?..." }
  ],
  "expires_at": 1729123456  // unix seconds, 1h from issue
}
```

All 21 URLs in one response. Client caches the response for ~55min
(short of expiry) and re-fetches if it stays past that.

### DB

No new tables. No writes during companion. Defer "who used
companion, how long" to v2 when we want analytics.

### Storage

Asset paths are static: `rocky-audio/companion/v1/env-bed-01.mp3`,
`rocky-audio/companion/v1/triggers/<group>-<n>.mp3`. Uploaded
manually via `edgespark storage` once at v1 ship time. No dynamic
upload path.

---

## 10. Test plan (manual, v1 ship gate)

### Happy path
- [ ] Home → "Stay Connected" → audio starts within 2s on cold cache, ≤0.5s on warm
- [ ] Chat → "Stay On Line" → chat ends + consolidate runs + companion starts
- [ ] Sleep timer 30min → audio fades over last 8s → home
- [ ] Exit button → 8s fade + home

### Background / screen-off
- [ ] Phone lock → audio continues
- [ ] Switch tab → audio continues
- [ ] iOS Safari lock-screen MediaSession shows "Rocky · Companion · MM:SS"
- [ ] MediaSession play/pause from lock screen works
- [ ] iOS long-background pause → resume toast appears → one tap resumes

### Trigger correctness
- [ ] Trigger interval roughly 30s–2min over a 30-min sample
- [ ] No adjacent duplicate triggers in a 30-min sample
- [ ] env bed loops seamlessly (no audible click at boundary)
- [ ] Breathing dot brightens on each trigger fire

### Mutex / coordination
- [ ] In companion → tap home → companion unwinds cleanly
- [ ] In chat with TTS playing → tap "Stay On Line" → TTS stops, companion starts
- [ ] Wake Lock denied (iOS) → audio still plays
- [ ] Network drops 5s then recovers → trigger schedule continues without crash

### Error states
- [ ] Block `/api/companion/asset-urls` → loading → error state → retry works
- [ ] Block env bed URL only → loading → error state → retry works
- [ ] Block one trigger URL → other triggers play normally; that one silently skipped

### Dim toggle
- [ ] Toggle on → UI collapses to bottom-bar only
- [ ] Tap screen in dim mode → full chrome briefly visible (3s auto-redim)
- [ ] localStorage persists across reload

---

## 11. Performance & cost

| | v1 estimate |
|---|---|
| First-load bandwidth | ~8.5 MB |
| Steady-state bandwidth | 0 (assets loop locally) |
| Server CPU per session | ~1 request total (`/api/companion/asset-urls`) |
| R2 GET ops per session | 21 (one per asset, presigned) |
| Cost @ 1k DAU × 30 min/day | R2 GETs: 21k/day, ~$0.01/day; bandwidth: ~0.5 GB/day after cache, ~$0.05/day. Negligible. |

---

## 12. Open questions for plan phase

These get resolved at writing-plans time, not now:

- [ ] **Recon: clippable old material.** Run a 1-pass review of `rocky_voice_human.MP3` + `_2.MP3` and report "x of 20 triggers covered, y need fresh recording, z marginal".
- [ ] **Recon: CC0 ambient candidates.** Identify 3–5 specific Freesound / Pixabay candidates for env bed; verify license + seamless-loopability.
- [ ] **iOS Wake Lock fallback UX.** Confirm exact behavior: do we display anything when Wake Lock is denied, or fully silent? (Currently planned: fully silent.)
- [ ] **`App.tsx` phase machine refactor.** Map the minimal diff for adding `'companion'` phase + state propagation. May reveal opportunity for tighter abstraction; do not over-refactor.
- [ ] **Asset upload mechanism.** `edgespark storage put` from CLI vs commit assets into repo + sync via CI. v1: manual upload via CLI is fine; document the steps in ADMIN.md.
- [ ] **Companion screen accessibility.** Aria labels for breathing dot, screen reader announcements when trigger fires (or NOT — debatable for a meditative mode), keyboard nav for Exit + Sleep timer + Dim toggle.
- [ ] **i18n strings.** New keys for "Stay Connected" / "Stay On Line" / "Sleep timer" / "剩 X 分钟" / etc. across en/zh/ja.

---

## 13. Validation checklist (pre-implementation)

Before plan phase begins, all of these must be ✅:

- [x] Use case (b: study/work/sleep companion) confirmed
- [x] Audio nature (c: non-verbal pre-recorded, Eridian-lore aligned) confirmed
- [x] v1 shape (b: single channel, env bed + triggers) confirmed
- [x] Entry points (c: home CTA + chat "stay on line") confirmed
- [x] Mutual exclusivity (companion ↔ chat) confirmed
- [x] #38 BedtimePlayer paused, lessons absorbed, not folded into companion v1
- [x] Cost / gating (free for all, no affinity gate, no voice_credits) confirmed
- [x] Asset structure (1 env bed + 20 triggers, 30s–2min cadence, no-adjacent-duplicate) confirmed
- [x] Visual surface (a-style default + dim toggle to c-style) confirmed
- [x] Sleep timer defaults (off/15/30/45/60, default 30, 8s fade) confirmed
- [x] No pause/resume in v1 confirmed
- [x] Asset sourcing policy: search online first for env-bed-class assets; Rocky non-verbal must be his voice line (clip existing or record fresh) confirmed

---

## 14. Cross-review status

This spec will go through 3 rounds of cross-review between Claude
and codex before being handed to the user for final approval. Each
round's findings + responses are appended below.

### Round 1
_pending_

### Round 2
_pending_

### Round 3
_pending_

### Consensus
_pending_
