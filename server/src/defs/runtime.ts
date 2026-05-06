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
  // MiniMax pay-as-you-go key (sk-api-*). Required for MiniMax's
  // /v1/voice_clone endpoint (Coding Plan keys are rejected with a
  // misleading 1008 "insufficient balance"). Kept for ops tools:
  // /api/admin/list-voices and /api/admin/voice-preview. Do NOT use
  // for regular TTS — Grace's cloned voice renders fine on the
  // subscription key after its first sk-api- activation call.
  | "MINIMAX_API_KEY"
  // MiniMax Coding Plan subscription key (sk-cp-*). Billed through the
  // operator's monthly subscription (chars / month), not the cash
  // wallet. Use for /api/chat, /api/tts, and future /api/generate-media
  // (image / music / video). Must NOT be used for /v1/voice_clone —
  // that endpoint isn't gated to this key type and returns 1008.
  | "MINIMAX_CODING_PLAN_KEY"
  // Gate admin-only endpoints (rapport recalibration, stuck-job retry).
  // Pass as `X-Admin-Token: <value>` header. Set via `edgespark secret set ADMIN_TOKEN`.
  | "ADMIN_TOKEN"
  // Aliyun DashScope (百炼) API key. Reused by:
  //   #07 voice input — Paraformer-v2 ASR (/api/asr)
  //   #06 image input — Qwen-VL-Max chat-with-image (/api/chat image branch)
  // Bearer-token auth, no signing. Set via `edgespark secret set DASHSCOPE_API_KEY`.
  | "DASHSCOPE_API_KEY";
