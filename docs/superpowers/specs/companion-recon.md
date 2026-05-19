# Companion Mode v1 — Asset Recon Report

_Date: 2026-05-19_
_Status: agent-side recon complete; human auditioning + production pending_
_Spec_: `docs/superpowers/specs/2026-05-19-companion-mode-design.md` §3

This report covers Plan Task 18 (agent portion). Outcome: an inventory
of what Rocky audio source material actually exists, candidate env bed
URL with license confirmed, and an honest reality check on the asset
production scope.

---

## 1. Rocky audio source inventory

**Total existing Rocky audio: ~80 seconds across 16 files.** Significantly
less than the optimistic spec assumption ("clip ~10 of 20 triggers from
existing material"). Reality below.

### 1.1 `rocky_voice_human.MP3` + `rocky_voice_human_2.MP3` (project root)

| File | Duration | Bitrate | Purpose (inferred) |
|---|---|---|---|
| `rocky_voice_human.MP3` | 28.13s | 128 kbps stereo | MiniMax voice cloning reference sample |
| `rocky_voice_human_2.MP3` | 29.52s | 128 kbps stereo | MiniMax voice cloning reference sample |

These are likely the 30-60s reference samples used to clone Rocky's
voice for TTS. They're continuous English speech with short pauses.

**`ffmpeg silencedetect -30dB -d 0.2s` output (excerpted):**
- File 1: ~10 silence windows of 0.2–1.1s (between sentences)
- File 2: ~9 silence windows of 0.2–1.5s

These "silence" windows MAY contain audible mouth-clicks, lip smacks,
or breaths — those are exactly the trigger-suitable non-verbal sounds.
But the windows are detected by amplitude threshold; they could just
be empty silence. **Human ears must verify**.

### 1.2 `rockyvoice_h/` — character one-liners (4 files)

| File | Duration | Notes |
|---|---|---|
| `dirty.MP3` | 3.29s | Cursing reaction sound |
| `iamrocky.MP3` | 1.70s | "I am Rocky" intro |
| `ilike.MP3` | 0.97s | "I like" affirmation |
| `sayhello.MP3` | 0.84s | Greeting |

These are full-word utterances — **NOT trigger candidates** for
companion mode (we want non-verbal). Listed for completeness.

### 1.3 `rockyvoice_o/` — emotional/expressive clips (10 files)

| File | Duration | **Trigger group candidate?** |
|---|---|---|
| `laugh.MP3` | 2.27s | 🟢 `hum` — chuckle fragments harvestable |
| `happy.MP3` | 1.04s | 🟢 `hum` — affirmative chirp |
| `unhappy.MP3` | 1.75s | 🟡 `breath` — possible sigh |
| `in a hurry.MP3` | 1.59s | 🟡 `breath` — possible rapid breaths |
| `question.MP3` | 1.38s | 🟡 `hum` — questioning vocalization |
| `hello1.MP3` | 1.36s | 🔴 verbal greeting, skip |
| `hello2.MP3` | 0.84s | 🔴 verbal greeting, skip |
| `talk1.MP3` | 1.70s | 🔴 verbal, skip |
| `talk2.MP3` | 1.67s | 🔴 verbal, skip |
| `talk3.MP3` | 1.75s | 🔴 verbal, skip |

🟢 strong, 🟡 marginal (depends on what's audible after the verbal
content trimmed), 🔴 verbal-only.

### 1.4 Realistic harvest expectation

**Optimistic upper bound: 2-5 trigger clips total** from existing
material, all in the `hum` or `breath` groups. Specifically:

- Up to **3-4 `hum` candidates** by clipping fragments from
  `laugh.MP3` / `happy.MP3` / `question.MP3`
- Up to **1-2 `breath` candidates** by isolating non-verbal exhales
  from `unhappy.MP3` / `in a hurry.MP3`
- **0 candidates** for `tap` / `scrape` / `rummage` groups —
  these are foley sounds, Rocky's voice doesn't contain them

**Production gap**: at minimum 15-18 triggers need fresh recording OR
CC0 foley sourcing. Likely closer to 20 once humans audition the
optimistic candidates and most fall short.

---

## 2. Env bed candidate

**Primary candidate (CC0):**

🔗 **https://freesound.org/people/Diboz/sounds/211683/**
- Title: `control_room.wav`
- Author: Diboz
- License: CC0 (per Freesound page footer: "You can copy, modify,
  distribute and perform the sound, even for commercial purposes,
  all without the need of asking permission to the author")
- Description: "Ambient sound akin to the bridge of a starship.
  Muted background hum with an overtone of air conditioning ducts.
  Could be used as an ambient sound loop for hi-tech / science
  fiction interiors such as a laboratory, a control room, or the
  bridge of a spacecraft."
- Top community comment: "I love how versatile this sound is.
  Here is how it was used (for three hours!) this time" — proven
  long-loop suitability.

This matches our spec exactly: spaceship / sci-fi ambient bed.

**Backup candidates (also CC0/CC-BY, verify license individually):**

🔗 `https://freesound.org/people/Coghezzi/sounds/852315/` —
"Sci-Fi Horror Ambience – Living Alien Ship Interior" — too horror-y
for Rocky's tone, but available.

🔗 `https://freesound.org/people/LookIMadeAThing/sounds/534018/` —
"Sci-fi Ambient Drone" — pure drone, simpler texture.

🔗 `https://freesound.org/browse/tags?f=tag%3A%22soundfx%22+tag%3A%22ambient%22`
— tag-filtered browse for "soundfx + ambient" listing more options
if Diboz's needs replacing.

**Recommendation**: Diboz's `control_room.wav`. Pull it, listen to
the seamless-loop potential, run through Audacity to extend to ~10
min via crossfade-loop or just repeat-with-fade.

---

## 3. Foley candidates (tap / scrape / rummage)

Not searched in this recon pass — these are the easiest to record
fresh (any home with a wooden table + paper + a few small objects
covers all three groups in 30 minutes). If you prefer CC0 sourcing,
search Freesound tags: `tap`, `scrape`, `paper rustle`, `keyboard`,
`pebble`, `glass tap` — typically thousands of CC0 results.

For the **`hum` and `breath` groups** that Rocky character must
own, **the source is Rocky himself** — either harvested from §1.3
above or fresh recorded by whoever does Rocky's voice.

---

## 4. Production scope estimate (revised)

| Step | Original estimate | Revised after recon |
|---|---|---|
| Recon (agent) | 1 day | ✅ done |
| Audition existing material (human) | (in recon) | **0.5 day** — listen through §1.1 silence windows + §1.3 emotion clips, pull clean clips into Audacity |
| Foley recording (tap/scrape/rummage) | 1-2 days | **0.5 day** — home recording, 12 clips |
| Rocky-voice recording (hum/breath gaps) | 1 day | **1-2 days** — fresh studio session for the 5-8 triggers we can't harvest |
| Env bed pull + remix | 0.5-1 day | **0.5 day** — Diboz file pulled, looped to 10min in Audacity |
| Mix + normalize + seamless-loop QA | 1 day | **1 day** |
| **Total** | 5-8 working days | **3.5-5 working days** |

Revised total is LOWER because:
- Foley work is trivially fast (table-mic recording)
- Env bed work is reduced to "pull + loop" not "search + audition + remix"
- Rocky-voice recording is the only studio-grade need, narrower scope

---

## 5. Plan-phase open issue surfaced by this recon

The original spec §3 assumed ~10 of 20 triggers come from existing
recordings. **Real number is 2-5.** This raises the question:

**Does whoever plays Rocky's voice need a fresh studio session for
hum/breath clips?**

If yes: budget for that session (1-2h studio time, ~5-8 fresh clips).
If no (e.g. Rocky's voice actor is unavailable or cost-prohibitive):
v1 can ship with **only the 2-5 harvested clips** in `hum`/`breath`
groups + foley for `tap`/`scrape`/`rummage`. The scheduler will still
cycle through fewer hums but the spec's "no adjacent duplicate"
guarantee still holds; user might just notice repeats in long
sessions.

**Suggested decision rule:** ship v1 with whatever 12-15 clips are
ready in 2-3 days. The 20-clip ideal can be a v1.1 polish pass.

---

## 6. Cache-Control follow-up

Separate from recon scope, but discovered during deploy of the gated
companion code: EdgeSpark Worker's default Cache-Control on
`/audio/*` is `public, max-age=0, must-revalidate`.

For static immutable assets this is suboptimal — every cold companion
session triggers 21 conditional GETs (304s, but still round-trips).

**Plan-phase task before flipping the feature flag**: either
(a) configure EdgeSpark Worker route for `/audio/companion/v1/*` to
serve with `Cache-Control: public, max-age=31536000, immutable`, or
(b) accept the round-trip cost (cheap, not blocking).

---

## 7. Next agent step (after human audition)

Once human signs off on what clips are usable from existing material
(§1.4) and decides on the fresh-recording scope (§5):

1. Drop the produced mp3s into `web/public/audio/companion/v1/` at
   the named paths
2. Run `npm run build` locally to confirm bundle still builds
3. `edgespark deploy` to ship updated assets
4. **Then** set `VITE_COMPANION_ENABLED=true` in EdgeSpark prod var
   config and re-deploy to unlock the entry CTAs
5. Run real-device QA per spec §10.2

---

_End of recon report. Awaiting human audition + production._
