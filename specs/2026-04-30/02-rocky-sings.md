# Spec 02 — Rocky 唱歌

**Status**: Planned, **needs spike before commitment**
**Priority**: P3
**Effort**: 0.5d spike + 2-3d if green-lit
**Window**: After other features ship; spike anytime
**Dependencies**: `MINIMAX_API_KEY` (sk-api- paygo), 因为 music-2.6 不在
Coding Plan 范围

---

## 用户需求背景

来自 owner（基于真实用户反馈）：

> "听 rocky 唱歌，调用音频的能力。"

后续讨论澄清：

> "Rocky 唱歌这个难度我不认可，minimax coding plan 本身提供 minimax 的音频、
> 音乐生成能力，应该是可行的（虽然我不确定能否复用 voice id）"

**调研结论**（详见 INDEX.md）：

- ❌ MiniMax `music-2.6` API **不接受 voice_id 参数**——歌手音色由 prompt
  描述决定，没法用 Rocky 克隆音色"真唱"
- ❌ 音乐生成**不在 Coding Plan 范围**——必须用 paygo `sk-api-` key
- ❌ MiniMax T2A v2 也不会唱歌——只会把歌词当散文念
- ✅ 唯一可落地路径：music-2.6 生成纯器乐 + Rocky T2A "念"歌词叠加
- ✅ 替代路径：Rocky 教 Eridian 旋律（用 #04 的 whistle 合成）

**为什么这是 P3**：

- 上面的限制让"真唱"不可能；"念歌词"可能听感差
- 创意风险大（可能要返工 2-3 次才能调出可接受的 vibe）
- 不是核心使用场景（一次新鲜，难有日活）

## Goals

1. **先做 30 分钟 spike** 验证"念歌词 over instrumental" 听感是否可接受
2. 如果可接受 → 做 2-3 首"歌"作为 charm feature，玩玩就行
3. 如果不可接受 → **降级到"Rocky 教 Eridian 旋律"** 这个替代路径
4. 整个 feature 是"可有可无"的——不影响核心陪伴体验

## Non-goals

- ❌ 高保真歌手体验（Rocky 不会"真唱"，承认局限）
- ❌ 用户自定义歌词（v1 是预录 charm clip，不是工具）
- ❌ 让 Rocky 唱中文/日文流行歌（versioning 复杂度爆炸，仅做英语版）
- ❌ 实时生成（每首预渲染，避免每次 paygo 烧钱）

## User stories

- **As a 想看 Rocky 萌点的用户**：点"让 Rocky 给我唱首歌"按钮 → Rocky 跑调
  地"念"一首改编版 Twinkle Twinkle → "Earth kid... I... try... it is hard
  for Eridian voice... but for you..."（卖点是萌不是质量）
- **As a 替代路径用户**：点 "Eridian 一起来" → Rocky 用合成哨音教一段旋律
  → 用户跟着哼

## Functional requirements

**v1.0 (only after spike confirms vibe)**:

- **FR-1** 入口按钮（位置 TBD，可能在"陪伴菜单"hub 里）
- **FR-2** 2-3 首预渲染的 "Rocky song" mp3
- **FR-3** 简单播放器（不需要 #01 那么复杂——这是 charm clip 不是哄睡）
- **FR-4** 每首歌前面 Rocky 的"intro"（"This is hard. Rocky try."），
  增加角色感

**替代路径（如果 spike fail）**：
- **FR-A1** 入口换成 "听 Rocky 哼一段"
- **FR-A2** 用 #04 的 Eridian 合成代码生成 30-60 秒旋律
- **FR-A3** 同时显示"哼歌词"（Rocky 用文字描述这段哨音的"心情"）

## Non-functional requirements

- **每首歌成本**：music-2.6 ¥0.15/首 × 2-3 首 = **¥0.30-0.45 一次性**
- **包体增长**：< 5MB（2-3 首歌 + Rocky intro 短音）
- **听感主观要求**：spike 阶段 owner + 至少 2 个 alpha 用户认为"萌可爱"
  而不是"TTS bug"

## 技术方案

### Spike 方案（必须先做）

```bash
# 30 分钟实验：用 paygo key 调 music-2.6 + T2A 叠加
# 1. music-2.6 生成纯器乐 backing track
curl -X POST https://api.minimaxi.com/v1/music_generation \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -d '{
    "model": "music-2.6",
    "lyrics": "[Verse] Twinkle twinkle little star\nHow I wonder what you are\n[Chorus] ...",
    "is_instrumental": true,
    "audio_setting": { "format": "mp3", "sample_rate": 44100 }
  }'

# 2. MiniMax T2A v2 用 Rocky voice 念歌词（slow speed + 强音节断点）
curl -X POST https://api.minimaxi.com/v1/t2a_v2 \
  -H "Authorization: Bearer $MINIMAX_CODING_PLAN_KEY" \
  -d '{
    "model": "speech-2.8-hd",
    "text": "Twinkle... twinkle... little star...",
    "voice_setting": { "voice_id": "rocky_hailmary_v2", "speed": 0.7, "pitch": -1 }
  }'

# 3. ffmpeg 叠加：器乐 -32dB + Rocky vocal 0dB → mix
ffmpeg -i instrumental.mp3 -i rocky_vocals.mp3 \
  -filter_complex "[0:a]volume=0.4[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2" \
  -c:a libmp3lame song.mp3
```

**Spike 验收标准**：
- [ ] Owner 听了第一反应不是"这是 bug 吗"
- [ ] 2 个 alpha 用户中至少 1 人觉得"有可爱感"
- [ ] 节拍能对上（Rocky 念词的速度跟器乐 BPM 不能差太远）

### 如果 spike 通过：v1.0 实施

歌单：
1. 《Twinkle Twinkle Little Star》改编版（最经典 lullaby）
2. 《Happy Birthday》改编版（有具体使用场景：用户生日触发）
3. （可选）一首原创短曲，歌词关于 PHM / Rocky / Earth-Erid 友谊

每首：
- 1 次 music-2.6 调用（生成 instrumental，¥0.15）
- 1 次 MiniMax T2A 调用（Rocky vocals，包含在 Coding Plan）
- 1 次 ffmpeg mix（本地脚本）

新增脚本：`scripts/gen-rocky-songs.sh`

```bash
#!/bin/bash
# 渲染 Rocky 的 charm song mp3s
# 需要 MINIMAX_API_KEY (paygo, sk-api-) 用于 music-2.6
# 和 MINIMAX_KEY (sk-cp- 或 sk-api-) 用于 T2A

for song in twinkle birthday rocky_origin; do
  # 1. 生成 instrumental
  ./gen_instrumental.sh "$song"
  # 2. 生成 Rocky 念词
  ./gen_rocky_vocals.sh "$song"
  # 3. ffmpeg mix
  ./mix_song.sh "$song"
done
```

### 如果 spike 失败：替代路径

降级到"Rocky 教 Eridian 旋律"：

- 复用 #04 的 Eridian 合成函数
- 写一段 30-60 秒固定旋律（手工设计 motif，不再随机）
- Rocky 在前面用语言介绍："Listen, Rocky teach you Eridian song. About home."
- 用户可重复播放，无 paygo 成本

这条路径 0 美元成本，技术风险低，character-fit 高。

### Frontend

新增（v1.0 路径）：
- `web/src/components/RockySongs.tsx`：歌单 + 播放器
- 入口按钮位置 TBD

新增（替代路径）：
- `web/src/components/EridianMelody.tsx`：复用 #04 的合成函数
- 显示一句 Rocky 介绍

### Server

**零** server-side 调用（全部预渲染）。

## Open questions

1. **入口放哪？**
   - 主聊天界面太显眼会喧宾夺主
   - 倾向放在"陪伴菜单"hub 里（如果 #04 时建立了 hub）
   - 或者埋在好感度等级里（"Lv3 解锁 Rocky 唱歌"）

2. **要不要触发性出现？**
   - 用户生日时 Rocky 主动唱 Happy Birthday？
   - 需要 birthday 数据（onboarding 没收集这个，要新加字段）
   - 倾向 v1 不做，保持纯 on-demand

3. **替代路径"Eridian 旋律"算不算独立 feature？**
   - 它跟 #04 沉浸陪伴重合度高
   - 倾向：如果 #04 已经做了 Eridian 合成，"教旋律"作为 #04 的一个 affordance
     就够了，不需要单独 feature

## Verification / 验证 & 测试方案

### Spike 阶段（critical gate）

```
deliverable:
- 1 首 30-60 秒的 mix mp3
- 文件位置: /Users/yangyihan/Downloads/hail-mary-chat/spike/rocky_song_v1.mp3

验收 criteria（go/no-go）:
[ ] Owner 听完不是"这是 bug 吗"反应
[ ] 节拍至少能跟得上器乐
[ ] 角色感至少有 50% 保留（不是完全 OCR-style 念词）
```

### v1.0 测试（如果 go）

- [ ] 3 首歌的 mp3 都能在 chrome / safari / iOS 播放
- [ ] 包体增长 < 5MB
- [ ] 入口按钮的语言/解锁条件正确

### 替代路径测试（如果 no-go）

- [ ] Eridian 旋律在所有平台播放（已有 #04 测试覆盖）
- [ ] Rocky 介绍文案在三语下都自然

### Production 烟测

```bash
# 如果 ship v1.0，确认 mp3 都到位
for song in twinkle birthday rocky_origin; do
  curl -sI "https://teaching-collie-6315.edgespark.app/audio/songs/${song}.mp3" | head -1
done
```

## Rollout

**Phase 0 (this can happen anytime)**:
1. Spike：用 paygo key 跑 1 首 demo song
2. Owner + 2 alpha 听感评估
3. Go/No-go 决定

**Phase 1 (if go)**:
4. 写 `gen-rocky-songs.sh`
5. 渲染 2-3 首歌
6. 写 RockySongs UI
7. PR + review + 部署

**Phase 1' (if no-go)**:
4. 在 #04 Immersive Companion 的基础上加"Eridian 旋律"affordance
5. 不单独 ship 这个 spec

**回滚方案**：纯静态资产 + 前端组件，revert PR 即可。

## Effort breakdown

### Phase 0 spike

| 步骤 | 估时 |
| --- | --- |
| 调 music-2.6 + T2A 跑出 demo | 0.25d |
| ffmpeg 调音量/节拍 | 0.15d |
| Owner 听感 review | 0.1d |
| **合计** | **0.5d** |

### Phase 1 (if go)

| 步骤 | 估时 |
| --- | --- |
| 渲染 3 首完整 mp3 | 0.5d |
| RockySongs UI | 0.75d |
| 入口集成 + i18n | 0.5d |
| 测试 + polish | 0.25d |
| **合计** | **2d** |

### Phase 1' (if no-go)

| 步骤 | 估时 |
| --- | --- |
| 设计固定 Eridian motif | 0.25d |
| 集成到 #04 ImmersiveCompanion | 0.25d |
| **合计** | **0.5d**（merged into #04） |

## 相关 secret / 配置

| 项 | 状态 |
| --- | --- |
| `MINIMAX_API_KEY` (paygo) | ✅ 已配（用于 voice_clone） |
| `MINIMAX_CODING_PLAN_KEY` | ✅ 已配（用于 T2A） |
| 音乐生成 quota | 不在 Coding Plan，按 paygo 计费 |
