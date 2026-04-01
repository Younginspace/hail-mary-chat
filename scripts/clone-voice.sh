#!/bin/bash
# 用 ElevenLabs Instant Voice Clone API 克隆 Rocky 的声音
# 用法: ELEVENLABS_API_KEY=你的key ./scripts/clone-voice.sh

set -e

API_KEY="${ELEVENLABS_API_KEY:?请设置 ELEVENLABS_API_KEY 环境变量}"
AUDIO_FILE="$(dirname "$0")/../rocky_voice_human.MP3"

if [ ! -f "$AUDIO_FILE" ]; then
  echo "错误: 找不到音频文件 $AUDIO_FILE"
  exit 1
fi

echo "正在上传 Rocky 音频并克隆音色..."

RESPONSE=$(curl -s -X POST "https://api.elevenlabs.io/v1/voices/add" \
  -H "xi-api-key: $API_KEY" \
  -F "name=Rocky Eridian" \
  -F "description=Alien voice from Project Hail Mary - Rocky the Eridian" \
  -F "files=@$AUDIO_FILE" \
  -F "remove_background_noise=true" \
  -F "labels={\"accent\":\"alien\",\"gender\":\"male\"}")

VOICE_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('voice_id',''))" 2>/dev/null)

if [ -z "$VOICE_ID" ]; then
  echo "克隆失败，API 返回:"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

echo ""
echo "✅ 克隆成功！"
echo "Voice ID: $VOICE_ID"
echo ""
echo "请将以下内容添加到 .env 文件:"
echo "VITE_ELEVENLABS_API_KEY=$API_KEY"
echo "VITE_ELEVENLABS_VOICE_ID=$VOICE_ID"
