**Top 3 Load-Bearing Concerns**
1. Audio mutex design is not implementable as written. Current [audioPlayback.ts](/Users/yangyihan/Downloads/hail-mary-chat/web/src/utils/audioPlayback.ts:51) has untyped `claimSlot()` and tracks one bound `Audio`, but companion wants two `HTMLAudioElement`s.
2. Chat → companion transition is wrong. [endSession()](/Users/yangyihan/Downloads/hail-mary-chat/web/src/utils/sessionApi.ts:88) is fire-and-forget and swallows failures, so the spec’s “stay on chat if end fails” behavior cannot happen.
3. Free anonymous presign endpoint has no abuse story. One script can repeatedly mint 21 URLs and drive R2 GET/bandwidth costs.

**Findings**
- BLOCK §6.1: Spec invents `claimSlot('companion')`, `releaseSlot('companion')`, and slot types, but current API has no type parameter and one global token. `attachAudio()` replaces `currentBound` without stopping a previous same-token bound audio. Two companion elements would either be invisible to the mutex or leak/overlap. Suggested fix: redesign `audioPlayback` for explicit owners + multiple bound elements, or make companion a single managed/mixed audio source.

- BLOCK §2/§4/§8: Chat handoff depends on awaitable `endSession()`, but current `endSession` returns `void`; ChatInterface hangup immediately calls `onBack()` after a meaningless `try/catch`. Suggested fix: add an awaitable `endSessionStrict()` or change the spec to accept best-effort consolidation.

- BLOCK §9/§11: `/api/companion/asset-urls` is optional-auth and free, but no per-IP/device/session rate limit, bot gate, cache key strategy, or abuse logging is specified. Existing visible bot defense is register-only. Suggested fix: add rate limits before plan phase, preferably IP+device hourly caps and cacheable public/static asset delivery where possible.

- FIX §2/§4: App integration claim is stale. [App.tsx](/Users/yangyihan/Downloads/hail-mary-chat/web/src/App.tsx:12) uses `start | chat | echo | favorites`, not `home`; `home` is internal to StartScreen. Suggested fix: specify exact `AppPhase` and callback changes.

- FIX §7: Autoplay is under-specified. Companion starts after async fetches using new `Audio` objects; on iOS/Safari that may reject unless playback is tied to a user gesture or pre-unlocked element. Suggested fix: synchronous tap-to-start/unlock path and explicit `play().catch(NotAllowedError)` UI.

- FIX §7: MediaSession claims are too strong. Repo has no existing `mediaSession` pattern from `rg`; MDN marks MediaSession limited availability. “MM:SS” lock-screen display is not guaranteed by metadata alone. Suggested fix: feature-detect, wrap unsupported handlers, test real iOS Safari, and clear handlers on unmount.

- FIX §4/§8: Sleep timer repeats PR #38 ambiguity. It mixes countdown, wall-clock resume, paused background audio, and playback fade without defining whether time advances while audio is paused/killed. Suggested fix: choose wall-clock or playback-time and test pause/background cases.

- FIX §5/§10: PR #38 lessons not fully absorbed. No Escape-key behavior, no reduced-motion requirement for breathing dot/boost/auto-redim, and accessibility is deferred to open questions. Suggested fix: make these v1 acceptance criteria.

- FIX §10/§13: Test plan is almost entirely manual. No unit tests for scheduler no-adjacent-duplicate, timer math, stale-token cleanup, URL expiry retry, or endpoint rate limiting. Suggested fix: add automated hook/util tests plus server tests.

- FIX §11: Cache/cost estimate is suspect. Presigned URLs usually vary by query string, so “same R2 object keys” does not guarantee browser cache hits. 1k cold users × 8.5 MB is ~8.5 GB, not 0.5 GB. Suggested fix: use immutable public/CDN URLs or prove cache headers/key behavior.

- FIX §3: 3-6 asset days is optimistic. License review, loop QA, normalization, device checks, and missing mp3 renders are real work. Suggested fix: split recon from production and include asset acceptance criteria.

- NIT §13: “#38 lessons absorbed” is prematurely checked. The spec still repeats audio integration, reduced motion, Escape, timer, and render/asset gaps.

**Final Verdict**
needs revision before plan phase

Sources used for browser/API checks: MDN Autoplay Guide, MDN MediaSession, MDN Screen Wake Lock.
