// Stress 04 — POST /api/favorites cap atomicity (M1)
//
// Seeds the authed user's favorites to the cap - N (so the last N slots
// are open), then blasts K > N concurrent favorites inserts with
// DIFFERENT content (so UNIQUE(user_id, content_hash) won't squash the
// race). Invariant: after the blast, favorites count MUST be exactly
// FAVORITES_CAP, never FAVORITES_CAP + anything. Overshoot = reopened M1.
//
// Requires COOKIE + ADMIN_TOKEN (latter only if you want the script to
// reset the favorites list between runs; if no admin access, expect the
// script to run the blast once and you manually clean up).
//
// Usage:
//   TARGET=... COOKIE='...' node scripts/stress/04-favorites-cap.mjs
//
// Notes:
//   - Cap is 100 per current server code. Override via CAP env if the
//     server-side const ever changes.
//   - If the user is already near cap, we still only push CAP - currentN
//     rows worth of seed, then race the final N slots.

import { TARGET, bannerStart, bannerEnd, call, summarize, timed } from './lib.mjs';

const CAP = Number(process.env.CAP || 100);
const CONCURRENT = Number(process.env.CONCURRENT || 8);
const COOKIE = process.env.COOKIE ?? '';

async function getCount() {
  const r = await call('/api/favorites', {
    method: 'GET',
    headers: { Cookie: COOKIE },
  });
  if (!r.ok) throw new Error(`GET /api/favorites ${r.status}: ${JSON.stringify(r.body)}`);
  return Array.isArray(r.body?.items) ? r.body.items.length : 0;
}

async function addOne(content) {
  return call('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({
      message_content: content,
      lang: 'en',
      mood: 'talk',
    }),
  });
}

async function run() {
  bannerStart(`favorites cap race (CAP=${CAP}, concurrent=${CONCURRENT})`);
  if (!COOKIE) {
    bannerEnd('favorites cap race', 'SKIP', 'no COOKIE — see file header');
    return 0;
  }

  const startCount = await getCount();
  console.log(`  starting count: ${startCount}`);

  // Seed to CAP - CONCURRENT so the final CONCURRENT+overflow requests race
  // for the last (CONCURRENT) slots.
  const seedTarget = Math.max(0, CAP - CONCURRENT);
  if (startCount < seedTarget) {
    console.log(`  seeding up to ${seedTarget}…`);
    for (let i = startCount; i < seedTarget; i++) {
      const r = await addOne(`stress-seed-${Date.now()}-${i}-${Math.random()}`);
      if (!r.ok) {
        console.log(`  seed stopped at ${i} — ${r.status} ${JSON.stringify(r.body)}`);
        break;
      }
    }
  }

  const beforeRace = await getCount();
  console.log(`  pre-race count: ${beforeRace}`);

  // Blast 2 * CONCURRENT so we deliberately exceed the cap.
  const burst = CONCURRENT * 2;
  const reqs = Array.from({ length: burst }, (_, i) =>
    timed(() => addOne(`stress-race-${Date.now()}-${i}-${Math.random()}`))
  );
  const results = await Promise.all(reqs);

  const afterRace = await getCount();
  const statuses = {};
  for (const r of results) {
    const s = r.ok ? r.res.status : 'fetch-error';
    statuses[s] = (statuses[s] ?? 0) + 1;
  }
  console.log('  burst statuses:', statuses);
  console.log('  timing        :', summarize(results));
  console.log(`  post-race count: ${afterRace}`);

  if (afterRace > CAP) {
    bannerEnd(
      'favorites cap race',
      'FAIL',
      `overshoot — count=${afterRace} > CAP=${CAP}. M1 reopened.`
    );
    return 2;
  }
  if (afterRace !== CAP) {
    bannerEnd(
      'favorites cap race',
      'WARN',
      `count=${afterRace} but expected ${CAP}. Could be seed short.`
    );
    return 1;
  }
  bannerEnd('favorites cap race', 'PASS', `count=${afterRace} (== CAP, no overshoot)`);
  return 0;
}

process.exit(await run());
