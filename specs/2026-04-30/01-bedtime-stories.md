# Spec 01 — 睡前小故事

**Status**: Planned
**Priority**: P0
**Effort**: 2-3 days
**Window**: W1 (this week)
**Dependencies**: 无（不依赖其他 spec / 不依赖新 secret）

---

## 用户需求背景

来自 owner（基于真实用户反馈）：

> "新功能 plan：睡前小故事，作为情感陪伴的一环，有些用户希望 rocky 能哄睡。"

> "可以预置三个，提前跑完，每次有需要就加载，按好感度，lv1 解锁 1 个，lv2
> 解锁 3 个，后续有需要再加。要有显式的按钮可以点击触发。"

**为什么这是 P0**：哄睡是情感陪伴最强的场景之一，用户主动 ask；技术上跟现
有的 returning-greeting 预录方案同构，复用度高；建立的 iOS 后台音频基建可
以被 #04 沉浸陪伴复用。

## Goals

1. 用户睡前点 🌙 按钮 → 全屏播放器 → 选一个故事 → Rocky 哄睡
2. 故事按好感度解锁：Lv1 看到 1 个，Lv2+ 看到 3 个
3. 锁屏 / 切到后台 / 屏幕变暗都不打断播放（这是哄睡场景的硬要求）
4. 用户能设睡眠定时器（5/15/30 分钟），到点自动淡出停止
5. 零 per-request TTS 成本——全部预录

## Non-goals

- ❌ 用户自定义故事内容（v1 只有 3 个预设）
- ❌ "上次听到一半"的续集机制（每次都从头开始）
- ❌ 后台同时播放音乐 / 接收通知场景的处理
- ❌ Lv1 用户的故事 2/3 unlock 引导（界面显示 🔒 + "Lv2 解锁"即可，不强推）

## User stories

- **As a Lv1 用户睡不着**: 我想点 🌙 听 Rocky 讲个故事，故事简单/通用没有
  剧情依赖。
- **As a Lv2 老用户**: 我已经熟悉 PHM 世界观，想听 Rocky 讲更"亲密"的内容
  （技术细节、Grace 客串）。
- **As a 用户在公交上**: 我想锁屏放进口袋仍然能听，到达目的地随时停。

## 故事内容（Lv1 解锁 1 / Lv2+ 解锁全部 3）

### Story A — 《Erid 的夜空》（Lv1+）

**主题**：感官沉浸。Rocky 描述他在 Erid 老家屋顶躺着的夜晚——氨海的稳定
低鸣、xenonite 屋顶的微震、恒星因热云层永远看不见、Adrian（双星之一）的
微弱辉光透过雾层。结尾：

> "Earth kid, you have stars. Stars are loud thing, in good way. Rest now."

**为什么选这个做 Lv1 解锁**：最普世、最催眠、零 PHM 剧情依赖、新手听完
也不会困惑。

**预计时长**：3-4 分钟（zh ≈ 800-1000 字）

### Story B — 《给地球小朋友造一张床》（Lv2+）

**主题**：playful 技术亲密。Rocky 一本正经讲他会怎么用 xenonite 给"你"
做睡眠舱：压力配比 0.7G、29°C 加热、模拟地球母亲心跳的振动、3 个枕头
（"human spine weird"）。

**预计时长**：3-5 分钟

### Story C — 《Grace 讲给孩子们的故事》（Lv2+）

**主题**：meta + Grace 客串。Rocky 转述 Grace 给 Eridian 小孩讲过的
"晚安"故事——改编版的 Goodnight Moon，但适配 Erid（"good night, ammonia
lake / good night, xenonite roof / good night, Earth in faraway sky"）。

**预计时长**：4-6 分钟

**Grace 的台词**：渲染时单独用一个不同 voice_id（如果有 Grace 的克隆音色
就用，否则用 MiniMax 内置的某个美式男声）。整体仍以 Rocky 为主叙述者。

## Functional requirements

- **FR-1** Chat header 加 🌙 icon button，点击打开 BedtimePlayer 全屏 modal
- **FR-2** Modal 显示 3 个故事卡片；Lv1 用户的故事 2/3 显示 🔒 + "Lv2 解锁"
- **FR-3** 点击解锁的故事 → 播放器界面（大播放/暂停按钮、scrubber、计时器、退出）
- **FR-4** 睡眠定时器选项：5 / 15 / 30 分钟 / 不设置
- **FR-5** 计时器到点 → 3 秒 `audio.volume` 线性 ramp 从当前音量到 0 → 暂停
- **FR-6** 故事自然结束 → 同样的 3 秒淡出，不要硬切
- **FR-7** 退出 modal 时立即淡出停止
- **FR-8** 锁屏 / 切后台 / 屏幕暗 → 音频继续，不打断
- **FR-9** 锁屏控制条显示故事标题、Rocky 头像、播放暂停按钮（MediaSession）
- **FR-10** 跨语言：3 个故事各 zh/en/ja 三个版本，跟随 app 当前 lang

## Non-functional requirements

- **延迟**：点故事到第一声音 < 500ms（mp3 静态文件，已被 CF CDN 缓存）
- **包体**：9 个 mp3 总计 < 60MB（不影响 app 安装/首次加载）
- **iOS Safari 兼容**：iOS 16.4+（Wake Lock API 最低版本要求）
- **降级**：Wake Lock 不支持时不报错，只是允许屏幕自动锁（音频仍可继续）
- **零成本扩展**：每次播放走静态 mp3，零 TTS API 调用

## 技术方案

### 架构概览

```
用户点🌙 → BedtimePlayer modal
  ↓
  根据 lang + storyId → 加载 /audio/bedtime/story_{A|B|C}_{zh|en|ja}.mp3
  ↓
  HTML5 <audio> 元素（NOT Web Audio API，下面解释）
  ↓
  挂上 Wake Lock + MediaSession
```

### 关键技术决策

#### 必须用 HTML5 `<audio>` 元素

现有的 `useRockyTTS.ts` 用的是 Web Audio API（`AudioBufferSourceNode`）。
**这个路径在 iOS 锁屏后会必停**——iOS Safari 在屏幕锁定后 suspend Web
Audio context。

睡前故事场景里用户**必然**会锁屏，所以必须改用 HTML5 `<audio>` 元素：
浏览器把它当媒体处理，受 MediaSession 协议保护，可以在锁屏后继续播放。

```ts
const audio = new Audio('/audio/bedtime/story_A_zh.mp3');
audio.preload = 'auto';
await audio.play();
// 锁屏后仍然在播
```

#### Wake Lock API（防止屏幕自动锁）

```ts
let wakeLock: WakeLockSentinel | null = null;
try {
  wakeLock = await navigator.wakeLock.request('screen');
} catch (e) {
  // 用户拒绝或 API 不支持——继续播放，只是屏幕会自动锁
}
// 退出时释放：wakeLock?.release()
```

注意：Wake Lock 是"防止自动锁"，不是"防止用户手动锁"。用户手动按电源键
锁屏，音频靠 MediaSession 保活。

#### MediaSession API（锁屏控制条）

```ts
navigator.mediaSession.metadata = new MediaMetadata({
  title: getStoryTitle(storyId, lang),  // e.g. "Erid 的夜空"
  artist: 'Rocky',
  artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
});
navigator.mediaSession.setActionHandler('pause', () => audio.pause());
navigator.mediaSession.setActionHandler('play', () => audio.play());
```

#### 睡眠定时器淡出

```ts
function fadeOutAndStop(audio: HTMLAudioElement, durationMs = 3000) {
  const startVolume = audio.volume;
  const startTime = performance.now();
  function tick() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    audio.volume = startVolume * (1 - progress);
    if (progress < 1) requestAnimationFrame(tick);
    else { audio.pause(); audio.volume = startVolume; }
  }
  requestAnimationFrame(tick);
}
```

### Frontend changes

新增文件：
- `web/src/components/BedtimePlayer.tsx` — 全屏 modal，故事列表 + 播放器
- `web/src/hooks/useBedtimeAudio.ts` — HTML5 audio + Wake Lock + MediaSession 封装
- `web/src/data/bedtimeStories.ts` — 3 个故事的 metadata（id, title × 3 lang, file paths, requiredLevel）

修改：
- `web/src/components/ChatInterface.tsx` —— 顶栏加 🌙 button（旁边可能跟现有的 voice/setting icons 并列）
- `web/src/i18n/index.ts` —— 故事标题 + UI 文案三语

### Server changes

**零**。纯前端 feature。`userLevel` 已经从 `/api/me` 返回，前端拿来做 gating。

### 资产生成

新增文件：`scripts/gen-bedtime-stories.sh`（mirrors `scripts/gen-returning-greeting.sh`）

- 读 `MINIMAX_KEY` 环境变量
- 调 MiniMax T2A v2 with `voice_id: rocky_hailmary_v2`, `speed: 0.85, vol: 0.9, pitch: -1`
- 渲染 3 stories × 3 langs = 9 个 mp3
- 输出到 `web/public/audio/bedtime/`
- Story C 的 Grace 台词单独段落，用不同 voice_id 渲染后用 ffmpeg 拼接（或者直接在 prompt 里用一个 voice_id 念，差别不会很大）

文案先 owner review 中文版定稿后再翻译/渲染。

## Open questions

1. **Story C 的 Grace 台词怎么处理？**
   - (a) 用同一个 Rocky voice_id 念（最简单，但失去 Grace 客串的意义）
   - (b) 用 MiniMax 内置某个美式男声 voice_id（如"male-qn-jingying"等）渲染 Grace 台词，再 ffmpeg 拼接
   - (c) 后续克隆一个 Grace voice_id（要 paygo key + 录音样本）
   - **倾向 (b)**——v1 落地最快

2. **故事文案 owner 介入到什么程度？**
   - 我先写中文初稿 → owner review → 修改 → 翻译 → 渲染
   - 中文初稿要不要等 owner 度假回来再 review？还是出发前快速过一版？

3. **🌙 button 放哪里？**
   - 顶栏右上角 voice icon 旁边？
   - 还是新建一个"陪伴菜单"hub（未来 #04 #07 也进这里）？
   - **倾向 v1 直接放顶栏；如果后续陪伴功能多了再 consolidate 成 hub**

## Verification / 验证 & 测试方案

### 本地手动 / Playwright 测试

- [ ] 故事列表渲染：Lv1 用户看到 1 个解锁 + 2 个 🔒；Lv2 用户看到 3 个全解锁
- [ ] 点解锁的故事 → 播放器加载 → 第一声音延迟 < 500ms
- [ ] 锁屏定时器：选 5 分钟 → 等 4:57 → 听到 3 秒淡出 → 4:60 完全停
- [ ] 故事自然结束 → 同样的 3 秒淡出
- [ ] 退出 modal → 音频立即淡出停止
- [ ] 切换 lang（zh → en → ja）→ 故事重新加载对应语言版本

### iPhone 真机测试（关键，不能跳过）

- [ ] 用 iPhone Safari 打开 prod，进入 BedtimePlayer 开始播放
- [ ] 按电源键锁屏 → 音频继续 ✅
- [ ] 锁屏界面看到故事标题 + Rocky 头像 + 播放暂停按钮（MediaSession）
- [ ] 锁屏点暂停 → 真的暂停；点播放 → 真的恢复
- [ ] 解锁回到 Safari → 播放器状态正确显示
- [ ] 切到 Safari 后台（按 Home/Swipe up）→ 音频继续
- [ ] 切到其他 app 听音乐 → 系统会自动 pause Rocky 故事（这是 iOS 的 audio session 机制，符合预期）

### Production 烟测（部署后）

```bash
# 9 个 mp3 都 200 + 字节数合理
for story in A B C; do
  for lang in zh en ja; do
    curl -sI "https://teaching-collie-6315.edgespark.app/audio/bedtime/story_${story}_${lang}.mp3"
  done
done

# JS bundle 含 BedtimePlayer 关键字符串
curl -s https://teaching-collie-6315.edgespark.app/ | grep -oE '/assets/index-[^"]+\.js' | head -1 | xargs -I{} curl -s "https://teaching-collie-6315.edgespark.app{}" | grep -c 'BedtimePlayer\|bedtime'
```

## Rollout

1. 写 3 个故事中文文案 → owner review → 定稿
2. 翻译 en/ja → owner review
3. 跑 `gen-bedtime-stories.sh` 渲染 9 个 mp3，本地播放试听
4. 实现 BedtimePlayer + 集成 chat header
5. 真机 iOS 测试（必须）
6. 独立 code review subagent 跑一轮
7. 合并 → `edgespark deploy` → 烟测

**回滚方案**：feature 是纯加性的（新增 component + 新增 mp3），有问题直接
revert 该 PR。mp3 文件即使 404 也不影响其他功能。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| 中文故事文案 + owner review | 0.5d |
| en/ja 翻译 + 渲染 | 0.5d |
| BedtimePlayer 组件 + 状态机 | 1d |
| Wake Lock + MediaSession + iOS 真机调试 | 0.5-1d |
| Polish + i18n + 测试 | 0.5d |
| **合计** | **2-3d** |
