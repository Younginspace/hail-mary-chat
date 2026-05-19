# Companion Mode v1 — Pixabay Curated Shortlist

_Date: 2026-05-19_
_Source: Playwright-scraped Pixabay search results, agent-curated by metadata_

## How to use

Pixabay's React app blocks programmatic clicks — I can scrape `title`,
`duration`, `author`, `href`, but NOT the actual mp3 download URL
without you clicking the play button yourself. So this is a **curated
short list**: 4 categories × 6 picks = 24 pages for you to open,
listen, and download.

Workflow:
1. Open the URL → click ▶ to listen
2. If you like it → click the green "Free Download" button (no login
   needed for one-by-one downloads). Save to `~/Downloads/`
3. Drop the file anywhere in the project (or just leave in Downloads)
4. Tell me the filename → I'll rename + place + ffmpeg-loop the env bed

You don't need to download all 6 per group — just **4 keepers per
group**. The 6th is backup if some sound boring.

---

## 🪵 `tap` — 4 needed

| Pick | Title | Duration | Author | Why |
|---|---|---|---|---|
| ⭐ **1** | [Tap on Wooden Table](https://pixabay.com/sound-effects/household-tap-on-wooden-table-44998/) | 1s | freesound_community | Clean single wood tap, perfect for trigger |
| 2 | [Tapping Fingers](https://pixabay.com/sound-effects/household-tapping-fingers-84773/) | 9s | freesound_community | Repeated finger pattern, ffmpeg-clip to 1-2s |
| 3 | [Annoying Fingers Tapping on Desk](https://pixabay.com/sound-effects/household-annoying-fingers-tapping-on-desk-45180/) | 4s | freesound_community | Quick rhythmic taps |
| 4 | [Tapping Fingers nervously](https://pixabay.com/sound-effects/household-tapping-fingers-nervously-86163/) | 4s | freesound_community | Different rhythm variant |
| 5 (backup) | [Soft Finger Tapping ASMR](https://pixabay.com/sound-effects/film-special-effects-soft-finger-tapping-on-palm-gentle-skin-tap-asmr-428870/) | 9s | Giridharani | Gentle ASMR variant if above too sharp |
| 6 (backup) | [Hit table](https://pixabay.com/sound-effects/household-hit-table-90121/) | 3s | freesound_community | Heavier tap if you want a thump variant |

## 📄 `scrape` — 4 needed

| Pick | Title | Duration | Author | Why |
|---|---|---|---|---|
| ⭐ **1** | [paper slide](https://pixabay.com/sound-effects/film-special-effects-paper-slide-89980/) | 1s | freesound_community | Short clean paper slide |
| 2 | [sliding paper on table](https://pixabay.com/sound-effects/household-sliding-paper-on-table-7034/) | 19s | freesound_community | Multiple slides, clip 1-2s |
| 3 | [Sliding Envelope into Drawer](https://pixabay.com/sound-effects/film-special-effects-sliding-envelope-into-drawer-46781/) | 4s | freesound_community | Different texture (paper + drawer) |
| 4 | [Paper slide - Short](https://pixabay.com/sound-effects/film-special-effects-paper-slide-short-478835/) | ~1s | OxidVideos | Brand-name "short" variant |
| 5 (backup) | [031794_paper movement and sliding](https://pixabay.com/sound-effects/film-special-effects-031794-paper-movement-and-sliding-63405/) | 33s | freesound_community | Mix of slides, lots to clip from |
| 6 (backup) | [Sliding Hard Folder](https://pixabay.com/sound-effects/film-special-effects-sliding-hard-folder-80106/) | 12s | freesound_community | Heavier surface variant |

## 📦 `rummage` — 4 needed

| Pick | Title | Duration | Author | Why |
|---|---|---|---|---|
| ⭐ **1** | [Paper rustle](https://pixabay.com/sound-effects/film-special-effects-paper-rustle-345748/) | 32s | spinopel | Continuous rustle texture, plenty to clip |
| 2 | [paper rustling](https://pixabay.com/sound-effects/film-special-effects-paper-rustling-236733/) | 45s | Soul_Serenity_Sounds | Different rustle variant |
| 3 | [Wrapping Paper Rustle](https://pixabay.com/sound-effects/film-special-effects-wrapping-paper-rustle-72405/) | 19s | freesound_community | Crispier paper texture |
| 4 | [Rustling Paper](https://pixabay.com/sound-effects/film-special-effects-rustling-paper-46380/) | 6s | freesound_community | Tighter clip |
| 5 (backup) | [thick paper bag rustle crunch crinkle](https://pixabay.com/sound-effects/film-special-effects-thick-paper-bag-rustle-crunch-crinkle-63686/) | 20s | freesound_community | Crunchier bag variant |
| 6 (backup) | [paper handling and crumple](https://pixabay.com/sound-effects/film-special-effects-paper-handling-and-crumple-56625/) | 94s | freesound_community | Long source, lots of variety to clip |

## 🛸 env bed — 1 needed (download the winner only)

| Pick | Title | Duration | Author | Why |
|---|---|---|---|---|
| ⭐⭐⭐ **1** | [spaceship ambience with effects](https://pixabay.com/sound-effects/film-special-effects-spaceship-ambience-with-effects-21420/) | **9:53** | Placidplace | Almost exactly the 10-min target. May need ZERO ffmpeg work. ⭐ |
| 2 | [ambient noise](https://pixabay.com/sound-effects/film-special-effects-ambient-noise-52387/) | 6:02 | freesound_community | If #1 too "effects-y", this is purer ambient |
| 3 | [Sci-fi Station](https://pixabay.com/sound-effects/film-special-effects-sci-fi-station-18745/) | 5:28 | freesound_community | Station/control room texture |
| 4 (backup) | [Big Room Ambience 1](https://pixabay.com/sound-effects/film-special-effects-big-room-ambience-1-77517/) | 1:02 | freesound_community | Short, would need ffmpeg loop to 10min |
| 5 (backup) | [Spacehip Atmo](https://pixabay.com/sound-effects/film-special-effects-spacehip-atmo-392038/) | 0:48 | SoundReality | Loop-friendly short clip |

**Recommendation: just download #1, audition, accept-if-good.** If you
don't like it, fall back to #2 or #3.

---

## After you download

Tell me the filenames in any format, e.g.:

```
tap:
  ~/Downloads/tap-on-wooden-table.mp3
  ~/Downloads/tapping-fingers.mp3
  ~/Downloads/annoying-finger-tap.mp3
  ~/Downloads/tapping-fingers-nervously.mp3
scrape:
  ~/Downloads/paper-slide.mp3
  ~/Downloads/sliding-paper-on-table.mp3
  ~/Downloads/sliding-envelope.mp3
  ~/Downloads/paper-slide-short.mp3
rummage:
  ~/Downloads/paper-rustle-spinopel.mp3
  ...
env:
  ~/Downloads/spaceship-ambience-with-effects.mp3
```

And confirm your `hum`/`breath` picks from
`docs/superpowers/specs/companion-candidates/` (see
`companion-candidates-audit.md` §1).

Then I'll:
1. Rename + drop everything into `web/public/audio/companion/v1/`
2. ffmpeg-clip any source clip > 3s down to 1-2s chunks (4 per group)
3. ffmpeg-loop env bed to ~10min if shorter than that
4. Build a local HTML preview page for final check
5. Commit → deploy → flip `VITE_COMPANION_ENABLED=true` → re-deploy

Total your remaining work: **~15-20 min Pixabay clicking**, then I do
the rest in ~10 min agent time.
