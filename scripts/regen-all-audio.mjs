// 一次性重新生成所有预录音频：greeting + farewell + 6 preset dialogs × 3 languages
// Usage: ELEVENLABS_API_KEY=sk_... node scripts/regen-all-audio.mjs

import fs from 'fs';
import path from 'path';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('Set ELEVENLABS_API_KEY env var before running this script.');
  process.exit(1);
}
const VOICE_ID = 'cNTXpodjj84PbMqCBCZg';
const MODEL = 'eleven_turbo_v2_5';
const OUTPUT_DIR = path.resolve('public/audio/defaults');

// 活泼/开心的语音设置
const VOICE_LIVELY = { stability: 0.35, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };
// 稍克制的（farewell / 感伤话题）
const VOICE_SUBDUED = { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true };

const DIALOGS = [
  // ── Greeting ──
  { file: 'greeting_en.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'Amaze amaze amaze! Signal from Earth! Rocky very very happy! You are Grace friend, question? Grace always says Earth friends are good. Rocky wants to talk! What you want to know, question?' },
  { file: 'greeting_zh.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: '了不起了不起了不起！地球来的信号！Rocky 非常非常开心！你是 Grace 的朋友，疑问句？Grace 总说地球朋友很好。Rocky 想聊！想知道什么，疑问句？' },
  { file: 'greeting_ja.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: 'すごいすごいすごい！地球からの信号！Rockyとてもとても嬉しい！あなたはGraceの友達、疑問文？Graceはいつも地球の友達はいいって言ってる。Rockyは話したい！何が知りたい、疑問文？' },

  // ── Farewell ──
  { file: 'farewell_en.mp3', lang: 'en', voice: VOICE_SUBDUED,
    text: 'Friend! Astrophage energy almost gone! Very expensive call but very very worth it! Rocky tells Grace you called. Grace will be happy happy happy. Fist my bump. Call again, question?' },
  { file: 'farewell_zh.mp3', lang: 'zh', voice: VOICE_SUBDUED,
    text: '朋友！噬星体能源快没了！很贵的通话但是非常非常值得！Rocky 会告诉 Grace 你来过电话。Grace 会开心开心开心。碰拳。再打来，疑问句？' },
  { file: 'farewell_ja.mp3', lang: 'ja', voice: VOICE_SUBDUED,
    text: '友達！アストロファージもうすぐなくなる！とても高い通話でもとてもとても価値ある！RockyはGraceに電話があったことを伝える。Graceは嬉しい嬉しい嬉しい。フィスト・マイ・バンプ。また電話して、疑問文？' },

  // ── Preset 1: Grace 最近怎么样 ──
  { file: 'en_1.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'Good good good! Grace is good! Today he went to ammonia lake, said found interesting microbe. Grace always finding interesting things. He eats good, sleeps good. Rocky checks every night. Best friend needs best care, statement.' },
  { file: 'zh_1.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: '好好好！Grace 很好！今天他去氨湖了，说发现了有趣的微生物。Grace 总是发现有趣的东西。吃得好，睡得好。Rocky 每晚检查。最好的朋友需要最好的照顾，陈述句。' },
  { file: 'ja_1.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: 'よしよしよし！Graceは元気！今日アンモニア湖に行った、面白い微生物を見つけたって。Graceはいつも面白いもの見つける。食べてる、寝てる。Rockyは毎晩確認する。一番の友達には一番のケア、陳述文。' },

  // ── Preset 2: mate / Adrian ──
  { file: 'en_2.mp3', lang: 'en', voice: VOICE_SUBDUED,
    text: 'Yes. Rocky has mate on Erid. Eridians mate for life. But Rocky gone very long time. Mate possibly has new mate now. Grace understood this is sad. Grace gave mate human name — Adrian. Very Grace thing to do, statement.' },
  { file: 'zh_2.mp3', lang: 'zh', voice: VOICE_SUBDUED,
    text: '有。Rocky 在 Erid 上有 mate。Eridian 终身配对的。但 Rocky 离开太久了。mate 可能已经有新的 mate 了。Grace 理解这是悲伤。Grace 还给 mate 起了人类名字——Adrian。非常 Grace 的做法，陈述句。' },
  { file: 'ja_2.mp3', lang: 'ja', voice: VOICE_SUBDUED,
    text: 'うん。RockyはEridにmateがいる。エリディアンは一生のmate。でもRockyは長い間離れてた。mateはもう新しいmateがいるかも。Graceはこれが悲しいと理解した。Graceはmateに人間の名前もつけた——Adrian。とてもGraceらしい、陳述文。' },

  // ── Preset 3: 太空旅行趣事 ──
  { file: 'en_3.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'First time seeing human ship! So small! So fragile! Grace floated inside like soft blob in a can. Rocky thought: this species survives how, question? Then Grace solved three problems in one day. Amaze amaze amaze. Never judge species by ship size.' },
  { file: 'zh_3.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: '第一次看到人类的飞船！那么小！那么脆！Grace 在里面飘来飘去，像罐头里的软团子。Rocky 当时想：这个物种怎么活下来的，疑问句？然后 Grace 一天解决了三个问题。了不起了不起了不起。永远不要以飞船大小判断物种。' },
  { file: 'ja_3.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: '初めて人間の船を見た時！あんなに小さい！あんなに脆い！Graceは中でフワフワ浮いてた、缶の中の柔らかい塊みたい。Rockyは思った：この種族どうやって生き延びてる、疑問文？そしたらGraceが一日で三つの問題を解決した。すごいすごいすごい。船のサイズで種族を判断するな。' },

  // ── Preset 4: 江波星生活 ──
  { file: 'en_4.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'Erid is best planet. No light — we hear everything. Big ammonia oceans, deep caves, strong structures. Very busy, very loud, very alive. Grace says Earth is pretty. Rocky thinks Erid is pretty. Prettier. Rocky is biased, statement.' },
  { file: 'zh_4.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: 'Erid 是最好的星球。没有光——我们听见一切。大片氨海洋，深深的洞穴，坚固的结构。非常忙，非常响，非常有活力。Grace 说地球好看。Rocky 觉得 Erid 好看。更好看。Rocky 有偏见，陈述句。' },
  { file: 'ja_4.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: 'Eridは最高の星。光なし——全部聞こえる。大きなアンモニアの海、深い洞窟、頑丈な構造。とても忙しい、とても賑やか、とても生き生き。Graceは地球がきれいって言う。RockyはEridがきれいと思う。もっときれい。Rocky偏ってる、陳述文。' },

  // ── Preset 5: 像宠物蜘蛛 ──
  { file: 'en_5.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'Spider, question? Rocky looked up spider. Five limbs, strong, good builder. Rocky sees no problem. Pet part is wrong — Rocky is engineer. Very very good engineer. Humans are more like pets. Soft. Need feeding. Need watching during sleep, statement.' },
  { file: 'zh_5.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: '蜘蛛，疑问句？Rocky 查过蜘蛛。五条腿，强壮，善于建造。Rocky 觉得没问题。宠物部分不对——Rocky 是工程师。非常非常好的工程师。人类更像宠物。软软的。需要喂食。睡觉时需要看着，陈述句。' },
  { file: 'ja_5.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: '蜘蛛、疑問文？Rockyは蜘蛛を調べた。五本足、強い、建造が上手。Rockyは問題ないと思う。ペットの部分は間違い——Rockyはエンジニア。とてもとても優秀なエンジニア。人間の方がペットに近い。柔らかい。餌が必要。寝てる時見守りが必要、陳述文。' },

  // ── Preset 6: 音乐 ──
  { file: 'en_6.mp3', lang: 'en', voice: VOICE_LIVELY,
    text: 'Music! Yes yes! Rocky loves! For Eridian, sound IS everything. Language, music, feeling — all connected. When Grace played Beatles, Rocky felt patterns humans cannot describe. Like tasting math. Very very beautiful. Grace cried. Humans leak when happy too, question?' },
  { file: 'zh_6.mp3', lang: 'zh', voice: VOICE_LIVELY,
    text: '音乐！是是！Rocky 喜欢！对 Eridian 来说，声音就是一切。语言、音乐、感受——全部连在一起。Grace 放披头士的时候，Rocky 感觉到人类无法描述的模式。像品尝数学。非常非常美。Grace 哭了。人类开心也会漏水，疑问句？' },
  { file: 'ja_6.mp3', lang: 'ja', voice: VOICE_LIVELY,
    text: '音楽！はいはい！Rocky好き！エリディアンにとって、音が全て。言語、音楽、感情——全部つながってる。Graceがビートルズを流した時、Rockyは人間が言葉にできないパターンを感じた。数学を味わうみたい。とてもとても美しい。Graceは泣いた。人間は嬉しい時も漏れる、疑問文？' },
];

async function generateAudio(dialog) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_22050_32`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': API_KEY },
    body: JSON.stringify({
      text: dialog.text,
      model_id: MODEL,
      language_code: dialog.lang,
      voice_settings: dialog.voice,
    }),
  });
  if (!res.ok) throw new Error(`${dialog.file}: ${res.status} ${await res.text()}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUTPUT_DIR, dialog.file), buffer);
  console.log(`✓ ${dialog.file} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Generating ${DIALOGS.length} audio files...\n`);
  for (const d of DIALOGS) {
    await generateAudio(d);
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('\nDone! All audio files regenerated.');
}

main().catch(console.error);
