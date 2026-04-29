#!/bin/bash
# Render the returning-user greeting MP3s via MiniMax T2A v2.
# One-shot: run this whenever the returning-greeting copy changes.
#
# Usage:
#   MINIMAX_KEY=$YOUR_KEY ./scripts/gen-returning-greeting.sh
#
# The MiniMax key MUST come from your environment — do NOT paste it
# into chat or check it into the repo. Any key that works against
# /v1/t2a_v2 with the cloned voice_id will do; in this project that's
# either MINIMAX_CODING_PLAN_KEY (sk-cp-) or MINIMAX_API_KEY (sk-api-).
# The Coding Plan key is preferred — same one the prod /api/tts uses.
#
# Deps: curl, jq, xxd (mac defaults all good).

set -e

if [ -z "${MINIMAX_KEY:-}" ]; then
  echo "MINIMAX_KEY not set. Run with:"
  echo "  MINIMAX_KEY=\$YOUR_KEY $0"
  exit 1
fi

VOICE_ID="${VOICE_ID:-rocky_hailmary_v2}"
MODEL="${MODEL:-speech-2.8-hd}"
API_URL="${API_URL:-https://api.minimaxi.com/v1/t2a_v2}"
OUT_DIR="$(cd "$(dirname "$0")/.."; pwd)/web/public/audio/defaults"
mkdir -p "$OUT_DIR"

# Render one (lang, text) pair. Bails on any non-zero MiniMax status.
render() {
  local lang="$1" text="$2"
  local out="$OUT_DIR/greeting_returning_${lang}.mp3"
  echo "Rendering $lang → $out"

  # MiniMax returns hex-encoded MP3 in data.audio. jq pulls it out;
  # xxd decodes back to bytes. Pipe to disk; check status_code first.
  local resp
  resp=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $MINIMAX_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg model "$MODEL" --arg text "$text" --arg voice "$VOICE_ID" '{
      model: $model,
      text: $text,
      voice_setting: { voice_id: $voice, speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 44100, bitrate: 128000, channel: 1 }
    }')")

  local status
  status=$(echo "$resp" | jq -r '.base_resp.status_code // -1')
  if [ "$status" != "0" ]; then
    echo "  FAIL: $(echo "$resp" | jq -c '.base_resp')"
    return 1
  fi

  echo "$resp" | jq -r '.data.audio' | xxd -r -p > "$out"
  local bytes
  bytes=$(wc -c < "$out" | tr -d ' ')
  if [ "$bytes" -lt 1000 ]; then
    echo "  FAIL: only $bytes bytes (likely empty/error)"
    return 1
  fi
  echo "  OK ($bytes bytes)"
  sleep 1  # rate limit courtesy
}

# Returning greeting — keep these in sync with
# web/src/prompts/rocky.ts → getRockyGreetingReturning(lang).
# Audio strings are the cleaned text (no [MOOD] / [Translation] tags).
render "en" "Rocky waiting for your signal. What we talk today?"
render "zh" "Rocky 等你信号呢。今天聊点啥？"
render "ja" "Rockyずっと信号待ってた。今日何話す？"

echo ""
echo "Done. Files in $OUT_DIR:"
ls -lh "$OUT_DIR"/greeting_returning_*.mp3
