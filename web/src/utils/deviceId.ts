// Anonymous device identity. UUIDv4 stored in localStorage.
// P4 will introduce real auth; at that point we "adopt" this device_id's
// history into the newly-created account.

import { genUuid } from './uuid';

const STORAGE_KEY = 'rocky_device_id';

function generate(): string {
  return genUuid();
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

// Wipe the persisted device_id. Called on sign-out so the next user on the
// same browser gets a fresh anonymous identity (prevents /api/adopt-device
// 409 "device_linked_to_other_account" when account B tries to register on
// a device still linked to account A).
export function resetDeviceId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
