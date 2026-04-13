// Anonymous device identity. UUIDv4 stored in localStorage.
// P4 will introduce real auth; at that point we "adopt" this device_id's
// history into the newly-created account.

const STORAGE_KEY = 'rocky_device_id';

function generate(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers — 32 hex chars
  const rand = new Uint8Array(16);
  (crypto as Crypto).getRandomValues(rand);
  return Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = generate();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Private mode / disabled storage — give a per-tab id so at least this
    // session stays consistent. We lose quota enforcement; accept that.
    return generate();
  }
}
