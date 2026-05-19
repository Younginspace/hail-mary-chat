# Companion Mode v1 — Candidate Audit

_Date: 2026-05-19_
_Source: agent extraction from local project audio + Pixabay search recon_
_Outputs: `/tmp/companion-candidates/cand-*.mp3`_

This sits BETWEEN the recon report (`companion-recon.md`) and the
final asset drop into `web/public/audio/companion/v1/`. Goal: a list
of files the human can audition, accept/reject, and copy to the
production path.

---

## Methodology

1. **Whisper.cpp tiny.en model** (75 MB, local, no auth) was used to
   ASR the 3 unknown audio sources (`3月26日.mov`, `remotevideo.mov`,
   `4月21日.MP3`). Results:
   - `3月26日.mov` and `remotevideo.mov` are **identical content**
     (Rocky-Grace 45s dialogue) — MD5 differs but ASR transcript is
     character-by-character identical. Treat as one source.
   - `4月21日.MP3` is 19.6s: 0-10s music, 10-15s Rocky vocal ("Amaze,
     Amaze, Signal from Earth, Rocky, very, very happy. You are a
     great friend. Question?"), 15-20s music outro.
2. **`ffmpeg -ss -t`** used to slice candidate clips at ASR-derived
   timestamps. Filenames encode source + content.
3. **Pixabay search** for foley + env bed candidates — page URLs
   listed below for manual auditioning (Pixabay download is one-click
   anonymous, no API).

---

## Candidates harvested from Rocky audio (12 clips)

### `hum` group — affirmative chirps / chuckles / questioning vocalizations

| File | Duration | Source | Content (ASR-verified or filename-labeled) |
|---|---|---|---|
| `cand-hum-326-good1.mp3` | 0.85s | `3月26日.mov` @ 09.20-10.05 | Rocky's "Good" #1 (3-stack chorus) |
| `cand-hum-326-good2.mp3` | 0.85s | `3月26日.mov` @ 10.05-10.90 | Rocky's "Good" #2 |
| `cand-hum-326-good3.mp3` | 0.74s | `3月26日.mov` @ 10.90-11.64 | Rocky's "Good" #3 |
| `cand-hum-326-good4.mp3` | 0.88s | `3月26日.mov` @ 21.40-22.28 | Rocky's "Good" #4 (separate scene) |
| `cand-hum-421-question.mp3` | 1.00s | `4月21日.MP3` @ 15-16s | Rocky's "Question?" intonation |
| `cand-hum-happy.mp3` | 1.04s | `rockyvoice_o/happy.MP3` | Rocky's affirmative |
| `cand-hum-laugh-a.mp3` | 1.00s | `rockyvoice_o/laugh.MP3` @ 0-1s | Rocky's chuckle, first half |
| `cand-hum-laugh-b.mp3` | 1.27s | `rockyvoice_o/laugh.MP3` @ 1-2.27s | Rocky's chuckle, second half |
| `cand-hum-question.mp3` | 1.38s | `rockyvoice_o/question.MP3` | Rocky's questioning |

**9 hum candidates, need 4 — leaves you 5 to reject.** Top picks
likely: 1 of the 4 "Good" variants (the cleanest one), the
"Question?" chord, one of the laugh halves, and `cand-hum-happy.mp3`.

### `breath` group — sighs / heavy breathing

| File | Duration | Source | Content |
|---|---|---|---|
| `cand-breath-unhappy.mp3` | 1.75s | `rockyvoice_o/unhappy.MP3` | Likely a sigh / disapproval grunt |
| `cand-breath-hurry.mp3` | 1.59s | `rockyvoice_o/in a hurry.MP3` | Likely rapid breaths |

**2 breath candidates, need 4 — 2 short. Options:**
1. Accept the gap, v1 ships with only 2 breath variants. Scheduler's
   no-adjacent-duplicate still works; just shorter cycle.
2. Find CC0 alien-breath sounds on Pixabay — but they won't be Rocky's
   voice line, which weakens the lore alignment.
3. Skip breath group entirely, redistribute to other groups
   (rebalance scheduler).

### Bonus: ambient extras

| File | Duration | Source | Content |
|---|---|---|---|
| `cand-env-326-birds.mp3` | 2.08s | `3月26日.mov` @ 30.88-32.96 | Bird chirping segment (Earth scene) |

**Not a Rocky trigger** — could be layered into env bed if you want
a "spaceship bay window faces Earth" texture. Optional.

---

## Pixabay candidates needed (12 foley + 1 env bed)

Pixabay requires one anonymous click per download (no batch API).
Open each URL below, audition the top 2-3 results, download the best
one. Save to `~/Downloads/` and tell me the filenames so I can drop
them into `web/public/audio/companion/v1/triggers/`.

### `tap` group (4 needed)

🔗 https://pixabay.com/sound-effects/search/wooden-table/
🔗 https://pixabay.com/sound-effects/search/finger-tapping/
🔗 https://pixabay.com/sound-effects/search/wood-tap/

Target: 4 short (0.5-2s) clean wooden-table/finger-tap clips. Pick
variants with different speeds — staccato single tap, double-tap,
gentle persistent tap, hard rap.

### `scrape` group (4 needed)

🔗 https://pixabay.com/sound-effects/search/papers-sliding/
🔗 https://pixabay.com/sound-effects/search/cloth/

Target: 4 short scrape/slide/rustle clips. Paper sliding, cloth
brush, leather creak.

### `rummage` group (4 needed)

🔗 https://pixabay.com/sound-effects/search/paper/
🔗 https://pixabay.com/sound-effects/search/foley/

Target: 4 short rummaging clips. Things being moved around, drawer
sifting, etc.

### env bed (1 needed)

**Primary** (Freesound CC0, manual download requires anon account):
🔗 https://freesound.org/people/Diboz/sounds/211683/ — `control_room.wav`

**Pixabay alternatives** (no login required):
🔗 https://pixabay.com/sound-effects/sci-fi-ambience-soothing-spaceship-engine-sound-loop-296976/
  — Direct candidate, explicitly a loop, "Soothing Spaceship Engine"

🔗 https://pixabay.com/sound-effects/search/spaceship%20ambience/
🔗 https://pixabay.com/sound-effects/search/futuristic%20engine/

Target: a 30s-3min ambient bed that loops seamlessly. After download
I'll Audacity-loop it to ~10 minutes via ffmpeg (cross-fade boundary
to hide the seam).

---

## What to send back to me

Once you've downloaded the foley + env bed, drop them anywhere in
the project (e.g. `~/Downloads/`) and tell me:

```
hum picks: cand-hum-326-good1, cand-hum-laugh-a, cand-hum-happy, cand-hum-question
breath picks: cand-breath-unhappy, cand-breath-hurry
breath fallback: accept 2 / find 2 more / skip group
tap: ~/Downloads/wood-tap-1.mp3, ~/Downloads/wood-tap-2.mp3, ...
scrape: ~/Downloads/papers-slide-1.mp3, ...
rummage: ~/Downloads/paper-rustle-1.mp3, ...
env: ~/Downloads/sci-fi-ambience-296976.mp3
```

I'll then:
1. Copy your `hum`/`breath` picks from `/tmp/companion-candidates/`
   into `web/public/audio/companion/v1/triggers/{hum,breath}-XX.mp3`
2. Copy foley files into `triggers/{tap,scrape,rummage}-XX.mp3`
3. ffmpeg-loop the env bed to ~10min seamless: `ffmpeg -stream_loop N
   -i source.mp3 -c copy -t 600 env-bed-01.mp3` (with crossfade if
   needed)
4. Build a quick HTML player page so you can preview all 21 in one
   shot before committing
5. Commit, deploy, flip `VITE_COMPANION_ENABLED=true`, deploy again
6. Final iOS device QA

---

## Time check

Plan said 5-8 working days for production. Where we actually are:

- ✅ Recon (1 day estimate) — done in ~10 minutes via local whisper.cpp + Rocky audio discovery
- 🟡 Production: Rocky-voice side done by agent in ~10 minutes (12 candidates ready). Foley side blocked on human Pixabay download (probably 30 minutes of clicking + auditioning). Env bed pull + loop (5 minutes once downloaded). **Realistic remaining: ~1 hour of human + 15 min agent finishing**.
- 🔴 iOS device QA — separate, requires real device. ~30 min.

Net: from "5-8 working days" → **2-3 hours of total work** if Pixabay
auditioning goes smoothly. Local whisper + project recon collapsed
most of what we thought was studio-recording work.
