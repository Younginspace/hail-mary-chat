// 生成 greeting + farewell 预录音频
// Usage: node scripts/regen-greeting-farewell.mjs

import fs from 'fs';
import path from 'path';

const API_KEY = 'sk_03d7bd171399858bd19fb9fca16984d6e5386ba19e5f2801';
const VOICE_ID = 'cNTXpodjj84PbMqCBCZg';
const MODEL = 'eleven_turbo_v2_5';
const OUTPUT_DIR = path.resolve('public/audio/defaults');

const DIALOGS = [
  // Greeting
  { file: 'greeting_en.mp3', lang: 'en', text: 'Good good good! Signal received! Rocky here. You are calling from Earth? Grace talks about Earth friends sometimes. What you want to talk about, question?' },
  { file: 'greeting_zh.mp3', lang: 'zh', text: '好好好！收到信号了！Rocky 在。你从地球呼叫的？Grace 说起过地球的朋友。想聊什么，疑问句？' },
  { file: 'greeting_ja.mp3', lang: 'ja', text: 'よしよしよし！信号受信した！Rockyここにいる。地球から呼んでる？Graceは地球の友達の話する時ある。何について話したい、疑問文？' },
  // Farewell
  { file: 'farewell_en.mp3', lang: 'en', text: 'Friend! Astrophage energy almost gone. Very expensive call! Rocky tells Grace you called. Fist my bump. Goodbye, Earth friend.' },
  { file: 'farewell_zh.mp3', lang: 'zh', text: '朋友！噬星体能源快用完了。很贵的通话！Rocky 会告诉 Grace 你来过电话。碰拳。再见，地球朋友。' },
  { file: 'farewell_ja.mp3', lang: 'ja', text: '友達！アストロファージのエネルギーがもうすぐなくなる。とても高い通話！RockyはGraceに電話があったことを伝える。フィスト・マイ・バンプ。さようなら、地球の友達。' },
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
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
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
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('\nDone!');
}

main().catch(console.error);
