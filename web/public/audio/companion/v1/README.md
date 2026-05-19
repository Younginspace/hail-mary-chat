# Companion Mode v1 Assets

**Status**: placeholders only (silent 0.5s mp3 stubs, ~800 bytes each).
Real assets are produced separately — see plan Tasks 18-19 in
`docs/superpowers/plans/2026-05-19-companion-mode.md` and the spec
asset library section at `docs/superpowers/specs/2026-05-19-companion-mode-design.md` §3.

## Files

- `env-bed-01.mp3` — target: ~10 min spaceship ambient loop, 96 kbps mono mp3, ~7 MB
- `triggers/{hum,tap,scrape,breath,rummage}-{01..04}.mp3` — 20 Rocky non-verbal short clips, 0.5-3s each, 128 kbps mono mp3, ~75 KB each

## Replacement procedure

1. Produce real mp3s per plan Task 19 (clip from existing Rocky recordings + record gaps).
2. Drop final mp3s at the named paths (overwrite placeholders).
3. `git add web/public/audio/companion/v1/ && git commit`
4. `edgespark deploy`

## Cache busting

URLs are immutable-cached (`Cache-Control: public, max-age=31536000, immutable`).
If asset semantics change in ways incompatible with v1, bump the directory version (`v1` → `v2`) so old browsers naturally orphan the cached stale assets.

## Acceptance criteria (real assets)

- env-bed: listen to 5 boundary crossings, no audible click (seamless loop)
- triggers: peak volume normalized across all 20 (no jarring loud trigger)
- env-bed: peak volume lower than triggers (triggers should cut through the bed)
- All files mono, mp3, target bitrates as noted above
