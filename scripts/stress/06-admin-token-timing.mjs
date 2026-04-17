// Stress 06 — Admin endpoint timing side-channel (M5 sanity)
//
// Measures /api/admin/consolidation-failed response time with tokens of
// varied length + content. If the constant-time compare is correctly
// length-padded, the p50/p95 should be indistinguishable across token
// lengths. A clear monotonic drift with length = regression.
//
// Note: network jitter will dominate any real side-channel on a CDN-fronted
// worker. This script is a sanity check, not a real timing attack — useful
// for catching an accidental early-return or memcmp-like behavior.
//
// Usage:
//   TARGET=http://localhost:3001 node scripts/stress/06-admin-token-timing.mjs
// (Requires the worker to be up — doesn't need a real ADMIN_TOKEN.)

import { TARGET, bannerStart, bannerEnd, call, timed } from './lib.mjs';

const TRIALS = Number(process.env.TRIALS || 80);

const probes = [
  { name: 'len-1   (a)              ', token: 'a' },
  { name: 'len-8   (aaaaaaaa)       ', token: 'a'.repeat(8) },
  { name: 'len-32  (aaaa…aaaa)      ', token: 'a'.repeat(32) },
  { name: 'len-64  (aaaa…aaaa)      ', token: 'a'.repeat(64) },
  { name: 'len-128 (aaaa…aaaa)      ', token: 'a'.repeat(128) },
  { name: 'len-32  random           ', token: 'x'.repeat(16) + 'y'.repeat(16) },
  { name: 'missing header           ', token: null },
];

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}

async function timeCall(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token != null) headers['X-Admin-Token'] = token;
  const r = await timed(() => call('/api/admin/consolidation-failed', { headers }));
  return { ms: r.ms, status: r.ok ? r.res.status : -1 };
}

async function run() {
  bannerStart(`admin-token timing (${TRIALS} trials per probe)`);

  const rows = [];
  for (const p of probes) {
    const samples = [];
    for (let i = 0; i < TRIALS; i++) {
      const { ms, status } = await timeCall(p.token);
      samples.push(ms);
      // expect 403 (or 401 if not authenticated for admin endpoints — server
      // returns 403 for wrong token).
      if (i === 0 && status !== 403 && status !== 401) {
        console.log(`  warn: probe "${p.name}" first response status=${status}`);
      }
    }
    rows.push({ name: p.name, p50: median(samples), p95: p95(samples) });
  }

  console.log(`  ${'probe'.padEnd(30)}  p50(ms)  p95(ms)`);
  for (const r of rows) {
    console.log(`  ${r.name}  ${r.p50.toFixed(1).padStart(7)}  ${r.p95.toFixed(1).padStart(7)}`);
  }

  // Rough verdict: p50 spread across the first 4 "same character, varying
  // length" probes should stay within ~2× (network jitter dominates). If
  // a monotonic, big gap shows up, that's a red flag.
  const lenProbes = rows.slice(0, 5).map((r) => r.p50);
  const spread = Math.max(...lenProbes) / Math.max(1, Math.min(...lenProbes));
  if (spread > 3) {
    bannerEnd(
      'admin-token timing',
      'WARN',
      `p50 spread ${spread.toFixed(1)}× across lengths — investigate`
    );
    return 1;
  }
  bannerEnd(
    'admin-token timing',
    'PASS',
    `p50 spread ${spread.toFixed(1)}× across lengths (within jitter)`
  );
  return 0;
}

process.exit(await run());
