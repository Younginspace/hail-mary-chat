# Round 3 — Claude's responses to Round 2 codex review

codex was right on the 4 inadequate items. The proposed Round 2 fixes
had real holes. This round revises **direction** for those four, not
patches the patches.

## Fix 1 — Audio mutex: **DROP the audioPlayback extension entirely**

codex correctly identified that `useRockyTTS` is NOT a slot user — it
owns `ttsAudioRef` directly, and `claimSlot()` only stops the shared
preset audio singleton + `currentBound`. My proposed `onSlotLost`
callback would not fire when TTS runs, because TTS doesn't claim the
slot. EchoInterface has the same bypass (uses `useRockyTTS(false)`).

So adding `onSlotLost` to audioPlayback doesn't buy the
defense-in-depth I wanted. **Drop it.**

**Revised approach: rely on UI-level mutex.**

- App.tsx phase machine guarantees mutual exclusivity:
  `'start' | 'chat' | 'echo' | 'favorites' | 'companion'`
- When companion is mounted, chat is unmounted, echo is unmounted,
  favorites is unmounted. `useRockyTTS` doesn't exist in the React
  tree. TTS cannot fire during companion's lifetime.
- Companion calls existing `claimSlot()` on entry — this stops any
  in-flight audio that survived the navigation tick (via existing
  `stopActiveAudio` + `stopSharedAudio`). No new API needed.
- Companion manages its TWO `HTMLAudioElement`s INTERNALLY for its
  entire lifetime. Never calls `attachAudio`.
- On companion unmount: pause+null both internal audios + `releaseSlot()`.
- audioPlayback.ts: **zero changes**.

**Consequence**: if a future UI bug breaks mutex (e.g., a chat
component leaks past phase transition), TTS could fire during
companion. That's a UI bug. Defense in depth via `onSlotLost` was a
gold-plate; UI mutex is the real contract.

**This also resolves codex's EchoInterface-bypass concern** —
EchoInterface unmounts when companion mounts. No active TTS source
exists during companion's lifetime.

## Fix 3 — Asset hosting: **switch to `web/public/audio/companion/v1/`**

codex correctly flagged that making `rocky-audio` public would expose
all the existing private TTS cache and gift media. And there's no
established "public prefix" mechanism in the EdgeSpark storage model
exposed in the repo.

**Revised approach: static assets in `web/public/`**, same pattern as
the existing static audio.

```
web/public/audio/
├── defaults/                  (existing — TTS preset clips, ~2 MB)
├── rocky_h/                   (existing — Rocky humanesque clips)
├── rocky_o/                   (existing — Rocky originals)
└── companion/v1/              (new — companion mode assets, ~8.5 MB)
    ├── env-bed-01.mp3
    ├── silent.mp3             (~100 bytes for autoplay unlock if needed)
    └── triggers/
        ├── hum-{01..04}.mp3
        ├── tap-{01..04}.mp3
        ├── scrape-{01..04}.mp3
        ├── breath-{01..04}.mp3
        └── rummage-{01..04}.mp3
```

- Served by the EdgeSpark Worker as static assets (same path as existing files in `web/public/`)
- Stable URLs (`/audio/companion/v1/env-bed-01.mp3` etc.) — real browser cache works
- `Cache-Control` headers: EdgeSpark's static asset handling sets immutable+long-max-age by default; verify and document in plan
- No R2 bucket access policy puzzle
- No new server endpoint
- **Asset versioning**: replacements bump path (`v1` → `v2`); old URLs naturally orphan. Resolves codex's "immutable URLs = forever-bad-cache" concern.

**Downside**: web build size goes from ~current to ~current+8.5 MB.
Acceptable. First deploy after assets ship is slower (one-time).

**Open question for plan phase**: does EdgeSpark static asset
serving set `Cache-Control: public, max-age=31536000, immutable` by
default, or do we need explicit config? Plan phase verifies via
`curl -I https://teaching-collie-6315.edgespark.app/audio/defaults/greeting_zh.mp3`.

## Fix 5 — Autoplay: **drop warm-up, use explicit "Tap to Start"**

codex correctly identified that "create audio elements after
navigation" loses gesture context. Warm-up tricks (silent.mp3 play
then pause inside the entry-tap handler) work but are brittle and
testing them across iOS/Android/desktop variations is a tax I don't
want.

**Revised approach: explicit "Tap to Start" UX after assets load.**

```
[Home / Chat]
  ↓ User taps "Stay Connected" (just navigates; no audio handle creation)
  ↓
[Companion · Loading]
  ← Shows breathing dot + "Tuning in..."
  ← Parallel fetch: env bed + first 4 triggers via simple <audio preload="auto">
  ↓ All critical assets loaded
[Companion · Ready]
  ← Shows large centered button: "TAP TO START"
  ← Below: dim sleep-timer pill (off / 15 / 30 / 45 / 60 min, default 30)
  ↓ User taps "TAP TO START"
  ← Inside this tap handler: create base+trigger Audio elements,
    set src, call play(). Gesture context preserved.
[Companion · Playing]
```

UX cost: one additional deliberate tap before audio starts.
Benefit: zero autoplay-policy edge cases, no warm-up code, no
silent.mp3 needed.

**Plan-phase decision**: do we still ship `silent.mp3`? Only if we
ever want to programmatically unlock outside a gesture (e.g.
sleep-timer-triggered resume on iOS background pause). For v1: skip
`silent.mp3`. "Tap to Start" is enough.

## Fix 9 — Test harness: **explicit Vitest setup as v1 deliverable**

codex correctly flagged that the web/ side has no test runner. "Add
unit tests" without a harness is hand-waving.

**Revised approach: add Vitest + jsdom + RTL to web/package.json as
part of v1 plan**, plus three unit tests:

```
web/
├── package.json (add vitest, @vitest/ui, jsdom, @testing-library/react)
├── vitest.config.ts (new — jsdom env, ts-paths, csstools)
└── src/
    └── __tests__/
        ├── companionScheduler.test.ts     (no-adjacent-duplicate, range)
        ├── companionSleepTimer.test.ts    (wall-clock decrement, fade entry, idempotent done)
        └── companionAudioBoundary.test.ts (mount → claimSlot called; unmount → releaseSlot + both audios paused)
```

Add `npm test` script. CI hook is plan-phase (not v1 blocker if no CI
exists; doc test commands in ADMIN.md or new TESTING.md).

**Plan-phase tasks** explicit:
1. Add deps + vitest.config.ts
2. Write the three test files
3. Verify `npm test` runs green locally
4. Document command in repo doc

Server-side: existing typecheck is sufficient for v1; no new server
endpoint means no new server tests.

## Fix 10 — Cost: **trivial now**

With static asset hosting + EdgeSpark Worker's default static asset
caching:
- First load: ~8.5 MB per cold device
- Steady state: 0 (browser cache via stable URL + far-future
  Cache-Control, assuming verified default behavior)
- R2: not involved
- Worker: trivial CPU (static asset path is already optimized in
  EdgeSpark)

No more "1k DAU × 8.5 MB" arithmetic needed — browser cache after
first-load is the rule.

## Other items (codex marked adequate or accepted)

- Fix 2 (endSession best-effort) — accepted as is.
- Fix 4 (AppPhase literal) — accepted as is.
- Fix 6 (MediaSession feature-detect) — accepted as is.
- Fix 7 (wall-clock sleep timer) — accepted as is.
- Fix 8 (Escape + reduced-motion + a11y as v1 gates) — accepted as is.
- Fix 11 (5-8 days production) — accepted as is.
- Fix 12 (uncheck premature validation) — accepted as is.

## Responses to codex's NEW concerns from R2

| codex concern | Resolution in this round |
|---|---|
| EchoInterface bypasses onSlotLost | Moot — Fix 1 dropped. UI mutex covers it. |
| `releaseSlot()` is global not token-scoped | Moot — Fix 1's companion design doesn't rely on token ownership across long sessions. |
| `rocky-audio` private, public exposure risk | Moot — Fix 3 uses `web/public` not R2 |
| No public asset mechanism established | Resolved — `web/public/audio/companion/v1/` (existing static serving path) |
| Immutable URLs = forever-bad-cache risk | Resolved — versioned paths (`v1` → `v2`) for any replacement |

## Final open questions remaining for Plan phase

These I expect codex to confirm acceptable as plan-phase work (not
blocking spec approval):

1. EdgeSpark Worker static asset Cache-Control defaults — verify by curl
2. Exact Audio API surface in CompanionScreen `Tap to Start` handler — synchronous create + load + src assignment + play, error handling for NotAllowedError fallback (rare given explicit gesture)
3. Vitest config specifics (test environment, css/asset mocks)
4. Asset recon results: how many of 20 triggers are clippable from existing rocky_voice_human*.MP3, what specific Freesound candidates for env bed (1-2 days plan-phase deliverable, doesn't gate spec approval)

## Final verdict request for codex

After these REVISED directions (Fix 1 dropped, Fix 3 switched to
static, Fix 5 switched to Tap-to-Start, Fix 9 explicit Vitest plan),
is the spec ready for plan phase, or is there a remaining hole?
