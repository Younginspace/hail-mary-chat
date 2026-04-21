// Polyfill-aware UUID v4 generator.
//
// crypto.randomUUID() requires a Secure Context AND a modern browser.
// Chinese in-app browsers (WeChat / QQ / UC / 老版 Android WebView) often
// don't expose it — calling crypto.randomUUID() throws TypeError, which
// broke every /api/chat send on those devices after we switched to UUID
// ids for assistant messages. Fallback to getRandomValues (broadly
// supported since ~2013) and do the RFC 4122-ish formatting ourselves.
export function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(rand);
  } else {
    // Extreme last resort — Math.random is not cryptographically strong
    // but for a client-generated message id it's fine.
    for (let i = 0; i < 16; i++) rand[i] = (Math.random() * 256) | 0;
  }
  // RFC 4122 v4: version=4 in high nibble of byte 6, variant=10xx in
  // high nibble of byte 8.
  rand[6] = (rand[6] & 0x0f) | 0x40;
  rand[8] = (rand[8] & 0x3f) | 0x80;
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
