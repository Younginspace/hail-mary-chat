// Map adoption-failure error codes (returned by useAuthSession's
// signInEmail/signUpEmail as `adoption_failed:<code>` in result.error.message)
// to user-facing i18n keys.
//
// Added 2026-05-22 after the orphan-auth-user incident: the old client
// swallowed adopt-device failures as `null` and the UI fell through to
// the generic "通讯节点拒绝", which was indistinguishable from a wrong
// password and led users to switch emails repeatedly. This helper makes
// failures specific again.

import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';

const PREFIX = 'adoption_failed:';

// Stable machine codes match server adoption_failures.error_code.
// New codes added on the server should also land here, otherwise the UI
// falls back to login.errorGeneric.
const CODE_TO_KEY: Record<string, TranslationKey> = {
  not_authenticated: 'login.adopt.notAuthenticated',
  missing_device_id: 'login.adopt.server',
  invalid_callsign: 'login.adopt.invalidCallsign',
  callsign_taken: 'dialin.callsignTaken',
  not_supported: 'login.adopt.notSupported',
  rate_limited: 'login.adopt.rateLimited',
  network_error: 'login.adopt.network',
  internal_error: 'login.adopt.server',
  unknown: 'login.errorGeneric',
};

/**
 * If the auth-client error message is an adoption-failure synthetic
 * (`adoption_failed:<code>`), return the localized message. Otherwise
 * return null, signalling the caller to fall through to its existing
 * generic display.
 */
export function adoptionErrorMessage(
  errorMessage: string | undefined | null,
  lang: Lang
): string | null {
  if (!errorMessage || !errorMessage.startsWith(PREFIX)) return null;
  const code = errorMessage.slice(PREFIX.length);
  const key = CODE_TO_KEY[code] ?? 'login.errorGeneric';
  return t(key, lang);
}

// Build a short, safe diagnostic tag to append to an adoption-failure
// message so a stuck user can screenshot a code we can grep in server
// logs. Added 2026-05-30 for the Serena/Lucca/19084 stuck-login bug:
//   • `ERR-<ref>`  — server's app.onError fired (in-handler throw); the
//                    same ref is in the [onError] log line with the stack.
//   • `HTTP-<n>`   — no server ref (framework-level 401/500 before our
//                    handler ran); the status itself is the clue.
// Returns '' for non-adoption errors (e.g. better-auth wrong-password) so
// we don't bolt confusing codes onto normal validation messages.
export function adoptionDiagTag(
  error: { message?: string; ref?: string; status?: number } | null | undefined
): string {
  if (!error || typeof error.message !== 'string' || !error.message.startsWith(PREFIX)) {
    return '';
  }
  if (error.ref) return `ERR-${error.ref}`;
  if (typeof error.status === 'number' && error.status > 0) return `HTTP-${error.status}`;
  return '';
}
