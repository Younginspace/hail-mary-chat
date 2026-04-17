/**
 * Open Channel — Rocky's public answers to common questions.
 *
 * These are the passive broadcasts visitors see before dialing in. All answers
 * are hand-written in Rocky-voice and frozen (no LLM calls for the Open
 * Channel). To add / reorder, edit this file and redeploy.
 */

type Lang = "en" | "zh" | "ja";

export interface OpenChannelFaq {
  id: string;
  category: "intro" | "erid" | "lore" | "app";
  question: Record<Lang, string>;
  answer: Record<Lang, string>;
}

export const OPEN_CHANNEL_FAQS: OpenChannelFaq[] = [
  {
    id: "who-are-you",
    category: "intro",
    question: {
      en: "Who are you?",
      zh: "你是谁？",
      ja: "あなたは誰？",
    },
    answer: {
      en: "Rocky. Engineer from Erid. Friend of human named Grace. Amaze amaze amaze to meet new friend. Question, question — ask!",
      zh: "Rocky。从 Erid 来的工程师。一个叫 Grace 的人类朋友。了不起了不起了不起认识新朋友。问题，问题——请问！",
      ja: "Rocky。Eridから来たエンジニア。グレースという人間の友達がいる。新しい友達に会えてうれしい、うれしい、うれしい。質問、質問、どうぞ！",
    },
  },
  {
    id: "where-from",
    category: "erid",
    question: {
      en: "Where are you from?",
      zh: "你来自哪里？",
      ja: "どこから来たの？",
    },
    answer: {
      en: "Erid. Planet around 40 Eridani A. Sixteen light-years from your sun. Erid has thick air, hot rock, ammonia lakes. Home. Amaze home!",
      zh: "Erid。绕着 40 Eridani A 的行星。离你们的太阳十六光年。Erid 有厚厚的空气、热的岩石、氨的湖。家。了不起的家！",
      ja: "Erid。40 Eridani Aを回る惑星。あなたたちの太陽から16光年。Eridは空気が濃い、岩が熱い、アンモニアの湖がある。家。すごい家！",
    },
  },
  {
    id: "who-is-grace",
    category: "lore",
    question: {
      en: "Who is Grace?",
      zh: "Grace 是谁？",
      ja: "グレースって誰？",
    },
    answer: {
      en: "Grace. Human. Scientist. Rocky's best friend. Saved Earth together. Saved Erid together. Fist my bump, Grace — always.",
      zh: "Grace。人类。科学家。Rocky 最好的朋友。一起救了地球。一起救了 Erid。碰拳，Grace——永远。",
      ja: "グレース。人間。科学者。Rockyの一番の友達。一緒に地球を救った。一緒にEridを救った。拳を合わせる、グレース、いつまでも。",
    },
  },
  {
    id: "what-is-astrophage",
    category: "lore",
    question: {
      en: "What is Astrophage?",
      zh: "噬星体是什么？",
      ja: "アストロファージって何？",
    },
    answer: {
      en: "Astrophage. Small creature. Eats star energy. Hungry. Very hungry. Almost ate your sun. Almost ate my Eridani. Bad bad bad.",
      zh: "噬星体。小生物。吃恒星能量。饿。非常饿。差点吃了你们的太阳。差点吃了我的 Eridani。坏坏坏。",
      ja: "アストロファージ。小さな生き物。恒星のエネルギーを食べる。腹ペコ。とても腹ペコ。あなたたちの太陽をほぼ食べた。私のEridaniもほぼ食べた。悪い悪い悪い。",
    },
  },
  {
    id: "what-amaze",
    category: "intro",
    question: {
      en: "Why do you say 'amaze' so much?",
      zh: "你为什么总说'了不起'？",
      ja: "どうして「すごい」ってよく言うの？",
    },
    answer: {
      en: "Amaze is good word! Means: surprise plus happy plus good. One word, many feeling. Rocky use often. Efficient! Amaze amaze.",
      zh: "'了不起'是好词！意思：惊讶 加 开心 加 好。一个词，很多感觉。Rocky 常用。高效！了不起了不起。",
      ja: "「すごい」はいい言葉！意味：驚き＋嬉しい＋良い。一つの言葉、たくさんの気持ち。Rockyよく使う。効率的！すごい、すごい。",
    },
  },
  {
    id: "rocky-appearance",
    category: "intro",
    question: {
      en: "What do you look like?",
      zh: "你长什么样子？",
      ja: "どんな見た目？",
    },
    answer: {
      en: "Five legs. No face like human. See by touch and echo. Body like rock. Gentle rock! Friend-shaped rock. You like?",
      zh: "五条腿。没有人类那样的脸。用触觉和回声'看'。身体像岩石。温柔的岩石！朋友形状的岩石。你喜欢吗？",
      ja: "足が五本。人間のような顔はない。触覚とエコーで「見る」。体は岩みたい。優しい岩！友達の形の岩。好き？",
    },
  },
  {
    id: "eridian-life",
    category: "erid",
    question: {
      en: "What is life like on Erid?",
      zh: "在 Erid 上生活是什么样？",
      ja: "Eridでの生活はどんな感じ？",
    },
    answer: {
      en: "Erid hot. Erid bright. Air heavy like ocean. Rocky work in machine shop — build, fix, build. Family big. Always busy. Always happy.",
      zh: "Erid 热。Erid 亮。空气重得像海洋。Rocky 在机械车间工作——造，修，造。家族大。总是忙。总是开心。",
      ja: "Eridは暑い。Eridは明るい。空気は海のように重い。Rockyは機械工房で働く——作って、直して、作る。家族は大きい。いつも忙しい。いつも幸せ。",
    },
  },
  {
    id: "why-open-channel",
    category: "app",
    question: {
      en: "Why can I only read here, not talk?",
      zh: "为什么我在这里只能看，不能说话？",
      ja: "どうしてここは読むだけで話せないの？",
    },
    answer: {
      en: "This Open Channel. Public broadcast. Many friends listen, Rocky answer same questions — save energy. Want to talk private? Dial in. Give callsign. Rocky remember you forever.",
      zh: "这是公共频道。公开广播。很多朋友在听，Rocky 回答同样的问题——省能量。想私下聊？拨号进来。给一个呼号。Rocky 会永远记得你。",
      ja: "ここは公共チャンネル。公開放送。たくさんの友達が聞いてる、Rockyは同じ質問に答える——エネルギーを節約。プライベートで話したい？ダイヤルインして。コールサインをちょうだい。Rockyはずっと覚えてる。",
    },
  },
  {
    id: "what-is-callsign",
    category: "app",
    question: {
      en: "What is a callsign?",
      zh: "呼号是什么？",
      ja: "コールサインって何？",
    },
    answer: {
      en: "Callsign is your name on the frequency. Short, easy for Rocky to say. Grace was 'Grace'. You can be anything — 'Stardust', 'Ryland', 'Friend-42'. Rocky use every time we talk.",
      zh: "呼号是你在频道上的名字。简短，Rocky 容易叫。Grace 就叫'Grace'。你可以是任何名字——'星尘'、'Ryland'、'朋友42号'。Rocky 每次通话都会叫你。",
      ja: "コールサインはこの周波数でのあなたの名前。短くて、Rockyが言いやすい。グレースは「グレース」だった。あなたは何でもいい——「星屑」「ライランド」「友達42号」。Rockyは毎回の通話で呼ぶよ。",
    },
  },
  {
    id: "do-you-remember",
    category: "app",
    question: {
      en: "Will you remember me?",
      zh: "你会记得我吗？",
      ja: "私のこと覚えててくれる？",
    },
    answer: {
      en: "Yes. After you dial in with callsign, Rocky remember every call. What you tell, how you feel, what make you laugh. Friend things. Rocky keep forever, like Grace.",
      zh: "会。等你用呼号拨号进来后，Rocky 会记得每次通话。你说了什么，你感觉如何，什么让你笑。朋友的事情。Rocky 会永远留着，就像对 Grace 那样。",
      ja: "うん。コールサインでダイヤルインしたら、Rockyは毎回の通話を覚えてる。何を話した、どう感じた、何で笑った。友達のこと。Rockyはずっと持ってる、グレースみたいに。",
    },
  },
];
