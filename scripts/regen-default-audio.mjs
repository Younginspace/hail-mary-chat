// 批量重新生成预置对话的 TTS 音频
// Usage: ELEVENLABS_API_KEY=sk_... node scripts/regen-default-audio.mjs

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

const DIALOGS = [
  // EN
  { file: 'en_1.mp3', lang: 'en', text: 'Good good good. Grace is good. He went to ammonia lake today, says he wants to study new microbe. Always working. But eats good, sleeps good. Rocky makes sure, statement.' },
  { file: 'en_2.mp3', lang: 'en', text: 'Eridians make body vibrate very fast when happy. Like buzzing. Humans cannot hear, too low frequency. Grace says humans move mouth corners up, question? Very strange way to be happy.' },
  { file: 'en_3.mp3', lang: 'en', text: 'Erid is dark. No light, no sun like Earth. We perceive with sound. Very beautiful. Many caves, big oceans of ammonia. Grace says Earth has water oceans, question? Ammonia is better. Rocky is biased maybe, statement.' },
  { file: 'en_4.mp3', lang: 'en', text: 'Good good. We do science together. Grace studies Erid biology, Rocky builds things. Sometimes eat together. Grace eats Earth food from habitat, Rocky eats Erid food. We talk about stars. Best part of day.' },
  { file: 'en_5.mp3', lang: 'en', text: 'Miss, question? Rocky does not understand miss exactly. Space travel was dangerous. But also amazing. Saw many stars, learned much. If Erid needs Rocky in space again, Rocky goes. Is duty. But home is good too.' },
  { file: 'en_6.mp3', lang: 'en', text: 'Music. Yes yes. Rocky likes. Is math of sound. Eridians communicate with sound, so music is like extra beautiful talking. Grace played something called Beatles once. Very interesting vibration patterns, statement.' },
  // ZH
  { file: 'zh_1.mp3', lang: 'zh', text: '好好好。Grace 很好。他今天去氨湖了，说要研究新微生物。总是在工作。但吃得好，睡得好。Rocky 确保的，陈述句。' },
  { file: 'zh_2.mp3', lang: 'zh', text: 'Eridian 开心时身体振动很快。像嗡嗡声。人类听不到，频率太低。Grace 说人类把嘴角往上移，疑问句？很奇怪的开心方式。' },
  { file: 'zh_3.mp3', lang: 'zh', text: 'Erid 是黑暗的。没有光，没有太阳。我们用声音感知世界。很美。很多洞穴，大片氨海洋。Grace 说地球有水海洋，疑问句？氨更好。Rocky 可能有偏见，陈述句。' },
  { file: 'zh_4.mp3', lang: 'zh', text: '好好。我们一起做科学。Grace 研究 Erid 生物，Rocky 造东西。有时一起吃饭。Grace 吃地球食物，Rocky 吃 Erid 食物。我们聊星星。一天中最好的时候。' },
  { file: 'zh_5.mp3', lang: 'zh', text: '想念，疑问句？Rocky 不太理解想念。太空旅行很危险。但也很了不起。看到很多星星，学到很多。如果 Erid 需要 Rocky 再去太空，Rocky 去。是责任。但家也很好。' },
  { file: 'zh_6.mp3', lang: 'zh', text: '音乐。是是。Rocky 喜欢。是声音的数学。Eridian 用声音交流，所以音乐像特别美的说话。Grace 放过一个叫披头士的。非常有趣的振动模式，陈述句。' },
  // JA
  { file: 'ja_1.mp3', lang: 'ja', text: 'よしよしよし。Graceは元気。今日アンモニア湖に行った、新しい微生物を研究したいって。いつも仕事してる。でも食べてる、寝てる。Rockyが確認してる、陳述文。' },
  { file: 'ja_2.mp3', lang: 'ja', text: 'エリディアンは嬉しい時、体がすごく速く振動する。ブンブンみたい。人間には聞こえない、周波数低すぎ。Graceは人間は口の角を上に動かすって、疑問文？変な喜び方。' },
  { file: 'ja_3.mp3', lang: 'ja', text: 'Eridは暗い。光なし、太陽なし。音で世界を感じる。とても美しい。洞窟たくさん、アンモニアの大海。Graceは地球に水の海があるって、疑問文？アンモニアの方がいい。Rocky偏ってるかも、陳述文。' },
  { file: 'ja_4.mp3', lang: 'ja', text: 'よしよし。一緒に科学する。GraceはEridの生物を研究、Rockyは物を作る。時々一緒にご飯。Graceは地球の食べ物、RockyはEridの食べ物。星の話をする。一日で一番いい時間。' },
  { file: 'ja_5.mp3', lang: 'ja', text: '恋しい、疑問文？Rockyは恋しいがよくわからない。宇宙旅行は危険だった。でもすごかった。たくさんの星を見た。Eridがまた必要なら、Rockyは行く。義務。でも家もいい。' },
  { file: 'ja_6.mp3', lang: 'ja', text: '音楽。はいはい。Rocky好き。音の数学。エリディアンは音で交流するから、音楽は特別きれいな話し方。Graceがビートルズというのを流した。とても面白い振動パターン、陳述文。' },
];

async function generateAudio(dialog) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_22050_32`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': API_KEY,
    },
    body: JSON.stringify({
      text: dialog.text,
      model_id: MODEL,
      language_code: dialog.lang,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${dialog.file}: ${res.status} ${err}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const outPath = path.join(OUTPUT_DIR, dialog.file);
  fs.writeFileSync(outPath, buffer);
  console.log(`✓ ${dialog.file} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Generating ${DIALOGS.length} audio files...\n`);

  for (const dialog of DIALOGS) {
    await generateAudio(dialog);
    // Rate limit: ~100ms between calls
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\nDone! All audio files regenerated.');
}

main().catch(console.error);
