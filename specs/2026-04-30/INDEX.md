# Feature Specs — 2026-04-30 batch

**Created**: 2026-04-30
**Owner**: yangyihan
**Window**: 2 weeks nominal, **1 week realistic** (owner away 2026-05-01 → 2026-05-05)
**Status**: 7 specs queued, none implemented yet

> Specs in this directory are ephemeral handoff docs per
> `feedback_planning-docs-scope`. Each spec has its own status field;
> delete the spec file once that feature has shipped to production
> AND survived a week of real-user usage.

## 优先级 + 依赖图

```
W1 (this week, parallel):
  ├── 01-bedtime-stories.md  [P0, 2-3d]  no deps
  └── 05-skip-loading.md     [P0, 1-1.5d]  no deps

W2 (after owner returns):
  ├── 03-teaching-mode.md    [P1, 1-1.5d]  no deps
  └── 07-voice-input.md      [P1, 2-3d]  needs DASHSCOPE_API_KEY

W3+ (after W2 ships):
  ├── 04-immersive-companion.md  [P2, 2-3d]  reuses #1 audio infra
  ├── 06-image-input.md          [P2, 3-4d]  needs DASHSCOPE_API_KEY + R2
  └── 02-rocky-sings.md          [P3, spike-first]  needs MINIMAX_PAYGO_KEY
```

## 一句话目标

| Spec | 一句话 |
| --- | --- |
| 01 睡前故事 | 用户点🌙能听 Rocky 哄睡（3 个预录故事，按好感度解锁）|
| 02 Rocky 唱歌 | 用户能让 Rocky 唱一段（音乐生成 + T2A 叠唱方案）|
| 03 教学模式 | 用户开"📚教学模式"切换，Rocky/Grace 答科学问题更深入 |
| 04 沉浸陪伴 | 用户开"陪我"模式，背景白噪音 + Rocky 偶发母语哨音 |
| 05 跳过 loading | 返回用户点 app 立刻进聊天，不再等 spinner |
| 06 识图 | 用户每条消息可上传 1 张图，Rocky 像看到照片那样回应 |
| 07 语音输入 | 用户能按住录音说话，Rocky 听懂并回复（ASR + 现有 TTS）|

## 关键技术决策（共享上下文）

调研背景在每个 spec 自己的"技术方案"段落里展开，下面是跨 spec 复用的决策：

| 决策 | 选择 | 影响哪些 spec |
| --- | --- | --- |
| ASR vendor | **Aliyun DashScope Paraformer-v2** | 07 |
| Vision LLM vendor | **Aliyun DashScope Qwen-VL-Max** | 06 |
| Eridian sound source | **Web Audio 合成**（不是 voice clone）| 02, 04 |
| Singing 实现 | **music-2.6 instrumental + T2A 叠唱**（没法用 voice_id）| 02 |
| 长音频播放路径 | **HTML5 `<audio>` 元素**（NOT Web Audio API）| 01, 04 |
| iOS 后台播放 | **Wake Lock + MediaSession API** | 01, 04 |

## 调研已完成的"否定结论"

避免后人重复踩坑：

- ❌ MiniMax 没有 ASR / 语音转文字端点
- ❌ MiniMax M2.x 文本 LLM 不接受图像输入（Anthropic-compat 兼容层也不行）
- ❌ MiniMax voice_clone 不能克隆非人声（Eridian 哨音）
- ❌ MiniMax music-2.6 不接受 voice_id（Rocky 没法用克隆音色"真唱"）
- ✅ Anthropic Claude 从 CF Worker 是可达的，但比国内 vendor 贵 3-30 倍 + 监管灰区，故选国内方案

## Secret 清单

| Secret | 当前状态 | 给哪些 spec 用 |
| --- | --- | --- |
| `MINIMAX_CODING_PLAN_KEY` (sk-cp-) | ✅ 已配 | TTS / 文本 LLM |
| `MINIMAX_API_KEY` (sk-api-, paygo) | ✅ 已配 | voice_clone / music-2.6 |
| `DASHSCOPE_API_KEY` | 🟡 用户配置中（2026-04-30）| 06, 07 |

## 工作纪律（自我提醒）

- **一天一次部署**：每个 feature 自己一个 PR → 独立 review → 合并 → 部署 → 当天打卡
- **不在 prod 测试**：所有 PR 必须先本地 + Playwright 验证
- **secret 不进 chat**：用 `edgespark secret set <KEY>` 拿浏览器 URL 让用户填
- **每个 PR 都要做独立 code review**：用 general-purpose subagent 跑一轮再合

## Backlog（不在本批，但记下来）

| 项 | 价值 | 难度 | 触发条件 |
| --- | --- | --- | --- |
| **gitleaks pre-commit hook** | 自动拦截误 commit 的 API key（机器层兜底，不再依赖 agent 肉眼审）| 5 分钟 | 本批 5 个 PR review 完后做，2026-04-30 讨论中标记 |
| **/api/asr 单用户日次数 limiter** | 防止恶意用户单日烧光 ASR 配额 / 防误用 | ~1 小时 | #07 merge + 公测前必须做 |
| **/api/chat 识图分支单用户日图数限制** | 同上，识图侧 + 同图 hash 去重 | ~1.5 小时 | #06 merge + 公测前必须做 |
| **NSFW image moderation**（Cloudflare Workers AI image classifier）| #06 公开发布前必须 | 0.5 天 | #06 merge + 公开发布前 |
| **Vendor health canary endpoint + Bark/飞书 webhook 告警** | 防止 SEV-1 复现（MiniMax 配额耗尽 / vendor 失效）静默；5 分钟内主动通知 owner | 1.5-2 小时 | 用户决定是否做（2026-04-30 讨论中说"先不管"）|
