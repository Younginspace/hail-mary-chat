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
