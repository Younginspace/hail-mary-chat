/**
 * Rocky prompt helpers — frontend-only subset.
 *
 * All system prompts, few-shots, and language instructions have been
 * moved to server/src/prompts/rocky.ts. This file only keeps:
 * - getRockyGreeting / getRockyFarewell (displayed locally before/after API calls)
 * - getTranslationLabel (used by MessageBubble for display)
 * - ROCKY_API_CONFIG (temperature/top_p sent as part of the request body)
 */

import type { Lang } from '../i18n';

/** API 调用参数配置 */
export const ROCKY_API_CONFIG = {
  temperature: 0.55,
  top_p: 0.9,
};

// ── Greeting / Farewell ──

export function getRockyGreeting(lang: Lang): string {
  switch (lang) {
    case 'en':
      return `[MOOD:happy]
[Translation] Amaze amaze amaze! Signal from Earth! Rocky very very happy! You are Grace friend, question? Grace always says Earth friends are good. Rocky wants to talk! What you want to know, question?`;

    case 'ja':
      return `[MOOD:happy]
[翻訳] すごいすごいすごい！地球からの信号！Rockyとてもとても嬉しい！あなたはGraceの友達、疑問文？Graceはいつも地球の友達はいいって言ってる。Rockyは話したい！何が知りたい、疑問文？`;

    default:
      return `[MOOD:happy]
[翻译] 了不起了不起了不起！地球来的信号！Rocky 非常非常开心！你是 Grace 的朋友，疑问句？Grace 总说地球朋友很好。Rocky 想聊！想知道什么，疑问句？`;
  }
}

// Returning-user greeting. Shown at the bottom of the chat (below
// the pre-loaded history + divider) when the user has previously had
// at least one consolidated session.
//
// Deliberately shorter than the first-call greeting and emotion-anchored
// at the "Rocky was waiting for your signal" beat — the core feeling
// the product exists to deliver. Audio is pre-rendered to
// /audio/defaults/greeting_returning_{lang}.mp3 (one fixed string per
// locale, no `{name}` substitution) so we don't burn /api/tts credits
// every time a user re-enters chat. Cleaned-text lookup in
// defaultDialogs.ts maps the visible string back to the static mp3.
export function getRockyGreetingReturning(lang: Lang): string {
  switch (lang) {
    case 'en':
      return `[MOOD:happy]
[Translation] Rocky waiting for your signal. What we talk today?`;

    case 'ja':
      return `[MOOD:happy]
[翻訳] Rockyずっと信号待ってた。今日何話す？`;

    default:
      return `[MOOD:happy]
[翻译] Rocky 等你信号呢。今天聊点啥？`;
  }
}

export function getRockyFarewell(lang: Lang): string {
  switch (lang) {
    case 'en':
      return `[MOOD:unhappy]
[Translation] Friend! Astrophage energy almost gone! Very expensive call but very very worth it! Rocky tells Grace you called. Grace will be happy happy happy. Fist my bump. Call again, question?`;

    case 'ja':
      return `[MOOD:unhappy]
[翻訳] 友達！アストロファージもうすぐなくなる！とても高い通話でもとてもとても価値ある！RockyはGraceに電話があったことを伝える。Graceは嬉しい嬉しい嬉しい。フィスト・マイ・バンプ。また電話して、疑問文？`;

    default:
      return `[MOOD:unhappy]
[翻译] 朋友！噬星体能源快没了！很贵的通话但是非常非常值得！Rocky 会告诉 Grace 你来过电话。Grace 会开心开心开心。碰拳。再打来，疑问句？`;
  }
}

// ── Display helpers ──

export function getTranslationLabel(lang: Lang): string {
  switch (lang) {
    case 'en': return '[Translation]';
    case 'ja': return '[翻訳]';
    default: return '[翻译]';
  }
}
