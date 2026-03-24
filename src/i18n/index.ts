export type Lang = 'zh' | 'en' | 'ja';

const translations = {
  // ===== Start Screen =====
  'start.subtitle': {
    zh: 'HAIL MARY MISSION — COMM TERMINAL',
    en: 'HAIL MARY MISSION — COMM TERMINAL',
    ja: 'HAIL MARY MISSION — COMM TERMINAL',
  },
  'start.callLabel': {
    zh: '呼叫',
    en: 'CALLING',
    ja: '通信開始',
  },
  'start.desc': {
    zh: 'Eridian 通讯协议 · 噬星体中继网络 · 延迟 4.2 光年',
    en: 'Eridian Protocol · Astrophage Relay Network · Latency 4.2 ly',
    ja: 'エリディアン通信 · アストロファージ中継 · 遅延 4.2光年',
  },
  'start.callBtn': {
    zh: '建立星际链路',
    en: 'ESTABLISH LINK',
    ja: '星間リンク確立',
  },
  'start.footer': {
    zh: '⚠ 噬星体能源有限 · 仅支持 10 轮通讯',
    en: '⚠ Limited Astrophage energy · 10 transmissions only',
    ja: '⚠ アストロファージ残量わずか · 通信10回まで',
  },
  'start.connectingHeader': {
    zh: 'ESTABLISHING INTERSTELLAR LINK',
    en: 'ESTABLISHING INTERSTELLAR LINK',
    ja: 'ESTABLISHING INTERSTELLAR LINK',
  },
  'start.connectedFlash': {
    zh: 'SIGNAL LOCKED — ENTERING COMM CHANNEL',
    en: 'SIGNAL LOCKED — ENTERING COMM CHANNEL',
    ja: 'SIGNAL LOCKED — ENTERING COMM CHANNEL',
  },

  // ===== Chat Interface =====
  'chat.latency': {
    zh: 'LATENCY 4.2ly',
    en: 'LATENCY 4.2ly',
    ja: 'LATENCY 4.2ly',
  },
  'chat.remaining': {
    zh: 'REMAINING',
    en: 'REMAINING',
    ja: 'REMAINING',
  },
  'chat.inputPlaceholder': {
    zh: '发送星际消息...',
    en: 'Send interstellar message...',
    ja: '星間メッセージを送信...',
  },
  'chat.endedNotice': {
    zh: '── TRANSMISSION ENDED ──\n噬星体能源已耗尽 · 感谢与 Rocky 的对话',
    en: '── TRANSMISSION ENDED ──\nAstrophage energy depleted · Thank you for chatting with Rocky',
    ja: '── TRANSMISSION ENDED ──\nアストロファージ枯渇 · Rockyとの通話ありがとう',
  },
  'chat.senderYou': {
    zh: '你 (Earth)',
    en: 'You (Earth)',
    ja: 'あなた (Earth)',
  },
  'chat.translationLabel': {
    zh: '[翻译]',
    en: '[Translation]',
    ja: '[翻訳]',
  },

  // ===== Suggested Questions =====
  'suggest.1': {
    zh: 'Grace 最近怎么样？',
    en: 'How is Grace doing?',
    ja: 'Graceは最近どう？',
  },
  'suggest.2': {
    zh: '你们 Eridian 怎么表达开心？',
    en: 'How do Eridians express happiness?',
    ja: 'エリディアンはどうやって喜びを表現するの？',
  },
  'suggest.3': {
    zh: 'Erid 上的生活是什么样的？',
    en: 'What is life like on Erid?',
    ja: 'Eridでの生活はどんな感じ？',
  },
  'suggest.4': {
    zh: '你和 Grace 平时都做什么？',
    en: 'What do you and Grace usually do?',
    ja: 'GraceとRockyは普段何をしてるの？',
  },
  'suggest.5': {
    zh: '你想念太空旅行吗？',
    en: 'Do you miss space travel?',
    ja: '宇宙旅行が恋しい？',
  },
  'suggest.6': {
    zh: '人类的"音乐"你能理解吗？',
    en: 'Can you understand human "music"?',
    ja: '人間の「音楽」は理解できる？',
  },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang): string {
  return translations[key]?.[lang] ?? translations[key]?.en ?? key;
}

export function getSuggestions(lang: Lang): string[] {
  return [
    t('suggest.1', lang),
    t('suggest.2', lang),
    t('suggest.3', lang),
    t('suggest.4', lang),
    t('suggest.5', lang),
    t('suggest.6', lang),
  ];
}
