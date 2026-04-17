// Stress harness runner — sequential, prints a summary at the end.
//
// Usage (local):
//   # 1. Start worker separately:  cd server && edgespark dev
//   # 2. Run:
//   node scripts/stress/run-all.mjs
//
// Usage (remote staging):
//   TARGET=https://xxx.edgespark.app COOKIE='...' \
//     node scripts/stress/run-all.mjs
//
// Environment:
//   TARGET      — base URL (default http://localhost:3001)
//   COOKIE      — auth cookie for 03/04/05 (those need a real user)
//   N           — override concurrency for 01/05
//   CAP         — cap override for 04 (default 100)
//   CONCURRENT  — concurrent writes for 04 (default 8)
//   TRIALS      — probes per length for 06 (default 80)
//
// Exit non-zero if any scenario fails.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const scenarios = [
  '01-rate-limit.mjs',
  '02-disposable-email.mjs',
  '03-session-start-cas.mjs',
  '04-favorites-cap.mjs',
  '05-message-end-race.mjs',
  '06-admin-token-timing.mjs',
];

function run(file) {
  return new Promise((resolveP) => {
    const p = spawn('node', [resolve(here, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    p.on('exit', (code) => resolveP(code ?? 1));
  });
}

const results = {};
for (const f of scenarios) {
  const code = await run(f);
  results[f] = code;
}

console.log('\n── Summary ────────────────────────────────────────────');
let anyFail = 0;
for (const [f, code] of Object.entries(results)) {
  const icon = code === 0 ? '✅' : code === 1 ? '⚠️ ' : '❌';
  console.log(`${icon} ${f} → exit ${code}`);
  if (code >= 2) anyFail++;
}
console.log('───────────────────────────────────────────────────────');
process.exit(anyFail > 0 ? 2 : 0);
