// Stress 03 — /api/session/start pending_level_up CAS (C2)
//
// Hits /api/session/start N times concurrently WITH A REAL AUTH COOKIE.
// Requires you to first get a session cookie for a user that has
// pending_level_up != null (e.g., seeded by consolidate.ts or an admin
// fixture). If pending_level_up is null no ceremony should fire — the
// script will say so and pass trivially.
//
// Invariant the CAS must hold: across N concurrent session/start calls,
// AT MOST ONE response should have `level_up` non-null. Any more =
// ceremony-duplication bug (reopened C2).
//
// Usage:
//   TARGET=https://xxx.edgespark.app COOKIE='better-auth.session_token=...' \
//     node scripts/stress/03-session-start-cas.mjs
//
// Get COOKIE by signing into the web UI and copying the value from
// browser devtools → Application → Cookies. Or, easier, spawn a login
// via the CLI and snarf its cookie.

import { TARGET, bannerStart, bannerEnd, call, timed, summarize } from './lib.mjs';

const N = Number(process.env.N || 10);
const COOKIE = process.env.COOKIE ?? '';

async function run() {
  bannerStart(`session/start CAS (N=${N} concurrent)`);
  if (!COOKIE) {
    bannerEnd(
      'session/start CAS',
      'SKIP',
      'no COOKIE env var — script needs a real auth cookie. See file header.'
    );
    return 0;
  }

  const reqs = Array.from({ length: N }, () =>
    timed(() =>
      call('/api/session/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: COOKIE,
        },
        body: JSON.stringify({ lang: 'en', mode: 'text' }),
      })
    )
  );
  const results = await Promise.all(reqs);

  const sessions = new Set();
  let levelUpCount = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.ok || !r.res || r.res.status !== 200) {
      failed++;
      continue;
    }
    const body = r.res.body;
    if (typeof body === 'object' && body) {
      if (body.session_id) sessions.add(body.session_id);
      if (body.level_up) levelUpCount++;
    }
  }

  console.log('  responses :', summarize(results));
  console.log('  distinct sessions:', sessions.size);
  console.log('  level_up != null :', levelUpCount);
  console.log('  non-200          :', failed);

  if (levelUpCount > 1) {
    bannerEnd(
      'session/start CAS',
      'FAIL',
      `${levelUpCount} callers saw level_up — expected AT MOST 1. CAS is broken.`
    );
    return 2;
  }
  if (levelUpCount === 1) {
    bannerEnd(
      'session/start CAS',
      'PASS',
      'exactly one winner saw level_up under contention'
    );
    return 0;
  }
  bannerEnd(
    'session/start CAS',
    'PASS',
    'no level_up fired — user had no pending_level_up; CAS was still exercised'
  );
  return 0;
}

process.exit(await run());
