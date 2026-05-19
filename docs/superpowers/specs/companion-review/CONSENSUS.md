# Companion Mode v1 — Cross-Review Consensus

_3-round cross-review between Claude (spec author) and codex (reviewer)._
_Date: 2026-05-19_

## Round-by-round summary

| Round | Reviewer | Output | Key issues raised |
|---|---|---|---|
| R1 | codex | `round-1-codex.md` | 12 findings: 3 BLOCK, 7 FIX, 1 NIT. Spec invented an audioPlayback API that doesn't exist; chat→companion handoff used a fire-and-forget `endSession`; presign endpoint had no abuse story; phase literal wrong; autoplay underspec; MediaSession overclaimed; sleep timer wall-clock vs playback ambiguous; #38 lessons not absorbed; tests all manual; cache cost wrong; production days optimistic. |
| R2 (Claude) | Claude | `round-2-claude.md` | AGREE on all 12. Proposed: extend audioPlayback with `onSlotLost`; revise spec to best-effort `endSession`; kill presign endpoint, use public R2 bucket; phase literal fix; autoplay warm-up + Tap-to-Start fallback; MediaSession feature-detect; wall-clock sleep timer; PR #38 lessons as v1 gates; three unit tests; recalc cost; 5-8 days production. |
| R2 (codex) | codex | `round-2-codex.md` | **4 fixes ruled inadequate**: audioPlayback extension doesn't help (useRockyTTS doesn't go through claimSlot); public rocky-audio bucket exposes private TTS+gift media; autoplay warm-up brittle; no test runner configured. New concerns: EchoInterface bypass, releaseSlot global, immutable URL replacement problem. |
| R3 (Claude) | Claude | `round-3-claude.md` | **Major direction changes on 4 fixes**: DROP audioPlayback extension entirely (rely on UI mutex); SWITCH to `web/public/audio/companion/v1/` static hosting; SWITCH to explicit Tap-to-Start UX; ADD explicit Vitest setup as v1 deliverable. |
| R3 (codex) | codex | `round-3-codex.md` | **3/4 revised fixes: consensus ready** (web/public hosting, Tap-to-Start, Vitest setup). **1 outstanding: Fix 1** — UI mutex doesn't actually stop in-flight `useRockyTTS.speak()` chain because the hook's unmount cleanup doesn't set `cancelledRef=true`. One explicit decision needed. |

---

## Final consensus map

| Fix | Status | Resolution |
|---|---|---|
| 1: Audio mutex | **NEEDS USER DECISION** | See "Outstanding decision" below |
| 2: endSession best-effort | ✅ Consensus | Spec drops "stay on chat if end fails"; navigate immediately |
| 3: Asset hosting | ✅ Consensus | `web/public/audio/companion/v1/` static, versioned paths for replacement |
| 4: Phase literal | ✅ Consensus | `AppPhase = 'start' \| 'chat' \| 'echo' \| 'favorites' \| 'companion'` |
| 5: Autoplay | ✅ Consensus | Explicit Tap-to-Start UI after assets load |
| 6: MediaSession | ✅ Consensus | Feature-detect, best-effort, cleanup on unmount |
| 7: Sleep timer | ✅ Consensus | Wall-clock semantics, fade entry at last 8s |
| 8: PR #38 lessons | ✅ Consensus | Escape + reduced-motion + a11y as v1 gates |
| 9: Tests | ✅ Consensus | Vitest + jsdom + RTL setup as v1 deliverable, 3 named unit tests |
| 10: Cache cost | ✅ Consensus | Trivial (static asset + browser cache); R2 not involved |
| 11: Production days | ✅ Consensus | 5-8 working days (recon 1-2 + production 3-5 + integration QA 1) |
| 12: Premature checkbox | ✅ Consensus | Uncheck "audio coordination integrated" until code lands |

## Outstanding decision (for user)

### Fix 1: How to prevent in-flight TTS from leaking past chat→companion handoff

**Background**: When user taps "Stay On Line" in chat to enter companion mode, `useRockyTTS.speak()` may be mid-Promise-chain (mood audio playing, TTS audio fetched but not yet attached, etc.). React unmount of ChatInterface aborts the abort controller and pauses the current `ttsAudioRef`, but does **not** set `cancelledRef.current = true`. The next `await` in the Promise chain proceeds and can play subsequent TTS audio AFTER companion has started.

**Two options:**

**Option A — Companion-local fix (recommended)**

The Stay-On-Line button handler in ChatInterface explicitly calls `stopTTS()` BEFORE `endSession()` BEFORE phase navigation:

```ts
const handleStayOnLine = () => {
  stopTTS();                     // sets cancelledRef=true, stops audio
  endSession(sessionId);          // fire-and-forget consolidation
  onStayOnLine();                 // phase → 'companion'
};
```

- Pro: 3 lines, fully self-contained in the chat→companion handoff
- Pro: No changes to existing useRockyTTS internals
- Con: Doesn't fix the underlying useRockyTTS unmount-cleanup gap for other unmount paths (chat → home, chat → favorites)

**Option B — Strengthen useRockyTTS cleanup**

Modify `useRockyTTS` so its useEffect cleanup also sets `cancelledRef.current = true`:

```ts
useEffect(() => {
  return () => {
    cancelledRef.current = true;   // NEW: prevent post-unmount continuation
    abortCtrlRef.current?.abort();
    stopSharedAudio();
    if (ttsAudioRef.current) { ... }
  };
}, []);
```

- Pro: Fixes the latent bug for ALL unmount paths (not just chat→companion)
- Con: Touches existing code outside companion's scope
- Con: Slightly broader change requires testing all existing chat→* navigation paths

**Recommendation: A**. Smaller blast radius, self-contained to companion v1's surface, predictable. B is the "right" long-term fix but doesn't strictly belong to companion v1's PR; can be done as a separate small commit/PR alongside.

---

## codex's NEW minor concern from R3

> "Tap-to-Start introduces a `Ready` state; the spec should say the sleep timer starts on `Playing`, not on `Loading` or `Ready`."

**Resolution**: Add to spec §5.2 — "Sleep timer countdown begins on transition into `Playing` state (not `Loading` or `Ready`)." One line, no controversy.

---

## Plan-phase open questions (accepted by both reviewers as NOT spec blockers)

1. Verify EdgeSpark Worker's default static asset Cache-Control via `curl -I https://teaching-collie-6315.edgespark.app/audio/defaults/greeting_zh.mp3`
2. Exact Audio API surface inside the Tap-to-Start gesture handler
3. Vitest config specifics (jsdom env, asset/css mocks)
4. Asset recon: how many of 20 triggers come from existing `rocky_voice_human*.MP3`; specific Freesound candidates for env bed

---

## Spec revisions to apply (after user picks A or B for Fix 1)

The spec at `docs/superpowers/specs/2026-05-19-companion-mode-design.md` needs the following sections revised based on consensus:

- §2 Architecture — drop audioPlayback extension note; switch storage diagram to `web/public/audio/companion/v1/`; phase literal `'start'` not `'home'`
- §3 Asset library — sourcing plan unchanged but explicit "ship via web/public static, versioned path"
- §4 State machine — add `Ready` state between `Loading` and `Playing` (gated on Tap-to-Start)
- §5 UI specs — Tap-to-Start button visible during Ready state
- §5.2 Sleep timer — explicit wall-clock semantics + countdown starts on `Playing`
- §6 Audio coordination — rewrite: no API extension, rely on UI mutex; companion just calls existing `claimSlot()` / `releaseSlot()` at boundaries
- §7 Background playback — MediaSession feature-detect language; Wake Lock truly best-effort
- §8 Error handling — drop "stay on chat if end fails" entry; add "in-flight TTS handled by chosen option A or B above"
- §9 Server / data model — replace `/api/companion/asset-urls` endpoint with "static assets served by Worker"
- §10 Test plan — add Vitest setup + 3 named unit tests as v1 deliverable
- §11 Performance — recalc with static asset assumption
- §13 Production estimate — 5-8 working days split as recon/production/QA
- §14 (existing scaffolding for Round 1/2/3) — leave; this file replaces it for the actual transcript

## Final verdict

**Consensus reached, pending user decision on Fix 1 option A vs B.**

After user picks: Claude rewrites the spec inline applying the above revisions, commits, then hands off to `writing-plans` skill.
