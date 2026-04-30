# Spec 04 — 沉浸陪伴模式

**Status**: Planned
**Priority**: P2
**Effort**: 2-3 days
**Window**: W3+ (依赖 #01 的 iOS 后台音频基建)
**Dependencies**: #01 已实现（HTML5 audio + Wake Lock + MediaSession 模式可复用）

---

## 用户需求背景

来自 owner（基于真实用户反馈）：

> "沉浸式陪伴模式，放在旁边比较安静陪自己仔细，时不时出个声那种（白噪音？
> rocky 母语也有白噪音？）。"

**为什么这是 P2**：

- 这是四个新 feature 里**最贴近"Rocky 作为陪伴"产品定位**的一个
- 但它的 audio 基建（iOS 后台播放）跟 #01 重叠，应该后做以复用代码
- 需要一定的 audio 素材准备（环境音底噪），有不可控因素

**原创差异化**：用 Web Audio 合成 Eridian 哨音作为 ambient 元素——这是 PHM
canon-true（Rocky 母语就是 musical whistle-clicks），而且是其他陪伴类产品
没有的 IP 杀手锏。

## Goals

1. 用户开"陪我"模式 → 全屏深色界面 → 背景白噪音 + Rocky 偶发母语哨音 +
   英语短音（"Hmm." / "Question?" / "Working."）
2. 用户能选 3 种环境底噪：Erid 雨 / 生物穹顶 / Hail Mary 飞船舱
3. 锁屏 / 后台仍然继续播放（复用 #01 的 iOS audio 基建）
4. Lv2+ 解锁 Grace 偶发短音层（敲键盘声 / 远处轻声问候）
5. 用户可设定时器（25/45/90 分钟）→ 适配学习/工作/番茄钟场景

## Non-goals

- ❌ 番茄钟 / 学习计时器（v1 只是简单倒计时；不做 break/work 周期切换）
- ❌ 摄像头互动 / "Rocky 看着你工作"（隐私敏感，不做）
- ❌ 历史/统计（"你今天陪我陪了 2 小时"）
- ❌ 用户上传自定义白噪音

## User stories

- **As a 学习时想有人陪的用户**：开陪伴模式 → 选 Erid 雨底噪 → 设 90 分钟
  → 戴耳机做题，偶尔听到 Rocky 在旁边哼一声，不打扰
- **As a 失眠但不想听完整故事的用户**：开陪伴模式 → 选 Hail Mary 飞船舱底
  噪 → 不设定时 → 听着电子嗡鸣慢慢睡
- **As a Lv2 用户**：开陪伴模式 → 偶尔听到 Grace 在背景敲键盘 / 一句"How
  you doing, Earth kid?"（亲密感）

## Functional requirements

- **FR-1** 主 UI 加 🎧 "陪我" 按钮（或者跟 🌙 #01 并排放在新建的"陪伴菜单"hub）
- **FR-2** 进入全屏深色 modal（比 #01 BedtimePlayer 更暗一点，强调"留白"）
- **FR-3** 顶部 3 个底噪选项卡：☔ Erid 雨 / 🌐 生物穹顶 / 🚀 Hail Mary
- **FR-4** 中央动态视觉：Rocky 头像 + 微弱呼吸/脉动动效（slow,慢节奏）
- **FR-5** 底部 4 个定时器选项：不设 / 25 min / 45 min / 90 min
- **FR-6** Eridian 哨音偶发触发：平均每 90-180 秒一次，随机 motif，淡入淡出
- **FR-7** Rocky 英语短音偶发触发：平均每 3-5 分钟一次，从 10-15 个预录
  clip 中 weighted 随机选
- **FR-8** Lv2+ 解锁 Grace 短音层（偶发敲键盘 / 一句轻声）
- **FR-9** 退出 modal → 所有音频淡出 1.5 秒，不戛然
- **FR-10** 锁屏 / 切后台 → 继续播放（复用 #01 路径）
- **FR-11** MediaSession 显示"Rocky 在线 · Erid 雨"（或类似动态副标题）

## Non-functional requirements

- **资源占用**：底噪 + 偶发音 总计内存占用 < 30MB（移动端可承受）
- **包体增长**：底噪 mp3 总计 < 15MB（3 个底噪 × ~5MB）；Rocky 短音
  ~2MB；Grace 短音 ~1MB（仅 Lv2+ 才加载）
- **iOS 兼容**：跟 #01 同样要求（iOS 16.4+ for Wake Lock）
- **性能**：Web Audio 合成 Eridian 哨音不能阻塞 main thread；用 AudioWorklet
  或 OfflineAudioContext 预渲染 buffer

## 技术方案

### 三层音频架构

```
Layer 1: 底噪 loop (HTML5 audio, loop=true)
  ├─ Erid 雨：氨海雨打 xenonite 屋顶
  ├─ 生物穹顶：风扇嗡鸣 + 偶水滴
  └─ Hail Mary：低频电子嗡鸣 + 远 beep

Layer 2: Eridian 哨音偶发（Web Audio 合成）
  └─ 5-channel oscillator + percussion bursts，随机 motif

Layer 3: Rocky/Grace 英语短音（HTML5 audio one-shot）
  ├─ Rocky: 10-15 个 clip（"Question?", "Hmm.", "Working.", "Good." 等）
  └─ Grace（Lv2+）: 5 个 clip（敲键盘、"How you doing", "Hey kid"）
```

### Layer 2: Eridian 合成（核心创新）

PHM 原著里 Rocky 的语言是 5 个独立音色频道（不同 fundamental frequency），
每个都是 musical tone（pitch + rhythm）。用 Web Audio 实现：

```ts
function eridianBleat(ctx: AudioContext, options: {
  rootHz: number;       // 基频（200-1500Hz 范围 random）
  durationMs: number;   // 50-300ms
  destination: AudioNode;
}) {
  const { rootHz, durationMs, destination } = options;
  const t = ctx.currentTime;
  
  // Triangle wave 比 sine 多一点泛音，听起来更"有机"
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(rootHz, t);
  osc.frequency.exponentialRampToValueAtTime(rootHz * 1.3, t + durationMs / 2000);
  osc.frequency.exponentialRampToValueAtTime(rootHz * 0.95, t + durationMs / 1000);
  
  // Envelope: attack 20ms, decay/release
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);
  
  osc.connect(gain).connect(destination);
  osc.start(t);
  osc.stop(t + durationMs / 1000 + 0.05);
}

// 一个完整的 Eridian "短句" 是 3-7 个 bleat + 之间的 click 打击
function eridianPhrase(ctx: AudioContext, dest: AudioNode) {
  const bleatCount = 3 + Math.floor(Math.random() * 4);
  let cursor = 0;
  for (let i = 0; i < bleatCount; i++) {
    const root = 200 + Math.random() * 1000;
    const dur = 50 + Math.random() * 250;
    setTimeout(() => eridianBleat(ctx, {
      rootHz: root, durationMs: dur, destination: dest
    }), cursor);
    cursor += dur + Math.random() * 100;
  }
}
```

### Layer 3: 偶发音 scheduler

```ts
class AmbientScheduler {
  private timers: number[] = [];
  
  start() {
    // 平均每 120s 一个 Eridian phrase
    this.scheduleNext(() => this.fireEridian(), 60_000, 180_000);
    // 平均每 240s 一个 Rocky 英语短音
    this.scheduleNext(() => this.fireRocky(), 120_000, 360_000);
    // Lv2+：平均每 480s 一个 Grace 短音
    if (userLevel >= 2) {
      this.scheduleNext(() => this.fireGrace(), 240_000, 720_000);
    }
  }
  
  private scheduleNext(fn: () => void, minMs: number, maxMs: number) {
    const delay = minMs + Math.random() * (maxMs - minMs);
    const id = window.setTimeout(() => {
      fn();
      this.scheduleNext(fn, minMs, maxMs);
    }, delay);
    this.timers.push(id);
  }
  
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
```

### 资产准备

#### 底噪（外部素材）

需要找/制作：
1. ☔ Erid 雨：搜 Freesound "rain on metal roof" + 加 reverb 加深 → 5MB mp3 loop
2. 🌐 生物穹顶：搜 "ventilation fan hum" + 加偶发水滴 → 5MB mp3 loop
3. 🚀 Hail Mary：搜 "spaceship ambient hum" + beep → 5MB mp3 loop

**素材来源**：Freesound (CC0/CC-BY) 优先；如果质量不够再考虑 Epidemic
Sound 订阅。

**渲染要求**：30-60 秒能无缝循环的 mp3（首尾相接不出现 click）。

#### Rocky 英语短音（用 MiniMax 渲染）

写一个 `scripts/gen-ambient-clips.sh`，用现有 T2A pipeline 渲染：

| Clip | 文本 |
| --- | --- |
| rocky_question | "Question?" |
| rocky_hmm | "Hmm." |
| rocky_working | "Working." |
| rocky_good | "Good." |
| rocky_earthkid | "Earth kid?" |
| ... 等 10-15 条 | |

每条 3 lang，约 30-45 个小 mp3 文件，总计约 2MB。

#### Grace 短音（仅 Lv2+ 加载）

| Clip | 来源 |
| --- | --- |
| grace_typing | Freesound "keyboard typing" 短片段 |
| grace_howyoudoing | MiniMax T2A 用美式男声 voice_id 渲染 |
| grace_heykid | 同上 |

### Frontend

新增：
- `web/src/components/ImmersiveCompanion.tsx`：全屏 modal + 底噪选择 + 定时器
- `web/src/hooks/useAmbientScheduler.ts`：scheduler 状态机
- `web/src/audio/eridianSynth.ts`：Web Audio 合成函数
- `web/src/data/ambientAssets.ts`：底噪 + clip 路径 + metadata

修改：
- `web/src/components/ChatInterface.tsx`：加 🎧 入口（或者跟 🌙 一起进 hub）
- `web/src/i18n/index.ts`：UI 文案 × 3 lang

### Server changes

**零**。纯前端 feature。

## Open questions

1. **🎧 入口跟 🌙 入口要不要 consolidate 成一个"陪伴菜单"hub？**
   - 同步问题在 #01 已经提出。倾向：W3 做 #04 的同时把两个入口合并成 hub
   - hub 里可以有 🌙 睡前 / 🎧 陪伴 / 📚 教学 三个入口

2. **底噪素材许可怎么处理？**
   - Freesound CC0 最干净，但优质 loop 要花时间挑
   - Epidemic Sound 订阅可解决但要花钱
   - 倾向先 CC0 + 自己 mix，不行再花钱

3. **Eridian 哨音的"语义"要不要做成可识别的 motif？**
   - 例如"Rocky 在思考"用一个固定 phrase，"Rocky 在确认"用另一个
   - 增加沉浸感但要做好"不要重复到烦"的平衡
   - 倾向 v1 是纯随机，看用户反馈后再决定

4. **能不能跨 #01 和 #04 共用一个`useImmersiveAudio` hook？**
   - HTML5 audio + Wake Lock + MediaSession 的核心逻辑确实可复用
   - 倾向：做 #01 时把这部分抽成共享 hook，#04 直接调

## Verification / 验证 & 测试方案

### 本地手动

- [ ] 三个底噪都能正确 loop 不出现 click
- [ ] Eridian 合成在 Chrome / Safari / Firefox 都能工作
- [ ] Eridian 哨音听起来"有趣但不烦"（主观，开 90 分钟实测）
- [ ] Rocky 英语短音偶发频率合理（不会半分钟说一次也不会半小时一次）
- [ ] Lv1 用户：没有 Grace 短音
- [ ] Lv2 用户：偶尔出现 Grace 短音
- [ ] 定时器到点：所有音频淡出 1.5s 停止
- [ ] 退出 modal：同样的淡出

### iPhone 真机测试（必须）

- [ ] 锁屏后底噪继续播放
- [ ] 锁屏控制条显示标题正确（"Rocky 在线 · Erid 雨"等）
- [ ] 锁屏期间 scheduler 仍然能触发偶发音（这是关键 — setTimeout 在 iOS
  Safari 后台可能被节流）
- [ ] 长时间播放（>30 分钟）内存不爆

### 性能测试

- [ ] Chrome DevTools Performance：开陪伴模式 5 分钟，main thread 时间
  应该接近 idle（音频不能跑在 main thread）
- [ ] 内存：DevTools Memory snapshot，开 30 分钟后内存增长 < 50MB

### Production 烟测

```bash
# 底噪 mp3 都 200
for bg in erid_rain biodome hailmary; do
  curl -sI "https://teaching-collie-6315.edgespark.app/audio/ambient/${bg}.mp3" | head -1
done
```

## Rollout

1. 先做 #01（建立 iOS audio 基建）
2. 抽共享 hook：`useImmersiveAudio` / Wake Lock + MediaSession 复用
3. 找/制作 3 个底噪 mp3
4. 写 Eridian 合成函数 + scheduler
5. 渲染 Rocky 英语短音 + Grace 短音
6. 实现 ImmersiveCompanion 组件
7. iPhone 真机测试（关键：scheduler 在后台是否仍工作）
8. 独立 code review
9. 合并 → 部署

**回滚方案**：纯前端 + 静态 mp3 资产。Revert PR + 删除 mp3 即可。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| 底噪素材采购 / mix | 1d |
| Eridian 合成 + scheduler | 0.75d |
| Rocky/Grace 短音渲染 | 0.25d |
| ImmersiveCompanion UI | 0.75d |
| iOS 真机调试（重点：后台 setTimeout）| 0.5-1d |
| Polish + i18n | 0.25d |
| **合计** | **2-3d** |（不含 #01 已建好的基建）

## 跟其他 spec 的关系

- 强依赖 #01 的 HTML5 audio + Wake Lock + MediaSession 基建
- 跟 #07 共享"输入层 hub"思路（如果做 hub 的话）
- 完全独立于 #03 / #06，互不影响
