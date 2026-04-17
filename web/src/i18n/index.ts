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
  'start.textBtn': {
    zh: '文字通话',
    en: 'TEXT CHAT',
    ja: 'テキスト通話',
  },
  'start.voiceBtn': {
    zh: '语音通话',
    en: 'VOICE CALL',
    ja: '音声通話',
  },
  'start.textHint': {
    zh: '单轮最多 50 条消息',
    en: 'Up to 50 messages per session',
    ja: '1セッション最大50メッセージ',
  },
  'start.voiceHint': {
    zh: '单轮最多 10 条消息',
    en: 'Up to 10 messages per session',
    ja: '1セッション最大10メッセージ',
  },
  'start.textDailyUsed': {
    zh: '次数已用完，点击分享获取更多',
    en: 'Sessions used up, tap to share for more',
    ja: '回数切れ、タップしてシェアで追加',
  },
  'start.voiceDailyUsed': {
    zh: '今日通话次数已用完，明日刷新',
    en: 'Daily sessions used up, resets tomorrow',
    ja: '本日の通話回数を使い切りました、明日リセット',
  },
  'start.textDisabled': {
    zh: '噬星体能源暂时不足，5 小时内自动恢复',
    en: 'Astrophage temporarily low, auto-resets within 5 hours',
    ja: 'アストロファージ一時不足、5時間以内に自動回復',
  },
  'start.voiceDisabled': {
    zh: '今日特殊噬星体能源已用完，{time} 后恢复',
    en: 'Special Astrophage depleted today, resets in {time}',
    ja: '本日の特殊アストロファージ枯渇、{time} 後に回復',
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
  'chat.modeText': {
    zh: '文字通话：无自定义语音',
    en: 'TEXT MODE: No custom voice',
    ja: 'テキスト通話：カスタム音声なし',
  },
  'chat.modeVoice': {
    zh: '语音通话',
    en: 'VOICE MODE',
    ja: '音声通話',
  },
  'chat.modeRemaining': {
    zh: '本次剩余 {n} 条',
    en: '{n} messages left',
    ja: '残り {n} メッセージ',
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
  // ===== Ended Panel =====
  'ended.line': {
    zh: '── 通讯结束 ──',
    en: '── TRANSMISSION ENDED ──',
    ja: '── 通信終了 ──',
  },
  'ended.remaining': {
    zh: '你还有 {n} 次通话机会。',
    en: 'You have {n} call(s) remaining.',
    ja: 'あと {n} 回通話できます。',
  },
  'ended.callAgain': {
    zh: '再次呼叫 ROCKY',
    en: 'CALL ROCKY AGAIN',
    ja: 'もう一度 ROCKY に電話',
  },
  'ended.shareToGet': {
    zh: '分享获取 +1 次通话（剩余 {n} 次）',
    en: 'SHARE TO GET +1 CALL ({n} left)',
    ja: 'シェアして +1 通話（残り {n} 回）',
  },
  'ended.shareToRefuel': {
    zh: '分享获取 +1 次通话',
    en: 'SHARE TO GET +1 CALL',
    ja: 'シェアして +1 通話',
  },
  'ended.linkCopied': {
    zh: '链接已复制！',
    en: 'LINK COPIED!',
    ja: 'リンクをコピーしました！',
  },
  'ended.depleted': {
    zh: '噬星体能源已耗尽，分享可补充能源！（剩余 {n} 次分享机会）',
    en: 'Astrophage depleted. Share to refuel! ({n} share(s) remaining)',
    ja: 'アストロファージ枯渇。シェアで補充！（残り {n} 回シェア可能）',
  },
  'ended.offline': {
    zh: '噬星体能源已完全耗尽，星际中继离线。\n请联系设备维修员 — Young',
    en: 'All Astrophage energy depleted. Interstellar relay offline.\nPlease contact device maintenance engineer — Young',
    ja: 'アストロファージ完全枯渇。星間リレーオフライン。\n設備整備士 Young までご連絡ください',
  },
  'ended.dailyDepleted': {
    zh: '今日噬星体能源不足，培育中，请明日再来',
    en: 'Astrophage energy insufficient today. Regenerating. Please return tomorrow.',
    ja: '本日のアストロファージ不足、培養中。明日またお越しください',
  },
  'ended.unlocked': {
    zh: '+1 噬星体能源已获取！（剩余 {n} 次分享机会）',
    en: '+1 Astrophage energy acquired! ({n} shares left)',
    ja: '+1 アストロファージ取得！（残り {n} 回シェア可能）',
  },

  // ===== Share Gate =====
  'gate.title.depleted': {
    zh: '噬星体能源耗尽',
    en: 'ASTROPHAGE DEPLETED',
    ja: 'アストロファージ枯渇',
  },
  'gate.title.offline': {
    zh: '星际中继离线',
    en: 'RELAY OFFLINE',
    ja: 'リレーオフライン',
  },
  'gate.title.unlocked': {
    zh: '通讯已解锁',
    en: 'TRANSMISSION UNLOCKED',
    ja: '通信ロック解除',
  },
  'gate.unlocked.desc': {
    zh: '+1 噬星体能源已获取，正在连接…',
    en: '+1 Astrophage energy acquired. Connecting...',
    ja: '+1 アストロファージ取得。接続中…',
  },
  'gate.share.desc': {
    zh: '分享 Rocky 给朋友，补充中继能源！（剩余 {n} 次分享机会）',
    en: 'Share Rocky with a friend to refuel your relay! ({n} share(s) remaining)',
    ja: '友達に Rocky をシェアしてリレーを補充！（残り {n} 回シェア可能）',
  },

  // ===== Login (P4: narrative — email=呼号, password=通讯口令) =====
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
  'version.badge': {
    zh: 'v3.0 · 记忆系统已上线',
    en: 'v3.0 · MEMORY SYSTEM ONLINE',
    ja: 'v3.0 · メモリシステム稼働中',
  },
  'version.tagline': {
    zh: 'Rocky 现在会记住每一位朋友',
    en: 'Rocky now remembers every friend',
    ja: 'Rockyは友達一人ひとりを覚えている',
  },

  // ===== P5 F1: Open Channel + Dial In =====
  'channel.title': {
    zh: 'OPEN CHANNEL · 公共频道',
    en: 'OPEN CHANNEL',
    ja: 'OPEN CHANNEL · 公共チャンネル',
  },
  'channel.desc': {
    zh: '听 Rocky 回答朋友们常问的问题。想亲自通话？拨号进来。',
    en: "Listen to Rocky's broadcast answers. Want to talk to him yourself? Dial in.",
    ja: '友達からよくある質問へのRockyの答えを聞く。直接話したい？ダイヤルインして。',
  },
  'channel.loading': {
    zh: '正在接收广播...',
    en: 'Receiving broadcast...',
    ja: '放送受信中...',
  },
  'channel.empty': {
    zh: '频道暂无广播',
    en: 'No broadcast on this channel',
    ja: 'このチャンネルに放送なし',
  },
  'channel.dialInCta': {
    zh: '拨入私人频道',
    en: 'DIAL IN PRIVATE CHANNEL',
    ja: 'プライベートチャンネルにダイヤルイン',
  },
  'channel.dialInHint': {
    zh: '登记呼号后，Rocky 会永远记得你',
    en: 'Register a callsign — Rocky will remember you forever',
    ja: 'コールサインを登録したら、Rockyはずっと覚えてる',
  },
  'dialin.title': {
    zh: '拨入 Rocky 的私人频道',
    en: "Dial in to Rocky's private channel",
    ja: 'Rockyのプライベートチャンネルにダイヤルイン',
  },
  'dialin.back': {
    zh: '← 返回公共频道',
    en: '← Back to Open Channel',
    ja: '← 公共チャンネルに戻る',
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
  'dialin.signupHint': {
    zh: '首次拨入 · 登记你的呼号',
    en: 'First dial-in · register your callsign',
    ja: '初回ダイヤルイン · コールサインを登録',
  },
  'dialin.signinHint': {
    zh: '已有呼号 · 重新连接',
    en: 'Have a callsign · reconnect',
    ja: '既存コールサイン · 再接続',
  },

  // ===== Share Content =====
  'share.title': {
    zh: '和外星人 Rocky 通话 — 挽救计划',
    en: 'Talk to Rocky — Project Hail Mary',
    ja: 'エイリアン Rocky と通話 — プロジェクト・ヘイル・メアリー',
  },
  'share.text': {
    zh: '我刚和外星人通了电话！来自《挽救计划》的 Rocky 正在等你的来电。',
    en: "I just talked to an alien! Rocky from Project Hail Mary is waiting for your call.",
    ja: '宇宙人と話しちゃった！ヘイル・メアリーの Rocky があなたの電話を待ってるよ。',
  },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang, vars?: Record<string, string | number>): string {
  let text = translations[key]?.[lang] ?? translations[key]?.en ?? key;
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
