# Pre-Merge Checklist — feat/edgespark-migration → main

Run through this list **before** merging this branch into `main`. None of it is optional.

## Hard blockers

- [ ] **`edgespark.toml`** — delete the `[db]` section (or change `migration_branch` to `main`). Leaving `migration_branch = "feat/edgespark-migration"` in place after merge will break `edgespark db migrate` on deploy because the CLI requires migrations to run on the default git branch.
- [ ] Run `edgespark db migrate` once from `main` to confirm all 8 migrations apply cleanly.
- [ ] Confirm production secrets are set in EdgeSpark: `MINIMAX_API_KEY`, `ADMIN_TOKEN`. `edgespark secret get` (or the dashboard) should list both.
- [ ] Confirm production vars as needed: `MINIMAX_TTS_*`, etc. See `ADMIN.md`.

## Cleanup

- [ ] Delete `server-legacy/` (the old Express MVP; superseded by `server/`).
- [ ] Decide fate of `.env` in the repo: either remove from git (`git rm --cached .env`) and keep ignored, or leave empty and document it.
- [ ] Resolve lockfile inconsistency: either commit `server/package-lock.json` + `web/package-lock.json` and remove them from `.gitignore`, or keep ignored and delete from git.

## Smoke after DNS flip

- [ ] `GET /api/me` while unauth → `401`.
- [ ] Sign up → `POST /api/adopt-device` → `GET /api/me` returns `callsign` and `voice_credits = 10`.
- [ ] `/api/session/start` → `/api/chat` (stream) → `/api/session/end` → background consolidation completes.
- [ ] `GET /api/admin/consolidation-failed` with `X-Admin-Token` returns `{failed: []}` (or a small manageable list).
- [ ] Trigger a TTS hit; confirm second hit of the same text is served from R2 cache (no new MiniMax call).

## Post-launch monitoring (first 48h)

- [ ] Watch `voice_credit_ledger` for unusual patterns (mass grants or negative balances).
- [ ] Watch `consolidation_jobs` with `status='failed'` — manual retry via `/api/admin/retry-consolidation`.
- [ ] Watch `register_rate_limit` — confirm bot-defense caps are firing on spam IPs, not hitting legitimate users.
- [ ] Disposable-email rejects: grep logs for `not_supported` response rate.
