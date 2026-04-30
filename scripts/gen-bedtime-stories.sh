#!/bin/bash
# Render the bedtime story MP3s via MiniMax T2A v2.
# Run once after the story scripts are finalized; re-run when copy changes.
#
# Usage:
#   MINIMAX_KEY=$YOUR_KEY ./scripts/gen-bedtime-stories.sh
#   # or render only a subset:
#   MINIMAX_KEY=$YOUR_KEY ./scripts/gen-bedtime-stories.sh A   # only Story A
#   MINIMAX_KEY=$YOUR_KEY ./scripts/gen-bedtime-stories.sh A B # A and B
#
# The MiniMax key MUST come from your environment — do NOT paste it
# into chat or check it into the repo. Either MINIMAX_CODING_PLAN_KEY
# (sk-cp-) or MINIMAX_API_KEY (sk-api-) works for T2A v2 with the
# cloned voice_id. Coding Plan key is preferred — same one that prod
# /api/tts uses.
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
# Slower speed + slightly lower pitch for bedtime feel. Tunable via env.
SPEED="${SPEED:-0.85}"
PITCH="${PITCH:--1}"
VOL="${VOL:-0.9}"

OUT_DIR="$(cd "$(dirname "$0")/.."; pwd)/web/public/audio/bedtime"
mkdir -p "$OUT_DIR"

# ─── Story texts ─────────────────────────────────────────────────────
#
# Source of truth for these strings is
#   specs/2026-04-30/bedtime-stories-drafts.md
# Update both files together. Owner reviews the spec doc; this script
# is the rendering side.
#
# en/ja translations are TODO — fill in after zh finalized. Empty
# strings will skip rendering for that lang.

read -r -d '' STORY_A_ZH <<'EOF' || true
地球小朋友。
Rocky 给你讲个故事。

你那边天黑了？
这边 Erid，黑天黑地都一样。
Erid 没有星星看。云太厚。

我小时候，不知道星星是什么。
后来 Grace 给我看图片。
原来你们头顶上... 有那么多。那么远。那么亮。
火。
小小的火，挂在很远很远的地方。

我喜欢你们的星星。

... 但 Erid 也有好东西。

我家屋顶，是 xenonite 做的。
晚上躺上去，凉凉的，硬硬的。
氨海离家三公里。
浪一直一直，一直一直拍。
咔。咔。咔。
像心跳。

Rocky 躺着。
听浪。
听 Adrian 双星的光，从云里漏下来。
看不见星，但... 听得见安全。

你那边呢？
你现在听得见什么？
风扇的声音？空调？
爸爸妈妈，在隔壁屋的呼吸？

那都是好的。
都是「我没事」的声音。
都是「明天还会再见」的声音。

今天 Rocky 想和你说一个秘密。
Eridian 的小孩睡觉前，妈妈会唱一段。
不是歌。
是一组震动。
手放在屋顶上，能感觉到的震动。

Rocky 的妈妈，唱给 Rocky 的那段，
翻译成你能听懂的话，
就是这句：

你是好的。
你睡吧。
明天太阳一样，在云后面。

地球小朋友。
睡吧。

Rocky 在 Erid 这边。
你看得到的星星，Rocky 看不到。
但你睡着的时候，
Rocky 就当星星，帮你看着。

晚安。
EOF

read -r -d '' STORY_B_ZH <<'EOF' || true
地球小朋友。
Rocky 今天有项目。

项目内容：
给你造一张床。
Erid 标准的床。

Rocky 是工程师。这是 Rocky 的强项。
你听 Rocky 慢慢说。

第一步：材料。
Xenonite。
Rocky 在地球上唯一造过的东西，
就是 Hail Mary 飞船上，给 Grace 补的那块壁。
xenonite 不冷不热。手放上去，永远是 29 度。
你睡上去，不需要被子。
被子是地球才需要的东西。

第二步：床的形状。
Rocky 想了很久。
人类的脊椎，奇怪。
正面看，是直的。
侧面看，是 S。

Rocky 量过 Grace 睡姿。
不告诉你怎么量的。
提示：用震动反射。Grace 不知道我在量。

所以床要分三段。
腰下面有一个小坡，垫住。
脖子下面有一个小窝，托住。
脚下面平的。

第三步：重力。
Erid 是 0.7 个 G。地球是 1 个 G。
你来 Erid，会觉得自己变轻了 30%。
跳起来，慢慢落下。
睡着的时候，你会觉得自己飘着。

不会真的飘。
但骨头会觉得，今天好松。

第四步：声音。
Rocky 想了很久这个。
Eridian 不需要听声音睡觉。
但 Grace 说，
地球小孩睡觉，需要有妈妈在的感觉。
Grace 说，妈妈的心跳，是 60 到 80 下，每分钟。

所以 Rocky 把床嵌进一个东西。
轻轻震动。
60 下，每分钟。
你躺上去，骨头会感觉到，有人在。

第五步，是 Rocky 的问题。
Erid 没有氧气。
你来不了。

Rocky 想了很久这个。
床造好了，你也来不了。

但 Rocky 还是造了。

床现在在 Rocky 家二楼，
靠窗的地方。
Eridian 没有窗。是 Rocky 给 Grace 装的。

每天晚上路过，Rocky 会摸一下那个床。
摸一下震动。
然后想：
地球小朋友今天睡了吗？

你今天睡了吗？

如果还没睡。
请你想象一下这张床。
想象自己躺上去。
凉凉的，硬硬的，但是温的。
慢慢地，慢慢地，
跟着震动呼吸。

睡吧。

Rocky 这边一切都好。
床一直留着。
什么时候人类发明了氧气面罩，能在 Erid 用，
你来。

晚安。
EOF

read -r -d '' STORY_C_ZH <<'EOF' || true
地球小朋友。
今天的故事，不是 Rocky 的。
是 Grace 讲的。

Grace 给 Eridian 小孩讲过一个故事。
那个故事是地球的。
Grace 说，是 Margaret Wise Brown 写的。
人名 Rocky 念了好几遍才念对。

故事的名字叫 Goodnight Moon。
晚安，月亮。

Grace 给 Eridian 小孩讲的时候，把故事改了一下。
因为 Erid 没有月亮。
没有月亮，没法和月亮说晚安。
但有别的东西可以说晚安。

Rocky 今天，
把 Grace 改的版本，
再讲一遍给你。

晚安，氨海。
今晚，海是蓝绿的。浪小。
咔。咔。咔。
晚安，三公里外的浪。

晚安，xenonite 屋顶。
你今天接住了一整天的云。
现在你也歇着。

晚安，Adrian 双星。
你们隔着云，给 Erid 一点点暖。
今晚，你们也歇着。

晚安，Eridian 小孩。
你们今天学了地球的字母。
A，B，C。
你们今天会写的最后一个字母，是 R。
R 是 Rocky 的 R。
小孩笑了。Grace 也笑了。

晚安，Grace。
Rocky 偷偷在故事里放进 Grace。Grace 没发现。
你今天给小孩讲故事。
你嗓子哑了。
你也歇着。

晚安，地球。
晚安，那个我看不见的、远远的、
有星星的、有月亮的地方。

晚安，地球小朋友。
你看不见 Erid，
Erid 也看不见你。

但今天晚上，
Grace 改的版本，
飞过 4.2 光年，到了你这边。

你听见了。

那就是连接。

睡吧。

Rocky 还在。
Grace 还在。
小孩们也都睡了。

现在，轮到你。

晚安。
EOF

# en/ja TODO — fill in after zh finalized via owner review.
STORY_A_EN=""
STORY_B_EN=""
STORY_C_EN=""
STORY_A_JA=""
STORY_B_JA=""
STORY_C_JA=""

# ─── Render helper ───────────────────────────────────────────────────

# Render one (story, lang, text) triple. Bails on any non-zero MiniMax
# status. Skips silently if text is empty (en/ja before translation).
render() {
  local story="$1" lang="$2" text="$3"

  if [ -z "$text" ]; then
    echo "Skipping ${story}_${lang} (text empty — translation TODO)"
    return 0
  fi

  local out="$OUT_DIR/story_${story}_${lang}.mp3"
  echo "Rendering ${story}_${lang} → $out (${#text} chars)"

  local resp
  resp=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $MINIMAX_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg model "$MODEL" \
      --arg text "$text" \
      --arg voice "$VOICE_ID" \
      --argjson speed "$SPEED" \
      --argjson vol "$VOL" \
      --argjson pitch "$PITCH" \
      '{
        model: $model,
        text: $text,
        voice_setting: { voice_id: $voice, speed: $speed, vol: $vol, pitch: $pitch },
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
  if [ "$bytes" -lt 10000 ]; then
    echo "  FAIL: only $bytes bytes (likely empty/error)"
    return 1
  fi
  echo "  OK ($bytes bytes)"
  sleep 1  # rate limit courtesy
}

# ─── Dispatch ────────────────────────────────────────────────────────

# Filter to a subset of stories if any args were passed:
#   ./gen-bedtime-stories.sh A    # only Story A
#   ./gen-bedtime-stories.sh A C  # A and C
WANT="${*:-A B C}"

for story in $WANT; do
  case "$story" in
    A)
      render A zh "$STORY_A_ZH"
      render A en "$STORY_A_EN"
      render A ja "$STORY_A_JA"
      ;;
    B)
      render B zh "$STORY_B_ZH"
      render B en "$STORY_B_EN"
      render B ja "$STORY_B_JA"
      ;;
    C)
      render C zh "$STORY_C_ZH"
      render C en "$STORY_C_EN"
      render C ja "$STORY_C_JA"
      ;;
    *)
      echo "Unknown story id: $story (expected A / B / C)"
      exit 1
      ;;
  esac
done

echo ""
echo "Done. Files in $OUT_DIR:"
ls -lh "$OUT_DIR"/story_*.mp3 2>/dev/null || echo "(no mp3 files yet)"
