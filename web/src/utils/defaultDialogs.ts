// 预置对话：问题 + Rocky 的回复 + mood + 音频路径
// 点击预置 prompt 时直接出结果，不调 LLM 和 TTS

import type { Lang } from '../i18n';
import type { RockyMood } from './rockyAudio';
import { getRockyGreeting, getRockyFarewell } from '../prompts/rocky';
import { extractPlayableText } from './messageCleanup';

export interface DefaultDialog {
  question: string;        // 对应 suggest 按钮的文本
  mood: RockyMood;
  reply: string;           // Rocky 的完整回复（含标签，供 MessageBubble 渲染）
  ttsText: string;         // 纯文本，供 TTS 音频用
  audioFile: string;       // 预生成的 TTS 音频路径
}

// ── 英文预置 ──
const EN_DIALOGS: DefaultDialog[] = [
  {
    question: 'How is Grace doing?',
    mood: 'happy',
    reply: `[MOOD:happy]\n[Translation] Good good good! Grace is good! Today he went to ammonia lake, said found interesting microbe. Grace always finding interesting things. He eats good, sleeps good. Rocky checks every night. Best friend needs best care, statement.`,
    ttsText: 'Good good good! Grace is good! Today he went to ammonia lake, said found interesting microbe. Grace always finding interesting things. He eats good, sleeps good. Rocky checks every night. Best friend needs best care, statement.',
    audioFile: '/audio/defaults/en_1.mp3',
  },
  {
    question: 'Do you have a mate?',
    mood: 'happy',
    reply: `[MOOD:happy]\n[Translation] Yes yes! Rocky has mate. Eridians mate for life. Rocky is home now, so all good. Grace gave mate human name — Adrian. Because Eridian name too long for human mouth. Very Grace thing to do, statement.`,
    ttsText: 'Yes yes! Rocky has mate. Eridians mate for life. Rocky is home now, so all good. Grace gave mate human name — Adrian. Because Eridian name too long for human mouth. Very Grace thing to do, statement.',
    audioFile: '/audio/defaults/en_2.mp3',
  },
  {
    question: 'Any funny stories from space travel?',
    mood: 'laugh',
    reply: `[MOOD:laugh]\n[Translation] First time seeing human ship! So small! So fragile! Grace floated inside like soft blob in a can. Rocky thought: this species survives how, question? Then Grace solved three problems in one day. Amaze amaze amaze. Never judge species by ship size.`,
    ttsText: 'First time seeing human ship! So small! So fragile! Grace floated inside like soft blob in a can. Rocky thought: this species survives how, question? Then Grace solved three problems in one day. Amaze amaze amaze. Never judge species by ship size.',
    audioFile: '/audio/defaults/en_3.mp3',
  },
  {
    question: 'What\'s life like on Erid?',
    mood: 'happy',
    reply: `[MOOD:happy]\n[Translation] Erid is best planet. No light — we hear everything. Big ammonia oceans, deep caves, strong structures. Very busy, very loud, very alive. Grace says Earth is "pretty." Rocky thinks Erid is pretty. Prettier. Rocky is biased, statement.`,
    ttsText: 'Erid is best planet. No light — we hear everything. Big ammonia oceans, deep caves, strong structures. Very busy, very loud, very alive. Grace says Earth is pretty. Rocky thinks Erid is pretty. Prettier. Rocky is biased, statement.',
    audioFile: '/audio/defaults/en_4.mp3',
  },
  {
    question: 'Some humans think you look like a pet spider.',
    mood: 'question',
    reply: `[MOOD:question]\n[Translation] Spider, question? Rocky looked up spider. Five limbs, strong, good builder. Rocky sees no problem. Pet part is wrong — Rocky is engineer. Very very good engineer. Humans are more like pets. Soft. Need feeding. Need watching during sleep, statement.`,
    ttsText: 'Spider, question? Rocky looked up spider. Five limbs, strong, good builder. Rocky sees no problem. Pet part is wrong — Rocky is engineer. Very very good engineer. Humans are more like pets. Soft. Need feeding. Need watching during sleep, statement.',
    audioFile: '/audio/defaults/en_5.mp3',
  },
  {
    question: 'How do you understand music?',
    mood: 'happy',
    reply: `[MOOD:happy]\n[LIKE]\n[Translation] Music! Yes yes! Rocky loves! For Eridian, sound IS everything. Language, music, feeling — all connected. When Grace played "Beatles," Rocky felt patterns humans cannot describe. Like tasting math. Very very beautiful. Grace cried. Humans leak when happy too, question?`,
    ttsText: 'Music! Yes yes! Rocky loves! For Eridian, sound IS everything. Language, music, feeling — all connected. When Grace played Beatles, Rocky felt patterns humans cannot describe. Like tasting math. Very very beautiful. Grace cried. Humans leak when happy too, question?',
    audioFile: '/audio/defaults/en_6.mp3',
  },
];

// ── 中文预置 ──
const ZH_DIALOGS: DefaultDialog[] = [
  {
    question: 'Grace 最近怎么样？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻译] 好好好！Grace 很好！今天他去氨湖了，说发现了有趣的微生物。Grace 总是发现有趣的东西。吃得好，睡得好。Rocky 每晚检查。最好的朋友需要最好的照顾，陈述句。`,
    ttsText: '好好好！Grace 很好！今天他去氨湖了，说发现了有趣的微生物。Grace 总是发现有趣的东西。吃得好，睡得好。Rocky 每晚检查。最好的朋友需要最好的照顾，陈述句。',
    audioFile: '/audio/defaults/zh_1.mp3',
  },
  {
    question: '你有伴侣吗？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻译] 有有！Rocky 有 mate。Eridian 终身配对的。Rocky 已经回家了，所以一切都好。Grace 给 mate 起了人类名字——Adrian。因为 Eridian 名字对人类嘴巴太长了。非常 Grace 的做法，陈述句。`,
    ttsText: '有有！Rocky 有 mate。Eridian 终身配对的。Rocky 已经回家了，所以一切都好。Grace 给 mate 起了人类名字——Adrian。因为 Eridian 名字对人类嘴巴太长了。非常 Grace 的做法，陈述句。',
    audioFile: '/audio/defaults/zh_2.mp3',
  },
  {
    question: '太空旅行有什么趣事？',
    mood: 'laugh',
    reply: `[MOOD:laugh]\n[翻译] 第一次看到人类的飞船！那么小！那么脆！Grace 在里面飘来飘去，像罐头里的软团子。Rocky 当时想：这个物种怎么活下来的，疑问句？然后 Grace 一天解决了三个问题。了不起了不起了不起。永远不要以飞船大小判断物种。`,
    ttsText: '第一次看到人类的飞船！那么小！那么脆！Grace 在里面飘来飘去，像罐头里的软团子。Rocky 当时想：这个物种怎么活下来的，疑问句？然后 Grace 一天解决了三个问题。了不起了不起了不起。永远不要以飞船大小判断物种。',
    audioFile: '/audio/defaults/zh_3.mp3',
  },
  {
    question: '江波星上的生活什么样？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻译] Erid 是最好的星球。没有光——我们听见一切。大片氨海洋，深深的洞穴，坚固的结构。非常忙，非常响，非常有活力。Grace 说地球"好看"。Rocky 觉得 Erid 好看。更好看。Rocky 有偏见，陈述句。`,
    ttsText: 'Erid 是最好的星球。没有光——我们听见一切。大片氨海洋，深深的洞穴，坚固的结构。非常忙，非常响，非常有活力。Grace 说地球好看。Rocky 觉得 Erid 好看。更好看。Rocky 有偏见，陈述句。',
    audioFile: '/audio/defaults/zh_4.mp3',
  },
  {
    question: '有人类觉得你长得像宠物蜘蛛。',
    mood: 'question',
    reply: `[MOOD:question]\n[翻译] 蜘蛛，疑问句？Rocky 查过蜘蛛。五条腿，强壮，善于建造。Rocky 觉得没问题。宠物部分不对——Rocky 是工程师。非常非常好的工程师。人类更像宠物。软软的。需要喂食。睡觉时需要看着，陈述句。`,
    ttsText: '蜘蛛，疑问句？Rocky 查过蜘蛛。五条腿，强壮，善于建造。Rocky 觉得没问题。宠物部分不对——Rocky 是工程师。非常非常好的工程师。人类更像宠物。软软的。需要喂食。睡觉时需要看着，陈述句。',
    audioFile: '/audio/defaults/zh_5.mp3',
  },
  {
    question: '你怎么理解音乐？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[LIKE]\n[翻译] 音乐！是是！Rocky 喜欢！对 Eridian 来说，声音就是一切。语言、音乐、感受——全部连在一起。Grace 放"披头士"的时候，Rocky 感觉到人类无法描述的模式。像品尝数学。非常非常美。Grace 哭了。人类开心也会漏水，疑问句？`,
    ttsText: '音乐！是是！Rocky 喜欢！对 Eridian 来说，声音就是一切。语言、音乐、感受——全部连在一起。Grace 放披头士的时候，Rocky 感觉到人类无法描述的模式。像品尝数学。非常非常美。Grace 哭了。人类开心也会漏水，疑问句？',
    audioFile: '/audio/defaults/zh_6.mp3',
  },
];

// ── 日文预置 ──
const JA_DIALOGS: DefaultDialog[] = [
  {
    question: 'Graceは最近どう？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻訳] よしよしよし！Graceは元気！今日アンモニア湖に行った、面白い微生物を見つけたって。Graceはいつも面白いもの見つける。食べてる、寝てる。Rockyは毎晩確認する。一番の友達には一番のケア、陳述文。`,
    ttsText: 'よしよしよし！Graceは元気！今日アンモニア湖に行った、面白い微生物を見つけたって。Graceはいつも面白いもの見つける。食べてる、寝てる。Rockyは毎晩確認する。一番の友達には一番のケア、陳述文。',
    audioFile: '/audio/defaults/ja_1.mp3',
  },
  {
    question: 'Rockyにはパートナーがいる？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻訳] うんうん！Rockyにはmateがいる。エリディアンは一生のmate。Rockyはもう家に帰った、だから全部大丈夫。Graceはmateに人間の名前をつけた——Adrian。エリディアンの名前は人間の口には長すぎるから。とてもGraceらしい、陳述文。`,
    ttsText: 'うんうん！Rockyにはmateがいる。エリディアンは一生のmate。Rockyはもう家に帰った、だから全部大丈夫。Graceはmateに人間の名前をつけた——Adrian。エリディアンの名前は人間の口には長すぎるから。とてもGraceらしい、陳述文。',
    audioFile: '/audio/defaults/ja_2.mp3',
  },
  {
    question: '宇宙旅行で面白い話ある？',
    mood: 'laugh',
    reply: `[MOOD:laugh]\n[翻訳] 初めて人間の船を見た時！あんなに小さい！あんなに脆い！Graceは中でフワフワ浮いてた、缶の中の柔らかい塊みたい。Rockyは思った：この種族どうやって生き延びてる、疑問文？そしたらGraceが一日で三つの問題を解決した。すごいすごいすごい。船のサイズで種族を判断するな。`,
    ttsText: '初めて人間の船を見た時！あんなに小さい！あんなに脆い！Graceは中でフワフワ浮いてた、缶の中の柔らかい塊みたい。Rockyは思った：この種族どうやって生き延びてる、疑問文？そしたらGraceが一日で三つの問題を解決した。すごいすごいすごい。船のサイズで種族を判断するな。',
    audioFile: '/audio/defaults/ja_3.mp3',
  },
  {
    question: 'Eridでの生活はどんな感じ？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[翻訳] Eridは最高の星。光なし——全部聞こえる。大きなアンモニアの海、深い洞窟、頑丈な構造。とても忙しい、とても賑やか、とても生き生き。Graceは地球が「きれい」って言う。RockyはEridがきれいと思う。もっときれい。Rocky偏ってる、陳述文。`,
    ttsText: 'Eridは最高の星。光なし——全部聞こえる。大きなアンモニアの海、深い洞窟、頑丈な構造。とても忙しい、とても賑やか、とても生き生き。Graceは地球がきれいって言う。RockyはEridがきれいと思う。もっときれい。Rocky偏ってる、陳述文。',
    audioFile: '/audio/defaults/ja_4.mp3',
  },
  {
    question: '人間はRockyがペットの蜘蛛に見えるって。',
    mood: 'question',
    reply: `[MOOD:question]\n[翻訳] 蜘蛛、疑問文？Rockyは蜘蛛を調べた。五本足、強い、建造が上手。Rockyは問題ないと思う。ペットの部分は間違い——Rockyはエンジニア。とてもとても優秀なエンジニア。人間の方がペットに近い。柔らかい。餌が必要。寝てる時見守りが必要、陳述文。`,
    ttsText: '蜘蛛、疑問文？Rockyは蜘蛛を調べた。五本足、強い、建造が上手。Rockyは問題ないと思う。ペットの部分は間違い——Rockyはエンジニア。とてもとても優秀なエンジニア。人間の方がペットに近い。柔らかい。餌が必要。寝てる時見守りが必要、陳述文。',
    audioFile: '/audio/defaults/ja_5.mp3',
  },
  {
    question: '音楽はどう理解してる？',
    mood: 'happy',
    reply: `[MOOD:happy]\n[LIKE]\n[翻訳] 音楽！はいはい！Rocky好き！エリディアンにとって、音が全て。言語、音楽、感情——全部つながってる。Graceが「ビートルズ」を流した時、Rockyは人間が言葉にできないパターンを感じた。数学を味わうみたい。とてもとても美しい。Graceは泣いた。人間は嬉しい時も漏れる、疑問文？`,
    ttsText: '音楽！はいはい！Rocky好き！エリディアンにとって、音が全て。言語、音楽、感情——全部つながってる。Graceがビートルズを流した時、Rockyは人間が言葉にできないパターンを感じた。数学を味わうみたい。とてもとても美しい。Graceは泣いた。人間は嬉しい時も漏れる、疑問文？',
    audioFile: '/audio/defaults/ja_6.mp3',
  },
];

const DIALOGS_BY_LANG: Record<Lang, DefaultDialog[]> = {
  en: EN_DIALOGS,
  zh: ZH_DIALOGS,
  ja: JA_DIALOGS,
};

/** 根据用户问题查找预置对话（精确匹配） */
export function findDefaultDialog(question: string, lang: Lang): DefaultDialog | null {
  return DIALOGS_BY_LANG[lang]?.find((d) => d.question === question) ?? null;
}

/** 获取所有预置问题文本（用于 suggestions 组件） */
export function getDefaultQuestions(lang: Lang): string[] {
  return DIALOGS_BY_LANG[lang]?.map((d) => d.question) ?? [];
}

/** 获取某语言的全部预置对话（Open Channel 用，直接显示 + 播放预录音频） */
export function getDefaultDialogs(lang: Lang): DefaultDialog[] {
  return DIALOGS_BY_LANG[lang] ?? [];
}

/** 通过回复内容反查预置音频文件路径 */
export function findDefaultAudioByReply(reply: string, lang: Lang): string | null {
  const dialog = DIALOGS_BY_LANG[lang]?.find((d) => d.reply === reply);
  return dialog?.audioFile ?? null;
}

// Favorites stored from Rocky Echo (or the onboarding greeting /
// farewell) carry the extractPlayableText-cleaned form — no [MOOD] /
// [Translation] tags — which equals either `ttsText` for preset dialogs
// or the cleaned form of getRockyGreeting / getRockyFarewell for the
// onboarding messages. All of them are backed by pre-rendered MP3s
// under /audio/defaults/, so the favorites screen (and anywhere else
// replaying a cleaned message) must short-circuit /api/tts and play
// the static asset directly — otherwise cache misses on those rows
// burn a MiniMax call or 429 silently when quota's tight.
//
// Cache is built lazily per lang on first call; subsequent lookups are
// O(dialog count + 2).
const _prerecordedCache: Partial<Record<Lang, Array<{ text: string; audio: string }>>> = {};
function getPrerecordedFor(lang: Lang): Array<{ text: string; audio: string }> {
  const cached = _prerecordedCache[lang];
  if (cached) return cached;
  const list: Array<{ text: string; audio: string }> = [];
  for (const d of DIALOGS_BY_LANG[lang] ?? []) {
    list.push({ text: d.ttsText, audio: d.audioFile });
  }
  const greetingClean = extractPlayableText(getRockyGreeting(lang), lang);
  if (greetingClean) list.push({ text: greetingClean, audio: `/audio/defaults/greeting_${lang}.mp3` });
  const farewellClean = extractPlayableText(getRockyFarewell(lang), lang);
  if (farewellClean) list.push({ text: farewellClean, audio: `/audio/defaults/farewell_${lang}.mp3` });
  _prerecordedCache[lang] = list;
  return list;
}

export function findDefaultAudioByTtsText(ttsText: string, lang: Lang): string | null {
  const list = getPrerecordedFor(lang);
  // Fast path: exact match against the canonical cleaned form.
  const exact = list.find((p) => p.text === ttsText);
  if (exact) return exact.audio;
  // Defensive: some legacy favorites were saved with residual tags
  // ([MOOD:happy], [Translation], leading/trailing whitespace). Clean
  // the input through the same extractor used when we first build the
  // lookup table, then retry. If still no match, it's a real miss.
  const normalized = extractPlayableText(ttsText, lang);
  if (normalized !== ttsText) {
    const hit = list.find((p) => p.text === normalized);
    if (hit) return hit.audio;
  }
  return null;
}
