# Companion Mode v1 — Design

_Date: 2026-05-19 (revised after 3-round Claude × codex cross-review)_
_Status: design **approved** by user — ready for plan phase_
_Author: Claude (brainstormed with @yangyihan)_
_Cross-review transcripts: `docs/superpowers/specs/companion-review/`_

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
- **Zero marginal cost**: static assets shipped with web build, no
  LLM, no TTS spend.
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
- Pause/resume controls — user can Exit or wait for sleep timer

---

## 2. Architecture

```
[Client]
  ├─ CompanionScreen.tsx        (new — full-screen surface)
  ├─ useCompanionAudio.ts       (new — env loop + trigger scheduler + sleep timer)
  ├─ wakeLock.ts                (new, ~30 LOC — Screen Wake Lock API w/ iOS fallback)
  └─ MediaSession metadata      (new — feature-detected, best-effort)

[Existing modified for companion]
  ├─ App.tsx                    (AppPhase += 'companion'; new onCompanion/onStayOnLine handlers)
  ├─ StartScreen.tsx            (new "STAY CONNECTED" / "陪着我" CTA)
  ├─ ChatInterface.tsx          (new "STAY ON LINE" status-actions button)
  └─ useRockyTTS.ts             (cleanup: set cancelledRef=true on unmount — fixes
                                 latent bug, see §6)

[Server]
  └─ no changes — assets shipped as static via web build

[Web public assets — shipped in deploy bundle]
  web/public/audio/companion/v1/
  ├─ env-bed-01.mp3                       (~10 min, ~7 MB, seamless loop, 96kbps)
  └─ triggers/                            (20 short clips, ~1.5 MB total, 128kbps)
      ├─ hum-{01..04}.mp3
      ├─ tap-{01..04}.mp3
      ├─ scrape-{01..04}.mp3
      ├─ breath-{01..04}.mp3
      └─ rummage-{01..04}.mp3
```

**Total first-load weight: ~8.5 MB.** Served by the EdgeSpark Worker
as static assets, same path mechanism as existing
`web/public/audio/defaults/` (already serving ~2 MB of TTS preset
clips today). After first load, browser cache holds them indefinitely
(see §11 for Cache-Control verification task).

### Component responsibilities

| Component | Type | Responsibility |
|---|---|---|
| `CompanionScreen.tsx` | new | Full-screen surface. Renders state-aware UI (loading / ready / playing / fading) + breathing dot + elapsed counter + sleep-timer control + Exit + Dim toggle. On mount: `audioPlayback.claimSlot()` (stops any audio that survived the navigation tick). On unmount: `releaseSlot()` + ensure both internal audios are paused/nulled. |
| `useCompanionAudio.ts` | new | Two `HTMLAudioElement`s — base loop (`loop=true`) + single trigger element (reassigned per trigger). 30s–2min random interval scheduler with "no adjacent duplicates" guarantee. Sleep timer (wall-clock, see §5.2). States: `loading / ready / playing / fading / done / error`. |
| `wakeLock.ts` | new | `navigator.wakeLock.request('screen')` wrapper. Silent fallback when unsupported (iOS Safari). |
| `useRockyTTS.ts` | **modified** | Unmount cleanup adds `cancelledRef.current = true` (option B from cross-review). Fixes a latent race where the speak() Promise chain could continue playing TTS chunks after ChatInterface unmounts. Affects all unmount paths, not just companion — but the bug shows up most acutely at chat→companion handoff. |
| `audioPlayback.ts` | **unchanged** | Existing single-slot mutex API used as-is. Companion calls `claimSlot()` on mount, `releaseSlot()` on unmount. No new API surface. UI-phase mutex guarantees only one of {chat, echo, favorites, companion} is mounted at a time. |
| `StartScreen.tsx` | modified | Add third CTA "STAY CONNECTED" / "陪着我" below `DIAL IN` / `OPEN CHANNEL` row. Calls `onCompanion` prop. |
| `ChatInterface.tsx` | modified | Add icon button "STAY ON LINE" in `status-actions` row near red hangup. Handler calls `stopTTS()` + `endSession()` (fire-and-forget) + `onStayOnLine()`. The explicit `stopTTS()` belt-and-suspenders alongside the §6 strengthened cleanup. |
| `App.tsx` | modified | `AppPhase` becomes `'start' \| 'chat' \| 'echo' \| 'favorites' \| 'companion'`. Phase transitions enforce mutual exclusivity. |

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
| Rocky non-verbal triggers | n/a — must be Rocky's voice line, not findable online | Scan `rocky_voice_human.MP3` + `rocky_voice_human_2.MP3` for clippable non-verbal segments. Optimistic estimate: ~10 of 20 triggers come from existing material. | Studio session for the rest (1–2 days). |

### Asset versioning for cache busting

Assets ship at `/audio/companion/v1/...`. **Replacements bump the
path version** (`v1` → `v2`). Old URLs naturally orphan; browsers
holding the immutable-cached v1 just keep playing it forever (their
choice, no harm). Resolves the "immutable URL = forever-bad-cache"
risk codex flagged in R2.

### Production estimate

| Phase | Duration | Notes |
|---|---|---|
| Recon: scan old recordings + Freesound search | 1–2 days | Deliverable: a markdown report listing N triggers covered by clipping, M needing fresh recording, top 3 env bed candidates |
| Production: clip + record + env bed remix + mix | 3–5 days | Depends on recon outcome |
| Integration QA: real iOS device + various network | 1 day | Test plan §10 executed on real device |
| **Total** | **5–8 working days** | |

---

## 4. UX state machine

```
[home / chat]
   │  CTA: "Stay Connected"  (home)
   │  CTA: "Stay On Line"    (chat → stopTTS() + endSession() first)
   ↓
[loading]
   ← Fetching env bed + at least 4 triggers (rest lazy)
   ← UI: breathing dot + "Tuning in..." text
   ↓  env bed + ≥4 triggers loaded
[ready]
   ← UI: large centered "TAP TO START" button
   ← Sleep-timer pill visible below button (selectable, default 30 min)
   ← Exit button top-right
   ↓  user taps "TAP TO START"
   ← Inside the tap handler (synchronous gesture context):
     create base+trigger Audio elements, set src, play().
     This satisfies iOS Safari's gesture-tied autoplay policy.
   ↓
[playing]
   ← Trigger scheduler running (30s–2min cadence)
   ← Sleep-timer countdown begins NOW (not during loading/ready)
   ↓  user taps Exit  |  sleep timer hits 0
[fading]
   ← 8s linear ramp of base volume → 0
   ← Trigger scheduler stopped immediately
   ↓  8s elapsed
[done]
   ↓
[home]

side branch:
[error]   ← env bed fetch failed | network gone
   ↓     UI: error msg + retry button + exit
   retry → [loading]
```

### Phase transitions

| From | To | Trigger |
|---|---|---|
| `home` | `loading` | user taps "Stay Connected" |
| `chat` | `loading` | user taps "Stay On Line": (1) `stopTTS()`, (2) `endSession(sessionId)` fire-and-forget, (3) navigate to companion |
| `loading` | `ready` | env bed + ≥4 triggers loaded |
| `loading` | `error` | env bed fetch fails (5s timeout or HTTP error) |
| `ready` | `playing` | user taps "TAP TO START"; audio elements created and `play()` called inside this gesture handler; sleep timer countdown begins on entering this state |
| `playing` | `fading` | user Exit \| sleep timer = 0 |
| `fading` | `done` | 8s fade elapsed |
| `done` | `home` | automatic |
| `error` | `loading` | retry |
| `error` | `home` | exit |

---

## 5. UI specs

### 5.1 Default chrome ("a-style", `companionDim=false`)

```
┌─────────────────────────────────────┐
│  ☾                                ✕ │  ← dim toggle (top-left) | exit (top-right)
│                                     │
│              ◯                      │  ← breathing dot (slow pulse, 4s cycle)
│           Rocky · 在                 │  ← static label
│                                     │
│            32:14                    │  ← elapsed time, large (during playing)
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ⏱ Sleep timer · 剩 23:14  │   │  ← sleep-timer pill (tappable opens picker)
│  └─────────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 Ready state — Tap-to-Start

```
┌─────────────────────────────────────┐
│  ☾                                ✕ │
│                                     │
│              ◯                      │  ← breathing dot
│           Rocky · 准备好了           │
│                                     │
│      ┌─────────────────────┐        │
│      │   ▶ TAP TO START    │        │  ← large centered button
│      └─────────────────────┘        │
│                                     │
│       Sleep timer: 30 min ▾         │  ← selectable
│                                     │
└─────────────────────────────────────┘
```

User tap on TAP TO START handler:

```ts
const handleStart = () => {
  // Synchronous gesture context — iOS autoplay unlock happens here
  const base = new Audio(BASE_URL);
  base.loop = true;
  const trigger = new Audio();  // src assigned per-fire
  // Both elements live for the lifetime of useCompanionAudio
  startCompanionAudio({ base, trigger });
  setPhase('playing');  // sleep timer counts down from here
};
```

### 5.3 Dim chrome ("c-style", `companionDim=true`)

```
┌─────────────────────────────────────┐
│                                     │
│           (nearly black)            │
│                                     │
│                                     │
│                                     │
│  🛰 Rocky · 32:14 · 剩 23 min        │  ← bottom bar only, low-contrast
└─────────────────────────────────────┘
```

The dim chrome reuses the same React component tree; only the styles
collapse + opacity drop. Tapping anywhere on screen toggles back to
full chrome briefly (3s auto-redim) for sleep-timer adjustment.

### 5.4 Sleep timer

| | |
|---|---|
| Options | `off / 15 / 30 / 45 / 60 min` |
| Default | `30 min` |
| UI | bottom-bar pill displays `剩 23:14` countdown during `playing` |
| Semantics | **Wall-clock**. Counts down based on `Date.now()` deltas. If iOS pauses audio in background, timer continues. If user returns from background past timer-zero, immediately fire fade + done. Reasoning: user mental model is "turn off in 30 min", not "play 30 min of audio". |
| Countdown begins | On transition into `playing` state. **NOT** during `loading` or `ready`. |
| Behavior at 0 | 8s base-volume linear fade to 0 → stop both audios → return to home |
| Re-selecting same option | Closes picker (no reset) |
| Selecting different option | Resets countdown from new value (does NOT accumulate) |

### 5.5 Dim toggle

- 月亮 icon top-right
- Toggles `companionDim` state, persisted in `localStorage.companionDim`
- Off (default a-style) — full chrome
- On (c-style) — collapsed bottom bar only
- Tapping screen in dim mode → full chrome briefly visible 3s, then auto-redim

### 5.6 Breathing dot

- Pure CSS: `box-shadow` + `opacity` keyframe, 4s cycle, ease-in-out
- On every Rocky trigger fire: brief 300ms brightness boost (subliminal audio-visual coupling)
- **`prefers-reduced-motion: reduce` override**: static 50% opacity, no pulse, no trigger boost

### 5.7 Accessibility (v1 ship gates)

- Escape key closes companion at any phase (modeled on existing `ChatInterface` hangup-confirm pattern at `web/src/components/ChatInterface.tsx:679`)
- All buttons have `aria-label` for screen readers
- Keyboard navigation: Tab cycles through Exit → Sleep timer → Dim toggle → (in `ready`) Tap to Start
- Focus management: on mount, focus the Tap to Start button (when ready) or Exit button (when playing)
- `prefers-reduced-motion: reduce`: overrides on breathing dot pulse, trigger boost, dim-toggle auto-redim animation, fade-out transitions

---

## 6. Audio coordination

**Decision after cross-review: no audioPlayback API extension. Rely on UI-phase mutex.**

Original Round 1 proposal was to add `claimSlot({ onSlotLost })` to
audioPlayback.ts so companion would auto-pause if a TTS source tried
to claim the slot. codex correctly identified that `useRockyTTS`
doesn't go through `claimSlot` (it owns `ttsAudioRef` directly), so
the `onSlotLost` callback would never fire. Adding the API would be
dead code.

**Real contract:**

1. **UI mutex**: App.tsx phase machine ensures only one of `chat /
   echo / favorites / companion` is mounted. When `phase` transitions
   to `'companion'`, the prior phase component unmounts; `useRockyTTS`
   inside ChatInterface or EchoInterface is destroyed.

2. **Companion claims the audio slot on entry**: existing
   `claimSlot()` (no opts) is called when CompanionScreen mounts.
   This invokes `stopActiveAudio()` + `stopSharedAudio()`, which kills
   any preset-audio singleton that the previous phase may have left
   playing. Returns a token; companion stores it but never uses it
   (no `attachAudio` calls).

3. **Companion manages its two audios internally**: `useCompanionAudio`
   holds `baseAudioRef` and `triggerAudioRef`. Never goes through
   `audioPlayback.attachAudio`. Trigger reassignment happens on the
   single trigger element by setting `.src` and calling `.play()`.

4. **Companion releases on unmount**: `releaseSlot()` for symmetry
   (which bumps the global token, preventing any stale
   `attachAudio` from a hypothetical earlier slot owner). Then
   explicitly pause + null both internal audios.

### The latent useRockyTTS bug — fixed alongside (option B from cross-review)

`useRockyTTS`'s useEffect cleanup currently:
- aborts in-flight fetch
- stops shared audio singleton
- pauses + nulls ttsAudioRef
- but does **NOT** set `cancelledRef.current = true`

This means a mid-flight `speak()` Promise chain can continue past
unmount: e.g., mood audio completes → next `await` in chain reads
`cancelledRef.current === false` → fetches next TTS chunk → attaches
to a *new* Audio element (because the old one was nulled in cleanup)
→ plays. After chat → companion handoff, this plays during companion.

**Fix as part of this PR**: add `cancelledRef.current = true` to the
useEffect cleanup in `useRockyTTS.ts`. One line. Affects ALL
unmount paths, fixing a latent bug for chat → home / chat → favorites
in addition to chat → companion.

**Regression risk**: low. Setting cancelledRef=true on unmount is
the obvious correctness fix — current code is implicitly relying on
the fact that ttsAudioRef being nulled stops the audio mid-chunk,
but the chain itself isn't cancelled. The change makes intent
explicit.

**Belt-and-suspenders**: ChatInterface's "Stay On Line" handler
ALSO calls `stopTTS()` explicitly before navigating, so the cleanup
fix is redundant in this specific path (but necessary for other
unmount paths to be safe).

---

## 7. Background playback (screen off / lock / app-background)

| Mechanism | Purpose | Reality on iOS Safari |
|---|---|---|
| `HTMLAudioElement` | Plays audio in background tab + lock screen | ✅ Supported; subject to OS-level audio session policy. Verified empirically — PR #38 used the same approach successfully on its test path. |
| MediaSession metadata | Lock-screen "now playing" UI | ⚠️ **Feature-detect required**. Repo currently has zero MediaSession usage. Plan-phase task: wrap `'mediaSession' in navigator` check, set `title="Rocky · Companion"`, `artist="Hail Mary Chat"`, `artwork=[<rocky-avatar-url>]`. Lock-screen MM:SS display is best-effort, validated only via real-device QA. |
| MediaSession actions | Play/pause from lock screen | ⚠️ Feature-detect each action. Wire `pause`/`stop` only (no seekto/prev/next per #38 lesson — those weren't useful for companion since there are no "tracks"). Clear handlers on unmount. |
| Screen Wake Lock API | Prevent screen sleep | ❌ Not supported on iOS Safari as of writing. Silent fallback — companion mode doesn't need the screen on. |

### iOS background-kill recovery

iOS will sometimes pause HTMLAudio in background after extended
periods (varies by device, battery state, OS version). On resume:

1. On `visibilitychange` to visible, check `<audio>` paused state
2. If paused but our state says `playing` → show "Tap to resume Rocky"
   toast at bottom of screen
3. One tap re-issues `audio.play()` (counts as user gesture)
4. Trigger schedule resumes from current wall-clock offset

---

## 8. Error handling

| Scenario | Behavior |
|---|---|
| Env bed HTTP fetch fails (5s timeout or error) | `error` state. Retry button + Exit. Triggers don't start without bed. |
| Single trigger fetch fails | Skip silently, log to console; next trigger fires normally. With 20 triggers, one missing isn't user-detectable. |
| Wake Lock API denied | Silent fallback; audio continues; screen may dim per OS settings. No user-facing message. |
| `endSession()` fails (defensive) | Unobservable per API contract — `endSession` is fire-and-forget void. Spec does NOT depend on its success. |
| iOS pauses audio in background | On `visibilitychange`, detect paused state, show "Tap to resume Rocky" |
| Network drops mid-session | Already-loaded audio keeps playing. Failed trigger fetches log + skip. |
| User auth state expires | Companion continues — assets are static, no auth required. |
| Mid-flight TTS from chat session | Handled by §6 (a) explicit `stopTTS()` in handler, (b) strengthened `useRockyTTS` cleanup, (c) UI-phase mutex. Three layers of defense. |

---

## 9. Server / data model

**v1: zero server work. Zero new DB tables. Zero new endpoints.**

- Assets served as static `web/public/audio/companion/v1/*` by the
  EdgeSpark Worker, same path mechanism used today for
  `web/public/audio/defaults/*` (TTS preset clips already in production).
- No `/api/companion/asset-urls` endpoint (Round 1 idea, killed in Round 2).
- No new `companion_sessions` table. Companion doesn't move rapport,
  doesn't generate messages, doesn't track usage. Defer analytics
  to v2.
- No presigning, no rate-limiting needed.

---

## 10. Test plan

### 10.1 Automated unit tests (v1 ship gate)

**Add Vitest harness to web/ as part of v1.** Currently no test
runner is configured on the client.

```
web/
├─ package.json        (+ vitest, @vitest/ui, jsdom, @testing-library/react)
├─ vitest.config.ts    (new — jsdom env, ts paths, css mocks)
└─ src/
   └─ __tests__/
      ├─ companionScheduler.test.ts
      │  ├─ pickNextTrigger never returns the most-recent
      │  ├─ over 1000 picks, intervals fall within [30s, 120s]
      │  └─ distribution doesn't pin to one extreme
      ├─ companionSleepTimer.test.ts
      │  ├─ wall-clock decrement (vi.useFakeTimers + advanceTime)
      │  ├─ fade entry at 8s-remaining mark
      │  ├─ terminal `done` state is idempotent on extra advance
      │  └─ background resume past zero immediately fires done
      └─ useRockyTtsCleanup.test.ts
         ├─ unmounting sets cancelledRef=true
         ├─ in-flight speak() Promise chain aborts cleanly post-unmount
         └─ ttsAudioRef pause + null still happens (regression guard)
```

Add `npm test` script. CI hook is plan-phase (not v1 blocker).

### 10.2 Manual test plan (v1 ship gate)

**Happy path**
- [ ] Home → "Stay Connected" → loading → ready → "Tap to Start" → audio starts
- [ ] Chat → "Stay On Line" → chat ends + consolidate runs + loading → ready
- [ ] Sleep timer 30min → audio fades over last 8s → home
- [ ] Exit button → 8s fade + home

**Background / screen-off**
- [ ] Phone lock → audio continues
- [ ] Switch tab → audio continues
- [ ] iOS Safari lock-screen MediaSession shows "Rocky · Companion · MM:SS" (best-effort)
- [ ] MediaSession pause/stop from lock screen works
- [ ] iOS long-background pause → resume toast appears → one tap resumes

**Trigger correctness**
- [ ] Trigger interval roughly 30s–2min over a 30-min sample
- [ ] No adjacent duplicate triggers in a 30-min sample
- [ ] env bed loops seamlessly (no audible click at boundary — listen to 20 boundaries)
- [ ] Breathing dot brightens on each trigger fire

**Mutex / audio coordination**
- [ ] In companion → navigate home → companion unwinds cleanly (audio stops)
- [ ] In chat with TTS playing → tap "Stay On Line" → TTS stops, companion loads
- [ ] In chat with TTS mid-Promise-chain (mood audio playing) → tap "Stay On Line" → no leaked TTS audio
- [ ] Wake Lock denied (iOS) → audio still plays
- [ ] Network drops 5s then recovers → trigger schedule continues without crash

**Error states**
- [ ] Block env bed URL (DevTools) → loading → error state → retry works
- [ ] Block one trigger URL → other triggers play normally; that one silently skipped
- [ ] Cold load with all DevTools network throttle → loading shows >2s

**Dim toggle + accessibility**
- [ ] Toggle on → UI collapses to bottom-bar only
- [ ] Tap screen in dim mode → full chrome briefly visible (3s auto-redim)
- [ ] localStorage persists across reload
- [ ] `prefers-reduced-motion: reduce`: breathing dot static, no trigger boost, no fade transitions
- [ ] Escape key closes companion at any phase
- [ ] Tab order: Exit → Sleep timer → Dim toggle → (in ready) Tap to Start
- [ ] Focus visible on each tabbable element

---

## 11. Performance & cost

| | v1 estimate |
|---|---|
| First-load bandwidth | ~8.5 MB per cold device |
| Steady-state bandwidth | 0 (browser cache via stable URL + Cache-Control) |
| Server CPU per session | 0 (static asset path) |
| Backend ops per session | 0 (no API endpoint) |
| Cost @ 1k DAU × 30 min/day | Negligible. Worst case if every user is cold-cache: ~8.5 GB/day; realistic with returning-user ratio: <1 GB/day. Within EdgeSpark default tier. |

**Plan-phase verification**: confirm EdgeSpark Worker sets long
Cache-Control on `web/public/*` via:

```
curl -I https://teaching-collie-6315.edgespark.app/audio/defaults/greeting_zh.mp3
```

If Cache-Control is missing or short, add explicit Worker route
config for the `/audio/companion/v1/*` prefix.

---

## 12. Open questions for plan phase

These get resolved at writing-plans time, not now:

1. **Recon: clippable old material.** Run a 1-pass review of `rocky_voice_human.MP3` + `_2.MP3` and report "X of 20 triggers covered, Y need fresh recording, Z marginal". Deliverable: markdown report in `docs/superpowers/specs/companion-recon.md`.
2. **Recon: CC0 ambient candidates.** Identify 3–5 specific Freesound/Pixabay candidates for env bed; verify license + loopability. Same report.
3. **EdgeSpark Worker static asset Cache-Control defaults.** Verify via `curl -I` (per §11).
4. **App.tsx phase machine refactor.** Map the minimal diff for adding `'companion'` phase + onCompanion/onStayOnLine handlers. May reveal opportunity for tighter abstraction; do not over-refactor.
5. **i18n strings.** New keys for "Stay Connected" / "Stay On Line" / "TAP TO START" / "Sleep timer" / "剩 X 分钟" / etc. across en/zh/ja.
6. **Vitest config specifics.** jsdom env, asset/css mocks, ts paths. ~30 LOC config file.

---

## 13. Validation checklist (pre-implementation, all ✅ after cross-review)

- [x] Use case (b: study/work/sleep companion) confirmed
- [x] Audio nature (c: non-verbal pre-recorded, Eridian-lore aligned) confirmed
- [x] v1 shape (b: single channel, env bed + triggers) confirmed
- [x] Entry points (c: home CTA + chat "stay on line") confirmed
- [x] Mutual exclusivity (companion ↔ chat) confirmed
- [x] #38 BedtimePlayer paused, lessons absorbed, not folded into companion v1
- [x] Cost / gating (free for all, no affinity gate, no voice_credits) confirmed
- [x] Asset structure (1 env bed + 20 triggers, 30s–2min cadence, no-adjacent-duplicate) confirmed
- [x] Visual surface (a-style default + dim toggle to c-style) confirmed
- [x] Sleep timer defaults (off/15/30/45/60, default 30, wall-clock, fade entry on last 8s) confirmed
- [x] No pause/resume in v1 confirmed
- [x] Asset sourcing policy: search online first for env-bed-class assets; Rocky non-verbal must be his voice line (clip existing or record fresh) confirmed
- [x] Asset hosting: `web/public/audio/companion/v1/` static, versioned for cache busting
- [x] Autoplay: explicit "Tap to Start" UX (no warm-up tricks)
- [x] Audio coordination: UI-phase mutex (no audioPlayback API extension)
- [x] Latent useRockyTTS unmount bug: fixed in this PR (option B, root-cause fix)
- [x] Test harness: Vitest + jsdom + RTL added as part of v1
- [x] Accessibility: Escape + reduced-motion + aria + focus management as v1 gates

---

## 14. Cross-review history

3-round Claude × codex cross-review completed. Full transcripts:

- `docs/superpowers/specs/companion-review/round-1-codex.md`
- `docs/superpowers/specs/companion-review/round-2-claude.md`
- `docs/superpowers/specs/companion-review/round-2-codex.md`
- `docs/superpowers/specs/companion-review/round-3-claude.md`
- `docs/superpowers/specs/companion-review/round-3-codex.md`
- `docs/superpowers/specs/companion-review/CONSENSUS.md`

Consensus reached on all 12 review findings. Fix 1 (audio mutex)
resolved as option B (strengthen `useRockyTTS` unmount cleanup) per
user decision 2026-05-19.
