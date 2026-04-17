// Stress 02 — isDisposableEmail black-box verification (no server calls)
//
// Reuses the exact logic from server/src/index.ts. Pins regressions on
// the domain walk: subdomain catch, case-insensitivity, trailing dot,
// and the legitimate-domain allowlist.
//
// We can't probe the live endpoint for disposable rejections without a
// real better-auth signup — that's costly and would require creating
// throwaway accounts. Instead, mirror the logic in this file and make
// sure every failure case the review flagged is covered.

import { bannerStart, bannerEnd } from './lib.mjs';

const DISPOSABLE = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'throwaway.email',
  'yopmail.com',
  'getnada.com',
  'sharklasers.com',
  'dispostable.com',
  'trashmail.com',
  'maildrop.cc',
  'fakeinbox.com',
  'emailondeck.com',
  'mohmal.com',
  'moakt.com',
]);

// Mirror of server/src/index.ts disposableCandidateDomains + isDisposableEmail.
function candidates(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return [];
  let domain = email.slice(at + 1).trim().toLowerCase();
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (!domain) return [];
  const parts = domain.split('.');
  if (parts.length < 2) return [domain];
  const out = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(parts.slice(i).join('.'));
  return out;
}

function isDisposable(email) {
  for (const c of candidates(email)) if (DISPOSABLE.has(c)) return true;
  return false;
}

const tests = [
  // Should BLOCK (disposable)
  ['foo@mailinator.com', true, 'exact match'],
  ['FOO@MAILINATOR.COM', true, 'case-insensitive'],
  ['foo@MAILINATOR.COM.', true, 'trailing dot'],
  ['foo+tag@mailinator.com', true, 'plus-addressing on disposable'],
  ['foo@x.mailinator.com', true, 'subdomain of disposable'],
  ['foo@mail.guerrillamail.com', true, 'deep subdomain'],
  ['a@yopmail.com', true],
  ['a@10minutemail.com', true],
  ['a@maildrop.cc', true],
  // Should ALLOW (legit)
  ['foo@gmail.com', false, 'legit major provider'],
  ['foo@example.com', false, 'legit test domain'],
  ['foo@hailmary.space', false, 'project domain'],
  ['foo@protonmail.com', false, 'legit privacy provider'],
  // Legit domains with confusing suffixes — MUST allow
  ['foo@attacker-owned.com', false, 'user-controlled domain, NOT listed'],
  ['foo@mailinator.co', false, 'typosquat of mailinator.com — not on list, allowed'],
  // Tricky: lookalike where "mailinator.com" appears as a label but email
  // routes to attacker-owned.com. This is NOT a bypass of our intent
  // (mail goes to attacker, not mailinator) — we don't need to block it.
  ['foo@mailinator.com.attacker-owned.com', false, 'lookalike — routes to attacker, allowed'],
  // Edge cases
  ['', false, 'empty'],
  ['no-at-sign', false, 'malformed'],
  [null, false, 'null'],
  [undefined, false, 'undefined'],
];

async function run() {
  bannerStart('disposable-email logic (offline mirror)');

  let pass = 0;
  let fail = 0;
  for (const [email, expected, note] of tests) {
    const got = email == null ? false : isDisposable(email);
    const ok = got === expected;
    if (ok) pass++;
    else fail++;
    const icon = ok ? ' ✓' : ' ✗';
    const pad = (email ?? '<nullish>').padEnd(50);
    const tag = note ? `(${note})` : '';
    console.log(`  ${icon} ${pad} → ${got} (expect ${expected}) ${tag}`);
  }

  if (fail === 0) {
    bannerEnd('disposable-email logic', 'PASS', `${pass}/${tests.length}`);
    return 0;
  }
  bannerEnd('disposable-email logic', 'FAIL', `${fail} of ${tests.length} mismatched`);
  return 1;
}

process.exit(await run());
