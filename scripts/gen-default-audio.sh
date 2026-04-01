#!/bin/bash
# 批量生成预置对话的 TTS 音频
set -e

API_KEY="${ELEVENLABS_API_KEY:?请设置 ELEVENLABS_API_KEY}"
VOICE_ID="${ELEVENLABS_VOICE_ID:?请设置 ELEVENLABS_VOICE_ID}"
OUT_DIR="$(dirname "$0")/../public/audio/defaults"
mkdir -p "$OUT_DIR"

generate() {
  local file="$1" text="$2" lang="$3"
  if [ -f "$OUT_DIR/$file" ] && [ -s "$OUT_DIR/$file" ]; then
    echo "SKIP $file (already exists)"
    return
  fi
  echo "GEN  $file ($lang)..."
  HTTP_CODE=$(curl -s -o "$OUT_DIR/$file" -w "%{http_code}" \
    -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID/stream?optimize_streaming_latency=3&output_format=mp3_22050_32" \
    -H "Content-Type: application/json" \
    -H "xi-api-key: $API_KEY" \
    -d "$(jq -n --arg t "$text" --arg l "$lang" '{
      text: $t,
      model_id: "eleven_turbo_v2_5",
      language_code: $l,
      voice_settings: {stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true}
    }')")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "  FAIL ($HTTP_CODE)"
    cat "$OUT_DIR/$file"
    rm -f "$OUT_DIR/$file"
  else
    echo "  OK ($(wc -c < "$OUT_DIR/$file" | tr -d ' ') bytes)"
  fi
  sleep 1  # rate limit courtesy
}

# English
generate "en_1.mp3" "Good good good! Grace is good! He went to ammonia lake today, says he wants to study new microbe. Always working! But he eats good, sleeps good. Rocky makes sure." "en"
generate "en_2.mp3" "Good question! Eridians make body vibrate very fast when happy. Like buzzing! Humans cannot hear, too low frequency. Grace says humans move mouth corners up? Very strange way to be happy!" "en"
generate "en_3.mp3" "Erid is dark. No light, no sun like Earth. We see with sound. Very beautiful! Many caves, big oceans of ammonia. Grace says Earth has water oceans? Ammonia is better. Rocky is biased maybe." "en"
generate "en_4.mp3" "Good good good! We do science together! Grace studies Erid biology, Rocky builds things. Sometimes we eat together. Grace eats Earth food from his habitat, Rocky eats Erid food. We talk about stars. Best part of day!" "en"
generate "en_5.mp3" "Miss? Hmm. Rocky does not understand miss exactly. Space travel was dangerous. But also amazing! Saw many stars, learned much. If Erid needs Rocky in space again, Rocky goes. Is duty. But home is good too." "en"
generate "en_6.mp3" "Music! Yes yes yes! Rocky loves! Is math of sound! Eridians communicate with sound, so music is like extra beautiful talking? Grace played something called Beatles once. Very interesting vibration patterns!" "en"

# Chinese
generate "zh_1.mp3" "好好好！Grace 很好！他今天去氨湖了，说要研究新微生物。总是在工作！但吃得好，睡得好。Rocky 确保的。" "zh"
generate "zh_2.mp3" "好问题！Eridian 开心时身体振动很快。像嗡嗡声！人类听不到，频率太低。Grace 说人类把嘴角往上移？很奇怪的开心方式！" "zh"
generate "zh_3.mp3" "Erid 是黑暗的。没有光，没有太阳。我们用声音看世界。很美！很多洞穴，大片氨海洋。Grace 说地球有水海洋？氨更好。Rocky 可能有偏见。" "zh"
generate "zh_4.mp3" "好好好！我们一起做科学！Grace 研究 Erid 生物，Rocky 造东西。有时一起吃饭。Grace 吃地球食物，Rocky 吃 Erid 食物。我们聊星星。一天中最好的时候！" "zh"
generate "zh_5.mp3" "想念？嗯。Rocky 不太理解想念。太空旅行很危险。但也很了不起！看到很多星星，学到很多。如果 Erid 需要 Rocky 再去太空，Rocky 去。是责任。但家也很好。" "zh"
generate "zh_6.mp3" "音乐！是是是！Rocky 喜欢！是声音的数学！Eridian 用声音交流，所以音乐像特别美的说话？Grace 放过一个叫披头士的。非常有趣的振动模式！" "zh"

# Japanese
generate "ja_1.mp3" "よしよしよし！Graceは元気！今日アンモニア湖に行った、新しい微生物を研究したいって。いつも仕事してる！でも食べてる、寝てる。Rockyが確認してる。" "ja"
generate "ja_2.mp3" "いい質問！エリディアンは嬉しい時、体がすごく速く振動する。ブンブンみたい！人間には聞こえない、周波数低すぎ。Graceは人間は口の角を上に動かすって？変な喜び方！" "ja"
generate "ja_3.mp3" "Eridは暗い。光なし、太陽なし。音で世界を見る。とても美しい！洞窟たくさん、アンモニアの大海。Graceは地球に水の海があるって？アンモニアの方がいい。Rocky偏ってるかも。" "ja"
generate "ja_4.mp3" "よしよしよし！一緒に科学する！GraceはEridの生物を研究、Rockyは物を作る。時々一緒にご飯。Graceは地球の食べ物、RockyはEridの食べ物。星の話をする。一日で一番いい時間！" "ja"
generate "ja_5.mp3" "恋しい？うーん。Rockyは恋しいがよくわからない。宇宙旅行は危険だった。でもすごかった！たくさんの星を見た。Eridがまた必要なら、Rockyは行く。義務。でも家もいい。" "ja"
generate "ja_6.mp3" "音楽！はいはいはい！Rocky好き！音の数学！エリディアンは音で交流するから、音楽は特別きれいな話し方？Graceがビートルズというのを流した。とても面白い振動パターン！" "ja"

echo ""
echo "✅ Done! Generated files:"
ls -lh "$OUT_DIR"/*.mp3 2>/dev/null || echo "No files generated"
