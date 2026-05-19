// Build-time feature flags. Read from Vite env (VITE_* prefix is
// the only way to expose env to the client bundle).
//
// To enable in dev: create web/.env.development.local with
//   VITE_COMPANION_ENABLED=true
// (file is gitignored — never commit it)
//
// In prod: variable is unset → flag is false → entry CTAs hidden.
// To unlock after real assets land:
//   1. Replace web/public/audio/companion/v1/*.mp3 placeholders
//   2. Set VITE_COMPANION_ENABLED=true in EdgeSpark var config
//      (or whatever the platform's build-time env injection mechanism is)
//   3. edgespark deploy

/**
 * Companion mode v1 entry-CTA gate. When false, StartScreen's
 * "STAY CONNECTED" button and ChatInterface's 🛰 button are hidden.
 * The CompanionScreen + useCompanionAudio code still ship in the
 * bundle (small, ~10KB) but are unreachable from the UI.
 *
 * Default: false. Flip on after real asset mp3s replace placeholders.
 */
export const COMPANION_ENABLED = import.meta.env.VITE_COMPANION_ENABLED === 'true';
