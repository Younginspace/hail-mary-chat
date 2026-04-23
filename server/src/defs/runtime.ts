// Typed runtime input keys for app code.
// VarKey and SecretKey are string literal union types, not values or config storage.
// Add a key here before using vars.get("KEY") or secret.get("KEY") in code.
// Values still come from .env.local in local dev and remote vars/secrets in deployed envs.

export type VarKey =
  | "MINIMAX_API_URL"
  | "MINIMAX_MODEL"
  | "MINIMAX_TTS_API_URL"
  | "MINIMAX_TTS_MODEL"
  | "MINIMAX_TTS_VOICE_ID"
  // Grace cameo voice (cloned Gosling sample). Optional — falls back to
  // Rocky's voice when unset so Grace lines still play, just in the
  // wrong voice, instead of 500-ing.
  | "MINIMAX_TTS_VOICE_ID_GRACE";

export type SecretKey =
  | "MINIMAX_API_KEY"
  // Gate admin-only endpoints (rapport recalibration, stuck-job retry).
  // Pass as `X-Admin-Token: <value>` header. Set via `edgespark secret set ADMIN_TOKEN`.
  | "ADMIN_TOKEN";
