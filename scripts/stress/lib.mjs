// Shared helpers for stress scripts. Zero dependencies — Node 20+ native fetch.
//
// TARGET resolution order:
//   1. --target=URL flag
//   2. process.env.TARGET
//   3. http://localhost:3001  (default, matches web/vite.config.ts proxy)

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { flags: {}, positional: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out.flags[k] = v ?? true;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

const { flags } = parseArgs();
export const TARGET =
  (typeof flags.target === 'string' && flags.target) ||
  process.env.TARGET ||
  'http://localhost:3001';

export function randomDeviceId() {
  // Match server's regex: /^[A-Za-z0-9._\-]{8,128}$/
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `stress-${s}`;
}

export function randomEmail(prefix = 'stress') {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${r}@example.test`;
}

export async function timed(fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    return { ok: true, ms: performance.now() - t0, res };
  } catch (err) {
    return { ok: false, ms: performance.now() - t0, err };
  }
}

export function summarize(results) {
  const ms = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  if (ms.length === 0) return { n: 0 };
  const p = (q) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
  return {
    n: results.length,
    ok: ms.length,
    failed: results.length - ms.length,
    min: +ms[0].toFixed(1),
    p50: +p(0.5).toFixed(1),
    p95: +p(0.95).toFixed(1),
    max: +ms[ms.length - 1].toFixed(1),
  };
}

export function bannerStart(name) {
  console.log(`\n▶ ${name}`);
  console.log(`  target: ${TARGET}`);
}

export function bannerEnd(name, verdict, detail = '') {
  const icon = verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️ ' : '❌';
  console.log(`${icon} ${name}: ${verdict}${detail ? ` — ${detail}` : ''}`);
}

// Best-effort fetch helper. Captures body for diagnostics.
export async function call(path, init = {}) {
  const url = `${TARGET}${path}`;
  const res = await fetch(url, init);
  let body;
  try {
    body = await res.text();
    try {
      body = JSON.parse(body);
    } catch {
      // keep as text
    }
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body, headers: Object.fromEntries(res.headers) };
}
