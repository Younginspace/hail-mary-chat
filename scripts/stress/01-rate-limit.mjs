// Stress 01 — /api/adopt-device per-IP rate limit
//
// Fires N adopt-device calls in a burst from "one IP" (same test process,
// which on Cloudflare means same cf-connecting-ip). Verifies:
//   - First REGISTER_HOURLY_CAP (10) succeed (200) or hit a graceful error
//     that's NOT 429.
//   - Subsequent calls return 429 with error='rate_limited'.
//
// This script does NOT authenticate — it targets the UNauthenticated path,
// which will actually 401 because /api/adopt-device requires auth. So we
// use this primarily to confirm 401 comes back BEFORE any rate-limit
// consumption is visible (auth-first gate). The true rate-limit path
// requires N real auth sessions — that's a separate, more expensive test.
//
// Useful as a cheap smoke: if this returns 429 for un-authed calls, the
// rate-limit is firing prematurely.

import { TARGET, bannerStart, bannerEnd, call, randomDeviceId, timed, summarize } from './lib.mjs';

const N = Number(process.env.N || 25);

async function run() {
  bannerStart(`rate-limit smoke (N=${N}, unauthenticated)`);

  const reqs = Array.from({ length: N }, () =>
    timed(() =>
      call('/api/adopt-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': randomDeviceId(),
        },
        body: JSON.stringify({}),
      })
    )
  );
  const results = await Promise.all(reqs);

  const statuses = {};
  for (const r of results) {
    const s = r.ok ? r.res.status : 'fetch-error';
    statuses[s] = (statuses[s] ?? 0) + 1;
  }
  console.log('  statuses:', statuses);
  console.log('  timing  :', summarize(results));

  // Verdicts
  const has429 = (statuses[429] ?? 0) > 0;
  const has401 = (statuses[401] ?? 0) > 0;

  if (has401 && !has429) {
    bannerEnd(
      'rate-limit smoke',
      'PASS',
      'auth-first gate rejects with 401 before rate-limit is consumed'
    );
    return 0;
  }
  if (has429 && !has401) {
    bannerEnd(
      'rate-limit smoke',
      'WARN',
      'got 429 without 401 — rate-limit is firing on unauth calls (should be 401 first)'
    );
    return 1;
  }
  if (has401 && has429) {
    bannerEnd(
      'rate-limit smoke',
      'WARN',
      'mixed 401 + 429 — some unauth burst consumed rate slots'
    );
    return 1;
  }
  bannerEnd('rate-limit smoke', 'FAIL', `unexpected statuses: ${JSON.stringify(statuses)}`);
  return 2;
}

process.exit(await run());
