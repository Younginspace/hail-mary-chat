# Admin Endpoints

All `/api/admin/*` endpoints are gated by the `ADMIN_TOKEN` secret.
Pass it via the `X-Admin-Token` request header.

```
ADMIN_TOKEN secret is set at:
  https://dash.edgespark.dev/projects/858a0e42-ad2e-4070-b2bc-30a17bf05aa0/secrets/set?env=default&keys=ADMIN_TOKEN

Code: server/src/index.ts → isAdmin()
Declared: server/src/defs/runtime.ts (SecretKey union)
```

The compare is constant-time. Missing / wrong tokens → 403.

---

## Consolidation dead-letter (§7)

### Inspect failed consolidation jobs

```bash
curl -H "X-Admin-Token: $TOKEN" \
  https://teaching-collie-6315.edgespark.app/api/admin/consolidation-failed
```

Returns up to 100 rows from `consolidation_jobs` where `status='failed'`
(i.e. hit the 3-attempt cap). Each includes `session_id`, `attempts`,
`last_error` (truncated to 2000 chars), `updated_at`.

### Manually retry stuck jobs

Sweeps `consolidation_jobs` with `status='pending'`, `attempts<3`,
and `updated_at` older than `older_than_ms` (default 10 min).

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
  "https://teaching-collie-6315.edgespark.app/api/admin/retry-consolidation?older_than_ms=600000&limit=25"
```

Response: `{ ok: true, retried: N }`.

The same sweep also runs opportunistically on every `/api/session/end`,
so this endpoint is mostly for incident response or back-fills.

---

## rapport_thresholds recalibration

### Step 1: inspect current percentiles

```bash
curl -H "X-Admin-Token: $TOKEN" \
  https://teaching-collie-6315.edgespark.app/api/admin/rapport-percentiles
```

Returns:
- `sample_size` + `warning` (fires if sample_size < 500)
- `trust_percentiles: { p50, p75, p95 }`
- `warmth_percentiles: { p50, p75, p95 }`
- `proposed`: plan-spec thresholds (Lv2=P50 OR, Lv3=P75 AND, Lv4=P95 AND)
- `current`: whatever is in the `rapport_thresholds` table today

### Step 2: apply (explicit, no auto-apply)

Review the `proposed` payload. If it looks right, POST it back:

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "levels": [
      { "level": 2, "trust_min": 0.45, "warmth_min": 0.50, "combinator": "OR"  },
      { "level": 3, "trust_min": 0.65, "warmth_min": 0.60, "combinator": "AND" },
      { "level": 4, "trust_min": 0.85, "warmth_min": 0.80, "combinator": "AND" }
    ]
  }' \
  https://teaching-collie-6315.edgespark.app/api/admin/rapport-recalibrate
```

Validation:
- `level` ∈ {2,3,4}
- `trust_min`, `warmth_min` ∈ [0, 1]
- `combinator` ∈ {"AND","OR"}

Rows failing validation are silently skipped (response `applied` only
lists rows that actually persisted). Upsert on `level`.

### Step 3: verify

Re-GET the percentiles endpoint. `current` should now echo what you
applied. Existing users don't lose their current `affinity_level`
(consolidate logic only ratchets up).

**Plan says wait for ≥500 real users before running.** At DAU ≈ 100
that's ~2-3 months out. The endpoint warns you via `sample_size` +
`warning` if you try sooner.

---

## Setting / rotating the ADMIN_TOKEN

Secret storage is browser-only per EdgeSpark policy — agents never see
the value.

```bash
edgespark secret set ADMIN_TOKEN
# → prints a dashboard URL
# → open, enter a long random string (32+ chars, e.g. `openssl rand -base64 32`)
# → save
edgespark deploy  # picks up the new value
```

To rotate: same flow with a new value. Old value immediately stops
working on next deploy.

---

## Why these endpoints exist (context)

From P5 Review (2026-04-17):

- **§7 Consolidation retry**: the old `session/end` path used
  `consolidateSession(session_id).catch(err => console.error(...))`.
  Memory extraction could fail silently — user's "Rocky doesn't
  remember me" complaint was one trigger. The new wrapper persists
  every attempt into `consolidation_jobs` so failures are visible.

- **rapport auto-recalibration**: the Lv2/3/4 thresholds shipped with
  hand-picked "beta" values (Lv2 trust≥0.45 OR warmth≥0.5, etc).
  Real user distribution will differ — this admin pair lets us re-
  center them once enough data exists without a redeploy.
