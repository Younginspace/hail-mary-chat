# Spec 07 — 语音输入（ASR）

**Status**: Planned
**Priority**: P1
**Effort**: 2-3 days
**Window**: W2
**Dependencies**: `DASHSCOPE_API_KEY` secret（owner 配置中），R2 bucket 用于
临时音频上传

---

## 用户需求背景

来自 owner（基于真实用户反馈，移动端为主）：

> "支持语音输入：要做一层语音转文字再给 llm 吗，还是 minimax 本身也支持
> 语音输入的类型？"

**调研结论**：MiniMax LLM 不接受语音输入，公开 docs 也没有 ASR 端点。所以
答案是"做一层 ASR"。已选定 **Aliyun DashScope Paraformer-v2**（详见 INDEX.md
的"调研结论"段）。

**为什么这是 P1**：

- 用户主要在移动端，打字累，语音输入是巨大的 UX 提升
- Paraformer-v2 价格碾压（¥0.288/小时 + 36k 秒/月免费）
- 跟 #06 共享同一个 vendor key，运维成本一次性付清

## Goals

1. 用户在 chat 输入区按住"🎤"按钮录音，松开 → 自动转文字 → 填到输入框
2. 转写文字**先填到输入框让用户编辑/确认**，**不**自动发送
3. 支持 zh/en/ja，以及码混（中英混说）
4. 整个 ASR 链路 < 3 秒延迟（点松开到看到文字）

## Non-goals

- ❌ 实时流式 ASR / 边说边转写（v1 用 async API 即可，简单可靠）
- ❌ 语音输入 → 自动发送（必须用户确认，避免转写错误直接发出去）
- ❌ 离线 ASR（只支持联网场景）
- ❌ 长音频（>60 秒）转写（v1 限制单次 60 秒）
- ❌ 实时翻译（用户说什么语言就转什么文字，不主动跨语翻译）

## User stories

- **As a 走路时想发消息的用户**：打字不方便，按住🎤说话 → 转写 → 检查 →
  发送
- **As a 中英码混的用户**：我说"今天 GitHub 的 PR 终于 merge 了"，转写
  应该正确识别中英混
- **As a 不小心按错的用户**：录到一半想取消，向上滑或松开取消按钮 → 不上传

## Functional requirements

- **FR-1** Chat 输入区右侧加 🎤 按钮（位置可能跟 send button 切换或并列）
- **FR-2** 按住 🎤 → 开始录音（webm/opus via MediaRecorder API）
- **FR-3** 录音中 UI：显示录音时间 + 简单波形/呼吸圈动效
- **FR-4** 录音上限 60 秒，超时自动结束
- **FR-5** 松开 🎤 → 上传 → 转写 → 文字填入输入框
- **FR-6** 录音中**向上滑**或点击取消按钮 → 取消，不上传
- **FR-7** 转写期间输入框显示 loading 占位（"听着呢..." / "Listening..."）
- **FR-8** 转写文字填入输入框，**等用户确认后**点 send 发送
- **FR-9** 转写失败 → 用户友好错误（"听不清，再试一遍？"）+ 输入框保持空
- **FR-10** 跟随 app 当前 lang（`language_hints` 传 `[lang]`）；如果用户
  开"自动识别"开关（v1 不做）则传所有支持的语言

## Non-functional requirements

- **延迟**：从松开到文字填入 < 3 秒（含上传 + 转写 + 网络往返）
- **音频体积**：opus 编码下 60 秒约 ~80-200KB，移动网络可接受
- **iOS 兼容**：iOS Safari MediaRecorder 在 iOS 14.3+ 支持，但 codec 偏好
  `audio/mp4` 而非 webm；检测 + fallback 处理
- **隐私**：录音文件用一次后删除（R2 24h TTL），不持久化
- **错误处理**：网络失败 / DashScope 503 / 音频太短 → 各自有清晰错误提示

## 技术方案

### 整体流水线

```
浏览器 MediaRecorder（user 按住 🎤）
  ↓ webm/opus 或 mp4/aac blob
POST /api/asr （multipart upload）
  ↓
Worker: 上传 blob 到 R2，签名 URL（短期）
  ↓
DashScope Paraformer-v2 async API（passing R2 URL）
  ↓ task_id
Worker: poll task status（每 200ms 查一次，最多 10s）
  ↓ transcript
Worker: 删除 R2 blob（或留 24h TTL 让 lifecycle policy 删）
  ↓
返回 transcript 给前端
  ↓
前端：填入输入框
```

### Frontend

新增：
- `web/src/hooks/useVoiceInput.ts`：MediaRecorder 封装 + 取消/超时/格式
  fallback
- `web/src/components/VoiceInputButton.tsx`：按住🎤按钮 + 波形 UI

修改：
- `web/src/components/ChatInput.tsx`（或类似 input area 组件）：放置
  VoiceInputButton

iOS Safari fallback：

```ts
const supportedTypes = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',  // iOS Safari 偏好
  'audio/mpeg',
];
const mimeType = supportedTypes.find(t => MediaRecorder.isTypeSupported(t))
  || '';  // 让浏览器选默认
const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
```

### Server

新增端点：`POST /api/asr`

```ts
import { z } from 'zod';

const asrSchema = z.object({
  audioBase64: z.string(),     // base64-encoded audio blob
  mimeType: z.string(),         // audio/webm or audio/mp4
  lang: z.enum(['zh', 'en', 'ja']),
});

app.post('/api/asr', authMiddleware, async (c) => {
  const { audioBase64, mimeType, lang } = asrSchema.parse(await c.req.json());
  
  // 1. base64 → bytes → R2 upload
  const bytes = Uint8Array.from(atob(audioBase64), ch => ch.charCodeAt(0));
  const r2Key = `asr-tmp/${userId}/${crypto.randomUUID()}.${ext(mimeType)}`;
  await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
  
  // 2. 短期签名 URL（DashScope 需要公开可读）
  const signedUrl = await c.env.MEDIA.createSignedUrl(r2Key, { expiresIn: 600 });
  
  // 3. 调 DashScope 异步 ASR
  const dashResp = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.DASHSCOPE_API_KEY}`,
        'X-DashScope-Async': 'enable',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: { file_urls: [signedUrl] },
        parameters: { language_hints: [lang] },
      }),
    }
  );
  const { output: { task_id } } = await dashResp.json();
  
  // 4. Poll task status
  for (let i = 0; i < 50; i++) {  // 最多 10 秒
    await new Promise(r => setTimeout(r, 200));
    const statusResp = await fetch(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${task_id}`,
      { headers: { Authorization: `Bearer ${c.env.DASHSCOPE_API_KEY}` } }
    );
    const status = await statusResp.json();
    if (status.output?.task_status === 'SUCCEEDED') {
      // 5. 删 R2（避免 24h 内闲置）
      c.executionCtx.waitUntil(c.env.MEDIA.delete(r2Key));
      const transcript = status.output.results[0].transcripts[0].text;
      return c.json({ transcript });
    }
    if (status.output?.task_status === 'FAILED') {
      c.executionCtx.waitUntil(c.env.MEDIA.delete(r2Key));
      return c.json({ error: 'asr_failed' }, 500);
    }
  }
  
  // 超时
  c.executionCtx.waitUntil(c.env.MEDIA.delete(r2Key));
  return c.json({ error: 'asr_timeout' }, 504);
});
```

修改 `server/src/defs/runtime.ts`：

```ts
export type SecretKey =
  | 'MINIMAX_CODING_PLAN_KEY'
  | 'MINIMAX_API_KEY'
  | 'DASHSCOPE_API_KEY';  // ← 新增
```

### R2 bucket

需要一个 R2 bucket 用于临时音频。如果已经有用于头像/cover 的 R2，
可以复用，加路径前缀 `asr-tmp/`。**配 lifecycle policy 自动删除 1 天前
的 `asr-tmp/*`**。

如果还没有 R2 bucket，要：
- `edgespark storage create media`（或类似命令，先 `--help`）
- 在 `edgespark.toml` 里 bind 到 `MEDIA`

## Open questions

1. **Paraformer-v2 是否真接受 webm/opus？**
   - 文档说支持"任意采样率，aac/wav/mp3 等"，opus 没列出来
   - 需要做一次实验：拿 60 秒 webm/opus 文件直接喂 → 看回应
   - 如果不接受，client side 用 ffmpeg.wasm 转码到 mp3，但这增加 ~500KB
     bundle 体积

2. **R2 签名 URL 是否真的能给 DashScope 调用？**
   - DashScope 在国内，R2 在 Cloudflare（全球）
   - 国内调 R2 的签名 URL 应该可达（CF 在国内有部分 POP），但延迟和稳定性
     需要实测
   - 备选：用 Aliyun OSS 临时上传（同区域 → DashScope，更稳定）。但那要
     另一套 SDK + 签名

3. **取消手势**：长按 + 上滑取消 vs 长按 + 出现取消按钮？
   - 主流 IM（微信、WhatsApp）是上滑取消
   - 倾向跟主流保持一致

4. **是否要做 VAD（语音活动检测）裁掉首尾静音？**
   - 不做的话每条录音都包含一点静音 → 不影响识别但稍贵
   - v1 不做，等成本压力出现再优化

## Verification / 验证 & 测试方案

### Vendor 实验（最先做）

- [ ] 用 curl 直接调 Paraformer-v2，喂一个 webm/opus 60 秒样本
- [ ] 看返回的 transcript 质量（中/英/日各一段）
- [ ] 实测延迟（task 创建 → SUCCEEDED 的时间）
- [ ] 实测一段中英码混（"今天 GitHub merge 了一个 PR"）

### 本地手动

- [ ] Chrome 桌面：按住 🎤 → 说话 → 松开 → 输入框出现转写文字
- [ ] Safari 桌面：同上（codec fallback 生效）
- [ ] 取消手势：录音中上滑/点取消 → 不上传
- [ ] 超过 60 秒 → 自动停止
- [ ] 网络断开 → 输入框出现错误提示，不卡死

### Playwright 自动化

ASR 难以全自动化（需要真录音），但可以 mock：

```ts
test('voice input UI flow', async ({ page }) => {
  await page.route('/api/asr', route => 
    route.fulfill({ json: { transcript: 'Mock transcript text' } })
  );
  // 模拟按住 → 上传一个固定 audio blob → 验证输入框被填充
});
```

### 真机测试（必须）

- [ ] iPhone Safari：录音 → 转写
- [ ] iPhone Safari：触发 codec fallback（mp4/aac），验证 DashScope 接受
- [ ] Android Chrome：录音 → 转写
- [ ] 录音权限被拒绝时的 UI 兜底
- [ ] 公交/地铁等真实噪声环境下的识别准确率（人工评估）

### Production 烟测

```bash
# 端点存在 + 401 unauthenticated（验证 auth gate）
curl -i -X POST https://teaching-collie-6315.edgespark.app/api/asr \
  -H 'Content-Type: application/json' \
  -d '{}'
# 期望：401 / 400
```

## Rollout

1. **Vendor 实验**：先 curl 直调 Paraformer-v2 + webm/opus 样本，确认接受
2. 如果不接受 webm，决定是 client-side 转码还是改用 OSS 上传
3. 写 `/api/asr` endpoint + 加 `DASHSCOPE_API_KEY` 到 SecretKey 类型
4. 写前端按住 🎤 + 取消手势 + 波形 UI
5. iOS Safari codec fallback
6. 真机测试（iPhone + Android 各一遍）
7. 独立 code review subagent
8. 合并 → 部署 → 烟测

**回滚方案**：feature flag 控制 🎤 按钮显示。secret 即使配错也只影响这个
feature，不影响其他流程。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| Vendor 实验（curl + 样本测试）| 0.5d |
| `/api/asr` endpoint + R2 集成 | 0.5d |
| 前端按住录音 + 波形 UI | 0.75d |
| iOS Safari codec fallback + 真机调试 | 0.75d |
| Playwright + i18n + polish | 0.5d |
| **合计** | **2-3d** |

## 相关 secret / 配置

| 项 | 状态 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 🟡 owner 配置中（2026-04-30） |
| R2 bucket（用于临时 audio）| 待确认是否复用现有 bucket |
| `defs/runtime.ts` `SecretKey` 类型 | 实施时加入 |
