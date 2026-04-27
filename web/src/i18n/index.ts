export type Lang = 'zh' | 'en' | 'ja';

const translations = {
  // ===== Start Screen — handshake animation =====
  'start.subtitle': {
    zh: 'HAIL MARY MISSION — COMM TERMINAL',
    en: 'HAIL MARY MISSION — COMM TERMINAL',
    ja: 'HAIL MARY MISSION — COMM TERMINAL',
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

  // ===== Hero landing =====
  'hero.title': {
    zh: 'Call Rocky',
    en: 'Call Rocky',
    ja: 'Call Rocky',
  },
  'hero.releaseLabel': {
    zh: 'v2.0 更新说明',
    en: "What's new in v2.0",
    ja: 'v2.0 アップデート',
  },
  'hero.releaseFeature1': {
    zh: 'Rocky 记得你',
    en: 'Remembers you',
    ja: '覚えてくれる',
  },
  'hero.releaseFeature2': {
    zh: '好感度等级',
    en: 'Affinity levels',
    ja: '好感度レベル',
  },
  'hero.releaseFeature3': {
    zh: '收藏语音',
    en: 'Save voice clips',
    ja: '音声保存',
  },
  'hero.releaseFeature4': {
    zh: '导出聊天',
    en: 'Export chats',
    ja: 'チャット出力',
  },
  'hero.tagline': {
    zh: '来自 40 Eridani 的信号已连通',
    en: 'Signal from 40 Eridani — online',
    ja: '40 Eridaniからの信号 — オンライン',
  },
  'hero.dialInCta': {
    zh: '私人频道',
    en: 'DIAL IN',
    ja: 'ダイヤルイン',
  },
  'hero.dialInSub': {
    zh: 'Rocky 记得你',
    en: 'Rocky remembers you',
    ja: 'Rockyが覚えてる',
  },
  'hero.openChannelCta': {
    zh: 'Rocky Echo',
    en: 'ROCKY ECHO',
    ja: 'Rocky Echo',
  },
  'hero.openChannelSub': {
    zh: '听听 Rocky 平时会说什么',
    en: 'Listen to preset broadcasts',
    ja: 'プリセット放送を聞く',
  },

  // ===== Echo screen =====
  'echo.hint': {
    zh: 'Rocky 专属频道',
    en: 'Rocky-only Channel',
    ja: 'Rocky専用チャンネル',
  },
  'echo.allAnswered': {
    zh: '所有常见问题都听过了。想自己问 Rocky？',
    en: "That's all the presets. Want to ask Rocky yourself?",
    ja: 'プリセットは全部。自分で話したい？',
  },
  'echo.allAnsweredCta': {
    zh: 'Dial In',
    en: 'Dial In',
    ja: 'ダイヤルイン',
  },
  'echo.back': {
    zh: '返回首页',
    en: 'Back home',
    ja: 'ホームに戻る',
  },

  // ===== Share card (export → 分享为图片) =====
  'chat.exportShareCard': {
    zh: '分享为图片',
    en: 'Share as image',
    ja: '画像として共有',
  },
  'share.hint': {
    zh: '点消息选中 · 最多 6 条',
    en: 'Tap messages to include · up to 6',
    ja: 'メッセージをタップで選択・最大 6 件',
  },
  'share.counter': {
    zh: '已选 {n}/6',
    en: 'Selected {n}/6',
    ja: '選択中 {n}/6',
  },
  'share.generate': {
    zh: '生成图片',
    en: 'Generate',
    ja: '画像生成',
  },
  'share.cancel': {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
  },
  'share.maxReached': {
    zh: '最多选 6 条',
    en: 'Max 6 messages',
    ja: '最大 6 件まで',
  },
  'share.cardHeader': {
    zh: 'ROCKY ECHO · 通讯片段',
    en: 'ROCKY ECHO · TRANSMISSION LOG',
    ja: 'ROCKY ECHO · 通信ログ',
  },
  'share.senderYou': {
    zh: '你',
    en: 'YOU',
    ja: 'あなた',
  },
  'share.senderRocky': {
    zh: 'ROCKY',
    en: 'ROCKY',
    ja: 'ROCKY',
  },
  'share.senderGrace': {
    zh: 'GRACE',
    en: 'GRACE',
    ja: 'GRACE',
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
  'chat.sendButton': {
    zh: '发送',
    en: 'SEND',
    ja: '送信',
  },
  'chat.senderYou': {
    zh: '你 (Earth)',
    en: 'You (Earth)',
    ja: 'あなた (Earth)',
  },
  // Bubble header for Grace speaker blocks. Grace lives on Erid with
  // Rocky (canonical: stayed after the Hail Mary mission, refused the
  // ride home — see GRACE_CANONICAL_MEMORY). Location name kept in
  // English across all locales so "Rocky (Erid)" / "Grace (Erid)"
  // read as a matched pair regardless of UI language.
  'chat.senderGrace': {
    zh: 'Grace (Erid)',
    en: 'Grace (Erid)',
    ja: 'Grace (Erid)',
  },
  'chat.quotaExceededPanel': {
    zh: '今日通话的人太多了，资源不足，请改天再来吧！',
    en: 'Too many calls today, resources exhausted. Please come back another day!',
    ja: '本日は通話が多すぎてリソース不足です。また別の日に来てね！',
  },
  'chat.voiceExhausted': {
    zh: '缺少语音资源，还有 {time} 刷新',
    en: 'Out of voice resources — refreshes in {time}',
    ja: '音声リソース不足 — {time}後にリセット',
  },
  'chat.durationHoursMinutes': {
    zh: '{h} 小时 {m} 分钟',
    en: '{h}h {m}m',
    ja: '{h}時間{m}分',
  },
  'chat.durationMinutes': {
    zh: '{m} 分钟',
    en: '{m}m',
    ja: '{m}分',
  },
  'chat.rockyQuotaReply': {
    zh: '[MOOD:unhappy]\n[翻译] 今日通话的人太多了，资源不足，请改天再来吧！',
    en: '[MOOD:unhappy]\n[Translation] Too many calls today, resources exhausted. Please come back another day, friend!',
    ja: '[MOOD:unhappy]\n[翻訳] 今日は通話が多すぎてリソース不足です。また別の日に来てね！',
  },
  'chat.rockyNetworkError': {
    zh: '[MOOD:unhappy]\n[翻译] 星际链接不稳定，请重新发送。',
    en: '[MOOD:unhappy]\n[Translation] Interstellar link unstable. Please resend, friend.',
    ja: '[MOOD:unhappy]\n[翻訳] 星間リンクが不安定。もう一度送ってほしい。',
  },

  // ===== Chat: voice toggle =====
  'chat.voiceEnable': {
    zh: '开启 Rocky 语音',
    en: 'Enable Rocky voice',
    ja: 'Rocky音声をオン',
  },
  'chat.voiceDisable': {
    zh: '关闭 Rocky 语音',
    en: 'Mute Rocky voice',
    ja: 'Rocky音声をオフ',
  },

  // ===== Chat: export =====
  'chat.exportLabel': {
    zh: '导出',
    en: 'Export',
    ja: 'エクスポート',
  },
  'chat.exportMarkdown': {
    zh: '导出 Markdown',
    en: 'Download as Markdown',
    ja: 'Markdownでダウンロード',
  },
  'chat.exportImage': {
    zh: '保存为图片',
    en: 'Save as image',
    ja: '画像として保存',
  },
  'chat.exportFailed': {
    zh: '导出失败，请稍后再试',
    en: 'Export failed — please try again',
    ja: 'エクスポート失敗、もう一度試して',
  },
  'chat.exportTooLong': {
    zh: '对话太长，无法导出为图片。已帮你导出为 Markdown。',
    en: 'Chat too long to export as image — saved as Markdown instead.',
    ja: '会話が長すぎて画像にできない。Markdownで保存した。',
  },

  // ===== Chat: favorites =====
  'chat.favorites': {
    zh: '收藏夹',
    en: 'Favorites',
    ja: 'お気に入り',
  },
  'chat.favoritesEmpty': {
    zh: '还没收藏任何 Rocky 的话',
    en: "Haven't favorited anything yet",
    ja: 'まだお気に入りはない',
  },
  'chat.favoritesFull': {
    zh: '收藏夹已满（100 条上限），删几条再试',
    en: 'Favorites full (100 max) — remove a few first',
    ja: 'お気に入りが満杯（100件上限）、少し削除して',
  },
  'chat.favoritesDownload': {
    zh: '下载 MP3',
    en: 'Download MP3',
    ja: 'MP3ダウンロード',
  },
  'chat.favoritesRemove': {
    zh: '取消收藏',
    en: 'Remove',
    ja: '削除',
  },
  // Tooltip + aria-label when the ✕ is "armed" — first tap arms,
  // second tap within 3s commits. Phrasing tells the user "you've
  // already pressed once, press again to actually delete."
  'chat.favoritesRemoveConfirm': {
    zh: '再点一次确认删除',
    en: 'Tap again to confirm',
    ja: 'もう一度タップで削除',
  },

  // ===== Affinity levels (Rocky persona names — kept English) =====
  'level.1.name': { zh: 'Earth Signal', en: 'Earth Signal', ja: 'Earth Signal' },
  'level.2.name': { zh: 'Good Human', en: 'Good Human', ja: 'Good Human' },
  'level.3.name': { zh: 'Friend', en: 'Friend', ja: 'Friend' },
  'level.4.name': { zh: 'Fist My Bump', en: 'Fist My Bump', ja: 'Fist My Bump' },
  'level.upTitle': {
    zh: 'Rocky 跟你的好感度提升了！',
    en: "Rocky's affinity with you went up!",
    ja: 'Rockyとの親密度がアップ！',
  },
  'level.upSubtitle': {
    zh: '{from} → {to}',
    en: '{from} → {to}',
    ja: '{from} → {to}',
  },
  'level.upVoiceBonus': {
    zh: '语音额度 +{n}',
    en: '+{n} voice plays',
    ja: '音声+{n}',
  },
  'level.upImageBonus': {
    zh: 'Rocky 可以为你画 {n} 张图',
    en: 'Rocky can draw {n} picture(s) for you',
    ja: 'Rockyが{n}枚描ける',
  },
  'level.upMusicBonus': {
    zh: 'Rocky 可以为你做 {n} 段音乐',
    en: 'Rocky can compose {n} piece(s) for you',
    ja: 'Rockyが{n}曲作れる',
  },
  'level.upVideoBonus': {
    zh: 'Rocky 可以为你录一次视频（一生一次）',
    en: 'Rocky can record one video for you (once in a lifetime)',
    ja: 'Rockyが一度だけ動画を撮れる（一生に一度）',
  },
  'level.upContinue': {
    zh: '继续通讯',
    en: 'Continue',
    ja: '通信続行',
  },
  // Grace cameo bonus line — shown only after a level-up when
  // grace_credits > 0. The number is the cumulative remaining budget,
  // not the per-level delta (easier to understand as "how many more
  // times Grace can drop by").
  'level.upGraceBonus': {
    zh: 'Grace 还能串场 {n} 次',
    en: 'Grace can drop by {n} more time(s)',
    ja: 'Graceがあと{n}回顔を出せる',
  },

  // ===== Accessibility (aria-label / title) =====
  'aria.toggleHologram': {
    zh: '查看 Rocky 全息影像',
    en: 'Show hologram',
    ja: 'ホログラム表示',
  },
  'aria.toggleChat': {
    zh: '返回聊天',
    en: 'Show chat',
    ja: 'チャット表示',
  },
  'aria.play': {
    zh: '播放',
    en: 'Play',
    ja: '再生',
  },
  'aria.stop': {
    zh: '停止',
    en: 'Stop',
    ja: '停止',
  },
  'aria.favorite': {
    zh: '收藏',
    en: 'Favorite',
    ja: 'お気に入り',
  },
  'aria.unfavorite': {
    zh: '取消收藏',
    en: 'Unfavorite',
    ja: 'お気に入り解除',
  },

  // ===== Open Channel fallback =====
  'channel.noBroadcastFallback': {
    zh: '暂无广播',
    en: 'No broadcast',
    ja: '放送なし',
  },

  // ===== Ended panel =====
  'ended.line': {
    zh: '── 通讯结束 ──',
    en: '── TRANSMISSION ENDED ──',
    ja: '── 通信終了 ──',
  },
  'ended.callAgain': {
    zh: '再次呼叫 ROCKY',
    en: 'CALL ROCKY AGAIN',
    ja: 'もう一度 ROCKY に電話',
  },

  // ===== Suggested Questions (used by Echo default dialogs) =====
  'suggest.1': {
    zh: 'Grace 最近怎么样？',
    en: 'How is Grace doing?',
    ja: 'Graceは最近どう？',
  },
  'suggest.2': {
    zh: '你有伴侣吗？',
    en: 'Do you have a mate?',
    ja: 'Rockyにはパートナーがいる？',
  },
  'suggest.3': {
    zh: '太空旅行有什么趣事？',
    en: 'Any funny stories from space travel?',
    ja: '宇宙旅行で面白い話ある？',
  },
  'suggest.4': {
    zh: '江波星上的生活什么样？',
    en: "What's life like on Erid?",
    ja: 'Eridでの生活はどんな感じ？',
  },
  'suggest.5': {
    zh: '有人类觉得你长得像宠物蜘蛛。',
    en: 'Some humans think you look like a pet spider.',
    ja: '人間はRockyがペットの蜘蛛に見えるって。',
  },
  'suggest.6': {
    zh: '你怎么理解音乐？',
    en: 'How do you understand music?',
    ja: '音楽はどう理解してる？',
  },

  // ===== Login (email = 呼号, password = 通讯口令) =====
  'login.hookTitle': {
    zh: '留个呼号，Rocky 下次记得你',
    en: 'Give Rocky your callsign — he will remember you next time',
    ja: 'コールサインを教えて、次回Rockyが覚えてる',
  },
  'login.hookDesc': {
    zh: '登录后通讯无限时长，噬星体能源由 Hail Mary 号长期支持。',
    en: 'Logged-in friends get unlimited comm time. Astrophage energy sponsored by the Hail Mary.',
    ja: 'ログインすると通話時間無制限。アストロファージはHail Mary号が長期支援。',
  },
  'login.modeSignIn': {
    zh: '已经有呼号',
    en: 'I have a callsign',
    ja: 'コールサインあり',
  },
  'login.modeSignUp': {
    zh: '登记新呼号',
    en: 'Register callsign',
    ja: '新規コールサイン',
  },
  'login.callsignLabel': {
    zh: '呼号邮箱',
    en: 'Callsign (email)',
    ja: 'コールサイン（メール）',
  },
  'login.passwordLabel': {
    zh: '通讯口令',
    en: 'Comm passphrase',
    ja: '通信パスフレーズ',
  },
  'login.displayNameLabel': {
    zh: '显示呼号（可选）',
    en: 'Display name (optional)',
    ja: '表示名（任意）',
  },
  'login.submitSignIn': {
    zh: '连接',
    en: 'CONNECT',
    ja: '接続',
  },
  'login.submitSignUp': {
    zh: '登记并连接',
    en: 'REGISTER & CONNECT',
    ja: '登録して接続',
  },
  'login.later': {
    zh: '稍后再说',
    en: 'Later',
    ja: '後で',
  },
  'login.errorGeneric': {
    zh: '通讯节点拒绝，请检查呼号与口令',
    en: 'Relay rejected — check callsign and passphrase',
    ja: 'リレー拒否、コールサインとパスを確認',
  },
  'login.welcome': {
    zh: '通讯畅通 · 呼号 {callsign}',
    en: 'Link stable · Callsign {callsign}',
    ja: '通信安定 · コールサイン {callsign}',
  },
  'login.signOut': {
    zh: '断开登录',
    en: 'Sign out',
    ja: 'ログアウト',
  },
  'login.successTitle': {
    zh: '✓ 呼号登记成功',
    en: '✓ Callsign registered',
    ja: '✓ コールサイン登録完了',
  },
  'login.successDesc': {
    zh: '通讯畅通 · 呼号 {callsign} · Rocky 从此记得你',
    en: 'Link stable · Callsign {callsign} · Rocky will remember you',
    ja: '通信安定 · コールサイン {callsign} · Rockyは今後あなたを覚えている',
  },
  'login.successContinue': {
    zh: '继续通讯',
    en: 'CONTINUE',
    ja: '通信続行',
  },

  // ===== Dial-In screen =====
  'dialin.title': {
    zh: '拨入 Rocky 的私人频道',
    en: "Dial in to Rocky's private channel",
    ja: 'Rockyのプライベートチャンネルにダイヤルイン',
  },
  'dialin.back': {
    zh: '返回首页',
    en: 'Back',
    ja: '戻る',
  },
  'dialin.callsignPlaceholder': {
    zh: 'Ryland',
    en: 'Ryland',
    ja: 'Ryland',
  },
  'dialin.callsignChecking': {
    zh: '核对呼号中...',
    en: 'Checking callsign...',
    ja: 'コールサイン確認中...',
  },
  'dialin.callsignAvailable': {
    zh: '✓ 呼号可用',
    en: '✓ Callsign available',
    ja: '✓ コールサイン使用可',
  },
  'dialin.callsignTaken': {
    zh: '这个呼号刚被别人抢了，换一个试试',
    en: 'This callsign was just taken. Pick another, friend.',
    ja: 'このコールサインは誰かに取られた。別のを試して。',
  },
  'dialin.callsignInvalid': {
    zh: '呼号 3-32 个字符，字母/数字/空格/下划线',
    en: 'Callsign 3-32 chars, letters / digits / spaces / _ / -',
    ja: 'コールサインは3-32文字、英数字/スペース/_/-',
  },
  'dialin.passphraseHint': {
    zh: '至少 8 位',
    en: 'At least 8 characters',
    ja: '8文字以上',
  },

  // ===== Gift bubble (F6 Phase 2) =====
  'gift.typeImage': {
    zh: 'Rocky 画给你的',
    en: 'A sketch from Rocky',
    ja: 'Rockyが描いた絵',
  },
  'gift.typeRealistic': {
    zh: 'Rocky 现场打卡',
    en: 'Rocky checking in',
    ja: 'Rockyの現場写真',
  },
  'gift.typeComic': {
    zh: 'Rocky 手绘',
    en: "Rocky's hand-drawing",
    ja: 'Rockyの手描き',
  },
  'gift.comicSignature': {
    zh: '这是我手绘的',
    en: 'This is my hand-drawing',
    ja: 'これは手描きの',
  },
  'chat.hangup': {
    zh: '结束通话',
    en: 'End call',
    ja: '通話終了',
  },
  'chat.hangupConfirmTitle': {
    zh: '结束这次通讯？',
    en: 'End this transmission?',
    ja: 'この通信を終了する？',
  },
  'chat.hangupConfirmDesc': {
    zh: 'Rocky 会记住你们的对话，下次拨入继续聊。',
    en: 'Rocky will remember this talk. Dial in again any time.',
    ja: 'Rockyは会話を覚えてる。またいつでもダイヤルインして。',
  },
  'chat.hangupConfirmYes': {
    zh: '确认挂断',
    en: 'End call',
    ja: '通話終了',
  },
  'chat.hangupConfirmNo': {
    zh: '继续聊',
    en: 'Keep talking',
    ja: '続ける',
  },
  'gift.typeMusic': {
    zh: 'Rocky 送你的声音',
    en: 'A sound from Rocky',
    ja: 'Rockyからの音',
  },
  'gift.typeVideo': {
    zh: 'Rocky 拍给你的',
    en: 'A clip from Rocky',
    ja: 'Rockyの映像',
  },
  'gift.pending': {
    zh: 'Rocky 在做……',
    en: 'Rocky is making it…',
    ja: 'Rockyが作ってる…',
  },
  'gift.failed': {
    zh: '这次传不过来，下次 Rocky 再试。',
    en: 'Signal lost this time. Rocky will try again.',
    ja: '今回は届かなかった。Rockyは次回また試す。',
  },
  'gift.download': {
    zh: '下载',
    en: 'Download',
    ja: 'ダウンロード',
  },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  if (!entry && import.meta.env.DEV) {
    // Loudly flag missing keys in dev so we catch drift before prod.
    // Prod silently falls through to the key name (old behavior).
    console.warn(`[i18n] missing key: ${String(key)}`);
  }
  let text: string = entry?.[lang] ?? entry?.en ?? (key as string);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
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
