// Remembers the last-used callsign email so returning visitors only need
// to re-enter their passphrase. Survives sign-out on purpose — that's
// the whole point of the convenience.

const KEY = 'rocky_last_email';

export function loadRememberedEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberEmail(email: string): void {
  try {
    const trimmed = email.trim();
    if (trimmed) localStorage.setItem(KEY, trimmed);
  } catch {
    /* ignore */
  }
}
