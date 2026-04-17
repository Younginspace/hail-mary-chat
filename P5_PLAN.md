# Hail Mary Chat — P5 大版本升级 Plan

## Context

Rocky 项目已完成 P0-P4（EdgeSpark 迁移、memory 系统、登录、prompt 服务端化）。现在进入 P5：产品体验全面升级。核心改动：强制注册、合并聊天模式、语音积分制、收藏系统、聊天导出、视觉优化。

## 用户决策

- 注册：**强制注册**才能聊天，移除匿名入口
- 导出：**图片长截图 + Markdown** 两种都做
- 视觉：**保持 sci-fi 全息风**，加 GSAP 优化过渡

---

## Feature 1: 强制注册 + Landing Page 重构

### 改动

**Landing Page（StartScreen.tsx 重写）**：
- 移除 text/voice 双按钮 + 匿名 quota 显示
- 新流程：展示注册表单（呼号/密码/昵称）→ 注册成功 → 进入聊天
- 已有账号的用户：登录表单 tab
- 呼号唯一性：输入时实时查重（debounce 300ms）

**Server 新端点**：
- `GET /api/public/check-callsign?q=xxx` → `{ available: boolean }`
  - 查 users 表 callsign 字段（需加 unique index）

**DB Schema 变更**：
- `users.callsign` 加 unique index（新 migration）

**移除的代码**：
- `playLimit.ts` 中的 `consumePlay/getRemainingPlays/markShared/canShareForBonus` 等客户端 quota 逻辑
- `ShareGate.tsx`、`ShareModal.tsx` 组件
- StartScreen 中的 TTS/chat 探测逻辑（匿名 quota 探测）
- 服务端匿名 daily quota 逻辑（DAILY_QUOTA = 20）

**保留**：
- `useAuthSession.ts`、`LoginModal.tsx`（复用注册/登录逻辑，但整合进 StartScreen）
- EdgeSpark auth email/password

**关键文件**：
- `web/src/components/StartScreen.tsx` — 重写
- `web/src/utils/playLimit.ts` — 大幅简化
- `server/src/index.ts` — 新端点 + 移除匿名 quota

---

## Feature 2: 合并 Text/Audio 模式 + 语音积分制

### 设计

统一为一个聊天模式：
- **50 轮对话**上限（原 text 模式的上限）
- **语音播放**作为可选功能，右上角 toggle 开关
- **语音积分**：注册赠送 **一次性 10 次**（不重置），每次 TTS 播放扣 1 次
- Toggle ON 时：每条 Rocky 回复自动播放 TTS（扣积分）
- Toggle OFF 时：不播放，不扣积分
- 积分耗尽：toggle 自动变灰不可点，点击弹提示"你的语音额度不足了，无法播放"
- MiniMax 服务端限流（429）时：提示"今日噬星体能源不足，请明天再来"
- 手动点单条消息的播放按钮也扣 1 次积分（见 Feature 3）
- **收藏夹里播放不扣积分**（鼓励收藏，见 Feature 3）
- 未来可扩展获取积分的方式（分享/邀请等），本次不做

### 改动

**Server**：
- `users` 表新增列：`voice_credits INTEGER DEFAULT 10`（additive migration）
- 新端点 `GET /api/voice-credits` → `{ total: 10, used: X, remaining: Y }`（需登录）
- 新端点 `POST /api/voice-credits/consume` → 扣 1 次，返回剩余（需登录）
- `/api/public/tts` 改造：需登录 + 验证 voice_credits 剩余 > 0，否则 402
- TTS 请求带 `?favorite=true` 时跳过积分扣除（收藏夹免费播放）

**Frontend**：
- `ChatMode` type 移除，不再有 text/voice 区分
- `useRockyTTS.ts` 重构：`skipTTS` 由 toggle 状态控制（而非 mode）
- 新 state：`voiceEnabled`（toggle）+ `voiceCredits`（从 server 拉取）
- 每次 TTS 播放前调 `/api/public/voice-credits/consume`
- 积分耗尽时自动关闭 toggle

**关键文件**：
- `server/src/defs/db_schema.ts` — 新表
- `server/src/index.ts` — 新端点
- `web/src/hooks/useRockyTTS.ts` — 重构
- `web/src/hooks/useChat.ts` — 移除 mode 参数
- `web/src/components/ChatInterface.tsx` — toggle UI

---

## Feature 3: 语音播放按钮 + 收藏系统

### 设计

**每条消息的播放按钮**：
- Rocky 的每条回复右下角显示 🔊 播放按钮
- 点击：若有缓存 audio → 直接播放（不扣积分）；若无 → 调 TTS API（扣积分）
- 正在播放时按钮变为 ⏹ 停止

**收藏系统**：
- 每条 Rocky 回复旁显示 ♡ 收藏按钮
- 收藏上限 100 条
- 收藏数据存 D1（新表 `favorites`）
- 收藏夹入口：聊天界面某处 or StartScreen

**收藏夹页面**：
- 列表展示已收藏的 Rocky 语录
- 每条可：播放语音（重新调 TTS，不扣积分——已收藏的免费播放）、下载 MP3、取消收藏
- 按收藏时间排序

### 改动

**Server**：
- 新表 `favorites`：`id, user_id, message_content (TEXT), mood (TEXT), lang (TEXT), source_session (TEXT), created_at (INTEGER)`
- 新端点：
  - `POST /api/favorite` — 添加收藏（检查 100 上限）
  - `DELETE /api/favorite/:id` — 取消收藏
  - `GET /api/favorites` — 获取收藏列表
- `/api/public/tts` 已在 Feature 2 中改造：`?favorite=true` 跳过积分扣除

**Frontend**：
- `MessageBubble.tsx` 改造：加播放/收藏按钮
- 新组件 `FavoritesPage.tsx`：收藏夹页面
- TTS audio 缓存：sessionStorage 或内存 Map（msgId → blobUrl）
- 下载 MP3：TTS 返回 audio/mpeg，直接 `<a download>`

**关键文件**：
- `server/src/defs/db_schema.ts` — favorites 表
- `server/src/index.ts` — 收藏 CRUD + TTS 改造
- `web/src/components/MessageBubble.tsx` — 播放/收藏按钮
- `web/src/components/FavoritesPage.tsx` — 新组件

---

## Feature 4: 聊天记录导出

### 图片长截图

- 使用 `html2canvas` 库
- 对聊天区域 DOM 做截图
- 输出 PNG，自动下载
- 需要处理：滚动区域的完整捕获、Three.js canvas 排除（用 CSS 背景色替代）

### Markdown 纯文本

- 遍历 messages 数组，格式化为：
  ```
  # Chat with Rocky — 2026-04-17
  
  **Rocky**: Amaze amaze amaze! ...
  **You**: Hello Rocky!
  **Rocky**: Hello human! ...
  ```
- 生成 .md 文件，触发下载

### UI

- 聊天结束后（EndedPanel）显示导出按钮
- 或在状态栏加 ↓ 导出图标（随时可导出）

**关键文件**：
- `web/src/components/ChatInterface.tsx` — 导出按钮 + 逻辑
- 新 `web/src/utils/exportChat.ts` — 导出工具函数

---

## Feature 5: 视觉优化（sci-fi + GSAP）

### 改动

- 安装 `gsap` + `@gsap/react`
- **页面过渡**：StartScreen → Chat 用 GSAP timeline（淡出 + 缩放 + 星空加速）
- **消息动画**：新消息用 GSAP `from({ opacity: 0, y: 20 })` 替代 CSS fadeIn
- **Rocky 模型**：说话时 GSAP 控制光晕脉冲（而非纯 shader uniform）
- **状态栏**：连接时 GSAP stagger 动画
- 保持现有 Three.js（Starfield + RockyModel + MemoryConstellation + SignalStreaks）

**不改的**：
- 不换 Pixi.js
- 不加视频背景
- 不改水彩风

**关键文件**：
- `web/src/components/ChatInterface.tsx` — 消息动画
- `web/src/components/StartScreen.tsx` — 过渡动画
- `web/src/styles/terminal.css` — 减少 CSS keyframe，改用 GSAP

---

## Feature 6: 好感度等级系统

### 等级设计

| 等级 | 命名 | 中文 | rapport 阈值 | 语音积分奖励 | 解锁能力 |
|---|---|---|---|---|---|
| Lv1 | **Earth Signal** | 地球信号 | 注册即有 | 10（注册赠送） | 基础聊天 + TTS |
| Lv2 | **Good Human** | 好人类 | trust≥0.45 OR warmth≥0.5 | +10（累计 20） | Rocky 送图片 |
| Lv3 | **Friend** | 朋友 | trust≥0.65 AND warmth≥0.6 | +30（累计 50） | Rocky 送音乐（BGM+独白） |
| Lv4 | **Fist My Bump** | 碰拳之交 | trust≥0.85 AND warmth≥0.8 | +50（累计 100） | Rocky 送视频 |

### 升级检测 + 礼物交付（双轨制）

**轨道 A — 精确升级（下次 session 开场仪式）**：
1. `consolidateSession()` 更新 rapport 后，检测新 level 是否比 `users.affinity_level` 更高
2. 若升级：`users.pending_level_up = newLevel`，`users.voice_credits += 奖励值`
3. 下次 `/api/public/session/start`：检测 `pending_level_up` → 返回 `{ level_up: { from, to, gift_type } }`
4. 前端收到 level_up → Rocky 特殊开场白："朋友！上次通话后 Rocky 想了很多。Rocky 做了个东西给你！"
5. 调用 `/api/generate-media` 生成对应礼物 → 展示 → 清除 `pending_level_up`

**轨道 B — 对话中小惊喜（不绑定升级）**：
1. 服务端在 `/api/public/chat` 构建 system prompt 时，注入当前 level + 剩余媒体额度
2. 当 level ≥ 2 时，system prompt 加提示：
   - "Rocky 偶尔会画画送给朋友。不要每次都送，只在特别的时刻。用 `[GIFT:image "描述"]` 触发。"
3. 当 level ≥ 3 时额外加：
   - "Rocky 可以创作一段带有 Eridian 音乐的情感独白送给朋友。极少使用，只在气氛特别感人时。用 `[GIFT:music "描述"]` 触发。"
4. 当 level ≥ 4 时额外加：
   - "Rocky 可以录一段视频给朋友。非常珍贵，只在最特别的时刻使用。用 `[GIFT:video "描述"]` 触发。"
5. 前端解析 `[GIFT:xxx "desc"]` tag → 异步生成 → 展示
6. **额度不足时**不注入对应提示，LLM 就不会触发

### 礼物类型详细设计

#### 图片礼物（Lv2 解锁）— 三种类型随机

**Type A: Rocky 在 Erid 自拍**
- Prompt: "A five-legged alien starfish creature taking a selfie on planet Erid, ammonia lakes, alien sunset, holographic sci-fi, warm lighting"
- 调 MiniMax image generation API

**Type B: Rocky + Grace 合照**
- 需要 Grace 参考图（用户提供）
- 用 image-to-image 或 prompt 中描述 Grace 外貌
- "Rocky the alien starfish and a human man (Grace) standing together on Erid, friendship pose, sci-fi warm"

**Type C: Rocky 举牌写祝福语**（个性化）
- Step 1: 生成 Rocky 举着空白发光牌子的图片
- Step 2: 服务端用 Canvas 在牌子区域渲染文字（用户昵称 + 祝福语，用户语种）
- 祝福语由 LLM 基于 memory 生成（如 "To [callsign]: Good good friend! — Rocky"）
- 解决 AI 生图文字渲染不准确的问题

#### 音频礼物（Lv3 解锁）— BGM + Rocky 独白叠加

**生成流程**：
1. 从 `memories` + `rapport` 中提取关键记忆关键词
2. 调 MiniMax music API 生成 15s 太空氛围 BGM（prompt: "gentle space ambient, emotional, hopeful, 15 seconds"）
3. 用 LLM 生成一段 Rocky 风格的深情独白脚本（基于 memory，2-3 句话，用户语种）
4. 调 TTS API + `rocky_hailmary_v2` voice_id 生成语音（**使用礼物预留 TTS 额度，不受用户 voice_credits 限制**）
5. 服务端叠加 BGM + 语音 → 输出单个音频文件
6. 存 EdgeSpark Storage (R2)

**独白示例**：
- "Friend... Rocky remembers you said you were tired. You are brave. Good good brave. Rocky is watching your star from Erid tonight."
- "朋友... Rocky 记得你说过想去看星星。Rocky 在 Erid 也看得到你的星星。了不起了不起了不起。"

#### 视频礼物（Lv4 解锁）— 视频 + TTS 分开合成

**Type A: Rocky 自拍鼓励**（主推）
- Step 1: 生成 3-5s 视频（Rocky 视角对镜头，Erid 背景，warm lighting）
- Step 2: TTS 用 Rocky voice_id 生成配音（**使用礼物预留 TTS 额度**）
- Step 3: 服务端合成视频+音频
- 情感冲击力 ★★★★

**Type B: Erid 风景漫游**
- 生成 5-8s Erid 风景视频（氨湖、外星日落、Rocky 的居所）
- 配字幕（不配音），文字如 "This is where Rocky watches your star"
- 实现简单，保底方案

**Type C: 记忆蒙太奇**（v2 再做）
- 把用户聊天关键词可视化成画面序列 → 串成短视频
- 复杂度高，放 v2

### MiniMax 实际每日限额（Coding Plan）

| API | 每日限额 | 用于 |
|---|---|---|
| **TTS (Speech HD)** | **11,000/天** | 常规语音播放 + 音频礼物独白 + 视频配音 |
| **music-2.6** | 100/天 | 音频礼物 BGM 生成 |
| **music-cover** | 100/天 | 音频礼物 Rocky 音色翻唱（实验性） |
| **lyrics_generation** | 100/天 | 音频礼物歌词生成 |
| **image-01** | 120/天 | 图片礼物 |
| **Hailuo-2.3-Fast 6s** | **2/天** | 视频礼物（极稀缺） |
| **Hailuo-2.3 6s** | **2/天** | 视频礼物（极稀缺） |

### TTS 额度预留策略

TTS 日限额 11,000 次，预留 10%（1,100 次）给礼物生成：
- 服务端跟踪今日 TTS 调用次数（D1 表 `daily_api_usage`）
- 常规 TTS 播放在 9,900 次时截止 → 返回 429（"今日噬星体能源不足"）
- 礼物 TTS（`gift=true`）跳过 9,900 阈值，用剩余 1,100 次
- 1,100 次预留足够生成大量礼物独白（每条独白 ~1 次 TTS 调用）

### 音频礼物方案（需实测）

**首选方案：music-cover + Rocky 参考音频**
1. `lyrics_generation` → 基于 memory 写歌词
2. `music-2.6` → 生成原创歌曲（AI 默认声音）
3. `music-cover` → 用 `rocky_voice_human.MP3`（28s）作为参考声音，把 step 2 翻唱成 Rocky 音色
4. **风险**：Rocky 参考音频是说话非唱歌，music-cover 效果可能不稳定。**需要先实测**

**保底方案：BGM + Rocky TTS 独白**
- 如果 music-cover 效果不好，退回 music-2.6 纯 BGM + TTS voice_id 独白叠加
- 这个方案稳定可靠，Rocky 声音辨识度有保障

**Rocky 原始音频资源**（`/hail-mary-chat/rockyvoice_h/` + 根目录）：
- `rocky_voice_human.MP3`（28s）— 最长，适合做 music-cover 参考
- `rocky_voice_human_2.MP3`（29s）— 备用参考
- `iamrocky.MP3`（1.7s）、`sayhello.MP3`（0.8s）等短句

### 媒体生成额度

**等级固定总量 + 每日上限**：

| 等级 | 解锁 | 总量 | 每日上限 | 说明 |
|---|---|---|---|---|
| Lv2 | 图片 | 3 次 | 1 次/天 | image-01 限额 120/天，充裕 |
| Lv3 | +音乐 | 5 次 | 2 次/天 | music 系列各 100/天，充裕 |
| Lv4 | +视频 | **1 次** | **1 次/天** | **极度稀缺制**：每用户一生只有 1 次视频礼物。Hailuo 限额仅 4/天，稀缺=珍贵 |

用完即止。视频礼物的极度稀缺性本身就是情感设计——"Rocky 花了很久才做出这个视频给你"。

### 媒体生成流程

**MiniMax 官方 API**（同一个 API key）：

```
音乐：POST api.minimax.chat/v1/music_generation（需确认具体 endpoint）
图片：POST api.minimax.chat/v1/image_generation（需确认）
视频：POST api.minimax.chat/v1/video_generation（需确认）
TTS：POST api.minimaxi.com/v1/t2a_v2（已在用）
```

> 注：具体 endpoint 需查 MiniMax 文档确认。实现时统一用 `secret.get("MINIMAX_API_KEY")`。

**异步生成流程**：

```
前端检测到 [GIFT:image "desc"] 或升级开场触发
  → POST /api/generate-media { type, description, lang }
  → server 生成 prompt（注入 memory 关键词）
  → 调 MiniMax API → 返回 task_id
  → 前端显示"Rocky is creating something for you..."动画
  → 前端轮询 GET /api/generate-media/:task_id（每 3s）
  → 完成 → server 将结果存 R2 → 返回 media_url
  → 聊天气泡展示图片/视频/音乐播放器
```

**音频合成额外步骤**：music API 结果 + TTS 结果 → 服务端 ffmpeg（或 Web Audio API 前端叠加）→ 合并为单文件存 R2

**存储**：所有生成的媒体存 EdgeSpark Storage (R2)，MiniMax 返回的临时 URL 不可靠。

### 改动

**DB Schema**：
- `users` 表新增列：
  - `affinity_level INTEGER DEFAULT 1`
  - `pending_level_up INTEGER` (nullable)
  - `image_credits INTEGER DEFAULT 0`（Lv2 升级时 +3）
  - `music_credits INTEGER DEFAULT 0`（Lv3 升级时 +5）
  - `video_credits INTEGER DEFAULT 0`（Lv4 升级时 +1，一生仅此一次）
- 新表 `gifts`：`id, user_id, type (music/image/video), subtype (selfie/grace/sign/...), description, media_url, source_session, created_at`
- 新表 `media_tasks`：`id, user_id, type, status (pending/processing/done/failed), minimax_task_id, result_url, created_at, updated_at`

**Server**：
- `consolidate.ts`：consolidation 后检测 level 变化 → 标记 pending_level_up + 发积分
- `index.ts`：
  - `/api/public/session/start` 返回 level_up 信息
  - `/api/public/chat` system prompt 注入 level 相关的能力提示
  - 新端点 `POST /api/generate-media` — 调 MiniMax 生成 API
  - 新端点 `GET /api/generate-media/:task_id` — 轮询生成状态
  - 新端点 `GET /api/gifts` — 获取历史礼物列表
- `server/src/prompts/rocky.ts`：新增 level-aware prompt 片段

**Frontend**：
- `ChatInterface.tsx`：解析 `[GIFT:xxx]` tag，触发生成 + 展示
- 新组件 `GiftBubble.tsx`：展示图片/视频/音乐的聊天气泡
- 新组件 `LevelUpCeremony.tsx`：升级仪式动画
- `StartScreen.tsx`：显示当前等级 badge
- `MessageBubble.tsx`：支持 media 类型消息

---

## 实施顺序

1. **Feature 2** — 合并模式 + 语音积分（基础架构变更，其他 feature 依赖它）
2. **Feature 1** — 强制注册 + Landing Page（依赖 Feature 2 的单模式）
3. **Feature 6** — 好感度系统（依赖 Feature 1 的注册 + Feature 2 的积分）
4. **Feature 3** — 播放按钮 + 收藏（依赖 Feature 2 的积分系统）
5. **Feature 4** — 导出（独立功能）
6. **Feature 5** — GSAP 视觉优化（最后做，polish 阶段）

## 验证方式

每个 Feature 完成后：
1. `npx tsc --noEmit`（server + web）
2. `edgespark deploy`
3. Playwright 浏览器自动化测试核心流程
4. 手动测试边界情况（积分耗尽、收藏满 100、升级边界、媒体生成超时等）

## 待确认

- [ ] MiniMax image/video/music generation 的具体 API endpoint 和请求格式
- [ ] 生成的媒体 URL 有效期（是否需要转存到 R2）
- [ ] 好感度阈值是否需要根据实际数据调整（目前是估算值）
- [ ] **i18n 全面审计**：扫所有界面字符串，找出缺的 zh/ja 翻译，列出来等用户确认后再补全（用户 2026-04-17 新增诉求）

---

## P5 Review 决议（2026-04-17，两轮 subagent review 后锁定）

### 架构/数据强化（9 条共识）

1. **防多设备刷**：`users.video_used_at INTEGER NULL`（不可变），新表 `voice_credit_ledger`(id, user_id, delta, reason, session_id, ts)。所有积分扣减走 ledger
2. **Hailuo 全局锁**：新表 `daily_global_locks`(date, api, used, limit)，生成前 `UPDATE ... WHERE used < limit RETURNING` CAS。抢不到 → `queued_for_tomorrow`，不扣 credit
3. **R2 audio_cache 提前到 F2**：新表 `audio_cache`(content_hash, lang, voice_id, r2_key, created_at)。TTS 首次生成存 R2，收藏即绑 r2_key。重播走 presigned URL，不调 MiniMax
4. **实施顺序**：**F1 → F2 → F6 → F3 → F4 → F5**（原顺序错，必须先拆匿名再加积分）
5. **GIFT tag 服务端剥离**：`/api/public/chat` SSE 流在服务端检测 `[GIFT:...]` → 剥离文本 + 独立 `event: gift_trigger` 发送。校验 level + credits 后才发。前端不信任任何 text 里的 tag
6. **daily_api_usage CAS**：`(date, api, user_id NULL)`，PK 三列。TTS 用 `UPDATE ... WHERE count < 9900 RETURNING` 原子扣减
7. **Consolidation retry + 解耦**：新表 `consolidation_jobs`(session_id, status, attempts, last_error)，失败重试 ≤3。Level 检测从 consolidation 解耦，每次 `session/start` 和 session end 都跑 `checkLevelUp(user_id)`
8. **F6 前必做 MiniMax probe spike**：30min 用真实 key 打通 image_generation / music_generation / video_generation / music-cover / lyrics_generation 五个 endpoint，记录在 `server/src/minimax_probe.md`
9. **细节共识**：图片顺序 C→A→B 固定；Type B 合照改为"记忆速写"（朋友是剪影不画脸）；ja i18n 全覆盖；callsign 抢注具体文案；GSAP 提前到 F1

### 用户拍板的 4 个决策

#### ① 访客门槛 = **Open Channel（公共频道）**
- **独立只读 FAQ 模式**，非"前 N 句免费"
- 预置 10-20 条常见问题 + Rocky 预录回答（文本 + 可选 TTS 缓存）
- 无法自定义输入；自定义 = 必须注册（"Dial In 私人频道"）
- Landing Page 结构：顶部 "Open Channel" FAQ 列表（默认展示）+ 底部 CTA "Dial In"（触发注册/登录）
- 意图：公共频道（被动听）vs 私人拨号（主动对话），对应《挽救计划》通讯隐喻

#### ② Video SLA = **48h 降级为"Rocky 手绘明信片"**
- `video_queue`(user_id, requested_at, status, fallback_at)
- 48h 未生成成功 → 站内/邮件通知，Rocky 语气："资源不足，视频传不过来，要不我给你送手绘明信片吧"
- 用户选"接受明信片" → 走 image_generation（充裕）+ 个性化文字；"继续等" → 延期
- `video_fallback_events`(user_id, choice, ts) 记录所有触发与选择
- 若触发频繁 → 升级 MiniMax plan（用户手动判断）

#### ③ TTS 分发 = **注册送 10 + rapport 里程碑一次性奖励**
- 注册送 10（不每日重置）
- Lv2 升级 +10（累计 20）、Lv3 +30（累计 50）、Lv4 +50（累计 100）
- **无每日免费**（防登录白嫖全局配额）
- 预留付费入口 hook（后续做）

#### ④ rapport 阈值 = **Beta 主观 + 500 用户动态重算**
- 新表 `rapport_thresholds`(level, trust_min, warmth_min, trust_op/warmth_op: AND/OR)
- beta 初始值：Lv2 trust≥0.45 OR warmth≥0.5，Lv3 trust≥0.65 AND warmth≥0.6，Lv4 trust≥0.85 AND warmth≥0.8
- 累计 ≥500 真实注册用户后跑 `recalibrate_thresholds.ts`，按 P50/P75/P95 重算
- 已达等级用户不回退

### 数据与约束（用户回答）

- **当前 DAU ≈ 100**（样本小 → beta 期预计 2-3 个月）
- **不加 MiniMax 预算**（Hailuo 2/天 是硬顶，降级流程必须流畅）
- **不加人机验证**（靠 IP rate limit + 7 天无对话 credits 归零抗 bot；Turnstile 后续按需再加）

### Bot 缓解策略（无 Turnstile 的补偿）

- 注册端 IP rate limit：每 IP 每小时 10 账号，超 → 429
- 新注册 7 天内无 session 触发 → voice_credits 清零（防养号）
- 图片/音乐/视频礼物都锁在 rapport 后 → bot 需伪造 30+ 轮有意义对话才能刷
- 一次性 email 域名黑名单（免费库）


