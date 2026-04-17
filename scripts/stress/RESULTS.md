# Stress Results

## 2026-04-18 — Post-fix deploy against `teaching-collie-6315.edgespark.app`

**Code deployed:** all REVIEW.md fixes (C1/C2 + H1–H4 + M1–M11 + NITS) from local
working tree. Deploy SHA ≈ 2cdb52b0. Bundle 351KB + assets 4.39MB.

**Cookie provided:** no — only unauthenticated / public probes ran. Scenarios
03 (session/start CAS), 04 (favorites cap), 05 (message/end race) skipped.

### 01 — rate-limit smoke (N=25, unauthenticated)

```
statuses: { '401': 25 }
timing:   min=318ms  p50=604ms  p95=680ms  (cross-ocean Cloudflare cold path)
```

✅ **PASS.** 25 concurrent `/api/adopt-device` all 401'd. `auth.user`-required
gate rejects before `tryConsumeRegisterSlot` fires, so unauthenticated bursts
don't burn rate-limit slots for the true IP. This directly invalidates
reviewer A's original "rate-limit bypass via auth-first path" claim in the
correct direction — the path isn't a bypass, it's the intended order.

### 02 — disposable email logic (offline mirror)

```
20 / 20 cases matched
```

✅ **PASS.** All expected categories behave correctly:
- Exact match, case-insensitive, trailing dot, plus-addressing on disposable,
  subdomain + deep subdomain of disposable → all **blocked**
- gmail.com, protonmail.com, example.com, project domain, typosquat
  (mailinator.co), lookalike (mailinator.com.attacker-owned.com),
  malformed/empty → all **allowed**

The `mailinator.com.attacker-owned.com` lookalike is intentionally allowed:
mail routes to the attacker's own domain, not to mailinator, so it's not a
disposable-email bypass — it's "attacker uses a domain they control", which
no blacklist can cover.

### 06 — admin-token timing probe (TRIALS=40)

```
probe                       p50(ms)  p95(ms)
len-1   (a)                   66.9    176.9
len-8   (aaaaaaaa)            65.9     84.7
len-32  (aaaa…aaaa)           67.0    105.4
len-64  (aaaa…aaaa)           66.7     76.5
len-128 (aaaa…aaaa)           65.0     76.9
len-32  random                65.4     77.9
missing header                66.9     85.7
p50 spread: 1.0× across lengths
```

✅ **PASS** with caveat.

**Caveat:** admin routes sit behind EdgeSpark's framework-level auth gate
("login required"), so without a session cookie every request 401s before
`isAdmin()` runs. This probe therefore measures **auth-middleware** timing
consistency, not the M5 constant-time compare directly. Still a useful
sanity check — any monotonic drift in the auth middleware would be equally
concerning — and the result (1.0× spread) is as good as it gets over a
cross-ocean link. A true `isAdmin()` timing check requires an authed cookie
+ varied admin tokens and would measure the compare directly. Worth doing
once a test account is set up.

---

## Still owing (need a test-account cookie to exercise)

- **03 session/start CAS (C2)** — the headline fix. Needs a user with
  `pending_level_up != null` for best signal, but even with a user that
  has no pending_level_up the CAS codepath still gets exercised.
- **04 favorites cap (M1)** — the atomic-insert verifier. Seeds to cap−N,
  bursts 2N, checks final count ≤ 100.
- **05 session/message vs session/end race (M2)** — confirms the
  `ended_at IS NULL` guard blocks late writes with 404, no 500s.

### How to get a cookie

Per `scripts/stress/README.md`: open `https://teaching-collie-6315.edgespark.app`
in a browser, sign up/in, devtools → Application → Cookies → copy the
`better-auth.session_token=...` entry (entire `key=value; ...` line). Pass
as `COOKIE=...` env var to `run-all.mjs` or the individual script.

### Cleanup

After the cookie-based run, D1 will have `stress-seed-*` and `stress-race-*`
rows in `favorites` + stress messages in `messages`. Before CNAME flip,
clean via `edgespark db sql "DELETE FROM favorites WHERE user_id = '<test-user-uuid>'"` etc., or just delete the test user's row and let FK cascades handle the rest.
