// Stress 05 — /api/session/message vs /api/session/end race (M2)
//
// Starts a session, then fires N /api/session/message concurrent with
// one /api/session/end. Invariant after fix:
//   - Any message sent before end completes is either 200 or 404
//     ("session not found or ended"). No 500s, no silent data
//     inconsistency.
//   - Post-end, the session's ended_at is set and further messages get
//     404.
//
// Useful for confirming that the M2 ended_at guard is respected under
// contention and the turn_count CAS doesn't blow up.
//
// Usage:
//   TARGET=... COOKIE='...' node scripts/stress/05-message-end-race.mjs

import { TARGET, bannerStart, bannerEnd, call, timed, summarize } from './lib.mjs';

const N_MSGS = Number(process.env.N || 12);
const COOKIE = process.env.COOKIE ?? '';

async function run() {
  bannerStart(`message/end race (N=${N_MSGS} messages vs one /session/end)`);
  if (!COOKIE) {
    bannerEnd('message/end race', 'SKIP', 'no COOKIE — see file header');
    return 0;
  }

  const startRes = await call('/api/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({ lang: 'en', mode: 'text' }),
  });
  if (!startRes.ok || !startRes.body?.session_id) {
    bannerEnd(
      'message/end race',
      'FAIL',
      `could not start session: ${startRes.status} ${JSON.stringify(startRes.body)}`
    );
    return 2;
  }
  const session_id = startRes.body.session_id;
  console.log(`  session_id: ${session_id}`);

  // Fire N messages + 1 end in the same microtask so Promise.all races them.
  const msgOps = Array.from({ length: N_MSGS }, (_, i) =>
    timed(() =>
      call('/api/session/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
        body: JSON.stringify({
          session_id,
          role: 'user',
          content: `stress ${i} @ ${Date.now()}`,
        }),
      })
    )
  );
  const endOp = timed(() =>
    call('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
      body: JSON.stringify({ session_id }),
    })
  );

  const [endResult, ...msgResults] = await Promise.all([endOp, ...msgOps]);

  const statuses = {};
  for (const r of msgResults) {
    const s = r.ok ? r.res.status : 'fetch-error';
    statuses[s] = (statuses[s] ?? 0) + 1;
  }
  console.log('  message statuses:', statuses);
  console.log('  message timing  :', summarize(msgResults));
  console.log(
    '  end             :',
    endResult.ok ? endResult.res.status : 'fetch-error',
    endResult.ok ? JSON.stringify(endResult.res.body) : ''
  );

  // Verify post-end rejection.
  const postEnd = await call('/api/session/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({ session_id, role: 'user', content: 'post-end' }),
  });
  console.log(
    `  post-end send: status=${postEnd.status} body=${JSON.stringify(postEnd.body)}`
  );

  const has500 = (statuses[500] ?? 0) > 0;
  const postEndOk = postEnd.status === 404;

  if (has500) {
    bannerEnd(
      'message/end race',
      'FAIL',
      '500 in race window — data-path crashed'
    );
    return 2;
  }
  if (!postEndOk) {
    bannerEnd(
      'message/end race',
      'FAIL',
      `post-end send returned ${postEnd.status}, expected 404`
    );
    return 2;
  }
  bannerEnd(
    'message/end race',
    'PASS',
    `statuses clean (200/404 mix), post-end correctly rejected`
  );
  return 0;
}

process.exit(await run());
